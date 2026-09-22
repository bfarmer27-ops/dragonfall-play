// Terrain: the canyon silhouette, the triplanar PBR rock material, the arch / boulder geometries and the chunk pool.
// Owns terrainHeight() so the collision test in game.js and the visible mesh agree.
// Three.js r169. No build step. Reads the shared graphics tier from quality.js AT CALL TIME (never at module top level)
// so a dev page can pick the tier before creating anything.
import * as THREE from 'three';
import {centerAt} from './flight.js';
import {TIER,BUDGET} from './quality.js';

export const worldSlope=.04,chunkLength=100,riverHalfWidth=65;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const smoothstep=(a,b,v)=>{const t=clamp((v-a)/(b-a),0,1);return t*t*(3-2*t);};
const hash=(a,b=0)=>{const n=Math.sin(a*127.1+b*311.7)*43758.5453;return n-Math.floor(n);};
// Value noise on the integer lattice, smooth-interpolated. Same family game.js used, kept so the canyon keeps its rhythm.
export function noise(x,z){
 const ix=Math.floor(x),iz=Math.floor(z),fx=x-ix,fz=z-iz,u=fx*fx*(3-2*fx),v=fz*fz*(3-2*fz);
 return lerp(lerp(hash(ix,iz),hash(ix+1,iz),u),lerp(hash(ix,iz+1),hash(ix+1,iz+1),u),v);
}
// 3D value noise (used for the deterministic vertex jitter on arches and boulders).
function noise3(x,y,z){
 const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z);
 const fx=x-ix,fy=y-iy,fz=z-iz,u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy),w=fz*fz*(3-2*fz);
 const h=(a,b,c)=>hash(a+c*57,b);
 const x0=lerp(lerp(h(ix,iy,iz),h(ix+1,iy,iz),u),lerp(h(ix,iy+1,iz),h(ix+1,iy+1,iz),u),v);
 const x1=lerp(lerp(h(ix,iy,iz+1),h(ix+1,iy,iz+1),u),lerp(h(ix,iy+1,iz+1),h(ix+1,iy+1,iz+1),u),v);
 return lerp(x0,x1,w);
}
// Musgrave ridged multifractal: sharp crests, each octave gated by the one below it. Gives real mountain ridgelines instead of blobs.
function ridged(x,z,octaves=4){
 let amp=1,freq=1,sum=0,weight=1;
 for(let o=0;o<octaves;o++){
  let n=1-Math.abs(noise(x*freq,z*freq)*2-1);
  n*=n;n*=weight;weight=clamp(n*2.2,0,1);
  sum+=n*amp;amp*=.52;freq*=2.05;
 }
 return sum;
}
// Canyon edge: distance from the center line where rock starts (same formula game.js collides with).
export function edgeAt(d){return 40+6*Math.sin(d*.014);}
// Rock spires stand just outside the river edge every ~140 m. Returns the extra height a spire adds at (x,d).
function spireAt(x,d){
 const cell=Math.floor(d/140);
 let h=0;
 for(let k=-1;k<=1;k++){
  const c=cell+k,r=hash(c,41);
  if(r<.45)continue;// only some cells own a spire
  const dc=(c+.5)*140+(hash(c,42)-.5)*60,side=hash(c,43)<.5?-1:1;
  const xc=centerAt(dc)+side*(edgeAt(dc)+6+hash(c,44)*22);
  const radius=5+hash(c,45)*6,height=35+hash(c,46)*70;
  const dist=Math.hypot(x-xc,(d-dc)*1.4);
  h+=height*Math.pow(smoothstep(radius,0,dist),1.6);
 }
 return h;
}
// Height of rock at world x and flown distance d. Below the river surface (-5) inside the channel.
// Pure CPU, deterministic, and the visible mesh only ever recedes AWAY from this profile (never toward the river),
// so game.js can use it as a conservative collision test.
export function terrainHeight(x,d){
 const a=Math.abs(x-centerAt(d)),edge=edgeAt(d);
 if(a<edge)return -5;
 const q=a-edge;
 const r=ridged(x*.0062+3.1,d*.0056,4);
 const macro=58+92*r+30*noise(x*.024,d*.025);
 const cliff=(1-Math.exp(-q*.04))*macro;
 // Stratified sandstone: pull the profile toward 11 m terraces on the lower wall so horizontal bands read from the saddle.
 const band=11,f=cliff/band,frac=f-Math.floor(f);
 const terrace=(Math.floor(f)+smoothstep(.55,.95,frac))*band;
 const strat=lerp(cliff,terrace,.45*smoothstep(0,30,q)*(1-smoothstep(120,220,cliff)));
 const detail=(noise(x*.16,d*.06)-.5)*3+(noise(x*.06,d*.018)-.5)*17;
 return 1+strat+Math.pow(q,.73)*.72+detail*Math.min(1,q/12)+spireAt(x,d);
}
// Builds one chunk of canyon as an indexed grid. Columns are dense near the river edge and sparse far out.
// Ledges: the wall recedes INTO the rock in noisy horizontal bands, so the band above it overhangs. Two band scales:
// a wide one (14 m deep, ~3 bands up the wall) and a narrow shelf band (5 m deep, ~9 bands). The rock never
// bulges toward the river, so terrainHeight() stays a safe (conservative) collision test.
// makeChunkBuilder(index, detail) builds the grid in row batches so the chunk pool can spread one chunk over several
// frames (each batch of rows is ~half the cost). step(rows) returns true when every row is done; finish() returns the geometry.
// Column layout across the canyon, shared by both LODs (same columns at both detail levels so neighbouring chunks share
// identical edge vertices and never crack). j runs 0..NX. Per side: the centre column is the river bed, one column sits
// under the water, the TOE column sits exactly on the canyon edge, and the remaining 72 columns climb the rock with a
// spacing that grows from ~0.6 m at the toe to ~13 m at 560 m out. The old layout spent 15 columns on the flat river bed
// and reached the wall with 4.4 m steps that jumped 20 m in height each, so ledges could not form and the smoothed
// normals of those huge steep triangles pulled the top-down texture projection onto the wall (vertical smearing).
const NX=150;
function columnAt(j,edge){
 const s=j-NX/2,sign=s<0?-1:1,m=Math.abs(s);
 if(m===0)return {sign,q:-edge};
 if(m===1)return {sign,q:-edge*.5};
 if(m===2)return {sign,q:0};
 const t=(m-2)/(NX/2-2);
 return {sign,q:Math.pow(t,1.6)*560};
}
export function makeChunkBuilder(index,detail='high'){
 const start=index*chunkLength;
 const nx=NX,nz=detail==='high'?30:14;
 // One padding row before and after the chunk so the smoothed normals at the seam match the neighbour's (no lighting seam).
 const rows=nz+3,positions=new Float32Array((nx+1)*rows*3);
 let k=-1,p=0;
 function step(maxRows=rows){
  for(let n=0;n<maxRows&&k<=nz+1;n++,k++){
   const d=start+k*chunkLength/nz;
   const center=centerAt(d),edge=edgeAt(d);
   for(let j=0;j<=nx;j++){
    const {sign,q}=columnAt(j,edge);
    let x=center+sign*(edge+q);
    // Under the water the bed is flat at -5; from the toe outward the mesh follows terrainHeight() exactly (the toe is
    // nudged 1 mm outward so floating-point rounding can never classify it as river), so the rock never bulges into the channel.
    const y=q<0?-5:terrainHeight(center+sign*(edge+Math.max(q,1e-3)),d);
    let yOut=y;
    if(q>0){
     const wallBand=smoothstep(0,18,q)*(1-smoothstep(45,110,q));
     // Wide band: ~30 m tall, ~110 m long. Narrow shelf: ~11 m tall, ~80 m long. Both recede only (never bulge).
     const lip=noise(y*.033+7.3,d*.009);
     const recess=smoothstep(.5,.8,lip)*wallBand;
     const shelf=noise(y*.09+3.1,d*.0125);
     const recess2=smoothstep(.55,.85,shelf)*smoothstep(0,12,q)*(1-smoothstep(45,110,q));
     // Spires keep their footprint: shifting a spire flank 14 m sideways would put visible rock up to 60 m above the
     // collision profile at the new x. Everything else only ever recedes into the wall (never toward the river).
     const onSpire=smoothstep(0,8,spireAt(x,d));
     const shift=(recess*14+recess2*5)*(1-onSpire);
     if(shift>0){
      x+=sign*shift;
      // Collision invariant: no mesh vertex is ever above terrainHeight() at its own x. Where the profile dips over the
      // shifted distance (a ridge crest or spire flank falling off), the vertex is lowered onto the profile instead.
      yOut=Math.min(y,terrainHeight(x,d));
     }
    }
    positions[p++]=x;positions[p++]=yOut-(d-start)*worldSlope;positions[p++]=-(d-start);
   }
  }
  return k>nz+1;
 }
 function finish(){
  const indices=[];
  for(let r=0;r<rows-1;r++)for(let j=0;j<nx;j++){const a=r*(nx+1)+j,b=a+nx+1;indices.push(a,a+1,b,b,a+1,b+1);}
  const padded=new THREE.BufferGeometry();
  padded.setAttribute('position',new THREE.BufferAttribute(positions,3));
  padded.setIndex(indices);
  padded.computeVertexNormals();
  // Trim the padding rows away; keep rows 1..nz+1 of the padded grid (the chunk's own nz+1 rows).
  const stride=(nx+1)*3,from=stride,to=stride*(nz+2);
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.BufferAttribute(positions.slice(from,to),3));
  geo.setAttribute('normal',new THREE.BufferAttribute(padded.attributes.normal.array.slice(from,to),3));
  const inner=[];for(let r=0;r<nz;r++)for(let j=0;j<nx;j++){const a=r*(nx+1)+j,b=a+nx+1;inner.push(a,a+1,b,b,a+1,b+1);}
  geo.setIndex(inner);
  padded.dispose();
  return geo;
 }
 return {step,finish,rows};
}
// Synchronous build of one chunk (creation and reset use this).
export function buildChunkGeometry(index,detail='high'){
 const b=makeChunkBuilder(index,detail);b.step();return b.finish();
}
// River strip in WORLD space covering `count` consecutive chunks from `firstIndex`: two columns per row, normals up.
// Waves live in the water normal map, not the mesh. One mesh for the whole pool costs 1 draw call instead of 23.
export function buildRiverGeometry(firstIndex,count=1,rowsPerChunk=30){
 const start=firstIndex*chunkLength,nz=rowsPerChunk*count,wp=[],wi=[];
 for(let k=0;k<=nz;k++){
  const d=start+k*chunkLength/rowsPerChunk,c=centerAt(d),y=-d*worldSlope,z=-d;
  wp.push(c-riverHalfWidth,y,z,c+riverHalfWidth,y,z);
  if(k<nz){const i=k*2;wi.push(i,i+1,i+2,i+2,i+1,i+3);}
 }
 const g=new THREE.BufferGeometry();
 g.setAttribute('position',new THREE.Float32BufferAttribute(wp,3));
 g.setIndex(wi);g.computeVertexNormals();
 return g;
}

// ---------------------------------------------------------------------------------------------------------------------
// Arch: the same curve game.js collides with (x -55..55, y = 66*(1-(x/55)^2), z wobble), as a thick 10 m tube with a
// smooth deterministic jitter so it reads as weathered rock. Drawn with terrain.rockMaterial (world-space triplanar, no UVs).
// geometry.userData.maxRadius = largest distance from any vertex to the curve, printed by the dev page so the
// integration agent can widen the ARCH GRAZE tolerance to match.
export function createArchGeometry(){
 const pts=[];
 for(let i=0;i<=16;i++){const x=-55+i*110/16;pts.push(new THREE.Vector3(x,66*(1-(x/55)**2),Math.sin(i*.9)*2));}
 const curve=new THREE.CatmullRomCurve3(pts);
 const geo=new THREE.TubeGeometry(curve,64,10,9,false);
 const ap=geo.attributes.position;
 // Jitter up to +-3 m from a low-frequency 3D value noise of the vertex position: lumps, not spikes.
 for(let i=0;i<ap.count;i++){
  const x=ap.getX(i),y=ap.getY(i),z=ap.getZ(i);
  ap.setXYZ(i,x+(noise3(x*.11,y*.11,z*.11)-.5)*6,y+(noise3(x*.11+9,y*.11,z*.11)-.5)*6,z+(noise3(x*.11,y*.11+17,z*.11)-.5)*6);
 }
 geo.computeVertexNormals();
 // Measure the real thickness: nearest curve sample per vertex.
 const samples=curve.getPoints(256);let maxR=0;
 for(let i=0;i<ap.count;i++){
  const x=ap.getX(i),y=ap.getY(i),z=ap.getZ(i);let best=1e9;
  for(const s of samples){const dd=(s.x-x)**2+(s.y-y)**2+(s.z-z)**2;if(dd<best)best=dd;}
  maxR=Math.max(maxR,Math.sqrt(best));
 }
 geo.userData.maxRadius=maxR;
 return geo;
}
// Boulder: game.js's tapered cylinder with the same per-vertex hash jitter, plus a 20% radial noise so the sides
// read as one lumpy rock instead of a faceted cone. game.js scales it by (radius/2, height, radius/2).
export function createBoulderGeometry(){
 const geo=new THREE.CylinderGeometry(1.4,2.8,1,7,4);
 const rp=geo.attributes.position;
 for(let i=0;i<rp.count;i++){
  const x=rp.getX(i)*(1+hash(i,9)*.4),z=rp.getZ(i)*(1+hash(i,2)*.4),y=rp.getY(i);
  const radial=1+(noise3(x*1.3+5,y*3.1,z*1.3)-.5)*.4;
  rp.setXYZ(i,x*radial,y,z*radial);
 }
 geo.computeVertexNormals();
 return geo;
}

// GLSL shared by the rock material: triplanar sampling with a "whiteout" normal blend (Ben Golus).
const rockGLSL=`
varying vec3 vWPos;varying vec3 vWNormal;
uniform sampler2D uDiff;uniform sampler2D uNor;uniform sampler2D uArm;
uniform float uTile;uniform float uDetailTile;uniform float uDetailMix;uniform float uHeightOffset;
vec3 triWeights(vec3 n){vec3 w=pow(abs(n),vec3(6.));return w/max(w.x+w.y+w.z,1e-4);}
vec4 tri(sampler2D t,vec3 p,vec3 w){return texture2D(t,p.zy)*w.x+texture2D(t,p.xz)*w.y+texture2D(t,p.xy)*w.z;}
vec3 triNormal(sampler2D t,vec3 p,vec3 w,vec3 n){
 vec3 tx=texture2D(t,p.zy).xyz*2.-1.;vec3 ty=texture2D(t,p.xz).xyz*2.-1.;vec3 tz=texture2D(t,p.xy).xyz*2.-1.;
 tx=vec3(tx.xy+n.zy,abs(tx.z)*n.x);ty=vec3(ty.xy+n.xz,abs(ty.z)*n.y);tz=vec3(tz.xy+n.xy,abs(tz.z)*n.z);
 return normalize(tx.zyx*w.x+ty.xzy*w.y+tz.xyz*w.z);
}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 float a=fract(sin(dot(i,vec2(127.1,311.7)))*43758.5453),b=fract(sin(dot(i+vec2(1,0),vec2(127.1,311.7)))*43758.5453);
 float c=fract(sin(dot(i+vec2(0,1),vec2(127.1,311.7)))*43758.5453),d=fract(sin(dot(i+vec2(1,1),vec2(127.1,311.7)))*43758.5453);
 return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}
`;
// Rock material: MeshStandardMaterial so it gets shadows, IBL, fog and tone mapping for free; the triplanar maps are spliced in.
// One CC0 texture set (cliff_side) is tinted three ways: dark wet basalt low, warm sandstone strata, moss on gentle ledges.
// Do NOT add fog code here: sky.js overrides the standard fog chunks and MeshStandardMaterial picks them up automatically.
// Options: textureSize ('1k'|'2k'), heightOffset (metres added to the height the tints read, so boulders can show the
// sandstone strata instead of the wet-basalt tint), textures ([diff, nor, arm] to share with another rock material).
export function createRockMaterial(renderer,{textureSize,heightOffset=0,textures}={}){
 const tier=TIER,budget=BUDGET[tier];
 textureSize=textureSize||budget.textureSize;
 const loader=new THREE.TextureLoader();
 // 16x anisotropy on high: the near wall is seen at a grazing angle from the saddle and blurs to a smear with less.
 const aniso=Math.min(tier==='high'?16:4,renderer.capabilities.getMaxAnisotropy());
 // Resolve against this module (dist/), not the page, so dev pages under dist/dev/ find the same files.
 const tex=(name,srgb)=>{const t=loader.load(new URL(`./assets/cliff_side_${name}_${textureSize}.jpg`,import.meta.url).href);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=aniso;if(srgb)t.colorSpace=THREE.SRGBColorSpace;return t;};
 const [diff,nor,arm]=textures||[tex('diff',true),tex('nor_gl',false),tex('arm',false)];
 const mat=new THREE.MeshStandardMaterial({color:0xffffff,roughness:1,metalness:0});
 mat.userData.uniforms={uDiff:{value:diff},uNor:{value:nor},uArm:{value:arm},uTile:{value:1/27},uDetailTile:{value:1/3.6},uDetailMix:{value:tier==='high'?1:0},uHeightOffset:{value:heightOffset}};
 mat.userData.textures=[diff,nor,arm];
 mat.onBeforeCompile=shader=>{
  Object.assign(shader.uniforms,mat.userData.uniforms);
  shader.defines=shader.defines||{};
  if(tier==='high')shader.defines.ROCK_DETAIL=1;
  shader.vertexShader=shader.vertexShader
   .replace('#include <common>','#include <common>\nvarying vec3 vWPos;varying vec3 vWNormal;')
   .replace('#include <worldpos_vertex>','#include <worldpos_vertex>\nvWPos=(modelMatrix*vec4(transformed,1.)).xyz;vWNormal=normalize(mat3(modelMatrix)*objectNormal);');
  shader.fragmentShader=shader.fragmentShader
   .replace('#include <common>','#include <common>\n'+rockGLSL)
   // Albedo: macro tile + fine tile, then the three tints by height, slope and strata.
   .replace('#include <map_fragment>',`
    vec3 gn=normalize(vWNormal);
    // Projection weights come from the TRUE face normal (screen derivatives) blended with the smooth vertex normal: on a
    // steep triangle the interpolated normal tilts upward near a ledge and would pull the top-down projection onto the
    // wall, which reads as vertical smearing from the saddle. The face normal keeps the side projection on the side faces.
    vec3 faceN=normalize(cross(dFdx(vWPos),dFdy(vWPos)));faceN*=sign(dot(faceN,gn)+1e-5);
    vec3 tw=triWeights(normalize(mix(gn,faceN,.65)));
    vec3 alb=tri(uDiff,vWPos*uTile,tw).rgb;
    #ifdef ROCK_DETAIL
     vec3 fine=tri(uDiff,vWPos*uDetailTile,tw).rgb;alb*=mix(vec3(1.),fine*1.9,.45*uDetailMix);
    #endif
    // Close-range layer (both tiers): within ~80 m of the eye the wall gets a third, 0.9 m tile of albedo and normal
    // so the near wall beside the saddle shows grain and ledges instead of one smeared macro texel.
    float viewDist=distance(vWPos,cameraPosition);
    float nearMix=smoothstep(90.,25.,viewDist)*.5;
    if(nearMix>.001){vec3 nearAlb=tri(uDiff,vWPos*(1./.9),tw).rgb;alb*=mix(vec3(1.),nearAlb*1.9,nearMix);}
    vec4 tArm=tri(uArm,vWPos*uTile,tw);
    float height=vWPos.y-vWPos.z*${worldSlope}+uHeightOffset;// height above the river, slope removed
    float slope=1.-gn.y;
    // Strata: bands warped by a low-frequency noise so they undulate, and only some regions of the canyon are banded
    // sandstone; the rest is massive dark basalt. Large-scale colour variation stops the "brick wall" look.
    float warp=vnoise(vec2(vWPos.x*.018,vWPos.z*.02))*.9+vnoise(vec2(vWPos.z*.05,vWPos.y*.4))*.25;
    float strata=smoothstep(.3,.7,fract(height*.06+warp));
    float banded=smoothstep(.42,.75,vnoise(vWPos.xz*.011+3.7));
    // Basalt .36 (was .25) and a lighter, thinner wet zone: the shaded near wall measured 2/255 (a black smear with no
    // strata) while the references keep visible stratified rock on the shadow side at every distance.
    vec3 sand=vec3(.60,.55,.50),basalt=vec3(.36,.36,.39),moss=vec3(.26,.40,.15);
    vec3 tint=mix(basalt,mix(basalt,sand,strata),smoothstep(170.,50.,height)*(banded*.6+.35)+.05);
    tint*=mix(.62,1.05,vnoise(vWPos.xz*.03+11.));
    float wet=1.-smoothstep(0.,14.,height);
    tint=mix(tint,vec3(.17,.19,.21),wet*.55);
    float mossy=smoothstep(.45,.15,slope)*smoothstep(90.,30.,height)*(1.-wet)*smoothstep(.4,.7,vnoise(vWPos.xz*.06));
    tint=mix(tint,moss,mossy);
    // The rims sit under the storm sky: darken the wall above 120 m so they never glow brighter than the sunlit mid-wall.
    tint*=1.-.35*smoothstep(120.,220.,height);
    // Overall albedo 15% below the first prototype: at exposure .82 with the 3.2 sun the sunlit sandstone was hotter than any reference.
    diffuseColor.rgb*=alb*tint*.96;
   `)
   .replace('#include <roughnessmap_fragment>',`
    float roughnessFactor=roughness*mix(.75,1.05,tArm.g);
    roughnessFactor=mix(roughnessFactor,.35,wet*.8);
    roughnessFactor=mix(roughnessFactor,.95,mossy);
   `)
   .replace('#include <normal_fragment_maps>',`
    vec3 wn=triNormal(uNor,vWPos*uTile,tw,gn);
    #ifdef ROCK_DETAIL
     vec3 wnFine=triNormal(uNor,vWPos*uDetailTile,tw,gn);wn=normalize(wn+wnFine*.5*uDetailMix);
    #endif
    if(nearMix>.001){vec3 wnNear=triNormal(uNor,vWPos*(1./.9),tw,gn);wn=normalize(wn+wnNear*nearMix);}
    normal=normalize((viewMatrix*vec4(wn,0.)).xyz);
   `)
   .replace('#include <aomap_fragment>',`
    float ambientOcclusion=mix(.6,1.,tArm.r)*mix(.72,1.,smoothstep(0.,26.,height));// floor .72 (was .55): keeps strata visible low on the shaded wall
    // Sky fill for the shadow side. The HDRI is a dim sunset (mean sky radiance well under 1) and three divides the
    // HemisphereLight by pi, so the wall facing away from the sun measured 0-16/255 against 40-60 in the references.
    // This is the blue-grey overcast sky the references show, weighted by how much sky the face sees (gn.y), not by pi.
    // 1.8 x the fill colour = sky radiance ~0.45 next to a 3.2 sun (an overcast sky): a vertical shaded wall with
    // albedo ~0.18 lands near 0.045 linear = ~40/255 after ACES, the reference level. At .30 it measured 9/255.
    reflectedLight.indirectDiffuse+=diffuseColor.rgb*vec3(.16,.25,.35)*.7*(.55+.45*gn.y);// .7 on top of the PMREM sky (sky.js skyBoost 2.5): shaded near wall ~25-35/255, references 40-60
    // Undersides of ledges see no sky: darken by the geometric normal's downward tilt (the HDRI's ground half is bright
    // sunset sand and would otherwise light them like a floor).
    ambientOcclusion*=mix(.42,1.,smoothstep(-.6,.2,gn.y));// .42, not .22: at .22 a 20 m arch underside was a black cut-out (v080 frame 3 shows it warm-lit)
    reflectedLight.indirectDiffuse*=ambientOcclusion;
    // Ground bounce: sunlit water and sand throw warm light up onto undersides (v080 frame 3: the arch's belly is warm,
    // not black). Strongest on down-facing rock in the lowest 100 m, fades with height; ~0.1 linear at most.
    float bounce=saturate(-gn.y*.8+.25)*(1.-smoothstep(60.,160.,height));
    reflectedLight.indirectDiffuse+=diffuseColor.rgb*vec3(.95,.78,.6)*.34*bounce;
    #if defined( USE_ENVMAP ) && defined( STANDARD )
     float dotNV=saturate(dot(geometryNormal,geometryViewDir));
     reflectedLight.indirectSpecular*=computeSpecularOcclusion(dotNV,ambientOcclusion,material.roughness);
    #endif
   `);
 };
 mat.customProgramCacheKey=()=>'rock-'+tier;   // heightOffset is a uniform, so one program serves walls and boulders
 return mat;
}

// Chunk pool. createTerrain({scene, renderer, water, chunkCount}) builds the rock material, fills chunks i=-2..chunkCount-3
// exactly like game.js (group at (0, -start*worldSlope, -start)) and returns the pool.
// update(distance) recycles a chunk when it is 170 m behind the rider (game.js rule) and upgrades near chunks to the
// dense grid. Geometry builds are spread over frames (a third of the rows per update() call), and a recycled chunk only
// moves once its new geometry exists, so nothing pops at the wrong place. The river strip is rebuilt on each move.
export function createTerrain({scene,renderer,water,chunkCount=23,lodFrom=9}){
 const rockMaterial=createRockMaterial(renderer);
 const waterMat=water.material;
 const chunks=[];
 // The river is ONE mesh spanning every chunk (1 draw call instead of 23). Its vertices are rebuilt in world space
 // whenever a chunk is recycled, so it always covers exactly the chunks that exist. It receives the dragon's shadow.
 const river=new THREE.Mesh(new THREE.BufferGeometry(),waterMat);
 river.name='river';river.receiveShadow=true;river.castShadow=false;river.frustumCulled=false;
 scene.add(river);
 function rebuildRiver(){
  let lo=Infinity,hi=-Infinity;
  for(const c of chunks){lo=Math.min(lo,c.index);hi=Math.max(hi,c.index);}
  if(!isFinite(lo))return;
  const geo=buildRiverGeometry(lo,hi-lo+1);
  river.geometry.dispose();river.geometry=geo;
 }
 // stats: fills = chunks completed, fillMs = total build time, steps = deferred work units, maxStepMs = worst single frame cost.
 const stats={fills:0,fillMs:0,steps:0,maxStepMs:0,get avgFillMs(){return this.fills?this.fillMs/this.fills:0;}};
 // Immediate, synchronous fill (used at creation and by reset()).
 function fill(slot,index,detail){
  const t0=performance.now();
  const geo=buildChunkGeometry(index,detail);
  commit(slot,index,detail,geo);
  stats.fills++;stats.fillMs+=performance.now()-t0;
 }
 function commit(slot,index,detail,geo){
  const moved=slot.index!==index;
  slot.index=index;slot.detail=detail;
  const start=index*chunkLength;
  slot.group.position.set(0,-start*worldSlope,-start);
  if(slot.terrain){slot.terrain.geometry.dispose();slot.terrain.geometry=geo;}
  // The rock does NOT receive the sun shadow map: the map is a tight +-24 m box around the dragon (so the dragon's shadow
  // on the water is sharp), and a wall crossing the box edge would show a hard lit/unlit seam. Wall shading comes from
  // the normal map, ARM occlusion and the height-based darkening instead.
  else{slot.terrain=new THREE.Mesh(geo,rockMaterial);slot.terrain.receiveShadow=false;slot.terrain.castShadow=false;slot.group.add(slot.terrain);}
  if(moved&&chunks.length===chunkCount)rebuildRiver();// during the initial fill the river is built once at the end
 }
 for(let i=-2;i<chunkCount-2;i++){const group=new THREE.Group();scene.add(group);const slot={group,index:i,terrain:null,detail:'high',job:null};chunks.push(slot);fill(slot,i,i<lodFrom?'high':'low');}
 rebuildRiver();
 // Deferred jobs: {slot,index,detail,builder,geo}. Each step() does ONE unit of work: a third of the rock rows (three
 // steps, the last one also builds normals), then the river strip + commit. A recycled chunk therefore moves 4 frames
 // after it fell behind the rider, which is invisible (it is 170 m back) and keeps the per-frame cost near a quarter of a fill.
 const jobs=[];
 function dropJob(slot){
  const job=slot.job;if(!job)return;
  jobs.splice(jobs.indexOf(job),1);job.geo&&job.geo.dispose();slot.job=null;
 }
 function enqueue(slot,index,detail){
  if(slot.job){if(slot.job.index===index&&slot.job.detail===detail)return;dropJob(slot);}
  const job={slot,index,detail,builder:null,geo:null};slot.job=job;jobs.push(job);
 }
 function step(){
  const job=jobs[0];if(!job)return;
  const t0=performance.now();
  if(!job.builder){job.builder=makeChunkBuilder(job.index,job.detail);job.builder.step(Math.ceil(job.builder.rows/3));}
  else if(!job.geo){if(job.builder.step(Math.ceil(job.builder.rows/3)))job.geo=job.builder.finish();}
  else{commit(job.slot,job.index,job.detail,job.geo);job.slot.job=null;jobs.shift();stats.fills++;}
  const ms=performance.now()-t0;stats.fillMs+=ms;stats.steps++;stats.maxStepMs=Math.max(stats.maxStepMs,ms);
 }
 function update(distance){
  const current=Math.floor(distance/chunkLength);
  for(const c of chunks){
   const target=c.job?c.job.index:c.index;
   if(target*chunkLength+chunkLength<distance-170){enqueue(c,target+chunkCount,'low');continue;}
   const wanted=target-current<lodFrom?'high':'low';
   const have=c.job?c.job.detail:c.detail;
   if(wanted!==have&&wanted==='high')enqueue(c,target,'high');
  }
  step();// one unit of work per frame
 }
 function reset(){
  for(const c of chunks)dropJob(c);
  for(let i=0;i<chunks.length;i++)fill(chunks[i],i-2,i-2<lodFrom?'high':'low');
  rebuildRiver();
 }
 function dispose(){
  for(const c of chunks){
   dropJob(c);
   c.terrain&&c.terrain.geometry.dispose();
   scene.remove(c.group);
  }
  chunks.length=0;
  river.geometry.dispose();scene.remove(river);
  for(const t of rockMaterial.userData.textures)t.dispose();
  rockMaterial.dispose();
 }
 return {chunks,river,update,reset,heightAt:terrainHeight,rockMaterial,stats,dispose};
}
