const clamp = (value, min = -1, max = 1) => Math.max(min, Math.min(max, value));

/**
 * Create touch and keyboard flight controls.
 * sample(out) writes x = bank and y = pitch, both in [-1, 1].
 * In two-thumb mode, the mean vertical drag controls pitch and the difference
 * between wing drags controls bank. Keyboard and touch contributions combine.
 */
export function createControls({ single, left, right } = {}) {
  const pads = { single, left, right };
  const active = new Map();
  const keys = new Set();
  const knobHomes = new Map();
  let mode = 'one';
  let invert = false;
  let sensitivity = 1;
  let disposed = false;

  for (const pad of Object.values(pads)) {
    if (!pad) continue;
    const knob = pad.querySelector('.pad-knob');
    if (knob) knobHomes.set(pad, knob);
  }

  const axisForKey = () => {
    let x = 0;
    let y = 0;
    if (keys.has('ArrowLeft') || keys.has('KeyA')) x -= 1;
    if (keys.has('ArrowRight') || keys.has('KeyD')) x += 1;
    if (keys.has('ArrowUp') || keys.has('KeyW')) y += 1;
    if (keys.has('ArrowDown') || keys.has('KeyS')) y -= 1;
    const magnitude = Math.hypot(x, y);
    if (magnitude > 1) { x /= magnitude; y /= magnitude; }
    return { x, y };
  };

  const updateKnob = (pad, point) => {
    const knob = knobHomes.get(pad);
    if (!knob) return;
    const radius = Math.min(pad.clientWidth, pad.clientHeight) * 0.34;
    knob.style.transform = `translate(calc(-50% + ${point.x * radius}px), calc(-50% - ${point.y * radius}px))`;
  };

  const normalizedPoint = (pad, origin, event) => {
    const bounds = pad.getBoundingClientRect();
    const radius = Math.max(1, Math.min(bounds.width, bounds.height) * 0.34);
    let x = (event.clientX - origin.x) / radius;
    let y = (origin.y - event.clientY) / radius;
    const magnitude = Math.hypot(x, y);
    if (magnitude > 1) { x /= magnitude; y /= magnitude; }
    return { x, y };
  };

  const resetPad = (pad) => {
    if (!pad) return;
    updateKnob(pad, { x: 0, y: 0 });
  };

  const onPointerDown = (pad, event) => {
    if (disposed || event.button !== 0 || active.has(event.pointerId)) return;
    event.preventDefault();
    try { pad.setPointerCapture(event.pointerId); } catch {}
    const origin = { x: event.clientX, y: event.clientY };
    const point = { x: 0, y: 0 };
    active.set(event.pointerId, { pad, origin, point });
    updateKnob(pad, point);
  };

  const onPointerMove = (event) => {
    const record = active.get(event.pointerId);
    if (!record) return;
    event.preventDefault();
    record.point = normalizedPoint(record.pad, record.origin, event);
    updateKnob(record.pad, record.point);
  };

  const onPointerEnd = (event) => {
    const record = active.get(event.pointerId);
    if (!record) return;
    active.delete(event.pointerId);
    resetPad(record.pad);
  };

  const pointerBindings = [];
  for (const [name, pad] of Object.entries(pads)) {
    if (!pad) continue;
    const down = (event) => onPointerDown(pad, event);
    pad.addEventListener('pointerdown', down, { passive: false });
    pointerBindings.push([pad, 'pointerdown', down]);
  }
  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', onPointerEnd);
  window.addEventListener('pointercancel', onPointerEnd);
  for (const pad of Object.values(pads)) {
    if (!pad) continue;
    const lost = (event) => onPointerEnd(event);
    pad.addEventListener('lostpointercapture', lost);
    pointerBindings.push([pad, 'lostpointercapture', lost]);
  }

  const keyCode = (event) => {
    const code = event.code;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(code)) return code;
    return null;
  };
  const onKeyDown = (event) => {
    const code = keyCode(event);
    if (!code || event.repeat) return;
    keys.add(code);
    if (document.activeElement === document.body) event.preventDefault();
  };
  const onKeyUp = (event) => {
    const code = keyCode(event);
    if (code) keys.delete(code);
  };
  const onBlur = () => { keys.clear(); active.clear(); for (const pad of Object.values(pads)) resetPad(pad); };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onBlur);

  const sample = (out = {}) => {
    const keyboard = axisForKey();
    let touchX = 0;
    let touchY = 0;
    if (mode === 'one') {
      const point = [...active.values()].find((entry) => entry.pad === pads.single)?.point;
      if (point) { touchX = point.x; touchY = point.y; }
    } else {
      const leftPoint = [...active.values()].find((entry) => entry.pad === pads.left)?.point;
      const rightPoint = [...active.values()].find((entry) => entry.pad === pads.right)?.point;
      const leftY = leftPoint?.y ?? 0;
      const rightY = rightPoint?.y ?? 0;
      touchY = (leftY + rightY) * 0.5;
      touchX = (leftY - rightY) * 0.5;
    }
    out.x = clamp((keyboard.x + touchX) * sensitivity);
    const pitch = keyboard.y + touchY;
    out.y = clamp((invert ? -pitch : pitch) * sensitivity);
    return out;
  };

  const configure = (options = {}) => {
    if ((options.mode === 'one' || options.mode === 'two') && mode !== options.mode) {
      active.clear();
      for (const pad of Object.values(pads)) resetPad(pad);
      mode = options.mode;
    }
    if (typeof options.invert === 'boolean') invert = options.invert;
    if (Number.isFinite(options.sensitivity)) sensitivity = clamp(options.sensitivity, 0.5, 2);
  };

  const reset = () => {
    keys.clear();
    active.clear();
    for (const pad of Object.values(pads)) resetPad(pad);
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    reset();
    for (const [element, type, listener] of pointerBindings) element.removeEventListener(type, listener);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerEnd);
    window.removeEventListener('pointercancel', onPointerEnd);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', onBlur);
  };

  return { sample, configure, reset, dispose };
}
