import assert from 'node:assert/strict';
import {
  ARC_RADIUS,
  FALL_START,
  FALL_END,
  DEFAULT_SPEED_MULTIPLIER,
  VERTICAL_START,
  VERTICAL_END,
  WATERFALL_APPROACH_RING_DISTANCE,
  WATERFALL_RIVER_CLEARANCE,
  WATERFALL_DESCENT_CLEARANCE,
  WATERFALL_DESCENT_RING_DISTANCE,
  WATERFALL_DESCENT_FOLLOW_RING_DISTANCE,
  WATERFALL_TURN_RING_DISTANCE,
  WATERFALL_EXIT_RING_DISTANCE,
  WATERFALL_OPENING_RING_DISTANCES,
  WATERFALL_PRELUDE_RING_DISTANCES,
  PRELUDE_LENGTH,
  HOLLOW_LENGTH,
  HOLLOW_MOUTH,
  HOLLOW_EXIT,
  HOLLOW_RING_CUES,
  HOLLOW_BONUS_ORBS,
  HOLLOW_HAZARDS,
  HOLLOW_WIND_RIVERS,
  HOLLOW_WIND_RADIUS,
  hollowPath,
  hollowWindPoint,
  ENTRY_TOP_Y,
  WATERFALL_BONUS_ORBS,
  WATERFALL_BONUS_VALUE,
  WATERFALL_RING_RADIUS,
  WATERFALL_SPIRE_DISTANCES,
  WATERFALL_TOTEM_DISTANCES,
  WATERFALL_BOOST_SECONDS,
  WATERFALL_CRUISE_SPEED,
  boostGainForStreak,
  createRings,
  createWaterfallObstacles,
  routeAt,
  setSpeedMultiplier,
  getSpeedMultiplier,
} from '../waterfall-core.js';
import {normalizeThumbInput} from '../control-settings.js';
import {initializeWaterfallFlight, stepWaterfallFlight, applyOrbBoost, waterfallBoostStrength, WATERFALL_TURN_RADIUS, WATERFALL_PITCH_RADIUS} from '../waterfall-flight.js';
import {limitWaterfallMovement, WATERFALL_BUMPER_RADIUS} from '../waterfall-bumper.js';

const close = (a, b, epsilon = 1e-6) => Math.abs(a - b) <= epsilon;

setSpeedMultiplier(7);
const rings = createRings(7);
const hollowRings = rings.filter(r => r.hollow), outside = rings.filter(r => !r.hollow);
const cues = outside.filter(r => !r.bonus), bonuses = outside.filter(r => r.bonus);
const approach = rings.find(r => close(r.distance, WATERFALL_APPROACH_RING_DISTANCE));
const turn = rings.find(r => close(r.distance, WATERFALL_TURN_RING_DISTANCE));
const exit = rings.find(r => close(r.distance, WATERFALL_EXIT_RING_DISTANCE));
const descentFirst = rings.find(r => close(r.distance, WATERFALL_DESCENT_RING_DISTANCE));
const descentFollow = rings.find(r => close(r.distance, WATERFALL_DESCENT_FOLLOW_RING_DISTANCE));
assert.equal(DEFAULT_SPEED_MULTIPLIER, 12, 'the default waterfall speed is 12x');
assert.equal(cues.length, 11, 'three Sky Isles cues plus the eight planned waterfall cues');
assert.equal(bonuses.length, WATERFALL_BONUS_ORBS.length, 'every golden bonus orb outside the Hollow is placed');
assert.equal(hollowRings.length, HOLLOW_RING_CUES.length + HOLLOW_BONUS_ORBS.length, 'every Hollow cue and golden orb is placed');
assert.equal(rings.length, 13 + hollowRings.length, 'eleven cues plus two golden orbs after the Hollow');
for (const distance of WATERFALL_PRELUDE_RING_DISTANCES) {
 assert.ok(distance > HOLLOW_LENGTH && distance < PRELUDE_LENGTH, 'prelude cues sit among the floating islands, after the Hollow and before the gorge');
 assert.ok(rings.some(r => close(r.distance, distance)), 'each prelude ring exists');
}
assert.ok(FALL_START > PRELUDE_LENGTH + 2000, 'the gorge keeps its full run-up after the prelude');
for (let i = 1; i < rings.length; i++) assert.ok(rings[i].distance >= rings[i - 1].distance, 'rings are ordered along the course');
for (const b of bonuses) {
 assert.equal(b.value, WATERFALL_BONUS_VALUE, 'a golden orb is worth five');
 assert.ok(Math.abs(b.x) >= 40, 'golden orbs hang off the main line');
 assert.ok(b.altitude < routeAt(b.distance).y - 40, 'golden orbs sit well below the cruise height');
 assert.ok(b.altitude > routeAt(b.distance).y - WATERFALL_RIVER_CLEARANCE + 30, 'golden orbs stay above the water');
 assert.ok(b.radius < cues[0].radius, 'golden orbs are smaller targets than the cues');
}
for (const c of cues) assert.equal(c.value, 1, 'a green orb is worth one');
for (const distance of WATERFALL_OPENING_RING_DISTANCES) {
 assert.ok(rings.some(r => close(r.distance, distance)), 'each opening ring exists before the approach cues');
}
assert.ok(new Set(cues.map(r => r.x)).size > 1, 'rings require left and right flight, not one straight line');
assert.ok(approach, 'the approach cue exists before the waterfall');
assert.ok(approach.distance < FALL_START && approach.normal.z === -1, 'the approach cue is level');
assert.ok(turn, 'the 45-degree turn cue exists');
assert.ok(close(turn.normal.y, -Math.SQRT1_2), 'the turn cue points down at 45 degrees');
assert.ok(close(turn.normal.z, -Math.SQRT1_2), 'the turn cue still points forward at 45 degrees');
assert.ok(exit, 'the bottom transition cue exists');
assert.ok(close(exit.normal.y, -Math.SQRT1_2), 'the bottom cue rises at 45 degrees');
assert.ok(close(exit.normal.z, -Math.SQRT1_2), 'the bottom cue still points forward at 45 degrees');
assert.ok(descentFirst && descentFollow, 'the two planned descent cues exist');
assert.ok(descentFirst.distance < VERTICAL_START + 360, 'the first down cue arrives sooner');
assert.ok(descentFirst.z < turn.z - 150, 'the first down cue moves farther from the waterfall');
assert.ok(exit.distance > descentFollow.distance, 'the bottom cue stays last and harder');

const descent = rings.filter(r => r.distance >= VERTICAL_START && r.distance < VERTICAL_END);
assert.equal(descent.length, 2, 'the straight drop has only the two planned cues');
const safeDescentZ = routeAt(FALL_START).z - (ARC_RADIUS - 60) - WATERFALL_DESCENT_CLEARANCE;
assert.ok(descent.every(r => r.z <= safeDescentZ + 1e-6), 'descent cues stay in the far plane');
assert.equal(descentFirst.z, descentFollow.z, 'descent cues stay in one plane');

// The Hollow: the cave's centre line starts and ends at the cruise height, on the route's line, and every
// cue and golden orb sits inside the clear radius so the whole ring can be flown through.
for (const d of [0, HOLLOW_MOUTH, HOLLOW_EXIT, HOLLOW_LENGTH]) { const p = hollowPath(d); assert.ok(close(p.y, ENTRY_TOP_Y, 1e-6) && close(p.x, 0, 1e-6), 'the Hollow begins and ends on the route line at ' + d); }
let deepest = 0, tightest = Infinity, lastP = hollowPath(0);
for (let d = 1; d <= HOLLOW_LENGTH; d += 1) {
 const p = hollowPath(d);
 assert.ok(Math.abs(p.x - lastP.x) < 1.5 && Math.abs(p.y - lastP.y) < 1.5 && Math.abs(p.r - lastP.r) < 3, 'the tunnel changes smoothly at ' + d);
 if (p.inside) { deepest = Math.max(deepest, ENTRY_TOP_Y - p.y); tightest = Math.min(tightest, p.clear); assert.ok(p.r >= 100, 'the tunnel is never narrower than 100 m at ' + d); }
 lastP = p;
}
assert.ok(deepest > 300, 'the shaft dives well below the cruise height (' + deepest.toFixed(0) + ' m)');
assert.ok(tightest >= 48, 'the clear radius always fits the 24 m dragon with room (' + tightest.toFixed(0) + ')');
for (const r of hollowRings) {
 const p = hollowPath(r.distance), off = Math.hypot(r.x - p.x, r.altitude - p.y);
 assert.ok(off + r.radius <= p.clear + 1e-6 || !p.inside, 'Hollow ring at ' + r.distance + ' fits inside the clear radius');
 assert.ok(r.altitude - r.radius > p.floor + 6 || !p.inside, 'Hollow ring at ' + r.distance + ' clears the floor');
 assert.equal(r.value, r.bonus ? WATERFALL_BONUS_VALUE : 1, 'Hollow orb values');
}
assert.ok(hollowRings.some(r => r.distance < HOLLOW_MOUTH), 'a cue leads into the mouth');
assert.ok(hollowRings.some(r => close(r.distance, HOLLOW_EXIT)), 'a cue marks the exit');

// Designed hazards: four spires in the gorge slalom before the fall, three totems in the lower river after it,
// and twelve Hollow hazards that leave a clear line past each one.
const obstacles = createWaterfallObstacles();
const spires = obstacles.filter(o => o.kind === 'spire'), totems = obstacles.filter(o => o.kind === 'totem'), hollowHazards = obstacles.filter(o => o.hollow), river = obstacles.filter(o => !o.hollow);
assert.equal(spires.length, WATERFALL_SPIRE_DISTANCES.length, 'every spire is placed');
assert.equal(totems.length, WATERFALL_TOTEM_DISTANCES.length, 'every totem is placed');
assert.equal(hollowHazards.length, HOLLOW_HAZARDS.length, 'every Hollow hazard is placed');
assert.ok(spires.every(o => o.distance > PRELUDE_LENGTH + 600 && o.distance < FALL_START - 300), 'spires stand in the gorge, after the islands and before the approach cue');
assert.ok(totems.every(o => o.distance > FALL_END + 200), 'totems stand in the river after the fall');
assert.ok(river.every(o => Math.abs(o.side) === 1 && o.x * o.side > 0 && o.radius >= 14), 'river hazards come from both sides with a real footprint');
assert.ok(river.every(o => close(o.base, routeAt(o.distance).y - WATERFALL_RIVER_CLEARANCE)), 'river hazards start at the river');
assert.ok(obstacles.every(o => o.top > o.base), 'every hazard has height');
assert.ok(river.every(o => o.top > routeAt(o.distance).y), 'river hazards rise into the flight corridor');
for (let i = 1; i < spires.length; i++) assert.notEqual(spires[i].side, spires[i - 1].side, 'spires alternate sides for a slalom');
assert.ok(river.every(o => Math.abs(o.x) + o.radius < 64), 'every river hazard leaves a clear line past it inside the river');
for (let i = 1; i < obstacles.length; i++) assert.ok(obstacles[i].distance >= obstacles[i - 1].distance, 'hazards are ordered along the course');
for (const o of hollowHazards) {
 const p = hollowPath(o.distance);
 assert.ok(o.distance > HOLLOW_MOUTH + 200 && o.distance < HOLLOW_EXIT - 200, 'Hollow hazards stand inside the cave');
 assert.ok(Math.abs(o.x - p.x) - o.radius < p.clear, 'Hollow hazard at ' + o.distance + ' reaches into the flyable tunnel');
 const line = p.clear + (Math.abs(o.x - p.x) - o.radius);   // room on the far side of the hazard
 assert.ok(line >= 60, 'Hollow hazard at ' + o.distance + ' leaves a clear line of at least 60 m (' + line.toFixed(0) + ')');
 assert.ok(o.base < p.y + 30 && o.top > p.y - 30, 'Hollow hazard at ' + o.distance + ' crosses the cruise line');
 if (o.kind === 'geyser') assert.ok(o.period > o.up && o.up > 1, 'geysers rest between eruptions');
}
for (const river of HOLLOW_WIND_RIVERS) {
 for (let i = 0; i < river.points.length; i++) {
  const w = hollowWindPoint(river, i), p = hollowPath(w.d);
  assert.ok(Math.hypot(w.x - p.x, w.y - p.y) + HOLLOW_WIND_RADIUS * .5 <= p.clear + 1e-6, 'wind river ' + river.name + ' point ' + i + ' lies inside the clear radius');
  assert.ok(w.y > p.floor + 12, 'wind river ' + river.name + ' stays off the floor');
  if (i) assert.ok(river.points[i][0] > river.points[i - 1][0], 'wind river points run forward');
 }
}

setSpeedMultiplier(15);
assert.equal(getSpeedMultiplier(), 15, 'the waterfall speed setting reaches 15x');
assert.equal(createRings(15).length, rings.length, '15x keeps the same orbs');

setSpeedMultiplier(7);
const flight = {};
initializeWaterfallFlight(flight);
const oldFlightSpeed = flight.speed;
setSpeedMultiplier(12);
stepWaterfallFlight(flight, 0, 0, 1 / 120);
assert.equal(flight.speedMultiplier, 12, 'the current flight reads a changed speed setting');
assert.ok(flight.speed > oldFlightSpeed, 'the current flight speed changes without restarting');
assert.equal(flight.streak, 0, 'a fresh flight has no streak');

// Orb boost: the burst raises the speed by the streak's gain, then fades back to the chosen speed.
const cruise = WATERFALL_CRUISE_SPEED * 12;
stepWaterfallFlight(flight, 0, 0, 1 / 120);
assert.ok(close(flight.speed, cruise, 1e-9), 'without a boost the flight runs at the chosen speed');
applyOrbBoost(flight, 1);
assert.equal(flight.boost, WATERFALL_BOOST_SECONDS, 'a caught orb starts a full burst');
assert.equal(waterfallBoostStrength(flight), 1, 'a fresh burst is at full strength');
stepWaterfallFlight(flight, 0, 0, 1 / 120);
assert.ok(close(flight.speed, cruise * (1 + boostGainForStreak(1)), 1e-6), 'a first orb adds the base gain');
applyOrbBoost(flight, 5);
stepWaterfallFlight(flight, 0, 0, 1 / 120);
assert.ok(close(flight.speed, cruise * (1 + boostGainForStreak(5)), 1e-6), 'a five-orb streak adds more');
assert.ok(boostGainForStreak(5) > boostGainForStreak(1), 'the gain grows with the streak');
assert.ok(boostGainForStreak(50) <= .5, 'the gain is capped');
for (let i = 0; i < 300; i++) stepWaterfallFlight(flight, 0, 0, 1 / 120);
assert.equal(flight.boost, 0, 'the burst runs out');
assert.ok(close(flight.speed, cruise, 1e-9), 'after the burst the flight is back at the chosen speed');

// The cave limit hook: a limiter supplied by the environment can move the dragon back inside the tunnel.
const caveFlight = initializeWaterfallFlight({});
caveFlight.caveLimit = (previous, next) => ({x: Math.min(next.x, 5), y: next.y, z: next.z, active: next.x > 5});
caveFlight.x = 4.5;
for (let i = 0; i < 200; i++) stepWaterfallFlight(caveFlight, 1, -1, 1 / 120);
assert.ok(caveFlight.x <= 5 + 1e-9, 'the cave limit holds the dragon inside (' + caveFlight.x.toFixed(2) + ')');

// Turning (Ryan, 2026-10-07: turn faster). Full bank for one second turns speed/240 radians at every speed;
// climb and dive keep their old radius (360 m / 1.5).
assert.equal(WATERFALL_TURN_RADIUS, 240, 'left/right turn radius is 240 m');
assert.equal(WATERFALL_PITCH_RADIUS, ARC_RADIUS / 1.5, 'climb/dive radius is unchanged');
for (const speed of [6, 15]) {
 setSpeedMultiplier(speed);
 const turner = initializeWaterfallFlight({});
 for (let i = 0; i < 120; i++) stepWaterfallFlight(turner, -1, 1, 1 / 120);
 const expected = WATERFALL_CRUISE_SPEED * speed / WATERFALL_TURN_RADIUS;
 assert.ok(Math.abs(turner.yaw - expected) < .02, `full bank for 1 s at ${speed}x turns ${expected.toFixed(2)} rad (got ${turner.yaw.toFixed(2)})`);
}

// Bumper: a blocked move slides instead of freezing (Ryan, 2026-10-07: the dragon froze in front of the gold orb).
// A ground step 30 m high starts at z = -5; the dragon flies level at it. It must climb over and keep going.
const step = (x, z) => (z <= -5 ? 30 : 0);
let at = {x: 0, y: 50, z: 0};
for (let i = 0; i < 20; i++) {
 const next = limitWaterfallMovement(at, {x: at.x, y: at.y, z: at.z - 3}, step);
 assert.ok(next.y - step(next.x, next.z) >= WATERFALL_BUMPER_RADIUS - 1e-6, 'the bumper never goes into the ground step');
 at = next;
}
assert.ok(at.z < -40, 'the dragon gets over a ground step taller than one move instead of freezing (z ' + at.z.toFixed(1) + ')');
// A side wall the dragon cannot rise over (the Hollow reports its ceiling there): the forward part of the move continues.
const wall = (x, z) => (x > 10 ? 1e6 : 0);
at = {x: 9, y: 50, z: 0};
for (let i = 0; i < 10; i++) at = limitWaterfallMovement(at, {x: at.x + 2, y: at.y, z: at.z - 2}, wall);
assert.ok(at.z < -15 && at.x <= 10, 'a diagonal move into a side wall keeps its forward part (x ' + at.x.toFixed(1) + ', z ' + at.z.toFixed(1) + ')');

assert.equal(normalizeThumbInput(700, 835, 100, 844), -1, 'bottom edge is maximum down');
assert.equal(normalizeThumbInput(700, 8, 100, 844), 1, 'top edge is maximum up');
assert.ok(Math.abs(normalizeThumbInput(700, 650, 100, 844) - .4897959183673469) < 1e-6, 'normal thumb travel keeps its scaled value');

console.log(`waterfall-course: ${hollowRings.length} Hollow orbs + ${cues.length} orb cues + ${bonuses.length} golden orbs; ${hollowHazards.length} Hollow hazards + ${spires.length} spires + ${totems.length} totems; ${HOLLOW_WIND_RIVERS.length} wind rivers; boost ${boostGainForStreak(1)}..${boostGainForStreak(50)}; speed 15x; cave limit; edge thumb saturation passed`);
