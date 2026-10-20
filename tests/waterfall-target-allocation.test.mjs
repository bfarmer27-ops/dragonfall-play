import assert from 'node:assert/strict';
import {Euler, Quaternion} from '../vendor/three.module.js';
import {createRings, routeAt, ROUTE_LENGTH} from '../waterfall-core.js';
import {selectWaterfallTarget} from '../waterfall-guide.js';

function forwardOf(flight) {
 const q = flight.orientation || {x: 0, y: 0, z: 0, w: 1};
 return {x: -2 * (q.x * q.z + q.w * q.y), y: 2 * (q.w * q.x - q.y * q.z), z: 2 * (q.x * q.x + q.y * q.y) - 1};
}

function cue(normal, forward) {
 if (normal.y < -.94) return 'Straight down';
 if (normal.y < -.15) return forward.y < normal.y - .07 ? 'Ease up' : 'Ease down';
 if (normal.y > .15) return 'Climb gently';
 return 'Level flight';
}

// This is the pre-optimization algorithm kept in the regression test so every
// optimized result is checked against the old ordering and hysteresis rules.
function legacySelect(gates, flight, previousIndex = null) {
 const forward = forwardOf(flight), candidates = [];
 for (let index = 0; index < gates.length; index++) {
  const gate = gates[index], ring = gate.ring;
  if (!ring || gate.caught || gate.passed) continue;
  const center = ring.center || {x: ring.x, y: ring.altitude, z: ring.z}, normal = ring.normal;
  if (!center || !normal) continue;
  const dx = center.x - flight.x, dy = center.y - flight.alt, dz = center.z - flight.z;
  const distance = Math.hypot(dx, dy, dz), ahead = dx * normal.x + dy * normal.y + dz * normal.z;
  if (!Number.isFinite(distance) || ahead < -.05) continue;
  const alignment = normal.x * forward.x + normal.y * forward.y + normal.z * forward.z;
  const score = distance + (alignment < -.25 ? 180 : 0);
  candidates.push({gate, index, center, normal, distance, score, cue: cue(normal, forward)});
 }
 if (!candidates.length) return null;
 candidates.sort((a, b) => a.score - b.score || a.index - b.index);
 const nearest = candidates[0], previous = candidates.find(c => c.index === previousIndex);
 return previous && previous.score < nearest.score + 8 ? previous : nearest;
}

const resultShape = target => target && {
 gate: target.gate,
 index: target.index,
 center: target.center,
 normal: target.normal,
 distance: target.distance,
 score: target.score,
 cue: target.cue,
};

const rings = createRings(12);
const gates = rings.map((ring, index) => ({ring, id: index, caught: false, passed: false}));
const tiedGates = [0, 1].map(index => ({
 ring: {center: {x: 0, y: 0, z: 0}, normal: {x: 0, y: 0, z: -1}},
 id: index, caught: false, passed: false,
}));
const tiedFlight = {x: 0, alt: 0, z: 1, orientation: new Quaternion()};
assert.equal(selectWaterfallTarget(tiedGates, tiedFlight, null).index, 0, 'equal scores keep the lower ring index');
assert.equal(selectWaterfallTarget(tiedGates, tiedFlight, 1).index, 1, 'previous target hysteresis still wins an equal-score tie');
const originalSort = Array.prototype.sort;
let sortCalls = 0;
Array.prototype.sort = function (...args) {
 sortCalls++;
 return originalSort.apply(this, args);
};
try {
 // The old selector sorts a temporary candidate array. This assertion is the
 // red test before the optimization and guards the no-sort allocation contract.
 const probe = selectWaterfallTarget(gates, {x: 0, alt: 0, z: 0, orientation: new Quaternion()}, null);
 assert.ok(probe, 'the real waterfall rings produce a target for the allocation probe');
 assert.equal(sortCalls, 0, 'target selection must not sort a temporary candidate array');
} finally {
 Array.prototype.sort = originalSort;
}

// Differential cases use real route positions, real ring geometry, opposite
// headings, and all caught/passed/previous-index states that the guide sees.
let seed = 0x3f27a1;
const random = () => {
 seed = (seed * 1664525 + 1013904223) >>> 0;
 return seed / 0x100000000;
};
for (let caseIndex = 0; caseIndex < 5000; caseIndex++) {
 const distance = random() * ROUTE_LENGTH;
 const route = routeAt(distance);
 const orientation = new Quaternion().setFromEuler(new Euler(
  (random() * 2 - 1) * Math.PI,
  (random() * 2 - 1) * Math.PI,
  (random() * 2 - 1) * Math.PI,
  'YXZ',
 ));
 const flight = {
  x: route.x + (random() * 2 - 1) * 180,
  alt: route.y + (random() * 2 - 1) * 180,
  z: route.z + (random() * 2 - 1) * 180,
  orientation,
 };
 const state = gates.map(gate => ({...gate, caught: random() < .18, passed: random() < .18}));
 const previousIndex = random() < .2 ? null : (random() < .1 ? -1 : Math.floor(random() * (state.length + 4)) - 2);
 const expected = resultShape(legacySelect(state, flight, previousIndex));
 const actual = resultShape(selectWaterfallTarget(state, flight, previousIndex));
 assert.deepStrictEqual(actual, expected, `target mismatch at differential case ${caseIndex}, previous index ${previousIndex}`);
}

console.log(`waterfall-target-allocation: 5000 legacy differential cases matched; sort probe passed`);
