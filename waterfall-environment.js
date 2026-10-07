// Emerald Falls: the stationary scenery of the Waterfall map (rebuilt 2026-10-06, round 2).
// Course: Sky Isles (floating islands over a cloud sea) -> a stone gate -> a forested sandstone gorge ->
// the 1,600 m fall into a stone amphitheatre -> a forest lake and the finish. Green vine-and-orb portals
// are the gates (createPortal), rock spires and stone totems the hazards (makeObstacleMesh).
// Textures and scanned models are Poly Haven CC0; leaves, mist, glow and the rainbow are drawn here.
// Anti-repeat: every rock and ground texture is sampled twice (a rotated, rescaled copy blended in by a
// slow noise mask) and swapped for a 95 m tile in the distance, so no tile pattern survives on the walls.
// Nothing is player-relative; nothing is recycled.
import * as THREE from './vendor/three.module.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createSky, setFogConstants, fogUniforms} from './sky.js';
import {TIER} from './quality.js';
import {routeAt, FALL_START, FALL_END, ARC_RADIUS, ROUTE_LENGTH, PRELUDE_LENGTH, HOLLOW_LENGTH, HOLLOW_MOUTH, HOLLOW_EXIT, WATERFALL_RIVER_CLEARANCE, ENTRY_TOP_Y} from './waterfall-core.js';
import {createHollow} from './hollow.js?v=2';

const clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hash = (x, z = 0) => { const v = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return v - Math.floor(v); };
export function noise(x, z) {
 const ix = Math.floor(x), iz = Math.floor(z), u = smooth(0, 1, x - ix), v = smooth(0, 1, z - iz);
 return lerp(lerp(hash(ix, iz), hash(ix + 1, iz), u), lerp(hash(ix, iz + 1), hash(ix + 1, iz + 1), u), v);
}
function ridged(x, z, octaves = 4) {
 let amp = 1, freq = 1, sum = 0, weight = 1;
 for (let o = 0; o < octaves; o++) {
  let n = 1 - Math.abs(noise(x * freq, z * freq) * 2 - 1);
  n *= n; n *= weight; weight = clamp(n * 2.2, 0, 1);
  sum += n * amp; amp *= .52; freq *= 2.05;
 }
 return sum;
}
function noise3(x, y, z) {
 const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
 const fx = x - ix, fy = y - iy, fz = z - iz, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
 const h = (a, b, c) => hash(a + c * 57, b);
 const x0 = lerp(lerp(h(ix, iy, iz), h(ix + 1, iy, iz), u), lerp(h(ix, iy + 1, iz), h(ix + 1, iy + 1, iz), u), v);
 const x1 = lerp(lerp(h(ix, iy, iz + 1), h(ix + 1, iy, iz + 1), u), lerp(h(ix, iy + 1, iz + 1), h(ix + 1, iy + 1, iz + 1), u), v);
 return lerp(x0, x1, w);
}

// ---------------------------------------------------------------------------------------------
// Layout. The flight starts at z = 0 on a ledge outside the mountain; the Hollow (hollow.js) runs to
// ISLES_Z, the Sky Isles float from ISLES_Z to GORGE_Z, where the gorge plateau begins.
// ---------------------------------------------------------------------------------------------
const lip = routeAt(FALL_START), exit = routeAt(FALL_END);
export const ISLES_Z = -HOLLOW_LENGTH;
export const GORGE_Z = -PRELUDE_LENGTH;
export const WORLD_START_Z = GORGE_Z + 320;             // the plateau's leading cliff rises out of the cloud sea here
export const FINISH_Z = routeAt(ROUTE_LENGTH).z;         // crossing this plane completes the course
export const WORLD_END_Z = FINISH_Z - 1400;              // closing hills continue well past the finish
export const CLOUD_SEA_Y = ENTRY_TOP_Y - 330;
const riverBendRadius = ARC_RADIUS - 60;   // 60 m clears the full ring plus the animated dragon's body
export const CURTAIN_Z = lip.z - riverBendRadius;
export const UPPER_WATER_Y = lip.y - WATERFALL_RIVER_CLEARANCE;
export const LOWER_WATER_Y = exit.y - WATERFALL_RIVER_CLEARANCE;
export const CURTAIN_TOP_Y = UPPER_WATER_Y - riverBendRadius;
export const LAKE_Z = routeAt(ROUTE_LENGTH - 650).z;

// The river wanders under the straight flight line, straightening before the lip and after the foot.
export function meander(z) {
 const wave = 28 * Math.sin(z * .0011 + 1.3) + 16 * Math.sin(z * .0027 + .4);
 if (z > CURTAIN_Z) return wave * smooth(lip.z + 60, lip.z + 380, z) * smooth(GORGE_Z - 60, GORGE_Z - 320, z);
 return wave * smooth(CURTAIN_Z - 90, CURTAIN_Z - 400, z);
}
export function valleyProfile(z) {
 if (z >= lip.z) return {x: meander(z), y: UPPER_WATER_Y};
 if (z >= CURTAIN_Z) { const forward = lip.z - z; return {x: 0, y: CURTAIN_TOP_Y + Math.sqrt(Math.max(0, riverBendRadius ** 2 - forward ** 2))}; }
 return {x: meander(z), y: LOWER_WATER_Y};
}
// Bends widen the river (the outer bank is cut back), which also keeps the straight flight line over water.
export function riverWidth(z) {
 return 64 + 35 * Math.exp(-(((z - exit.z) / 240) ** 2)) + 7 * Math.sin(z * .004) ** 2 + 110 * smooth(LAKE_Z + 500, LAKE_Z - 350, z) + .6 * Math.abs(meander(z));
}
function bankBase(z, q) {
 const p = valleyProfile(z);
 return z < lip.z && z > CURTAIN_Z ? lerp(p.y, UPPER_WATER_Y, smooth(0, 40, q)) : p.y;
}
export function waterfallGroundHeight(x, z) {
 const lower = z <= CURTAIN_Z;
 const p = lower ? {x: meander(z), y: LOWER_WATER_Y} : valleyProfile(z);
 const a = Math.abs(x - p.x), w = riverWidth(z);
 let h;
 if (a < w) h = p.y - 9 + 4 * noise(x * .03, z * .03) - 6 * smooth(w, w * .3, a);
 else {
  const q = a - w;
  const shore = smooth(0, 14, q) * (3 + 6 * noise(x * .03 + 5, z * .03));
  const detail = (noise(x * .16, z * .06) - .5) * 3 + (noise(x * .06, z * .018) - .5) * 14;
  if (!lower) {
   const base = bankBase(z, q);
   const r = ridged(x * .0045 + 3.1, z * .0042, 4);
   const wallH = 130 + 120 * r + 25 * noise(x * .02, z * .02 + 9);
   // A 16 m shore shelf before the wall climbs, so a level flight above the river never meets rock.
   const wall = (1 - Math.exp(-Math.max(0, q - 16) / 70)) * wallH;
   const band = 11 + 7 * noise(x * .004 + 9, z * .004), off = noise(x * .012 + 2, z * .012) * band;
   const f = (wall + off) / band, frac = f - Math.floor(f), terrace = (Math.floor(f) + smooth(.55, .95, frac)) * band - off;
   const strat = lerp(wall, terrace, (.25 + .2 * noise(x * .003, z * .003 + 4)) * smooth(0, 30, q) * (1 - smooth(170, 260, wall)));
   const shelf = smooth(260, 520, q) * (40 + 55 * noise(x * .006 + 1, z * .006));
   const mountains = smooth(900, 1500, q) * (320 + 480 * ridged(x * .0014 + 7, z * .0013, 4));
   h = base + shore + strat + shelf + mountains + detail * Math.min(1, q / 12);
  } else {
   const r = ridged(x * .0032 + 1.7, z * .003, 4);
   const open = smooth(LAKE_Z + 600, LAKE_Z - 400, z);
   const wallH = (380 + 260 * r) * (1 - .6 * open);
   const wall = (1 - Math.exp(-q / 85)) * wallH;
   const band = 13 + 8 * noise(x * .004 + 9, z * .004), off = noise(x * .012 + 2, z * .012) * band;
   const f = (wall + off) / band, frac = f - Math.floor(f), terrace = (Math.floor(f) + smooth(.55, .95, frac)) * band - off;
   const strat = lerp(wall, terrace, (.1 + .16 * noise(x * .003, z * .003 + 4)) * smooth(0, 30, q) * (1 - smooth(300, 420, wall)));
   const plateauEdge = waterfallGroundHeight(x, CURTAIN_Z + 1);
   const amphi = smooth(0, 650, q) * smooth(-1100, -60, z - CURTAIN_Z) * Math.max(0, plateauEdge - (p.y + shore + strat));
   const lakeHills = open * smooth(120, 500, q) * (30 + 40 * noise(x * .007, z * .007 + 3));
   const endRise = smooth(FINISH_Z - 150, WORLD_END_Z + 120, z) * (220 + 380 * ridged(x * .0025 + 2, z * .0025, 4));
   h = p.y + shore + strat + amphi + lakeHills + endRise + detail * Math.min(1, q / 12);
  }
 }
 // The plateau's leading edge climbs out of the cloud sea over 270 m: a cliff wall facing the islands.
 if (z > GORGE_Z - 70) { const floor = CLOUD_SEA_Y - 120; h = floor + (h - floor) * smooth(GORGE_Z + 300, GORGE_Z - 70, z); }
 return h;
}

// Floating islands of the Sky Isles: centre, top radius, top height. Rings weave between them.
export const ISLANDS = Object.freeze([
 {x: -175, z: -300, r: 120, top: 1898, trees: 1, falls: 1},
 {x: 160, z: -520, r: 140, top: 1926, trees: 1},
 {x: -165, z: -830, r: 165, top: 1876, trees: 1, temple: 1},
 {x: -180, z: -1130, r: 125, top: 1956, trees: 1, falls: 1},
 {x: 195, z: -1400, r: 150, top: 1902, trees: 1},
 {x: 165, z: -1730, r: 118, top: 1948, trees: 1, falls: 1},
 {x: -125, z: -1990, r: 100, top: 1888, trees: 1},
 {x: -520, z: -150, r: 70, top: 1840}, {x: 560, z: -700, r: 60, top: 1990}, {x: -610, z: -1000, r: 80, top: 1930},
 {x: 520, z: -1250, r: 55, top: 1850}, {x: -480, z: -1600, r: 65, top: 1980}, {x: 600, z: -1950, r: 75, top: 1870},
].map(i => Object.freeze({...i, z: i.z + ISLES_Z})));
function islandTopAt(isl, x, z) { const d = Math.hypot(x - isl.x, z - isl.z) / isl.r; return isl.top + 9 * (1 - d * d) + 3 * noise(x * .05, z * .05); }

// ---------------------------------------------------------------------------------------------
// Drawn textures
// ---------------------------------------------------------------------------------------------
function canvasTexture(size, draw) {
 const c = document.createElement('canvas'); c.width = c.height = size;
 const ctx = c.getContext('2d'); draw(ctx, size);
 const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function makePuffTexture() {
 return canvasTexture(256, (ctx, s) => {
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.5, 'rgba(255,255,255,.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 70; i++) {
   const x = hash(i, 1) * s, y = hash(i, 2) * s, r = 10 + hash(i, 3) * 40;
   const h = ctx.createRadialGradient(x, y, 0, x, y, r); h.addColorStop(0, 'rgba(0,0,0,.35)'); h.addColorStop(1, 'rgba(0,0,0,0)');
   ctx.fillStyle = h; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  }
 });
}
function makeGlowTexture() {
 return canvasTexture(256, (ctx, s) => {
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.18, 'rgba(255,255,255,.8)'); g.addColorStop(.45, 'rgba(255,255,255,.22)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
 });
}
function makeLeafClusterTexture() {
 return canvasTexture(256, (ctx, s) => {
  ctx.clearRect(0, 0, s, s);
  for (let i = 0; i < 320; i++) {
   const a = hash(i, 11) * Math.PI * 2, r = Math.pow(hash(i, 12), .5) * s * .47;
   const x = s / 2 + Math.cos(a) * r, y = s / 2 + Math.sin(a) * r * .8 + s * .08;
   const len = 12 + hash(i, 13) * 22, wid = 7 + hash(i, 14) * 10, rot = hash(i, 15) * Math.PI;
   const tone = .45 + hash(i, 16) * .5;
   ctx.fillStyle = `rgb(${Math.round(78 * tone)},${Math.round(132 * tone)},${Math.round(52 * tone)})`;
   ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
   ctx.beginPath(); ctx.ellipse(0, 0, len, wid, 0, 0, 7); ctx.fill();
   ctx.strokeStyle = `rgba(30,70,25,${.35 * tone})`; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-len, 0); ctx.lineTo(len, 0); ctx.stroke();
   ctx.restore();
  }
 });
}
function makeIvyLeafTexture() {
 return canvasTexture(128, (ctx, s) => {
  ctx.clearRect(0, 0, s, s);
  const g = ctx.createLinearGradient(0, 0, 0, s); g.addColorStop(0, '#79b846'); g.addColorStop(1, '#2f6a28');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(s * .5, s * .95);
  ctx.bezierCurveTo(s * .05, s * .6, s * .08, s * .12, s * .42, s * .2);
  ctx.bezierCurveTo(s * .46, s * .08, s * .54, s * .08, s * .58, s * .2);
  ctx.bezierCurveTo(s * .92, s * .12, s * .95, s * .6, s * .5, s * .95);
  ctx.fill();
  ctx.strokeStyle = 'rgba(25,60,20,.55)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(s * .5, s * .95); ctx.lineTo(s * .5, s * .22); ctx.stroke();
 });
}

// ---------------------------------------------------------------------------------------------
// Terrain material. aWater = local water level, aBank = metres from the river bank, both per vertex.
// High tier: two rock sets by region, scree on mid slopes, forest floor on far shelves, and two
// blended taps per texture (STOCHASTIC) so no repeat pattern shows. Phone: one tap, two sets.
// ---------------------------------------------------------------------------------------------
const triGLSL = `
 varying vec3 wPosition; varying vec3 wNormal; varying float vWater; varying float vBank;
 uniform sampler2D cliffColor, cliffNormal, cliffArm, groundColor, groundNormal, groundArm;
 #ifdef RICH_ROCK
 uniform sampler2D rock2Color, rock2Normal, screeColor, screeNormal, floorColor;
 #endif
 vec3 weights(vec3 n){vec3 w=pow(abs(n),vec3(5.));return w/max(dot(w,vec3(1.)),.001);}
 vec3 sampleTri(sampler2D t,vec3 p,vec3 w){return texture2D(t,p.zy).rgb*w.x+texture2D(t,p.xz).rgb*w.y+texture2D(t,p.xy).rgb*w.z;}
 vec3 normalTri(sampler2D t,vec3 p,vec3 w,vec3 n){
  vec3 a=texture2D(t,p.zy).xyz*2.-1.,b=texture2D(t,p.xz).xyz*2.-1.,c=texture2D(t,p.xy).xyz*2.-1.;
  a=vec3(a.xy+n.zy,abs(a.z)*n.x);b=vec3(b.xy+n.xz,abs(b.z)*n.y);c=vec3(c.xy+n.xy,abs(c.z)*n.z);
  return normalize(a.zyx*w.x+b.xzy*w.y+c.xyz*w.z);
 }
 // Second tap: the same texture turned a quarter turn, rescaled and shifted; a slow mask blends the two.
 vec3 altP(vec3 p){return vec3(-p.z,p.y,p.x)*1.31+vec3(37.,11.,53.);}
 #ifdef STOCHASTIC
 vec3 sampleTriS(sampler2D t,vec3 p,vec3 w,float m){return mix(sampleTri(t,p,w),sampleTri(t,altP(p),w),m);}
 vec3 normalTriS(sampler2D t,vec3 p,vec3 w,vec3 n,float m){return normalize(mix(normalTri(t,p,w,n),normalTri(t,altP(p),w,n),m));}
 #else
 vec3 sampleTriS(sampler2D t,vec3 p,vec3 w,float m){return sampleTri(t,p,w);}
 vec3 normalTriS(sampler2D t,vec3 p,vec3 w,vec3 n,float m){return normalTri(t,p,w,n);}
 #endif
 float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  float a=fract(sin(dot(i,vec2(127.1,311.7)))*43758.5453),b=fract(sin(dot(i+vec2(1,0),vec2(127.1,311.7)))*43758.5453);
  float c=fract(sin(dot(i+vec2(0,1),vec2(127.1,311.7)))*43758.5453),d=fract(sin(dot(i+vec2(1,1),vec2(127.1,311.7)))*43758.5453);
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}`;

function createTerrainMaterial(maps, high) {
 const mat = new THREE.MeshStandardMaterial({color: 0xffffff, roughness: 1, metalness: 0, fog: true});
 mat.onBeforeCompile = s => {
  Object.assign(s.uniforms, maps);
  s.defines = s.defines || {};
  if (high) { s.defines.RICH_ROCK = 1; s.defines.STOCHASTIC = 1; }
  s.vertexShader = s.vertexShader
   .replace('#include <common>', '#include <common>\nattribute float aWater;attribute float aBank;varying vec3 wPosition;varying vec3 wNormal;varying float vWater;varying float vBank;')
   .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nwPosition=(modelMatrix*vec4(transformed,1.)).xyz;wNormal=normalize(transpose(mat3(viewMatrix))*normalize(normalMatrix*objectNormal));vWater=aWater;vBank=aBank;');
  s.fragmentShader = s.fragmentShader
   .replace('#include <common>', '#include <common>\n' + triGLSL)
   .replace('#include <map_fragment>', `
    vec3 gn=normalize(wNormal),face=normalize(cross(dFdx(wPosition),dFdy(wPosition)));face*=sign(dot(face,gn)+.0001);
    vec3 tw=weights(normalize(mix(gn,face,.65)));
    float grass=smoothstep(.5,.84,gn.y);
    float height=wPosition.y-vWater;
    float viewDist=distance(wPosition,cameraPosition);
    float farMix=smoothstep(160.,520.,viewDist)*.85;
    float tapMask=smoothstep(.3,.7,vnoise(wPosition.xz*.011+wPosition.y*.003));
    float region=smoothstep(.42,.58,vnoise(wPosition.xz*.0022+5.3)+.15*vnoise(wPosition.xz*.02+1.));
    vec3 stone=sampleTriS(cliffColor,wPosition/18.,tw,tapMask);
    #ifdef RICH_ROCK
     stone=mix(stone,sampleTriS(rock2Color,wPosition/16.,tw,tapMask)*vec3(1.05,1.,.95),region);
    #endif
    stone=mix(stone,sampleTri(cliffColor,wPosition/95.,tw),farMix);
    float detailFade=smoothstep(420.,120.,viewDist);
    vec3 fine=sampleTri(cliffColor,wPosition/3.4,tw);stone*=mix(vec3(1.),fine*1.9,.4*detailFade);
    vec3 meadow=sampleTriS(groundColor,wPosition/14.,tw,tapMask)*vec3(.82,1.04,.62);
    meadow=mix(meadow,sampleTri(groundColor,wPosition/80.,tw)*vec3(.82,1.04,.62),farMix);
    #ifdef RICH_ROCK
     float scree=smoothstep(.55,.72,gn.y)*(1.-smoothstep(.8,.9,gn.y))*smoothstep(.35,.65,vnoise(wPosition.xz*.03+8.));
     vec3 screeC=sampleTriS(screeColor,wPosition/9.,tw,tapMask)*vec3(.95,.92,.85);
     meadow=mix(meadow,screeC,scree*.85);
     float shelfMask=smoothstep(200.,420.,vBank)*smoothstep(.35,.7,vnoise(wPosition.xz*.012+4.));
     vec3 floorC=sampleTri(floorColor,wPosition/9.,tw)*vec3(1.,.95,.82);
     meadow=mix(meadow,floorC,shelfMask);
    #endif
    float warp=vnoise(vec2(wPosition.x*.018,wPosition.z*.02))*.9+vnoise(vec2(wPosition.z*.05,wPosition.y*.4))*.25;
    float bandFreq=.045+.035*vnoise(wPosition.xz*.006+7.);
    float strata=smoothstep(.3,.7,fract(height*bandFreq+warp));
    float banded=smoothstep(.4,.75,vnoise(wPosition.xz*.011+3.7));
    vec3 sand=vec3(.64,.57,.48),basalt=vec3(.40,.40,.43),mossC=vec3(.30,.44,.18);
    vec3 tint=mix(basalt,mix(basalt,sand,strata),smoothstep(300.,40.,height)*(banded*.6+.35)+.06);
    tint*=mix(.66,1.08,vnoise(wPosition.xz*.03+11.));
    float wet=1.-smoothstep(0.,16.,height);
    tint=mix(tint,vec3(.19,.21,.23),wet*.6);
    float mossy=smoothstep(.5,.15,1.-gn.y)*smoothstep(140.,30.,height)*(1.-wet)*smoothstep(.4,.7,vnoise(wPosition.xz*.05));
    vec3 stoneT=mix(stone*tint*2.1,stone*mossC*2.4,mossy);
    float variation=.9+.15*sin(wPosition.x*.028+sin(wPosition.z*.033));
    diffuseColor.rgb*=mix(stoneT,meadow,grass)*variation;
    vec3 arm=mix(sampleTri(cliffArm,wPosition/18.,tw),sampleTri(groundArm,wPosition/14.,tw),grass);
   `)
   .replace('#include <roughnessmap_fragment>', 'float roughnessFactor=clamp(arm.g,.55,1.);roughnessFactor=mix(roughnessFactor,.35,wet*.8);')
   .replace('#include <normal_fragment_maps>', `
    vec3 wnStone=normalTriS(cliffNormal,wPosition/18.,tw,gn,tapMask);
    vec3 wnGround=normalTriS(groundNormal,wPosition/14.,tw,gn,tapMask);
    #ifdef RICH_ROCK
     wnStone=normalize(mix(wnStone,normalTriS(rock2Normal,wPosition/16.,tw,gn,tapMask),region));
     wnGround=normalize(mix(wnGround,normalTriS(screeNormal,wPosition/9.,tw,gn,tapMask),scree*.85));
    #endif
    vec3 wn=normalize(mix(wnStone,wnGround,grass));
    wn=normalize(mix(wn,gn,farMix*.8));
    normal=normalize((viewMatrix*vec4(wn,0.)).xyz);
   `)
   .replace('#include <aomap_fragment>', `
    float ambientOcclusion=mix(.62,1.,arm.r)*mix(.74,1.,smoothstep(0.,26.,height));
    reflectedLight.indirectDiffuse+=diffuseColor.rgb*vec3(.17,.25,.34)*.75*(.55+.45*gn.y);
    ambientOcclusion*=mix(.45,1.,smoothstep(-.6,.2,gn.y));
    reflectedLight.indirectDiffuse*=ambientOcclusion;
    float bounce=saturate(-gn.y*.8+.25)*(1.-smoothstep(60.,160.,height));
    reflectedLight.indirectDiffuse+=diffuseColor.rgb*vec3(.8,.78,.55)*.3*bounce;
   `);
 };
 mat.customProgramCacheKey = () => 'emerald-falls-terrain-v6-' + (high ? 'high' : 'phone');
 return mat;
}

const fogVertex = `varying vec2 vUv;
 #include <fog_pars_vertex>
 void main(){vUv=uv;vec4 mvPosition=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mvPosition;
 #include <fog_vertex>
 }`;

export function createWaterfallEnvironment({group, renderer, scene = null, onThunder = null, sky = null}) {
 const high = TIER === 'high';
 const pending = [], textures = [], materials = [], geometries = [], surfaces = [], animated = [];
 // Piece registry: everything built here is tagged with the stretch of route it belongs to, and update()
 // draws only the pieces near the dragon (detail: trees, rocks, grass; terrain: ground, water, islands;
 // landmark: far mountains and the cloud sea, never hidden). Far pieces sink into the fog before they cut off.
 const chunks = [];
 function register(obj, zA, zB, kind = 'detail') { chunks.push({obj, zNear: Math.max(zA, zB), zFar: Math.min(zA, zB), kind}); return obj; }
 const BAND = 600;
 const bandOf = z => Math.floor(-z / BAND);
 const loader = new THREE.TextureLoader();
 const tex = (name, color = false) => {
  let resolve, reject; pending.push(new Promise((a, b) => { resolve = a; reject = b; }));
  const t = loader.load(new URL('./assets/' + name, import.meta.url).href, resolve, undefined, reject);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = Math.min(high ? 8 : 4, renderer.capabilities.getMaxAnisotropy());
  if (color) t.colorSpace = THREE.SRGBColorSpace; textures.push(t); return t;
 };
 // Round 5 (2026-10-07): the most-downloaded Poly Haven sets replace the striped cliff texture. Walls: rock_face_03
 // (183k downloads) with lichen_rock as the second set; ground: aerial_grass_rock (365k) with brown_mud_leaves_01
 // (523k, the most-downloaded ground on the site) on the forest shelves and aerial_rocks_04 (223k) as scree.
 const cliffSize = high ? '2k' : '1k';
 const maps = {
  cliffColor: {value: tex(`waterfall/rock_face_03_diff_${cliffSize}.jpg`, true)}, cliffNormal: {value: tex(`waterfall/rock_face_03_nor_gl_${cliffSize}.jpg`)}, cliffArm: {value: tex(`waterfall/rock_face_03_arm_${cliffSize}.jpg`)},
  groundColor: {value: tex('waterfall/aerial_grass_rock_diff_2k.jpg', true)}, groundNormal: {value: tex('waterfall/aerial_grass_rock_nor_gl_2k.jpg')}, groundArm: {value: tex('waterfall/aerial_grass_rock_arm_2k.jpg')},
  caveColor: {value: tex(`waterfall/rock_06_diff_${cliffSize}.jpg`, true)}, caveNormal: {value: tex(`waterfall/rock_06_nor_gl_${cliffSize}.jpg`)},
 };
 if (high) {
  maps.rock2Color = {value: tex('waterfall/lichen_rock_diff_2k.jpg', true)}; maps.rock2Normal = {value: tex('waterfall/lichen_rock_nor_gl_2k.jpg')};
  maps.screeColor = {value: tex('waterfall/aerial_rocks_04_diff_2k.jpg', true)}; maps.screeNormal = {value: tex('waterfall/aerial_rocks_04_nor_gl_2k.jpg')};
  maps.floorColor = {value: tex('waterfall/brown_mud_leaves_01_diff_2k.jpg', true)};
 }
 const terrainMaterial = createTerrainMaterial(maps, high); materials.push(terrainMaterial);
 function mesh(geo, mat, name, parent = group) { geometries.push(geo); const m = new THREE.Mesh(geo, mat); m.name = name; parent.add(m); return m; }
 function withTerrainAttributes(geo, water, bank = 0) {
  const n = geo.attributes.position.count;
  geo.setAttribute('aWater', new THREE.BufferAttribute(new Float32Array(n).fill(water), 1));
  geo.setAttribute('aBank', new THREE.BufferAttribute(new Float32Array(n).fill(bank), 1));
  return geo;
 }

 // --- Terrain chunks (gorge, fall, canyon, lake) ----------------------------------------------------
 const NX = 128, ROW = 10, CHUNK = 260, NZ = CHUNK / ROW;
 const columns = Array.from({length: NX + 1}, (_, i) => { const s = (i - NX / 2) / (NX / 2); return Math.sign(s) * Math.pow(Math.abs(s), 1.7) * 2600; });
 const chunkCount = Math.ceil((WORLD_START_Z - WORLD_END_Z) / CHUNK);
 for (let chunk = 0; chunk < chunkCount; chunk++) {
  const start = WORLD_START_Z - chunk * CHUNK, rows = NZ + 3, positions = new Float32Array((NX + 1) * rows * 3), water = new Float32Array((NX + 1) * rows), bank = new Float32Array((NX + 1) * rows);
  let p = 0, k = 0;
  for (let j = -1; j <= NZ + 1; j++) {
   const z = start - j * ROW, prof = (z <= CURTAIN_Z ? {x: meander(z), y: LOWER_WATER_Y} : valleyProfile(z)), w = riverWidth(z);
   for (const dx of columns) {
    const x = prof.x + dx;
    positions[p++] = x; positions[p++] = waterfallGroundHeight(x, z); positions[p++] = z;
    water[k] = prof.y; bank[k] = Math.max(0, Math.abs(dx) - w); k++;
   }
  }
  const padded = new THREE.BufferGeometry();
  padded.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const idx = [];
  for (let r = 0; r < rows - 1; r++) for (let i = 0; i < NX; i++) { const a = r * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
  padded.setIndex(idx); padded.computeVertexNormals();
  const stride = (NX + 1), from = stride, to = stride * (NZ + 2);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions.slice(from * 3, to * 3), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(padded.attributes.normal.array.slice(from * 3, to * 3), 3));
  geo.setAttribute('aWater', new THREE.BufferAttribute(water.slice(from, to), 1));
  geo.setAttribute('aBank', new THREE.BufferAttribute(bank.slice(from, to), 1));
  const inner = [];
  for (let r = 0; r < NZ; r++) for (let i = 0; i < NX; i++) { const a = r * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1; inner.push(a, b, c, b, d, c); }
  geo.setIndex(inner); padded.dispose();
  register(mesh(geo, terrainMaterial, 'valley-rock-and-forest-' + chunk), start + 10, start - NZ * ROW - 10, 'terrain');
  surfaces.push({positions: geo.attributes.position, columns: NX + 1, rows: NZ, start, end: start - NZ * ROW});
 }

 // --- Sky Isles: floating islands, their vines, side falls, the stone gate and the temple ----------
 const islandGroup = new THREE.Group(); islandGroup.name = 'sky-isles'; group.add(islandGroup);
 function islandGeometry(isl, seed) {
  const R = isl.r, pts = [];
  // Flat grassy top with a small lip, then a rocky underside tapering to a point far below.
  const profile = [[0, 12], [.5, 10], [.9, 4], [1.03, -5], [.99, -16], [.98, -.3 * R], [.82, -.7 * R], [.55, -1.15 * R], [.25, -1.6 * R], [0, -1.85 * R]];
  for (const [f, y] of profile) pts.push(new THREE.Vector2(f * R, y));
  const geo = new THREE.LatheGeometry(pts, 44), pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
   const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), rad = Math.hypot(x, z);
   if (rad < 1e-3) continue;
   const side = smooth(6, -40, y);   // top stays smooth; sides get rocky
   const bump = 1 + (noise3(x * .02 + seed, y * .02, z * .02) - .5) * .5 * side + (noise3(x * .06, y * .06 + seed, z * .06) - .5) * .18 * side;
   pos.setXYZ(i, x * bump, y + (side < .5 ? 2.5 * noise(x * .05 + seed, z * .05) : 0), z * bump);
  }
  geo.computeVertexNormals();
  return withTerrainAttributes(geo, isl.top - 40, 420);
 }
 const vineGeos = [];
 const bark = new THREE.MeshStandardMaterial({color: 0x6a5c48, roughness: 1}); materials.push(bark);
 const barkColor = tex('waterfall/bark_willow_02_diff_1k.jpg', true), barkNormal = tex('waterfall/bark_willow_02_nor_gl_1k.jpg');
 const vineMat = new THREE.MeshStandardMaterial({map: barkColor, normalMap: barkNormal, normalScale: new THREE.Vector2(1.2, 1.2), color: 0x9c8a6c, roughness: .95, metalness: 0}); materials.push(vineMat);
 ISLANDS.forEach((isl, i) => {
  // No dangling vines under the islands any more (they read as floating roots); the rocky undersides stand alone.
  const m = mesh(islandGeometry(isl, i * 3.1), terrainMaterial, 'floating-island-' + i, islandGroup);
  m.position.set(isl.x, isl.top, isl.z); m.rotation.y = hash(i, 4) * 6;
  register(m, isl.z + isl.r * 1.1, isl.z - isl.r * 1.1, 'terrain');
 });
 // The stone gate at the gorge entrance: a weathered ring the rider flies through, with two guardian pillars.
 {
  const gateGeo = new THREE.TorusGeometry(110, 15, 10, 64), gp = gateGeo.attributes.position;
  for (let i = 0; i < gp.count; i++) { const x = gp.getX(i), y = gp.getY(i), z = gp.getZ(i); const n = (noise3(x * .04 + 1, y * .04, z * .04) - .5) * 8; gp.setXYZ(i, x + n, y + n * .7, z + n); }
  gateGeo.computeVertexNormals();
  const gate = mesh(withTerrainAttributes(gateGeo, ENTRY_TOP_Y - 320, 0), terrainMaterial, 'stone-gate', islandGroup);
  gate.position.set(0, ENTRY_TOP_Y, GORGE_Z + 60); register(gate, GORGE_Z + 200, GORGE_Z - 80, 'terrain');
  for (let v = 0; v < 7; v++) {
   const a = Math.PI * .15 + v * .3, len = 50 + hash(v, 77) * 80;
   const start = new THREE.Vector3(Math.cos(a + Math.PI) * 118, ENTRY_TOP_Y + Math.sin(a + Math.PI) * 118, GORGE_Z + 60);
   const pts = [start]; for (let k = 1; k <= 3; k++) pts.push(new THREE.Vector3(start.x + Math.sin(k + v) * 10 * k, start.y - len * k / 3, start.z + Math.cos(k * 2 + v) * 8));
   vineGeos.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 1.4, 6, false));
  }
 }
 // The gate's hanging vines in one mesh.
 register(mesh(mergeGeometries(vineGeos, false), vineMat, 'gate-vines', islandGroup), GORGE_Z + 200, GORGE_Z - 80, 'detail');
 for (const g of vineGeos) g.dispose();
 vineGeos.length = 0;

 // --- River -----------------------------------------------------------------------------------------
 const waterNormal = tex('water_normal_512.png'), fallNoise = tex('noise_512.png');
 const useReflection = high && !!scene;
 const reflectTarget = useReflection ? new THREE.WebGLRenderTarget(1024, 512, {type: THREE.HalfFloatType, depthBuffer: true}) : null;
 const riverUniforms = {
  uTime: {value: 0}, uWaterNormal: {value: waterNormal}, uNoise: {value: fallNoise}, uWaveStrength: {value: high ? .55 : .5}, uSwell: {value: high ? 1 : .6},
  uDeep: {value: new THREE.Color(0x0a3a3c)}, uShallow: {value: new THREE.Color(0x2e8d86)}, uFoam: {value: new THREE.Color(0xd6ece6)},
  uLipZ: {value: lip.z}, uCurtainZ: {value: CURTAIN_Z},
  uReflection: {value: reflectTarget ? reflectTarget.texture : null}, uReflMatrix: {value: new THREE.Matrix4()}, uReflMix: {value: useReflection ? .85 : 0}, uReflDistort: {value: .06},
 };
 const riverMat = new THREE.MeshStandardMaterial({color: 0xffffff, roughness: .1, metalness: 0, envMapIntensity: .9, side: THREE.DoubleSide});
 materials.push(riverMat);
 riverMat.onBeforeCompile = s => {
  Object.assign(s.uniforms, riverUniforms);
  s.defines = s.defines || {}; if (useReflection) s.defines.WATER_REFLECTION = 1;
  s.vertexShader = s.vertexShader
   .replace('#include <common>', '#include <common>\nattribute float aShore;attribute float aFlow;uniform float uTime;uniform float uSwell;varying vec3 riverWorld;varying vec3 riverNormal;varying float vShore;varying float vFlow;')
   // Gentle swells move the surface itself; the normal maps carry the ripples.
   .replace('#include <begin_vertex>', '#include <begin_vertex>\nfloat swell=(sin(position.x*.045+uTime*1.1)*.5+sin(aFlow*.07-uTime*1.4+position.x*.02)*.45)*uSwell*smoothstep(0.,12.,aShore);transformed+=objectNormal*swell;')
   .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nriverWorld=(modelMatrix*vec4(transformed,1.)).xyz;riverNormal=normalize(mat3(modelMatrix)*objectNormal);vShore=aShore;vFlow=aFlow;');
  s.fragmentShader = s.fragmentShader
   .replace('#include <common>', `#include <common>
    varying vec3 riverWorld;varying vec3 riverNormal;varying float vShore;varying float vFlow;
    uniform float uTime;uniform sampler2D uWaterNormal;uniform sampler2D uNoise;uniform float uWaveStrength;
    uniform vec3 uDeep;uniform vec3 uShallow;uniform vec3 uFoam;uniform float uLipZ;uniform float uCurtainZ;
    uniform sampler2D uReflection;uniform mat4 uReflMatrix;uniform float uReflMix;uniform float uReflDistort;
    // Three taps of the ripple map (turned, rescaled, shifted) blended by two slow masks: no repeat pattern survives.
    vec3 waterNormalAt(vec2 uv,float mask,float mask2){vec3 a=texture2D(uWaterNormal,uv).xyz*2.-1.;vec3 b=texture2D(uWaterNormal,uv.yx*1.37+vec2(.31,.77)).xyz*2.-1.;vec3 c=texture2D(uWaterNormal,vec2(uv.x*.62-uv.y*.47,uv.x*.47+uv.y*.62)*.83+vec2(.57,.13)).xyz*2.-1.;return mix(mix(a,b,mask),c,mask2);}`)
   .replace('#include <map_fragment>', `
    float rapids=smoothstep(260.,0.,riverWorld.z-uLipZ)*step(uCurtainZ-1.,riverWorld.z);
    float flow=vFlow*.05-uTime*(.9+rapids*2.5);
    float depthT=smoothstep(0.,30.,vShore);
    vec3 waterCol=mix(uShallow,uDeep,depthT);
    float foamNoise=texture2D(uNoise,vec2(riverWorld.x*.05,flow*.9)).r*.6+texture2D(uNoise,vec2(riverWorld.x*.17,flow*2.1)).r*.4;
    float foamBreak=texture2D(uNoise,vec2(riverWorld.x*.31,flow*.6)).r;
    float foam=smoothstep(5.,0.,vShore)*smoothstep(.5,.8,foamNoise)*smoothstep(.35,.85,foamBreak);
    float rapidFoam=rapids*smoothstep(.42,.72,foamNoise)*(.4+.6*foamBreak);
    float current=smoothstep(.72,.9,texture2D(uNoise,vec2(riverWorld.x*.04,flow*.35)).r)*.06*smoothstep(0.,20.,vShore);
    foam=max(max(foam,rapidFoam),current);
    diffuseColor.rgb=mix(waterCol,uFoam,foam);
   `)
   .replace('#include <roughnessmap_fragment>', `
    float glitter=texture2D(uNoise,riverWorld.xz*.09+vec2(uTime*.05,-uTime*.03)).r;
    float roughnessFactor=mix(.14,.35,glitter);roughnessFactor=mix(roughnessFactor,.9,foam);
   `)
   .replace('#include <normal_fragment_maps>', `
    float tapMask=smoothstep(.3,.7,texture2D(uNoise,riverWorld.xz*.004+vec2(.2,.6)).r);
    float tapMask2=smoothstep(.35,.65,texture2D(uNoise,riverWorld.xz*.0023+vec2(.7,.1)).r);
    vec3 n1=waterNormalAt(vec2(riverWorld.x*.025,flow*.5),tapMask,tapMask2);
    vec3 n2=waterNormalAt(vec2(riverWorld.x*.07+.3,flow*1.3),tapMask,tapMask2);
    vec3 nw=normalize(vec3((n1.xy+n2.xy)*uWaveStrength*(1.+rapids*1.2)*(1.-foam*.5),n1.z*n2.z));
    vec3 gN=normalize(riverNormal);vec3 tX=vec3(1.,0.,0.);vec3 tZ=normalize(cross(tX,gN));tX=cross(gN,tZ);
    vec3 worldN=normalize(tX*nw.x+tZ*nw.y+gN*nw.z);
    normal=normalize((viewMatrix*vec4(worldN,0.)).xyz);
   `)
   .replace('#include <lights_fragment_end>', `
    #include <lights_fragment_end>
    reflectedLight.directSpecular=reflectedLight.directSpecular/(1.+reflectedLight.directSpecular*1.5);
   `)
   .replace('#include <lights_fragment_maps>', `
    #include <lights_fragment_maps>
    radiance=min(radiance,vec3(4.));
    #ifdef WATER_REFLECTION
     vec4 rUv=uReflMatrix*vec4(riverWorld,1.);
     rUv.xy+=vec2(worldN.x,worldN.z)*uReflDistort*rUv.w;
     vec3 reflCol=min(texture2DProj(uReflection,rUv).rgb,vec3(6.));
     radiance=mix(radiance,reflCol*(1.-foam*.6),uReflMix);
    #endif
   `);
 };
 riverMat.customProgramCacheKey = () => 'emerald-river-v6-' + (useReflection ? 'refl' : 'plain');
 const riverMeshes = [];
 let flowBase = 0;
 const across = [-1, -.75, -.5, -.25, 0, .25, .5, .75, 1];
 for (const [start, end] of [[WORLD_START_Z, lip.z], [lip.z, CURTAIN_Z], [CURTAIN_Z, WORLD_END_Z]]) {
  const n = Math.ceil((start - end) / 8), pos = [], shore = [], flowA = [], uv = [], indices = [];
  let flow = flowBase, prev = null;
  for (let j = 0; j <= n; j++) {
   const z = lerp(start, end, j / n), p = valleyProfile(z), w = riverWidth(z);
   if (start === CURTAIN_Z) { p.y = LOWER_WATER_Y; p.x = meander(z); }
   if (prev) flow += Math.hypot(p.y - prev.y, z - prev.z);
   prev = {y: p.y, z};
   for (const f of across) { pos.push(p.x + f * w, p.y, z); shore.push(w * (1 - Math.abs(f))); flowA.push(flow); uv.push((f + 1) / 2, j / n); }
  }
  flowBase = flow;
  const cols = across.length;
  for (let j = 0; j < n; j++) for (let i = 0; i < cols - 1; i++) { const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1; indices.push(a, b, c, b, d, c); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('aShore', new THREE.Float32BufferAttribute(shore, 1)); geo.setAttribute('aFlow', new THREE.Float32BufferAttribute(flowA, 1));
  geo.setIndex(indices); geo.computeVertexNormals();
  const m = mesh(geo, riverMat, 'stationary-river'); m.receiveShadow = true; riverMeshes.push(m);
  register(m, start + 20, end - 20, 'terrain');
  surfaces.push({positions: geo.attributes.position, columns: cols, rows: n, start, end});
 }

 // --- Waterfall sheets, side streams, island falls ---------------------------------------------------
 const makeFallMaterial = veil => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
  uniforms: {...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: {value: 0}, uNoise: {value: fallNoise}, uSun: {value: new THREE.Color(0xffd7a8)}, uVeil: {value: veil}},
  vertexShader: fogVertex,
  fragmentShader: `varying vec2 vUv;uniform float uTime;uniform sampler2D uNoise;uniform vec3 uSun;uniform float uVeil;
   #include <fog_pars_fragment>
   void main(){
    float n1=texture2D(uNoise,vec2(vUv.x*14.,vUv.y*9.+uTime*.55)).r;
    float n2=texture2D(uNoise,vec2(vUv.x*31.+.3,vUv.y*18.+uTime*1.1)).r;
    float n3=texture2D(uNoise,vec2(vUv.x*60.+.7,vUv.y*27.+uTime*1.7)).r;
    float n4=texture2D(uNoise,vec2(vUv.x*1.3,vUv.y*1.1+uTime*.18)).r;
    float n5=texture2D(uNoise,vec2(vUv.x*3.+.5,vUv.y*2.6+uTime*.3)).r;
    float streak=smoothstep(.42,.64,n1*.5+n2*.3+n3*.1+n4*.1);
    float edge=smoothstep(0.,.14,vUv.x)*smoothstep(1.,.86,vUv.x);
    float body=smoothstep(1.,.93,vUv.y)*smoothstep(0.,.08,vUv.y);
    float alpha=mix((streak*.85+n4*.45)*.78,(.42+.4*n4+.18*n5)*.9,uVeil)*edge*body;
    vec3 col=mix(mix(vec3(.62,.74,.8),vec3(1.05,1.02,.98),streak),vec3(.86,.92,.95)*(.8+.3*n5),uVeil)*mix(vec3(1.),uSun,.3);
    gl_FragColor=vec4(col,alpha);
    #include <fog_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`});
 const fallMat = makeFallMaterial(0), veilMat = makeFallMaterial(1);
 materials.push(fallMat, veilMat); animated.push(fallMat.uniforms.uTime, veilMat.uniforms.uTime);
 const fallHeight = CURTAIN_TOP_Y + 70 - LOWER_WATER_Y;
 const curtain = mesh(new THREE.PlaneGeometry(150, fallHeight, 1, 1), fallMat, 'waterfall-curtain');
 curtain.position.set(0, (CURTAIN_TOP_Y + 70 + LOWER_WATER_Y) / 2, CURTAIN_Z + 6);
 const curtain2 = mesh(new THREE.PlaneGeometry(112, fallHeight, 1, 1), fallMat, 'waterfall-curtain-inner');
 curtain2.position.set(8, (CURTAIN_TOP_Y + 70 + LOWER_WATER_Y) / 2, CURTAIN_Z + 15);
 const curtainVeil = mesh(new THREE.PlaneGeometry(146, fallHeight, 1, 1), veilMat, 'waterfall-veil');
 curtainVeil.position.set(0, (CURTAIN_TOP_Y + 70 + LOWER_WATER_Y) / 2, CURTAIN_Z + 1);
 for (const side of [-1, 1]) {
  const ledgeY = CURTAIN_TOP_Y - 240 + side * 60, h = ledgeY - LOWER_WATER_Y;
  const flank = mesh(new THREE.PlaneGeometry(26, h, 1, 1), fallMat, 'waterfall-flank');
  flank.position.set(side * (riverWidth(CURTAIN_Z) + 6), (ledgeY + LOWER_WATER_Y) / 2, CURTAIN_Z + 3);
  flank.rotation.y = -side * .15;
 }
 for (const isl of ISLANDS.filter(i => i.falls)) {
  const a = hash(isl.z, 5) * Math.PI * 2, drop = 300;
  const f = mesh(new THREE.PlaneGeometry(16, drop, 1, 1), fallMat, 'island-fall', islandGroup);
  f.position.set(isl.x + Math.cos(a) * isl.r * .98, isl.top - 2 - drop / 2, isl.z + Math.sin(a) * isl.r * .98); f.rotation.y = -a + Math.PI / 2;
 }

 // --- Cloud sea under the islands, mist, foam, rainbow -------------------------------------------------
 const cloudSeaMat = new THREE.ShaderMaterial({transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
  uniforms: {...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: {value: 0}, uSun: {value: new THREE.Vector3(-.18, .21, -.9).normalize()}, uSunColor: {value: new THREE.Color(0xffd7a8)}},
  vertexShader: `varying vec3 vW;
   #include <fog_pars_vertex>
   void main(){vW=(modelMatrix*vec4(position,1.)).xyz;vec4 mvPosition=viewMatrix*vec4(vW,1.);gl_Position=projectionMatrix*mvPosition;
   #include <fog_vertex>
   }`,
  fragmentShader: `varying vec3 vW;uniform float uTime;uniform vec3 uSun;uniform vec3 uSunColor;
   #include <fog_pars_fragment>
   float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
   float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+1.),f.x),f.y);}
   float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<5;i++){s+=a*vn(p);p=p*2.03+vec2(17.,9.);a*=.5;}return s;}
   void main(){
    vec2 p=vW.xz*.0035+vec2(uTime*.008,uTime*.003);
    p+=.3*vec2(fbm(p*1.4+2.),fbm(p*1.4+7.))-.15;
    float d=fbm(p);
    float dens=smoothstep(.36,.62,d);
    float toward=fbm(p+uSun.xz*.06);
    float lit=clamp((d-toward)*9.+.35,0.,1.);lit*=lit;
    vec3 col=mix(vec3(.72,.76,.84),vec3(1.,.93,.82)*1.15,lit);
    col=mix(col,uSunColor*1.2,smoothstep(.25,.6,dens)*lit*.35);
    float a=mix(.55,.97,dens);
    gl_FragColor=vec4(col,a);
    #include <fog_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`});
 materials.push(cloudSeaMat); animated.push(cloudSeaMat.uniforms.uTime);
 // The cloud sea lies in front of the mountain (around the start ledge) and beyond its far side (under the
 // Sky Isles, up to the gorge's leading cliff). None of it passes through the Hollow.
 for (const [name, zFrom, zTo] of [['cloud-sea-ledge', 900, -HOLLOW_MOUTH], ['cloud-sea-isles', -HOLLOW_EXIT, GORGE_Z - 2400]]) {
  const sea = mesh(new THREE.PlaneGeometry(14000, zFrom - zTo, 1, 1), cloudSeaMat, name, islandGroup);
  sea.rotation.x = -Math.PI / 2; sea.position.set(0, CLOUD_SEA_Y, (zFrom + zTo) / 2); sea.renderOrder = -2;
 }
 const puff = makePuffTexture(); textures.push(puff);
 const glowTex = makeGlowTexture(); textures.push(glowTex);
 // --- The Hollow: the cave run before the islands (hollow.js) -----------------------------------------------
 const hollow = createHollow({group, high, renderer, noise, noise3, hash, mesh, tex, textures, materials, geometries, terrainMaterial, withTerrainAttributes, fallMat, glowTex, maps, register, surfaces, CLOUD_SEA_Y, barkColor, barkNormal, fallNoise, waterNormal, animated});
 const sprayMat = new THREE.SpriteMaterial({map: puff, color: 0xd9e4e6, transparent: true, opacity: .3, depthWrite: false, fog: true});
 const mistMat = new THREE.SpriteMaterial({map: puff, color: 0xc2d2d6, transparent: true, opacity: .16, depthWrite: false, fog: true});
 const cloudPuffMat = new THREE.SpriteMaterial({map: puff, color: 0xeef1f4, transparent: true, opacity: .26, depthWrite: false, fog: true});
 materials.push(sprayMat, mistMat, cloudPuffMat);
 const sprites = [];
 function sprite(mat, x, y, z, sx, sy, drift, parent = group) { const s = new THREE.Sprite(mat); s.position.set(x, y, z); s.scale.set(sx, sy, 1); s.userData.base = y; s.userData.drift = drift; parent.add(s); sprites.push(s); return s; }
 const pool = riverWidth(CURTAIN_Z - 80);
 for (let i = 0; i < (high ? 8 : 5); i++) sprite(sprayMat, (hash(i, 31) - .5) * pool * 1.6, LOWER_WATER_Y + 25 + hash(i, 32) * 70, CURTAIN_Z - 30 - hash(i, 33) * 140, 150 + hash(i, 34) * 120, 90 + hash(i, 35) * 70, .6 + hash(i, 36));
 for (let i = 0; i < 4; i++) sprite(mistMat, (hash(i, 41) - .5) * 160, LOWER_WATER_Y + 250 + i * 320, CURTAIN_Z - 20, 190, 120, .2);
 for (let i = 0; i < (high ? 12 : 7); i++) { const z = CURTAIN_Z - 260 - i * 150 - hash(i, 51) * 60; sprite(mistMat, meander(z) + (hash(i, 52) - .5) * riverWidth(z) * 1.4, LOWER_WATER_Y + 10 + hash(i, 53) * 12, z, 140 + hash(i, 54) * 110, 18 + hash(i, 55) * 14, .15); }
 for (let i = 0; i < 7; i++) { const z = GORGE_Z - 250 - i * 330; sprite(mistMat, meander(z) + (hash(i, 61) - .5) * 90, UPPER_WATER_Y + 8 + hash(i, 62) * 8, z, 160 + hash(i, 63) * 90, 14 + hash(i, 64) * 10, .1); }
 // Cloud puffs drifting around the islands give the cloud sea some height.
 for (let i = 0; i < (high ? 26 : 14); i++) { const z = ISLES_Z + 250 - hash(i, 71) * 2500, x = (hash(i, 72) - .5) * 1500; sprite(cloudPuffMat, x, CLOUD_SEA_Y + 30 + hash(i, 73) * 150, z, 260 + hash(i, 74) * 220, 110 + hash(i, 75) * 70, .25, islandGroup); }
 for (let i = 0; i < (high ? 10 : 6); i++) { const z = 500 - hash(i, 76) * 1000, x = (hash(i, 77) < .5 ? -1 : 1) * (500 + hash(i, 78) * 900); sprite(cloudPuffMat, x, CLOUD_SEA_Y + 20 + hash(i, 79) * 120, z, 280 + hash(i, 74) * 200, 110 + hash(i, 75) * 60, .25, islandGroup); }
 const foamMat = new THREE.ShaderMaterial({transparent: true, depthWrite: false, fog: true,
  uniforms: {...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), foamNoise: {value: fallNoise}, uTime: {value: 0}},
  vertexShader: fogVertex,
  fragmentShader: `varying vec2 vUv;uniform sampler2D foamNoise;uniform float uTime;
   #include <fog_pars_fragment>
   void main(){vec2 p=(vUv-.5)*vec2(1.4,2.);float n=texture2D(foamNoise,vUv*2.2+vec2(0.,uTime*.03)).r*.7+texture2D(foamNoise,vUv*5.1-vec2(uTime*.02,0.)).r*.3;float edge=1.-smoothstep(.3,.85,length(p)+n*.2);float a=edge*smoothstep(.25,.85,n)*.32;gl_FragColor=vec4(.82,.95,.9,a);
   #include <fog_fragment>
   #include <tonemapping_fragment>
   #include <colorspace_fragment>
   }`});
 materials.push(foamMat); animated.push(foamMat.uniforms.uTime);
 const foam = mesh(new THREE.PlaneGeometry(190, 150), foamMat, 'pool-foam'); foam.rotation.x = -Math.PI / 2; foam.position.set(0, LOWER_WATER_Y + .3, CURTAIN_Z - 75);
 const rainbowMat = new THREE.ShaderMaterial({transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  uniforms: {uInner: {value: 150}, uOuter: {value: 196}},
  vertexShader: 'varying vec3 vLocal;void main(){vLocal=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader: `varying vec3 vLocal;uniform float uInner,uOuter;
   vec3 spectrum(float t){return clamp(vec3(abs(t*6.-3.)-1.,2.-abs(t*6.-2.),2.-abs(t*6.-4.)),0.,1.);}
   void main(){float r=length(vLocal.xy);float t=(r-uInner)/(uOuter-uInner);if(t<0.||t>1.)discard;
    float a=smoothstep(0.,.12,t)*smoothstep(1.,.88,t)*smoothstep(0.,.25,vLocal.y/uOuter)*.42;
    gl_FragColor=vec4(spectrum(1.-t)*1.1,a);
   #include <tonemapping_fragment>
   #include <colorspace_fragment>
   }`});
 materials.push(rainbowMat);
 const rainbow = mesh(new THREE.RingGeometry(150, 196, 80, 1, 0, Math.PI), rainbowMat, 'rainbow');
 rainbow.position.set(-30, LOWER_WATER_Y + 12, CURTAIN_Z - 200);

 // --- Placement helpers: ground spots along the shores and shelves, island spots on the tops ----------
 const slopeOk = (x, z, y, limit) => Math.abs(waterfallGroundHeight(x + 3, z) - y) + Math.abs(waterfallGroundHeight(x, z + 3) - y) < limit;
 function shoreSpot(i, salt, qMin, qMax, power = 1.6, slopeLimit = 7, zone = 'both') {
  const z = GORGE_Z - 120 - hash(i, salt) * (GORGE_Z - 120 - WORLD_END_Z), p = valleyProfile(z), side = i % 2 ? 1 : -1, w = riverWidth(z);
  const upper = z > CURTAIN_Z;
  if (zone === 'upper' && !upper) return null; if (zone === 'lower' && upper) return null;
  const q = qMin + Math.pow(hash(i, salt + 1), power) * (qMax - qMin);
  const x = p.x + side * (w + q), y = waterfallGroundHeight(x, z);
  if (z < lip.z + 20 && z > CURTAIN_Z - 120) return null;
  if (!slopeOk(x, z, y, slopeLimit)) return null;
  return {x, y, z, seed: i};
 }
 function islandSpot(i, salt, edge = .85) {
  const big = ISLANDS.filter(k => k.trees), isl = big[i % big.length];
  const a = hash(i, salt) * Math.PI * 2, r = Math.sqrt(hash(i, salt + 1)) * isl.r * edge;
  const x = isl.x + Math.cos(a) * r, z = isl.z + Math.sin(a) * r;
  return {x, y: islandTopAt(isl, x, z), z, seed: i, island: isl};
 }

 // --- Forest: fir cards and round crowns on shelves, lake shores and island tops -------------------------
 const clusterTex = makeLeafClusterTexture(); textures.push(clusterTex);
 const shrubMat = new THREE.MeshStandardMaterial({map: clusterTex, alphaTest: .45, side: THREE.DoubleSide, roughness: .95}); materials.push(shrubMat);
 const roundGeo = new THREE.PlaneGeometry(1, 1); roundGeo.translate(0, .5, 0); geometries.push(roundGeo);
 const twigColor = tex('waterfall/fir_tree_01_twig_diff_2k.jpg', true), twigAlpha = tex('waterfall/fir_tree_01_twig_alpha_2k.png');
 const leaf = new THREE.MeshStandardMaterial({map: twigColor, alphaMap: twigAlpha, alphaTest: .4, side: THREE.DoubleSide, roughness: .9, color: 0xffffff}); materials.push(leaf);
 const trunkGeo = new THREE.CylinderGeometry(.13, .32, 1, 6), leafGeo = new THREE.PlaneGeometry(1, 1); geometries.push(trunkGeo, leafGeo);
 const tuv = leafGeo.attributes.uv; for (let i = 0; i < tuv.count; i++) tuv.setXY(i, .64453125 + tuv.getX(i) * .302734375, .619140625 + tuv.getY(i) * .3486328125);
 const dummy = new THREE.Object3D();
 const treeBatchCount = high ? 26 : 18, batches = Array.from({length: treeBatchCount}, () => []);
 let treeCount = 0;
 const treeTotal = high ? 1500 : 900;
 for (let i = 0; i < treeTotal; i++) {
  const z = GORGE_Z - 120 - hash(i, 33) * (GORGE_Z - 120 - WORLD_END_Z), p = valleyProfile(z), side = i % 2 ? 1 : -1, w = riverWidth(z);
  const upper = z > CURTAIN_Z;
  const q = upper ? 230 + hash(i, 14) * 700 : 60 + hash(i, 14) * 470;
  const x = p.x + side * (w + q), y = waterfallGroundHeight(x, z);
  if (z < lip.z + 35 && z > CURTAIN_Z - 160) continue;
  if (!slopeOk(x, z, y, 11)) continue;
  batches[Math.min(treeBatchCount - 1, Math.floor((GORGE_Z - z) / (GORGE_Z - WORLD_END_Z) * (treeBatchCount - 2)))].push({x, y, z, size: 11 + hash(i, 8) * 15, seed: i, round: hash(i, 19) < .42});
  treeCount++;
 }
 for (let i = 0; i < (high ? 160 : 90); i++) { const s = islandSpot(i, 37, .8); batches[treeBatchCount - 1].push({x: s.x, y: s.y - 1, z: s.z, size: 10 + hash(i, 8) * 13, seed: 5000 + i, round: hash(i, 19) < .5}); treeCount++; }
 batches.push(hollow.spots.trees); treeCount += hollow.spots.trees.length;   // the start ledge's firs
 batches.forEach((batch, bi) => {
  if (!batch.length) return;
  const zNear = Math.max(...batch.map(t => t.z)) + 40, zFar = Math.min(...batch.map(t => t.z)) - 40;
  const firs = batch.filter(t => !t.round), rounds = batch.filter(t => t.round);
  const trees = new THREE.InstancedMesh(trunkGeo, bark, batch.length);
  batch.forEach((t, i) => { dummy.position.set(t.x, t.y + t.size * .5, t.z); dummy.scale.set(t.size * .32, t.size * (t.round ? .7 : 1), t.size * .32); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); trees.setMatrixAt(i, dummy.matrix); });
  trees.name = 'fixed-forest-trunks-' + bi; trees.computeBoundingSphere(); group.add(trees); register(trees, zNear, zFar, 'detail');
  if (firs.length) {
   const leaves = new THREE.InstancedMesh(leafGeo, leaf, firs.length * 12);
   firs.forEach((t, i) => {
    const shade = .55 + hash(t.seed, 2) * .45;
    for (let j = 0; j < 12; j++) {
     const layer = Math.floor(j / 4), a = j * Math.PI * .5 + hash(t.seed, 8) * 6, width = t.size * (.85 - layer * .19);
     dummy.position.set(t.x + Math.cos(a) * width * .18, t.y + t.size * (.38 + layer * .22), t.z + Math.sin(a) * width * .18);
     dummy.scale.set(width, width * 714 / 620, 1); dummy.rotation.set(-.12, a + Math.PI * .5, (hash(j, t.seed) - .5) * .4); dummy.updateMatrix(); leaves.setMatrixAt(i * 12 + j, dummy.matrix);
     leaves.setColorAt(i * 12 + j, new THREE.Color().setRGB(.62 * shade + .1, .78 * shade + .14, .55 * shade + .1));
    }
   });
   leaves.name = 'fixed-forest-needles-' + bi; leaves.computeBoundingSphere(); group.add(leaves); register(leaves, zNear, zFar, 'detail');
  }
  if (rounds.length) {
   const crowns = new THREE.InstancedMesh(roundGeo, shrubMat, rounds.length * 6);
   rounds.forEach((t, i) => {
    const shade = .6 + hash(t.seed, 3) * .4, crown = t.size * .95;
    for (let j = 0; j < 6; j++) {
     const a = j * Math.PI / 3 + hash(t.seed, 8) * 6, lift = t.size * (.45 + (j % 3) * .12);
     dummy.position.set(t.x + Math.cos(a) * crown * .12, t.y + lift, t.z + Math.sin(a) * crown * .12);
     dummy.scale.set(crown, crown * .9, 1); dummy.rotation.set((hash(j, t.seed) - .5) * .3, a, (hash(j + 3, t.seed) - .5) * .3); dummy.updateMatrix(); crowns.setMatrixAt(i * 6 + j, dummy.matrix);
     crowns.setColorAt(i * 6 + j, new THREE.Color().setRGB(.55 * shade + .25, .75 * shade + .2, .45 * shade + .15));
    }
   });
   crowns.name = 'fixed-forest-crowns-' + bi; crowns.computeBoundingSphere(); group.add(crowns); register(crowns, zNear, zFar, 'detail');
  }
 });
 // Shrubs on shores, shelves and island tops.
 const crossGeo = new THREE.BufferGeometry();
 {
  const v = [], u = [], nrm = [], ix = [];
  for (const rot of [0, Math.PI / 2]) {
   const c = Math.cos(rot), s = Math.sin(rot), base = v.length / 3;
   for (const [px, py] of [[-.5, 0], [.5, 0], [.5, 1], [-.5, 1]]) { v.push(px * c, py, px * s); u.push(px + .5, py); nrm.push(-s, 0, c); }
   ix.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  crossGeo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); crossGeo.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2)); crossGeo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); crossGeo.setIndex(ix);
 }
 geometries.push(crossGeo);
 const shrubItems = [];
 for (let i = 0; i < (high ? 900 : 500); i++) {
  const s = shoreSpot(i, 71, 4, 330, 1.6, 7); if (!s) continue;
  const p = valleyProfile(s.z), q = Math.abs(s.x - p.x) - riverWidth(s.z);
  if (q > 55 && q < (s.z > CURTAIN_Z ? 250 : 330)) continue;
  shrubItems.push({...s, size: 5 + hash(i, 73) * 9});
 }
 for (let i = 0; i < (high ? 220 : 120); i++) { const s = islandSpot(i, 79, .9); shrubItems.push({...s, y: s.y - .4, size: 4 + hash(i, 73) * 7}); }
 {
  // One instanced mesh per 600 m band so the bands ahead can wait until the dragon is near.
  const bands = new Map();
  for (const s of shrubItems) { const b = bandOf(s.z); if (!bands.has(b)) bands.set(b, []); bands.get(b).push(s); }
  for (const [b, items] of bands) {
   const shrubs = new THREE.InstancedMesh(crossGeo, shrubMat, items.length);
   items.forEach((s, i) => {
    dummy.position.set(s.x, s.y - .4, s.z); dummy.scale.set(s.size * 1.3, s.size, s.size * 1.3); dummy.rotation.set(0, hash(s.seed, 74) * 3.2, 0); dummy.updateMatrix(); shrubs.setMatrixAt(i, dummy.matrix);
    const t = hash(s.seed, 75); shrubs.setColorAt(i, new THREE.Color().setRGB(.62 + t * .3, .7 + t * .22, .5 + t * .25));
   });
   shrubs.name = 'fixed-shrubs-' + b; shrubs.computeBoundingSphere(); group.add(shrubs); register(shrubs, -b * BAND + 40, -(b + 1) * BAND - 40, 'detail');
  }
 }

 // --- Scanned models (Poly Haven CC0): rocks, cliff chunks, far mountainsides, ferns, dead trunks --------
 // Spots are chosen now; the instanced meshes appear when each GLB arrives. A model that fails to load is skipped.
 const rockSpots = [], cliffSpots = [], mountainSpots = [], fernSpots = [], trunkSpots = [];
 for (let i = 0; i < (high ? 420 : 110); i++) {
  const inRiver = hash(i, 90) < .3;
  if (inRiver) {
   // Rocks breaking the water near the banks (never inside the flight corridor's ring lines).
   const z = GORGE_Z - 200 - hash(i, 91) * (GORGE_Z - 200 - WORLD_END_Z), p = valleyProfile(z), w = riverWidth(z), side = i % 2 ? 1 : -1;
   if (z < lip.z + 200 && z > CURTAIN_Z - 200) continue;
   const x = p.x + side * (w - 4 - hash(i, 92) * 24), y = (z <= CURTAIN_Z ? LOWER_WATER_Y : p.y) - 3;
   rockSpots.push({x, y, z, size: 6 + Math.pow(hash(i, 93), 1.6) * 16, seed: i});
  } else {
   const s = shoreSpot(i, 95, -6, 260, 1.8, 9); if (!s) continue;
   const p = valleyProfile(s.z), q = Math.abs(s.x - p.x) - riverWidth(s.z);
   if (q > 55 && q < (s.z > CURTAIN_Z ? 250 : 330)) continue;
   rockSpots.push({...s, y: s.y - 1, size: 5 + Math.pow(hash(i, 83), 2) * 24});
  }
 }
 for (let i = 0; i < 7; i++) { const z = LAKE_Z - 60 - hash(i, 88) * 520, w = riverWidth(z), x = meander(z) + (hash(i, 89) - .5) * (w - 70) * 1.6; rockSpots.push({x, y: LOWER_WATER_Y - 8, z, size: 26 + hash(i, 90) * 24, seed: 900 + i}); }
 for (let i = 0; i < (high ? 120 : 60); i++) { const s = islandSpot(i, 97, 1.0); rockSpots.push({...s, y: s.y - 2, size: 4 + Math.pow(hash(i, 98), 2) * 18}); }
 // Cliff chunks: big scanned rock masses set into the gorge walls, the canyon walls and the island sides.
 for (let i = 0; i < (high ? 70 : 26); i++) {
  const z = GORGE_Z - 150 - hash(i, 101) * (GORGE_Z - 150 - WORLD_END_Z), p = valleyProfile(z), side = i % 2 ? 1 : -1, w = riverWidth(z);
  if (z < lip.z + 60 && z > CURTAIN_Z - 100) continue;
  const q = 30 + hash(i, 102) * 240, x = p.x + side * (w + q), y = waterfallGroundHeight(x, z);
  const size = 70 + hash(i, 103) * 90;
  cliffSpots.push({x, y: y - size * .25, z, size, yaw: hash(i, 104) * 6.3, tilt: (hash(i, 105) - .5) * .5, seed: i});
 }
 ISLANDS.forEach((isl, i) => { for (let k = 0; k < (isl.r > 90 ? 4 : 2); k++) { const a = hash(i * 7 + k, 111) * Math.PI * 2, size = isl.r * (.55 + hash(k, i) * .35); cliffSpots.push({x: isl.x + Math.cos(a) * isl.r * .78, y: isl.top - isl.r * .42 - size * .3, z: isl.z + Math.sin(a) * isl.r * .78, size, yaw: -a + Math.PI / 2 + (hash(k, i + 1) - .5), tilt: (hash(k, i + 2) - .5) * .6, seed: 400 + i * 7 + k}); } });
 for (let i = 0; i < (high ? 14 : 7); i++) {
  const z = GORGE_Z - 300 - hash(i, 121) * (GORGE_Z - 300 - WORLD_END_Z), side = i % 2 ? 1 : -1, p = valleyProfile(z);
  const q = 1000 + hash(i, 122) * 900, x = p.x + side * (riverWidth(z) + q), y = waterfallGroundHeight(x, z), size = 700 + hash(i, 123) * 500;
  mountainSpots.push({x, y: y - size * .22, z, size, yaw: hash(i, 124) * 6.3, seed: i});
 }
 for (let i = 0; i < (high ? 600 : 150); i++) {
  const s = shoreSpot(i, 131, 2, 60, 1.3, 6); if (s) fernSpots.push({...s, size: 2.6 + hash(i, 132) * 2.2});
 }
 for (let i = 0; i < (high ? 220 : 90); i++) { const s = islandSpot(i, 137, .92); fernSpots.push({...s, size: 2.4 + hash(i, 132) * 2}); }
 for (let i = 0; i < (high ? 36 : 16); i++) {
  const s = i % 3 === 0 ? islandSpot(i, 141, .8) : shoreSpot(i, 141, 30, 520, 1.2, 8); if (!s) continue;
  trunkSpots.push({...s, size: 14 + hash(i, 142) * 14, yaw: hash(i, 143) * 6.3});
 }
 // The start ledge and the crags beside the mountain's mouth take scanned rocks, cliff chunks, peaks and trunks too.
 rockSpots.push(...hollow.spots.rocks); cliffSpots.push(...hollow.spots.cliffs); mountainSpots.push(...hollow.spots.mountains); trunkSpots.push(...hollow.spots.trunks);
 const gltf = new GLTFLoader();
 const modelUrl = name => new URL('./assets/waterfall/models/' + name + '.glb', import.meta.url).href;
 function loadVariants(names) {
  return Promise.all(names.map(n => new Promise(resolve => gltf.load(modelUrl(n), g => {
   const out = [];
   g.scene.updateMatrixWorld(true);
   g.scene.traverse(o => {
    if (!o.isMesh) return;
    const geo = o.geometry.clone(); geo.applyMatrix4(o.matrixWorld); geo.computeBoundingBox();
    const b = geo.boundingBox, c = new THREE.Vector3(); b.getCenter(c);
    geo.translate(-c.x, -b.min.y, -c.z); geo.computeBoundingBox();
    const span = Math.max(b.max.x - b.min.x, b.max.z - b.min.z, b.max.y - b.min.y);
    const mat = o.material.clone(); mat.side = THREE.FrontSide; mat.roughness = Math.max(.75, mat.roughness ?? 1);
    for (const t of [mat.map, mat.normalMap, mat.roughnessMap, mat.aoMap, mat.metalnessMap]) if (t) { t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy()); textures.push(t); }
    geometries.push(geo); materials.push(mat);
    out.push({geometry: geo, material: mat, span, name: n});
   });
   resolve(out);
  }, undefined, e => { console.warn('Emerald Falls: model ' + n + ' skipped: ' + (e && e.message || e)); resolve([]); }))))
   .then(lists => lists.flat());
 }
 // Whole objects (a tree = bark mesh + leaf meshes): one variant per top-level node, keeping every part
 // in the node's own frame so the parts stay together; the base sits at y = 0.
 function loadGroups(names) {
  return Promise.all(names.map(n => new Promise(resolve => gltf.load(modelUrl(n), g => {
   const out = [];
   g.scene.updateMatrixWorld(true);
   const roots = g.scene.children.filter(c => { let has = false; c.traverse(o => { if (o.isMesh) has = true; }); return has; });
   for (const root of roots) {
    const parts = [], box = new THREE.Box3();
    root.traverse(o => {
     if (!o.isMesh) return;
     const geo = o.geometry.clone(); geo.applyMatrix4(o.matrixWorld); geo.computeBoundingBox(); box.union(geo.boundingBox);
     const mat = o.material.clone(); mat.side = mat.transparent || mat.alphaTest > 0 ? THREE.DoubleSide : THREE.FrontSide; if (mat.alphaTest === 0 && mat.transparent) { mat.transparent = false; mat.alphaTest = .45; }
     for (const t of [mat.map, mat.normalMap, mat.roughnessMap, mat.aoMap, mat.metalnessMap]) if (t) { t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy()); textures.push(t); }
     geometries.push(geo); materials.push(mat); parts.push({geometry: geo, material: mat});
    });
    if (!parts.length) continue;
    const c = new THREE.Vector3(); box.getCenter(c);
    for (const p of parts) p.geometry.translate(-c.x, -box.min.y, -c.z);
    const span = Math.max(box.max.x - box.min.x, box.max.z - box.min.z, box.max.y - box.min.y);
    out.push({parts, span, name: n + '-' + (root.name || out.length)});
   }
   resolve(out);
  }, undefined, e => { console.warn('Emerald Falls: model ' + n + ' skipped: ' + (e && e.message || e)); resolve([]); }))))
   .then(lists => lists.flat());
 }
 function instanceSpots(variants, spots, name, {tintJitter = .2, settle = 0, cull = true} = {}) {
  if (!variants.length || !spots.length) return;
  const byVariant = variants.map(() => []);
  spots.forEach((s, i) => byVariant[s.variant !== undefined ? s.variant % variants.length : Math.floor(hash(s.seed, 151 + i) * variants.length) % variants.length].push(s));
  variants.forEach((v, vi) => {
   const all = byVariant[vi]; if (!all.length) return;
   // One instanced mesh per variant per 600 m band (cull) or one for the whole map (landmarks).
   const bands = new Map();
   for (const s of all) { const b = cull ? bandOf(s.z) : 0; if (!bands.has(b)) bands.set(b, []); bands.get(b).push(s); }
   for (const [b, list] of bands) {
    const parts = v.parts || [{geometry: v.geometry, material: v.material}];
    const meshes = parts.map(p => new THREE.InstancedMesh(p.geometry, p.material, list.length));
    list.forEach((s, i) => {
     const k = s.size / v.span;
     dummy.position.set(s.x, s.y - settle * s.size, s.z); dummy.scale.set(k, k * (s.uniform ? 1 : .85 + hash(s.seed, 152) * .3), k);
     dummy.rotation.set((s.tilt || 0) * (hash(s.seed, 153) - .5) * 2, s.yaw ?? hash(s.seed, 154) * 6.3, (s.tilt || 0) * (hash(s.seed, 155) - .5) * 2);
     dummy.updateMatrix();
     const t = 1 - tintJitter / 2 + hash(s.seed, 156) * tintJitter, col = new THREE.Color().setRGB(t, t * (1 - tintJitter * .15), t * (1 - tintJitter * .3));
     for (const m of meshes) { m.setMatrixAt(i, dummy.matrix); m.setColorAt(i, col); }
    });
    meshes.forEach((m, pi) => {
     m.name = name + '-' + v.name + (parts.length > 1 ? '-part' + pi : '') + (cull ? '-band' + b : ''); m.computeBoundingSphere(); group.add(m);
     if (cull) register(m, -b * BAND + 40, -(b + 1) * BAND - 40, 'detail');
    });
   }
  });
 }
 // Fab packs (downloaded 2026-10-07 with the Epic account on this PC): six low-poly mossy rocks, two real
 // broadleaf trees as hero trees beside the route and on the islands, and three painted fantasy islands far
 // out over the cloud sea (their cartoon style reads as distant sky gardens, so they never sit by the route).
 const fabRockSpots = rockSpots.filter((s, i) => i % 3 === 0).map(s => ({...s, seed: s.seed + 7000}));
 const heroTreeSpots = [];
 for (let i = 0; i < (high ? 26 : 10); i++) {
  const s = i % 2 === 0 ? islandSpot(i, 171, .7) : shoreSpot(i, 171, 40, 420, 1.1, 7); if (!s) continue;
  heroTreeSpots.push({...s, y: s.y - .5, size: 24 + hash(i, 172) * 14, uniform: true});
 }
 const fabIslandSpots = [];
 for (let i = 0; i < (high ? 7 : 4); i++) {
  const side = i % 2 ? 1 : -1, z = ISLES_Z + 150 - i * 330 - hash(i, 181) * 120, x = side * (650 + hash(i, 182) * 450);
  fabIslandSpots.push({x, y: 1560 + hash(i, 183) * 420, z, size: 170 + hash(i, 184) * 110, seed: 800 + i, yaw: hash(i, 185) * 6.3, uniform: true, variant: i % 3});
 }
 // Fab "free environment props set" (Z-TR-ZTR, CC BY 4.0): the vine-wrapped orb Ryan picked becomes a shrine on the
 // temple dais and two island tops (with its own green glow), the vine tree stands on island tops, and its mossy
 // rock pillar and rock cluster join the shore rocks (tinted toward moss; the raw textures are very pale).
 const temple = ISLANDS.find(i => i.temple);
 const shrineSpots = [
  {x: temple.x, z: temple.z, y: temple.top + 11, size: 22, seed: 3001, yaw: .6, uniform: true, variant: 0},
  {...islandSpot(3, 191, .25), size: 15, seed: 3002, uniform: true, variant: 0},
  {...islandSpot(8, 193, .3), size: 15, seed: 3003, uniform: true, variant: 0},
  ...[1, 2, 5, 6].map((i, k) => ({...islandSpot(i, 195 + k, .6), size: 17 + hash(k, 196) * 6, seed: 3100 + k, uniform: true, variant: 1})),
  ...Array.from({length: high ? 14 : 7}, (_, k) => { const s = shoreSpot(k, 201, 6, 120, 1.4, 8); return s ? {...s, y: s.y - 1, size: 9 + hash(k, 202) * 9, seed: 3200 + k, variant: 2} : null; }).filter(Boolean),
  ...Array.from({length: high ? 18 : 8}, (_, k) => { const s = shoreSpot(k, 211, 2, 60, 1.3, 7); return s ? {...s, y: s.y - .5, size: 8 + hash(k, 212) * 8, seed: 3300 + k, variant: 3} : null; }).filter(Boolean),
 ];
 const shrineGlows = [];
 for (const s of shrineSpots.filter(x => x.variant === 0)) {
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({map: glowTex, color: 0x7dffa8, transparent: true, opacity: .5, depthWrite: false, blending: THREE.AdditiveBlending}));
  materials.push(glow.material); glow.scale.set(s.size * 1.6, s.size * 1.6, 1); glow.position.set(s.x, s.y + s.size * .58, s.z); glow.name = 'shrine-glow'; group.add(glow); shrineGlows.push({sprite: glow, seed: s.seed});
 }
 const grassSpots = [];
 for (let i = 0; i < (high ? 520 : 200); i++) { const s = shoreSpot(i, 221, 1, 30, 1.2, 6); if (s) grassSpots.push({...s, y: s.y - .2, size: 3 + hash(i, 222) * 2.5}); }
 const modelsReady = Promise.all([
  loadVariants(['rock_moss_set_01', 'rock_moss_set_02', 'namaqualand_boulder_02', 'rock_09', 'boulder_01']).then(v => instanceSpots(v, rockSpots, 'scanned-rocks', {tintJitter: .3})),
  loadVariants(['fab/fab_rocks']).then(v => instanceSpots(v, fabRockSpots, 'fab-rocks', {tintJitter: .3})),
  loadGroups(['fab/fab_prop_2', 'fab/fab_prop_0', 'fab/fab_prop_6', 'fab/fab_prop_4']).then(v => {
   for (const p of v) for (const part of p.parts) { if (/prop_6|prop_4/.test(p.name)) part.material.color.setRGB(.62, .68, .5); part.material.roughness = .9; }
   instanceSpots(v, shrineSpots, 'fab-props', {tintJitter: .12});
  }),
  loadVariants(['fab/fab_grass']).then(v => instanceSpots(v, grassSpots, 'fab-grass', {tintJitter: .3})),
  loadGroups([high ? 'fab/fab_trees' : 'fab/fab_trees_phone']).then(v => instanceSpots(v, heroTreeSpots, 'fab-trees', {tintJitter: .2})),
  loadGroups(['fab/fab_island_1', 'fab/fab_island_2', 'fab/fab_island_3']).then(v => instanceSpots(v, fabIslandSpots, 'fab-islands', {tintJitter: .15, settle: .55, cull: false})),
  loadVariants(['namaqualand_cliff_02', 'coastal_cliff_02', 'rock_face_01', 'rock_face_02']).then(v => instanceSpots(v, cliffSpots, 'scanned-cliffs', {tintJitter: .25})),
  loadVariants(['mountainside']).then(v => instanceSpots(v, mountainSpots, 'scanned-mountains', {tintJitter: .2, cull: false})),
  loadVariants(['fern_02']).then(v => instanceSpots(v, fernSpots, 'scanned-ferns', {tintJitter: .35})),
  loadVariants(['dead_tree_trunk_02']).then(v => instanceSpots(v, trunkSpots, 'scanned-trunks', {tintJitter: .25})),
  hollow.placeModels({loadVariants}),   // real crystal models and scanned rubble inside the Hollow
 ]);

 // --- Temple ruins on the big island, wisps, birds ----------------------------------------------------------
 function latheWithNoise(profile, seed, segments = 40) {
  const geo = new THREE.LatheGeometry(profile, segments); const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const rr = 1 + (noise3(x * 1.4 + seed, y * 5 + seed, z * 1.4) - .5) * .5; p.setXYZ(i, x * rr, y, z * rr); }
  geo.computeVertexNormals(); geometries.push(geo); return geo;
 }
 const spireProfile = [], totemProfile = [];
 for (let i = 0; i <= 14; i++) { const t = i / 14; spireProfile.push(new THREE.Vector2(2 * Math.pow(1 - t, .62) * (.72 + .28 * Math.sin(t * 9)) + .05, t - .5)); }
 for (let i = 0; i <= 18; i++) {
  const t = i / 18; let rr = t < .07 ? 5 - t * 40 : 2.2 - t * .9;
  if (t > .3 && t < .36) rr *= .78; if (t > .55 && t < .61) rr *= .78; if (t > .8 && t < .85) rr *= .8;
  totemProfile.push(new THREE.Vector2(Math.max(.3, rr), t - .5));
 }
 const spireGeo = latheWithNoise(spireProfile, 3), totemGeo = latheWithNoise(totemProfile, 9, 24);
 {
  const isl = ISLANDS.find(i => i.temple);
  const pillarGeo = withTerrainAttributes(totemGeo.clone(), isl.top - 60, 0); geometries.push(pillarGeo);
  for (let k = 0; k < 9; k++) {
   const a = k / 9 * Math.PI * 2, x = isl.x + Math.cos(a) * 68, z = isl.z + Math.sin(a) * 68, h = k % 4 === 2 ? 18 : 34 + hash(k, 161) * 8;
   const m = mesh(pillarGeo, terrainMaterial, 'temple-pillar', islandGroup); m.position.set(x, islandTopAt(isl, x, z) + h / 2 - 2, z); m.scale.set(2.6, h, 2.6); m.rotation.y = hash(k, 162) * 6;
   register(m, isl.z + isl.r, isl.z - isl.r, 'detail');
  }
  const dais = mesh(withTerrainAttributes(new THREE.CylinderGeometry(58, 64, 6, 36), isl.top - 60, 0), terrainMaterial, 'temple-dais', islandGroup); dais.position.set(isl.x, isl.top + 8, isl.z); register(dais, isl.z + isl.r, isl.z - isl.r, 'detail');
  const archGeo = new THREE.TorusGeometry(42, 4.5, 8, 40, Math.PI); const ap = archGeo.attributes.position;
  for (let i = 0; i < ap.count; i++) { const x = ap.getX(i), y = ap.getY(i), z = ap.getZ(i); const n = (noise3(x * .1, y * .1, z * .1) - .5) * 2.5; ap.setXYZ(i, x + n, y + n, z + n); }
  archGeo.computeVertexNormals();
  const arch = mesh(withTerrainAttributes(archGeo, isl.top - 60, 0), terrainMaterial, 'temple-arch', islandGroup); arch.position.set(isl.x, isl.top + 10, isl.z - 70); arch.rotation.y = .4; register(arch, isl.z + isl.r, isl.z - isl.r, 'detail');
 }
 {
  const count = high ? 520 : 260, pos = [], seed = [];
  for (let i = 0; i < count; i++) {
   const prelude = i % 3 === 0;
   const z = prelude ? ISLES_Z + 150 - hash(i, 91) * 2250 : GORGE_Z - 100 - hash(i, 91) * (GORGE_Z - 100 - WORLD_END_Z);
   const prof = valleyProfile(z), side = hash(i, 92) < .5 ? -1 : 1, x = prelude ? (hash(i, 93) - .5) * 700 : prof.x + side * (20 + hash(i, 93) * 220);
   if (!prelude && z < lip.z + 40 && z > CURTAIN_Z - 200) continue;
   const water = prelude ? ENTRY_TOP_Y - 120 : (z <= CURTAIN_Z ? LOWER_WATER_Y : prof.y);
   pos.push(x, water + 10 + hash(i, 94) * 80, z); seed.push(hash(i, 95) * 6.28, .6 + hash(i, 96), .3 + hash(i, 97) * .7);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 3)); geometries.push(geo);
  const mat = new THREE.ShaderMaterial({transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
   uniforms: {...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: {value: 0}, uMap: {value: glowTex}, uScale: {value: 900}},
   vertexShader: `attribute vec3 aSeed;uniform float uTime;uniform float uScale;varying float vPulse;
    #include <fog_pars_vertex>
    void main(){vec3 p=position;p.x+=sin(uTime*.35*aSeed.y+aSeed.x)*9.;p.y+=sin(uTime*.5*aSeed.y+aSeed.x*2.)*5.;p.z+=cos(uTime*.3*aSeed.y+aSeed.x)*9.;
     vec4 mvPosition=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mvPosition;
     vPulse=.6+.4*sin(uTime*2.2*aSeed.z+aSeed.x*3.);gl_PointSize=(2.2+aSeed.z*3.)*uScale/max(1.,-mvPosition.z)*(.7+.3*vPulse);
    #include <fog_vertex>
    }`,
   fragmentShader: `uniform sampler2D uMap;varying float vPulse;
    #include <fog_pars_fragment>
    void main(){vec4 t=texture2D(uMap,gl_PointCoord);gl_FragColor=vec4(vec3(.55,1.,.7)*1.6*vPulse,t.a*.9);
    #include <fog_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    }`});
  materials.push(mat); animated.push(mat.uniforms.uTime);
  const wisps = new THREE.Points(geo, mat); wisps.name = 'forest-wisps'; wisps.frustumCulled = false; group.add(wisps);
 }
 const birdMat = new THREE.ShaderMaterial({side: THREE.DoubleSide, fog: true,
  uniforms: {...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: {value: 0}},
  vertexShader: `attribute float aFlap;attribute float aPhase;uniform float uTime;
   #include <fog_pars_vertex>
   void main(){vec3 p=position;p.y+=aFlap*sin(uTime*7.5+aPhase)*1.1;vec4 mvPosition=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mvPosition;
   #include <fog_vertex>
   }`,
  fragmentShader: `
   #include <fog_pars_fragment>
   void main(){gl_FragColor=vec4(vec3(.05,.06,.07),1.);
   #include <fog_fragment>
   #include <tonemapping_fragment>
   #include <colorspace_fragment>
   }`});
 materials.push(birdMat); animated.push(birdMat.uniforms.uTime);
 const flocks = [];
 for (const [cx, cy, cz, radius] of [[0, ENTRY_TOP_Y + 120, ISLES_Z - 900, 420], [0, UPPER_WATER_Y + 260, GORGE_Z - 1300, 260], [-60, LOWER_WATER_Y + 220, LAKE_Z - 150, 320], [-300, ENTRY_TOP_Y + 160, -120, 260]]) {
  const pos = [], flap = [], phase = [], count = high ? 18 : 10;
  for (let i = 0; i < count; i++) {
   const x = (hash(i, 2) - .5) * 120, y = (hash(i, 8) - .5) * 60, z = (hash(i, 1) - .5) * 160, s = 1.6 + hash(i, 4);
   pos.push(x, y, z, x - s * 1.8, y, z + s * .3, x, y, z + s * .7, x, y, z, x, y, z + s * .7, x + s * 1.8, y, z + s * .3);
   flap.push(0, 1, 0, 0, 0, 1); const ph = hash(i, 9) * 6.28; for (let k = 0; k < 6; k++) phase.push(ph);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('aFlap', new THREE.Float32BufferAttribute(flap, 1)); geo.setAttribute('aPhase', new THREE.Float32BufferAttribute(phase, 1)); geometries.push(geo);
  const birds = new THREE.Mesh(geo, birdMat); birds.name = 'birds'; birds.frustumCulled = false; group.add(birds);
  flocks.push({birds, cx, cy, cz, radius, phase: hash(flocks.length, 5) * 6});
 }

 // --- Vine-and-orb portals (the course gates) ----------------------------------------------------------
 const ivyTex = makeIvyLeafTexture(); textures.push(ivyTex);
 const ivyMat = new THREE.MeshStandardMaterial({map: ivyTex, alphaTest: .45, side: THREE.DoubleSide, roughness: .85, color: 0xffffff}); materials.push(ivyMat);
 const ivyGeo = new THREE.PlaneGeometry(1, 1); ivyGeo.translate(0, .5, 0); geometries.push(ivyGeo);
 const orbMats = {
  green: {orb: new THREE.MeshStandardMaterial({color: 0x3cff8e, emissive: 0x3dff86, emissiveIntensity: 1.6, roughness: .25, metalness: .1}), core: new THREE.MeshBasicMaterial({color: 0xf0fff4}), glow: new THREE.SpriteMaterial({map: glowTex, color: 0x6dffa6, transparent: true, opacity: .55, depthWrite: false, blending: THREE.AdditiveBlending}), points: new THREE.PointsMaterial({map: glowTex, color: 0xa8ffc8, size: 2.6, transparent: true, opacity: .9, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true})},
  gold: {orb: new THREE.MeshStandardMaterial({color: 0xffc14d, emissive: 0xffb340, emissiveIntensity: 1.7, roughness: .25, metalness: .2}), core: new THREE.MeshBasicMaterial({color: 0xfff6dc}), glow: new THREE.SpriteMaterial({map: glowTex, color: 0xffd27a, transparent: true, opacity: .6, depthWrite: false, blending: THREE.AdditiveBlending}), points: new THREE.PointsMaterial({map: glowTex, color: 0xffe3a0, size: 2.6, transparent: true, opacity: .9, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true})},
 };
 for (const set of Object.values(orbMats)) materials.push(set.orb, set.core, set.glow, set.points);
 const orbGeo = new THREE.SphereGeometry(1, 32, 20), coreGeo = new THREE.SphereGeometry(.42, 16, 10); geometries.push(orbGeo, coreGeo);
 const portals = [];
 function createPortal({radius = 24, bonus = false, seed = 0} = {}) {
  const set = bonus ? orbMats.gold : orbMats.green;
  const g = new THREE.Group(); g.name = bonus ? 'golden-orb-portal' : 'orb-portal';
  const r = radius;
  const vineCurve = (phase, wobble, zAmp) => {
   const pts = [];
   for (let i = 0; i < 64; i++) {
    const a = i / 64 * Math.PI * 2;
    const rr = r * (1 + wobble * Math.sin(a * 3 + phase) + .035 * (noise(Math.cos(a) * 3 + seed, Math.sin(a) * 3) - .5));
    pts.push(new THREE.Vector3(Math.cos(a) * rr, Math.sin(a) * rr, zAmp * Math.sin(a * 5 + phase)));
   }
   return new THREE.CatmullRomCurve3(pts, true, 'catmullrom', .5);
  };
  const tubes = [[vineCurve(seed, .05, r * .05), r * .055], [vineCurve(seed + 2, .08, r * .11), r * .028], [vineCurve(seed + 4, .07, -r * .09), r * .024]];
  for (const [curve, tube] of tubes) {
   const geo = new THREE.TubeGeometry(curve, 110, tube, 8, true); geometries.push(geo);
   const m = new THREE.Mesh(geo, vineMat); m.name = 'vine'; g.add(m);
  }
  const leafCount = high ? 110 : 60, leaves = new THREE.InstancedMesh(ivyGeo, ivyMat, leafCount);
  for (let i = 0; i < leafCount; i++) {
   const a = hash(i + seed * 7, 3) * Math.PI * 2, out = r * (1 + (hash(i, 4) - .3) * .14);
   dummy.position.set(Math.cos(a) * out, Math.sin(a) * out, (hash(i, 5) - .5) * r * .16);
   dummy.rotation.set((hash(i, 6) - .5) * 1.6, (hash(i, 7) - .5) * 2.4, a + Math.PI / 2 + (hash(i, 8) - .5));
   const s = r * (.07 + hash(i, 9) * .06); dummy.scale.set(s, s * 1.15, s); dummy.updateMatrix(); leaves.setMatrixAt(i, dummy.matrix);
   leaves.setColorAt(i, new THREE.Color().setRGB(.75 + hash(i, 10) * .3, .85 + hash(i, 11) * .2, .7 + hash(i, 12) * .3));
  }
  leaves.name = 'vine-leaves'; leaves.computeBoundingSphere(); g.add(leaves);
  const orb = new THREE.Mesh(orbGeo, set.orb); orb.scale.setScalar(r * .27); orb.name = 'orb'; g.add(orb);
  const core = new THREE.Mesh(coreGeo, set.core); core.scale.setScalar(r * .27); core.name = 'orb-core'; g.add(core);
  const glow = new THREE.Sprite(set.glow); glow.scale.set(r * 1.5, r * 1.5, 1); glow.name = 'orb-glow'; g.add(glow);
  const ringPts = [];
  for (let i = 0; i < 48; i++) { const a = i / 48 * Math.PI * 2, rr = r * (.42 + (i % 2) * .12); ringPts.push(Math.cos(a) * rr, Math.sin(a) * rr * .35, Math.sin(a) * rr); }
  const pgeo = new THREE.BufferGeometry(); pgeo.setAttribute('position', new THREE.Float32BufferAttribute(ringPts, 3)); geometries.push(pgeo);
  const sparks = new THREE.Points(pgeo, set.points); sparks.name = 'orb-sparks'; sparks.rotation.z = .5; g.add(sparks);
  const sparks2 = new THREE.Points(pgeo, set.points); sparks2.rotation.z = -.9; sparks2.rotation.x = 1.1; g.add(sparks2);
  const portal = {group: g, orb, core, glow, sparks, sparks2, seed, bonus, radius: r, caught: false};
  portals.push(portal);
  return portal;
 }
 const portalLights = [];
 if (high) for (let i = 0; i < 2; i++) { const l = new THREE.PointLight(0x5cff9a, 0, 150, 1.4); l.name = 'portal-light'; group.add(l); portalLights.push(l); }
 // Storm flash light: created now at zero so the light count never changes (a change recompiles every shader).
 const flashLight = new THREE.DirectionalLight(0xdfe8ff, 0); flashLight.position.set(-300, 900, 200); flashLight.name = 'lightning'; group.add(flashLight, flashLight.target);

 function makeObstacleMesh(hazard) {
  if (hazard.hollow) return hollow.hazardMesh(hazard);
  const base = hazard.kind === 'totem' ? totemGeo : spireGeo;
  const geo = withTerrainAttributes(base.clone(), hazard.base, 0); geometries.push(geo);
  const m = new THREE.Mesh(geo, terrainMaterial); m.name = hazard.kind === 'totem' ? 'stone-totem' : 'rock-spire';
  return m;
 }

 const burstMat = new THREE.SpriteMaterial({map: glowTex, color: 0x9dffc4, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending}); materials.push(burstMat);
 const bursts = [];
 for (let i = 0; i < 4; i++) { const s = new THREE.Sprite(burstMat.clone()); materials.push(s.material); s.visible = false; s.name = 'orb-burst'; group.add(s); bursts.push({sprite: s, t: 1, color: new THREE.Color()}); }
 function burst(position, colorHex = 0x9dffc4) {
  const b = bursts.reduce((best, x) => x.t >= 1 ? x : (best && best.t > x.t ? best : x), null) || bursts[0];
  b.t = 0; b.sprite.position.copy(position); b.sprite.material.color.setHex(colorHex); b.sprite.visible = true;
 }

 const texturesReady = Promise.all(pending);
 const ready = Promise.all([texturesReady, modelsReady]).then(() => { group.userData.assetsReady = true; });
 ready.catch(e => { group.userData.assetError = String(e?.message || e); });
 group.userData = {...group.userData, forestTrees: treeCount, shrubs: shrubItems.length, rocks: rockSpots.length, cliffs: cliffSpots.length, ferns: fernSpots.length, islands: ISLANDS.length, hollow: hollow.counts, pieces: chunks.length, textureSize: high ? 2048 : 1024, stationary: true, reflection: useReflection};

 function surfaceHeight(x, z, radius = 24) {
  let top = hollow.floorAt(x, z, radius);
  for (const s of surfaces) {
   if (z - radius > s.start || z + radius < s.end) continue;
   const dz = (s.start - s.end) / s.rows, p = s.positions, n = s.columns;
   const first = Math.max(0, Math.floor((s.start - z - radius) / dz)), last = Math.min(s.rows - 1, Math.floor((s.start - z + radius) / dz));
   for (let j = first; j <= last; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    if (Math.max(p.getX(b), p.getX(d)) < x - radius || Math.min(p.getX(a), p.getX(c)) > x + radius) continue;
    top = Math.max(top, p.getY(a), p.getY(b), p.getY(c), p.getY(d));
   }
  }
  return top;
 }

 // --- Planar reflection (high tier): the scene mirrored in the water plane, rendered before the frame ----
 const mirrorCamera = new THREE.PerspectiveCamera();
 const _plane = new THREE.Plane(), _normal = new THREE.Vector3(0, 1, 0), _view = new THREE.Vector3(), _target = new THREE.Vector3(), _camPos = new THREE.Vector3(), _q = new THREE.Vector4(), _clip = new THREE.Vector4(), _rot = new THREE.Matrix4(), _look = new THREE.Vector3(), _point = new THREE.Vector3();
 const _texMatrix = new THREE.Matrix4();
 function renderReflection(camera, waterY) {
  if (!useReflection) return;
  _point.set(0, waterY, 0);
  camera.getWorldPosition(_camPos);
  if (_camPos.y < waterY + 2) { riverUniforms.uReflMix.value = 0; return; }   // below the surface: no mirror
  riverUniforms.uReflMix.value = .85;
  _rot.extractRotation(camera.matrixWorld);
  _view.subVectors(_camPos, _point).reflect(_normal).negate().add(_point);
  _look.set(0, 0, -1).applyMatrix4(_rot).add(_camPos);
  _target.subVectors(_look, _point).reflect(_normal).negate().add(_point);
  mirrorCamera.position.copy(_view);
  mirrorCamera.up.set(0, 1, 0).applyMatrix4(_rot).reflect(_normal);
  mirrorCamera.lookAt(_target);
  mirrorCamera.fov = camera.fov; mirrorCamera.aspect = camera.aspect; mirrorCamera.near = camera.near; mirrorCamera.far = camera.far;
  mirrorCamera.updateProjectionMatrix(); mirrorCamera.updateMatrixWorld();
  _texMatrix.set(.5, 0, 0, .5, 0, .5, 0, .5, 0, 0, .5, .5, 0, 0, 0, 1);
  _texMatrix.multiply(mirrorCamera.projectionMatrix).multiply(mirrorCamera.matrixWorldInverse);
  riverUniforms.uReflMatrix.value.copy(_texMatrix);
  // Oblique near plane: clip everything under the water so the mirror shows only what is above it.
  _plane.setFromNormalAndCoplanarPoint(_normal, _point).applyMatrix4(mirrorCamera.matrixWorldInverse);
  _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
  const pm = mirrorCamera.projectionMatrix;
  _q.x = (Math.sign(_clip.x) + pm.elements[8]) / pm.elements[0];
  _q.y = (Math.sign(_clip.y) + pm.elements[9]) / pm.elements[5];
  _q.z = -1; _q.w = (1 + pm.elements[10]) / pm.elements[14];
  _clip.multiplyScalar(2 / _clip.dot(_q));
  pm.elements[2] = _clip.x; pm.elements[6] = _clip.y; pm.elements[10] = _clip.z + 1 - .0005; pm.elements[14] = _clip.w;
  for (const m of riverMeshes) m.visible = false;
  foam.visible = false;
  const target = renderer.getRenderTarget(), xr = renderer.xr.enabled, shadows = renderer.shadowMap.autoUpdate;
  renderer.xr.enabled = false; renderer.shadowMap.autoUpdate = false;
  renderer.setRenderTarget(reflectTarget); renderer.clear(); renderer.render(scene, mirrorCamera);
  renderer.setRenderTarget(target); renderer.xr.enabled = xr; renderer.shadowMap.autoUpdate = shadows;
  for (const m of riverMeshes) m.visible = true;
  foam.visible = true;
 }

 const _v = new THREE.Vector3();
 let lastTime = 0, nextFlash = 18 + Math.random() * 20, flashAt = -1, thunderAt = -1, thunderNear = .5;
 // Outside and inside looks: the sun, the sky fill and the fog cross-fade over the 300 m around each mouth.
 const fogOut = new THREE.Color(0x66798c), fogIn = new THREE.Color(0x03070a);
 const hemiOut = new THREE.Color(0x8db0c6), hemiIn = new THREE.Color(0x3f7a8a), groundOut = new THREE.Color(0x3b4a2c), groundIn = new THREE.Color(0x16201c);
 let insideNow = 0;
 function update(time, flight, camera) {
  const dt = clamp(time - lastTime, 0, .1); lastTime = time;
  riverUniforms.uTime.value = time;
  for (const u of animated) u.value = time;
  hollow.update(time);
  const vz = flight ? flight.z : 0;
  insideNow = hollow.insideFactor(vz);
  if (sky) {
   sky.sunLight.intensity = 3.2 * (1 - .9 * insideNow);
   sky.hemiLight.intensity = lerp(1.0, .75, insideNow);
   sky.hemiLight.color.copy(hemiOut).lerp(hemiIn, insideNow); sky.hemiLight.groundColor.copy(groundOut).lerp(groundIn, insideNow);
  }
  fogUniforms.fogColor.value.copy(fogOut).lerp(fogIn, insideNow);
  fogUniforms.fogDensity.value = lerp(.00066, .0015, insideNow);
  // Draw only the pieces of the world near the dragon (the fog has already swallowed the rest).
  const detailAhead = insideNow > .5 ? 1100 : (high ? 1800 : 1250), terrainAhead = insideNow > .5 ? 1400 : 3200;
  for (const c of chunks) {
   if (c.kind === 'landmark') continue;
   const ahead = c.kind === 'detail' ? detailAhead : terrainAhead;
   c.obj.visible = c.zNear > vz - ahead && c.zFar < vz + 420;
  }
  for (const s of sprites) { s.position.y = s.userData.base + Math.sin(time * .25 * s.userData.drift + s.userData.base) * 4 * s.userData.drift; }
  for (const g of shrineGlows) g.sprite.material.opacity = .38 + .2 * Math.sin(time * 1.7 + g.seed);
  for (const f of flocks) { const a = time * .05 + f.phase; f.birds.position.set(f.cx + Math.cos(a) * f.radius, f.cy + Math.sin(a * 2.3) * 18, f.cz + Math.sin(a) * f.radius * .6); f.birds.rotation.y = -a + Math.PI / 2; }
  let lit = 0;
  for (const p of portals) {
   if (!p.group.visible || !p.group.parent) continue;
   const pulse = .5 + .5 * Math.sin(time * 2.4 + p.seed);
   p.orb.position.y = Math.sin(time * 1.3 + p.seed) * 1.2; p.core.position.copy(p.orb.position); p.glow.position.copy(p.orb.position);
   p.orb.material.emissiveIntensity = 1.4 + pulse * .8; p.glow.material.opacity = .45 + pulse * .25;
   p.sparks.rotation.y = time * 1.1 + p.seed; p.sparks2.rotation.y = -time * .8 + p.seed;
   if (lit < portalLights.length && camera) {
    p.group.getWorldPosition(_v);
    if (_v.distanceTo(camera.position) < 600) { portalLights[lit].position.copy(_v); portalLights[lit].color.setHex(p.bonus ? 0xffc14d : 0x5cff9a); portalLights[lit].intensity = 40 + pulse * 25; lit++; }
   }
  }
  for (let i = lit; i < portalLights.length; i++) portalLights[i].intensity = 0;
  for (const b of bursts) {
   if (b.t >= 1) { b.sprite.visible = false; continue; }
   b.t = Math.min(1, b.t + dt * 1.6);
   const s = 12 + b.t * 150; b.sprite.scale.set(s, s, 1); b.sprite.material.opacity = (1 - b.t) * .9;
  }
  // Storm lightning: two quick flashes from the cloud wall every 20-45 s, thunder 1.5-4 s later by distance.
  if (time > nextFlash) { flashAt = time; nextFlash = time + 20 + Math.random() * 25; thunderNear = .35 + Math.random() * .65; thunderAt = time + 1.2 + (1 - thunderNear) * 3; }
  if (flashAt >= 0) {
   const f = time - flashAt;
   flashLight.intensity = (f < .08 ? 7 : f < .16 ? 1.5 : f < .26 ? 5 : f < .4 ? 1 : 0) * (1 - insideNow);
   if (f > .45) flashAt = -1;
  }
  if (thunderAt >= 0 && time > thunderAt) { thunderAt = -1; if (onThunder) onThunder(thunderNear * (1 - insideNow * .7)); }
  if (camera && flight) {
   if (insideNow > .5 || flight.z > ISLES_Z + 200) riverUniforms.uReflMix.value = 0;   // no river in sight yet
   else renderReflection(camera, flight.z > CURTAIN_Z - 20 ? UPPER_WATER_Y : LOWER_WATER_Y);
  }
 }

 function dispose() {
  for (const g of geometries) g.dispose(); for (const g of vineGeos) g.dispose(); for (const m of materials) m.dispose(); for (const t of textures) t.dispose();
  if (reflectTarget) reflectTarget.dispose();
  group.clear();
 }
 return {ready, terrainMaterial, textures, surfaceHeight, caveLimit: hollow.caveLimit, inRock: hollow.inRock, windAt: hollow.windAt, insideFactor: hollow.insideFactor, createPortal, makeObstacleMesh, burst, portals, update, dispose, islands: ISLANDS, chunks};
}

// ---------------------------------------------------------------------------------------------
// Sky: the canyon's film sky (kiara_8_sunset HDRI, storm-cloud wall, sun disc) with near-uniform fog.
// The cloud ceiling stays above the plateau instead of following the rider down the fall.
// ---------------------------------------------------------------------------------------------
export function createWaterfallSky({scene, renderer}) {
 // Near-uniform fog (falloff .00008 = thins by 1/e every 12 km) so the 2 km plateau wall seen from the islands
 // sinks into blue haze instead of standing as a flat brown backdrop; the gorge walls 70-500 m away stay crisp.
 setFogConstants({falloff: .00008, start: 14, height: 0});
 fogUniforms.fogColor.value.setHex(0x66798c);
 fogUniforms.fogDensity.value = .00066;
 const sky = createSky({renderer, scene});
 sky.hemiLight.intensity = 1.0;
 sky.hemiLight.color.setHex(0x8db0c6); sky.hemiLight.groundColor.setHex(0x3b4a2c);
 const baseUpdate = sky.update;
 const cloudFloor = ENTRY_TOP_Y + 240;
 sky.update = (time, cameraWorldPosition, anchor) => {
  baseUpdate(time, cameraWorldPosition, anchor);
  if (sky.clouds.position.y < cloudFloor) sky.clouds.position.y = cloudFloor;
  if (sky.cloudsHigh && sky.cloudsHigh.position.y < cloudFloor + 115) sky.cloudsHigh.position.y = cloudFloor + 115;
 };
 sky.info.environment = 'Emerald Falls sunset';
 return sky;
}
