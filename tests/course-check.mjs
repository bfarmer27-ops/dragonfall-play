// Course check for the Waterfall map: flies the REAL flight physics (stepWaterfallFlight) and the REAL bumper with
// an autopilot through every orb, at four speeds and at 60% and 100% stick, and fails on any orb that cannot be
// reached, any hazard hit, any bumper contact, an orb too close to the ground, a golden orb on the main line, or a
// hazard standing on the straight line between two orbs.
// Run: node tests/course-check.mjs   (exit code 1 on any problem)
import {registerHooks} from 'node:module';
import {Quaternion, Vector3} from '../vendor/three.module.js';

// waterfall-environment.js imports 'three/addons/...' (an import-map name in the browser); map it for Node.
const vendor = new URL('../vendor/', import.meta.url).href;
registerHooks({resolve(spec, ctx, next) {
 if (spec === 'three') return {url: vendor + 'three.module.js', shortCircuit: true};
 if (spec.startsWith('three/addons/')) return {url: vendor + 'addons/' + spec.slice(13), shortCircuit: true};
 return next(spec, ctx);
}});
const core = await import('../waterfall-core.js');
const flightModule = await import('../waterfall-flight.js');
const {WATERFALL_BUMPER_RADIUS} = await import('../waterfall-bumper.js');
const env = await import('../waterfall-environment.js');
const {hollowPath, HOLLOW_MOUTH, HOLLOW_EXIT, createRings, createWaterfallObstacles, setSpeedMultiplier, routeAt, ROUTE_LENGTH, FALL_START, WATERFALL_SPIRE_DISTANCES} = core;
const {initializeWaterfallFlight, stepWaterfallFlight, crossesWaterfallRing, applyOrbBoost} = flightModule;
const {waterfallGroundHeight, meander, valleyProfile, riverWidth, CURTAIN_Z, LOWER_WATER_Y, WORLD_START_Z, WORLD_END_Z, FINISH_Z} = env;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// --- surfaceHeight replica: the same terrain grid waterfall-environment.js builds (NX=128, ROW=10, CHUNK=260) ---
const NX = 128, ROW = 10, CHUNK = 260, NZ = CHUNK / ROW;
const columns = Array.from({length: NX + 1}, (_, i) => { const s = (i - NX / 2) / (NX / 2); return Math.sign(s) * Math.pow(Math.abs(s), 1.7) * 2600; });
const chunkCount = Math.ceil((WORLD_START_Z - WORLD_END_Z) / CHUNK);
const surfaces = [];
for (let chunk = 0; chunk < chunkCount; chunk++) {
 const start = WORLD_START_Z - chunk * CHUNK, n = NX + 1;
 const xs = new Float32Array(n * (NZ + 1)), ys = new Float32Array(n * (NZ + 1));
 for (let j = 0; j <= NZ; j++) {
  const z = start - j * ROW, prof = z <= CURTAIN_Z ? {x: meander(z), y: LOWER_WATER_Y} : valleyProfile(z);
  for (let i = 0; i < n; i++) { const x = prof.x + columns[i]; xs[j * n + i] = x; ys[j * n + i] = waterfallGroundHeight(x, z); }
 }
 surfaces.push({xs, ys, columns: n, rows: NZ, start, end: start - NZ * ROW});
}
// The river's water sheets count as surfaces too (same strips as waterfall-environment.js: lip, curtain, lower river).
const lip = routeAt(FALL_START), across = [-1, -.75, -.5, -.25, 0, .25, .5, .75, 1];
for (const [start, end] of [[WORLD_START_Z, lip.z], [lip.z, CURTAIN_Z], [CURTAIN_Z, WORLD_END_Z]]) {
 const n = Math.ceil((start - end) / 8), cols = across.length, xs = new Float32Array(cols * (n + 1)), ys = new Float32Array(cols * (n + 1));
 for (let j = 0; j <= n; j++) {
  const z = start + (end - start) * j / n, p = valleyProfile(z), w = riverWidth(z);
  if (start === CURTAIN_Z) { p.y = LOWER_WATER_Y; p.x = meander(z); }
  across.forEach((f, i) => { xs[j * cols + i] = p.x + f * w; ys[j * cols + i] = p.y; });
 }
 surfaces.push({xs, ys, columns: cols, rows: n, start, end});
}
// Copies of hollow.js floorAt / caveLimit (they live inside createHollow, which needs a WebGL scene).
// floorAt returns the CEILING when the footprint touches a side wall.
function hollowFloorAt(x, z, radius = 24) {
 const d = -z; if (d < HOLLOW_MOUTH - 20 || d > HOLLOW_EXIT + 20) return -Infinity;
 const p = hollowPath(clamp(d, HOLLOW_MOUTH, HOLLOW_EXIT));
 return Math.abs(x - p.x) + radius > p.r ? p.y + p.r : p.floor + 4;
}
function caveLimit(previous, next) {
 const d = -next.z; if (d < HOLLOW_MOUTH || d > HOLLOW_EXIT) return null;
 const p = hollowPath(d), dx = next.x - p.x, dy = next.y - p.y, len = Math.hypot(dx, dy);
 let x = next.x, y = next.y, active = false;
 if (len > p.clear) { const k = Math.max(p.clear, len - 1.2) / len; x = p.x + dx * k; y = p.y + dy * k; active = true; }
 const floorMin = p.floor + 30;
 if (y < floorMin) { y = Math.min(floorMin, y + 1.2); active = true; }
 return {x, y, z: next.z, active};
}
// Memo by exact (x, z, radius): every physics step asks again for the point the previous step ended on, and the
// gorge cells are the slowest to scan (128 columns per row).
const cache = new Map();
function gridHeight(x, z, radius) {
 let top = -Infinity;
 for (const s of surfaces) {
  if (z - radius > s.start || z + radius < s.end) continue;
  const dz = (s.start - s.end) / s.rows, n = s.columns, X = s.xs, Y = s.ys;
  const first = Math.max(0, Math.floor((s.start - z - radius) / dz)), last = Math.min(s.rows - 1, Math.floor((s.start - z + radius) / dz));
  for (let j = first; j <= last; j++) for (let i = 0; i < n - 1; i++) {
   const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
   if (Math.max(X[b], X[d]) < x - radius || Math.min(X[a], X[c]) > x + radius) continue;
   top = Math.max(top, Y[a], Y[b], Y[c], Y[d]);
  }
 }
 return top;
}
function surfaceHeight(x, z, radius = 24) {
 const key = x + ',' + z + ',' + radius;
 let top = cache.get(key);
 if (top === undefined) { top = gridHeight(x, z, radius); if (cache.size > 2e6) cache.clear(); cache.set(key, top); }
 return Math.max(top, hollowFloorAt(x, z, radius));
}

// --- Static checks ---------------------------------------------------------------------------------------------
const problems = [];
const fail = msg => problems.push(msg);
const rings = createRings();
const obstacles = createWaterfallObstacles();
const cues = rings.filter(r => !r.bonus);
const SURFACE_SPARE = 15, BONUS_OFF_LINE = 45, LINE_HAZARD_SPARE = 10, BODY = 11;
const pointSegment = (p, a, b) => {
 const ab = new Vector3().subVectors(b, a), t = clamp(new Vector3().subVectors(p, a).dot(ab) / ab.lengthSq(), 0, 1);
 return a.clone().addScaledVector(ab, t).distanceTo(p);
};
const v = r => new Vector3(r.center.x, r.center.y, r.center.z);
for (const r of rings) {
 if (r.hollow) continue;
 const spare = r.center.y - (surfaceHeight(r.center.x, r.center.z, WATERFALL_BUMPER_RADIUS) + WATERFALL_BUMPER_RADIUS);
 if (spare < SURFACE_SPARE) fail(`${r.bonus ? 'golden orb' : 'orb'} at ${r.distance.toFixed(0)} has ${spare.toFixed(1)} m above the bumper floor (need ${SURFACE_SPARE})`);
}
// After the last orb the river has a totem slalom and no orbs; a player weaves past each totem on its open
// side. These weave points join the route the checks follow (they are aimed at, never scored).
const weavePoints = obstacles.filter(o => o.kind === 'totem').map(o => {
 const p = routeAt(o.distance);
 return {distance: o.distance, center: {x: p.x - o.side * 30, y: p.y, z: o.z}, normal: {x: 0, y: 0, z: -1}, radius: 0, waypoint: true};
});
const route = withBonus => [...rings.filter(r => withBonus || !r.bonus), ...weavePoints].sort((a, b) => a.distance - b.distance);
const fullRoute = route(true), neighbours = r => {
 const i = fullRoute.indexOf(r);
 return [fullRoute.slice(0, i).reverse().find(x => !x.bonus), fullRoute.slice(i + 1).find(x => !x.bonus)];
};
// Outside the cave a golden orb sits at least 45 m off the line between its neighbours. In the cave the cues are
// only 350 m apart, so a golden orb that far off cannot be reached and still make the next cue; there it must be
// clear of a main-line pass (its own radius plus 2 m) and is proven reachable by the golden-orb flights below.
const info = [];
for (const r of rings.filter(r => r.bonus)) {
 const [before, after] = neighbours(r);
 if (!before || !after) continue;
 const off = pointSegment(v(r), v(before), v(after)), need = r.hollow ? r.radius + 2 : BONUS_OFF_LINE;
 const spare = r.hollow ? null : r.center.y - (surfaceHeight(r.center.x, r.center.z, WATERFALL_BUMPER_RADIUS) + WATERFALL_BUMPER_RADIUS);
 info.push(`golden orb at ${r.distance.toFixed(0)}: ${off.toFixed(1)} m off the line between its neighbours (need ${need})${spare === null ? '' : `, ${spare.toFixed(1)} m above the bumper floor (need ${SURFACE_SPARE})`}`);
 if (off < need) fail(`golden orb at ${r.distance.toFixed(0)} is only ${off.toFixed(1)} m off the line between its neighbour orbs (need ${need})`);
}
// The straight line between consecutive orbs (and through each golden orb) must clear every hazard by 10 m
// beyond the game's hit rule (across < radius + 11 inside base-6 .. top+6). Geysers count as always erupting.
function lineHazards(a, b, label) {
 const A = v(a), B = v(b), len = A.distanceTo(B);
 for (const o of obstacles) {
  let worst = Infinity;
  for (let s = 0; s <= len; s += 1) {
   const p = A.clone().lerp(B, s / len);
   if (p.y <= o.base - 6 || p.y >= o.top + 6) continue;
   worst = Math.min(worst, Math.hypot(o.x - p.x, o.z - p.z) - (o.radius + BODY));
  }
  if (worst < LINE_HAZARD_SPARE) fail(`${label} ${a.distance.toFixed(0)} -> ${b.distance.toFixed(0)} passes ${worst.toFixed(1)} m from the ${o.kind} at ${o.distance.toFixed(0)} (need ${LINE_HAZARD_SPARE})`);
 }
}
const mainRoute = route(false);
for (let i = 1; i < mainRoute.length; i++) lineHazards(mainRoute[i - 1], mainRoute[i], 'orb line');
for (const r of rings.filter(r => r.bonus)) {
 const [before, after] = neighbours(r);
 if (before) lineHazards(before, r, 'golden-orb line');
 if (after) lineHazards(r, after, 'golden-orb line');
}

// --- Flown checks ----------------------------------------------------------------------------------------------
// Autopilot: aim at a point before the orb along its normal, take the error in the dragon's own frame, and
// scale pitch/bank so |pitch| + |bank| <= maxInput (the real two-thumb budget: wingCommand(left, right)).
const GAIN = 5, LEAD_MAX = 150, LEAD_SHARE = .45;
// withBonus=false flies the green orbs only (the golden orbs are optional); true also chases every golden orb.
// limit (metres along the course) ends the flight early; only orbs before it count.
function fly(multiplier, maxInput, withBonus, trace = null, limit = Infinity) {
 setSpeedMultiplier(multiplier);
 const f = initializeWaterfallFlight({});
 f.surfaceHeight = surfaceHeight; f.caveLimit = caveLimit;
 const course = route(withBonus).map(r => ({...r, done: false}));
 const hazards = createWaterfallObstacles().map(o => ({...o, hit: false}));
 const result = {missed: [], caught: 0, hits: [], bumper: 0, bumperAt: new Set(), frozen: 0, worstPass: 0};
 const dt = 1 / 120, inverse = new Quaternion(), aim = new Vector3(), local = new Vector3();
 for (let step = 0; step < 120 * 400 && f.z > FINISH_Z && -f.z < limit && f.distance < ROUTE_LENGTH; step++) {
  const target = course.find(r => !r.done);
  let left = 0, right = 0;
  if (target) {
   const n = target.normal, c = target.center;
   const ahead = (c.x - f.x) * n.x + (c.y - f.alt) * n.y + (c.z - f.z) * n.z;
   const lead = target.waypoint ? 0 : Math.min(LEAD_MAX, Math.max(0, LEAD_SHARE * ahead));
   aim.set(c.x - n.x * lead, c.y - n.y * lead, c.z - n.z * lead);
   local.set(aim.x - f.x, aim.y - f.alt, aim.z - f.z).applyQuaternion(inverse.copy(f.orientation).invert());
   const yawError = Math.atan2(-local.x, -local.z), pitchError = Math.atan2(local.y, Math.hypot(local.x, local.z));
   let bank = GAIN * yawError, pitch = GAIN * pitchError;
   const sum = Math.abs(bank) + Math.abs(pitch);
   if (sum > maxInput) { bank *= maxInput / sum; pitch *= maxInput / sum; }
   left = pitch - bank; right = pitch + bank;
  }
  const before = {x: f.x, y: f.alt, z: f.z};
  stepWaterfallFlight(f, left, right, dt);
  const now = {x: f.x, y: f.alt, z: f.z};
  if (trace) trace(f, left, right, target);
  if (f.bumperActive) { result.bumper++; result.bumperAt.add(Math.round(-f.z / 50) * 50); }
  if (Math.hypot(now.x - before.x, now.y - before.y, now.z - before.z) < f.speed * dt * .2) result.frozen++;
  for (const r of course) {
   if (r.done) continue;
   const n = r.normal, ahead = (r.center.x - now.x) * n.x + (r.center.y - now.y) * n.y + (r.center.z - now.z) * n.z;
   if (r.waypoint) { if (ahead < 0) r.done = true; continue; }
   if (crossesWaterfallRing(before, now, r)) {
    r.done = true; result.caught++; f.streak = (f.streak || 0) + 1; applyOrbBoost(f, f.streak);
    const len = Math.hypot(n.x, n.y, n.z), a = {x: now.x - r.center.x, y: now.y - r.center.y, z: now.z - r.center.z};
    const along = (a.x * n.x + a.y * n.y + a.z * n.z) / len, off = Math.sqrt(Math.max(0, a.x ** 2 + a.y ** 2 + a.z ** 2 - along ** 2));
    result.worstPass = Math.max(result.worstPass, off / r.radius);
   } else if (ahead < -40) { r.done = true; result.missed.push(r); if (!r.bonus) f.streak = 0; }
  }
  for (const o of hazards) {
   if (o.hit) continue;
   const across = Math.hypot(o.x - now.x, o.z - now.z);
   if (now.y > o.base - 6 && now.y < o.top + 6 && across < o.radius + BODY) { o.hit = true; result.hits.push(o); }
  }
 }
 for (const r of course) if (!r.done && !r.waypoint && r.distance < limit) result.missed.push(r);
 return result;
}
export {surfaceHeight, caveLimit, fly};
if (import.meta.main) {
 // Green orbs at every speed: 60% stick up to the waterfall, 75% and 100% stick for the whole course. The
 // waterfall drop is a 360 m curve and the dive turn radius is 240 m at full stick (unchanged), so the drop needs
 // at least 67% stick by itself (at 70% and 15x the dragon brushes the waterfall's water sheet). Golden orbs too:
 // every speed, at 100% stick.
 const SPEEDS = [6, 8.6, 12, 15];
 const RUNS = [{input: .6, withBonus: false, limit: FALL_START}, {input: .75, withBonus: false}, {input: 1, withBonus: false}, {input: 1, withBonus: true}];
 const started = Date.now();
 const rows = [];
 for (const multiplier of SPEEDS) for (const {input, withBonus, limit = Infinity} of RUNS) {
  const r = fly(multiplier, input, withBonus, null, limit);
  const label = `${multiplier}x at ${Math.round(input * 100)}% stick${withBonus ? ' with golden orbs' : ''}${limit < Infinity ? ' up to the waterfall' : ''}`;
  const wanted = rings.filter(x => (withBonus || !x.bonus) && x.distance < limit).length;
  rows.push(`${label}: ${r.caught}/${wanted} orbs, ${r.hits.length} hazard hits, ${r.bumper} bumper steps, worst pass ${(r.worstPass * 100).toFixed(0)}% of ring radius`);
  for (const m of r.missed) fail(`${label}: missed the ${m.bonus ? 'golden orb' : m.hollow ? 'cave orb' : 'orb'} at ${m.distance.toFixed(0)}`);
  for (const o of r.hits) fail(`${label}: hit the ${o.kind} at ${o.distance.toFixed(0)}`);
  if (r.bumper) fail(`${label}: the bumper touched the ground or walls on ${r.bumper} steps near ${[...r.bumperAt].slice(0, 8).join(', ')}`);
  if (r.frozen) fail(`${label}: the dragon stalled on ${r.frozen} steps`);
 }
 console.log([...info, ...rows].join('\n'));
 console.log(`course-check: ${rings.length} orbs, ${obstacles.length} hazards, ${WATERFALL_SPIRE_DISTANCES.length} spires, ${SPEEDS.length * RUNS.length} flights in ${((Date.now() - started) / 1000).toFixed(1)} s`);
 if (problems.length) { console.error(problems.map(p => 'FAIL ' + p).join('\n')); process.exit(1); }
 console.log('course-check: passed');
}
