import assert from 'node:assert/strict';
import {
  ARC_RADIUS,
  FALL_START,
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
  createRings,
  createWaterfallObstacles,
  routeAt,
  setSpeedMultiplier,
  getSpeedMultiplier,
} from '../waterfall-core.js';
import {normalizeThumbInput} from '../control-settings.js';
import {initializeWaterfallFlight, stepWaterfallFlight} from '../waterfall-flight.js';

const close = (a, b, epsilon = 1e-6) => Math.abs(a - b) <= epsilon;

setSpeedMultiplier(7);
const rings = createRings(7);
const approach = rings.find(r => close(r.distance, WATERFALL_APPROACH_RING_DISTANCE));
const turn = rings.find(r => close(r.distance, WATERFALL_TURN_RING_DISTANCE));
const exit = rings.find(r => close(r.distance, WATERFALL_EXIT_RING_DISTANCE));
const descentFirst = rings.find(r => close(r.distance, WATERFALL_DESCENT_RING_DISTANCE));
const descentFollow = rings.find(r => close(r.distance, WATERFALL_DESCENT_FOLLOW_RING_DISTANCE));
assert.equal(DEFAULT_SPEED_MULTIPLIER, 12, 'the default waterfall speed is 12x');
assert.equal(rings.length, 8, 'the waterfall uses only the eight planned cues');
for (const distance of WATERFALL_OPENING_RING_DISTANCES) {
 assert.ok(rings.some(r => close(r.distance, distance)), 'each opening ring exists before the approach cues');
}
assert.ok(new Set(rings.map(r => r.x)).size > 1, 'rings require left and right flight, not one straight line');
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
assert.ok(descent.length >= 1, 'the waterfall has descent cues');
const safeDescentZ = routeAt(FALL_START).z - (ARC_RADIUS - 60) - WATERFALL_DESCENT_CLEARANCE;
assert.ok(descent.every(r => r.z <= safeDescentZ + 1e-6), 'descent cues stay in the far plane');
assert.equal(descentFirst.z, descentFollow.z, 'descent cues stay in one plane');
for (let i = 1; i < descent.length; i++) {
  assert.ok(descent[i].z <= descent[i - 1].z + 1e-6, 'descent cues never move closer to the waterfall');
}

const obstacles = createWaterfallObstacles();
assert.ok(obstacles.length >= 8, 'the course has side obstacles');
assert.ok(obstacles.every(o => Math.abs(o.side) === 1 && o.x * o.side > 0 && o.radius >= 26), 'obstacles come from both cliff sides');
assert.ok(obstacles.every(o => close(o.base, routeAt(o.distance).y - WATERFALL_RIVER_CLEARANCE)), 'obstacles start at the river');
assert.ok(obstacles.every(o => o.top > routeAt(o.distance).y && o.top > o.base), 'obstacles rise into the flight corridor');

setSpeedMultiplier(15);
assert.equal(getSpeedMultiplier(), 15, 'the waterfall speed setting reaches 15x');
assert.equal(createRings(15).length, 8, '15x keeps the same eight deliberate cues');

setSpeedMultiplier(7);
const flight = {};
initializeWaterfallFlight(flight);
const oldFlightSpeed = flight.speed;
setSpeedMultiplier(12);
stepWaterfallFlight(flight, 0, 0, 1 / 120);
assert.equal(flight.speedMultiplier, 12, 'the current flight reads a changed speed setting');
assert.ok(flight.speed > oldFlightSpeed, 'the current flight speed changes without restarting');

assert.equal(normalizeThumbInput(700, 835, 100, 844), -1, 'bottom edge is maximum down');
assert.equal(normalizeThumbInput(700, 8, 100, 844), 1, 'top edge is maximum up');
assert.ok(Math.abs(normalizeThumbInput(700, 650, 100, 844) - .4897959183673469) < 1e-6, 'normal thumb travel keeps its scaled value');

console.log(`waterfall-course: ${rings.length} planned rings at 7x; ${descent.length} straight-drop cues; bottom 45-degree transition; speed 15x; edge thumb saturation passed`);
