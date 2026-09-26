// Dragonfall game loop: wires the film-render modules (render, sky, terrain, water, dressing, dragon, rider)
// around the flight physics, controls, gates, obstacles, collisions, HUD and settings, plus Ryan's 2026-09-09
// features: audio.js (all sound), speech.js (voice fire word), fireball.js (fireballs + kills), net.js (friends).
//
// sky.js MUST be the first import: at import time it replaces three's fog shader chunks with the analytic
// height fog, and every material compiled afterwards picks it up with no plumbing (SHARED CONTRACTS v1, 4).
import './sky.js';
import * as THREE from 'three';
import {TIER, setTier, readTierSetting} from './quality.js';
import {createRenderSystem} from './render.js';
import {createSky} from './sky.js';
import {createWaterfallEnvironment,createWaterfallSky} from './waterfall-environment.js?v=3';
import {createWaterfallGuide,selectWaterfallTarget} from './waterfall-guide.js?v=3';
import {createTerrain, terrainHeight, createArchGeometry, createBoulderGeometry, createRockMaterial, worldSlope} from './terrain.js';
import {createWater} from './water.js';
import {createDressing} from './dressing.js';
import {mergeRigid} from './dragon.js';
import {createDragon} from './dragon-norberto.js';
// Keep Ryan's selected NORBERTO model while restoring the original game.
const dragonStyle = 'norberto';
import {createRider} from './rider.js';
import {wingbeatPose} from './wingbeat.js';
// flight.js is imported without a cache-buster so terrain.js and dressing.js (which import './flight.js')
// share this single module instance with game.js.
import {clamp, damp, centerAt, newFlight, stepFlight, getSpeedMultiplier, setSpeedMultiplier, applyVerticalGain, LANDSCAPE_VERTICAL_GAIN, PHYSICS_STEP} from './flight.js';
import {readInvertSetting, saveInvertSetting, invertVerticalControls, readControlMode, saveControlMode} from './control-settings.js?v=7';
import {createTilt} from './tilt.js';
// Ryan's 2026-09-09 features (spec/features-integration.md): sound, voice fire word, fireballs, friends over WebRTC.
import {createAudio} from './audio.js';
import {createSpeech, readFireWord, saveFireWord, STICKY_STATUSES} from './speech.js';
import {createNoiseFire} from './noise-fire.js?v=1';
import {routeAt, FALL_START, FALL_END, VERTICAL_START, VERTICAL_END, createRings as createWaterfallRings, createWaterfallObstacles, getSpeedMultiplier as getWaterfallSpeed, setSpeedMultiplier as setWaterfallSpeed} from './waterfall-core.js';
import {initializeWaterfallFlight,stepWaterfallFlight,waterfallForward,waterfallCameraPose,crossesWaterfallRing} from './waterfall-flight.js?v=4';
import {createFireballs} from './fireball.js';
import {createNet} from './net.js';

const $ = id => document.getElementById(id);
const TAU = Math.PI * 2;
const query = new URLSearchParams(location.search);
const WATERFALL_MAP = location.pathname.includes('/waterfall/');
let WATERFALL_RINGS = WATERFALL_MAP ? createWaterfallRings() : [];
const WATERFALL_OBSTACLES = WATERFALL_MAP ? createWaterfallObstacles() : [];
const debug = query.get('debug') === '1';
const showStats = query.get('stats') === '1';

// ---------------------------------------------------------------------------------------------
// Graphics tier. Modules read TIER when their create*() runs, so the choice must happen first.
// ?tier=high|phone overrides for one page load without touching the saved Settings choice.
// ---------------------------------------------------------------------------------------------
{
 const forced = query.get('tier');
 if (forced === 'high' || forced === 'phone') {
  const saved = readTierSetting();
  setTier(forced);
  try { localStorage.setItem('dragonfall-graphics', saved); } catch {}
 }
}
const tier = TIER;

// ---------------------------------------------------------------------------------------------
// Renderer, scene, camera
// ---------------------------------------------------------------------------------------------
let viewportWidth = window.innerWidth, viewportHeight = window.innerHeight;
const scene = new THREE.Scene();
scene.background = null;   // the sky is a mesh; GTAO needs a null background
const camera = new THREE.PerspectiveCamera(56, viewportWidth / viewportHeight, 0.1, 2200);
let rs;
try {
 rs = createRenderSystem({canvas: $('sky'), scene, camera, overrides: WATERFALL_MAP ? {dof:false,shafts:false,gtao:false} : {}});
} catch (e) {
 $('error').hidden = false;
 throw e;
}
const renderer = rs.renderer;
rs.setSize(viewportWidth, viewportHeight);
if (WATERFALL_MAP) {
 // Clear scenery at every distance. Camera offset, direction and view angle stay unchanged.
 const u=rs.passes.grade.uniforms;u.uCA.value=0;u.uGrain.value=0;u.uVignette.value=.15;u.uContrast.value=1.03;
 camera.far=9000;camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------------------------
let flapPhase = 0;
// newFlight() plus the counter flight.js does not know about: kills (boulders shattered + riders hit). It rides in the
// multiplayer state packet, so every rider can draw the same scoreboard.
function freshFlight() { const f = newFlight(); f.kills = 0; return WATERFALL_MAP ? initializeWaterfallFlight(f) : f; }
let flight = freshFlight(), mode = 'intro', time = 0, lastTime = performance.now(), toastTimer = 0, uiTime = 0, best = 0;
let wasDiving = false;           // nose-dive edge detector: one 'NOSE DIVE' toast per dive
let respawnAt = 0;               // multiplayer: time (s) at which a shot-down rider gets full shields back; 0 = flying
const lastControls = [0, 0];     // the final wing command of the last frame (?debug=1 tests read it)
try { best = Number(localStorage.getItem('dragonfall-best-v1')) || 0; } catch {}
$('intro-best').textContent = Math.floor(best).toLocaleString() + ' m';
window.__frames = 0;
window.__hits = 0;

// Deterministic hash shared with the old build so boulders land where they always did (world.html uses the same).
const hash = (a, b = 0) => { const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return n - Math.floor(n); };

// ---------------------------------------------------------------------------------------------
// World: water, terrain, sky, dressing (contract 5)
// ---------------------------------------------------------------------------------------------
const water = createWater({renderer});
const terrain = createTerrain({scene, renderer, water});
const sky = WATERFALL_MAP ? createWaterfallSky({renderer,scene}) : createSky({renderer, scene});
const canyonDressing = new THREE.Group();
scene.add(canyonDressing);
canyonDressing.visible = !WATERFALL_MAP;
const dressing = createDressing({scene:canyonDressing, renderer, sunColor: sky.sunColor, sunDirection: sky.sunDirection});
rs.setSunDirection(sky.sunDirection);
// The lens-flare ghosts draw over the walls whenever the sun disc is unoccluded (three's Lensflare keys occlusion on
// the sun point only); in the real frame they read as two orange discs on the rock, so the flare stays off. Bloom and
// the sun-shaft pass already give the sun its halo.
if (sky.lensflare) sky.lensflare.visible = false;

// ---------------------------------------------------------------------------------------------
// Dragon and rider
// ---------------------------------------------------------------------------------------------
const model = createDragon(renderer);
const {dragon} = model;
scene.add(dragon);
model.setSun(sky.sunDirection, sky.sunColor);
const rider = createRider({saddleAnchor: model.saddleAnchor, bridleAnchors: model.bridleAnchors});
const eyeBase = rider.eye.position.clone();   // rest position of the eye in saddle metres; hit recovery offsets from it
if (tier === 'phone') {
 // Phone budget: the rider's shadow falls behind the eye (sun ahead), and the 43 pommel stitches are one more call.
 rider.group.traverse(m => { if (m.isMesh) { m.castShadow = false; if (m.material === rider.materials.thread) m.visible = false; } });
 if (dressing.hazes && dressing.hazes[3]) dressing.hazes[3].visible = false;
 // The two farthest mist banks (970 m and 1190 m out) sit inside the fog on phone anyway.
 for (const b of (dressing.banks || []).slice(4)) b.sprite.visible = false;
}

// Faint wingtip streamers make lift and banking legible at a glance (chase camera only: they sit behind the eye).
const trailMaterial = new THREE.LineBasicMaterial({color: 0xb2f4e5, transparent: true, opacity: 0.24, depthWrite: false});
const trails = [];
for (let i = 0; i < 2; i++) {
 const g = new THREE.BufferGeometry();
 g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(22 * 3), 3));
 const line = new THREE.Line(g, trailMaterial);
 line.frustumCulled = false;
 scene.add(line);
 trails.push({line, points: []});
}

// ---------------------------------------------------------------------------------------------
// Gates: PBR ring (emissive 1.2, just over the bloom threshold so it glows softly), faint additive halo, four ticks.
// ---------------------------------------------------------------------------------------------
const gates = [];
const gateGeo = new THREE.TorusGeometry(13.5, 0.16, 7, 64), haloGeo = new THREE.TorusGeometry(13.5, 0.62, 6, 64);
const gateMaterial = new THREE.MeshStandardMaterial({color: 0xa7ffdc, emissive: 0x66eec9, emissiveIntensity: 1.2, roughness: 0.35, metalness: 0.4});
const haloMaterial = new THREE.MeshBasicMaterial({color: 0x69edda, transparent: true, opacity: 0.08, depthWrite: false, blending: THREE.AdditiveBlending});
if (WATERFALL_MAP) {
 gateMaterial.color.set(0xffe4a5);gateMaterial.emissive.set(0xffc565);gateMaterial.emissiveIntensity=.85;
 haloMaterial.color.set(0xffdc95);haloMaterial.opacity=.035;
}
// Ticks share the ring material so mergeRigid bakes ring + 4 ticks into ONE mesh (2 draw calls per gate with the halo).
// Beyond VISIBLE_RANGE the fog hides a gate or rock anyway; phone culls closer to stay under the draw-call budget.
const VISIBLE_RANGE = 2200;
function setGate(g, n) {
 g.n = n;
 if (WATERFALL_MAP) {
  const ring=WATERFALL_RINGS[n];
  g.ring=ring;g.d=ring.distance;g.x=ring.x;g.alt=ring.altitude;g.passed=false;g.caught=false;g.group.visible=true;
  g.group.position.set(ring.x,ring.altitude,ring.z);
  g.group.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,-1),new THREE.Vector3(ring.normal.x,ring.normal.y,ring.normal.z));
  g.group.scale.setScalar(ring.radius/13.5);return;
 }
 g.d = 160 + n * 185;
 g.x = centerAt(g.d) + Math.sin(n * 1.8) * 16;
 g.alt = 27 + Math.sin(n * 0.85) * 10;
 g.passed = false;
 g.caught = false;
 g.group.visible = true;
 g.group.position.set(g.x, g.alt - g.d * worldSlope, -g.d);
 g.group.rotation.set(0, 0, 0);
}
function addGate(i) {
 const group = new THREE.Group();
 group.add(new THREE.Mesh(gateGeo, gateMaterial), new THREE.Mesh(haloGeo, haloMaterial));
 for (let j = 0; j < 4; j++) {
  const tick = new THREE.Mesh(new THREE.OctahedronGeometry(0.4, 0), gateMaterial);
  tick.position.set(Math.cos(j * Math.PI / 2) * 10.5, Math.sin(j * Math.PI / 2) * 10.5, 0);
  group.add(tick);
 }
 scene.add(group);
 mergeRigid(group);
 const gate = {group};
 setGate(gate, i);
 gates.push(gate);
}
for (let i = 0; i < (WATERFALL_MAP ? WATERFALL_RINGS.length : 10); i++) addGate(i);
function resetWaterfallCourse(){
 WATERFALL_RINGS=createWaterfallRings(getWaterfallSpeed());
 // Reuse meshes; only a new flight may change the physical checkpoint layout.
 while(gates.length>WATERFALL_RINGS.length){const g=gates.pop();scene.remove(g.group);g.group.traverse(o=>{if(o.geometry&&o.geometry!==gateGeo&&o.geometry!==haloGeo)o.geometry.dispose();});}
 while(gates.length<WATERFALL_RINGS.length)addGate(gates.length);
 gates.forEach((g,i)=>setGate(g,i));
 waterfallGuide.reset();
}

// ---------------------------------------------------------------------------------------------
// Obstacles (boulders) and arches: terrain geometries drawn with the shared triplanar rock material.
// ---------------------------------------------------------------------------------------------
const rockGeometry = createBoulderGeometry();
// Boulders share the wall textures but read their height 40 m higher, so they show the warm sandstone banding instead
// of the dark wet-basalt tint every rock under ~50 m gets (they read as flat grey pillars at 150-300 m otherwise).
const boulderMaterial = createRockMaterial(renderer, {heightOffset: 40, textures: terrain.rockMaterial.userData.textures});
const obstacles = [];
function setWaterfallObstacle(o, n) {
 const hazard = WATERFALL_OBSTACLES[n];
 if (!hazard) { o.mesh.visible = false; return; }
 o.n=n;o.d=hazard.distance;o.x=hazard.x;o.alt=hazard.altitude;o.radius=hazard.radius;o.height=hazard.height;o.hit=false;
 o.mesh.position.set(hazard.x,hazard.altitude,hazard.z);
 o.mesh.scale.set(o.radius / 2, o.height, o.radius / 2);
 o.mesh.rotation.y = (n % 2 ? -.22 : .22);
 o.mesh.visible = true;
}
function setObstacle(o, n) {
 if (WATERFALL_MAP) { setWaterfallObstacle(o, n); return; }
 o.n = n;
 o.d = 300 + n * 240;
 o.x = centerAt(o.d) + (hash(n, 3) - 0.5) * 59;
 o.height = 16 + hash(n, 5) * 40;
 o.radius = 3.1 + hash(n, 6) * 2.4;
 o.mesh.position.set(o.x, o.height * 0.5 - o.d * worldSlope, -o.d);
 o.mesh.scale.set(o.radius / 2, o.height, o.radius / 2);
 o.mesh.rotation.y = hash(n, 7) * Math.PI;
}
for (let i = 0; i < (WATERFALL_MAP ? WATERFALL_OBSTACLES.length : 9); i++) {
 const mesh = new THREE.Mesh(rockGeometry, boulderMaterial);
 scene.add(mesh);
 const o = {mesh};
 setObstacle(o, i);
 obstacles.push(o);
}
// Weathered stone arches frame the descent, like the narrow passages in the reference.
const archGeometry = createArchGeometry();
const arches = [];
function setArch(a, n) {
 a.n = n;
 a.d = 685 + n * 740;
 a.x = centerAt(a.d);
 a.mesh.position.set(a.x, -a.d * worldSlope, -a.d);
}
for (let i = 0; i < 3; i++) {
 const mesh = new THREE.Mesh(archGeometry, terrain.rockMaterial);
 scene.add(mesh);
 const a = {mesh};
 setArch(a, i);
 arches.push(a);
}
const waterfallWorld = new THREE.Group();
waterfallWorld.name='stationary-waterfall-map';
if (WATERFALL_MAP) scene.add(waterfallWorld);
let waterfallEnvironment=null;
const waterfallGuide=WATERFALL_MAP ? createWaterfallGuide({container:$('game'),camera,gates}) : null;
function buildWaterfallMapScene() {
 if (!WATERFALL_MAP) return;
 for (const chunk of terrain.chunks || []) chunk.group.visible=false;
 terrain.river.visible=false;
 waterfallEnvironment=createWaterfallEnvironment({group:waterfallWorld,renderer});
 for(const a of arches)a.mesh.visible=false;
}
buildWaterfallMapScene();
// ---------------------------------------------------------------------------------------------
let controlMode = WATERFALL_MAP ? 'thumbs' : readControlMode(), invertVertical = readInvertSetting(controlMode);
const tilt = createTilt();
const pointers = {left: null, right: null}, inputs = {left: 0, right: 0}, keys = new Set();
// The RAW thumb positions of the last controls() call (+1 = slid up, -1 = slid down toward the rider), before the
// landscape gain and the invert setting: the rider's fists follow these, so a pulled thumb pulls that side's rein.
const reins = {left: 0, right: 0};
function updatePad(side, v, active) {
 const el = $(side + '-wing');
 el.classList.toggle('active', active);
 if (active) el.classList.add('touched');   // after the first touch the LEFT WING / RIGHT WING labels fade out (CSS)
 el.querySelector('.thumb').style.top = (66 - v * 53) + 'px';
}
function resetInputs() {
 for (const side of ['left', 'right']) {
  if (pointers[side]) { try { $('game').releasePointerCapture(pointers[side].id); } catch {} }
  pointers[side] = null;
  inputs[side] = 0;
  updatePad(side, 0, false);
 }
 keys.clear();
}
const padRange = () => clamp(viewportHeight * 0.115, 55, 105);
$('game').addEventListener('pointerdown', e => {
 if (controlMode === 'tilt' || mode !== 'playing' || e.target.closest('button') || e.target.closest('#modal')) return;
 const side = e.clientX < viewportWidth / 2 ? 'left' : 'right';
 if (pointers[side]) return;
 pointers[side] = {id: e.pointerId, y: e.clientY};
 $('game').setPointerCapture(e.pointerId);
 inputs[side] = 0;
 updatePad(side, 0, true);
 e.preventDefault();
});
$('game').addEventListener('pointermove', e => {
 for (const side of ['left', 'right']) {
  const p = pointers[side];
  if (p?.id === e.pointerId) {
   let v = clamp((p.y - e.clientY) / padRange(), -1, 1);
   v = Math.abs(v) < 0.02 ? 0 : Math.sign(v) * (Math.abs(v) - 0.02) / 0.98;
   inputs[side] = v;
   updatePad(side, v, true);
   e.preventDefault();
  }
 }
});
function pointerEnd(e) {
 for (const side of ['left', 'right']) {
  if (pointers[side]?.id === e.pointerId) { pointers[side] = null; inputs[side] = 0; updatePad(side, 0, false); }
 }
}
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) $('game').addEventListener(event, pointerEnd);
addEventListener('keydown', e => {
 if ($('settings-dialog').open) return;
 // F breathes fire (same as the FIRE button and the voice word); held keys do not auto-repeat it. Ctrl/Cmd/Alt+F
 // stay with the browser (find), and the key is only claimed while flying so the intro page keeps its shortcuts.
 if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) {
  if (mode !== 'playing') return;
  e.preventDefault();
  if (!e.repeat) fire('key');
  return;
 }
 if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Escape', 'w', 's', 'W', 'S', 'i', 'k', 'I', 'K'].includes(e.key)) {
  e.preventDefault();
  if (e.repeat && [' ', 'Escape'].includes(e.key)) return;
  if (e.key === 'Escape' || e.key === ' ') {
   if (mode === 'playing') pause();
   else if (mode === 'paused') resume();
   else if (mode === 'intro' && e.key === ' ') start();
   return;
  }
  keys.add(e.key.toLowerCase());
 }
});
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
function controls() {
 // ?debug=1 lets a headless test drive the wings through window.__forceInput = [l, r].
 if (debug && Array.isArray(window.__forceInput)) {
  const [fl, fr] = window.__forceInput;
  const l = clamp(fl || 0, -1, 1), r = clamp(fr || 0, -1, 1);
  updatePad('left', l, l !== 0);
  updatePad('right', r, r !== 0);
  reins.left = l;
  reins.right = r;
  return [l, r];
 }
 const t = controlMode === 'tilt' ? tilt.read() : {pitch: 0, bank: 0};
 // Arrow up always climbs: the Invert setting is a thumb/tilt gesture preference, so the arrow term is pre-flipped
 // to cancel the inversion applied at the end of this function.
 const arrowPitch = ((keys.has('arrowup') ? 1 : 0) - (keys.has('arrowdown') ? 1 : 0)) * (invertVertical ? -1 : 1);
 const pitch = t.pitch + arrowPitch;
 const turn = t.bank + (keys.has('arrowleft') ? 1 : 0) - (keys.has('arrowright') ? 1 : 0);
 let l = clamp(inputs.left + (keys.has('w') ? 1 : 0) - (keys.has('s') ? 1 : 0) + pitch - turn, -1, 1);
 let r = clamp(inputs.right + (keys.has('i') ? 1 : 0) - (keys.has('k') ? 1 : 0) + pitch + turn, -1, 1);
 updatePad('left', l, !!pointers.left || l !== 0);
 updatePad('right', r, !!pointers.right || r !== 0);
 reins.left = l;
 reins.right = r;
 // Landscape phones have little vertical thumb travel: the shared climb/dive part of the two thumbs is amplified
 // 1.5x there (the difference between the thumbs, the bank, is untouched). Portrait and desktop-portrait stay 1x.
 if (viewportWidth > viewportHeight) [l, r] = applyVerticalGain(l, r, LANDSCAPE_VERTICAL_GAIN);
 return invertVerticalControls(l, r, invertVertical);
}

// ---------------------------------------------------------------------------------------------
// HUD helpers, game flow
// ---------------------------------------------------------------------------------------------
function toast(text) {
 $('toast').textContent = text;
 $('toast').classList.add('show');
 clearTimeout(toastTimer);
 toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2000);
}
function updateHealth() {
 document.querySelectorAll('.health i').forEach((el, i) => el.classList.toggle('lost', i >= flight.health));
 document.querySelector('.health').setAttribute('aria-label', flight.health + ' shields remaining');
}
function saveBest() {
 if (flight.distance > best) {
  best = Math.floor(flight.distance);
  try { localStorage.setItem('dragonfall-best-v1', String(best)); } catch {}
 }
}
async function start() {
 if (WATERFALL_MAP) {
  $('start').disabled=true;
  try {await waterfallEnvironment.ready;} catch(e) {$('start').disabled=false;$('error').hidden=false;$('error').textContent='Scenery could not load. Reload this page to download the scenery again.';return false;}
  $('start').disabled=false;
  waterfallGuide.reset();
 }
 if (model.loading) {
  $('start').disabled = true;
  try {
   await model.loading;
   if (!model.ready || model.error) throw model.error || new Error('Dragon model is not ready.');
  } catch (error) {
   $('error').hidden = false; $('error').textContent = 'The selected dragon could not load. Reload to retry. ' + error.message;
   return false;
  } finally { $('start').disabled = false; }
 }
 if (!await prepareControls()) return false;
 resetInputs();
 flapPhase = 0;
 flight = freshFlight();
 if (WATERFALL_MAP) {flight.surfaceHeight=waterfallEnvironment.surfaceHeight;resetWaterfallCourse();}
 if (!WATERFALL_MAP) { terrain.reset(); dressing.reset(); }
 gates.forEach((g, i) => setGate(g, i));
 obstacles.forEach((o, i) => setObstacle(o, i));
 arches.forEach((a, i) => setArch(a, i));
 trails.forEach(t => t.points = []);
 mode = 'playing';
 document.body.classList.add('playing');
 $('modal').hidden = true;
 updateHealth();
 updateUI();
 if (cameraMode === 'chase') positionCamera(1, true);
 placeWingPads();
 toast(controlMode === 'tilt' ? 'TILT TO STEER · LIFT TOP EDGE TO CLIMB' : 'THUMBS ON WINGS · FIND YOUR FLOW');
 for (const b of fireballs.live.slice()) fireballs.burst(b, 'reset');   // no fireballs carry over from the last flight
 if (net.status.mode === 'offline') clearRiders(true);                  // outside a room no remote dragon may linger
 wasDiving = false;
 respawnAt = 0;
 lastFireAt = -10;
 startVoice();          // listen for the fire word (only if Voice fire is on and the browser supports it)
 startNoise();          // calibrate the opening microphone level, then fire on louder sound
 joinPendingRoom();
 return true;
}
function pause() {
 if (mode !== 'playing') return;
 mode = 'paused';
 saveBest();   // a room flight never reaches gameOver(), so the best is also saved here, on shot-down and on leave
 resetInputs();
 $('modal').hidden = false;
 $('modal-eyebrow').textContent = 'TAKE A BREATH';
 $('modal-title').textContent = 'Flight paused';
 $('modal-message').textContent = 'The canyon will wait.';
 $('run-stats').hidden = true;
 $('resume').innerHTML = 'RESUME FLIGHT <span>↗</span>';
 audio.update({playing: false});   // beds fade to a whisper while paused
 speech.stop();
 noiseFire.stop();
}
async function resume() {
 if (mode === 'over') { start(); return; }
 if (!await prepareControls()) return;
 mode = 'playing';
 resetInputs();
 $('modal').hidden = true;
 lastTime = performance.now();
 startVoice();
 startNoise();
}
function gameOver() {
 mode = 'over';
 saveBest();
 resetInputs();
 $('modal').hidden = false;
 $('modal-eyebrow').textContent = flight.distance >= best ? 'A NEW PERSONAL BEST' : 'THE DESCENT ENDS';
 $('modal-title').textContent = 'One more flight?';
 $('modal-message').textContent = 'Every turn brings you closer to the flow.';
 $('run-stats').hidden = false;
 $('final-distance').textContent = Math.floor(flight.distance).toLocaleString();
 $('final-gates').textContent = flight.gates;
 $('final-kills').textContent = flight.kills;
 $('resume').innerHTML = 'FLY AGAIN <span>↗</span>';
 audio.update({playing: false});
 speech.stop();
 noiseFire.stop();
}
function hit(reason) {
 if (flight.invulnerable > 0) return;
 window.__hits++;
 flight.health--;
 flight.invulnerable = 3;
 updateHealth();
 // Hurt feedback: red skin pulse on the dragon, camera shake on the rider, the red screen flash.
 model.setHurt(0.25);
 rider.shake(0.4);
 flashScreen('hit');
 if (navigator.vibrate) navigator.vibrate(70);
 if (reason.startsWith('FIREBALL')) audio.hitPlayer(); else audio.hitWall();
 if (flight.health <= 0) {
  // In a room the flight goes on: 3 s of untouchable gliding, then full shields, so friends stay together.
  if (net.status.mode !== 'offline') { shotDown(); return; }
  gameOver();
  return;
 }
 const altBefore = flight.alt, xBefore = flight.x;
 if (!WATERFALL_MAP) {
  flight.alt = Math.max(flight.alt + 9, 18);
  flight.x = THREE.MathUtils.lerp(flight.x, centerAt(flight.distance), 0.48);
 }
 hideHitCut(flight.x - xBefore, flight.alt - altBefore);
 flight.speed *= 0.8;
 toast(reason + ' · ' + flight.health + ' SHIELDS LEFT');
}

// ---------------------------------------------------------------------------------------------
// Settings dialog: controls, invert, graphics tier, camera mode
// ---------------------------------------------------------------------------------------------
let resumeAfterSettings = false;
async function prepareControls() {
 if (controlMode !== 'tilt') return true;
 try {
  await tilt.enable();
  $('tilt-status').textContent = 'Ready. Your current phone position is level flight.';
  return true;
 } catch (e) {
  $('tilt-status').textContent = e.message;
  resumeAfterSettings = false;
  syncSettings();
  if (!$('settings-dialog').open) $('settings-dialog').showModal();
  return false;
 }
}
function syncSettings() {
 const isTilt = controlMode === 'tilt';
 $('control-mode').value = controlMode;
 $('tilt-options').hidden = !isTilt;
 document.body.classList.toggle('tilt-mode', isTilt);
 $('invert-vertical').checked = invertVertical;
 $('invert-description').textContent = isTilt
  ? (invertVertical ? 'Lower the top edge to climb; lift it to dive.' : 'Lift the top edge to climb; lower it to dive.')
  : (invertVertical ? 'Slide both thumbs down to climb, up to dive.' : 'Slide both thumbs up to climb, down to dive.');
 $('climb-gesture').textContent = isTilt ? (invertVertical ? 'LOWER' : 'LIFT') : (invertVertical ? '↓ ↓' : '↑ ↑');
 $('dive-gesture').textContent = isTilt ? (invertVertical ? 'LIFT' : 'LOWER') : (invertVertical ? '↑ ↑' : '↓ ↓');
 $('bank-left-gesture').textContent = isTilt ? 'TILT ←' : '↓ ↑';
 $('bank-right-gesture').textContent = isTilt ? 'TILT →' : '↑ ↓';
 document.querySelector('.mobile-hint').textContent = isTilt
  ? 'Hold your phone comfortably, then tap Take flight. Tilt left/right to turn.'
  : 'Slide each thumb to steer. Rotate your phone for landscape.';
 $('graphics').value = readTierSetting();
 $('graphics-description').textContent = 'Auto picks Phone on handhelds. Now running: ' + (tier === 'high' ? 'High (film)' : 'Phone (fast)') + '. Changing it restarts the game.';
 $('camera-mode').value = cameraMode;
 $('dragon-style').value = dragonStyle;
 const selectedSpeed=WATERFALL_MAP?getWaterfallSpeed():getSpeedMultiplier();
 $('speed-slider').value = String(selectedSpeed);
 $('speed-value').value = selectedSpeed.toFixed(2) + 'x';
 $('fire-word').value = readFireWord();
 $('voice-fire').checked = voiceFireEnabled;
 $('noise-fire').checked = noiseFireEnabled;
 showVoiceStatus(speech.state);
 $('player-name').value = net.name;
 showNetStatus(net.status);
}
$('control-mode').addEventListener('change', () => {
 controlMode = $('control-mode').value;
 saveControlMode(controlMode);
 invertVertical = readInvertSetting(controlMode);
 resetInputs();
 syncSettings();
});
$('calibrate-tilt').onclick = async () => { await prepareControls(); };
$('settings').onclick = () => {
 resumeAfterSettings = mode === 'playing';
 if (resumeAfterSettings) pause();
 resetInputs();
 syncSettings();
 $('settings-dialog').showModal();
};
$('invert-vertical').addEventListener('change', () => {
 invertVertical = $('invert-vertical').checked;
 saveInvertSetting(invertVertical, controlMode);
 resetInputs();
 syncSettings();
});
$('graphics').addEventListener('change', () => {
 // Modules read the tier when they are created, so a reload is the honest way to apply a new tier.
 setTier($('graphics').value);
 toast('RESTARTING WITH NEW GRAPHICS');
 setTimeout(() => location.reload(), 350);
});
$('camera-mode').addEventListener('change', () => {
 setCameraMode($('camera-mode').value);
 try { localStorage.setItem('dragonfall-camera', cameraMode); } catch {}
});
$('settings-dialog').addEventListener('close', () => {
 resetInputs();
 if (resumeAfterSettings && mode === 'paused' && !document.hidden) resume();
 resumeAfterSettings = false;
});
$('start').onclick = start;
$('pause').onclick = pause;
$('resume').onclick = resume;
$('restart').onclick = start;
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
addEventListener('blur', () => { resetInputs(); pause(); });
async function allowRotation() {
 try {
  screen.orientation?.unlock?.();
  if (document.fullscreenElement && screen.orientation?.lock) await screen.orientation.lock('any');
 } catch { /* The browser may require device Auto-rotate to be enabled. */ }
}
$('fullscreen').onclick = async () => {
 try {
  if (document.fullscreenElement) {
   await document.exitFullscreen();
  } else if (document.documentElement.requestFullscreen) {
   await document.documentElement.requestFullscreen({navigationUI: 'hide'});
   await allowRotation();
  } else {
   toast('ROTATE YOUR PHONE · ENABLE AUTO-ROTATE');
  }
  scheduleViewportResize();
 } catch {
  toast('ENABLE AUTO-ROTATE, THEN TURN YOUR PHONE');
 }
};

// ---------------------------------------------------------------------------------------------
// Audio (audio.js): wind, river, waterfall and cloud beds plus one-shot flap / hit / bell / fire / burst sounds.
// Nothing plays until the speaker button is tapped (browsers only start audio after a tap).
// ---------------------------------------------------------------------------------------------
const audio = createAudio();
window.__audio = audio;   // headless tests read audio.enabled
$('sound').onclick = async () => {
 const on = await audio.toggle();
 $('sound').setAttribute('aria-label', on ? 'Mute sound' : 'Enable sound');
 $('sound-waves').setAttribute('d', on ? 'M15 8c3 2 3 6 0 8m3-11c5 4 5 10 0 14' : 'm16 9 6 6m0-6-6 6');
};
// What the rider is near, for the beds: closeness (0..1) to the nearest waterfall foot and whether the dragon is
// inside a mist bank. dressing.js owns both lists (6 falls, 12 banks): cheap, and only read on the ~8 Hz UI tick.
const soundScene = {falls: 0, cloud: 0, inCloud: false};
const _dragonPos = new THREE.Vector3();
function readSoundScene() {
 if (WATERFALL_MAP) {
  const curtain=waterfallWorld.getObjectByName('waterfall-curtain');
  const dx=Math.max(0,Math.abs(flight.x-curtain.position.x)-130),dz=flight.z-curtain.position.z;
  const dy=Math.max(0,Math.abs(flight.alt-curtain.position.y)-curtain.geometry.parameters.height/2);
  soundScene.falls=Math.max(0,1-Math.hypot(dx,dy,dz)/180);
  soundScene.cloud=0;soundScene.inCloud=false;return;
 }
 _dragonPos.set(flight.x, flight.alt - flight.distance * worldSlope, -flight.distance);
 let falls = 0;
 for (const f of dressing.falls) {
  // Distance to the nearest point of the sheet's foot line: the roar comes from the whole width, not one point.
  const dx = Math.max(0, Math.abs(_dragonPos.x - f.x) - f.width * 0.5), dy = _dragonPos.y - f.y, dz = _dragonPos.z + f.d;
  falls = Math.max(falls, 1 - Math.min(1, Math.sqrt(dx * dx + dy * dy + dz * dz) / 140));
 }
 let inCloud = false;
 for (const b of dressing.banks) {
  const sp = b.sprite;
  if (sp.visible && Math.abs(_dragonPos.x - sp.position.x) < sp.scale.x * 0.5 && Math.abs(_dragonPos.y - sp.position.y) < sp.scale.y * 0.5 && Math.abs(_dragonPos.z - sp.position.z) < 14) { inCloud = true; break; }
 }
 if (inCloud && !soundScene.inCloud) audio.cloudEnter();   // a soft swell on the way in
 soundScene.inCloud = inCloud;
 soundScene.falls = falls;
 // A nose dive adds its own wind roar (0.6 on the cloud-rush bed) on top of any mist bank.
 soundScene.cloud = Math.max(inCloud ? 1 : 0, flight.noseDive ? 0.6 : 0);
}
function updateAudio() {
 if (!audio.enabled) return;
 readSoundScene();
 audio.update({speed: flight.speed / (WATERFALL_MAP ? flight.speedMultiplier : getSpeedMultiplier()), alt: flight.alt, falls: soundScene.falls, cloud: soundScene.cloud, playing: mode === 'playing'});
}
// The full-screen flash: red for a hit, orange for a fireball leaving the mouth.
let flashTimer = 0;
function flashScreen(kind) {
 const el = $('flash');
 el.classList.toggle('fire', kind === 'fire');
 el.style.opacity = '1';
 clearTimeout(flashTimer);
 flashTimer = setTimeout(() => { el.style.opacity = '0'; }, 220);
}

// ---------------------------------------------------------------------------------------------
// Fireballs (fireball.js): leave the dragon's mouth along its heading at flight speed + 110 m/s. Triggers: the FIRE
// button, the F key, the voice word. A ball that reaches a boulder shatters it (the boulder respawns beyond the
// farthest one) and scores a KILL; one passing within 7 m of a friend's dragon sends them a 'hit' and scores too.
// Phone tier keeps fewer balls in the air (fireball.js also halves its particles and skips the point light there).
// ---------------------------------------------------------------------------------------------
const FIRE_COOLDOWN = 0.9, FIREBALL_EXTRA_SPEED = 110, FIREBALL_RANGE = 520;
let lastFireAt = -10;
const fireballs = createFireballs({scene, maxBalls: tier === 'phone' ? 3 : 6, onExplode: (pos) => {
 // Louder the closer the burst is to the rider: 1 = right beside you, 0 = 120 m or more away.
 audio.explosion(1 - Math.min(1, pos.distanceTo(dragon.position) / 120));
}});
const _mouth = new THREE.Vector3(), _heading = new THREE.Vector3();
function fire(source = 'button') {
 if (mode !== 'playing' || flight.health <= 0) return false;
 if (time - lastFireAt < FIRE_COOLDOWN) return false;
 lastFireAt = time;
 dragon.updateMatrixWorld(true);
 model.headAnchor.getWorldPosition(_mouth);
 _heading.set(0, 0, -1).applyQuaternion(dragon.quaternion);
 _mouth.addScaledVector(_heading, 2.2);   // just past the jaws so the ball never starts inside the head
 const speed = flight.speed + FIREBALL_EXTRA_SPEED;
 fireballs.fire({origin: _mouth, direction: _heading, speed, owner: 'me', range: FIREBALL_RANGE});
 audio.fireball();
 rider.shake(0.25);
 flashScreen('fire');
 if (navigator.vibrate) navigator.vibrate(25);
 $('fire').classList.add('cooling');
 setTimeout(() => $('fire').classList.remove('cooling'), FIRE_COOLDOWN * 1000);
 if (source === 'voice') toast('"' + readFireWord().toUpperCase() + '" · FIRE');
 if (source === 'noise') toast('LOUD SOUND · FIRE');
 if (net.status.mode !== 'offline') net.event('fire', {o: [+_mouth.x.toFixed(2), +_mouth.y.toFixed(2), +_mouth.z.toFixed(2)], v: [+(_heading.x * speed).toFixed(2), +(_heading.y * speed).toFixed(2), +(_heading.z * speed).toFixed(2)]});
 return true;
}
function scoreKill(text) {
 flight.kills++;
 $('kills').textContent = flight.kills;
 toast(text + ' · ' + flight.kills + (flight.kills === 1 ? ' KILL' : ' KILLS'));
}
function destroyBoulder(o) {
 // Respawn it beyond the farthest boulder so the field ahead keeps its 240 m spacing.
 let farthest = 0;
 for (const other of obstacles) farthest = Math.max(farthest, other.n);
 setObstacle(o, farthest + 1);
 scoreKill('BOULDER SHATTERED');
}
// Per-ball hit test, called by fireballs.update() after every sub-step of at most 3 m along the ball's path (a swept
// test, so a slow frame cannot jump a ball over a boulder or a rider). Returns what the ball hit or null.
function fireballHits(pos, ball) {
 const d = -pos.z, alt = pos.y + d * worldSlope;   // world y -> metres above the water at that distance
 if (!WATERFALL_MAP) {
  if (alt < 0) return 'water';
  if (terrainHeight(pos.x, d) > alt) return 'rock';
 }
 if (ball.owner !== 'me') return null;   // a friend's ball is only a picture here: the shooter decides its hits
 for (const o of obstacles) {
  if (o.mesh.visible && Math.hypot(pos.x - o.x, d - o.d) < o.radius + 1 && alt < o.height) { destroyBoulder(o); return 'rock'; }
 }
 for (const [id, rr] of riders) {
  if (rr.ready && rr.dragon.visible && rr.pos.distanceTo(pos) < 7) {
   // The ball bursts on them here; the KILL is scored only when they answer 'hitok' (a rider inside their 3 s shield
   // window or already shot down absorbs the ball and sends nothing, so the scoreboard never drifts).
   net.event('hit', {target: id});
   return 'player:' + id;
  }
 }
 return null;
}
$('fire').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); fire('button'); });

// ---------------------------------------------------------------------------------------------
// Voice fire (speech.js): listens for the fire word while flying when 'Voice fire' is on in Settings (default on).
// Headless and desktop browsers without a microphone fall back to the FIRE button and the F key.
// ---------------------------------------------------------------------------------------------
let voiceFireEnabled = true, noiseFireEnabled = true;
try {
 voiceFireEnabled = localStorage.getItem('dragonfall-voice-fire') !== 'false';
 noiseFireEnabled = localStorage.getItem('dragonfall-noise-fire') !== 'false';
} catch {}
const speech = createSpeech({onFire: () => fire('voice'), getWord: readFireWord, onStatus: showVoiceStatus, onHeard: showHeard});
const noiseFire = createNoiseFire({onFire: () => fire('noise'), isPlaying: () => mode === 'playing', onStatus: showNoiseStatus, onLevel: showNoiseLevel});
// Small line under the distance counter: what the microphone hears, so a player can see why a word did not fire.
let heardTimer = 0;
function showHeard(text) {
 const el = $('voice-hud');
 el.textContent = 'heard: ' + String(text || '').trim().slice(-48);
 el.classList.add('show');
 clearTimeout(heardTimer);
 heardTimer = setTimeout(() => el.classList.remove('show'), 2500);
}
function showMicState(state) {
 const el = $('mic-state');
 const word = readFireWord().split(/[,;/|]+/)[0].trim();
 const map = {listening: 'mic on · say "' + word + '"', starting: 'mic…', 'no-speech': 'mic on · say "' + word + '"', aborted: 'mic on', network: 'mic: no network', 'not-allowed': 'mic blocked · use FIRE', 'service-not-allowed': 'mic blocked · use FIRE', 'audio-capture': 'no mic · use FIRE', unsupported: 'no voice · use FIRE', idle: ''};
 el.textContent = voiceFireEnabled ? (map[state.status] ?? state.status) : '';
}
function showNoiseStatus(state) {
 const el = $('mic-state');
 if (!noiseFireEnabled) { if (!voiceFireEnabled) el.textContent = ''; return; }
 const text = state.status === 'starting' ? 'mic…' : state.status === 'not-allowed' ? 'loud fire mic blocked · use FIRE' : state.status === 'audio-capture' ? 'no loud-fire mic · use FIRE' : state.status === 'listening' ? (state.calibrating ? 'mic on · setting base level' : 'mic on · loud sound fires') : state.status === 'suspended' ? 'mic paused' : state.status === 'unsupported' ? 'no loud-fire mic · use FIRE' : '';
 el.textContent = text;
}
function showNoiseLevel(level,state) { if (state?.listening && !state.calibrating) showNoiseStatus(state); }
function showVoiceStatus(state) {
 const word = readFireWord();
 const denied = 'Voice: microphone denied. Allow the microphone for this site, or use the FIRE button / F key.';
 const map = {
  listening: 'Voice: listening for "' + word + '".',
  starting: 'Voice: asking the browser for the microphone…',
  idle: voiceFireEnabled ? 'Voice: starts listening for "' + word + '" when you take flight.' : 'Voice: off. The FIRE button and the F key always work.',
  unsupported: 'Voice: this browser has no speech recognition. Use the FIRE button or the F key.',
  'not-allowed': denied,
  'service-not-allowed': denied,
  'audio-capture': 'Voice: no microphone found. Use the FIRE button or the F key.',
  network: 'Voice: the speech service is unreachable, retrying. Use the FIRE button meanwhile.',
  'no-speech': 'Voice: listening for "' + word + '" (nothing heard yet).',
  aborted: 'Voice: restarting.',
 };
 let text = map[state.status] || ('Voice: ' + state.status + '.');
 if (state.lastHeard && state.listening) text += ' Heard: "' + state.lastHeard.trim().slice(-40) + '".';
 $('voice-status').textContent = text;
 showMicState(state);
}
function startVoice() {
 if (!voiceFireEnabled || !speech.state.supported) { showVoiceStatus(speech.state); } else if (!STICKY_STATUSES.includes(speech.state.status)) speech.start();
}
function startNoise() {
 if (!noiseFireEnabled || !noiseFire.state.supported) { showNoiseStatus(noiseFire.state); return; }
 noiseFire.start();
}
$('speed-slider').addEventListener('input', () => {
 const v = WATERFALL_MAP ? setWaterfallSpeed($('speed-slider').value) : setSpeedMultiplier($('speed-slider').value);
 $('speed-value').value = v.toFixed(2) + 'x';
});
// 'Test the microphone': starts listening right from the tap (so the browser's microphone prompt is allowed to show)
// and the status line prints what is heard, without taking flight.
$('voice-test').addEventListener('click', () => {
 if (!speech.state.supported && !noiseFire.state.supported) { showVoiceStatus(speech.state); showNoiseStatus(noiseFire.state); return; }
 voiceFireEnabled = true; $('voice-fire').checked = true;
 noiseFireEnabled = true; $('noise-fire').checked = true;
 try { localStorage.setItem('dragonfall-voice-fire', 'true'); localStorage.setItem('dragonfall-noise-fire', 'true'); } catch {}
 if (speech.state.supported) { speech.stop(); speech.start(); }
 noiseFire.start();
 showVoiceStatus(speech.state);
});
$('fire-word').addEventListener('change', () => { $('fire-word').value = saveFireWord($('fire-word').value); showVoiceStatus(speech.state); });
$('voice-fire').addEventListener('change', () => {
 voiceFireEnabled = $('voice-fire').checked;
 try { localStorage.setItem('dragonfall-voice-fire', String(voiceFireEnabled)); } catch {}
 if (!voiceFireEnabled) speech.stop();   // when switched on, the next take-off / resume starts listening
 showVoiceStatus(speech.state);
});
$('noise-fire').addEventListener('change', () => {
 noiseFireEnabled = $('noise-fire').checked;
 try { localStorage.setItem('dragonfall-noise-fire', String(noiseFireEnabled)); } catch {}
 if (!noiseFireEnabled) noiseFire.stop(); else if (mode === 'playing') startNoise();
 showNoiseStatus(noiseFire.state);
});

// ---------------------------------------------------------------------------------------------
// Fly with friends (net.js over PeerJS). One player hosts and gets a 4-letter code; friends join with it or open
// the share link (?room=CODE). Every other rider is a full dragon (createDragon) with a name sprite over its head;
// its state arrives ~12x a second and is smoothed (damp 8) so it glides instead of stepping.
// ---------------------------------------------------------------------------------------------
const riders = new Map();   // id -> {model, dragon, label, name, pos, target, rot, trot, phase, lastState, lastHealth, ready}
let pendingRoom = (query.get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
const net = createNet({onStatus: showNetStatus, onPlayer: onRiderChange, onEvent: onNetEvent});
window.__net = net;   // headless tests read net.status and net.players
function makeNameLabel(name) {
 const c = document.createElement('canvas');
 c.width = 256;
 c.height = 64;
 const g = c.getContext('2d');
 g.font = '700 30px Manrope, Arial, sans-serif';
 g.textAlign = 'center';
 g.textBaseline = 'middle';
 g.shadowColor = '#001a18';
 g.shadowBlur = 8;
 g.fillStyle = '#e9fff5';
 g.fillText(String(name).slice(0, 14), 128, 32);
 const tex = new THREE.CanvasTexture(c);
 tex.colorSpace = THREE.SRGBColorSpace;
 const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false}));
 sprite.scale.set(4, 1, 1);          // dragon-local units (x1.6 in the world)
 sprite.position.set(0, 2.4, -5.5);  // above the head (HEAD_Z is -6.6 in dragon.js)
 return sprite;
}
// Fourth argument silent: true when net.js is tearing the room down because WE left (no 'X LEFT' toast then).
function onRiderChange(kind, id, p, silent = false) {
 if (kind === 'join') {
  const m = createDragon(renderer);
  m.setSun(sky.sunDirection, sky.sunColor);
  m.dragon.visible = false;   // shown once the first state packet places it
  const label = makeNameLabel(p.name || 'Rider');
  m.dragon.add(label);
  scene.add(m.dragon);
  riders.set(id, {model: m, dragon: m.dragon, label, labelText: p.name || 'Rider', name: p.name || 'Rider', pos: new THREE.Vector3(), target: new THREE.Vector3(), rot: {p: 0, y: 0, r: 0}, trot: {p: 0, y: 0, r: 0}, phase: 0, lastState: null, lastHealth: 3, ready: false});
  toast((p.name || 'A RIDER').toUpperCase() + ' JOINED');
 } else if (kind === 'leave') {
  const rr = riders.get(id);
  if (!rr) return;
  scene.remove(rr.dragon);
  rr.model.dispose?.();
  rr.label.material.map.dispose();
  rr.label.material.dispose();
  riders.delete(id);
  if (!silent) toast(rr.name.toUpperCase() + ' LEFT');
 }
 showNetStatus(net.status);
}
// Removes every remote dragon from the scene (disposing its name sprite). Used when the room ends for any reason:
// Leave the room, 'The host left.', a connection error, or a fresh flight outside a room.
function clearRiders(silent = true) {
 for (const id of [...riders.keys()]) onRiderChange('leave', id, null, silent);
}
function updateRiders(dt) {
 for (const [id, rr] of riders) {
  const p = net.players.get(id), st = p && p.state;
  if (!st) continue;
  const worldPose=st.wf===1&&[st.x,st.a,st.z,st.p,st.y,st.r,st.ph].every(Number.isFinite)&&Array.isArray(st.q)&&st.q.length===4&&st.q.every(Number.isFinite)&&Number.isFinite(Math.hypot(...st.q))&&Math.hypot(...st.q)>1e-8;
  if (WATERFALL_MAP !== (st.wf===1)||(st.wf===1&&!worldPose)) { rr.dragon.visible=false;continue; }
  rr.dragon.visible=true;
  if (st !== rr.lastState) {
   rr.lastState = st;
   if(worldPose){
    rr.target.set(st.x,st.a,st.z);
    rr.targetQuaternion=new THREE.Quaternion().fromArray(st.q).normalize();
    if(!rr.quaternion)rr.quaternion=rr.targetQuaternion.clone();
   } else rr.target.set(st.x, st.a - st.d * worldSlope, -st.d);
   rr.trot.p = st.p;
   rr.trot.y = st.y;
   rr.trot.r = st.r;
   rr.phase = st.ph;
   rr.name = p.name;
   // The label carries the name plus 'PAUSED' while that rider sits in the pause / Settings screen (packet pz = 1).
   const labelText = rr.name + (st.pz ? ' · PAUSED' : '');
   if (labelText !== rr.labelText) { rr.labelText = labelText; rr.dragon.remove(rr.label); rr.label.material.map.dispose(); rr.label.material.dispose(); rr.label = makeNameLabel(labelText); rr.dragon.add(rr.label); }
   if (st.h < rr.lastHealth) rr.model.setHurt(0.25);   // their skin pulses red when they lose a shield
   rr.lastHealth = st.h;
   if (!rr.ready) { rr.ready = true; rr.pos.copy(rr.target); Object.assign(rr.rot, rr.trot); rr.dragon.visible = true; }
  } else {
   rr.phase += dt * TAU * 0.77;   // keep the wings beating between packets
  }
  const k = 1 - Math.exp(-8 * dt);
  rr.pos.lerp(rr.target, k);
  rr.rot.p += (rr.trot.p - rr.rot.p) * k;
  rr.rot.y += (rr.trot.y - rr.rot.y) * k;
  rr.rot.r += (rr.trot.r - rr.rot.r) * k;
  const pose = wingbeatPose(rr.phase, 0, 35);
  rr.dragon.position.copy(rr.pos);
  rr.dragon.position.y += pose.body * 1.6;
  if(worldPose){rr.quaternion.slerp(rr.targetQuaternion,k);rr.dragon.quaternion.copy(rr.quaternion);rr.dragon.rotateZ(rr.rot.r);}
  else rr.dragon.rotation.set(rr.rot.p, rr.rot.y, rr.rot.r, 'YXZ');
  // Same head-leads / neck-follows / tail-lags chain as the local dragon (dragon.js update()).
  rr.model.update(pose, {pitch: rr.rot.p, yaw: rr.rot.y, roll: rr.rot.r, speed: 35 * getSpeedMultiplier()}, 0, 0, time);
 }
}
const _remoteOrigin = new THREE.Vector3(), _remoteVel = new THREE.Vector3();
function onNetEvent(packet) {
 const from = riders.get(packet.id), name = (from ? from.name : 'A RIDER').toUpperCase();
 const senderState=net.players.get(packet.id)?.state;
 if(senderState&&WATERFALL_MAP!==(senderState.wf===1))return;
 if (packet.k === 'fire' && Array.isArray(packet.o) && Array.isArray(packet.v)) {
  _remoteOrigin.fromArray(packet.o);
  _remoteVel.fromArray(packet.v);
  const speed = _remoteVel.length() || 140;
  fireballs.fire({origin: _remoteOrigin, direction: _remoteVel.normalize(), speed, owner: packet.id, range: FIREBALL_RANGE});
  if (_remoteOrigin.distanceTo(dragon.position) < 250) audio.fireball();
 } else if (packet.k === 'hit' && packet.target === net.id) {
  // Only a hit that really costs a shield is confirmed back to the shooter (hit() ignores the invulnerable window).
  if (mode === 'playing' && flight.invulnerable <= 0) { hit('FIREBALL FROM ' + name); net.event('hitok', {shooter: packet.id}); }
 } else if (packet.k === 'hitok' && packet.shooter === net.id) {
  audio.hitPlayer();
  scoreKill('HIT ' + name);
 } else if (packet.k === 'down') {
  toast(name + ' WAS SHOT DOWN');
 } else if (packet.k === 'respawn') {
  toast(name + ' IS BACK');
 }
}
// Shot down in a room: 3 s of untouchable gliding (no steering, no fire), then full shields where you are.
function shotDown() {
 flight.health = 0;
 saveBest();
 updateHealth();
 flight.invulnerable = 3.5;
 respawnAt = time + 3;
 net.event('down', {});
 toast('SHOT DOWN · BACK IN 3 S');
}
function respawn() {
 respawnAt = 0;
 flight.health = 3;
 flight.invulnerable = 2;
 if (!WATERFALL_MAP) { flight.alt = Math.max(flight.alt, 29);flight.x = centerAt(flight.distance); }
 updateHealth();
 net.event('respawn', {});
 toast('FULL SHIELDS · FLY');
}
const escapeHtml = v => String(v).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
function showNetStatus(st) {
 const el = $('net-status'), others = net.players.size;
 if (st.mode === 'offline') {
  // Belt and braces: whatever ended the room, no remote dragon may stay in the canyon.
  if (riders.size) clearRiders(true);
  if (mode === 'playing' || mode === 'paused') saveBest();
  el.innerHTML = st.error ? '<span class="net-error">' + escapeHtml(st.error) + '</span>'
   : st.note ? escapeHtml(st.note)   // 'Could not reach the room server, trying again (2 of 3)...'
   : "Not connected. Host a room and share the code, or enter a friend's code.";
 } else {
  el.innerHTML = '<span class="net-label">' + (st.mode === 'host' ? 'YOUR ROOM CODE' : 'IN ROOM') + '</span><b class="net-code">' + escapeHtml(st.code) + '</b>'
   + '<span>' + (others === 0 ? 'Nobody else yet. ' : others + (others === 1 ? ' rider' : ' riders') + ' with you. ') + (st.mode === 'host' ? 'Friends join with the code or this link:' : '') + '</span>'
   + (st.mode === 'host' ? '<input class="text-input net-link" readonly value="' + escapeHtml(net.shareLink()) + '" aria-label="Share link" onfocus="this.select()">' : '')
   + (st.error ? '<span class="net-error">' + escapeHtml(st.error) + '</span>' : '');
 }
 $('leave-room').hidden = st.mode === 'offline';
 updateScoreboard();
}
function updateScoreboard() {
 if (net.status.mode === 'offline') { $('scoreboard').hidden = true; return; }
 const rows = [[net.name + ' (you)', flight.kills || 0]];
 for (const p of net.players.values()) rows.push([p.name, (p.state && p.state.k) || 0]);
 rows.sort((a, b) => b[1] - a[1]);
 $('scoreboard').hidden = false;
 $('scoreboard').textContent = 'ROOM ' + net.status.code + '\n' + rows.map(([n, k]) => n + ': ' + k).join('\n');
}
function setNameFromInput() { if ($('player-name').value.trim()) net.setName($('player-name').value); }
$('player-name').addEventListener('change', setNameFromInput);
$('host-room').onclick = async () => {
 setNameFromInput();
 $('net-status').textContent = 'Opening a room…';
 try {
  await net.host();
  $('room-code').value = net.status.code;
 } catch (e) {
  $('net-status').innerHTML = '<span class="net-error">Could not open a room: ' + escapeHtml((e && (e.message || e.type)) || e) + '. Check the internet connection and try again.</span>';
 }
};
$('join-room').onclick = () => joinRoom($('room-code').value);
$('leave-room').onclick = () => net.leave();
async function joinRoom(code) {
 code = String(code || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
 if (code.length !== 4) { $('net-status').innerHTML = '<span class="net-error">A room code is 4 letters.</span>'; return; }
 setNameFromInput();
 $('net-status').textContent = 'Joining room ' + code + '…';
 toast('JOINING ROOM ' + code);
 try {
  await net.join(code);
  toast('IN ROOM ' + code + ' · FLY TOGETHER');
 } catch (e) {
  const msg = (e && e.message) || String(e);
  $('net-status').innerHTML = '<span class="net-error">' + escapeHtml(msg) + '</span>';
  toast('COULD NOT JOIN ' + code);
 }
}
// ?room=CODE in the address: the code is pre-filled in Settings and joined on the first TAKE FLIGHT.
if (pendingRoom) $('room-code').value = pendingRoom;
function joinPendingRoom() {
 if (!pendingRoom) return;
 const code = pendingRoom;
 pendingRoom = '';
 joinRoom(code);
}

// ---------------------------------------------------------------------------------------------
// Camera rig: 'rider' (from the saddle, default) or 'chase' (behind the dragon, the old framing)
// ---------------------------------------------------------------------------------------------
let cameraMode = 'rider';
try { if (localStorage.getItem('dragonfall-camera') === 'chase') cameraMode = 'chase'; } catch {}
const NOSE_DIVE_FOV = 12;   // degrees added to the field of view (damped) while flight.noseDive is true
if (query.get('camera') === 'chase' || query.get('camera') === 'rider') cameraMode = query.get('camera');
const cameraWorldPos = new THREE.Vector3(), headWorldPos = new THREE.Vector3();
function setCameraMode(next) {
 cameraMode = WATERFALL_MAP ? 'chase' : (next === 'chase' ? 'chase' : 'rider');
 const isRider = cameraMode === 'rider';
 // The rider's hands, reins and saddle only exist from the saddle; the streamers only make sense from behind.
 rider.group.visible = isRider;
 for (const t of trails) t.line.visible = !isRider;
 if (model.setRiderView) model.setRiderView(isRider);   // Hide the model's authored rider only in first person.
 if (isRider) {
  scene.remove(camera);
  camera.position.set(0, 0, 0);
  camera.rotation.set(0, 0, 0);
  camera.up.set(0, 1, 0);
  rider.eye.add(camera);
  rs.setFocusDistance(12);
 } else {
  rider.eye.remove(camera);
  scene.add(camera);
  rs.setMotion(0, 0, 0);
  rs.setFocusDistance(17);
  positionCamera(1, true);
 }
 placeWingPads();
}

// Keep the selected dragon's full animated wings and tail inside the chase frame.
// Raise the camera above intervening rocks without moving inside the long tail.
// terrainHeight is conservative (the visible mesh only ever recedes from it), so clearing it clears the mesh.
const target = new THREE.Vector3(), desiredCamera = new THREE.Vector3(), lookTarget = new THREE.Vector3();
function chaseGroundAt(x, d) { return terrainHeight(x, d) - d * worldSlope; }
function mapPoint(distance) { return {x:0,y:0,z:-distance,pitch:0}; }
function mapDragonPosition(distance, alt, localX) { return WATERFALL_MAP ? {x:flight.x,y:flight.alt,z:flight.z} : {x:localX,y:alt-distance*worldSlope,z:-distance}; }
function keepChaseCameraOutOfRock(cam, dist) {
 if (WATERFALL_MAP) return;
 const h = flight.alt - flight.distance * worldSlope;
 for (const t of [0.4, 0.7, 1]) {
  const d = flight.distance - dist * t;
  const x = flight.x + (cam.x - flight.x) * t;
  cam.y = Math.max(cam.y, h + (chaseGroundAt(x, d) + 2.5 - h) / t);
 }
 cam.z = -flight.distance + dist;
}
const cameraAnchor = new THREE.Vector3(), newAnchor = new THREE.Vector3(), cameraTravel = new THREE.Vector3();
function positionCamera(dt, instant = false) {
 const aspect = viewportWidth / viewportHeight;
 if (WATERFALL_MAP) {
  const pose=waterfallCameraPose(flight);camera.position.copy(pose.position);lookTarget.copy(pose.target);camera.up.copy(pose.up);camera.lookAt(lookTarget);camera.fov=56;camera.aspect=aspect;camera.updateProjectionMatrix();return;
 }
 const dist = aspect < 0.85 ? 48 : aspect < 1.2 ? 40 : 38, route=mapPoint(flight.distance), h = flight.alt - flight.distance * worldSlope;
 const worldX = flight.x;
 newAnchor.set(worldX, h, route.z);
 if (!instant) {
  cameraTravel.subVectors(newAnchor, cameraAnchor);
  camera.position.add(cameraTravel);
  lookTarget.add(cameraTravel);
 }
 cameraAnchor.copy(newAnchor);
 const steeringLead = flight.vx / getSpeedMultiplier();
 desiredCamera.set(worldX + steeringLead * 0.035, h + 6.4, route.z + dist);
 target.set(worldX + clamp(steeringLead * 0.14, -7, 7), h + 1.5, route.z - 35);
 keepChaseCameraOutOfRock(desiredCamera, dist);
 camera.position.lerp(desiredCamera, instant ? 1 : 1 - Math.exp(-15 * dt));
 lookTarget.lerp(target, instant ? 1 : 1 - Math.exp(-12 * dt));
 camera.up.set(-flight.roll * 0.06, 1, 0);
 camera.lookAt(lookTarget);
 const targetFov = (aspect < 0.85 ? 67 : 61) + (flight.speed / getSpeedMultiplier() - 35) * 0.11 + (flight.noseDive ? NOSE_DIVE_FOV : 0);
 camera.fov = instant ? targetFov : damp(camera.fov, targetFov, 2, dt);
 camera.aspect = aspect;
 camera.updateProjectionMatrix();
}

// A hit moves the dragon 8-12 m in one physics step (up and toward the canyon centre). The rider camera is hard-parented
// to the saddle, so without this the view would cut. The eye is offset by the opposite of that jump (dragon-local
// metres) and the offset is damped back to zero over ~0.5 s, so the correction reads as a smooth recovery.
const hitOffset = new THREE.Vector3(), _hitLocal = new THREE.Vector3(), _hitQuat = new THREE.Quaternion();
function hideHitCut(dx, dAlt) {
 if (cameraMode !== 'rider') return;
 _hitLocal.set(-dx, -dAlt, 0).applyQuaternion(_hitQuat.copy(dragon.quaternion).invert());
 hitOffset.add(_hitLocal);
}

// Rider camera: the camera hangs off rider.eye (which owns pitch, roll, yaw, bob and shake); here we only
// widen the field of view with speed, feed the reins the steering, and drive DOF focus and turn motion blur.
let prevRoll = 0;
function updateRiderCamera(dt, l, r) {
 const aspect = viewportWidth / viewportHeight;
 const mult = getSpeedMultiplier();
 rider.setSteeringLead(flight.vx / mult);
 // The fists get the RAW thumbs (not the inverted wing command): a thumb slid down pulls that side's rein back.
 rider.update(reins.left, reins.right, flight, dt);
 hitOffset.x = damp(hitOffset.x, 0, 6, dt);
 hitOffset.y = damp(hitOffset.y, 0, 6, dt);
 hitOffset.z = damp(hitOffset.z, 0, 6, dt);
 rider.eye.position.x = eyeBase.x + hitOffset.x;   // rider.update owns y (bob + thump); x/z are ours
 rider.eye.position.y += hitOffset.y;
 rider.eye.position.z = eyeBase.z + hitOffset.z;
 // 16:9 base fov 62 (was 56) so both wing leading edges cross the frame; portrait stays 74.
 const targetFov = (aspect < 0.85 ? 74 : 62) + (flight.speed / mult - 35) * 0.11 + (flight.pitch < -0.15 ? 4 : 0) + (flight.noseDive ? NOSE_DIVE_FOV : 0);
 camera.fov = damp(camera.fov, targetFov, 2, dt);
 camera.aspect = aspect;
 camera.updateProjectionMatrix();
 dragon.updateMatrixWorld(true);
 camera.getWorldPosition(cameraWorldPos);
 model.headAnchor.getWorldPosition(headWorldPos);
 rs.setFocusDistance(cameraWorldPos.distanceTo(headWorldPos));
 // Turn motion blur: walls streak sideways on a hard bank, slightly forward at speed.
 const dRoll = dt > 0 ? (flight.roll - prevRoll) / dt : 0;
 prevRoll = flight.roll;
 const strength = clamp(Math.abs(dRoll) * 0.35 + Math.max(0, flight.speed / mult - 45) / 40, 0, 1);
 rs.setMotion(strength, -Math.sign(dRoll) * 0.9, 0.35);
}

// Thumb pads stay in fixed side-and-bottom phone zones in both camera modes.
function placeWingPads() {
 document.body.classList.toggle('pads-corner', true);
 for (const side of ['left', 'right']) { const el = $(side + '-wing'); el.style.left = ''; el.style.top = ''; }
}

// ---------------------------------------------------------------------------------------------
// Dragon animation, world updates
// ---------------------------------------------------------------------------------------------
function animateDragon(dt, l, r) {
 const p=mapDragonPosition(flight.distance,flight.alt,flight.x);
 dragon.position.set(p.x,p.y,p.z);
 if (WATERFALL_MAP) { dragon.quaternion.copy(flight.orientation);dragon.rotateZ(flight.roll); }
 else dragon.rotation.set(flight.pitch, flight.yaw, flight.roll, 'YXZ');
 const pose = wingbeatPose(flapPhase, (l + r) * 0.5, flight.speed / (WATERFALL_MAP ? flight.speedMultiplier : getSpeedMultiplier()));
 const prevPhase = ((flapPhase % TAU) + TAU) % TAU;
 flapPhase += dt * Math.PI * 2 * pose.frequency;
 // The start of the power stroke (phase wrapped) is the wingbeat thump the rider feels.
 if (((flapPhase % TAU) + TAU) % TAU < prevPhase) {
  rider.beat();
  // Wing flap whoosh on each downstroke: heavier when climbing, lighter when diving.
  if (mode === 'playing') audio.flap(clamp(0.55 + (l + r) * 0.25, 0.2, 1));
 }
 dragon.position.y += pose.body * 1.6;   // the dragon is scaled 1.6, so the bob stays proportional
 model.update(pose, flight, l, r, time);
 dragon.updateMatrixWorld(true);
 if (cameraMode === 'chase') {
  for (let i = 0; i < 2; i++) {
   const tip = model.wingTip(i, pose), t = trails[i];
   t.points.unshift(tip);
   if (t.points.length > 22) t.points.pop();
   const pos = t.line.geometry.attributes.position;
   for (let j = 0; j < 22; j++) {
    const v = t.points[Math.min(j, t.points.length - 1)];
    pos.setXYZ(j, v.x, v.y, v.z);
   }
   pos.needsUpdate = true;
   t.line.visible = mode !== 'over';
  }
 }
}

function updateWorld(dt) {
 const mult = getSpeedMultiplier();
 if (WATERFALL_MAP) {
  const current={x:flight.x,y:flight.alt,z:flight.z};
  const target=selectWaterfallTarget(gates,flight),next=target?.index??gates.length;
  for(const g of gates){
   if(mode==='playing'&&!g.caught&&crossesWaterfallRing(flight.previousPosition,current,g.ring)){
    g.caught=true;g.passed=true;flight.gates++;audio.gate();toast('GATE CAUGHT +1');
   }
   // Keep three upcoming rings on screen so the rider can choose a line early.
   g.group.visible=!g.caught&&g.n>=next&&g.n<=next+2&&Math.hypot(g.group.position.x-current.x,g.group.position.y-current.y,g.group.position.z-current.z)<VISIBLE_RANGE;
  }
  const forward=waterfallForward(flight);
  for(const o of obstacles){
   const dx=o.x-current.x,dy=o.alt-current.y,dz=o.d===undefined?0:(o.mesh.position.z-current.z);
   const ahead=dx*forward.x+dy*forward.y+dz*forward.z;
   const radial=Math.sqrt(Math.max(0,dx*dx+dy*dy+dz*dz-ahead*ahead));
   const clearance=o.radius+4;
   if(mode==='playing'&&!o.hit&&ahead>-clearance&&ahead<clearance&&radial<clearance){o.hit=true;hit('ROCK GRAZE');}
   o.mesh.visible=!o.hit&&ahead>-120&&ahead<VISIBLE_RANGE;
  }
  // No route-driven transforms, recycling, spin or pulsing in this finite map.
  return;
 }
 for (const g of gates) {
  const relative = g.d - flight.distance;
  if (!g.passed && relative < 0) {
   g.passed = true;
   if (mode === 'playing' && Math.hypot(flight.x - g.x, flight.alt - g.alt) < 13.5) {
    flight.gates++;
    flight.speed = Math.min(flight.speed + 4 * mult, 72 * mult);
    g.caught = true;
    toast(flight.gates % 5 === 0 ? 'BEAUTIFUL LINE · ' + flight.gates + ' GATES' : 'GATE CAUGHT +1');
    audio.gate();
   }
  }
  if (relative < -100) setGate(g, g.n + gates.length);
  g.group.visible = !g.caught && relative < VISIBLE_RANGE;
  g.group.rotation.z += dt * 0.12;
  const pulse = 1 + Math.sin(time * 1.9 + g.n) * 0.015;
  g.group.scale.setScalar(pulse);
 }
 for (const o of obstacles) {
  if (WATERFALL_MAP) { o.mesh.visible=false; continue; }
  const relative = o.d - flight.distance;
  const bodyRadius = o.radius * (1.4 - 0.7 * clamp(flight.alt / o.height, 0, 1)) * 1.2;
  if (mode === 'playing' && Math.hypot(relative, flight.x - o.x) < bodyRadius + 1.4 && flight.alt < o.height + 1.5) hit('ROCK GRAZE');
  if (relative < -130) setObstacle(o, o.n + obstacles.length);
  o.mesh.visible = relative < VISIBLE_RANGE;
 }
 for (const a of arches) {
  if (WATERFALL_MAP) { a.mesh.visible=false; continue; }
  const rel = a.d - flight.distance, x = flight.x - a.x;
  const top = 66 * (1 - (x / 55) ** 2);
  // The arch tube is now 10 m thick (was 6.7), so the graze band widened from 8 to 10; the curve is unchanged.
  if (mode === 'playing' && Math.abs(rel) < 9 && Math.abs(x) < 56 && Math.abs(flight.alt - top) < 10) hit('ARCH GRAZE');
  if (rel < -160) setArch(a, a.n + arches.length);
  a.mesh.visible = rel < VISIBLE_RANGE;
 }
 if (mode === 'playing' && !WATERFALL_MAP) {
  const ground = terrainHeight(flight.x, flight.distance);
  // The wings (7 m either side) and the head (3 m ahead) test the rock too, so the 1.6-scale dragon can no longer
  // fly with a wing or the rider's eye inside a wall beside it (single-point test before; cheap CPU noise calls).
  const wingRock = Math.max(terrainHeight(flight.x - 7, flight.distance), terrainHeight(flight.x + 7, flight.distance));
  const headRock = terrainHeight(flight.x, flight.distance + 3);
  if (flight.alt < 3) hit('WATER GRAZE');
  else if (flight.alt < ground + 1.8 || flight.alt < headRock + 1.8) hit('CLIFF GRAZE');
  else if (flight.alt + 1.8 < wingRock) hit('WING GRAZE');
  if (flight.alt > 84 && flight.elapsed % 4 < dt) toast('THIN AIR · LOWER YOUR WINGS');
 }
}
function updateUI() {
 $('meters').textContent = Math.floor(flight.distance).toLocaleString();
 $('speed').textContent = Math.round(flight.speed * 3.6);
 $('altitude').textContent = Math.max(0, Math.round(flight.alt));
 $('gates').textContent = flight.gates;
 $('kills').textContent = flight.kills;
}

// ---------------------------------------------------------------------------------------------
// Viewport
// ---------------------------------------------------------------------------------------------
let resizeFrame = 0, rotationTimer = 0;
function resizeViewport() {
 resizeFrame = 0;
 const rect = $('game').getBoundingClientRect();
 const width = Math.max(1, Math.round(rect.width || window.innerWidth)), height = Math.max(1, Math.round(rect.height || window.innerHeight));
 const changed = width !== viewportWidth || height !== viewportHeight;
 if (!changed) return;
 const rotated = (width > height) !== (viewportWidth > viewportHeight);
 viewportWidth = width;
 viewportHeight = height;
 rs.setSize(width, height);
 camera.aspect = width / height;
 camera.updateProjectionMatrix();
 if (rotated) resetInputs();
 if (cameraMode === 'chase') positionCamera(1, true);
 placeWingPads();
}
function scheduleViewportResize() { if (!resizeFrame) resizeFrame = requestAnimationFrame(resizeViewport); }
function handleRotation() {
 tilt.rotate();
 resetInputs();
 scheduleViewportResize();
 clearTimeout(rotationTimer);
 rotationTimer = setTimeout(resizeViewport, 250);
}
addEventListener('resize', scheduleViewportResize);
addEventListener('orientationchange', handleRotation);
window.visualViewport?.addEventListener('resize', scheduleViewportResize);
window.screen?.orientation?.addEventListener('change', handleRotation);
document.addEventListener('fullscreenchange', () => {
 allowRotation();
 handleRotation();
 $('fullscreen').setAttribute('aria-label', document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen');
});
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(scheduleViewportResize).observe($('game'));
allowRotation();

// ---------------------------------------------------------------------------------------------
// ?stats=1 overlay: tier, fps, draw calls, triangles, pass count, pixel ratio (every 0.5 s)
// ---------------------------------------------------------------------------------------------
const statsEl = $('stats');
let statsTime = 0, statsFrames = 0;
const fpsSamples = [];
function updateStats(dt) {
 // dt here is the real wall-clock frame time (unclamped) so the fps number is honest on slow machines.
 fpsSamples.push(dt);
 if (fpsSamples.length > 30) fpsSamples.shift();
 statsTime += dt;
 statsFrames++;
 if (statsTime < 0.5) return;
 statsTime = 0;
 const avg = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
 const info = renderer.info.render;
 statsEl.textContent = `tier ${tier} | fps ${(avg > 0 ? 1 / avg : 0).toFixed(0)} | calls ${info.calls} | tris ${info.triangles} | passes ${rs.composer.passes.length} | ratio ${rs.getPixelRatio().toFixed(2)} | camera ${cameraMode} | d ${Math.floor(flight.distance)} hits ${window.__hits}`;
}
if (showStats) statsEl.hidden = false;
// ?debug=1 also exposes the live objects for headless inspection (never used by the game itself).
if (debug) window.__game = {camera, rider, model, dragon, scene, rs, sky, terrain, dressing, hitOffset, positionCamera, fire, fireballs, net, riders, audio, speech, start, pause, resume, gates, arches, obstacles, setObstacle, reins, lastControls, get flight() { return flight; }, get mode() { return mode; }, get cameraMode() { return cameraMode; }, setCameraMode, hit, waterfallWorld, waterfallEnvironment, waterfallGuide, canyonDressing, updateWorld, animateDragon, get waterfall() {return WATERFALL_MAP;}};

// ---------------------------------------------------------------------------------------------
// Frame loop: controls -> physics + world -> dragon -> camera -> terrain/water/dressing/sky -> UI -> render
// ---------------------------------------------------------------------------------------------
syncSettings();
setCameraMode(cameraMode);
updateUI();
function frame(now) {
 requestAnimationFrame(frame);
 const rawDt = (now - lastTime) / 1000;
 const dt = clamp(rawDt, 0, 0.1);
 lastTime = now;
 time += dt;
 let l = 0, r = 0;
 if (mode === 'playing') {
  [l, r] = controls();
  if (respawnAt) { l = r = 0; if (time >= respawnAt) respawn(); }   // shot down: glide hands-off until the respawn
  lastControls[0] = l;
  lastControls[1] = r;
  const steps = Math.max(1, Math.ceil(dt / PHYSICS_STEP)), step = dt / steps;
  for (let i = 0; i < steps && mode === 'playing'; i++) {
   if (WATERFALL_MAP) stepWaterfallFlight(flight, l, r, step);
   else stepFlight(flight, l, r, step);
   updateWorld(step);
  }
  fireballs.update(dt, fireballHits);   // moves each ball in <= 3 m sub-steps and hit-tests after each one
  if (flight.noseDive && !wasDiving) toast('NOSE DIVE');
  wasDiving = flight.noseDive;
 } else if (mode === 'intro' && !WATERFALL_MAP) {
  const mult = getSpeedMultiplier();
  flight.distance += dt * 20 * mult;
  flight.x = WATERFALL_MAP ? 0 : centerAt(flight.distance);
  flight.alt = 29 + Math.sin(time * 0.28) * 2;
  flight.roll = Math.cos(time * 0.28) * 0.05;
  flight.yaw = 0;
  flight.speed = 32 * mult;
  updateWorld(dt);
 }
 if (mode === 'playing' || mode === 'intro') {
  animateDragon(dt, l, r);
  if (cameraMode === 'rider') updateRiderCamera(dt, l, r);
  else positionCamera(dt);
 }
 // Presence goes out in every mode (no-op offline; ~12 packets/s in a room): a paused rider, or one in Settings,
 // keeps hovering in place for friends instead of being dropped after 6 s and re-added on resume.
 net.update(flight, flapPhase, dt, mode !== 'playing');
 if (riders.size) updateRiders(dt);
 if (!WATERFALL_MAP) terrain.update(flight.distance);
 water.update(time);
 if (!WATERFALL_MAP) dressing.update(time, flight);
 camera.getWorldPosition(cameraWorldPos);
 sky.update(time, cameraWorldPos, dragon.position);
 if (waterfallGuide) waterfallGuide.update(flight);
 uiTime += dt;
 if (uiTime > 0.12) {
  uiTime = 0;
  if (mode === 'playing') updateUI();
  updateAudio();
  if (mode === 'playing' && net.status.mode !== 'offline') updateScoreboard();
 }
 rs.render(dt);
 window.__frames++;
 if (showStats) updateStats(rawDt);
}
requestAnimationFrame(frame);
