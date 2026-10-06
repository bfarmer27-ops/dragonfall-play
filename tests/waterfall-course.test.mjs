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
  WATERFALL_BONUS_ORBS,
  WATERFALL_BONUS_VALUE,
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
import {initializeWaterfallFlight, stepWaterfallFlight, applyOrbBoost, waterfallBoostStrength} from '../waterfall-flight.js';

const close = (a, b, epsilon = 1e-6) => Math.abs(a - b) <= epsilon;

setSpeedMultiplier(7);
const rings = createRings(7);
const cues = rings.filter(r => !r.bonus), bonuses = rings.filter(r => r.bonus);
const approach = rings.find(r => close(r.distance, WATERFALL_APPROACH_RING_DISTANCE));
const turn = rings.find(r => close(r.distance, WATERFALL_TURN_RING_DISTANCE));
const exit = rings.find(r => close(r.distance, WATERFALL_EXIT_RING_DISTANCE));
const descentFirst = rings.find(r => close(r.distance, WATERFALL_DESCENT_RING_DISTANCE));
const descentFollow = rings.find(r => close(r.distance, WATERFALL_DESCENT_FOLLOW_RING_DISTANCE));
assert.equal(DEFAULT_SPEED_MULTIPLIER, 12, 'the default waterfall speed is 12x');
assert.equal(cues.length, 8, 'the waterfall keeps its eight planned orb cues');
assert.equal(bonuses.length, WATERFALL_BONUS_ORBS.length, 'every golden bonus orb is placed');
assert.equal(rings.length, 10, 'eight cues plus two golden orbs');
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

// Designed hazards: four spires in the gorge slalom before the fall, three totems in the lower river after it.
const obstacles = createWaterfallObstacles();
const spires = obstacles.filter(o => o.kind === 'spire'), totems = obstacles.filter(o => o.kind === 'totem');
assert.equal(spires.length, WATERFALL_SPIRE_DISTANCES.length, 'every spire is placed');
assert.equal(totems.length, WATERFALL_TOTEM_DISTANCES.length, 'every totem is placed');
assert.ok(spires.every(o => o.distance > 600 && o.distance < FALL_START - 300), 'spires stand in the gorge before the approach cue');
assert.ok(totems.every(o => o.distance > FALL_END + 200), 'totems stand in the river after the fall');
assert.ok(obstacles.every(o => Math.abs(o.side) === 1 && o.x * o.side > 0 && o.radius >= 14), 'hazards come from both sides with a real footprint');
assert.ok(obstacles.every(o => close(o.base, routeAt(o.distance).y - WATERFALL_RIVER_CLEARANCE)), 'hazards start at the river');
assert.ok(obstacles.every(o => o.top > routeAt(o.distance).y && o.top > o.base), 'hazards rise into the flight corridor');
for (let i = 1; i < spires.length; i++) assert.notEqual(spires[i].side, spires[i - 1].side, 'spires alternate sides for a slalom');
assert.ok(obstacles.every(o => Math.abs(o.x) + o.radius < 64), 'every hazard leaves a clear line past it inside the river');

setSpeedMultiplier(15);
assert.equal(getSpeedMultiplier(), 15, 'the waterfall speed setting reaches 15x');
assert.equal(createRings(15).length, 10, '15x keeps the same ten orbs');

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

assert.equal(normalizeThumbInput(700, 835, 100, 844), -1, 'bottom edge is maximum down');
assert.equal(normalizeThumbInput(700, 8, 100, 844), 1, 'top edge is maximum up');
assert.ok(Math.abs(normalizeThumbInput(700, 650, 100, 844) - .4897959183673469) < 1e-6, 'normal thumb travel keeps its scaled value');

console.log(`waterfall-course: ${cues.length} orb cues + ${bonuses.length} golden orbs; ${spires.length} spires + ${totems.length} totems; boost ${boostGainForStreak(1)}..${boostGainForStreak(50)}; speed 15x; edge thumb saturation passed`);
