// Emerald Falls: finite, stationary scenery for the manually flown two-thumb course.
// Textures are CC0 photographs. World-space sampling keeps steep cliffs crisp.
import * as THREE from './vendor/three.module.js';
import {routeAt, FALL_START, FALL_END} from './waterfall-core.js?v=6';

const clamp = THREE.MathUtils.clamp;
const smooth = (a,b,x) => {const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const hash = (x,z=0) => {const v=Math.sin(x*127.1+z*311.7)*43758.5453;return v-Math.floor(v);};
function noise(x,z){const ix=Math.floor(x),iz=Math.floor(z),u=smooth(0,1,x-ix),v=smooth(0,1,z-iz);return THREE.MathUtils.lerp(THREE.MathUtils.lerp(hash(ix,iz),hash(ix+1,iz),u),THREE.MathUtils.lerp(hash(ix,iz+1),hash(ix+1,iz+1),u),v);}
const uphill = Array.from({length:501},(_,i)=>routeAt(i*5));
const lip=routeAt(FALL_START),exit=routeAt(FALL_END);
export const WATERFALL_RIVER_CLEARANCE=60;
export function valleyProfile(z){
 if(z>=0)return {x:0,y:42-WATERFALL_RIVER_CLEARANCE};
 if(z<lip.z){return {x:0,y:THREE.MathUtils.lerp(lip.y-WATERFALL_RIVER_CLEARANCE,exit.y-WATERFALL_RIVER_CLEARANCE,smooth(-lip.z+8,-lip.z+42,-z))};}
 let lo=0,hi=uphill.length-1;
 while(hi-lo>1){const m=(lo+hi)>>1;if(uphill[m].z>z)lo=m;else hi=m;}
 const a=uphill[lo],b=uphill[hi],t=clamp((z-a.z)/(b.z-a.z),0,1);
 return {x:THREE.MathUtils.lerp(a.x,b.x,t),y:THREE.MathUtils.lerp(a.y,b.y,t)-WATERFALL_RIVER_CLEARANCE};
}
export function riverWidth(z){return 64+35*Math.exp(-(((z+3140)/160)**2))+7*Math.sin(z*.004)**2;}
export function waterfallGroundHeight(x,z){
 const p=valleyProfile(z),a=Math.abs(x-p.x),w=riverWidth(z);
 if(a<w)return p.y-8+3*noise(x*.04,z*.04);
 const q=a-w;
 const bank=4+10*noise(x*.025,z*.025);
 const hill=(1-Math.exp(-q/90))*(70+145*noise(x*.005+9,z*.004)+60*noise(x*.014,z*.013));
 const peaks=150*Math.abs(Math.sin(z*.0023+x*.004))*smooth(150,550,q);
 return p.y+smooth(0,12,q)*bank+hill+peaks+noise(x*.07,z*.05)*4*smooth(0,18,q);
}

const triGLSL=`
 varying vec3 wPosition; varying vec3 wNormal;
 uniform sampler2D cliffColor, cliffNormal, cliffArm, groundColor, groundNormal, groundArm;
 vec3 weights(vec3 n){vec3 w=pow(abs(n),vec3(5.));return w/max(dot(w,vec3(1.)),.001);}
 vec3 sampleTri(sampler2D t,vec3 p,vec3 w){return texture2D(t,p.zy).rgb*w.x+texture2D(t,p.xz).rgb*w.y+texture2D(t,p.xy).rgb*w.z;}
 vec3 normalTri(sampler2D t,vec3 p,vec3 w,vec3 n){
  vec3 a=texture2D(t,p.zy).xyz*2.-1.,b=texture2D(t,p.xz).xyz*2.-1.,c=texture2D(t,p.xy).xyz*2.-1.;
  a=vec3(a.xy+n.zy,abs(a.z)*n.x);b=vec3(b.xy+n.xz,abs(b.z)*n.y);c=vec3(c.xy+n.xy,abs(c.z)*n.z);
  return normalize(a.zyx*w.x+b.xzy*w.y+c.xyz*w.z);
 }`;

export function createWaterfallEnvironment({group,renderer}){
 const pending=[],textures=[],materials=[],geometries=[];
 const loader=new THREE.TextureLoader();
 const tex=(name,color=false)=>{
  let resolve,reject;pending.push(new Promise((a,b)=>{resolve=a;reject=b;}));
  const t=loader.load(new URL('./assets/'+name,import.meta.url).href,resolve,undefined,reject);
  t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  if(color)t.colorSpace=THREE.SRGBColorSpace;textures.push(t);return t;
 };
 const maps={cliffColor:{value:tex('cliff_side_diff_2k.jpg',true)},cliffNormal:{value:tex('cliff_side_nor_gl_2k.jpg')},cliffArm:{value:tex('cliff_side_arm_2k.jpg')},groundColor:{value:tex('waterfall/aerial_grass_rock_diff_2k.jpg',true)},groundNormal:{value:tex('waterfall/aerial_grass_rock_nor_gl_2k.jpg')},groundArm:{value:tex('waterfall/aerial_grass_rock_arm_2k.jpg')}};
 const terrainMaterial=new THREE.MeshStandardMaterial({color:0xffffff,roughness:1,metalness:0,fog:true});
 terrainMaterial.onBeforeCompile=s=>{
  Object.assign(s.uniforms,maps);
  s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 wPosition;varying vec3 wNormal;').replace('#include <worldpos_vertex>','#include <worldpos_vertex>\nwPosition=(modelMatrix*vec4(transformed,1.)).xyz;wNormal=normalize(mat3(modelMatrix)*objectNormal);');
  s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\n'+triGLSL).replace('#include <map_fragment>',`
   vec3 gn=normalize(wNormal),face=normalize(cross(dFdx(wPosition),dFdy(wPosition)));face*=sign(dot(face,gn)+.0001);
   vec3 tw=weights(normalize(mix(gn,face,.65)));
   float grass=smoothstep(.45,.83,gn.y);
   vec3 stone=sampleTri(cliffColor,wPosition/18.,tw);
   vec3 meadow=sampleTri(groundColor,wPosition/14.,tw);
   float variation=.9+.15*sin(wPosition.x*.028+sin(wPosition.z*.033));
   diffuseColor.rgb*=mix(stone*vec3(.8,.83,.78),meadow*vec3(.78,1.05,.64),grass)*variation;
   vec3 arm=mix(sampleTri(cliffArm,wPosition/18.,tw),sampleTri(groundArm,wPosition/14.,tw),grass);
  `).replace('#include <roughnessmap_fragment>','float roughnessFactor=clamp(arm.g,.55,1.);').replace('#include <normal_fragment_maps>',`
   vec3 wn=normalize(mix(normalTri(cliffNormal,wPosition/18.,tw,gn),normalTri(groundNormal,wPosition/14.,tw,gn),grass));
   normal=normalize((viewMatrix*vec4(wn,0.)).xyz);
  `).replace('#include <aomap_fragment>','reflectedLight.indirectDiffuse*=mix(.7,1.,arm.r);');
 };
 terrainMaterial.customProgramCacheKey=()=> 'emerald-falls-terrain-v1';materials.push(terrainMaterial);
 function mesh(geo,mat,name){geometries.push(geo);const m=new THREE.Mesh(geo,mat);m.name=name;group.add(m);return m;}
 // Stable chunks exist at creation; no scenery is ever recycled or player-relative.
 const columns=Array.from({length:97},(_,i)=>{const s=(i-48)/48;return Math.sign(s)*Math.pow(Math.abs(s),1.6)*1550;});
 for(let chunk=0;chunk<24;chunk++){
  const start=400-chunk*260,nz=26,nx=columns.length-1,positions=[],indices=[],uv=[];
  for(let j=0;j<=nz;j++){const z=start-j*10,p=valleyProfile(z);for(const dx of columns){const x=p.x+dx;positions.push(x,waterfallGroundHeight(x,z),z);uv.push(x/18,z/18);}}
  for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){const a=j*(nx+1)+i,b=a+1,c=a+nx+1,d=c+1;indices.push(a,b,c,b,d,c);}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(indices);geo.computeVertexNormals();
  mesh(geo,terrainMaterial,'valley-rock-and-meadow-'+chunk);
 }
 const waterNormal=tex('water_normal_512.png');waterNormal.repeat.set(16,160);
 const fallNoise=tex('noise_512.png');
 const riverMat=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.2,metalness:.2,normalMap:waterNormal,normalScale:new THREE.Vector2(.65,.65),side:THREE.DoubleSide});materials.push(riverMat);
 riverMat.onBeforeCompile=s=>{
  s.uniforms.riverNoise={value:fallNoise};
  s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 riverWorld;').replace('#include <worldpos_vertex>','#include <worldpos_vertex>\nriverWorld=(modelMatrix*vec4(transformed,1.)).xyz;');
  s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 riverWorld;uniform sampler2D riverNoise;').replace('#include <map_fragment>',`
   float wave=sin(riverWorld.x*.34+sin(riverWorld.z*.24)*1.8)*sin(riverWorld.z*.37+sin(riverWorld.x*.23));
   float broadNoise=texture2D(riverNoise,riverWorld.xz*.007).r;
   float rippleNoise=texture2D(riverNoise,riverWorld.xz*vec2(.085,.21)+broadNoise*.05).r;
   float current=smoothstep(.64,.86,rippleNoise)*.018;
   float waterVariation=.5+.5*sin(riverWorld.z*.018+sin(riverWorld.x*.031)*2.);
   diffuseColor.rgb*=mix(vec3(.012,.12,.16),vec3(.025,.35,.31),waterVariation*.65+wave*.08)+vec3(.22,.36,.32)*current;
  `);
 };riverMat.customProgramCacheKey=()=> 'emerald-river-v1';
 // A continuous winding river rises with the upper valley and continues below the falls.
 for(const [start,end] of [[400,lip.z-24],[lip.z-43,-5900]]){
  const n=Math.ceil((start-end)/9),pos=[],uv=[],indices=[];
  for(let j=0;j<=n;j++){const z=THREE.MathUtils.lerp(start,end,j/n),p=valleyProfile(z),w=riverWidth(z);if(start===400&&z<lip.z)p.y=lip.y-WATERFALL_RIVER_CLEARANCE;for(const side of [-1,1]){pos.push(p.x+side*w,p.y,z);uv.push((side+1)/2,j/n);}}
  for(let j=0;j<n;j++){const a=j*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(indices);geo.computeVertexNormals();mesh(geo,riverMat,'stationary-river');
 }
 // Fixed waterfall ribbons, with bright streaks and gaps exposing the rock wall.
 const fallMat=new THREE.ShaderMaterial({side:THREE.DoubleSide,transparent:true,depthWrite:false,uniforms:{uNoise:{value:fallNoise}},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:`varying vec2 vUv;uniform sampler2D uNoise;void main(){float broad=texture2D(uNoise,vec2(vUv.x*1.8,vUv.y*.5)).r;float fine=texture2D(uNoise,vec2(vUv.x*15.+broad*.4,vUv.y*3.5)).r;float n=clamp(broad*.55+fine*.65,0.,1.);float edge=smoothstep(0.,.08,vUv.x)*smoothstep(0.,.08,1.-vUv.x);vec3 c=mix(vec3(.21,.52,.53),vec3(.95,1.,.98),smoothstep(.25,.78,n));gl_FragColor=vec4(c,edge*(.55+n*.4));\n#include <tonemapping_fragment>\n#include <colorspace_fragment>}`});materials.push(fallMat);
 const h=lip.y-exit.y;
 const curtain=mesh(new THREE.PlaneGeometry(106,h,1,1),fallMat,'waterfall-curtain');curtain.position.set(0,(lip.y+exit.y)/2-WATERFALL_RIVER_CLEARANCE,lip.z-24);
 // Broken foam patches mark the foot of the fall without resembling checkpoints.
 const foamMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{foamNoise:{value:fallNoise}},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:`varying vec2 vUv;uniform sampler2D foamNoise;void main(){vec2 p=(vUv-.5)*vec2(1.4,2.);float n=texture2D(foamNoise,vUv*3.5).r;float edge=1.-smoothstep(.3,.85,length(p)+n*.2);float a=edge*smoothstep(.38,.72,n)*.52;gl_FragColor=vec4(.78,.94,.88,a);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>}`});materials.push(foamMat);
 const foam=mesh(new THREE.PlaneGeometry(154,130),foamMat,'pool-foam');foam.rotation.x=-Math.PI/2;foam.position.set(0,exit.y-WATERFALL_RIVER_CLEARANCE+.2,lip.z-100);
 // Forest rendered in batches, keeping the route clear and phone draw calls low.
 const batches=Array.from({length:20},()=>[]),dummy=new THREE.Object3D();let treeCount=0;
 for(let i=0;i<850;i++){
  const z=300-hash(i,33)*6050,p=valleyProfile(z),side=i%2?1:-1,x=p.x+side*(90+hash(i,14)*720),y=waterfallGroundHeight(x,z);
  if(z<lip.z+35&&z>lip.z-70)continue;
  const slope=Math.abs(waterfallGroundHeight(x+3,z)-y)+Math.abs(waterfallGroundHeight(x,z+3)-y);if(slope>10)continue;
  const size=8+hash(i,8)*15;batches[Math.min(19,Math.floor((300-z)/303))].push({x,y,z,size,seed:i});treeCount++;
 }
 const bark=new THREE.MeshStandardMaterial({color:0x625d4c,roughness:1});
 const twigColor=tex('waterfall/fir_tree_01_twig_diff_2k.jpg',true),twigAlpha=tex('waterfall/fir_tree_01_twig_alpha_2k.png');
 // Alpha cards contain photographed needles, not opaque geometric crowns.
 const leaf=new THREE.MeshStandardMaterial({map:twigColor,alphaMap:twigAlpha,alphaTest:.4,side:THREE.DoubleSide,roughness:.9,color:0xffffff});materials.push(bark,leaf);
 const trunkGeo=new THREE.CylinderGeometry(.13,.32,1,6),leafGeo=new THREE.PlaneGeometry(1,1);geometries.push(trunkGeo,leafGeo);
 const tuv=leafGeo.attributes.uv;for(let i=0;i<tuv.count;i++)tuv.setXY(i,.64453125+tuv.getX(i)*.302734375,.619140625+tuv.getY(i)*.3486328125);
 batches.forEach((batch,bi)=>{
  if(!batch.length)return;
  const trees=new THREE.InstancedMesh(trunkGeo,bark,batch.length),leaves=new THREE.InstancedMesh(leafGeo,leaf,batch.length*12);
  batch.forEach((t,i)=>{
   dummy.position.set(t.x,t.y+t.size*.5,t.z);dummy.scale.set(t.size*.32,t.size,t.size*.32);dummy.rotation.set(0,0,0);dummy.updateMatrix();trees.setMatrixAt(i,dummy.matrix);
   for(let j=0;j<12;j++){
    const layer=Math.floor(j/4),a=j*Math.PI*.5+hash(t.seed,8)*6,width=t.size*(.85-layer*.19);
    dummy.position.set(t.x+Math.cos(a)*width*.18,t.y+t.size*(.38+layer*.22),t.z+Math.sin(a)*width*.18);
    dummy.scale.set(width,width*714/620,1);dummy.rotation.set(-.12,a+Math.PI*.5,(hash(j,t.seed)-.5)*.4);dummy.updateMatrix();leaves.setMatrixAt(i*12+j,dummy.matrix);
    leaves.setColorAt(i*12+j,new THREE.Color().setRGB(.72+hash(t.seed,2)*.2,.88+hash(t.seed,4)*.12,.7+hash(t.seed,3)*.2));
   }
  });
  trees.name='fixed-forest-trunks-'+bi;leaves.name='fixed-forest-needles-'+bi;trees.computeBoundingSphere();leaves.computeBoundingSphere();group.add(trees,leaves);
 });
 // Recognisable landmarks: pale stone arches at the approach, crest and exit.
 const stone=new THREE.MeshStandardMaterial({map:maps.cliffColor.value,normalMap:maps.cliffNormal.value,color:0xcbd1b0,roughness:.85});materials.push(stone);
 for(const d of [390,FALL_START-200,FALL_END+420]){
  const p=routeAt(d),points=[];for(let i=0;i<=32;i++){const a=Math.PI*i/32;points.push(new THREE.Vector3(Math.cos(a)*86,Math.sin(a)*105-32,0));}
  const g=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),48,6.5,8,false),m=mesh(g,stone,'landmark-stone-arch');m.position.set(p.x,p.y,p.z);
 }
 const ready=Promise.all(pending).then(()=>{group.userData.assetsReady=true;});
 // Attach an error handler now; start() still awaits the rejecting promise.
 ready.catch(e=>{group.userData.assetError=String(e?.message||e);});
 group.userData={...group.userData,forestTrees:treeCount,textureSize:2048,stationary:true};
 return {ready,terrainMaterial,textures,update(){},dispose(){for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();group.clear();}};
}

export function createWaterfallSky({scene,renderer}){
 const sunDirection=new THREE.Vector3(-.5,.82,.24).normalize(),sunColor=new THREE.Color(0xffefd2);
 const sunLight=new THREE.DirectionalLight(sunColor,3.0);sunLight.position.copy(sunDirection).multiplyScalar(1500);scene.add(sunLight,sunLight.target);
 const hemiLight=new THREE.HemisphereLight(0xc3e6ff,0x6d7950,2.3);scene.add(hemiLight);
 scene.fog=new THREE.FogExp2(0xb5d7d0,.00065);
 const mat=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,depthTest:false,uniforms:{sun:{value:sunDirection}},vertexShader:'varying vec3 ray;void main(){ray=position;vec4 p=projectionMatrix*mat4(mat3(viewMatrix))*vec4(position,1.);gl_Position=p.xyww;}',fragmentShader:`varying vec3 ray;uniform vec3 sun;
 float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
 float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
 void main(){vec3 d=normalize(ray);vec3 col=mix(vec3(.64,.82,.85),vec3(.12,.42,.72),pow(max(d.y,0.),.45));vec2 p=d.xz/max(.1,d.y)*1.1;float n=noise(p)*.55+noise(p*2.1)*.28+noise(p*4.2)*.14;float c=smoothstep(.55,.76,n)*smoothstep(.06,.25,d.y);col=mix(col,vec3(.94,.97,1.),c*.88);float s=max(dot(d,sun),0.);col+=vec3(1.,.86,.57)*pow(s,140.)*.5;gl_FragColor=vec4(col,1.);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>}`});
 const skyDome=new THREE.Mesh(new THREE.SphereGeometry(1,32,16),mat);skyDome.frustumCulled=false;skyDome.renderOrder=-100;skyDome.name='clear-day-sky';scene.add(skyDome);
 // Broad daylight reflection environment generated once; no cloud plane follows the player.
 const environmentScene=new THREE.Scene();environmentScene.background=new THREE.Color(0xb3d4e3);
 const floor=new THREE.Mesh(new THREE.SphereGeometry(10,16,8),new THREE.MeshBasicMaterial({color:0xb3d4e3,side:THREE.BackSide}));environmentScene.add(floor);
 const generator=new THREE.PMREMGenerator(renderer),target=generator.fromScene(environmentScene,.04,.1,100);scene.environment=target.texture;scene.environmentIntensity=.35;generator.dispose();floor.geometry.dispose();floor.material.dispose();
 return {sunDirection,sunColor,sunLight,hemiLight,skyDome,ready:Promise.resolve(),info:{environment:'Emerald Falls daylight'},update(){},dispose(){scene.remove(sunLight,sunLight.target,hemiLight,skyDome);skyDome.geometry.dispose();mat.dispose();target.dispose();}};
}
