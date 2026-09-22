// Player-controlled flight for the stationary Waterfall course.
// Route geometry supplies only the starting point; it never supplies movement or attitude.
import {Euler, Quaternion, Vector3} from './vendor/three.module.js';
import {clamp, damp, getSpeedMultiplier, PHYSICS_STEP, wingCommand} from './flight.js';
import {routeAt} from './waterfall-core.js?v=6';

export const WATERFALL_TURN_RADIUS = 96;
export const WATERFALL_RING_RADIUS = 13.5;
const CAMERA_OFFSET = new Vector3(0, 6.4, 40);
const CAMERA_TARGET = new Vector3(0, 1.5, -35);
const LOCAL_UP = new Vector3(0, 1, 0);
const LOCAL_FORWARD = new Vector3(0, 0, -1);

// Call with newFlight() so ordinary scores, health, and other shared counters survive.
// orientation is authoritative. pitch/yaw are compatibility values, not steering state.
export function initializeWaterfallFlight(f) {
  const start = routeAt(0);
  Object.assign(f, {
    x: start.x, alt: start.y, z: start.z, distance: 0,
    orientation: new Quaternion(),
    previousPosition: {x: start.x, y: start.y, z: start.z},
    pitch: 0, yaw: 0, roll: 0, pitchRate: 0, yawRate: 0,
    vx: 0, vy: 0, vz: -f.speed, elapsed: 0,
    diveHold: 0, noseDive: false,
  });
  return f;
}

export function waterfallForward(f) {
  return LOCAL_FORWARD.clone().applyQuaternion(f.orientation);
}

export function stepWaterfallFlight(f, left, right, dt) {
  dt = Number(dt);
  if (!Number.isFinite(dt) || dt <= 0) return f;
  const command = wingCommand(left, right);
  f.previousPosition = {x: f.x, y: f.alt, z: f.z};
  const count = Math.max(1, Math.ceil(dt / PHYSICS_STEP));
  const step = dt / count;
  const axis = new Vector3(), halfTurn = new Quaternion(), fullTurn = new Quaternion();
  const middle = new Quaternion(), forward = new Vector3();
  for (let i = 0; i < count; i++) {
    // Keep the regular speed setting and its gradual speed response. Direction is manual.
    const cruise = clamp(37 + f.elapsed * .055 - command.pitch * 14, 22, 69) * getSpeedMultiplier();
    f.speed = damp(f.speed, cruise, .65, step);
    f.pitchRate = command.pitch * f.speed / WATERFALL_TURN_RADIUS;
    f.yawRate = command.bank * f.speed / WATERFALL_TURN_RADIUS;
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
    // Midpoint direction keeps turns smooth and makes path length independent of heading.
    forward.copy(LOCAL_FORWARD).applyQuaternion(middle);
    f.x += forward.x * f.speed * step;
    f.alt += forward.y * f.speed * step;
    f.z += forward.z * f.speed * step;
    f.distance += f.speed * step;
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
export function crossesWaterfallRing(previous, current, ring) {
  const normal = new Vector3(ring.normal.x, ring.normal.y, ring.normal.z);
  const length = normal.length();
  const radius = ring.radius ?? WATERFALL_RING_RADIUS;
  if (!Number.isFinite(length) || length < 1e-12 || !Number.isFinite(radius) || radius < 0) return false;
  normal.multiplyScalar(1 / length);
  const center = new Vector3(ring.center.x, ring.center.y, ring.center.z);
  const a = new Vector3(previous.x, previous.y, previous.z).sub(center);
  const b = new Vector3(current.x, current.y, current.z).sub(center);
  const before = a.dot(normal), after = b.dot(normal);
  if (!(before < 0 && after >= 0)) return false;
  const intersection = a.lerp(b, -before / (after - before));
  intersection.addScaledVector(normal, -intersection.dot(normal));
  return intersection.lengthSq() <= radius * radius + 1e-10;
}
