// Slow Map flight state. It keeps the close camera and one-thumb drag control,
// but adds a faster default, large crystal hazards, rings, and a full upside-down loop.
export const ROUTE_LENGTH = 2400;
export const FLIGHT_SPEED = 34;
export const DEFAULT_SPEED_MULTIPLIER = 3;
export const SPEED_MULTIPLIER_MIN = 1;
export const SPEED_MULTIPLIER_MAX = 10;
export const FLIGHT_LIMITS = Object.freeze({side: 19, minAltitude: 20, maxAltitude: 70});
export const LOOP_START = 820;
export const LOOP_LENGTH = 520;
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
export const centreAt = d => 18 * Math.sin(d * .0027) + 10 * Math.sin(d * .0061);
export function readSpeedMultiplier() {
  try {
    const value = Number(globalThis.localStorage?.getItem('dragonfall-slow-speed'));
    return value >= SPEED_MULTIPLIER_MIN && value <= SPEED_MULTIPLIER_MAX ? value : DEFAULT_SPEED_MULTIPLIER;
  } catch { return DEFAULT_SPEED_MULTIPLIER; }
}
let speedMultiplier = readSpeedMultiplier();
export function getSpeedMultiplier() { return speedMultiplier; }
export function setSpeedMultiplier(value) {
  speedMultiplier = clamp(Number(value) || DEFAULT_SPEED_MULTIPLIER, SPEED_MULTIPLIER_MIN, SPEED_MULTIPLIER_MAX);
  try { globalThis.localStorage?.setItem('dragonfall-slow-speed', String(speedMultiplier)); } catch {}
  return speedMultiplier;
}
export function loopPose() { return {active: false, vertical: 0, roll: 0, pitch: 0}; }
export function createRings() {
  return Array.from({length: 18}, (_, index) => {
    const distance = 150 + index * 125;
    const loop = loopPose(distance);
    return {
      index,
      distance,
      x: centreAt(distance) + (loop.active ? Math.sin((distance - LOOP_START) / LOOP_LENGTH * Math.PI * 2) * 10 : Math.sin(index * 1.8) * 18),
      altitude: 42 + (loop.active ? loop.vertical : Math.sin(index * .9) * 13),
      pitch: loop.pitch,
      roll: loop.roll,
      caught: false,
    };
  });
}
export function createHazards() {
  return Array.from({length: 12}, (_, index) => {
    const distance = 690 + index * 112;
    const side = index % 2 ? -1 : 1;
    return {index, distance, x: centreAt(distance) + side * (12 + (index % 3) * 3), altitude: 39 + (index % 3) * 8, radius: 7 + (index % 2) * 2, height: 24 + (index % 4) * 5};
  });
}
export function createState() {
  return {distance: 0, x: 0, altitude: 42, userAltitude: 0, roll: 0, pitch: 0, elapsed: 0, speed: FLIGHT_SPEED * speedMultiplier, speedMultiplier, mode: 'ready', rings: 0, hits: 0};
}
export function stepFlight(state, input, dt) {
  if (state.mode !== 'flying') return state;
  dt = clamp(Number(dt) || 0, 0, .05);
  const horizontal = clamp(Number(input.x) || 0, -1, 1);
  const vertical = clamp(Number(input.y) || 0, -1, 1);
  state.speedMultiplier = speedMultiplier;
  state.speed = FLIGHT_SPEED * speedMultiplier;
  state.distance = Math.min(ROUTE_LENGTH, state.distance + state.speed * dt);
  state.x = clamp(state.x + horizontal * 27 * dt, -FLIGHT_LIMITS.side, FLIGHT_LIMITS.side);
  state.userAltitude = clamp(state.userAltitude + vertical * 20 * dt, -30, 30);
  const loop = loopPose(state.distance);
  state.altitude = clamp(42 + state.userAltitude + loop.vertical, FLIGHT_LIMITS.minAltitude, FLIGHT_LIMITS.maxAltitude);
  const blend = 1 - Math.exp(-5 * dt);
  state.roll += (-horizontal * .35 - state.roll) * blend;
  state.pitch += (vertical * .16 - state.pitch) * blend;
  state.elapsed += dt;
  if (state.distance >= ROUTE_LENGTH) state.mode = 'complete';
  return state;
}
export function cameraPose(state, aspect = 1) {
  const back = aspect < .8 ? 34 : 30;
  const x = centreAt(state.distance) + state.x;
  return {position: {x: x - state.roll * 4, y: state.altitude + 10, z: -state.distance + back}, target: {x: x + state.roll * 1.5, y: state.altitude + 5, z: -state.distance - 32}, back};
}
export function regionAt(distance) {
  return distance < 650 ? 'THE STONE PASS' : distance < 1500 ? 'THE CRYSTAL HOLLOW' : distance < 2050 ? 'THE CRYSTAL CAVERNS' : 'OPEN WATER';
}
