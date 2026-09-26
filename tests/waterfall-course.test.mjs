import assert from 'node:assert/strict';
import {
  ARC_RADIUS,
  FALL_START,
  FALL_END,
  VERTICAL_START,
  WATERFALL_APPROACH_RING_DISTANCE,
  WATERFALL_DESCENT_CLEARANCE,
  WATERFALL_TURN_RING_DISTANCE,
  createRings,
  routeAt,
  setSpeedMultiplier,
  getSpeedMultiplier,
} from '../waterfall-core.js';
import {normalizeThumbInput} from '../control-settings.js';

const close = (a, b, epsilon = 1e-6) => Math.abs(a - b) <= epsilon;

setSpeedMultiplier(7);
const rings = createRings(7);
const approach = rings.find(r => close(r.distance, WATERFALL_APPROACH_RING_DISTANCE));
const turn = rings.find(r => close(r.distance, WATERFALL_TURN_RING_DISTANCE));
assert.ok(approach, 'the approach cue exists before the waterfall');
assert.ok(approach.distance < FALL_START && approach.normal.z === -1, 'the approach cue is level');
assert.ok(turn, 'the 45-degree turn cue exists');
assert.ok(close(turn.normal.y, -Math.SQRT1_2), 'the turn cue points down at 45 degrees');
assert.ok(close(turn.normal.z, -Math.SQRT1_2), 'the turn cue still points forward at 45 degrees');

const descent = rings.filter(r => r.distance >= VERTICAL_START && r.distance < FALL_END);
assert.ok(descent.length >= 1, 'the waterfall has descent cues');
const safeDescentZ = routeAt(FALL_START).z - (ARC_RADIUS - 60) - WATERFALL_DESCENT_CLEARANCE;
assert.ok(descent.every(r => r.z <= safeDescentZ + 1e-6), 'descent cues stay in the far plane');
for (let i = 1; i < descent.length; i++) {
  assert.ok(descent[i].z <= descent[i - 1].z + 1e-6, 'descent cues never move closer to the waterfall');
}

setSpeedMultiplier(15);
assert.equal(getSpeedMultiplier(), 15, 'the waterfall speed setting reaches 15x');
assert.ok(createRings(15).length >= 3, '15x still keeps the approach, turn, and course cues');

assert.equal(normalizeThumbInput(700, 835, 100, 844), -1, 'bottom edge is maximum down');
assert.equal(normalizeThumbInput(700, 8, 100, 844), 1, 'top edge is maximum up');
assert.ok(Math.abs(normalizeThumbInput(700, 650, 100, 844) - .4897959183673469) < 1e-6, 'normal thumb travel keeps its scaled value');

console.log(`waterfall-course: ${rings.length} rings at 7x; ${descent.length} descent cues; speed 15x; edge thumb saturation passed`);
