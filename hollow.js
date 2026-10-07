// The Hollow (2026-10-07): a 7 km cave run through the mountain that opens the Emerald Falls course.
// Ledge outside -> throat (a winding crystal tunnel) -> cathedral (crystal pillars over a dark lake) -> vault
// (a lava river with fire geysers) -> root hall (giant roots, glowing fungus) -> shaft (a dive and a climb) ->
// gate (the climb back out to daylight and the Sky Isles). Everything is built once and cut into 400 m pieces
// along the route so the environment draws only the pieces around the dragon. Light inside is baked: every
// cave vertex stores the glow it receives from the crystals, fungus, lava and the two mouths (aLight), so the
// cave needs no runtime lights. Nothing here is player-relative; nothing is recycled.
import * as THREE from './vendor/three.module.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {hollowPath, HOLLOW_MOUTH, HOLLOW_EXIT, HOLLOW_WIND_RIVERS, HOLLOW_WIND_RADIUS, hollowWindPoint, HOLLOW_RING_CUES, ENTRY_TOP_Y} from './waterfall-core.js';

const clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const HOLLOW_STEP = 8;        // metres between tunnel rings
export const HOLLOW_PIECE_RINGS = 50; // rings per drawn piece (400 m)

const caveGLSL = `
 varying vec3 cPosition; varying vec3 cNormal;
 uniform sampler2D cliffColor, cliffNormal, cliffArm;
 #ifdef RICH_ROCK
 uniform sampler2D rock2Color, rock2Normal;
 #endif
 vec3 cWeights(vec3 n){vec3 w=pow(abs(n),vec3(5.));return w/max(dot(w,vec3(1.)),.001);}
 vec3 cSample(sampler2D t,vec3 p,vec3 w){return texture2D(t,p.zy).rgb*w.x+texture2D(t,p.xz).rgb*w.y+texture2D(t,p.xy).rgb*w.z;}
 vec3 cNormalTri(sampler2D t,vec3 p,vec3 w,vec3 n){
  vec3 a=texture2D(t,p.zy).xyz*2.-1.,b=texture2D(t,p.xz).xyz*2.-1.,c=texture2D(t,p.xy).xyz*2.-1.;
  a=vec3(a.xy+n.zy,abs(a.z)*n.x);b=vec3(b.xy+n.xz,abs(b.z)*n.y);c=vec3(c.xy+n.xy,abs(c.z)*n.z);
  return normalize(a.zyx*w.x+b.xzy*w.y+c.xyz*w.z);
 }
 vec3 cAlt(vec3 p){return vec3(-p.z,p.y,p.x)*1.31+vec3(37.,11.,53.);}
 float cNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  float a=fract(sin(dot(i,vec2(127.1,311.7)))*43758.5453),b=fract(sin(dot(i+vec2(1,0),vec2(127.1,311.7)))*43758.5453);
  float c=fract(sin(dot(i+vec2(0,1),vec2(127.1,311.7)))*43758.5453),d=fract(sin(dot(i+vec2(1,1),vec2(127.1,311.7)))*43758.5453);
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}`;

export function createHollow(ctx) {
 const {group, high, renderer, noise, noise3, hash, mesh, tex, textures, materials, geometries, terrainMaterial, withTerrainAttributes, fallMat, glowTex, maps, register, surfaces, CLOUD_SEA_Y, barkColor, barkNormal, fallNoise, animated} = ctx;
 const N = high ? 56 : 40;
 const dummy = new THREE.Object3D();
 const caveUniforms = {uFlicker: {value: 1}};
 const counts = {crystals: 0, stalactites: 0, roots: 0, fungus: 0, pieces: 0};

 // --- Baked light: glow sources, and the light any point receives from them --------------------------------
 const sources = [];
 function addSource(x, y, z, hex, radius, intensity, flicker = 0) { const c = new THREE.Color(hex); sources.push({x, y, z, r: c.r, g: c.g, b: c.b, radius, intensity, flicker}); }
 let sorted = null, maxRadius = 0;
 function lightAt(x, y, z, nx = 0, ny = 0, nz = 0) {
  if (!sorted) { sorted = sources.slice().sort((a, b) => a.z - b.z); for (const s of sorted) maxRadius = Math.max(maxRadius, s.radius); }
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid].z < z - maxRadius) lo = mid + 1; else hi = mid; }
  let r = 0, g = 0, b = 0, f = 0, total = 0;
  const facing = nx || ny || nz;
  for (let i = lo; i < sorted.length; i++) {
   const s = sorted[i]; if (s.z > z + maxRadius) break;
   const dx = s.x - x, dy = s.y - y, dz = s.z - z, d2 = dx * dx + dy * dy + dz * dz;
   if (d2 > s.radius * s.radius) continue;
   const d = Math.sqrt(d2);
   let k = s.intensity * (1 - smooth(s.radius * .5, s.radius, d)) / (1 + (d / (s.radius * .22)) ** 2);
   if (facing && d > 1e-3) k *= .3 + .7 * Math.max(0, (dx * nx + dy * ny + dz * nz) / d);
   r += s.r * k; g += s.g * k; b += s.b * k; total += k; f += s.flicker * k;
  }
  return [Math.min(1.5, r), Math.min(1.5, g), Math.min(1.5, b), total > 1e-4 ? f / total : 0];
 }
 // Light attribute for a finished (merged) geometry: one sample per vertex at its world position.
 function bakeLight(geo, toWorld = null, scaleSample = 1) {
  const p = geo.attributes.position, n = geo.attributes.normal, out = new Float32Array(p.count * 3), fl = new Float32Array(p.count), v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
   v.set(p.getX(i), p.getY(i), p.getZ(i)); if (toWorld) toWorld(v);
   const l = lightAt(v.x, v.y, v.z, n ? n.getX(i) : 0, n ? n.getY(i) : 0, n ? n.getZ(i) : 0);
   out[i * 3] = l[0] * scaleSample; out[i * 3 + 1] = l[1] * scaleSample; out[i * 3 + 2] = l[2] * scaleSample; fl[i] = l[3];
  }
  geo.setAttribute('aLight', new THREE.BufferAttribute(out, 3)); geo.setAttribute('aFlicker', new THREE.BufferAttribute(fl, 1));
  return geo;
 }

 // --- Materials ---------------------------------------------------------------------------------------------
 // caveLit(): any standard material gains the baked glow (aLight on plain meshes, the instance colour on
 // instanced meshes, where the instance colour is the light and no longer tints the surface).
 function caveLit(mat, key) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = s => {
   if (prev) prev(s);
   s.uniforms.uFlicker = caveUniforms.uFlicker;
   s.vertexShader = s.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec3 aLight;attribute float aFlicker;varying vec3 vCaveLight;varying float vCaveFlick;')
    .replace('#include <fog_vertex>', `#include <fog_vertex>
     #ifdef USE_INSTANCING_COLOR
      vCaveLight=instanceColor.rgb;vCaveFlick=0.;
     #else
      vCaveLight=aLight;vCaveFlick=aFlicker;
     #endif`);
   s.fragmentShader = s.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vCaveLight;varying float vCaveFlick;uniform float uFlicker;')
    .replace('#include <color_fragment>', '')
    .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.indirectDiffuse+=diffuseColor.rgb*vCaveLight*(1.+vCaveFlick*(uFlicker-1.));');
  };
  mat.customProgramCacheKey = () => 'hollow-' + key + '-v1';
  mat.envMapIntensity = .06;
  materials.push(mat);
  return mat;
 }
 // Cave rock: the cliff textures sampled three ways (no tile pattern), dark and wet, mossy near green light.
 function createCaveRockMaterial() {
  const mat = new THREE.MeshStandardMaterial({color: 0xffffff, roughness: .95, metalness: 0, fog: true});
  mat.onBeforeCompile = s => {
   Object.assign(s.uniforms, maps);
   s.defines = s.defines || {}; if (high && maps.rock2Color) s.defines.RICH_ROCK = 1;
   s.vertexShader = s.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 cPosition;varying vec3 cNormal;')
    .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
     vec4 cWp=vec4(transformed,1.);
     #ifdef USE_INSTANCING
      cWp=instanceMatrix*cWp;
     #endif
     cPosition=(modelMatrix*cWp).xyz;cNormal=normalize(transpose(mat3(viewMatrix))*normalize(transformedNormal));`);
   s.fragmentShader = s.fragmentShader
    .replace('#include <common>', '#include <common>\n' + caveGLSL)
    .replace('#include <map_fragment>', `
     vec3 gn=normalize(cNormal);vec3 tw=cWeights(gn);
     float tapMask=smoothstep(.3,.7,cNoise(cPosition.xz*.011+cPosition.y*.003));
     #ifdef RICH_ROCK
      vec3 stone=mix(cSample(rock2Color,cPosition/14.,tw),cSample(rock2Color,cAlt(cPosition)/14.,tw),tapMask);
      float region=smoothstep(.4,.6,cNoise(cPosition.xz*.003+cPosition.y*.002+5.3));
      stone=mix(stone,mix(cSample(cliffColor,cPosition/18.,tw),cSample(cliffColor,cAlt(cPosition)/18.,tw),tapMask),region*.7);
     #else
      vec3 stone=mix(cSample(cliffColor,cPosition/16.,tw),cSample(cliffColor,cAlt(cPosition)/16.,tw),tapMask);
     #endif
     vec3 fine=cSample(cliffColor,cPosition/3.2,tw);stone*=mix(vec3(1.),fine*1.9,.35);
     vec3 broad=cSample(cliffColor,cPosition/47.,tw);stone=mix(stone,stone*broad*2.,.4);
     float macro=.45+.55*cNoise(cPosition.xz*.004+cPosition.y*.004+3.);
     float wet=smoothstep(.6,.25,cNoise(cPosition.xz*.02+cPosition.y*.05+1.));
     vec3 tint=mix(vec3(.46,.43,.4),vec3(.26,.3,.34),wet)*macro;
     float greenish=clamp((vCaveLight.g-max(vCaveLight.r,vCaveLight.b))*3.,0.,1.);
     float mossy=smoothstep(.45,.8,cNoise(cPosition.xz*.04+cPosition.y*.03+2.))*greenish;
     tint=mix(tint,vec3(.3,.5,.2),mossy);
     diffuseColor.rgb*=stone*tint*2.1;
    `)
    .replace('#include <roughnessmap_fragment>', 'float roughnessFactor=mix(.95,.45,wet);')
    .replace('#include <normal_fragment_maps>', `
     #ifdef RICH_ROCK
      vec3 wn=mix(cNormalTri(rock2Normal,cPosition/14.,tw,gn),cNormalTri(rock2Normal,cAlt(cPosition)/14.,tw,gn),tapMask);
     #else
      vec3 wn=mix(cNormalTri(cliffNormal,cPosition/16.,tw,gn),cNormalTri(cliffNormal,cAlt(cPosition)/16.,tw,gn),tapMask);
     #endif
     normal=normalize((viewMatrix*vec4(normalize(wn),0.)).xyz);
    `)
    .replace('#include <aomap_fragment>', 'float ambientOcclusion=1.;reflectedLight.indirectDiffuse*=ambientOcclusion;');
  };
  return caveLit(mat, 'rock-' + (high ? 'high' : 'phone'));
 }
 const caveRock = createCaveRockMaterial();
 // Roots and vines: the willow bark textures, lit by the cave glow.
 const rootMat = caveLit(new THREE.MeshStandardMaterial({map: barkColor, normalMap: barkNormal, normalScale: new THREE.Vector2(1.1, 1.1), color: 0x8c7b60, roughness: .95, metalness: 0}), 'root');
 // Crystals and fungus: lit from inside (emissive), tinted per instance, with a bright rim.
 function glowMaterial(colorHex, key, rim = .9) {
  const mat = new THREE.MeshStandardMaterial({color: colorHex, emissive: 0xffffff, emissiveIntensity: .9, roughness: .2, metalness: 0, envMapIntensity: .25, fog: true});
  mat.onBeforeCompile = s => {
   // Faint bands along the crystal's length (vGlowY is the height in the crystal's own frame) and a bright rim.
   s.vertexShader = s.vertexShader
    .replace('#include <common>', '#include <common>\nvarying float vGlowY;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlowY=position.y;');
   s.fragmentShader = s.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vGlowY;')
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
    totalEmissiveRadiance*=.78+.3*smoothstep(.3,.7,fract(vGlowY*6.3));
    #if defined(USE_INSTANCING_COLOR)||defined(USE_COLOR)
     totalEmissiveRadiance*=vColor;
     float glowRim=pow(1.-clamp(dot(normalize(vViewPosition),normal),0.,1.),3.);
     totalEmissiveRadiance+=vColor*glowRim*${rim.toFixed(2)};
    #endif`);
  };
  mat.customProgramCacheKey = () => 'hollow-glow-' + key;
  materials.push(mat);
  return mat;
 }
 const crystalMat = glowMaterial(0xdcf4ff, 'crystal'), fungusMat = glowMaterial(0xcfffd8, 'fungus', .5);

 // --- The tunnel surface -------------------------------------------------------------------------------------
 function radialBump(px, py, pz) { return 1 + (noise3(px * .012 + 3, py * .012, pz * .012) - .5) * .22 + (noise3(px * .045, py * .045 + 7, pz * .045) - .5) * .08; }
 // The tunnel wall point at distance d and angle a (0 = right wall, PI/2 = ceiling, -PI/2 = floor).
 function wallPoint(d, a) {
  const p = hollowPath(d), cx = p.x + Math.cos(a) * p.r, cy = p.y + Math.sin(a) * p.r;
  const b = radialBump(cx, cy, -d);
  let x = p.x + Math.cos(a) * p.r * b, y = p.y + Math.sin(a) * p.r * b;
  const onFloor = y < p.floor;
  if (onFloor) y = p.floor - (p.floor - y) * .12 + 3 * noise(x * .07, d * .07);
  return {x, y, z: -d + (noise3(x * .03, y * .03, d * .03) - .5) * 6, path: p, angle: a, onFloor};
 }
 const ringD = []; for (let d = HOLLOW_MOUTH; d <= HOLLOW_EXIT + 40; d += HOLLOW_STEP) ringD.push(d);
 const R = ringD.length, V = R * N;
 const tubePos = new Float32Array(V * 3);
 for (let i = 0; i < R; i++) for (let j = 0; j < N; j++) {
  const w = wallPoint(ringD[i], j / N * Math.PI * 2), k = (i * N + j) * 3;
  tubePos[k] = w.x; tubePos[k + 1] = w.y; tubePos[k + 2] = w.z;
 }
 const tubeIndex = [];
 for (let i = 0; i < R - 1; i++) for (let j = 0; j < N; j++) { const a = i * N + j, b = i * N + (j + 1) % N, c = a + N, d = b + N; tubeIndex.push(a, b, c, b, d, c); }
 const whole = new THREE.BufferGeometry();
 whole.setAttribute('position', new THREE.BufferAttribute(tubePos, 3)); whole.setIndex(tubeIndex); whole.computeVertexNormals();
 {
  // Normals must face into the tunnel (the camera is inside). Check one wall vertex and flip the winding if not.
  const p0 = hollowPath(ringD[2]), nrm = whole.attributes.normal, k = 2 * N;
  const toCentre = (p0.x - tubePos[k * 3]) * nrm.getX(k) + (p0.y - tubePos[k * 3 + 1]) * nrm.getY(k);
  if (toCentre < 0) { for (let t = 0; t < tubeIndex.length; t += 3) { const tmp = tubeIndex[t + 1]; tubeIndex[t + 1] = tubeIndex[t + 2]; tubeIndex[t + 2] = tmp; } whole.setIndex(tubeIndex); whole.computeVertexNormals(); }
 }

 // --- Glow sources, placed before any light is baked ---------------------------------------------------------
 const zoneOf = d => hollowPath(d).zone;
 const palettes = {throat: [0x5ee6ff, 0x7ad8ff, 0x9ff2ff], cathedral: [0xb48cff, 0x5ee6ff, 0xd6a8ff, 0x7ad8ff], vault: [0xff9a4a, 0xffb866], shaft: [0x9ad8ff, 0xc8f0ff], gate: [0x7dffa8, 0xa8ffc8]};
 const crystalClusters = [];
 function placeCrystals(zone, count, dFrom, dTo, salt, lowerOnly = false) {
  for (let i = 0; i < count; i++) {
   const d = dFrom + hash(i, salt) * (dTo - dFrom), a = lowerOnly ? -Math.PI * (.2 + hash(i, salt + 1) * .6) : hash(i, salt + 1) * Math.PI * 2;
   const w = wallPoint(d, a), size = 5 + Math.pow(hash(i, salt + 2), 1.5) * 18;
   const hex = palettes[zone][Math.floor(hash(i, salt + 3) * palettes[zone].length)];
   const nx = w.path.x - w.x, ny = w.path.y - w.y, nl = Math.hypot(nx, ny) || 1;
   crystalClusters.push({x: w.x, y: w.y, z: w.z, nx: nx / nl, ny: ny / nl, size, hex, seed: i * 7 + salt, d});
   addSource(w.x + nx / nl * size * .6, w.y + ny / nl * size * .6, w.z, hex, 70 + size * 7, .4 + size * .035);
  }
 }
 placeCrystals('throat', high ? 30 : 15, 700, 1860, 301);
 placeCrystals('cathedral', high ? 64 : 32, 1950, 3060, 311);
 placeCrystals('vault', high ? 12 : 6, 3160, 4240, 321);
 placeCrystals('shaft', high ? 26 : 13, 5540, 6180, 331);
 placeCrystals('gate', high ? 16 : 8, 6240, 6820, 341);
 const fungi = [];
 for (let i = 0; i < (high ? 72 : 36); i++) {
  const d = 4340 + hash(i, 351) * 1110, a = (hash(i, 352) < .5 ? 0 : Math.PI) + (hash(i, 353) - .5) * 1.1, w = wallPoint(d, a);
  const size = 3 + hash(i, 354) * 6, hex = [0x6cff8a, 0x9dffb0, 0x5ce8c0][i % 3];
  const nx = w.path.x - w.x, ny = w.path.y - w.y, nl = Math.hypot(nx, ny) || 1;
  fungi.push({x: w.x, y: w.y, z: w.z, nx: nx / nl, ny: ny / nl, size, hex, seed: i});
  addSource(w.x + nx / nl * size, w.y + ny / nl * size, w.z, hex, 60 + size * 6, .35 + size * .04);
 }
 // Lava: a line of warm, flickering light along the vault floor.
 for (let d = 3120; d <= 4280; d += 40) { const p = hollowPath(d); addSource(p.x, p.floor + 3, -d, 0xff5a14, 170, 1.4, 1); }
 // Daylight at both mouths, the orbs' own glow, and a faint cool fill so no wall is pure black.
 addSource(0, ENTRY_TOP_Y, -HOLLOW_MOUTH, 0xffd2a8, 520, .9); addSource(0, ENTRY_TOP_Y, -HOLLOW_EXIT, 0xffd2a8, 520, .9);
 // Giant crystals standing in the cathedral lake: landmarks that light the whole chamber.
 const giants = [];
 for (let i = 0; i < (high ? 9 : 5); i++) {
  const d = 2020 + hash(i, 361) * 1000, p = hollowPath(d), side = i % 2 ? 1 : -1, x = p.x + side * (150 + hash(i, 362) * 110), h = 70 + hash(i, 363) * 90;
  const hex = [0xb48cff, 0x5ee6ff, 0xd6a8ff][i % 3];
  giants.push({x, y: p.floor - 6, z: -d, h, w: h * (.11 + hash(i, 364) * .06), hex, seed: 700 + i, d});
  addSource(x, p.floor + h * .5, -d, hex, 340, 1.3);
 }
 for (const [d, across, up] of HOLLOW_RING_CUES) { const p = hollowPath(d); addSource(p.x + across, p.y + up, -d, 0x5cff9a, 80, .45); }
 for (let d = HOLLOW_MOUTH; d <= HOLLOW_EXIT; d += 120) { const p = hollowPath(d); addSource(p.x, p.y, -d, 0x4a6a7a, p.r * 2.2, .09); }
 for (let d = 1950; d <= 3050; d += 150) { const p = hollowPath(d); addSource(p.x, p.y, -d, 0x6a4a9a, 460, .16); }

 // --- Tunnel pieces with baked light ------------------------------------------------------------------------
 const tubeNormal = whole.attributes.normal;
 const tubeLight = new Float32Array(V * 3), tubeFlick = new Float32Array(V);
 for (let i = 0; i < V; i++) {
  const l = lightAt(tubePos[i * 3], tubePos[i * 3 + 1], tubePos[i * 3 + 2], tubeNormal.getX(i), tubeNormal.getY(i), tubeNormal.getZ(i));
  tubeLight[i * 3] = l[0]; tubeLight[i * 3 + 1] = l[1]; tubeLight[i * 3 + 2] = l[2]; tubeFlick[i] = l[3];
 }
 const pieceOf = ringIndex => Math.min(Math.ceil(R / HOLLOW_PIECE_RINGS) - 1, Math.floor(ringIndex / HOLLOW_PIECE_RINGS));
 const pieceCount = Math.ceil((R - 1) / HOLLOW_PIECE_RINGS);
 for (let k = 0; k < pieceCount; k++) {
  const r0 = k * HOLLOW_PIECE_RINGS, r1 = Math.min(R - 1, r0 + HOLLOW_PIECE_RINGS), from = r0 * N, to = (r1 + 1) * N;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(tubePos.slice(from * 3, to * 3), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(tubeNormal.array.slice(from * 3, to * 3), 3));
  geo.setAttribute('aLight', new THREE.BufferAttribute(tubeLight.slice(from * 3, to * 3), 3));
  geo.setAttribute('aFlicker', new THREE.BufferAttribute(tubeFlick.slice(from, to), 1));
  const idx = [];
  for (let i = r0; i < r1; i++) for (let j = 0; j < N; j++) { const a = (i - r0) * N + j, b = (i - r0) * N + (j + 1) % N, c = a + N, d = b + N; idx.push(a, b, c, b, d, c); }
  // keep the winding the whole tube settled on
  if (tubeIndex[1] === tubeIndex[0] + N) for (let t = 0; t < idx.length; t += 3) { const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp; }
  geo.setIndex(idx);
  const m = mesh(geo, caveRock, 'hollow-tunnel-' + k); m.frustumCulled = true;
  register(m, -ringD[r0], -ringD[r1], 'terrain');
  counts.pieces++;
 }
 whole.dispose();

 // --- Stalactites, stalagmites and the mouths' fangs (instanced cones, one mesh per piece) -----------------------
 const stalactiteGeo = new THREE.ConeGeometry(1, 1, 7, 1); stalactiteGeo.rotateX(Math.PI); stalactiteGeo.translate(0, -.5, 0); geometries.push(stalactiteGeo);
 const stalagmiteGeo = new THREE.ConeGeometry(1, 1, 7, 1); stalagmiteGeo.translate(0, .5, 0); geometries.push(stalagmiteGeo);
 const spikes = Array.from({length: pieceCount}, () => ({down: [], up: []}));
 function addSpike(list, w, length, width, seed) {
  dummy.position.set(w.x, w.y, w.z); dummy.scale.set(width, length, width); dummy.rotation.set((hash(seed, 1) - .5) * .3, hash(seed, 2) * 6.3, (hash(seed, 3) - .5) * .3); dummy.updateMatrix();
  const l = lightAt(w.x, w.y, w.z);
  list.push({matrix: dummy.matrix.clone(), color: new THREE.Color(l[0], l[1], l[2])});
 }
 for (let i = 0; i < R; i += 2) {
  const d = ringD[i], zone = zoneOf(d), piece = pieceOf(i);
  const n = hash(i, 401) < .4 ? 0 : 1 + Math.floor(hash(i, 402) * 3);
  for (let k = 0; k < n; k++) {
   const a = Math.PI * (.3 + hash(i * 3 + k, 403) * .4), w = wallPoint(d, a), r = w.path.r;
   const length = r * (.07 + Math.pow(hash(i + k, 404), 2) * .3), width = length * (.1 + hash(i + k, 405) * .12);
   addSpike(spikes[piece].down, w, length, width, i * 11 + k); counts.stalactites++;
  }
  if ((zone === 'throat' || zone === 'roots' || zone === 'shaft' || zone === 'gate') && hash(i, 406) < .5) {
   const a = -Math.PI * (.3 + hash(i, 407) * .4), w = wallPoint(d, a), r = w.path.r;
   const length = r * (.05 + Math.pow(hash(i, 408), 2) * .22), width = length * (.14 + hash(i, 409) * .12);
   addSpike(spikes[piece].up, w, length, width, i * 13 + 5); counts.stalactites++;
  }
 }
 // Big fangs round both mouths.
 for (const [i0, salt] of [[0, 421], [R - 7, 431]]) for (let k = 0; k < 9; k++) {
  const i = i0 + Math.floor(hash(k, salt) * 6), d = ringD[i], a = Math.PI * (.2 + hash(k, salt + 1) * .6), w = wallPoint(d, a), r = w.path.r;
  addSpike(spikes[pieceOf(i)].down, w, r * (.25 + hash(k, salt + 2) * .2), r * .06, k * 17 + salt); counts.stalactites++;
 }
 spikes.forEach((s, k) => {
  for (const [list, geo, name] of [[s.down, stalactiteGeo, 'stalactites'], [s.up, stalagmiteGeo, 'stalagmites']]) {
   if (!list.length) continue;
   const im = new THREE.InstancedMesh(geo, caveRock, list.length);
   list.forEach((it, i) => { im.setMatrixAt(i, it.matrix); im.setColorAt(i, it.color); });
   im.name = 'hollow-' + name + '-' + k; im.computeBoundingSphere(); group.add(im);
   register(im, -ringD[k * HOLLOW_PIECE_RINGS], -ringD[Math.min(R - 1, (k + 1) * HOLLOW_PIECE_RINGS)], 'detail');
  }
 });

 // --- Crystals (hex prisms with a pointed tip) and glow points ---------------------------------------------------
 const prism = new THREE.CylinderGeometry(.55, .75, 1, 6, 1, false); prism.translate(0, .5, 0);
 const tip = new THREE.ConeGeometry(.55, .4, 6); tip.translate(0, 1.2, 0);
 const crystalGeo = mergeGeometries([prism, tip], false); prism.dispose(); tip.dispose(); geometries.push(crystalGeo);
 const crystalPieces = Array.from({length: pieceCount}, () => []), glowPieces = Array.from({length: pieceCount}, () => []);
 const up = new THREE.Vector3(0, 1, 0), axis = new THREE.Vector3(), qAlign = new THREE.Quaternion(), qTilt = new THREE.Quaternion(), euler = new THREE.Euler();
 for (const c of crystalClusters) {
  const piece = pieceOf(Math.round((c.d - HOLLOW_MOUTH) / HOLLOW_STEP));
  axis.set(c.nx, c.ny, 0).normalize(); qAlign.setFromUnitVectors(up, axis);
  const count = 3 + Math.floor(hash(c.seed, 441) * 4), tx = -c.ny, ty = c.nx;
  const col = new THREE.Color(c.hex);
  for (let k = 0; k < count; k++) {
   const h = c.size * (.5 + hash(c.seed + k, 442) * .9), w = h * (.16 + hash(c.seed + k, 443) * .14);
   const along = (hash(c.seed + k, 444) - .5) * c.size * .9, deep = (hash(c.seed + k, 445) - .5) * c.size * .5;
   euler.set((hash(c.seed + k, 446) - .5) * 1.1, hash(c.seed + k, 447) * 6.3, (hash(c.seed + k, 448) - .5) * 1.1); qTilt.setFromEuler(euler);
   dummy.position.set(c.x + tx * along - c.nx * 2, c.y + ty * along - c.ny * 2, c.z + deep); dummy.quaternion.copy(qAlign).multiply(qTilt); dummy.scale.set(w, h, w); dummy.updateMatrix();
   const v = .75 + hash(c.seed + k, 449) * .5;
   crystalPieces[piece].push({matrix: dummy.matrix.clone(), color: new THREE.Color(col.r * v, col.g * v, col.b * v)});
   counts.crystals++;
  }
  glowPieces[piece].push({x: c.x + c.nx * c.size * .5, y: c.y + c.ny * c.size * .5, z: c.z, size: c.size * 4.5, color: col, seed: c.seed});
 }
 for (const g of giants) {
  const piece = pieceOf(Math.round((g.d - HOLLOW_MOUTH) / HOLLOW_STEP)), col = new THREE.Color(g.hex);
  for (let k = 0; k < 3; k++) {
   const h = g.h * (k ? .45 + hash(g.seed + k, 371) * .3 : 1), w = k ? g.w * .6 : g.w;
   euler.set((hash(g.seed + k, 372) - .5) * (k ? .5 : .12), hash(g.seed + k, 373) * 6.3, (hash(g.seed + k, 374) - .5) * (k ? .5 : .12)); qTilt.setFromEuler(euler);
   dummy.position.set(g.x + (k ? (hash(g.seed + k, 375) - .5) * g.w * 2.5 : 0), g.y, g.z + (k ? (hash(g.seed + k, 376) - .5) * g.w * 2.5 : 0)); dummy.quaternion.copy(qTilt); dummy.scale.set(w, h, w); dummy.updateMatrix();
   crystalPieces[piece].push({matrix: dummy.matrix.clone(), color: col.clone().multiplyScalar(.9 + hash(g.seed + k, 377) * .3)});
   counts.crystals++;
  }
  glowPieces[piece].push({x: g.x, y: g.y + g.h * .6, z: g.z, size: g.h * 1.6, color: col, seed: g.seed});
 }
 const fungusGeo = new THREE.CylinderGeometry(1, 1.15, .22, 12); geometries.push(fungusGeo);
 const fungusPieces = Array.from({length: pieceCount}, () => []);
 for (const f of fungi) {
  const piece = pieceOf(Math.round((-f.z - HOLLOW_MOUTH) / HOLLOW_STEP)), col = new THREE.Color(f.hex);
  for (let k = 0; k < 3; k++) {
   const s = f.size * (1 - k * .28);
   dummy.position.set(f.x + f.nx * s * .55, f.y + f.ny * s * .55 + k * s * .5 + (hash(f.seed + k, 451) - .5) * 3, f.z + (hash(f.seed + k, 452) - .5) * 4);
   dummy.rotation.set((hash(f.seed + k, 453) - .5) * .4, 0, (hash(f.seed + k, 454) - .5) * .4); dummy.scale.set(s, 1, s); dummy.updateMatrix();
   fungusPieces[piece].push({matrix: dummy.matrix.clone(), color: col.clone().multiplyScalar(.6 + hash(f.seed + k, 455) * .5)});
   counts.fungus++;
  }
  glowPieces[piece].push({x: f.x + f.nx * f.size, y: f.y + f.ny * f.size, z: f.z, size: f.size * 5, color: col, seed: f.seed + 900});
 }
 const glowMat = new THREE.ShaderMaterial({transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
  uniforms: {...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: {value: 0}, uMap: {value: glowTex}, uScale: {value: 700}},
  vertexShader: `attribute float aSize;attribute vec3 aColor;attribute float aSeed;uniform float uTime;uniform float uScale;varying vec3 vColor;varying float vPulse;
   #include <fog_pars_vertex>
   void main(){vec4 mvPosition=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mvPosition;
    vPulse=.8+.2*sin(uTime*1.3+aSeed*5.);gl_PointSize=aSize*uScale/max(1.,-mvPosition.z)*vPulse;vColor=aColor;
   #include <fog_vertex>
   }`,
  fragmentShader: `uniform sampler2D uMap;varying vec3 vColor;varying float vPulse;
   #include <fog_pars_fragment>
   void main(){vec4 t=texture2D(uMap,gl_PointCoord);gl_FragColor=vec4(vColor*1.3*vPulse,t.a*.55);
   #include <fog_fragment>
   #include <tonemapping_fragment>
   #include <colorspace_fragment>
   }`});
 materials.push(glowMat); animated.push(glowMat.uniforms.uTime);
 for (let k = 0; k < pieceCount; k++) {
  const zNear = -ringD[k * HOLLOW_PIECE_RINGS], zFar = -ringD[Math.min(R - 1, (k + 1) * HOLLOW_PIECE_RINGS)];
  if (crystalPieces[k].length) {
   const im = new THREE.InstancedMesh(crystalGeo, crystalMat, crystalPieces[k].length);
   crystalPieces[k].forEach((it, i) => { im.setMatrixAt(i, it.matrix); im.setColorAt(i, it.color); });
   im.name = 'hollow-crystals-' + k; im.computeBoundingSphere(); group.add(im); register(im, zNear, zFar, 'detail');
  }
  if (fungusPieces[k].length) {
   const im = new THREE.InstancedMesh(fungusGeo, fungusMat, fungusPieces[k].length);
   fungusPieces[k].forEach((it, i) => { im.setMatrixAt(i, it.matrix); im.setColorAt(i, it.color); });
   im.name = 'hollow-fungus-' + k; im.computeBoundingSphere(); group.add(im); register(im, zNear, zFar, 'detail');
  }
  if (glowPieces[k].length) {
   const pos = [], size = [], col = [], seed = [];
   for (const g of glowPieces[k]) { pos.push(g.x, g.y, g.z); size.push(g.size); col.push(g.color.r, g.color.g, g.color.b); seed.push(hash(g.seed, 461) * 6.3); }
   const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1)); geo.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3)); geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1)); geometries.push(geo);
   const pts = new THREE.Points(geo, glowMat); pts.name = 'hollow-glow-' + k; geo.computeBoundingSphere(); group.add(pts); register(pts, zNear, zFar, 'detail');
  }
 }

 // --- The cathedral lake ------------------------------------------------------------------------------------------
 let lakeY = Infinity; for (let d = 1950; d <= 3060; d += 10) lakeY = Math.min(lakeY, hollowPath(d).floor); lakeY += 2;
 const waterNormal = ctx.waterNormal || tex('water_normal_512.png');
 const lakeMat = new THREE.ShaderMaterial({fog: true,
  uniforms: {...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: {value: 0}, uNormal: {value: waterNormal}},
  vertexShader: `attribute vec3 aLight;varying vec3 vW;varying vec3 vL;
   #include <fog_pars_vertex>
   void main(){vW=(modelMatrix*vec4(position,1.)).xyz;vL=aLight;vec4 mvPosition=viewMatrix*vec4(vW,1.);gl_Position=projectionMatrix*mvPosition;
   #include <fog_vertex>
   }`,
  fragmentShader: `uniform float uTime;uniform sampler2D uNormal;varying vec3 vW;varying vec3 vL;
   #include <fog_pars_fragment>
   void main(){
    vec3 n1=texture2D(uNormal,vW.xz*.02+uTime*vec2(.01,.013)).xyz*2.-1.;
    vec3 n2=texture2D(uNormal,vW.xz*.047-uTime*vec2(.017,.006)).xyz*2.-1.;
    vec3 n=normalize(vec3(n1.x+n2.x,7.,n1.y+n2.y));
    vec3 v=normalize(cameraPosition-vW);
    float fres=pow(1.-max(dot(n,v),0.),4.);
    vec3 refl=reflect(-v,n);
    float spark=pow(max(refl.y,0.),40.);
    float ripple=clamp((n1.x*n1.x+n2.y*n2.y)*1.6,0.,1.);
    vec3 L=vL*3.5;
    vec3 col=vec3(.012,.035,.05)+L*(.16+fres*.6)+L*spark*.8+L*vec3(.4,.55,.65)*ripple*.35;
    gl_FragColor=vec4(col,1.);
   #include <fog_fragment>
   #include <tonemapping_fragment>
   #include <colorspace_fragment>
   }`});
 materials.push(lakeMat); animated.push(lakeMat.uniforms.uTime);
 {
  const geo = new THREE.PlaneGeometry(680, 1220, 20, 40); geo.rotateX(-Math.PI / 2); geo.translate(0, lakeY, -2500);
  bakeLight(geo, v => { v.y += 14; });
  const m = mesh(geo, lakeMat, 'hollow-lake'); register(m, -1890, -3110, 'terrain');
 }

 // --- The lava river and its embers ---------------------------------------------------------------------------------
 const lavaMat = new THREE.ShaderMaterial({fog: true,
  uniforms: {...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: {value: 0}, uNoise: {value: fallNoise}},
  vertexShader: `varying vec3 vW;
   #include <fog_pars_vertex>
   void main(){vW=(modelMatrix*vec4(position,1.)).xyz;vec4 mvPosition=viewMatrix*vec4(vW,1.);gl_Position=projectionMatrix*mvPosition;
   #include <fog_vertex>
   }`,
  fragmentShader: `uniform float uTime;uniform sampler2D uNoise;varying vec3 vW;
   #include <fog_pars_fragment>
   void main(){
    vec2 p=vW.xz;
    float n1=texture2D(uNoise,p*.0035+vec2(0.,uTime*.012)).r;
    float n2=texture2D(uNoise,p*.011+vec2(.3,-uTime*.02)).r;
    float n3=texture2D(uNoise,p*.03+vec2(uTime*.01,.7)).r;
    float crust=smoothstep(.33,.5,n1*.55+n2*.35+n3*.1);
    vec3 hot=vec3(1.2,.42,.07),glow=vec3(1.,.28,.04),dark=vec3(.06,.02,.012);
    vec3 col=mix(hot,dark,crust);
    col+=glow*smoothstep(.55,.9,n3)*(1.-crust)*.5;
    col*=.85+.15*sin(uTime*3.+n2*9.);
    gl_FragColor=vec4(col,1.);
   #include <fog_fragment>
   #include <tonemapping_fragment>
   #include <colorspace_fragment>
   }`});
 materials.push(lavaMat); animated.push(lavaMat.uniforms.uTime);
 {
  const pos = [], idx = []; let row = 0;
  for (let d = 3110; d <= 4290; d += 20) {
   const p = hollowPath(d), w = p.r * .93, y = p.floor + 3 + (d < 3160 ? (3160 - d) * .3 : 0) + (d > 4240 ? (d - 4240) * .3 : 0);
   pos.push(p.x - w, y, -d, p.x + w, y, -d);
   if (row) { const a = (row - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
   row++;
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  const m = mesh(geo, lavaMat, 'hollow-lava'); register(m, -3100, -4300, 'terrain');
 }
 const emberMat = new THREE.ShaderMaterial({transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
  uniforms: {...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: {value: 0}, uMap: {value: glowTex}, uScale: {value: 700}},
  vertexShader: `attribute vec3 aSeed;uniform float uTime;uniform float uScale;varying float vFade;
   #include <fog_pars_vertex>
   void main(){vec3 p=position;float h=mod(aSeed.x*240.+uTime*(14.+aSeed.y*12.),240.);p.y+=h;p.x+=sin(uTime*.8+aSeed.z*6.)*8.;p.z+=cos(uTime*.6+aSeed.z*4.)*6.;
    vec4 mvPosition=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mvPosition;vFade=1.-h/240.;
    gl_PointSize=(1.6+aSeed.z*2.4)*uScale/max(1.,-mvPosition.z);
   #include <fog_vertex>
   }`,
  fragmentShader: `uniform sampler2D uMap;varying float vFade;
   #include <fog_pars_fragment>
   void main(){vec4 t=texture2D(uMap,gl_PointCoord);gl_FragColor=vec4(vec3(1.,.42,.1)*1.2,t.a*vFade*.55);
   #include <fog_fragment>
   #include <tonemapping_fragment>
   #include <colorspace_fragment>
   }`});
 materials.push(emberMat); animated.push(emberMat.uniforms.uTime);
 {
  const pos = [], seed = [];
  for (let i = 0; i < (high ? 420 : 160); i++) { const d = 3140 + hash(i, 471) * 1120, p = hollowPath(d); pos.push(p.x + (hash(i, 472) - .5) * p.r * 1.5, p.floor + 4, -d); seed.push(hash(i, 473), hash(i, 474), hash(i, 475)); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 3)); geometries.push(geo);
  const pts = new THREE.Points(geo, emberMat); pts.name = 'hollow-embers'; pts.frustumCulled = false; group.add(pts); register(pts, -3100, -4300, 'detail');
 }

 // --- Roots: columns from ceiling to floor and tendrils hanging from the ceiling, merged per piece -----------------
 function tubeAlong(points, radius, segments = 28) {
  const curve = new THREE.CatmullRomCurve3(points), geo = new THREE.TubeGeometry(curve, segments, radius, 8, false);
  const len = curve.getLength(), uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / 9, uv.getY(i) * 2);
  return geo;
 }
 const rootPieces = Array.from({length: pieceCount}, () => []);
 for (let i = 0; i < (high ? 30 : 16); i++) {
  const d = 4360 + hash(i, 481) * 1090, top = wallPoint(d, Math.PI * (.3 + hash(i, 482) * .4)), bottom = wallPoint(d + (hash(i, 483) - .5) * 60, -Math.PI * (.3 + hash(i, 484) * .4));
  const pts = [new THREE.Vector3(top.x, top.y + 3, top.z)];
  for (let k = 1; k <= 3; k++) { const t = k / 4; pts.push(new THREE.Vector3(lerp(top.x, bottom.x, t) + Math.sin(k * 2.1 + i) * 26, lerp(top.y, bottom.y, t), lerp(top.z, bottom.z, t) + Math.cos(k * 1.7 + i) * 22)); }
  pts.push(new THREE.Vector3(bottom.x, bottom.y - 3, bottom.z));
  rootPieces[pieceOf(Math.round((d - HOLLOW_MOUTH) / HOLLOW_STEP))].push(tubeAlong(pts, 3 + hash(i, 485) * 4)); counts.roots++;
 }
 for (let i = 0; i < (high ? 70 : 34); i++) {
  const d = 4340 + hash(i, 491) * 1120, top = wallPoint(d, Math.PI * (.25 + hash(i, 492) * .5)), len = 30 + hash(i, 493) * 90, sway = 8 + hash(i, 494) * 18;
  const pts = [new THREE.Vector3(top.x, top.y + 2, top.z)];
  for (let k = 1; k <= 4; k++) pts.push(new THREE.Vector3(top.x + Math.sin(k * 1.9 + i) * sway * k / 4, top.y - len * k / 4, top.z + Math.cos(k * 1.3 + i) * sway * k / 4));
  rootPieces[pieceOf(Math.round((d - HOLLOW_MOUTH) / HOLLOW_STEP))].push(tubeAlong(pts, 1.2 + hash(i, 495) * 1.6, 20)); counts.roots++;
 }
 // Vines over both mouths, hanging from the top arc.
 for (const [d0, salt] of [[HOLLOW_MOUTH + 6, 501], [HOLLOW_EXIT - 6, 511]]) for (let k = 0; k < 9; k++) {
  const top = wallPoint(d0 + (hash(k, salt) - .5) * 40, Math.PI * (.3 + hash(k, salt + 1) * .4)), len = 40 + hash(k, salt + 2) * 130, sway = 10 + hash(k, salt + 3) * 14;
  const pts = [new THREE.Vector3(top.x, top.y + 2, top.z)];
  for (let j = 1; j <= 4; j++) pts.push(new THREE.Vector3(top.x + Math.sin(j * 1.7 + k) * sway * j / 4, top.y - len * j / 4, top.z + Math.cos(j * 1.3 + k) * sway * j / 4));
  rootPieces[pieceOf(Math.round((d0 - HOLLOW_MOUTH) / HOLLOW_STEP))].push(tubeAlong(pts, 1.4 + hash(k, salt + 4) * 1.2, 20)); counts.roots++;
 }
 rootPieces.forEach((list, k) => {
  if (!list.length) return;
  const geo = mergeGeometries(list, false); for (const g of list) g.dispose();
  bakeLight(geo);
  const m = mesh(geo, rootMat, 'hollow-roots-' + k); register(m, -ringD[k * HOLLOW_PIECE_RINGS], -ringD[Math.min(R - 1, (k + 1) * HOLLOW_PIECE_RINGS)], 'detail');
 });

 // --- Wind rivers: glowing ribbons of air with sliding streaks; riding one gives a steady boost ---------------------
 const windMat = new THREE.ShaderMaterial({transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: true,
  uniforms: {...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: {value: 0}},
  vertexShader: `varying vec2 vUv;varying vec3 vW;varying vec3 vN;
   #include <fog_pars_vertex>
   void main(){vUv=uv;vW=(modelMatrix*vec4(position,1.)).xyz;vN=normalize(mat3(modelMatrix)*normal);vec4 mvPosition=viewMatrix*vec4(vW,1.);gl_Position=projectionMatrix*mvPosition;
   #include <fog_vertex>
   }`,
  fragmentShader: `uniform float uTime;varying vec2 vUv;varying vec3 vW;varying vec3 vN;
   #include <fog_pars_fragment>
   void main(){
    float stripe=smoothstep(.3,1.,fract(vUv.x*12.-uTime*1.4));
    float edge=pow(abs(dot(normalize(vN),normalize(cameraPosition-vW))),1.6);
    float ends=smoothstep(0.,.06,vUv.x)*smoothstep(1.,.94,vUv.x);
    float a=(stripe*.09+.05)*edge*ends;
    gl_FragColor=vec4(vec3(.55,.85,1.)*.9,a);
   #include <fog_fragment>
   #include <tonemapping_fragment>
   #include <colorspace_fragment>
   }`});
 materials.push(windMat); animated.push(windMat.uniforms.uTime);
 const streakMat = new THREE.ShaderMaterial({transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
  uniforms: {...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: {value: 0}, uMap: {value: glowTex}, uScale: {value: 700}},
  vertexShader: `attribute vec3 aTangent;attribute float aSeed;uniform float uTime;uniform float uScale;varying float vFade;
   #include <fog_pars_vertex>
   void main(){float t=fract(aSeed+uTime*.75);vec3 p=position+aTangent*(t-.5)*70.;vFade=1.-abs(t-.5)*2.;
    vec4 mvPosition=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mvPosition;gl_PointSize=(2.6+aSeed*3.)*uScale/max(1.,-mvPosition.z);
   #include <fog_vertex>
   }`,
  fragmentShader: `uniform sampler2D uMap;varying float vFade;
   #include <fog_pars_fragment>
   void main(){vec4 t=texture2D(uMap,gl_PointCoord);gl_FragColor=vec4(vec3(.8,.95,1.)*1.8,t.a*vFade*.85);
   #include <fog_fragment>
   #include <tonemapping_fragment>
   #include <colorspace_fragment>
   }`});
 materials.push(streakMat); animated.push(streakMat.uniforms.uTime);
 const winds = [];
 for (const river of HOLLOW_WIND_RIVERS) {
  const pts = river.points.map((_, i) => { const p = hollowWindPoint(river, i); return new THREE.Vector3(p.x, p.y, p.z); });
  const d0 = river.points[0][0], d1 = river.points[river.points.length - 1][0];
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', .5);
  const tube = new THREE.TubeGeometry(curve, 160, 9, 8, false);
  const m = mesh(tube, windMat, 'wind-river-' + river.name); register(m, -d0, -d1, 'detail');
  const pos = [], tan = [], seed = [], count = high ? 240 : 120;
  for (let i = 0; i < count; i++) { const t = (i + .5) / count, p = curve.getPointAt(t), tg = curve.getTangentAt(t); pos.push(p.x + (hash(i, 521) - .5) * 20, p.y + (hash(i, 522) - .5) * 20, p.z); tan.push(tg.x, tg.y, tg.z); seed.push(hash(i, 523)); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('aTangent', new THREE.Float32BufferAttribute(tan, 3)); geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1)); geometries.push(geo);
  const pts2 = new THREE.Points(geo, streakMat); pts2.name = 'wind-streaks-' + river.name; geo.computeBoundingSphere(); group.add(pts2); register(pts2, -d0, -d1, 'detail');
  // Samples every 4 m of distance for the ride test.
  const samples = []; const n = Math.ceil((d1 - d0) / 4);
  for (let i = 0; i <= n; i++) { const p = curve.getPointAt(i / n); samples.push(p); }
  winds.push({name: river.name, d0, d1, samples, curve});
 }
 function windAt(p) {
  const d = -p.z; let best = 0;
  for (const w of winds) {
   if (d < w.d0 || d > w.d1) continue;
   // samples are near-uniform in arc length; distance along the river is close to distance along z here
   const i = Math.round((d - w.d0) / (w.d1 - w.d0) * (w.samples.length - 1)), s = w.samples[Math.max(0, Math.min(w.samples.length - 1, i))];
   const dist = Math.hypot(p.x - s.x, p.y - s.y);
   best = Math.max(best, smooth(HOLLOW_WIND_RADIUS, HOLLOW_WIND_RADIUS * .45, dist));
  }
  return best;
 }

 // --- Glow motes drifting through the tunnel ----------------------------------------------------------------------
 const moteMat = new THREE.ShaderMaterial({transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
  uniforms: {...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: {value: 0}, uMap: {value: glowTex}, uScale: {value: 700}},
  vertexShader: `attribute vec3 aSeed;attribute vec3 aColor;uniform float uTime;uniform float uScale;varying float vPulse;varying vec3 vColor;
   #include <fog_pars_vertex>
   void main(){vec3 p=position;p.x+=sin(uTime*.3*aSeed.y+aSeed.x)*7.;p.y+=sin(uTime*.45*aSeed.y+aSeed.x*2.)*4.;p.z+=cos(uTime*.25*aSeed.y+aSeed.x)*7.;
    vec4 mvPosition=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mvPosition;vColor=aColor;
    vPulse=.6+.4*sin(uTime*2.*aSeed.z+aSeed.x*3.);gl_PointSize=(1.8+aSeed.z*2.6)*uScale/max(1.,-mvPosition.z)*(.7+.3*vPulse);
   #include <fog_vertex>
   }`,
  fragmentShader: `uniform sampler2D uMap;varying float vPulse;varying vec3 vColor;
   #include <fog_pars_fragment>
   void main(){vec4 t=texture2D(uMap,gl_PointCoord);gl_FragColor=vec4(vColor*1.5*vPulse,t.a*.85);
   #include <fog_fragment>
   #include <tonemapping_fragment>
   #include <colorspace_fragment>
   }`});
 materials.push(moteMat); animated.push(moteMat.uniforms.uTime);
 for (const [d0, d1, hex, salt] of [[HOLLOW_MOUTH + 100, 3100, 0x7ae8ff, 531], [3100, 5500, 0x9dffb0, 541], [5500, HOLLOW_EXIT - 60, 0xbfe8ff, 551]]) {
  const pos = [], seed = [], col = [], c = new THREE.Color(hex), count = high ? 160 : 70;
  for (let i = 0; i < count; i++) { const d = d0 + hash(i, salt) * (d1 - d0), p = hollowPath(d), a = hash(i, salt + 1) * 6.3, rr = hash(i, salt + 2) * p.r * .75; pos.push(p.x + Math.cos(a) * rr, Math.max(p.floor + 6, p.y + Math.sin(a) * rr), -d); seed.push(hash(i, salt + 3) * 6.28, .6 + hash(i, salt + 4), .3 + hash(i, salt + 5) * .7); col.push(c.r, c.g, c.b); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 3)); geo.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3)); geometries.push(geo);
  const pts = new THREE.Points(geo, moteMat); pts.name = 'hollow-motes'; geo.computeBoundingSphere(); group.add(pts); register(pts, -d0, -d1, 'detail');
 }

 // --- Outside: the mountain face with the mouth in it, the start ledge, two falls down the face ---------------------
 {
  // The hole is cut smaller than the tunnel's narrowest rim bump (290 m x .86), so no sky shows between them.
  const cols = 110, rows = 56, xHalf = 2600, yLo = CLOUD_SEA_Y - 350, yHi = ENTRY_TOP_Y + 950, hole = 244;
  const pos = new Float32Array((cols + 1) * (rows + 1) * 3), inHole = new Uint8Array((cols + 1) * (rows + 1));
  let k = 0;
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
   const x = (i / cols - .5) * 2 * xHalf, y = lerp(yLo, yHi, j / rows), dist = Math.hypot(x, y - ENTRY_TOP_Y);
   let disp = 140 * (noise(x * .0015 + 2, y * .0015) - .35) + 50 * (noise(x * .006 + 3, y * .006) - .5) + 14 * (noise(x * .03, y * .03) - .5);
   disp *= smooth(hole, hole + 150, dist);
   if (y > ENTRY_TOP_Y + 600) disp -= (y - ENTRY_TOP_Y - 600) * .9;
   // Vertices inside the mouth move out onto its rim, so the hole is a clean circle with no gaps round it.
   let fx = x, fy = y;
   if (dist < hole) { const k2 = hole / Math.max(1e-3, dist); fx = x * k2; fy = ENTRY_TOP_Y + (y - ENTRY_TOP_Y) * k2; }
   pos[k * 3] = fx; pos[k * 3 + 1] = fy; pos[k * 3 + 2] = -HOLLOW_MOUTH + disp; inHole[k] = dist < hole ? 1 : 0; k++;
  }
  // Wound so the faces look toward +z, where the rider starts; triangles fully inside the mouth are dropped.
  const idx = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
   const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
   if (!(inHole[a] && inHole[b] && inHole[c])) idx.push(a, b, c);
   if (!(inHole[b] && inHole[c] && inHole[d])) idx.push(b, d, c);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  withTerrainAttributes(geo, CLOUD_SEA_Y - 100, 600);
  const m = mesh(geo, terrainMaterial, 'hollow-mountain-face'); register(m, -HOLLOW_MOUTH + 200, -HOLLOW_MOUTH - 300, 'landmark');
  for (const [x, top, w] of [[520, ENTRY_TOP_Y + 420, 24], [-760, ENTRY_TOP_Y + 180, 16]]) {
   const h = top - (CLOUD_SEA_Y - 60), f = mesh(new THREE.PlaneGeometry(w, h, 1, 1), fallMat, 'hollow-face-fall');
   f.position.set(x, top - h / 2, -HOLLOW_MOUTH + 92);
  }
 }
 function ledgeHeight(x, z) {
  const shelfW = 230 + 40 * noise(z * .01, 3), inShelf = smooth(shelfW + 180, shelfW - 40, Math.abs(x));
  const shelfY = ENTRY_TOP_Y - 110 - 116 * smooth(-280, -HOLLOW_MOUTH, z) + 6 * noise(x * .02, z * .02) + 2 * noise(x * .09, z * .09);
  const base = CLOUD_SEA_Y - 250 + 120 * noise(x * .004, z * .004) + 40 * noise(x * .015 + 1, z * .015);
  return lerp(base, shelfY, inShelf) + (1 - inShelf) * 90 * Math.pow(noise(x * .006 + 5, z * .006), 2);
 }
 {
  const cols = 100, rows = 58, xHalf = 1500, zStart = 350, zEnd = -HOLLOW_MOUTH;
  const pos = new Float32Array((cols + 1) * (rows + 1) * 3); let k = 0;
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) { const x = (i / cols - .5) * 2 * xHalf, z = lerp(zStart, zEnd, j / rows); pos[k * 3] = x; pos[k * 3 + 1] = ledgeHeight(x, z); pos[k * 3 + 2] = z; k++; }
  const idx = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  withTerrainAttributes(geo, CLOUD_SEA_Y - 100, 0);
  const m = mesh(geo, terrainMaterial, 'hollow-ledge'); register(m, zStart, zEnd, 'terrain');
  surfaces.push({positions: geo.attributes.position, columns: cols + 1, rows, start: zStart, end: zEnd});
 }
 // Spots for the environment's scanned models and trees on the ledge and the crags beside the mouth.
 const spots = {trees: [], rocks: [], cliffs: [], mountains: [], trunks: []};
 for (let i = 0; i < (high ? 90 : 45); i++) { const x = (hash(i, 561) - .5) * 520, z = 300 - hash(i, 562) * 700; if (Math.abs(x) < 70 && z < 60) continue; spots.trees.push({x, y: ledgeHeight(x, z) - 1, z, size: 11 + hash(i, 563) * 14, seed: 7000 + i, round: hash(i, 564) < .35}); }
 for (let i = 0; i < (high ? 50 : 24); i++) { const x = (hash(i, 571) - .5) * 700, z = 320 - hash(i, 572) * 800; spots.rocks.push({x, y: ledgeHeight(x, z) - 1, z, size: 5 + Math.pow(hash(i, 573), 2) * 22, seed: 7200 + i}); }
 for (let i = 0; i < (high ? 16 : 8); i++) { const side = i % 2 ? 1 : -1, x = side * (420 + hash(i, 581) * 500), z = 300 - hash(i, 582) * 760, size = 90 + hash(i, 583) * 120; spots.cliffs.push({x, y: ledgeHeight(x, z) - size * .2, z, size, yaw: hash(i, 584) * 6.3, tilt: (hash(i, 585) - .5) * .5, seed: 7300 + i}); }
 for (let i = 0; i < (high ? 8 : 4); i++) { const side = i % 2 ? 1 : -1, x = side * (900 + hash(i, 591) * 1200), z = 200 - hash(i, 592) * 900, size = 800 + hash(i, 593) * 600; spots.mountains.push({x, y: CLOUD_SEA_Y - 300 + hash(i, 594) * 200, z, size, yaw: hash(i, 595) * 6.3, seed: 7400 + i}); }
 for (let i = 0; i < 6; i++) { const x = (hash(i, 596) - .5) * 400, z = 200 - hash(i, 597) * 500; spots.trunks.push({x, y: ledgeHeight(x, z) - .5, z, size: 14 + hash(i, 598) * 12, yaw: hash(i, 599) * 6.3, seed: 7500 + i}); }
 // Scanned cliff chunks ring the mouth on the mountain face.
 for (let i = 0; i < (high ? 14 : 8); i++) { const a = Math.PI * (.05 + hash(i, 601) * .9), rr = 335 + hash(i, 602) * 90, size = 110 + hash(i, 603) * 110; spots.cliffs.push({x: Math.cos(a) * rr, y: ENTRY_TOP_Y + Math.sin(a) * rr - size * .3, z: -HOLLOW_MOUTH + 20 + hash(i, 604) * 40, size, yaw: hash(i, 605) * 6.3, tilt: (hash(i, 606) - .5) * .8, seed: 7600 + i}); }

 // --- Hazard meshes for the course's Hollow hazards (game.js positions and scales them) ----------------------------
 const geyserMat = new THREE.ShaderMaterial({transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: true,
  uniforms: {...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: {value: 0}, uNoise: {value: fallNoise}},
  vertexShader: `varying vec2 vUv;
   #include <fog_pars_vertex>
   void main(){vUv=uv;vec4 mvPosition=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mvPosition;
   #include <fog_vertex>
   }`,
  fragmentShader: `uniform float uTime;uniform sampler2D uNoise;varying vec2 vUv;
   #include <fog_pars_fragment>
   void main(){
    float n=texture2D(uNoise,vec2(vUv.x*3.,vUv.y*1.6-uTime*1.8)).r*.6+texture2D(uNoise,vec2(vUv.x*7.+.3,vUv.y*3.-uTime*2.6)).r*.4;
    float body=smoothstep(.35,.7,n)*smoothstep(1.,.5,vUv.y)*smoothstep(0.,.1,vUv.y);
    vec3 col=mix(vec3(1.,.25,.04),vec3(1.3,.8,.25),smoothstep(.5,.8,n))*1.3;
    gl_FragColor=vec4(col,body*.6);
   #include <fog_fragment>
   #include <tonemapping_fragment>
   #include <colorspace_fragment>
   }`});
 materials.push(geyserMat); animated.push(geyserMat.uniforms.uTime);
 const geysers = [];
 const stalactiteHazardGeo = (() => { const pts = []; for (let i = 0; i <= 14; i++) { const t = i / 14; pts.push(new THREE.Vector2(.08 + 1.9 * Math.pow(t, .75) * (.8 + .2 * Math.sin(t * 11)), t - .5)); } const g = new THREE.LatheGeometry(pts, 24); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), rr = 1 + (noise3(x * 1.4, y * 5, z * 1.4) - .5) * .4; p.setXYZ(i, x * rr, y, z * rr); } g.computeVertexNormals(); geometries.push(g); return g; })();
 const crystalHazardGeo = (() => { const body = new THREE.CylinderGeometry(1.2, 2, .86, 6), tp = new THREE.ConeGeometry(1.2, .14, 6); body.translate(0, -.07, 0); tp.translate(0, .43, 0); const g = mergeGeometries([body, tp], false); body.dispose(); tp.dispose(); geometries.push(g); return g; })();
 const geyserGeo = new THREE.CylinderGeometry(1.1, .7, 1, 14, 1, true); geometries.push(geyserGeo);
 const rootHazardGeo = (() => { const list = []; for (let k = 0; k < 3; k++) { const pts = []; for (let i = 0; i <= 4; i++) { const t = i / 4, a = k * 2.1 + t * 4; pts.push(new THREE.Vector3(Math.cos(a) * .5, t - .5, Math.sin(a) * .5)); } list.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, .62, 7, false)); } const g = mergeGeometries(list, false); for (const l of list) l.dispose(); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 6, uv.getY(i) * 2); geometries.push(g); return g; })();
 function hazardMesh(hazard) {
  let m;
  if (hazard.kind === 'crystal') { m = new THREE.Mesh(crystalHazardGeo, crystalMat.clone()); m.material.color.setHex(0xe8d2ff); m.material.emissive.setHex(0xb48cff); m.material.emissiveIntensity = 1.1; materials.push(m.material); }
  else if (hazard.kind === 'geyser') { m = new THREE.Mesh(geyserGeo, geyserMat); geysers.push({mesh: m, hazard}); }
  else {
   const geo = (hazard.kind === 'root' ? rootHazardGeo : stalactiteHazardGeo).clone(); geometries.push(geo);
   bakeLight(geo, v => { v.x = hazard.x + v.x * hazard.radius / 2; v.y = hazard.altitude + v.y * hazard.thickness; v.z = hazard.z; });
   m = new THREE.Mesh(geo, hazard.kind === 'root' ? rootMat : caveRock);
  }
  m.name = 'hollow-' + hazard.kind;
  return m;
 }

 // --- Flight limits and queries -------------------------------------------------------------------------------------
 const insideFactor = z => { const d = -z; return smooth(HOLLOW_MOUTH - 260, HOLLOW_MOUTH + 20, d) * (1 - smooth(HOLLOW_EXIT - 40, HOLLOW_EXIT + 160, d)); };
 function caveLimit(previous, next) {
  const d = -next.z; if (d < HOLLOW_MOUTH || d > HOLLOW_EXIT) return null;
  const p = hollowPath(d), dx = next.x - p.x, dy = next.y - p.y, len = Math.hypot(dx, dy);
  let x = next.x, y = next.y, active = false;
  if (len > p.clear) {
   // Ease the dragon back inside instead of snapping it: at most 1.2 m of correction per physics step.
   const k = Math.max(p.clear, len - 1.2) / len; x = p.x + dx * k; y = p.y + dy * k; active = true;
  }
  const floorMin = p.floor + 30;
  if (y < floorMin) { y = Math.min(floorMin, y + 1.2); active = true; }
  return {x, y, z: next.z, active};
 }
 function floorAt(x, z, radius = 24) {
  const d = -z; if (d < HOLLOW_MOUTH - 20 || d > HOLLOW_EXIT + 20) return -Infinity;
  const p = hollowPath(clamp(d, HOLLOW_MOUTH, HOLLOW_EXIT));
  return Math.abs(x - p.x) + radius > p.r ? p.y + p.r : p.floor + 4;
 }
 function inRock(pos) {
  const d = -pos.z; if (d < HOLLOW_MOUTH || d > HOLLOW_EXIT) return false;
  const p = hollowPath(d);
  return Math.hypot(pos.x - p.x, pos.y - p.y) > p.r * .9 || pos.y < p.floor + 2;
 }

 function update(time) {
  caveUniforms.uFlicker.value = .82 + .18 * Math.sin(time * 7.3) * Math.sin(time * 3.1 + 1) + .08 * Math.sin(time * 13.7);
  for (const g of geysers) {
   const h = g.hazard, t = (time + (h.phase || 0)) % (h.period || 3.8), upFor = h.up || 1.5;
   // rises in .25 s, stays up, sinks over .4 s; dangerous while more than half up
   const rise = t < .25 ? t / .25 : t < upFor ? 1 : Math.max(.06, 1 - (t - upFor) / .4);
   h.activeNow = rise > .5;
   g.mesh.scale.y = h.thickness * rise; g.mesh.position.y = h.base + h.thickness * rise / 2;
  }
 }
 return {caveLimit, floorAt, inRock, windAt, insideFactor, lightAt, hazardMesh, update, spots, counts, lakeY};
}
