// Player-controlled flight for the stationary Waterfall course.
// Route geometry supplies only the starting point; it never supplies movement or attitude.
import {Euler, Quaternion, Vector3} from './vendor/three.module.js';
import {damp, PHYSICS_STEP, wingCommand} from './flight.js';
import {routeAt, ARC_RADIUS, WATERFALL_CRUISE_SPEED, getSpeedMultiplier, WATERFALL_BOOST_SECONDS, boostGainForStreak} from './waterfall-core.js';
import {limitWaterfallMovement} from './waterfall-bumper.js?v=2';

// Orb boost: 0..1 strength of the current speed burst (full for most of the burst, then a smooth fade).
export function waterfallBoostStrength(f) {
  const left = Number(f && f.boost) || 0;
  if (left <= 0) return 0;
  const t = Math.min(1, left / WATERFALL_BOOST_SECONDS);
  return t < .35 ? t / .35 : 1;
}
// Called by the game when an orb is caught: restarts the burst with the streak's gain.
export function applyOrbBoost(f, streak) {
  f.boost = WATERFALL_BOOST_SECONDS;
  f.boostGain = boostGainForStreak(streak);
  return f;
}

// Left/right turn radius in metres at every speed. 240 m (was ARC_RADIUS = 360 m) so the Hollow's cues can be
// flown with part of the stick to spare (Ryan, 2026-10-07: "the dragon needs to turn faster").
export const WATERFALL_TURN_RADIUS = 240;
// Climb/dive radius: unchanged from before (360 m / 1.5).
export const WATERFALL_PITCH_RADIUS = ARC_RADIUS / 1.5;
export const WATERFALL_RING_RADIUS = 13.5;
const CAMERA_OFFSET = new Vector3(0, 6.4, 40);
const CAMERA_TARGET = new Vector3(0, 1.5, -35);
const LOCAL_UP = new Vector3(0, 1, 0);
const LOCAL_FORWARD = new Vector3(0, 0, -1);
const _euler = new Euler();
const clampNumber = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smoothStep = (a, b, x) => { const t = clampNumber((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// Wings-level correction: at most this many radians per second of turn about the dragon's own nose.
export const WATERFALL_ROLL_LEVEL_RATE = 3;
// Reused every physics step (no new objects per frame, so the phone has less memory to clean up mid-flight).
const _axis = new Vector3(), _forward = new Vector3(), _up = new Vector3(), _wantUp = new Vector3(), _cross = new Vector3();
const _halfTurn = new Quaternion(), _fullTurn = new Quaternion(), _middle = new Quaternion(), _rollFix = new Quaternion();

// Call with newFlight() so ordinary scores, health, and other shared counters survive.
// orientation is authoritative. pitch/yaw are compatibility values, not steering state.
export function initializeWaterfallFlight(f) {
  const start = routeAt(0);
  const speedMultiplier=getSpeedMultiplier(),speed=WATERFALL_CRUISE_SPEED*speedMultiplier;
  Object.assign(f, {
    x: start.x, alt: start.y, z: start.z, distance: 0,
    orientation: new Quaternion(),
    previousPosition: {x: start.x, y: start.y, z: start.z},
    pitch: 0, yaw: 0, roll: 0, pitchRate: 0, yawRate: 0,
    speed, speedMultiplier, vx: 0, vy: 0, vz: -speed, elapsed: 0,
    diveHold: 0, noseDive: false,
    bumperActive: false,
    boost: 0, boostGain: 0, streak: 0, bestStreak: 0,
  });
  return f;
}

export function waterfallForward(f, out = new Vector3()) {
  return out.copy(LOCAL_FORWARD).applyQuaternion(f.orientation);
}

export function stepWaterfallFlight(f, left, right, dt) {
  dt = Number(dt);
  if (!Number.isFinite(dt) || dt <= 0) return f;
  const command = wingCommand(left, right);
  f.previousPosition = {x: f.x, y: f.alt, z: f.z};
  f.bumperActive=false;
  const count = Math.max(1, Math.ceil(dt / PHYSICS_STEP));
  const step = dt / count;
  const axis = _axis, halfTurn = _halfTurn, fullTurn = _fullTurn, middle = _middle, forward = _forward;
  for (let i = 0; i < count; i++) {
    // Read the saved setting every physics step so a live slider change affects
    // the current flight instead of waiting for a restart.
    f.speedMultiplier = getSpeedMultiplier();
    // An orb burst adds up to boostGain (25-50%) on top of the chosen speed, then fades out.
    f.boost = Math.max(0, (f.boost || 0) - step);
    f.speed = WATERFALL_CRUISE_SPEED*f.speedMultiplier*(1 + (f.boostGain || 0) * waterfallBoostStrength(f));
    f.pitchRate = command.pitch * f.speed / WATERFALL_PITCH_RADIUS;
    f.yawRate = command.bank * f.speed / WATERFALL_TURN_RADIUS;
    // Thumbs level: the heading eases back toward the course line (-z) over a few seconds, so after the Hollow's
    // bends the islands and the gorge sit straight ahead again instead of looking turned (Ryan, 2026-10-07).
    // The heading comes from the nose direction and fades out when the nose points straight up or down, where a
    // compass heading has no meaning (it made the picture spin in the waterfall, Ryan 2026-10-07).
    forward.copy(LOCAL_FORWARD).applyQuaternion(f.orientation);
    const level = smoothStep(.2, .5, Math.hypot(forward.x, forward.z));
    if (Math.abs(command.bank) < .08 && level > 0) f.yawRate -= clampNumber(Math.atan2(-forward.x, -forward.z), -.6, .6) * .55 * level;
    axis.set(f.pitchRate, f.yawRate, 0);
    const rate = axis.length();
    middle.copy(f.orientation);
    if (rate > 0) {
      axis.multiplyScalar(1 / rate);
      halfTurn.setFromAxisAngle(axis, rate * step / 2);
      fullTurn.setFromAxisAngle(axis, rate * step);
      middle.multiply(halfTurn);
      f.orientation.multiply(fullTurn).normalize();
    }
    // Pitch and turn are applied about the dragon's own axes, which slowly rolls the frame. Turn the dragon about
    // its nose back to wings-level (its up vector in the upright plane through the nose), at most
    // WATERFALL_ROLL_LEVEL_RATE rad/s, so no roll builds up in normal flight (the world never looks tilted).
    // The correction fades to nothing as the nose points straight up or down: "wings level" has no meaning there,
    // and the old rebuild from a compass heading flipped the picture up to 179 degrees in one step in the fall.
    forward.copy(LOCAL_FORWARD).applyQuaternion(f.orientation);
    const horizontal = Math.hypot(forward.x, forward.z), weight = smoothStep(.15, .45, horizontal);
    if (weight > 0) {
      _up.copy(LOCAL_UP).applyQuaternion(f.orientation);
      _wantUp.set(-forward.x * forward.y, 1 - forward.y * forward.y, -forward.z * forward.y).multiplyScalar(1 / horizontal);
      const angle = Math.atan2(_cross.crossVectors(_up, _wantUp).dot(forward), _up.dot(_wantUp));
      const limit = WATERFALL_ROLL_LEVEL_RATE * step * weight;
      const turn = clampNumber(angle, -limit, limit);
      // A turn about the local nose axis (0,0,-1) equals a turn about the world nose direction.
      if (turn !== 0) f.orientation.multiply(_rollFix.setFromAxisAngle(LOCAL_FORWARD, turn)).normalize();
    }
    // Midpoint direction keeps turns smooth and makes path length independent of heading.
    forward.copy(LOCAL_FORWARD).applyQuaternion(middle);
    const previous={x:f.x,y:f.alt,z:f.z};
    const proposed={x:f.x+forward.x*f.speed*step,y:f.alt+forward.y*f.speed*step,z:f.z+forward.z*f.speed*step};
    let next=limitWaterfallMovement(previous,proposed,f.surfaceHeight);
    // Inside the Hollow the environment also keeps the dragon off the tunnel's ceiling and side walls.
    if (typeof f.caveLimit === 'function') { const kept = f.caveLimit(previous, next); if (kept) next = {...next, x: kept.x, y: kept.y, z: kept.z, active: next.active || !!kept.active}; }
    f.x=next.x;f.alt=next.y;f.z=next.z;
    f.bumperActive ||= next.active;
    f.distance += next.active?Math.hypot(f.x-previous.x,f.alt-previous.y,f.z-previous.z):f.speed*step;
    f.elapsed += step;
    f.invulnerable = Math.max(0, (f.invulnerable || 0) - step);
    f.roll = damp(f.roll, command.bank * .97, 16, step);
  }
  f.vx = (f.x - f.previousPosition.x) / dt;
  f.vy = (f.alt - f.previousPosition.y) / dt;
  f.vz = (f.z - f.previousPosition.z) / dt;
  const angles = new Euler().setFromQuaternion(f.orientation, 'YXZ');
  f.pitch = angles.x;
  f.yaw = angles.y;
  return f;
}

// Position, target, and up share the player's orientation. No route angle, camera
// smoothing, banking animation, speed zoom, or independent camera movement is used.
export function waterfallCameraPose(f) {
  const position = new Vector3(f.x, f.alt, f.z);
  return {
    position: CAMERA_OFFSET.clone().applyQuaternion(f.orientation).add(position),
    target: CAMERA_TARGET.clone().applyQuaternion(f.orientation).add(position),
    up: LOCAL_UP.clone().applyQuaternion(f.orientation),
  };
}

// normal points FORWARD through the ring. Test the whole movement segment, so a
// fast step still catches the plane even when both endpoints are far from it.
// A start exactly on the plane cannot score again on the following step.
// Plain numbers only: this runs for every orb on every physics step, so it makes no new objects.
export function crossesWaterfallRing(previous, current, ring) {
  const n = ring.normal, length = Math.hypot(n.x, n.y, n.z);
  const radius = ring.radius ?? WATERFALL_RING_RADIUS;
  if (!Number.isFinite(length) || length < 1e-12 || !Number.isFinite(radius) || radius < 0) return false;
  const nx = n.x / length, ny = n.y / length, nz = n.z / length, c = ring.center;
  const ax = previous.x - c.x, ay = previous.y - c.y, az = previous.z - c.z;
  const bx = current.x - c.x, by = current.y - c.y, bz = current.z - c.z;
  const before = ax * nx + ay * ny + az * nz, after = bx * nx + by * ny + bz * nz;
  if (!(before < 0 && after >= 0)) return false;
  const t = -before / (after - before);
  let ix = ax + (bx - ax) * t, iy = ay + (by - ay) * t, iz = az + (bz - az) * t;
  const along = ix * nx + iy * ny + iz * nz;
  ix -= nx * along; iy -= ny * along; iz -= nz * along;
  return ix * ix + iy * iy + iz * iz <= radius * radius + 1e-10;
}
