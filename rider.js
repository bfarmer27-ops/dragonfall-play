// First-person rider rig: saddle, girth straps, gloved fists, rope reins, sleeves and the eye the
// camera hangs from. Everything is a child of the dragon's saddleAnchor, which is scaled 1/1.6, so
// all numbers in this file are METRES relative to the seat centre (SHARED CONTRACTS v1, spec D5).
//
// Frame composition (what the references show, bottom to top): two dark leather fists in the
// bottom corners with the sleeves running off the bottom edge, rope reins rising out of the fists,
// drooping under their own weight onto the back and running along the neck flank to the bridle,
// the stitched leather pommel between the fists, two flat girth straps over the scaled back.
//
// Draw calls: leather 1, thread 1, glove 2 (one per hand, they move independently), sleeve 2,
// rein 2 = 8 total.
import * as THREE from './vendor/three.module.js';
import {TIER} from './quality.js';
import {SimplexNoise} from './vendor/addons/math/SimplexNoise.js';
import {profileAt,taperedTube} from './dragon.js';

const DRAGON_SCALE=1.6;
const ANCHOR_LOCAL=new THREE.Vector3(0,.79,.55);   // saddleAnchor position in dragon-local units
const damp=(a,b,k,dt)=>a+(b-a)*(1-Math.exp(-k*dt));
const clamp=THREE.MathUtils.clamp;
const Y_AXIS=new THREE.Vector3(0,1,0);

// Dragon-local point -> metres relative to the saddle anchor.
function toMetres(x,y,z){
 return new THREE.Vector3((x-ANCHOR_LOCAL.x)*DRAGON_SCALE,(y-ANCHOR_LOCAL.y)*DRAGON_SCALE,(z-ANCHOR_LOCAL.z)*DRAGON_SCALE);
}

// A point on the body loft at dragon-local z. angle 0 = top of the back, positive toward +x.
// pad > 1 lifts the point off the skin. Returns the point in metres and the outward normal.
function loftPoint(z,angle,pad=1){
 const p=profileAt(z);
 const lx=Math.sin(angle)*p.w*pad,ly=p.y+Math.cos(angle)*p.h*pad;
 const n=new THREE.Vector3(Math.sin(angle)/p.w,Math.cos(angle)/p.h,0).normalize();
 return {p:toMetres(lx,ly,z),n};
}

// Flat leather strap with thickness along a list of {p, n} samples (n = surface normal the strap
// lies on). Four faces (top, outer edge, bottom, inner edge) with split normals so the edges catch
// light. UV u = metres along the strap / 0.3, v across the face.
function ribbon(samples,width,thick,closed){
 const pos=[],nor=[],uv=[],idx=[];
 const count=samples.length,rings=closed?count+1:count;
 const t=new THREE.Vector3(),b=new THREE.Vector3(),tmp=new THREE.Vector3();
 let dist=0;
 for(let i=0;i<rings;i++){
  const s=samples[i%count];
  if(closed)t.subVectors(samples[(i+1)%count].p,samples[(i-1+count)%count].p);
  else if(i===0)t.subVectors(samples[1].p,s.p);
  else if(i===count-1)t.subVectors(s.p,samples[count-2].p);
  else t.subVectors(samples[i+1].p,samples[i-1].p);
  t.normalize();
  b.crossVectors(s.n,t).normalize();
  if(i>0)dist+=tmp.subVectors(s.p,samples[(i-1)%count].p).length();
  const u=dist/.3;
  // corners: [width sign, height level]; faces: [corner a, corner b, normal vector, normal sign]
  const corners=[[-1,1],[1,1],[1,0],[-1,0]];
  const faces=[[0,1,s.n,1],[1,2,b,1],[2,3,s.n,-1],[3,0,b,-1]];
  for(const [c0,c1,nv,sign] of faces){
   for(const c of [corners[c0],corners[c1]]){
    pos.push(s.p.x+b.x*c[0]*width/2+s.n.x*c[1]*thick,s.p.y+b.y*c[0]*width/2+s.n.y*c[1]*thick,s.p.z+b.z*c[0]*width/2+s.n.z*c[1]*thick);
    nor.push(nv.x*sign,nv.y*sign,nv.z*sign);
    uv.push(u,c===corners[c0]?0:1);
   }
  }
  if(i<rings-1){
   const base=i*8;
   for(let f=0;f<4;f++){const a=base+f*2,bb=a+1,c=a+8,d=a+9;idx.push(a,c,bb,bb,c,d);}
  }
 }
 const g=new THREE.BufferGeometry();
 g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
 g.setAttribute('normal',new THREE.Float32BufferAttribute(nor,3));
 g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
 g.setIndex(idx);
 return g;
}

// Merge every child mesh of `parent` (baking its local matrix) into ONE mesh with `material`.
// When the material uses vertexColors, each part's userData.tint (0..1, default 1) is written as
// a grey vertex colour: cheap baked shading (finger gaps, palm side) that survives the DOF blur.
function mergeChildren(parent,material){
 const data={position:[],normal:[],uv:[]};
 if(material.vertexColors)data.color=[];
 for(const m of parent.children.slice()){
  if(!m.isMesh)continue;
  m.updateMatrix();
  let g=m.geometry.clone().applyMatrix4(m.matrix);
  if(g.index){const nn=g.toNonIndexed();g.dispose();g=nn;}
  const tint=m.userData.tint===undefined?1:m.userData.tint;
  for(const key in data){
   const a=g.attributes[key],count=g.attributes.position.count,size=key==='uv'?2:3;
   if(key==='color'){for(let i=0;i<count*3;i++)data.color.push(tint);continue;}
   if(a)for(const v of a.array)data[key].push(v);else for(let i=0;i<count*size;i++)data[key].push(0);
  }
  g.dispose();parent.remove(m);
 }
 const geo=new THREE.BufferGeometry();
 for(const key in data)geo.setAttribute(key,new THREE.Float32BufferAttribute(data[key],key==='uv'?2:3));
 const mesh=new THREE.Mesh(geo,material);
 parent.add(mesh);
 return mesh;
}

// Rewrite an existing TubeGeometry's positions/normals for a new curve without reallocating.
// Vertex layout matches THREE.TubeGeometry (segments+1 rings of radial+1 vertices); uvs are kept.
const _p=new THREE.Vector3(),_n=new THREE.Vector3();
function writeTube(geo,curve,segments,radial,radius){
 const frames=curve.computeFrenetFrames(segments,false);
 const pos=geo.attributes.position,nor=geo.attributes.normal;
 for(let i=0;i<=segments;i++){
  curve.getPointAt(i/segments,_p);
  const N=frames.normals[i],B=frames.binormals[i];
  for(let j=0;j<=radial;j++){
   const v=j/radial*Math.PI*2,s=Math.sin(v),c=-Math.cos(v);
   _n.set(c*N.x+s*B.x,c*N.y+s*B.y,c*N.z+s*B.z).normalize();
   const k=i*(radial+1)+j;
   nor.setXYZ(k,_n.x,_n.y,_n.z);
   pos.setXYZ(k,_p.x+radius*_n.x,_p.y+radius*_n.y,_p.z+radius*_n.z);
  }
 }
 pos.needsUpdate=true;
 nor.needsUpdate=true;
}

export function createRider({saddleAnchor,bridleAnchors}){
 const high=TIER==='high';
 const group=new THREE.Group();
 group.name='rider';
 saddleAnchor.add(group);

 // ---- textures (import.meta.url so dev pages under dist/dev/ resolve the same files)
 const loader=new THREE.TextureLoader();
 function tex(name,srgb,rx=1,ry=1){
  const t=loader.load(new URL('./assets/'+name,import.meta.url).href);
  t.wrapS=t.wrapT=THREE.RepeatWrapping;
  t.repeat.set(rx,ry);
  t.anisotropy=4;
  if(srgb)t.colorSpace=THREE.SRGBColorSpace;
  return t;
 }
 const leatherDiff=tex('leather_diff_512.png',true);
 const gloveDiff=tex('glove_diff_512.png',true,2,2);
 const leatherNor=high?tex('leather_nor_512.png',false):null;
 const gloveNor=high?tex('leather_nor_512.png',false,5,5):null;
 // 32 repeats along the rein (was 80): at 80 the diagonal bands of the map were 5 cm stripes at arm's length.
 const ropeDiff=tex('rope_diff_256.png',true,32,1);
 const ropeNor=tex('rope_nor_256.png',false,32,1);

 // ---- materials. Matte-ish leather: the old clearcoat .6 read as polished brass under the sun.
 const leather=new THREE.MeshPhysicalMaterial({
  // Dark brown saddle leather that still reads (v080 pommel ~25-40/255): the small emissive stands in for the bounce
  // off the rider's own body, which no scene light provides (the pommel measured 1-3/255 before).
  // leather_diff_512 averages ~0x3a2418 (0.04 linear) so at full strength it multiplied any tint down to black; the
  // map is blended to 55% below (texture stays, brightness comes from the colour). The emissive is the warm bounce off
  // the rider's own body that no scene light provides: ACES at exposure .82 needs ~0.045 linear for 20/255.
  color:0x70604e,map:leatherDiff,roughness:.8,metalness:0,clearcoat:.15,clearcoatRoughness:.6,
  normalMap:leatherNor,normalScale:new THREE.Vector2(.8,.8),envMapIntensity:1.0,
  emissive:new THREE.Color(0x4a3a2a),emissiveIntensity:.3
 });
 // glove_diff_512 averages ~0x5a3a20 (0.1 linear): blended to 50% so the tan tint below shows (v080 gloves).
 function blendMap(material,amount,key){
  material.onBeforeCompile=shader=>{
   shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',
    'vec4 sampledDiffuseColor = texture2D( map, vMapUv ); diffuseColor *= mix( vec4( 1.0 ), sampledDiffuseColor, '+amount.toFixed(2)+' );');
  };
  material.customProgramCacheKey=()=>key;
 }
 blendMap(leather,.55,'rider-leather');
 const glove=new THREE.MeshPhysicalMaterial({
  // Tan lit leather like v080 frame 1 (was 0x9a8878 at envMapIntensity .6: the fists measured 4-13/255, black shapes).
  // The small emissive is the bounce off the rider's own body/saddle that no scene light provides.
  color:0xb09474,map:gloveDiff,roughness:.72,metalness:0,clearcoat:.1,clearcoatRoughness:.6,vertexColors:true,
  normalMap:gloveNor,normalScale:new THREE.Vector2(.6,.6),envMapIntensity:1.0,
  emissive:new THREE.Color(0x3a2e22),emissiveIntensity:.1,
  sheen:high?.2:0,sheenColor:new THREE.Color(0x5a4030),sheenRoughness:.7
 });
 blendMap(glove,.75,'rider-glove');
 const rope=new THREE.MeshStandardMaterial({color:0xd0703a,map:ropeDiff,normalMap:ropeNor,normalScale:new THREE.Vector2(.45,.45),roughness:.85,metalness:0,envMapIntensity:.8});
 // The rope map is diagonal beige/grey bands; multiplied at full strength under the orange colour every band became a
 // dark stripe (candy cane). Blended to 40% the reins read as one warm orange line with a faint twist (v080).
 rope.onBeforeCompile=shader=>{
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
   vec4 sampledDiffuseColor = texture2D( map, vMapUv );
   diffuseColor *= mix( vec4( 1.0 ), sampledDiffuseColor, 0.4 );`);
 };
 rope.customProgramCacheKey=()=>'rider-rope';
 const thread=new THREE.MeshStandardMaterial({color:0xb99b6a,roughness:.8,metalness:0});
 const cloth=new THREE.MeshStandardMaterial({color:0x4a423c,roughness:.95,metalness:0});
 const REIN_COLORS={orange:0xd0703a,blue:0x2f6fb0,leather:0x3a2416};

 function add(parent,geo,mat,position,rotation,scale,tint){
  const m=new THREE.Mesh(geo,mat);
  if(position)m.position.set(...position);
  if(rotation)m.rotation.set(...rotation);
  if(scale)m.scale.set(...scale);
  if(tint!==undefined)m.userData.tint=tint;
  parent.add(m);
  return m;
 }

 // ---- saddle: seat, front swell, pommel with a stitched welt, two girth straps, two chest straps
 const saddle=new THREE.Group();
 group.add(saddle);
 const stitches=new THREE.Group();
 group.add(stitches);
 add(saddle,new THREE.SphereGeometry(.5,32,16),leather,[0,-.02,-.15],null,[1.25,.22,1.7]);      // seat
 add(saddle,new THREE.SphereGeometry(.5,24,12),leather,[0,-.03,-.45],null,[.60,.13,.82]);       // low swell into the pommel
 const POMMEL_C=new THREE.Vector3(0,.16,-.78),POMMEL_R=new THREE.Vector3(.235,.15,.20);           // 47 x 30 x 40 cm leather horn
 add(saddle,new THREE.SphereGeometry(1,28,18),leather,POMMEL_C.toArray(),null,POMMEL_R.toArray());
 // Welt (raised seam) around the pommel with thread stitches every ~4 cm.
 {
  const phi=.55,pts=[],n=48;
  for(let i=0;i<n;i++){
   const th=i/n*Math.PI*2;
   pts.push(new THREE.Vector3(POMMEL_C.x+POMMEL_R.x*Math.cos(phi)*Math.cos(th),POMMEL_C.y+POMMEL_R.y*Math.sin(phi),POMMEL_C.z+POMMEL_R.z*Math.cos(phi)*Math.sin(th)));
  }
  const curve=new THREE.CatmullRomCurve3(pts,true);
  add(saddle,new THREE.TubeGeometry(curve,64,.011,8,true),leather);
  const stitchGeo=new THREE.CapsuleGeometry(.0035,.02,2,6);
  const tangent=new THREE.Vector3();
  for(let i=0;i<36;i++){
   const u=i/36;
   const p=curve.getPointAt(u);
   curve.getTangentAt(u,tangent);
   const s=new THREE.Mesh(stitchGeo,thread);
   // sit the stitch on top of the welt, slightly outward
   s.position.copy(p).addScaledVector(new THREE.Vector3(p.x-POMMEL_C.x,p.y-POMMEL_C.y,p.z-POMMEL_C.z).normalize(),.010);
   s.quaternion.setFromUnitVectors(Y_AXIS,tangent);
   stitches.add(s);
  }
  // A second stitch row along the front swell's centre seam (reads as the saddle's seat seam).
  for(let i=0;i<7;i++){
   const z=-.30-i*.06;
   const s=new THREE.Mesh(stitchGeo,thread);
   s.position.set(0,-.03+.13*Math.sqrt(Math.max(0,1-((z+.45)/.82)**2))+.004,z);
   s.rotation.x=Math.PI/2;
   stitches.add(s);
  }
 }
 // Girth straps: flat 9 cm leather bands around the body (dragon-local z = -0.4 ahead of the seat,
 // +1.0 behind it, under the rider).
 for(const z of [-0.4,1.0]){
  const samples=[],n=z<0?48:24;
  for(let i=0;i<n;i++)samples.push(loftPoint(z,i/n*Math.PI*2,1.012));
  add(saddle,ribbon(samples,.09,.012,true),leather);
 }
 // Chest straps: from the pommel down the shoulder to each wing root.
 for(const side of [-1,1]){
  const samples=[
   {p:new THREE.Vector3(side*.15,.21,-.70),n:new THREE.Vector3(side*.35,1,-.2).normalize()},
   {p:new THREE.Vector3(side*.30,.10,-.86),n:new THREE.Vector3(side*.45,1,-.1).normalize()},
   loftPoint(-0.55,side*.36,1.02),
   loftPoint(-0.80,side*.60,1.02),
   loftPoint(-1.0,side*.85,1.02),
   {p:toMetres(side*.82,.26,-1.2),n:new THREE.Vector3(side*.7,.7,0).normalize()}
  ];
  add(saddle,ribbon(samples,.07,.011,false),leather);
 }
 mergeChildren(saddle,leather);
 mergeChildren(stitches,thread);

 // ---- hands: leather fists holding a vertical rope, thumbs up, sleeves running off the frame.
 // Hand-local frame: origin = fist centre (the rope axis is local +y), -z = forward. `side`
 // mirrors the geometry by coordinate (no negative scale, so face winding stays correct).
 const hands=[];
 const sleeves=[];
 const FIST_SCALE=1.25;
 // Eye tilt -0.20 rad (-11.5 deg; was -0.24): with the sun at 12.9 deg elevation the 16:9 frame's top edge (+19.5 deg
 // at fov 62) keeps the sun disc, halo and shafts in frame in level flight. The fists are placed from this same
 // constant so they stay at ~77% across / ~78% down whatever the tilt.
 const EYE_BASE=new THREE.Vector3(0,1.12,.85),EYE_TILT=-0.20,DEG=Math.PI/180;
 const HAND_BASE=[new THREE.Vector3(),new THREE.Vector3()];
 // Fist rest position from a direction in the eye's base frame (side angle, down angle, distance)
 // so the fists sit ~80% across and ~85% down the frame whatever the aspect.
 function fistRest(side,aspectValue,target){
  const f=clamp((aspectValue-.462)/(1.777-.462),0,1);
  // Angles measured on the real game frame (integration, 2026-09-09): the earlier 15.6..32 / 23..18 put the fist
  // centres at 90% across and 86% down (half the fist off-frame, under the landscape thumb pads). These land them
  // at ~76% across and ~80% down on both 16:9 (fov 56) and 9:16 (fov 74), like the reference sheets.
  const sideA=THREE.MathUtils.lerp(10.5,26,f)*DEG,downA=THREE.MathUtils.lerp(24,16,f)*DEG,dist=.78;
  const x=side*Math.sin(sideA)*Math.cos(downA),y=-Math.sin(downA),z=-Math.cos(sideA)*Math.cos(downA);
  const c=Math.cos(EYE_TILT),s=Math.sin(EYE_TILT);
  return target.set(x,y*c-z*s,y*s+z*c).multiplyScalar(dist).add(EYE_BASE);
 }
 function fistPoint(side,a,rr,y){return [side*Math.cos(a)*rr,y,-Math.sin(a)*rr];}
 for(const side of [-1,1]){
  const hand=new THREE.Group();
  hand.position.copy(fistRest(side,16/9,HAND_BASE[side<0?0:1]));
  group.add(hand);
  hands.push(hand);
  const gloveParts=new THREE.Group();
  hand.add(gloveParts);
  // palm / back-of-hand mass
  add(gloveParts,new THREE.SphereGeometry(1,16,12),glove,[side*.006,-.010,.016],[0,-side*.3,side*.15],[.036,.054,.044],1);
  // four fingers curled around the rope, index on top
  for(let f=0;f<4;f++){
   const y=.030-f*.021,rr=.037-f*.0015;
   const pts=[];
   for(let k=0;k<=6;k++){const a=-.25+k*(3.5/6);pts.push(fistPoint(side,a,rr,y-Math.abs(k-3)*.0015));}
   // Tints stay >= .85 (were .62-.92): they multiply the albedo and pushed the fingers under 35% brightness.
   add(gloveParts,taperedTube(pts,.0125-f*.0007,.0095,12,8),glove,null,null,null,.85);
   // knuckle
   const kp=fistPoint(side,.75,rr+.004,y+.004);
   add(gloveParts,new THREE.SphereGeometry(.0155,8,6),glove,kp,null,null,1);
  }
  // thumb lying across the top, base joint at the outer side
  {
   const pts=[];
   for(let k=0;k<=5;k++){const a=.15+k*(2.4/5);pts.push(fistPoint(side,a,.030,.057-k*.002));}
   add(gloveParts,taperedTube(pts,.014,.0095,10,8),glove,null,null,null,1);
   add(gloveParts,new THREE.SphereGeometry(.019,10,8),glove,[side*.030,.045,.010],null,null,1);
  }
  // wrist and flared gauntlet cuff, heading back and down toward the rider
  add(gloveParts,taperedTube([[side*.005,-.040,.020],[side*.020,-.100,.085],[side*.045,-.165,.165]],.040,.056,10,12),glove,null,null,null,.92);
  add(gloveParts,taperedTube([[side*.045,-.165,.165],[side*.055,-.200,.205]],.058,.066,4,12),glove,null,null,null,.88);
  mergeChildren(gloveParts,glove);
  // sleeve (dark cloth) continuing off the bottom of the frame
  const sleeve=new THREE.Mesh(taperedTube([[side*.052,-.190,.195],[side*.085,-.320,.360],[side*.120,-.520,.600]],.060,.078,8,12),cloth);
  gloveParts.add(sleeve);
  sleeves.push(sleeve);
  gloveParts.scale.setScalar(FIST_SCALE);
  hand.rotation.set(-.15,-side*.25,side*.12);
 }

 // ---- reins: one rope per side. It hangs out of the bottom of the fist, passes up through it,
 // rises out of the top, droops under its own weight onto the back, runs along the neck flank and
 // ends at the bridle ring. Rebuilt in place when the fists, the inputs or the head moved.
 const REIN_SEGMENTS=56,REIN_RADIAL=8,REIN_RADIUS=.014;   // 1.4 cm rope (2 cm read as a hose at the frame edges)
 const reins=[],reinCurves=[];
 for(const side of [-1,1]){
  const pts=[];
  for(let i=0;i<9;i++)pts.push(new THREE.Vector3(side*.5,0,-i));
  const curve=new THREE.CatmullRomCurve3(pts);
  curve.curveType='centripetal';
  reinCurves.push(curve);
  const rein=new THREE.Mesh(new THREE.TubeGeometry(curve,REIN_SEGMENTS,REIN_RADIUS,REIN_RADIAL,false),rope);
  group.add(rein);
  reins.push(rein);
 }
 group.traverse(m=>{if(m.isMesh){m.castShadow=true;m.receiveShadow=true;m.frustumCulled=false;}});

 // Foreground fill: a short-range warm point light at the rider's chest. The sun is ahead, so every face the rider sees
 // (backs of the fists, the pommel, the sleeves) faces away from it; the HemisphereLight cannot lift them because three
 // divides its irradiance by pi (0.25 -> 0.9 moved the fists by 2/255 in the judge's probe). 2.4 m range, so it never
 // reaches the neck or the walls. No shadow map.
 const fill=new THREE.PointLight(0xffd9b8,.03,2.4,2);   // subtle: the PMREM sky (sky.js skyBoost) now lights the fists; .3 put them at 90-100/255, v080 fists measure ~35
 fill.position.set(0,.9,.45);
 group.add(fill);

 // ---- eye: the camera is parented here
 const eye=new THREE.Object3D();
 eye.position.copy(EYE_BASE);
 eye.rotation.x=EYE_TILT;
 group.add(eye);

 // ---- per-frame state
 const noise=high?new SimplexNoise():null;
 let shakeLeft=0,shakeDuration=.4,shakeTime=0;
 let thumpTime=10,lastExternalBeat=-10,elapsed=0;
 let steeringLead=0;
 // smoothPull[i] = how far hand i is pulled back toward the rider (+1 = that thumb slid fully down toward the rider).
 let smoothPull=[0,0],smoothBank=0,lastBuiltPull=[NaN,NaN],lastBuiltBank=NaN,lastBuiltSpread=NaN;
 let prevBob=0,prevBobDelta=0;
 let aspect=16/9,spread=16/9,forcedAspect=null;   // spread = damped frame aspect the fists are placed from
 const _bridle=new THREE.Vector3(),_lastBridle=[new THREE.Vector3(1e9,0,0),new THREE.Vector3(1e9,0,0)];
 const _v=new THREE.Vector3();

 function handToGroup(i,x,y,z,target){
  return target.set(x,y,z).applyMatrix4(hands[i].matrix);
 }

 function rebuildRein(i,bank){
  const s=i===0?-1:1;
  const outer=(bank>0)!==(s>0);        // bank>0 = right turn: the LEFT rein is the outer, pulled-tight one
  const tight=outer?Math.abs(bank):0;
  const slack=outer?0:Math.abs(bank)*.10;
  const pts=reinCurves[i].points;
  hands[i].updateMatrix();
  const k=FIST_SCALE;
  handToGroup(i,s*.03*k,-.24*k,.11*k,pts[0]);  // free end hanging below the fist
  handToGroup(i,0,-.02*k,0,pts[1]);            // inside the fist
  handToGroup(i,0,.085*k,0,pts[2]);            // out of the top, between thumb and forefinger
  handToGroup(i,s*.07*k,.17*k,-.11*k,pts[3]);  // arcs up and forward
  pts[4].set(s*.55,-.24+tight*.34-slack,-1.5); // droops onto the back under its own weight
  const b=_lastBridle[i],route=bridleAnchors[i].userData&&bridleAnchors[i].userData.reinRoute;
  if(route&&b.x<1e8){
   // A dragon that sets bridleAnchors[i].userData.reinRoute (dragon-gltf.js: the demon dragon, whose rider-view tune
   // hangs the mouth 2.25 m below the seat) routes the rope along its neck flank, and the last two points hang off the
   // bridle ring so the far end follows the head wherever the tune puts it. The fixed points below were tuned for a
   // head at seat height; on the low head they rose 2.3 m above the mouth and the rein tips hung in the sky (09-11).
   const [sx,sy,sz]=route.shoulder,[fx,fy,fz]=route.flank,[kx,ky,kz]=route.skull;
   pts[5].set(s*sx,sy+tight*.24-slack,sz);            // leaves the back, onto the shoulder side
   pts[6].set(s*fx,b.y+fy+tight*.14,b.z+fz);          // upper flank, mid neck
   pts[7].set(s*kx,b.y+ky+tight*.06,b.z+kz);          // upper flank beside the skull, just before the mouth
  }else{
   pts[5].set(s*.74,-.33+tight*.24-slack,-4.0);       // rests on the neck flank
   pts[6].set(s*.56,-.15+tight*.14,-7.4);
   pts[7].set(s*.53,-.04+tight*.06,-9.6);
  }
  pts[8].copy(b);                                     // the bridle ring at the mouth corner
  writeTube(reins[i].geometry,reinCurves[i],REIN_SEGMENTS,REIN_RADIAL,REIN_RADIUS);
 }

 // l, r: RAW thumb positions (+1 = slid up, away from the rider; -1 = slid down, toward the rider). Sliding a thumb
 // down pulls that side's rein, so the fist on that side draws back and up; r-l is the bank, as before.
 function update(l,r,flight,dt){
  dt=clamp(dt||0,0,.1);
  elapsed+=dt;
  const pitch=flight.pitch||0,roll=flight.roll||0,yaw=flight.yaw||0;
  const bank=(r-l)/2;
  smoothPull[0]=damp(smoothPull[0],-clamp(l||0,-1,1),10,dt);
  smoothPull[1]=damp(smoothPull[1],-clamp(r||0,-1,1),10,dt);
  smoothBank=damp(smoothBank,bank,10,dt);
  // Fist spread follows the frame aspect so the fists sit in the bottom corners on a phone
  // (portrait, narrow) as well as on a landscape screen.
  const cam=forcedAspect===null?eye.children.find(c=>c.isCamera):null;
  const a=forcedAspect!==null?forcedAspect:(cam&&cam.aspect?cam.aspect:aspect);
  aspect=a;
  spread=damp(spread,a,8,dt);
  // Hands: a pulled rein draws THAT fist back and up (both pulled = climb); a bank drops the inner fist and lifts the outer.
  for(let i=0;i<2;i++){
   const side=i===0?-1:1;
   const inner=(smoothBank>0)===(side>0);
   const hand=hands[i];
   const base=fistRest(side,spread,HAND_BASE[i]);
   const pull=smoothPull[i];
   hand.position.x=base.x;
   hand.position.z=base.z+.12*pull;
   hand.position.y=base.y+.06*pull+(inner?-.08:.06)*Math.abs(smoothBank);
   hand.rotation.x=-.15+.35*pull;
   hand.rotation.z=side*.12+(inner?-.15:.10)*Math.abs(smoothBank)*side;
  }
  // Reins follow the fists and the head; rebuild only when something moved.
  const inputMoved=Math.abs(smoothPull[0]-lastBuiltPull[0])>.004||Math.abs(smoothPull[1]-lastBuiltPull[1])>.004||Math.abs(smoothBank-lastBuiltBank)>.004||Math.abs(spread-lastBuiltSpread)>.002;
  if(inputMoved){lastBuiltPull[0]=smoothPull[0];lastBuiltPull[1]=smoothPull[1];lastBuiltBank=smoothBank;lastBuiltSpread=spread;}
  for(let i=0;i<2;i++){
   bridleAnchors[i].getWorldPosition(_bridle);
   saddleAnchor.worldToLocal(_bridle);
   const moved=_bridle.distanceToSquared(_lastBridle[i])>1e-4;
   if(moved)_lastBridle[i].copy(_bridle);
   if(moved||inputMoved)rebuildRein(i,smoothBank);
  }
  // Wingbeat thump fallback: detect the body bob turning upward (start of the power stroke)
  // from the dragon's height above its flight-state height. beat() from integration overrides.
  const parent=saddleAnchor.parent;
  if(parent){
   const bob=parent.position.y-((flight.alt||0)-(flight.distance||0)*0.04);
   const delta=bob-prevBob;
   if(prevBobDelta<0&&delta>=0&&elapsed-lastExternalBeat>2&&thumpTime>.35)thumpTime=0;
   prevBob=bob;prevBobDelta=delta;
  }
  thumpTime+=dt;
  const thumpK=thumpTime<.25?Math.sin(thumpTime/.25*Math.PI):0;
  const thumpY=-0.03*thumpK,thumpPitch=-0.6*Math.PI/180*thumpK;
  // Camera shake (hit feedback).
  let shakeX=0,shakeZ=0;
  if(shakeLeft>0){
   shakeLeft=Math.max(0,shakeLeft-dt);
   shakeTime+=dt;
   const amp=1.2*Math.PI/180*(shakeLeft/shakeDuration);
   const t=shakeTime*18;
   if(noise){shakeX=noise.noise(t,0.37)*amp;shakeZ=noise.noise(0.71,t)*amp;}
   else{shakeX=Math.sin(t*Math.PI*2)*amp;shakeZ=Math.sin(t*Math.PI*2*1.31+1.7)*amp;}
  }
  // Eye: rider looks down over the neck, counter-leans the bank, leads the steering.
  eye.rotation.x=EYE_TILT+pitch*0.35+thumpPitch+shakeX;
  eye.rotation.z=-roll*0.38+shakeZ;
  eye.rotation.y=-yaw*0.45+clamp(steeringLead*0.01,-.12,.12);
  eye.position.y=1.12+Math.sin(elapsed*0.9)*0.012+thumpY;
 }

 function beat(){lastExternalBeat=elapsed;thumpTime=0;}
 function shake(seconds=.4){shakeLeft=shakeDuration=Math.max(.05,seconds);shakeTime=0;}
 function setSteeringLead(v){steeringLead=v||0;}
 function setReinColor(name){rope.color.set(REIN_COLORS[name]!==undefined?REIN_COLORS[name]:name);}
 // Force the fist spread from a given frame aspect (width/height); null = read the camera on eye.
 function setAspect(v){forcedAspect=v===undefined?null:v;}

 return {group,eye,hands,reins,sleeves,fill,update,beat,shake,setSteeringLead,setReinColor,setAspect,materials:{leather,glove,rope,thread,cloth}};
}
