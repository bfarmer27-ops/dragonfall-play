// Dragon model for the rider-POV film build (SHARED CONTRACTS v1, module spec D1-D8).
// Everything here is authored in dragon-LOCAL units; createDragon() scales the group by 1.6 so
// the world dragon is ~16.7 m long with a 32 m wingspan. The rider (rider.js) hangs off
// saddleAnchor, which is scaled back down by 1/1.6 so rider geometry is authored in metres.
//
// Draw-call plan (all rigid parts are baked into as few meshes as possible):
//   body+neck+head       1 SkinnedMesh, 3 material groups (skin / armor / keratin), 7 neck bones
//   eyes                 1 mesh under the last neck bone
//   tail                 1 SkinnedMesh, 3 material groups, 9 bones (unchanged rig)
//   legs, claws, shoulder scale rows   3 merged meshes
//   each wing            3 merged meshes (bones, membrane, thumb)
import * as THREE from './vendor/three.module.js';
import {TIER} from './quality.js';

// ---------------------------------------------------------------------------------------------
// Geometry helpers (kept from the previous build; game.js uses mergeRigid for the gate rings).
// ---------------------------------------------------------------------------------------------

// Merge every direct child Mesh of `group` that shares a material into one Mesh so a whole
// prop costs one draw call. Skinned meshes are left alone. Materials are compared by identity,
// so assign the final material BEFORE calling this (trap T2).
export function mergeRigid(group){
 const batches=new Map();
 for(const mesh of group.children.filter(c=>c.isMesh&&!c.isSkinnedMesh)){
  if(!batches.has(mesh.material))batches.set(mesh.material,[]);
  batches.get(mesh.material).push(mesh);
 }
 for(const [material,meshes] of batches){
  if(meshes.length<2)continue;
  const data={position:[],normal:[],uv:[],color:[]};
  for(const mesh of meshes){
   mesh.updateMatrix();
   let g=mesh.geometry.clone().applyMatrix4(mesh.matrix);
   if(g.index){const n=g.toNonIndexed();g.dispose();g=n;}
   for(const key in data){
    const count=g.attributes.position.count,size=key==='uv'?2:3,a=g.attributes[key];
    if(a)for(const v of a.array)data[key].push(v);
    else for(let i=0;i<count*size;i++)data[key].push(key==='color'?1:0);
   }
   g.dispose();
   group.remove(mesh);
  }
  const geo=new THREE.BufferGeometry();
  for(const key in data)geo.setAttribute(key,new THREE.Float32BufferAttribute(data[key],key==='uv'?2:3));
  group.add(new THREE.Mesh(geo,material));
 }
}

function geometry(pos,indices,uv,colors){
 const g=new THREE.BufferGeometry();
 g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
 g.setIndex(indices);
 if(uv)g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
 if(colors)g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
 g.computeVertexNormals();
 return g;
}

// Body profile: [z, halfWidth, halfHeight, centreY] stations from the snout (z=-7.6) to the
// tail root (z=+2.85). Smoothstep blending between stations keeps the loft free of creases.
export const BODY_PROFILE=[
 [-7.6,.12,.10,.56],[-7.2,.46,.32,.60],[-6.5,.70,.56,.66],[-5.8,.44,.46,.52],[-4.6,.46,.48,.34],
 [-3.3,.54,.56,.18],[-2.3,.66,.66,.08],[-1.6,.72,.70,.05],[-.65,1.15,.94,0],[.25,1.20,.9,-.06],
 [1.3,.9,.69,-.1],[2.3,.6,.48,-.12],[2.85,.44,.38,-.12]
];

// Cross-section of the body at dragon-local z: {w: half width, h: half height, y: centre height}.
// rider.js uses this to wrap the girth straps around the loft.
export function profileAt(z,profile=BODY_PROFILE){
 let k=0;
 while(k<profile.length-2&&z>profile[k+1][0])k++;
 const a=profile[k],b=profile[k+1];
 let t=THREE.MathUtils.clamp((z-a[0])/(b[0]-a[0]),0,1);
 t=t*t*(3-2*t);
 return {w:a[1]+(b[1]-a[1])*t,h:a[2]+(b[2]-a[2])*t,y:a[3]+(b[3]-a[3])*t};
}

// Loft a tube of elliptical rings along z. UV: u = angle*2, v = ring*2.8 (the texture repeat is
// set on the maps). Vertex colour carries a warm belly tint (vertexColors on the skin material).
function loft(profile,rings=120,sides=32){
 const pos=[],uv=[],idx=[],colors=[];
 const z0=profile[0][0],z1=profile[profile.length-1][0];
 for(let i=0;i<=rings;i++){
  const z=z0+(z1-z0)*i/rings;
  const {w,h,y}=profileAt(z,profile);
  for(let j=0;j<=sides;j++){
   const angle=j/sides*Math.PI*2,upper=Math.sin(angle);
   pos.push(Math.cos(angle)*w,y+upper*h,z);
   uv.push(j/sides*2,i/rings*2.8);
   const belly=Math.max(0,-upper);
   colors.push(.88+belly*.12,.88+belly*.07,.87-belly*.02);
   if(i<rings&&j<sides){
    const n=i*(sides+1)+j;
    idx.push(n,n+1,n+sides+1,n+1,n+sides+2,n+sides+1);
   }
  }
 }
 return geometry(pos,idx,uv,colors);
}

// A tube along a Catmull-Rom curve whose radius tapers linearly from r0 to r1 (horns, spikes,
// legs, wing fingers).
export function taperedTube(points,r0,r1,segments=18,sides=10){
 const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));
 const g=new THREE.TubeGeometry(curve,segments,1,sides,false);
 const a=g.attributes.position;
 for(let i=0;i<=segments;i++){
  const c=curve.getPointAt(i/segments),r=r0+(r1-r0)*i/segments;
  for(let j=0;j<=sides;j++){
   const n=i*(sides+1)+j;
   a.setXYZ(n,c.x+(a.getX(n)-c.x)*r,c.y+(a.getY(n)-c.y)*r,c.z+(a.getZ(n)-c.z)*r);
  }
 }
 g.computeVertexNormals();
 return g;
}

// Shield-shaped dorsal plate, unit size, +z is the plate's trailing point.
function plateGeometry(){
 return geometry(
  [0,.22,-.47, -.43,0,-.09, -.36,.015,.35, 0,.10,.60, .36,.015,.35, .43,0,-.09, 0,.33,.05],
  [0,1,6, 1,2,6, 2,3,6, 3,4,6, 4,5,6, 5,0,6, 0,5,1, 1,5,4, 1,4,2, 2,4,3],
  [.5,0, 0,.32, .06,.83, .5,1, .94,.83, 1,.32, .5,.5]);
}

// Bake several rigid parts into ONE skinned geometry with material groups. Each part is
// {geometry, matrix, material, weightZ}: the geometry is transformed by matrix into the skinned
// mesh's space; weightFn(z) -> [boneA, boneB, wA, wB] assigns bone weights. When weightZ is a
// number the whole part shares the weights of that z (so a horn stays rigid); otherwise each
// vertex uses its own z (smooth neck bend).
function bakeSkinned(parts,weightFn){
 const materials=[];
 for(const p of parts)if(!materials.includes(p.material))materials.push(p.material);
 const data={position:[],normal:[],uv:[],color:[],skinIndex:[],skinWeight:[]};
 const groups=[];
 for(const material of materials){
  const start=data.position.length/3;
  for(const part of parts){
   if(part.material!==material)continue;
   let g=part.geometry.clone();
   if(part.matrix)g.applyMatrix4(part.matrix);
   if(g.index){const n=g.toNonIndexed();g.dispose();g=n;}
   const count=g.attributes.position.count;
   for(const key of ['position','normal','uv','color']){
    const size=key==='uv'?2:3,a=g.attributes[key];
    if(a)for(const v of a.array)data[key].push(v);
    else for(let i=0;i<count*size;i++)data[key].push(key==='color'?1:0);
   }
   const pos=g.attributes.position;
   for(let i=0;i<count;i++){
    const z=part.weightZ!==undefined?part.weightZ:pos.getZ(i);
    const [a,b,wa,wb]=weightFn(z);
    data.skinIndex.push(a,b,0,0);
    data.skinWeight.push(wa,wb,0,0);
   }
   g.dispose();
  }
  const end=data.position.length/3;
  if(end>start)groups.push({start,count:end-start,materialIndex:materials.indexOf(material)});
 }
 const geo=new THREE.BufferGeometry();
 geo.setAttribute('position',new THREE.Float32BufferAttribute(data.position,3));
 geo.setAttribute('normal',new THREE.Float32BufferAttribute(data.normal,3));
 geo.setAttribute('uv',new THREE.Float32BufferAttribute(data.uv,2));
 geo.setAttribute('color',new THREE.Float32BufferAttribute(data.color,3));
 geo.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(data.skinIndex,4));
 geo.setAttribute('skinWeight',new THREE.Float32BufferAttribute(data.skinWeight,4));
 for(const g of groups)geo.addGroup(g.start,g.count,g.materialIndex);
 return {geometry:geo,materials};
}

// A part descriptor for bakeSkinned with a position / rotation (Euler xyz) / scale placement.
function placed(geo,material,position,rotation,scale,weightZ){
 const m=new THREE.Matrix4();
 const q=new THREE.Quaternion();
 if(rotation)q.setFromEuler(new THREE.Euler(rotation[0],rotation[1],rotation[2]));
 m.compose(new THREE.Vector3(...(position||[0,0,0])),q,new THREE.Vector3(...(scale||[1,1,1])));
 return {geometry:geo,matrix:m,material,weightZ};
}

// ---------------------------------------------------------------------------------------------
// GLSL hooks
// ---------------------------------------------------------------------------------------------

// Breathing: the rib cage under the seat rises ~5 cm (local) with uBreath. Applied to skin, armor
// and keratin alike so the dorsal plates and their spikes stay glued to the body.
const BREATH_VERTEX=`
#include <begin_vertex>
transformed.y += uBreath * 0.05 * smoothstep(-2.5, 1.5, position.z) * smoothstep(0.0, 0.4, normal.y);`;

// Macro colour variation for the skin (high tier only): 2-octave value noise in OBJECT space so
// the blotches ride with the dragon instead of crawling as it flies, plus a darker dorsal stripe.
const SKIN_NOISE_GLSL=`
varying vec3 vObjPos;
varying vec3 vObjNormal;
float vhash(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vnoise(vec3 p){
 vec3 i = floor(p), f = fract(p);
 f = f * f * (3.0 - 2.0 * f);
 return mix(
  mix(mix(vhash(i), vhash(i + vec3(1,0,0)), f.x), mix(vhash(i + vec3(0,1,0)), vhash(i + vec3(1,1,0)), f.x), f.y),
  mix(mix(vhash(i + vec3(0,0,1)), vhash(i + vec3(1,0,1)), f.x), mix(vhash(i + vec3(0,1,1)), vhash(i + vec3(1,1,1)), f.x), f.y),
  f.z);
}`;

// ---------------------------------------------------------------------------------------------
// createDragon
// ---------------------------------------------------------------------------------------------
export function createDragon(renderer){
 const high=TIER==='high';   // read at call time so a dev page can pick the tier first
 const dragon=new THREE.Group();
 dragon.rotation.order='YXZ';
 dragon.scale.setScalar(1.6);

 // ---- textures (import.meta.url so dev pages under dist/dev/ resolve the same files; trap T1)
 const loader=new THREE.TextureLoader();
 const maxAniso=Math.min(8,renderer.capabilities.getMaxAnisotropy());
 const mapSize=high?'1k':'512';
 function tex(url,srgb){
  const t=loader.load(url);
  t.wrapS=t.wrapT=THREE.RepeatWrapping;
  t.anisotropy=maxAniso;
  t.repeat.set(1.6,3.2);   // ~1.5 m tiles at the neck (16 scales per tile = 9 cm scales), ~20 cm on the shoulders
  if(srgb)t.colorSpace=THREE.SRGBColorSpace;
  return t;
 }
 const albedo=tex(new URL('./dragon-scales.webp',import.meta.url).href,true);
 const normalMap=tex(new URL('./assets/dragon-scales_nor_gl_'+mapSize+'.jpg',import.meta.url).href,false);
 const armMap=tex(new URL('./assets/dragon-scales_arm_'+mapSize+'.jpg',import.meta.url).href,false);

 // ---- shared uniforms
 const flex={value:0};                          // wing tip bend (pose.tip)
 const uBreath={value:0};
 const uTime={value:0};
 const uFlutter={value:0};
 const uSunDir={value:new THREE.Vector3(-0.18,0.21,-0.90).normalize()};   // mirrors sky.js SUN_DIRECTION; game.js calls setSun()
 const uSunColor={value:new THREE.Color(0xffd7a8).multiplyScalar(3.2)};
 const uTranslucency={value:high?.9:1.1};

 function breathHook(shader){
  shader.uniforms.uBreath=uBreath;
  shader.vertexShader=shader.vertexShader
   .replace('#include <common>','#include <common>\nuniform float uBreath;')
   .replace('#include <begin_vertex>',BREATH_VERTEX);
 }
 // Rim light for the skin materials on both tiers. The sun is AHEAD of the dragon, so from the saddle
 // the rider only sees the unlit back of the neck; a grazing-angle term in the sun colour draws the
 // silhouette edge the way the v066 frames do (dark neck with a bright rim, scales still readable).
 const RIM_GLSL=`#include <lights_fragment_end>
{
 float rim = pow(1.0 - saturate(dot(normal, geometryViewDir)), 3.0);
 reflectedLight.directSpecular += uSunColor * 0.12 * rim;
}`;
 function rimHook(shader){
  shader.uniforms.uSunColor=uSunColor;
  shader.fragmentShader=shader.fragmentShader
   .replace('#include <common>','#include <common>\nuniform vec3 uSunColor;')
   .replace('#include <lights_fragment_end>',RIM_GLSL);
 }
 function skinHook(shader){
  breathHook(shader);
  rimHook(shader);
  if(!high)return;
  shader.vertexShader=shader.vertexShader
   .replace('#include <common>','#include <common>\n'+SKIN_NOISE_GLSL)
   .replace('#include <beginnormal_vertex>','#include <beginnormal_vertex>\nvObjNormal = objectNormal;\nvObjPos = position;');
  shader.fragmentShader=shader.fragmentShader
   .replace('#include <common>','#include <common>\n'+SKIN_NOISE_GLSL)
   .replace('#include <color_fragment>',`#include <color_fragment>
 float macro = vnoise(vObjPos * 0.9) * 0.65 + vnoise(vObjPos * 2.1 + 7.3) * 0.35;
 diffuseColor.rgb *= 0.85 + 0.25 * macro;
 // Upward-facing skin is what the rider looks at and it faces the sky fill: lift it a little (it used to be
 // darkened by 0.7, which is why the neck read as a black tube from the saddle).
 diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.12, smoothstep(0.3, 0.9, normalize(vObjNormal).y));`);
 }

 // ---- materials (assigned at creation so the bakes batch by material; trap T2)
 const skin=new THREE.MeshPhysicalMaterial({
  color:0x7a8a78,map:albedo,normalMap,normalScale:new THREE.Vector2(1.7,1.7),   // was 0x5a6a5c (~13% linear): unreadable from the saddle
  roughnessMap:armMap,roughness:1,aoMap:armMap,aoMapIntensity:.9,metalness:0,
  clearcoat:.32,clearcoatRoughness:.45,clearcoatNormalMap:normalMap,clearcoatNormalScale:new THREE.Vector2(1.7,1.7),
  sheen:high?.25:0,sheenColor:new THREE.Color(0x3d5a4a),sheenRoughness:.6,
  vertexColors:true,emissive:new THREE.Color(0x7a1a0e),emissiveIntensity:0
 });
 skin.onBeforeCompile=skinHook;
 skin.customProgramCacheKey=()=>'dragon-skin-'+(high?'high':'phone');
 const armor=new THREE.MeshPhysicalMaterial({
  color:0x5f6c5f,map:albedo,normalMap,normalScale:new THREE.Vector2(1,1),
  roughnessMap:armMap,roughness:1,aoMap:armMap,aoMapIntensity:.9,metalness:0,
  clearcoat:.4,clearcoatRoughness:.4,clearcoatNormalMap:normalMap,clearcoatNormalScale:new THREE.Vector2(1,1)
 });
 armor.onBeforeCompile=shader=>{breathHook(shader);rimHook(shader);};
 armor.customProgramCacheKey=()=>'dragon-armor';
 // Dark keratin for horns, spikes, claws and the jaw ridge. Never ivory (bright horns were the
 // worst thing in the prototype shots).
 const keratin=new THREE.MeshPhysicalMaterial({color:0x2e2a25,roughness:.42,metalness:0,clearcoat:.5,clearcoatRoughness:.3});
 keratin.onBeforeCompile=breathHook;
 keratin.customProgramCacheKey=()=>'dragon-keratin';
 const limbSkin=new THREE.MeshPhysicalMaterial({
  color:0x6e7e6c,map:albedo,normalMap,normalScale:new THREE.Vector2(1.5,1.5),
  roughnessMap:armMap,roughness:1,aoMap:armMap,aoMapIntensity:.9,metalness:0,
  clearcoat:.32,clearcoatRoughness:.45,clearcoatNormalMap:normalMap,clearcoatNormalScale:new THREE.Vector2(1.5,1.5)
 });
 limbSkin.onBeforeCompile=rimHook;
 limbSkin.customProgramCacheKey=()=>'dragon-limb';
 const membrane=new THREE.MeshPhysicalMaterial({
  // 0x6e5646 (was 0x4b3b33, black from the saddle): dark warm membrane that still shows its veins and sag in the fill.
  color:0x6e5646,roughness:.75,metalness:0,side:THREE.DoubleSide,vertexColors:true,
  sheen:high?1.0:0,sheenColor:new THREE.Color(0xd98a55),sheenRoughness:.55
 });
 const eyeMat=new THREE.MeshStandardMaterial({color:0xc9d28d,emissive:0x6a7a2a,emissiveIntensity:.6,roughness:.3});

 // Wing deformation shared by the membrane, the wing bones and their shadow (depth) materials:
 // tip bend (uBend) + high-speed flutter along the outer half of the span.
 function flexVertex(shader){
  shader.uniforms.uBend=flex;
  shader.uniforms.uTime=uTime;
  shader.uniforms.uFlutter=uFlutter;
  shader.vertexShader=shader.vertexShader
   .replace('#include <common>',`#include <common>
uniform float uBend; uniform float uTime; uniform float uFlutter;
mat3 bendMatrix(float a){ float c = cos(a), s = sin(a); return mat3(c, s, 0., -s, c, 0., 0., 0., 1.); }`)
   .replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
float bendAngle = uBend * smoothstep(2.9, 9.9, position.x);
objectNormal = bendMatrix(bendAngle) * objectNormal;`)
   .replace('#include <begin_vertex>',`#include <begin_vertex>
float bendPos = uBend * smoothstep(2.9, 9.9, position.x);
transformed = bendMatrix(bendPos) * (transformed - vec3(2.9, .38, -.9)) + vec3(2.9, .38, -.9);
transformed.y += sin(position.x * 1.4 - uTime * 9.0) * 0.04 * smoothstep(3.0, 10.0, position.x) * uFlutter;`);
 }
 // Membrane: flex + sun shining THROUGH the wing. `normal` at this point is the view-space
 // geometric normal already flipped to face the camera (normal_fragment_begin, DOUBLE_SIDED), so
 // "sun behind the wing" is simply dot(-normal, sunInViewSpace). vColor.r is the thickness code
 // written by the membrane vertex colours (high = thin sagging centre); vColor.g darkens veins.
 function membraneShader(shader){
  flexVertex(shader);
  shader.uniforms.uSunDir=uSunDir;
  shader.uniforms.uSunColor=uSunColor;
  shader.uniforms.uTranslucency=uTranslucency;
  shader.fragmentShader=shader.fragmentShader
   .replace('#include <common>','#include <common>\nuniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uTranslucency;')
   .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor *= 0.8 + 0.4 * vColor.g;')
   .replace('#include <lights_fragment_end>',RIM_GLSL)   // same sun rim as the skin (uSunColor is declared above)
   .replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
{
 vec3 sunView = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
 float back = pow(max(dot(-normal, sunView), 0.0), 1.5);
 float thin = smoothstep(0.55, 0.9, vColor.r);
 totalEmissiveRadiance += uSunColor * uTranslucency * back * (0.18 + 0.36 * thin) * vec3(0.85, 0.40, 0.23);
}`);
 }
 membrane.onBeforeCompile=membraneShader;
 membrane.customProgramCacheKey=()=>'dragon-membrane-'+(high?'high':'phone');
 const wingBone=limbSkin.clone();
 wingBone.onBeforeCompile=flexVertex;
 wingBone.customProgramCacheKey=()=>'dragon-wingbone';

 function mesh(parent,g,mat){const m=new THREE.Mesh(g,mat);parent.add(m);return m;}
 function tube(parent,points,r0,r1,mat=limbSkin){return mesh(parent,taperedTube(points,r0,r1),mat);}
 const plate=plateGeometry();

 // ---- neck skeleton: bone0 at z=-1.6 owns the torso, bones 1..6 step 1.0 toward the snout.
 const NECK_Z0=-1.6,NECK_STEP=1.0,NECK_BONES=7;
 const bones=[];
 for(let i=0;i<NECK_BONES;i++){
  const b=new THREE.Bone();
  const z=NECK_Z0-i*NECK_STEP;
  const y=profileAt(z).y;
  if(i===0)b.position.set(0,y,z);
  else{b.position.set(0,y-profileAt(z+NECK_STEP).y,-NECK_STEP);bones[i-1].add(b);}
  bones.push(b);
 }
 const neckBones=bones.slice(1);
 function neckWeights(z){
  if(z>=NECK_Z0)return [0,1,1,0];
  const t=(NECK_Z0-z)/NECK_STEP;
  const i=Math.min(NECK_BONES-2,Math.floor(t));
  const f=Math.min(1,t-i);
  return [i,i+1,1-f,f];
 }

 // ---- body parts baked into the skinned body: loft, dorsal plates + spikes, horns, crest, jaw.
 const parts=[];
 parts.push({geometry:loft(BODY_PROFILE,120,32),material:skin});
 // Dorsal ridge: plates every .5 from the neck to the shoulders, none in the saddle zone
 // (-0.3..+1.8), spikes on every second plate kept under .28 so they never dominate the frame.
 for(let z=-6.2,i=0;z<-0.3;z+=.5,i++){
  const p=profileAt(z);
  const w=THREE.MathUtils.lerp(.3,.62,THREE.MathUtils.smoothstep(z,-5.5,-1.2));
  const y=p.y+p.h-.03;
  parts.push(placed(plate,armor,[0,y,z],null,[w,.66,w*.78],z));
  if(i%2===0){
   const h=Math.min(.28,.16+w*.18);
   parts.push({geometry:taperedTube([[0,y+.05,z],[0,y+h*.7,z+.06],[0,y+h,z+.22]],.06,.005,10,8),material:keratin,weightZ:z});
  }
 }
 // Head: two long back-swept horns, a fan of four short crest spikes, a jaw ridge underneath.
 const HEAD_Z=-6.6;
 for(const side of [-1,1]){
  parts.push({geometry:taperedTube([[side*.30,.60,-6.6],[side*.55,1.05,-6.1],[side*.80,1.40,-5.3]],.16,.02,18,10),material:keratin,weightZ:HEAD_Z});
  for(const fan of [0,.35]){
   const dir=new THREE.Vector3(side*(.35+fan),.75,.6).normalize();
   const start=new THREE.Vector3(side*.45,.55,-6.3);
   const mid=start.clone().addScaledVector(dir,.3),end=start.clone().addScaledVector(dir,.6);
   parts.push({geometry:taperedTube([start.toArray(),mid.toArray(),end.toArray()],.08,.01,8,8),material:keratin,weightZ:HEAD_Z});
  }
 }
 parts.push({geometry:taperedTube([[0,.06,-7.3],[0,.02,-6.7],[0,.06,-6.1]],.09,.04,10,8),material:keratin,weightZ:HEAD_Z});
 const baked=bakeSkinned(parts,neckWeights);
 const body=new THREE.SkinnedMesh(baked.geometry,baked.materials);
 body.add(bones[0]);
 dragon.add(body);
 body.bind(new THREE.Skeleton(bones));

 // ---- anchors that ride the neck (head bone = bones[6] at z=-7.6, so offsets are +z from it)
 const headBone=bones[NECK_BONES-1];
 const headBoneZ=NECK_Z0-(NECK_BONES-1)*NECK_STEP,headBoneY=profileAt(headBoneZ).y;
 const headAnchor=new THREE.Object3D();
 headAnchor.position.set(0,.55-headBoneY,HEAD_Z-headBoneZ);
 headBone.add(headAnchor);
 const bridleAnchors=[-1,1].map(side=>{
  const a=new THREE.Object3D();
  a.position.set(side*.55,.30-headBoneY,-6.4-headBoneZ);
  headBone.add(a);
  return a;
 });
 // Eyes: one merged mesh in a group so they can glance into turns.
 const eyes=new THREE.Group();
 eyes.position.set(0,.66-headBoneY,HEAD_Z-headBoneZ);
 headBone.add(eyes);
 for(const side of [-1,1]){
  const e=mesh(eyes,new THREE.SphereGeometry(1,12,8),eyeMat);
  e.position.set(side*.66,.08,0);
  e.scale.set(.09,.07,.14);
 }
 mergeRigid(eyes);

 // ---- shoulder scale rows, legs, claws (rigid, merged by material below)
 for(const side of [-1,1]){
  for(let row=0;row<2;row++)for(let i=0;i<12;i++){
   const z=-1.7+i*.32,w=.72+.35*Math.exp(-Math.pow(z/1.8,2));
   const m=mesh(dragon,plate,armor);
   m.position.set(side*w*(.53+row*.27),.61-row*.25,z);
   m.rotation.z=-side*(.58+row*.28);
   m.scale.set(.34,.28,.34);
  }
  tube(dragon,[[side*.8,-.1,.9],[side*1.13,-.65,1.35],[side*1.3,-.93,2.1],[side*1.16,-1.11,2.8]],.47,.19);
  tube(dragon,[[side*1.16,-1.11,2.8],[side*1.2,-1.13,3.17]],.26,.2);
  for(let toe=0;toe<4;toe++){
   const x=side*(.91+toe*.17);
   tube(dragon,[[x,-1.08,2.87],[x,-1.24,3.29],[x,-1.13,3.58]],.09,.025);
   tube(dragon,[[x,-1.13,3.55],[x,-1.04,3.85]],.055,.001,keratin);
  }
  tube(dragon,[[side*.77,-.3,-1.24],[side*1.05,-.84,-.78],[side*.8,-1.05,.05]],.24,.085);
 }

 // ---- tail: skinned tube with 9 bones; plates and spikes baked in with per-part weights.
 const tailRoot=new THREE.Group();
 tailRoot.position.set(0,-.12,2.53);
 dragon.add(tailRoot);
 const tailLength=8.3,tailRings=58,tailSides=18;
 const tp=[],tu=[],ti=[];
 for(let i=0;i<=tailRings;i++){
  const u=i/tailRings,r=.48*Math.pow(1-u,.82)+.015;
  for(let j=0;j<=tailSides;j++){
   const angle=j/tailSides*Math.PI*2;
   tp.push(Math.cos(angle)*r,Math.sin(angle)*r*.8,u*tailLength);
   tu.push(j/tailSides*1.1,u*3);
   if(i<tailRings&&j<tailSides){
    const n=i*(tailSides+1)+j;
    ti.push(n,n+1,n+tailSides+1,n+1,n+tailSides+2,n+tailSides+1);
   }
  }
 }
 const tailParts=[{geometry:geometry(tp,ti,tu),material:limbSkin}];
 for(let i=0;i<8;i++){
  const r=.48*Math.pow(1-i/8,.82),z=i*tailLength/8;
  tailParts.push(placed(plate,armor,[0,r*.75,z],null,[(1-i/9)*.63,.5,.73],z));
  tailParts.push({geometry:taperedTube([[0,r*.7,z],[0,r+.23,z+.2],[0,r+.28,z+.42]],.08*(1-i/10),.002,10,8),material:keratin,weightZ:z});
 }
 function tailWeights(z){
  const bone=THREE.MathUtils.clamp(z/tailLength*8,0,8),low=Math.min(7,Math.floor(bone)),f=bone-low;
  return [low,low+1,1-f,f];
 }
 const tailBaked=bakeSkinned(tailParts,tailWeights);
 const tailMesh=new THREE.SkinnedMesh(tailBaked.geometry,tailBaked.materials);
 const tailSegments=[];
 for(let i=0;i<9;i++){
  const b=new THREE.Bone();
  b.position.z=i?tailLength/8:0;
  if(i)tailSegments[i-1].add(b);
  tailSegments.push(b);
 }
 tailMesh.add(tailSegments[0]);
 tailRoot.add(tailMesh);
 tailMesh.bind(new THREE.Skeleton(tailSegments));

 // ---- wings (geometry unchanged from the accepted build)
 const wings=[];
 for(const side of [-1,1]){
  const wing=new THREE.Group();
  wing.position.set(side*.82,.21,-1.2);
  wing.scale.x=side;
  dragon.add(wing);
  wings.push(wing);
  const wrist=[2.9,.38,-.9];
  const tips=[[10,.1,-2.8],[7.9,-.13,.85],[5.5,-.19,2.95],[3.1,-.17,3.77],[.42,-.11,2.77]];
  tube(wing,[[0,0,0],[1.1,.37,-.05],wrist],.30,.18,wingBone);
  tube(wing,[wrist,[5.6,.43,-1.46],[8,.3,-2.13],tips[0]],.19,.012,wingBone);
  for(let k=1;k<tips.length;k++){
   const tip=tips[k];
   tube(wing,[wrist,[(wrist[0]+tip[0])*.5,.12,(wrist[2]+tip[2])*.5],tip],.095-k*.009,.012,wingBone);
  }
  // Membrane panels between the fingers. Vertex colour: r = thickness code (sagging centre is
  // thin and bright), veins darken r and g; g also roughens the veins in the shader.
  const pos=[],idx=[],uv=[],col=[];
  for(let panel=0;panel<tips.length-1;panel++){
   const a=new THREE.Vector3(...tips[panel]),b=new THREE.Vector3(...tips[panel+1]);
   const root=new THREE.Vector3(...wrist),mid=a.clone().add(b).multiplyScalar(.5).lerp(root,.24);
   const base=pos.length/3,nu=22,nv=14;
   for(let i=0;i<=nu;i++){
    const t=i/nu;
    const edge=a.clone().multiplyScalar((1-t)**2).addScaledVector(mid,2*t*(1-t)).addScaledVector(b,t*t);
    for(let j=0;j<=nv;j++){
     const r=j/nv,v=root.clone().lerp(edge,r);
     v.y-=Math.sin(Math.PI*r)*Math.sin(Math.PI*t)*.21;
     pos.push(v.x,v.y,v.z);
     uv.push(v.x*.1,v.z*.2);
     // 9 veins (6 on phone) across the 22 columns: the old 18 veins at power 24 could not be represented by 22
     // vertices and baked a moire crosshatch into the vertex colours (visible as shimmer on phone under FXAA).
     const vein=Math.pow(Math.abs(Math.sin(t*Math.PI*(high?9:6))),10)*.12;
     const sag=Math.sin(Math.PI*r)*Math.sin(Math.PI*t);
     col.push(.64+sag*.24-vein,.61+sag*.20-vein,.56+sag*.14-vein);
     if(i<nu&&j<nv){
      const n=base+i*(nv+1)+j;
      idx.push(n,n+1,n+nv+1,n+1,n+nv+2,n+nv+1);
     }
    }
   }
   tube(wing,[tips[panel],mid.toArray(),tips[panel+1]],.018,.014,wingBone);
  }
  mesh(wing,geometry(pos,idx,uv,col),membrane);
  // Hooked thumb on the leading edge (dark keratin).
  tube(wing,[wrist,[2.95,.74,-1.02],[3.1,.83,-1.42]],.14,.004,keratin);
  mergeRigid(wing);
 }

 // ---- saddle anchor: rider.js authors everything under it in metres.
 const SADDLE_Y=.79;
 const saddleAnchor=new THREE.Object3D();
 saddleAnchor.position.set(0,SADDLE_Y,.55);
 saddleAnchor.scale.setScalar(1/1.6);
 dragon.add(saddleAnchor);

 mergeRigid(dragon);
 dragon.traverse(m=>{if(m.isMesh){m.castShadow=true;m.receiveShadow=true;m.frustumCulled=false;}});
 // Mirror the wing deformation into the shadow pass or the shadow detaches from the wing (T4).
 for(const w of wings)w.traverse(m=>{
  if(!m.isMesh)return;
  m.customDepthMaterial=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,side:THREE.DoubleSide});
  m.customDepthMaterial.onBeforeCompile=flexVertex;
  m.customDepthMaterial.customProgramCacheKey=()=>'dragon-wing-depth';
 });

 // ---- per-frame state
 let hurtLeft=0,hurtDuration=1,lastTime=null;
 const TAU=Math.PI*2;

 // Head-leads / neck-follows / tail-lags chain. The flight sim rotates the whole dragon group at
 // once; this chain adds the follow-through a real animal shows. The head keeps a stable heading
 // and turns INTO a turn ahead of the body: its target angle is the static lead (-yaw*0.12) plus
 // a term from the yaw/pitch/roll RATE. Each neck segment tracks the segment ahead of it with a
 // slower damping the closer it is to the shoulders, so the neck bends progressively and settles
 // without overshoot; the tail trails the body the other way and settles last.
 // follow.neck[i] / follow.tail[i] are the cumulative angles of segment i relative to the body
 // (radians); follow.head is the head's angle relative to the body; follow.rate is the smoothed
 // body rotation rate in rad/s. setFollowGains() tunes it; game.js can read it for sound/FX.
 const follow={
  rate:{yaw:0,pitch:0,roll:0},
  head:{yaw:0,pitch:0,roll:0},
  neck:Array.from({length:NECK_BONES},()=>({yaw:0,pitch:0,roll:0})),
  tail:Array.from({length:tailSegments.length},()=>({yaw:0,pitch:0,roll:0})),
  gains:{leadYaw:.35,leadPitch:.30,leadRoll:.20,staticYaw:.12,staticPitch:.08,staticRoll:-.25,
         tailYaw:-.30,tailPitch:-.22,tailRoll:-.15,maxLead:.40,headK:12,neckK:5,tailK:9,tailLagK:.9,rateK:14}
 };
 let prevYaw=null,prevPitch=0,prevRoll=0;
 const AXES=['yaw','pitch','roll'];
 const wrapAngle=a=>Math.atan2(Math.sin(a),Math.cos(a));

 function stepFollow(yaw,pitch,roll,dt,realDt){
  const g=follow.gains;
  if(prevYaw!==null&&dt>0){
   const ry=wrapAngle(yaw-prevYaw)/realDt,rp=wrapAngle(pitch-prevPitch)/realDt,rr=wrapAngle(roll-prevRoll)/realDt;
   follow.rate.yaw=THREE.MathUtils.damp(follow.rate.yaw,THREE.MathUtils.clamp(ry,-6,6),g.rateK,dt);
   follow.rate.pitch=THREE.MathUtils.damp(follow.rate.pitch,THREE.MathUtils.clamp(rp,-6,6),g.rateK,dt);
   follow.rate.roll=THREE.MathUtils.damp(follow.rate.roll,THREE.MathUtils.clamp(rr,-6,6),g.rateK,dt);
  }
  prevYaw=yaw;prevPitch=pitch;prevRoll=roll;
  const targetYaw=THREE.MathUtils.clamp(-yaw*g.staticYaw-follow.rate.yaw*g.leadYaw,-g.maxLead,g.maxLead);
  const targetPitch=THREE.MathUtils.clamp(pitch*g.staticPitch-follow.rate.pitch*g.leadPitch,-g.maxLead,g.maxLead);
  const targetRoll=THREE.MathUtils.clamp(roll*g.staticRoll-follow.rate.roll*g.leadRoll,-g.maxLead,g.maxLead);
  const last=NECK_BONES-1,n=follow.tail.length;
  for(const ax of AXES){
   const target=ax==='yaw'?targetYaw:ax==='pitch'?targetPitch:targetRoll;
   // head first (fast), then each segment toward the shoulders follows the one ahead of it.
   // share(i) is the fraction of the head angle segment i should hold once settled (most of the
   // bend sits near the head).
   follow.head[ax]=THREE.MathUtils.damp(follow.head[ax],target,g.headK,dt);
   follow.neck[last][ax]=follow.head[ax];
   for(let i=last-1;i>=1;i--){
    const k=g.neckK+(g.headK-g.neckK)*(i/last);
    const share=Math.pow(i/last,1.3)/Math.pow((i+1)/last,1.3);
    follow.neck[i][ax]=THREE.MathUtils.damp(follow.neck[i][ax],follow.neck[i+1][ax]*share,k,dt);
   }
   follow.neck[0][ax]=0;
   // tail: trails the body rate the opposite way; each segment lags the one before it a bit more.
   const tailTarget=follow.rate[ax]*(ax==='yaw'?g.tailYaw:ax==='pitch'?g.tailPitch:g.tailRoll);
   for(let i=1;i<n;i++){
    const k=g.tailK*Math.pow(g.tailLagK,i);
    const ahead=i===1?tailTarget/(n-1):follow.tail[i-1][ax]/(i-1);
    follow.tail[i][ax]=THREE.MathUtils.damp(follow.tail[i][ax],ahead*i,k,dt);
   }
   follow.tail[0][ax]=0;
  }
 }
 function setFollowGains(patch){Object.assign(follow.gains,patch||{});}

 function update(pose,flight,l,r,time){
  const rawDt=lastTime===null?0:Math.max(0,time-lastTime);
  const dt=Math.min(.1,rawDt);
  lastTime=time;
  const yaw=flight.yaw||0,pitch=flight.pitch||0,roll=flight.roll||0;
  // Wings: sweep softened for the saddle view, tip bend from the pose.
  flex.value=pose.tip;
  for(let i=0;i<2;i++){
   const side=i===0?-1:1,input=i?r:l;
   // +0.14 rad (8 deg) rest lift so the leading edge crosses the rider frame at 35-45% height like the references.
   wings[i].rotation.z=side*(pose.sweep*0.6+input*0.09+0.14);
   wings[i].rotation.y=-side*pose.fold;
  }
  // Follow-through chain (head leads, neck follows, tail lags), then sway on top.
  stepFollow(yaw,pitch,roll,dt,Math.max(rawDt,1e-3));
  for(let i=0;i<tailSegments.length;i++){
   const prev=i?follow.tail[i-1]:follow.tail[0],cur=follow.tail[i];
   tailSegments[i].rotation.y=(cur.yaw-prev.yaw)+Math.sin(time*1.25-i*.36)*.024-roll*.014;
   tailSegments[i].rotation.x=(cur.pitch-prev.pitch)+.019+Math.sin(time*1.5-i*.25)*.015;
   tailSegments[i].rotation.z=(cur.roll-prev.roll);
  }
  for(let i=1;i<NECK_BONES;i++){
   const prev=follow.neck[i-1],cur=follow.neck[i];
   bones[i].rotation.y=(cur.yaw-prev.yaw)+Math.sin(time*0.7-i*0.3)*0.02;
   bones[i].rotation.x=(cur.pitch-prev.pitch)+Math.sin(time*1.5-i*0.25)*0.008;
   bones[i].rotation.z=(cur.roll-prev.roll);
  }
  // Breathing (rib cage under the seat) - the camera inherits it through saddleAnchor.
  uBreath.value=Math.sin(time*0.25*TAU)*.5+.5;
  saddleAnchor.position.y=SADDLE_Y+uBreath.value*0.05;
  // Membrane flutter above ~35 m/s (flight.speed is in world units incl. the 1.75 multiplier).
  uTime.value=time;
  const speed=flight.speed!==undefined?flight.speed:35*1.75;
  uFlutter.value=THREE.MathUtils.clamp((speed/1.75-35)/40,0,1);
  // Hurt pulse decays.
  if(hurtLeft>0){hurtLeft=Math.max(0,hurtLeft-dt);skin.emissiveIntensity=0.9*hurtLeft/hurtDuration;}
  else if(skin.emissiveIntensity!==0)skin.emissiveIntensity=0;
  // Eyes glance into the turn.
  eyes.rotation.y=THREE.MathUtils.clamp(-yaw*0.3,-.25,.25);
 }

 // World position of wing i's tip for the current pose (game.js draws streamers from it).
 function wingTip(i,pose){
  const angle=pose.tip,x=10-2.9,y=.1-.38;
  const p=new THREE.Vector3(Math.cos(angle)*x-Math.sin(angle)*y+2.9,Math.sin(angle)*x+Math.cos(angle)*y+.38,-2.8);
  return wings[i].localToWorld(p);
 }
 function setSun(direction,color){
  uSunDir.value.copy(direction).normalize();
  uSunColor.value.copy(color).multiplyScalar(3.2);
 }
 function setHurt(seconds){hurtLeft=hurtDuration=Math.max(.01,seconds);}

 return {
  dragon,wings,tailSegments,neckBones,saddleAnchor,headAnchor,bridleAnchors,
  materials:{skin,armor,keratin,membrane},
  update,wingTip,setSun,setHurt,follow,setFollowGains,profileAt
 };
}
