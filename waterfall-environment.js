// Emerald Falls: the stationary scenery of the Waterfall map (rebuilt 2026-10-06).
// A forested sandstone gorge on the upper plateau, the 1,600 m fall into a stone amphitheatre, and a
// forest lake at the exit. Green vine-and-orb portals are the course gates (createPortal), rock
// spires and stone totems are the hazards (makeObstacleMesh). Every photo texture is CC0 (Poly Haven:
// cliff_side, aerial_grass_rock, forest_floor, mossy_rock, bark_willow_02, fir_tree_01 twig). Leaves,
// mist, glow and the rainbow are drawn here. Nothing is player-relative; nothing is recycled.
import * as THREE from './vendor/three.module.js';
import {createSky, setFogConstants, fogUniforms} from './sky.js';
import {TIER} from './quality.js';
import {routeAt, FALL_START, FALL_END, ARC_RADIUS, ROUTE_LENGTH, WATERFALL_RIVER_CLEARANCE, ENTRY_TOP_Y} from './waterfall-core.js';

const clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hash = (x, z = 0) => { const v = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return v - Math.floor(v); };
export function noise(x, z) {
 const ix = Math.floor(x), iz = Math.floor(z), u = smooth(0, 1, x - ix), v = smooth(0, 1, z - iz);
 return lerp(lerp(hash(ix, iz), hash(ix + 1, iz), u), lerp(hash(ix, iz + 1), hash(ix + 1, iz + 1), u), v);
}
// Ridged multifractal (sharp crests, each octave gated by the one below): real ridgelines, not blobs.
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
// Route-derived layout. The river rounds the same lip as the flight and drops beside the corridor.
// ---------------------------------------------------------------------------------------------
const lip = routeAt(FALL_START), exit = routeAt(FALL_END);
export const WORLD_START_Z = 400;
export const FINISH_Z = routeAt(ROUTE_LENGTH).z;         // crossing this plane completes the course
export const WORLD_END_Z = FINISH_Z - 1400;              // closing hills continue well past the finish
const riverBendRadius = ARC_RADIUS - 60;   // 60 m clears the full ring plus the animated dragon's body
export const CURTAIN_Z = lip.z - riverBendRadius;
export const UPPER_WATER_Y = lip.y - WATERFALL_RIVER_CLEARANCE;
export const LOWER_WATER_Y = exit.y - WATERFALL_RIVER_CLEARANCE;
export const CURTAIN_TOP_Y = UPPER_WATER_Y - riverBendRadius;
export const LAKE_Z = routeAt(ROUTE_LENGTH - 650).z;   // where the lower river opens into the lake

export function valleyProfile(z) {
 if (z >= lip.z) return {x: 0, y: UPPER_WATER_Y};
 if (z >= CURTAIN_Z) { const forward = lip.z - z; return {x: 0, y: CURTAIN_TOP_Y + Math.sqrt(Math.max(0, riverBendRadius ** 2 - forward ** 2))}; }
 return {x: 0, y: LOWER_WATER_Y};
}
// Half width of the river (metres from the centre line). Wider pool at the foot, a lake at the end.
export function riverWidth(z) {
 return 64 + 35 * Math.exp(-(((z - exit.z) / 240) ** 2)) + 7 * Math.sin(z * .004) ** 2 + 110 * smooth(LAKE_Z + 500, LAKE_Z - 350, z);
}
function bankBase(z, q) {
 // Beside the lip the ground stays at plateau level while the river cuts its notch down to the fall.
 const p = valleyProfile(z);
 return z < lip.z && z > CURTAIN_Z ? lerp(p.y, UPPER_WATER_Y, smooth(0, 40, q)) : p.y;
}
export function waterfallGroundHeight(x, z) {
 const lower = z <= CURTAIN_Z;
 const p = lower ? {x: 0, y: LOWER_WATER_Y} : valleyProfile(z);
 const a = Math.abs(x - p.x), w = riverWidth(z);
 if (a < w) return p.y - 9 + 4 * noise(x * .03, z * .03) - 6 * smooth(w, w * .3, a);
 const q = a - w;
 const shore = smooth(0, 14, q) * (3 + 6 * noise(x * .03 + 5, z * .03));
 const detail = (noise(x * .16, z * .06) - .5) * 3 + (noise(x * .06, z * .018) - .5) * 14;
 let h;
 if (!lower) {
  // Upper plateau: a sandstone gorge with terraced walls, forest shelves beyond, mountains far out.
  const base = bankBase(z, q);
  const r = ridged(x * .0045 + 3.1, z * .0042, 4);
  const wallH = 130 + 120 * r + 25 * noise(x * .02, z * .02 + 9);
  const wall = (1 - Math.exp(-q / 70)) * wallH;
  // Terraces of varying thickness and offset: a regular stair reads as a woven grid from across the gorge.
  const band = 11 + 7 * noise(x * .004 + 9, z * .004), off = noise(x * .012 + 2, z * .012) * band;
  const f = (wall + off) / band, frac = f - Math.floor(f), terrace = (Math.floor(f) + smooth(.55, .95, frac)) * band - off;
  const strat = lerp(wall, terrace, (.25 + .2 * noise(x * .003, z * .003 + 4)) * smooth(0, 30, q) * (1 - smooth(170, 260, wall)));
  const shelf = smooth(260, 520, q) * (40 + 55 * noise(x * .006 + 1, z * .006));
  const mountains = smooth(900, 1500, q) * (320 + 480 * ridged(x * .0014 + 7, z * .0013, 4));
  h = base + shore + strat + shelf + mountains;
 } else {
  // Lower canyon: a deep amphitheatre below the fall that opens into a forest lake.
  const r = ridged(x * .0032 + 1.7, z * .003, 4);
  const open = smooth(LAKE_Z + 600, LAKE_Z - 400, z);   // 0 in the canyon, 1 at the lake
  const wallH = (380 + 260 * r) * (1 - .6 * open);
  const wall = (1 - Math.exp(-q / 85)) * wallH;
  const band = 13 + 8 * noise(x * .004 + 9, z * .004), off = noise(x * .012 + 2, z * .012) * band;
  const f = (wall + off) / band, frac = f - Math.floor(f), terrace = (Math.floor(f) + smooth(.55, .95, frac)) * band - off;
  const strat = lerp(wall, terrace, (.1 + .16 * noise(x * .003, z * .003 + 4)) * smooth(0, 30, q) * (1 - smooth(300, 420, wall)));
  // The walls beside the fall climb to meet the plateau edge: a horseshoe amphitheatre that fades downstream.
  const plateauEdge = waterfallGroundHeight(x, CURTAIN_Z + 1);
  const amphi = smooth(0, 650, q) * smooth(-1100, -60, z - CURTAIN_Z) * Math.max(0, plateauEdge - (p.y + shore + strat));
  const lakeHills = open * smooth(120, 500, q) * (30 + 40 * noise(x * .007, z * .007 + 3));
  // Past the finish the lake narrows into hills, so the world never ends in a flat edge.
  const endRise = smooth(FINISH_Z - 150, WORLD_END_Z + 120, z) * (220 + 380 * ridged(x * .0025 + 2, z * .0025, 4));
  h = p.y + shore + strat + amphi + lakeHills + endRise;
 }
 return h + detail * Math.min(1, q / 12);
}

// ---------------------------------------------------------------------------------------------
// Drawn textures: soft mist puff, leaf cluster for shrubs and vine leaves, glow disc for orbs.
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
  // Break the disc with darker blotches so banks of them read as vapour, not as stacked circles.
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
// A bush of overlapping leaves on a transparent card (alpha-tested like the fir twigs).
function makeLeafClusterTexture() {
 return canvasTexture(256, (ctx, s) => {
  ctx.clearRect(0, 0, s, s);
  // A dense, wide, bottom-heavy mass of leaves: from the air it reads as a bush, not a floating gem.
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
// One ivy leaf for the vine rings: a heart-shaped card.
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
// Terrain material: triplanar cliff / meadow / forest-floor blend, strata by height above the local
// water, wet band, moss, sky fill for the shadow side. aWater = local water level, aBank = metres
// from the river bank (both per vertex), so one material serves every chunk, spire and totem.
// ---------------------------------------------------------------------------------------------
const triGLSL = `
 varying vec3 wPosition; varying vec3 wNormal; varying float vWater; varying float vBank;
 uniform sampler2D cliffColor, cliffNormal, cliffArm, groundColor, groundNormal, groundArm;
 #ifdef FOREST_FLOOR
 uniform sampler2D floorColor;
 #endif
 vec3 weights(vec3 n){vec3 w=pow(abs(n),vec3(5.));return w/max(dot(w,vec3(1.)),.001);}
 vec3 sampleTri(sampler2D t,vec3 p,vec3 w){return texture2D(t,p.zy).rgb*w.x+texture2D(t,p.xz).rgb*w.y+texture2D(t,p.xy).rgb*w.z;}
 vec3 normalTri(sampler2D t,vec3 p,vec3 w,vec3 n){
  vec3 a=texture2D(t,p.zy).xyz*2.-1.,b=texture2D(t,p.xz).xyz*2.-1.,c=texture2D(t,p.xy).xyz*2.-1.;
  a=vec3(a.xy+n.zy,abs(a.z)*n.x);b=vec3(b.xy+n.xz,abs(b.z)*n.y);c=vec3(c.xy+n.xy,abs(c.z)*n.z);
  return normalize(a.zyx*w.x+b.xzy*w.y+c.xyz*w.z);
 }
 float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  float a=fract(sin(dot(i,vec2(127.1,311.7)))*43758.5453),b=fract(sin(dot(i+vec2(1,0),vec2(127.1,311.7)))*43758.5453);
  float c=fract(sin(dot(i+vec2(0,1),vec2(127.1,311.7)))*43758.5453),d=fract(sin(dot(i+vec2(1,1),vec2(127.1,311.7)))*43758.5453);
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}`;

function createTerrainMaterial(maps, high) {
 const mat = new THREE.MeshStandardMaterial({color: 0xffffff, roughness: 1, metalness: 0, fog: true});
 mat.onBeforeCompile = s => {
  Object.assign(s.uniforms, maps);
  s.defines = s.defines || {};
  if (high) s.defines.FOREST_FLOOR = 1;
  s.vertexShader = s.vertexShader
   .replace('#include <common>', '#include <common>\nattribute float aWater;attribute float aBank;varying vec3 wPosition;varying vec3 wNormal;varying float vWater;varying float vBank;')
   // normalMatrix handles the non-uniform scale of spires and totems; mat3(modelMatrix) would tilt their normals up.
   .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nwPosition=(modelMatrix*vec4(transformed,1.)).xyz;wNormal=normalize(transpose(mat3(viewMatrix))*normalize(normalMatrix*objectNormal));vWater=aWater;vBank=aBank;');
  s.fragmentShader = s.fragmentShader
   .replace('#include <common>', '#include <common>\n' + triGLSL)
   .replace('#include <map_fragment>', `
    vec3 gn=normalize(wNormal),face=normalize(cross(dFdx(wPosition),dFdy(wPosition)));face*=sign(dot(face,gn)+.0001);
    vec3 tw=weights(normalize(mix(gn,face,.65)));
    float grass=smoothstep(.5,.84,gn.y);
    float height=wPosition.y-vWater;
    float viewDist=distance(wPosition,cameraPosition);
    // Far surfaces use a 95 m tile: the 18 m tile repeated thirty times across a wall reads as woven cloth.
    float farMix=smoothstep(160.,520.,viewDist)*.85;
    vec3 stone=mix(sampleTri(cliffColor,wPosition/18.,tw),sampleTri(cliffColor,wPosition/95.,tw),farMix);
    // Fine grain only near the camera: at hundreds of metres a 3 m tile turns into a moire lattice.
    float detailFade=smoothstep(420.,120.,viewDist);
    vec3 fine=sampleTri(cliffColor,wPosition/3.4,tw);stone*=mix(vec3(1.),fine*1.9,.4*detailFade);
    vec3 meadow=mix(sampleTri(groundColor,wPosition/14.,tw),sampleTri(groundColor,wPosition/80.,tw),farMix)*vec3(.82,1.04,.62);
    #ifdef FOREST_FLOOR
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
    vec3 wn=normalize(mix(normalTri(cliffNormal,wPosition/18.,tw,gn),normalTri(groundNormal,wPosition/14.,tw,gn),grass));
    // Flatten the bump detail with distance; far bumps only add a regular shading grid.
    wn=normalize(mix(wn,gn,farMix*.8));
    normal=normalize((viewMatrix*vec4(wn,0.)).xyz);
   `)
   .replace('#include <aomap_fragment>', `
    float ambientOcclusion=mix(.62,1.,arm.r)*mix(.74,1.,smoothstep(0.,26.,height));
    // Sky fill for faces turned from the low sun (the HDRI sky alone is too dark), weighted by how much sky they see.
    reflectedLight.indirectDiffuse+=diffuseColor.rgb*vec3(.17,.25,.34)*.75*(.55+.45*gn.y);
    ambientOcclusion*=mix(.45,1.,smoothstep(-.6,.2,gn.y));
    reflectedLight.indirectDiffuse*=ambientOcclusion;
    float bounce=saturate(-gn.y*.8+.25)*(1.-smoothstep(60.,160.,height));
    reflectedLight.indirectDiffuse+=diffuseColor.rgb*vec3(.8,.78,.55)*.3*bounce;
   `);
 };
 mat.customProgramCacheKey = () => 'emerald-falls-terrain-v5-' + (high ? 'high' : 'phone');
 return mat;
}

// ---------------------------------------------------------------------------------------------
// Shared vertex/fragment pieces for the drawn-shader materials that must take the global fog.
// ---------------------------------------------------------------------------------------------
const fogVertex = `varying vec2 vUv;
 #include <fog_pars_vertex>
 void main(){vUv=uv;vec4 mvPosition=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mvPosition;
 #include <fog_vertex>
 }`;

export function createWaterfallEnvironment({group, renderer}) {
 const high = TIER === 'high';
 const pending = [], textures = [], materials = [], geometries = [], surfaces = [], animated = [];
 const loader = new THREE.TextureLoader();
 const tex = (name, color = false) => {
  let resolve, reject; pending.push(new Promise((a, b) => { resolve = a; reject = b; }));
  const t = loader.load(new URL('./assets/' + name, import.meta.url).href, resolve, undefined, reject);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = Math.min(high ? 8 : 4, renderer.capabilities.getMaxAnisotropy());
  if (color) t.colorSpace = THREE.SRGBColorSpace; textures.push(t); return t;
 };
 const cliffSize = high ? '2k' : '1k';
 const maps = {
  cliffColor: {value: tex(`cliff_side_diff_${cliffSize}.jpg`, true)}, cliffNormal: {value: tex(`cliff_side_nor_gl_${cliffSize}.jpg`)}, cliffArm: {value: tex(`cliff_side_arm_${cliffSize}.jpg`)},
  groundColor: {value: tex('waterfall/aerial_grass_rock_diff_2k.jpg', true)}, groundNormal: {value: tex('waterfall/aerial_grass_rock_nor_gl_2k.jpg')}, groundArm: {value: tex('waterfall/aerial_grass_rock_arm_2k.jpg')},
 };
 if (high) maps.floorColor = {value: tex('waterfall/forest_floor_diff_1k.jpg', true)};
 const terrainMaterial = createTerrainMaterial(maps, high); materials.push(terrainMaterial);
 function mesh(geo, mat, name) { geometries.push(geo); const m = new THREE.Mesh(geo, mat); m.name = name; group.add(m); return m; }

 // --- Terrain chunks ---------------------------------------------------------------------------
 // 129 columns, dense at the river and sparse 2.6 km out; rows every 10 m; one padding row on each side
 // of a chunk so smoothed normals match the neighbour's (no lighting seam at chunk borders).
 const NX = 128, ROW = 10, CHUNK = 260, NZ = CHUNK / ROW;
 const columns = Array.from({length: NX + 1}, (_, i) => { const s = (i - NX / 2) / (NX / 2); return Math.sign(s) * Math.pow(Math.abs(s), 1.7) * 2600; });
 const chunkCount = Math.ceil((WORLD_START_Z - WORLD_END_Z) / CHUNK);
 for (let chunk = 0; chunk < chunkCount; chunk++) {
  const start = WORLD_START_Z - chunk * CHUNK, rows = NZ + 3, positions = new Float32Array((NX + 1) * rows * 3), water = new Float32Array((NX + 1) * rows), bank = new Float32Array((NX + 1) * rows);
  let p = 0, k = 0;
  for (let j = -1; j <= NZ + 1; j++) {
   const z = start - j * ROW, prof = (z <= CURTAIN_Z ? {x: 0, y: LOWER_WATER_Y} : valleyProfile(z)), w = riverWidth(z);
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
  mesh(geo, terrainMaterial, 'valley-rock-and-forest-' + chunk);
  surfaces.push({positions: geo.attributes.position, columns: NX + 1, rows: NZ, start, end: start - NZ * ROW});
 }

 // --- River: sunset reflections, flow along the course, foam at the banks, white water over the lip ----
 const waterNormal = tex('water_normal_512.png'), fallNoise = tex('noise_512.png');
 const riverUniforms = {
  uTime: {value: 0}, uWaterNormal: {value: waterNormal}, uNoise: {value: fallNoise}, uWaveStrength: {value: high ? .6 : .5},
  uDeep: {value: new THREE.Color(0x0a3a3c)}, uShallow: {value: new THREE.Color(0x2e8d86)}, uFoam: {value: new THREE.Color(0xd6ece6)},
  uLipZ: {value: lip.z}, uCurtainZ: {value: CURTAIN_Z},
 };
 const riverMat = new THREE.MeshStandardMaterial({color: 0xffffff, roughness: .1, metalness: 0, envMapIntensity: .9, side: THREE.DoubleSide});
 materials.push(riverMat);
 riverMat.onBeforeCompile = s => {
  Object.assign(s.uniforms, riverUniforms);
  s.vertexShader = s.vertexShader
   .replace('#include <common>', '#include <common>\nattribute float aShore;attribute float aFlow;varying vec3 riverWorld;varying vec3 riverNormal;varying float vShore;varying float vFlow;')
   .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nriverWorld=(modelMatrix*vec4(transformed,1.)).xyz;riverNormal=normalize(mat3(modelMatrix)*objectNormal);vShore=aShore;vFlow=aFlow;');
  s.fragmentShader = s.fragmentShader
   .replace('#include <common>', `#include <common>
    varying vec3 riverWorld;varying vec3 riverNormal;varying float vShore;varying float vFlow;
    uniform float uTime;uniform sampler2D uWaterNormal;uniform sampler2D uNoise;uniform float uWaveStrength;
    uniform vec3 uDeep;uniform vec3 uShallow;uniform vec3 uFoam;uniform float uLipZ;uniform float uCurtainZ;`)
   .replace('#include <map_fragment>', `
    float rapids=smoothstep(260.,0.,riverWorld.z-uLipZ)*step(uCurtainZ-1.,riverWorld.z);
    float flow=vFlow*.05-uTime*(.9+rapids*2.5);
    float depthT=smoothstep(0.,30.,vShore);
    vec3 waterCol=mix(uShallow,uDeep,depthT);
    float foamNoise=texture2D(uNoise,vec2(riverWorld.x*.05,flow*.9)).r*.6+texture2D(uNoise,vec2(riverWorld.x*.17,flow*2.1)).r*.4;
    float foamBreak=texture2D(uNoise,vec2(riverWorld.x*.31,flow*.6)).r;
    float foam=smoothstep(5.,0.,vShore)*smoothstep(.5,.8,foamNoise)*smoothstep(.35,.85,foamBreak);
    float rapidFoam=rapids*smoothstep(.42,.72,foamNoise)*(.4+.6*foamBreak);
    // Faint streaks of current in the open water: thin and rare, never a field of dots.
    float current=smoothstep(.72,.9,texture2D(uNoise,vec2(riverWorld.x*.04,flow*.35)).r)*.06*smoothstep(0.,20.,vShore);
    foam=max(max(foam,rapidFoam),current);
    diffuseColor.rgb=mix(waterCol,uFoam,foam);
   `)
   .replace('#include <roughnessmap_fragment>', `
    float glitter=texture2D(uNoise,riverWorld.xz*.09+vec2(uTime*.05,-uTime*.03)).r;
    float roughnessFactor=mix(.14,.35,glitter);roughnessFactor=mix(roughnessFactor,.9,foam);
   `)
   .replace('#include <normal_fragment_maps>', `
    // Long swells (40 m and 14 m) read as water from 120 m up; short ripples alias into a lattice at that height.
    vec3 n1=texture2D(uWaterNormal,vec2(riverWorld.x*.025,flow*.5)).xyz*2.-1.;
    vec3 n2=texture2D(uWaterNormal,vec2(riverWorld.x*.07+.3,flow*1.3)).xyz*2.-1.;
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
   `);
 };
 riverMat.customProgramCacheKey = () => 'emerald-river-v5';
 // Three grids meet exactly at the level lip and at the waterfall's foot. Five columns across so the
 // bank-distance attribute can shade the shallows and foam. aFlow is the arc length in metres.
 let flowBase = 0;
 for (const [start, end] of [[WORLD_START_Z, lip.z], [lip.z, CURTAIN_Z], [CURTAIN_Z, WORLD_END_Z]]) {
  const n = Math.ceil((start - end) / 9), pos = [], shore = [], flowA = [], uv = [], indices = [];
  let flow = flowBase, prev = null;
  for (let j = 0; j <= n; j++) {
   const z = lerp(start, end, j / n), p = valleyProfile(z), w = riverWidth(z);
   if (start === CURTAIN_Z) p.y = LOWER_WATER_Y;
   if (prev) flow += Math.hypot(p.y - prev.y, z - prev.z);
   prev = {y: p.y, z};
   for (const f of [-1, -.5, 0, .5, 1]) { pos.push(p.x + f * w, p.y, z); shore.push(w * (1 - Math.abs(f))); flowA.push(flow); uv.push((f + 1) / 2, j / n); }
  }
  flowBase = flow;
  for (let j = 0; j < n; j++) for (let i = 0; i < 4; i++) { const a = j * 5 + i, b = a + 1, c = a + 5, d = c + 1; indices.push(a, b, c, b, d, c); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('aShore', new THREE.Float32BufferAttribute(shore, 1)); geo.setAttribute('aFlow', new THREE.Float32BufferAttribute(flowA, 1));
  geo.setIndex(indices); geo.computeVertexNormals();
  const m = mesh(geo, riverMat, 'stationary-river'); m.receiveShadow = true;
  surfaces.push({positions: geo.attributes.position, columns: 5, rows: n, start, end});
 }

 // --- Waterfall sheets: scrolling streak noise, bright sunlit strands, fading into spray at the foot -----
 // uVeil 0: strands and streaks (front sheets). uVeil 1: the soft white mass behind them, so the fall reads
 // as a body of falling water from the foot and the lake, not as a few bright lines.
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
 // Two side streams spill down the cliff face just outside the main sheet.
 for (const side of [-1, 1]) {
  const ledgeY = CURTAIN_TOP_Y - 240 + side * 60, h = ledgeY - LOWER_WATER_Y;
  const flank = mesh(new THREE.PlaneGeometry(26, h, 1, 1), fallMat, 'waterfall-flank');
  flank.position.set(side * (riverWidth(CURTAIN_Z) + 6), (ledgeY + LOWER_WATER_Y) / 2, CURTAIN_Z + 3);
  flank.rotation.y = -side * .15;
 }

 // --- Mist, spray, foam, rainbow ----------------------------------------------------------------
 const puff = makePuffTexture(); textures.push(puff);
 const sprayMat = new THREE.SpriteMaterial({map: puff, color: 0xd9e4e6, transparent: true, opacity: .3, depthWrite: false, fog: true});
 const mistMat = new THREE.SpriteMaterial({map: puff, color: 0xc2d2d6, transparent: true, opacity: .16, depthWrite: false, fog: true});
 materials.push(sprayMat, mistMat);
 const sprites = [];
 function sprite(mat, x, y, z, sx, sy, drift) { const s = new THREE.Sprite(mat); s.position.set(x, y, z); s.scale.set(sx, sy, 1); s.userData.base = y; s.userData.drift = drift; group.add(s); sprites.push(s); return s; }
 const pool = riverWidth(CURTAIN_Z - 80);
 for (let i = 0; i < (high ? 8 : 5); i++) sprite(sprayMat, (hash(i, 31) - .5) * pool * 1.6, LOWER_WATER_Y + 25 + hash(i, 32) * 70, CURTAIN_Z - 30 - hash(i, 33) * 140, 150 + hash(i, 34) * 120, 90 + hash(i, 35) * 70, .6 + hash(i, 36));
 for (let i = 0; i < 4; i++) sprite(mistMat, (hash(i, 41) - .5) * 160, LOWER_WATER_Y + 250 + i * 320, CURTAIN_Z - 20, 190, 120, .2);
 for (let i = 0; i < (high ? 12 : 7); i++) { const z = CURTAIN_Z - 260 - i * 150 - hash(i, 51) * 60; sprite(mistMat, (hash(i, 52) - .5) * riverWidth(z) * 1.4, LOWER_WATER_Y + 10 + hash(i, 53) * 12, z, 140 + hash(i, 54) * 110, 18 + hash(i, 55) * 14, .15); }
 for (let i = 0; i < 7; i++) { const z = 250 - i * 330; sprite(mistMat, (hash(i, 61) - .5) * 90, UPPER_WATER_Y + 8 + hash(i, 62) * 8, z, 160 + hash(i, 63) * 90, 14 + hash(i, 64) * 10, .1); }
 const foamMat = new THREE.ShaderMaterial({transparent: true, depthWrite: false, fog: true,
  uniforms: {...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), foamNoise: {value: fallNoise}, uTime: {value: 0}},
  vertexShader: fogVertex,
  fragmentShader: `varying vec2 vUv;uniform sampler2D foamNoise;uniform float uTime;
   #include <fog_pars_fragment>
   void main(){vec2 p=(vUv-.5)*vec2(1.4,2.);float n=texture2D(foamNoise,vUv*2.2+vec2(0.,uTime*.03)).r*.7+texture2D(foamNoise,vUv*5.1-vec2(uTime*.02,0.)).r*.3;float edge=1.-smoothstep(.3,.85,length(p)+n*.2);float a=edge*smoothstep(.3,.78,n)*.5;gl_FragColor=vec4(.82,.95,.9,a);
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

 // --- Forest: fir cards on the shelves and lake shores, leafy shrubs on the banks, mossy boulders -------
 const bark = new THREE.MeshStandardMaterial({color: 0x6a5c48, roughness: 1});
 const twigColor = tex('waterfall/fir_tree_01_twig_diff_2k.jpg', true), twigAlpha = tex('waterfall/fir_tree_01_twig_alpha_2k.png');
 const leaf = new THREE.MeshStandardMaterial({map: twigColor, alphaMap: twigAlpha, alphaTest: .4, side: THREE.DoubleSide, roughness: .9, color: 0xffffff});
 materials.push(bark, leaf);
 const trunkGeo = new THREE.CylinderGeometry(.13, .32, 1, 6), leafGeo = new THREE.PlaneGeometry(1, 1); geometries.push(trunkGeo, leafGeo);
 const tuv = leafGeo.attributes.uv; for (let i = 0; i < tuv.count; i++) tuv.setXY(i, .64453125 + tuv.getX(i) * .302734375, .619140625 + tuv.getY(i) * .3486328125);
 const dummy = new THREE.Object3D();
 const slopeOk = (x, z, y, limit) => Math.abs(waterfallGroundHeight(x + 3, z) - y) + Math.abs(waterfallGroundHeight(x, z + 3) - y) < limit;
 const clusterTex = makeLeafClusterTexture(); textures.push(clusterTex);
 const shrubMat = new THREE.MeshStandardMaterial({map: clusterTex, alphaTest: .45, side: THREE.DoubleSide, roughness: .95}); materials.push(shrubMat);
 const roundGeo = new THREE.PlaneGeometry(1, 1); roundGeo.translate(0, .5, 0); geometries.push(roundGeo);
 const treeBatchCount = high ? 24 : 16, batches = Array.from({length: treeBatchCount}, () => []);
 let treeCount = 0;
 const treeTotal = high ? 1500 : 900;
 for (let i = 0; i < treeTotal; i++) {
  const z = 300 - hash(i, 33) * (300 - WORLD_END_Z), p = valleyProfile(z), side = i % 2 ? 1 : -1, w = riverWidth(z);
  const upper = z > CURTAIN_Z;
  // Upper plateau: forest shelves 260-900 m from the river; lower canyon: shores and lake slopes 60-520 m.
  const q = upper ? 230 + hash(i, 14) * 700 : 60 + hash(i, 14) * 470;
  const x = p.x + side * (w + q), y = waterfallGroundHeight(x, z);
  if (z < lip.z + 35 && z > CURTAIN_Z - 160) continue;
  if (!slopeOk(x, z, y, 11)) continue;
  const size = 11 + hash(i, 8) * 15;
  // Two species: tall firs (twig cards) and round broadleaf crowns (leaf-cluster cards) for a mixed forest.
  batches[Math.min(treeBatchCount - 1, Math.floor((300 - z) / (300 - WORLD_END_Z) * treeBatchCount))].push({x, y, z, size, seed: i, round: hash(i, 19) < .42});
  treeCount++;
 }
 batches.forEach((batch, bi) => {
  if (!batch.length) return;
  const firs = batch.filter(t => !t.round), rounds = batch.filter(t => t.round);
  const trees = new THREE.InstancedMesh(trunkGeo, bark, batch.length);
  batch.forEach((t, i) => {
   dummy.position.set(t.x, t.y + t.size * .5, t.z); dummy.scale.set(t.size * .32, t.size * (t.round ? .7 : 1), t.size * .32); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); trees.setMatrixAt(i, dummy.matrix);
  });
  trees.name = 'fixed-forest-trunks-' + bi; trees.computeBoundingSphere(); group.add(trees);
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
   leaves.name = 'fixed-forest-needles-' + bi; leaves.computeBoundingSphere(); group.add(leaves);
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
   crowns.name = 'fixed-forest-crowns-' + bi; crowns.computeBoundingSphere(); group.add(crowns);
  }
 });
 // Shrubs: leaf-cluster cards in a cross, on the banks and the gorge rim where the rider actually looks.
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
 const shrubTotal = high ? 900 : 500, shrubItems = [];
 for (let i = 0; i < shrubTotal; i++) {
  const z = 300 - hash(i, 71) * (300 - WORLD_END_Z), p = valleyProfile(z), side = i % 2 ? 1 : -1, w = riverWidth(z);
  const q = 4 + Math.pow(hash(i, 72), 1.6) * (z > CURTAIN_Z ? 330 : 420);
  const x = p.x + side * (w + q), y = waterfallGroundHeight(x, z);
  if (z < lip.z + 20 && z > CURTAIN_Z - 120) continue;
  // Shrubs grow on shores and shelves, never on the gorge walls (where they read as floating blobs).
  if (q > 55 && q < (z > CURTAIN_Z ? 250 : 330)) continue;
  if (!slopeOk(x, z, y, 7)) continue;
  shrubItems.push({x, y, z, size: 5 + hash(i, 73) * 9, seed: i});
 }
 if (shrubItems.length) {
  const shrubs = new THREE.InstancedMesh(crossGeo, shrubMat, shrubItems.length);
  shrubItems.forEach((s, i) => {
   dummy.position.set(s.x, s.y - .4, s.z); dummy.scale.set(s.size * 1.3, s.size, s.size * 1.3); dummy.rotation.set(0, hash(s.seed, 74) * 3.2, 0); dummy.updateMatrix(); shrubs.setMatrixAt(i, dummy.matrix);
   const t = hash(s.seed, 75); shrubs.setColorAt(i, new THREE.Color().setRGB(.62 + t * .3, .7 + t * .22, .5 + t * .25));
  });
  shrubs.name = 'fixed-shrubs'; shrubs.computeBoundingSphere(); group.add(shrubs);
 }
 // Mossy boulders along the shores (shared geometry, per-instance tint).
 const mossColor = tex('waterfall/mossy_rock_diff_1k.jpg', true), mossNormal = tex('waterfall/mossy_rock_nor_gl_1k.jpg'), mossArm = tex('waterfall/mossy_rock_arm_1k.jpg');
 const boulderMat = new THREE.MeshStandardMaterial({map: mossColor, normalMap: mossNormal, roughnessMap: mossArm, aoMap: mossArm, roughness: 1, metalness: 0}); materials.push(boulderMat);
 const boulderGeo = new THREE.IcosahedronGeometry(1, 2); geometries.push(boulderGeo);
 {
  const bp = boulderGeo.attributes.position;
  for (let i = 0; i < bp.count; i++) { const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i); const r = 1 + (noise3(x * 1.7 + 3, y * 1.7, z * 1.7) - .5) * .5; bp.setXYZ(i, x * r, y * r * .75, z * r); }
  boulderGeo.computeVertexNormals(); boulderGeo.setAttribute('uv2', boulderGeo.attributes.uv);
 }
 const boulderItems = [];
 for (let i = 0; i < (high ? 360 : 200); i++) {
  const z = 300 - hash(i, 81) * (300 - WORLD_END_Z), p = valleyProfile(z), side = i % 2 ? 1 : -1, w = riverWidth(z);
  const q = -6 + Math.pow(hash(i, 82), 1.8) * 260, x = p.x + side * (w + q), y = waterfallGroundHeight(x, z);
  if (z < lip.z + 20 && z > CURTAIN_Z - 150) continue;
  // Boulders rest on shores and shelves; a rock glued to a gorge wall looks stuck on, so the wall band is skipped.
  if (q > 55 && q < (z > CURTAIN_Z ? 250 : 330)) continue;
  if (q > 10 && !slopeOk(x, z, y, 9)) continue;
  boulderItems.push({x, y, z, size: 5 + Math.pow(hash(i, 83), 2) * 22, seed: i});
 }
 // Lake islands: big mossy rocks breaking the water between the totems and the finish.
 for (let i = 0; i < 7; i++) {
  const z = LAKE_Z - 60 - hash(i, 88) * 520, w = riverWidth(z), x = (hash(i, 89) - .5) * (w - 70) * 1.6;
  boulderItems.push({x, y: LOWER_WATER_Y - 6, z, size: 24 + hash(i, 90) * 22, seed: 900 + i});
 }
 if (boulderItems.length) {
  const boulders = new THREE.InstancedMesh(boulderGeo, boulderMat, boulderItems.length);
  boulderItems.forEach((b, i) => {
   dummy.position.set(b.x, b.y + b.size * .2, b.z); dummy.scale.set(b.size * (0.8 + hash(b.seed, 84) * .5), b.size, b.size * (0.8 + hash(b.seed, 85) * .5)); dummy.rotation.set(0, hash(b.seed, 86) * 6, 0); dummy.updateMatrix(); boulders.setMatrixAt(i, dummy.matrix);
   const t = hash(b.seed, 87); boulders.setColorAt(i, new THREE.Color().setRGB(.75 + t * .3, .8 + t * .25, .7 + t * .3));
  });
  boulders.name = 'fixed-boulders'; boulders.computeBoundingSphere(); group.add(boulders);
 }

 // --- Wisps: drifting lantern lights in the forest and over the lake ---------------------------------
 const glowTex = makeGlowTexture(); textures.push(glowTex);
 {
  const count = high ? 420 : 220, pos = [], seed = [];
  for (let i = 0; i < count; i++) {
   const z = 200 - hash(i, 91) * (200 - WORLD_END_Z), p = routeAt(0), prof = valleyProfile(z);
   const side = hash(i, 92) < .5 ? -1 : 1, x = prof.x + side * (20 + hash(i, 93) * 220);
   // Hover between 10 m and 90 m above the local water, skipping the vertical fall itself.
   if (z < lip.z + 40 && z > CURTAIN_Z - 200) continue;
   const water = z <= CURTAIN_Z ? LOWER_WATER_Y : prof.y;
   pos.push(x, water + 10 + hash(i, 94) * 80, z); seed.push(hash(i, 95) * 6.28, .6 + hash(i, 96), .3 + hash(i, 97) * .7);
   void p;
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

 // --- Birds: two slow flocks, one over the plateau gorge, one over the lake ---------------------------
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
 for (const [cx, cy, cz, radius] of [[0, UPPER_WATER_Y + 260, -1300, 260], [-60, LOWER_WATER_Y + 220, LAKE_Z - 150, 320]]) {
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
 const barkColor = tex('waterfall/bark_willow_02_diff_1k.jpg', true), barkNormal = tex('waterfall/bark_willow_02_nor_gl_1k.jpg');
 const vineMat = new THREE.MeshStandardMaterial({map: barkColor, normalMap: barkNormal, normalScale: new THREE.Vector2(1.2, 1.2), color: 0x9c8a6c, roughness: .95, metalness: 0});
 materials.push(vineMat);
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
 // Builds one portal: the ring lies in the XY plane and faces -Z (the game orients the group along the ring normal).
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

 // --- Hazard meshes: rock spires (gorge slalom) and carved totems on mossy islands (lower river) ---------
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
 function makeObstacleMesh(hazard) {
  const base = hazard.kind === 'totem' ? totemGeo : spireGeo;
  const geo = base.clone(); geometries.push(geo);
  const n = geo.attributes.position.count;
  geo.setAttribute('aWater', new THREE.BufferAttribute(new Float32Array(n).fill(hazard.base), 1));
  geo.setAttribute('aBank', new THREE.BufferAttribute(new Float32Array(n), 1));
  const m = new THREE.Mesh(geo, terrainMaterial); m.name = hazard.kind === 'totem' ? 'stone-totem' : 'rock-spire';
  return m;
 }

 // --- Collect bursts: an expanding glow when an orb is caught -------------------------------------------
 const burstMat = new THREE.SpriteMaterial({map: glowTex, color: 0x9dffc4, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending}); materials.push(burstMat);
 const bursts = [];
 for (let i = 0; i < 4; i++) { const s = new THREE.Sprite(burstMat.clone()); materials.push(s.material); s.visible = false; s.name = 'orb-burst'; group.add(s); bursts.push({sprite: s, t: 1, color: new THREE.Color()}); }
 function burst(position, colorHex = 0x9dffc4) {
  const b = bursts.reduce((best, x) => x.t >= 1 ? x : (best && best.t > x.t ? best : x), null) || bursts[0];
  b.t = 0; b.sprite.position.copy(position); b.sprite.material.color.setHex(colorHex); b.sprite.visible = true;
 }

 const ready = Promise.all(pending).then(() => { group.userData.assetsReady = true; });
 ready.catch(e => { group.userData.assetError = String(e?.message || e); });
 group.userData = {...group.userData, forestTrees: treeCount, shrubs: shrubItems.length, boulders: boulderItems.length, textureSize: high ? 2048 : 1024, stationary: true, portals: 0};

 // Highest rendered surface under the whole footprint (terrain and water cells), or -Infinity.
 function surfaceHeight(x, z, radius = 24) {
  let top = -Infinity;
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

 const _v = new THREE.Vector3();
 let lastTime = 0;
 function update(time, flight, camera) {
  const dt = clamp(time - lastTime, 0, .1); lastTime = time;
  riverUniforms.uTime.value = time;
  for (const u of animated) u.value = time;
  for (const s of sprites) { s.position.y = s.userData.base + Math.sin(time * .25 * s.userData.drift + s.userData.base) * 4 * s.userData.drift; }
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
 }

 function dispose() {
  for (const g of geometries) g.dispose(); for (const m of materials) m.dispose(); for (const t of textures) t.dispose();
  group.clear();
 }
 return {ready, terrainMaterial, textures, surfaceHeight, createPortal, makeObstacleMesh, burst, portals, update, dispose};
}

// ---------------------------------------------------------------------------------------------
// Sky: the canyon's film sky (kiara_8_sunset HDRI, storm-cloud wall, sun disc) with near-uniform fog
// so both the 1,940 m plateau and the river 1,600 m below sit in the same golden haze. The cloud ceiling
// stays above the plateau instead of following the rider down the fall.
// ---------------------------------------------------------------------------------------------
export function createWaterfallSky({scene, renderer}) {
 setFogConstants({falloff: .00035, start: 14, height: 0});
 fogUniforms.fogColor.value.setHex(0x5e7284);
 fogUniforms.fogDensity.value = .00052;
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
