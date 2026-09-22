// Dragonfall render system: the renderer, the post-processing chain and the film grade.
// Owns exposure, pixel ratio and every fullscreen pass. Nothing else calls renderer.render().
//
// Pass order (SHARED CONTRACTS v1, section 6):
//   RenderPass -> GTAOPass(high) -> BokehPass(high) -> sun-shaft ShaderPass(high) -> UnrealBloomPass(both)
//   -> OutputPass(both: ACES + sRGB) -> SMAAPass(high) / FXAA ShaderPass(phone) -> grade ShaderPass(both)
// Everything before OutputPass is linear HDR (the composer's default target is HalfFloatType in r169);
// everything after it is display-referred (0..1 sRGB), which is where anti-aliasing and the grade belong.
import * as THREE from 'three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {GTAOPass} from 'three/addons/postprocessing/GTAOPass.js';
import {BokehPass} from 'three/addons/postprocessing/BokehPass.js';
import {SMAAPass} from 'three/addons/postprocessing/SMAAPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {FXAAShader} from 'three/addons/shaders/FXAAShader.js';
import {TIER, BUDGET} from './quality.js';
import {renderPixelRatio} from './render-quality.js';

// Fixed sun for this build (contract section 3): ahead, slightly left, 23.6 degrees up.
const DEFAULT_SUN = new THREE.Vector3(-0.18, 0.40, -0.90).normalize();
const EXPOSURE = 0.82;

// ---------- Sun shafts: radial blur of the bright sky/sun toward the sun's screen position, added in HDR ----------
// Only pixels brighter than 1.2 linear (sun disc, sky break, waterfall cores) feed the shafts, so walls never streak.
const ShaftShader = {
 uniforms: {
  tDiffuse: {value: null},
  uSun: {value: new THREE.Vector2(0.5, 0.5)},       // sun position in screen UV (0..1)
  uStrength: {value: 0},                             // 0 when the sun is off screen
  uColor: {value: new THREE.Color(0xffc98a)},
 },
 vertexShader: `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
 fragmentShader: `
  uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uStrength; uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
   vec4 base = texture2D(tDiffuse, vUv);
   if (uStrength <= 0.0) { gl_FragColor = base; return; }
   vec2 dir = uSun - vUv;
   const int N = 24;
   float decay = 0.94, w = 1.0;
   vec3 acc = vec3(0.0);
   vec2 p = vUv;
   for (int i = 0; i < N; i++) {
    p += dir * (1.0 / float(N));
    vec3 c = texture2D(tDiffuse, p).rgb;
    float lum = dot(c, vec3(0.3, 0.59, 0.11));
    acc += c * smoothstep(1.2, 4.0, lum) * w;
    w *= decay;
   }
   gl_FragColor = vec4(base.rgb + acc / float(N) * uColor * uStrength, base.a);
  }`,
};

// ---------- Film grade: chromatic aberration, split tone, contrast, vignette, grain, turn motion blur ----------
// Runs after OutputPass, so the input is already tone mapped sRGB in 0..1.
function makeGradeShader(motionTaps) {
 return {
  defines: {MOTION_TAPS: String(motionTaps)},
  uniforms: {
   tDiffuse: {value: null},
   uTime: {value: 0},
   uRes: {value: new THREE.Vector2(1280, 720)},     // drawing-buffer pixels: grain hash must use pixels, not vUv
   uContrast: {value: 1.10},   // 1.16 pivoted at 0.5 mapped sRGB 0.10 to 0.036: every dark foreground tone lost ~40% (2026-09-09 fix)
   uSat: {value: 1.06},
   uCA: {value: 1.4},
   uVignette: {value: 0.5},
   uGrain: {value: 0.045},
   uMotion: {value: 0},                              // 0..1 turn strength from setMotion()
   uMotionDir: {value: new THREE.Vector2(1, 0)},     // screen direction of the smear
  },
  vertexShader: `
   varying vec2 vUv;
   void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
   uniform sampler2D tDiffuse;
   uniform float uTime, uContrast, uSat, uCA, uVignette, uGrain, uMotion;
   uniform vec2 uRes, uMotionDir;
   varying vec2 vUv;
   float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
   // Chromatic aberration: red and blue sampled slightly outward/inward of green; grows with r^2 toward the corners.
   vec3 sampleCA(vec2 uv, vec2 ca) {
    return vec3(texture2D(tDiffuse, uv + ca).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - ca).b);
   }
   void main() {
    vec2 c = vUv - 0.5;
    float r2 = dot(c, c);
    vec2 ca = c * r2 * uCA * 0.0035;
    vec3 col = sampleCA(vUv, ca);
    // Turn motion blur: smear the edges along uMotionDir, keep the centre (neck, hands) crisp.
    if (uMotion > 0.01) {
     vec3 blur = vec3(0.0);
     float wsum = 0.0;
     // Per-pixel jitter hides the banding a handful of taps would otherwise show.
     float jitter = (hash(vUv * uRes + fract(uTime) * 31.0) - 0.5) / float(MOTION_TAPS);
     for (int i = 0; i < MOTION_TAPS; i++) {
      float f = float(i) / float(MOTION_TAPS) - 0.5 + jitter;
      float w = 1.0 - abs(f);
      vec2 o = uMotionDir * uMotion * 0.05 * f;
      blur += sampleCA(vUv + o, ca) * w;
      wsum += w;
     }
     blur /= wsum;
     col = mix(blur, col, smoothstep(0.35, 0.05, length(c)));
    }
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(l), col, uSat);
    col = (col - 0.5) * uContrast + 0.5;
    // Split tone: teal shadows, amber highlights (the reference sheets' grade).
    col += vec3(-0.02, -0.005, 0.03) * (1.0 - l) + vec3(0.03, 0.012, -0.02) * l;
    col *= 1.0 - uVignette * smoothstep(0.12, 0.75, r2);
    float g = hash(vUv * uRes + fract(uTime) * 97.0) - 0.5;
    col += g * uGrain * (1.0 - l * 0.6);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
   }`,
 };
}

// ---------- Transparent-object guard for the override-material passes ----------
// GTAOPass renders the scene with a normal material and BokehPass with a depth material. r169's
// GTAOPass.overrideVisibility only hides Points/Lines, so cloud planes, mist sprites, waterfall sheets and gate
// halos would write depth/normals and give wrong DOF and AO halos. We hide every transparent object instead.
function isTransparentObject(object) {
 if (object.isSprite) return true;
 const m = object.material;
 if (!m) return false;
 if (Array.isArray(m)) return m.some(mat => mat && mat.transparent === true);
 return m.transparent === true;
}
function makeVisibilityGuard(scene) {
 const cache = new Map();
 return {
  hide() {
   cache.clear();
   scene.traverse(object => {
    if (object.visible && isTransparentObject(object)) { cache.set(object, true); object.visible = false; }
   });
  },
  restore() {
   for (const object of cache.keys()) object.visible = true;
   cache.clear();
  },
 };
}

export function createRenderSystem({canvas, scene, camera, overrides = {}}) {
 // Read the tier at call time so a dev page can pick it before creating anything.
 const tier = TIER;
 const budget = BUDGET[tier];
 const isHigh = tier === 'high';

 // R1. Renderer. If WebGL2 is unavailable three throws; let the original error reach game.js (#error).
 const renderer = new THREE.WebGLRenderer({canvas, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false});
 renderer.outputColorSpace = THREE.SRGBColorSpace;
 renderer.toneMapping = THREE.ACESFilmicToneMapping;   // applied only by OutputPass (three disables it inside render targets)
 renderer.toneMappingExposure = EXPOSURE;
 renderer.shadowMap.enabled = true;
 renderer.shadowMap.type = isHigh ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
 // Count the whole frame (scene + every post pass) instead of only the last fullscreen quad.
 renderer.info.autoReset = false;
 const webgl2 = !!renderer.capabilities.isWebGL2;
 if (!webgl2) console.warn('render.js: WebGL2 unavailable, building the minimal chain (RenderPass + OutputPass + grade)');

 // R2. Pixel ratio: min(DPR, 4K-area cap, tier budget, explicit cap). Phone cap 1.5 keeps a 1080x2400 phone under 2 MP per pass.
 let pixelRatioCap = isHigh ? 2 : 1.5;
 let width = Math.max(1, canvas.clientWidth || canvas.width || 1);
 let height = Math.max(1, canvas.clientHeight || canvas.height || 1);
 let pixelRatio = 1;
 function computePixelRatio(w, h) {
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const maxTex = renderer.capabilities.maxTextureSize || 8192;
  return Math.min(dpr, renderPixelRatio(w, h, dpr, maxTex), budget.maxPixelRatio, pixelRatioCap);
 }

 // R3. Composer and passes.
 const composer = new EffectComposer(renderer);
 const guard = makeVisibilityGuard(scene);
 const passes = {};
 const useGtao = webgl2 && isHigh && budget.gtao && overrides.gtao !== false;
 const useDof = webgl2 && isHigh && budget.dof && overrides.dof !== false;
 const useShafts = webgl2 && isHigh && overrides.shafts !== false;
 const useBloom = webgl2 && budget.bloom && overrides.bloom !== false;
 const useAA = webgl2 && overrides.aa !== false;

 passes.render = new RenderPass(scene, camera);
 composer.addPass(passes.render);

 if (useGtao) {
  // Radius is in world metres: 1.5 m darkens saddle straps against the neck and horn bases without smearing the canyon.
  const gtao = new GTAOPass(scene, camera, width, height);
  gtao.updateGtaoMaterial({radius: 1.5, distanceExponent: 1, thickness: 1.2, scale: 1.0, samples: 12, distanceFallOff: 1, screenSpaceRadius: false});
  gtao.updatePdMaterial({lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, rings: 2, samples: 12});
  gtao.blendIntensity = 0.8;
  gtao.output = GTAOPass.OUTPUT.Default;
  // R4. Hide transparent objects during the normal/depth pre-pass.
  gtao.overrideVisibility = () => guard.hide();
  gtao.restoreVisibility = () => guard.restore();
  passes.gtao = gtao;
  composer.addPass(gtao);
 }

 if (useDof) {
  // Focus is the horn/head distance (~12 m): hands at 0.5 m go soft like the references, far walls barely.
  const bokeh = new BokehPass(scene, camera, {focus: 12, aperture: 0.0006, maxblur: 0.006});
  const bokehRender = bokeh.render.bind(bokeh);
  bokeh.render = (...args) => { guard.hide(); try { bokehRender(...args); } finally { guard.restore(); } };
  passes.bokeh = bokeh;
  composer.addPass(bokeh);
 }

 if (useShafts) {
  passes.shafts = new ShaderPass(ShaftShader);
  composer.addPass(passes.shafts);
 }

 if (useBloom) {
  // Threshold 1.0 is in linear HDR units: only the sun disc, the sky break, waterfall cores and the water sun-path pass it.
  const bloomRes = isHigh ? new THREE.Vector2(width, height) : new THREE.Vector2(width / 2, height / 2);
  const bloom = new UnrealBloomPass(bloomRes, isHigh ? 0.30 : 0.26, 0.60, 1.0);
  if (!isHigh) {
   // composer.setSize hands every pass the full drawing-buffer size; on phone keep the bloom mips at quarter res.
   const bloomSetSize = bloom.setSize.bind(bloom);
   bloom.setSize = (w, h) => bloomSetSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
  }
  passes.bloom = bloom;
  composer.addPass(bloom);
 }

 passes.output = new OutputPass();   // ACES tone mapping + sRGB; everything after is display-referred
 composer.addPass(passes.output);

 if (useAA) {
  if (isHigh && budget.smaa) {
   passes.smaa = new SMAAPass(width, height);
   composer.addPass(passes.smaa);
  } else {
   passes.fxaa = new ShaderPass(FXAAShader);
   composer.addPass(passes.fxaa);
  }
 }

 passes.grade = new ShaderPass(makeGradeShader(isHigh ? 6 : 4));
 composer.addPass(passes.grade);
 const gradeU = passes.grade.uniforms;

 // Per-frame state.
 const sunDirection = DEFAULT_SUN.clone();
 const sunNdc = new THREE.Vector3();
 const camPos = new THREE.Vector3();
 let focusTarget = 12;
 let focus = 12;

 function applySize(w, h) {
  width = Math.max(1, w | 0);
  height = Math.max(1, h | 0);
  pixelRatio = computePixelRatio(width, height);
  renderer.setPixelRatio(pixelRatio);
  composer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false);
  composer.setSize(width, height);   // calls pass.setSize(w*pr, h*pr) on every pass (EffectComposer.js:193-210)
  // What composer.setSize misses: the FXAA texel size and the grade's pixel count.
  const pw = width * pixelRatio, ph = height * pixelRatio;
  if (passes.fxaa) passes.fxaa.uniforms.resolution.value.set(1 / pw, 1 / ph);
  gradeU.uRes.value.set(pw, ph);
 }
 applySize(width, height);

 function updateSunScreenPosition() {
  if (!passes.shafts) return;
  camera.getWorldPosition(camPos);
  sunNdc.copy(sunDirection).multiplyScalar(1000).add(camPos).project(camera);
  const onScreen = sunNdc.z < 1 && Math.abs(sunNdc.x) < 1.4 && Math.abs(sunNdc.y) < 1.4;
  const u = passes.shafts.uniforms;
  u.uSun.value.set(sunNdc.x * 0.5 + 0.5, sunNdc.y * 0.5 + 0.5);
  u.uStrength.value = onScreen ? 1.1 * Math.max(0, 1 - Math.max(Math.abs(sunNdc.x), Math.abs(sunNdc.y)) * 0.5) : 0;
 }

 // R5. One frame. Integration calls only this; renderer.render is never called directly.
 function render(dt = 1 / 60) {
  const step = Math.min(Math.max(dt || 0, 0), 0.1);
  renderer.info.reset();
  camera.updateMatrixWorld();
  updateSunScreenPosition();
  if (passes.bokeh) {
   focus += (focusTarget - focus) * (1 - Math.exp(-6 * step));
   passes.bokeh.uniforms.focus.value = focus;
  }
  gradeU.uTime.value += step;
  composer.render(step);
 }

 return {
  renderer,
  composer,
  tier,
  passes,
  render,
  setSize(w, h) { applySize(w, h); },
  setFocusDistance(metres) { if (Number.isFinite(metres)) focusTarget = Math.max(0.1, metres); },
  setSunDirection(v3) { sunDirection.copy(v3).normalize(); },
  setMotion(strength01, dirX = 1, dirY = 0) {
   gradeU.uMotion.value = THREE.MathUtils.clamp(strength01 || 0, 0, 1);
   const len = Math.hypot(dirX, dirY) || 1;
   gradeU.uMotionDir.value.set(dirX / len, dirY / len);
  },
  setPixelRatioCap(n) { if (Number.isFinite(n) && n > 0) { pixelRatioCap = n; applySize(width, height); } },
  getPixelRatio() { return pixelRatio; },
  getPixelRatioCap() { return pixelRatioCap; },
  dispose() {
   for (const pass of composer.passes) if (typeof pass.dispose === 'function') pass.dispose();
   composer.dispose();
   renderer.dispose();
  },
 };
}
