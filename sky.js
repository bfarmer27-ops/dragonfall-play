// Sky module: the one sun, the HDRI light, the global height fog, the visible sky dome and the cloud ceiling.
// Import this file FIRST (before any material compiles): at import time it replaces three's built-in fog
// shader chunks with an analytic height fog + sun in-scatter, so every fog:true material gets the film fog
// with zero uniform plumbing. See SHARED CONTRACTS v1 sections 3, 4 and 5 (sky.js API).
import * as THREE from 'three';
import {RGBELoader} from 'three/addons/loaders/RGBELoader.js';
import {Lensflare, LensflareElement} from 'three/addons/objects/Lensflare.js';
import {TIER, BUDGET} from './quality.js';

// ---------------------------------------------------------------------------------------------
// Sun. Unit vector FROM the scene TOWARD the sun (ahead, slightly left, 12.9 degrees up). Fixed for
// this build so the fog GLSL can bake it as a literal. Lowered from 23.6 degrees on 2026-09-09: the rider
// eye tilts down ~11.5 degrees and the 16:9 frame's top edge sits at about +19.5 degrees, so at 23.6 the disc,
// its bloom halo and the sun-shaft pass could never appear in level flight. 12.9 degrees is still above the
// HDRI's brown hills (9 degrees) and inside every frame shape (portrait top edge ~ +25 degrees).
// ---------------------------------------------------------------------------------------------
export const SUN_DIRECTION = Object.freeze(new THREE.Vector3(-0.18, 0.21, -0.90).normalize());
export const SUN_COLOR_HEX = 0xffd7a8;
export const WORLD_SLOPE = 0.04;

// Live fog values. Built-in materials read them through scene.fog (createSky copies them every frame);
// custom shaders may reference these uniform objects directly.
export const fogUniforms = {
 fogColor: {value: new THREE.Color(0x56697a)},   // colour of shadowed air: cool blue-grey
 fogDensity: {value: 0.0030},                      // per-metre extinction at the water surface (contract value)
};

// Tunable constants that get baked into the GLSL as literals (dev-page tuning only via setFogConstants).
const fogConstants = {
 falloff: 0.05,                         // fog thins by 1/e every 20 m up the walls: thick at the water, clear rims
 start: 12.0,                           // metres of clear air in front of the rider (hands, neck never fog)
 height: 0.0,                           // altitude (above water) of the densest fog
 sunColor: new THREE.Color(0.95, 0.66, 0.38), // colour of air lit straight through by the low sun (amber)
};

const f = n => (Math.round(n * 1e6) / 1e6).toFixed(6);

// Builds the GLSL block shared by the ShaderChunk override, the sky dome, the clouds and any custom
// shader that imports fogGLSL. Callers must declare 'uniform vec3 fogColor;' themselves.
function buildFogGLSL() {
 const s = SUN_DIRECTION, c = fogConstants.sunColor;
 return `
 #ifndef DRAGONFALL_FOG_GLSL
 #define DRAGONFALL_FOG_GLSL
 #define FOG_SUN_DIR vec3(${f(s.x)}, ${f(s.y)}, ${f(s.z)})
 #define FOG_SUN_COLOR vec3(${f(c.r)}, ${f(c.g)}, ${f(c.b)})
 #define FOG_HEIGHT ${f(fogConstants.height)}
 #define FOG_FALLOFF ${f(fogConstants.falloff)}
 #define FOG_START ${f(fogConstants.start)}
 #define WORLD_SLOPE ${f(WORLD_SLOPE)}
 // Height above the water of any world point: the world slopes down by 0.04 per metre flown (z = -d).
 float fogAlt(vec3 p) { return p.y - p.z * WORLD_SLOPE - FOG_HEIGHT; }
 // Analytic exponential height fog: integrate exp(-falloff*alt) along the camera->point ray.
 float heightFogAmount(vec3 camPos, vec3 worldPos, float density) {
  vec3 ray = worldPos - camPos;
  float dist = length(ray);
  float dy = fogAlt(worldPos) - fogAlt(camPos);
  float t = exp(-FOG_FALLOFF * fogAlt(camPos));
  float integral = abs(dy) > 0.01 ? t * (1.0 - exp(-FOG_FALLOFF * dy)) / (FOG_FALLOFF * dy) : t;
  float d = max(dist - FOG_START, 0.0);
  return 1.0 - exp(-density * integral * d);
 }
 // Colour of the fog along a ray: blue-grey away from the sun, amber when looking into it.
 // Two lobes: a wide warm wash (whole far end of the canyon) and a tight hot core around the sun.
 vec3 fogInscatter(vec3 camPos, vec3 worldPos) {
  vec3 v = normalize(worldPos - camPos);
  float c = max(dot(v, FOG_SUN_DIR), 0.0);
  float s = 0.55 * pow(c, 5.0) + 0.45 * pow(c, 20.0);
  return mix(fogColor, FOG_SUN_COLOR, s * 0.9);
 }
 #endif
`;
}

export let fogGLSL = buildFogGLSL();

// Replaces three's fog chunks. Every built-in material with fog:true (the default) compiles these, and
// every custom ShaderMaterial that includes the fog chunks gets the same fog. mvPosition is defined by
// every built-in vertex shader (and must be by custom ones) before '#include <fog_vertex>'.
function installFogChunks() {
 THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\n varying vec3 vFogWorldPos;\n#endif';
 THREE.ShaderChunk.fog_vertex = '#ifdef USE_FOG\n vFogWorldPos = cameraPosition + transpose(mat3(viewMatrix)) * mvPosition.xyz;\n#endif';
 THREE.ShaderChunk.fog_pars_fragment = '#ifdef USE_FOG\n uniform vec3 fogColor; uniform float fogDensity; varying vec3 vFogWorldPos;\n' + fogGLSL + '\n#endif';
 THREE.ShaderChunk.fog_fragment = '#ifdef USE_FOG\n { float f = heightFogAmount(cameraPosition, vFogWorldPos, fogDensity); gl_FragColor.rgb = mix(gl_FragColor.rgb, fogInscatter(cameraPosition, vFogWorldPos), clamp(f, 0.0, 1.0)); }\n#endif';
}
installFogChunks();

// Dev-page tuning only. Materials compiled earlier keep the old constants until material.needsUpdate = true.
export function setFogConstants({falloff, start, height, sunColor} = {}) {
 if (falloff !== undefined) fogConstants.falloff = falloff;
 if (start !== undefined) fogConstants.start = start;
 if (height !== undefined) fogConstants.height = height;
 if (sunColor !== undefined) fogConstants.sunColor.set(sunColor);
 fogGLSL = buildFogGLSL();
 installFogChunks();
 return fogGLSL;
}

// ---------------------------------------------------------------------------------------------
// Shaders for the sky dome and the cloud ceiling.
// ---------------------------------------------------------------------------------------------
const skyVertex = /* glsl */`
 varying vec3 vDir;
 void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
 }`;

// Shared value-noise FBM used by the dome cloud wall and the cloud ceiling.
const noiseGLSL = /* glsl */`
 float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
 float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y);
 }
 float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < OCT; i++) { s += a * vn(p); p = p * 2.03 + vec2(17.0, 9.0); a *= 0.5; }
  return s;
 }
 // Three octaves only: the big lobes of a cumulus tower, used for shape and for lighting.
 float fbm3(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 3; i++) { s += a * vn(p); p = p * 2.03 + vec2(17.0, 9.0); a *= 0.5; }
  return s;
 }`;

function skyFragment(octaves) {
 return /* glsl */`
 #define OCT ${octaves}
 varying vec3 vDir;
 uniform sampler2D uSky;
 uniform float uRot;
 uniform float uHasSky;
 uniform float uTime;
 uniform vec3 fogColor;
 uniform vec3 uSunDir;
 uniform vec3 uSunColor;
 #include <common>
 ${fogGLSL}
 ${noiseGLSL}
 void main() {
  vec3 d = normalize(vDir);
  // Same rotation the PMREM environment uses (scene.environmentRotation yaw), so the HDRI sun, the
  // reflections on the water and the DirectionalLight all sit in the same place.
  float c = cos(uRot), s = sin(uRot);
  vec3 r = vec3(c * d.x + s * d.z, d.y, -s * d.x + c * d.z);
  vec2 uv = vec2(atan(r.z, r.x) * RECIPROCAL_PI2 + 0.5, asin(clamp(r.y, -1.0, 1.0)) * RECIPROCAL_PI + 0.5);
  vec3 sky = texture2D(uSky, uv).rgb;
  // Compress the HDRI so its bright band around the sun (several times 1.0 in linear) can never bloom:
  // x/(1+x) keeps every value under 1.0 while leaving the dark parts almost unchanged.
  sky = sky / (1.0 + sky);
  // Darken and desaturate the HDRI: it is the light source; the storm clouds are the picture.
  float lum = dot(sky, vec3(0.3, 0.59, 0.11));
  sky = mix(sky, lum * vec3(0.68, 0.72, 0.84), 0.65) * 0.40;
  // Before the HDR arrives, a flat blue-grey sky so the first frames are not black.
  sky = mix(vec3(0.10, 0.12, 0.17), sky, uHasSky);
  // Storm haze: the open sky is darker than sunlit rock in every reference (deep blue-grey, not lavender).
  sky = mix(sky, vec3(0.08, 0.10, 0.16), 0.6 * smoothstep(0.05, 0.35, d.y));
  // Sun glow, two lobes: a wide warm wash so the whole canyon end lights up (v066 "one light shaft"),
  // and a tighter hot core that bloom picks up. sc = cosine of the angle between this ray and the sun.
  float sc = dot(d, uSunDir);
  float scp = max(sc, 0.0);
  float glowWide = pow(scp, 4.0);
  float glowCore = pow(scp, 16.0);
  float aboveHorizon = smoothstep(-0.05, 0.10, d.y);
  // The HDRI has brown hills up to 9 degrees above its horizon (measured on the 2k file), so below ~12
  // degrees the visible sky is synthesized: fog haze plus the golden glow toward the sun.
  vec3 haze = fogInscatter(vec3(0.0), d * 100.0);
  vec3 col = mix(haze, sky, smoothstep(0.14, 0.24, d.y));
  col += uSunColor * (0.16 * glowWide + 0.35 * glowCore) * aboveHorizon;
  // Storm cloud wall on the dome: towering grey-purple cumulus at 3-45 degrees, lit from the sun side.
  // Noise lives in (azimuth, elevation) space with azimuth scaled 2x elevation, so every lobe is taller
  // than it is wide: 2-3 towers across a 56-degree frame, like the v066 cumulonimbus wall.
  float az = atan(d.x, -d.z);                               // 0 straight ahead, positive to the right
  float el = asin(clamp(d.y, -1.0, 1.0));
  vec2 p = vec2(az * 3.0, el * 1.6) + vec2(uTime * 0.004, 0.0);
  #if OCT > 4
  // Domain warp: bends the noise into rounded, billowing cumulus lobes instead of a flat mottle.
  p += 0.35 * vec2(fbm3(p * 1.3 + vec2(3.1, 5.7)), fbm3(p * 1.3 + vec2(9.2, 1.3))) - 0.175;
  #endif
  // The sun sits 12.9 degrees up and 11 degrees left of straight ahead: up and slightly left in
  // (az, el) space. Sampling the same noise a small step toward the sun gives a self-shadowing term.
  vec2 sunStep = vec2(-0.035, 0.07);
  float shape = fbm3(p);                                   // big lobes
  float shapeSun = fbm3(p + sunStep);
  float detail = fbm(p * 3.0 + vec2(11.0, 4.0));            // billows and crenellated edges
  float detailSun = fbm(p * 3.0 + vec2(11.0, 4.0) + sunStep * 3.0);
  float n = shape * 0.65 + detail * 0.35;
  float nSun = shapeSun * 0.65 + detailSun * 0.35;
  // Cover 0.55 overhead rising to 0.75 near the horizon: towers with real edges and blue-grey gaps
  // overhead (v080), a near-solid wall low down (v066). The ramp is narrow (0.14) on purpose: the
  // noise only spreads about +/-0.1, so a wide ramp gave one smooth gradient instead of edges.
  float cover = 0.55 + 0.20 * (1.0 - smoothstep(0.02, 0.60, d.y));
  float dens = smoothstep(1.0 - cover, 1.0 - cover + 0.14, n);
  dens *= smoothstep(-0.02, 0.02, d.y);                               // no cloud under the horizon (band starts at 0 deg so towers show above the rim)
  // Lighting from the full noise (lobes + billows): every bump has a sunlit face and a shadowed face.
  float lit = clamp((n - nSun) * 14.0 + 0.30, 0.0, 1.0);
  lit *= lit;
  float sunSide = pow(scp, 6.0);
  // Bases: deep purple-grey (v066); lit faces: amber, much hotter on the sun side.
  vec3 cloudDark = mix(vec3(0.11, 0.10, 0.16), vec3(0.030, 0.026, 0.050), smoothstep(0.2, 0.9, dens));
  // Lit faces stay under ~1.5x sun colour: any brighter and bloom turns the whole sun side into a
  // featureless white wash (seen in sky-4-up); the cloud shapes must survive next to the sun.
  vec3 cloudLit = uSunColor * (0.60 + 0.90 * sunSide);
  vec3 cloud = mix(cloudDark, cloudLit, lit * (1.0 - dens * 0.5));
  // Silver lining: the thin edge of every tower catches the sun, strongest on the sun side.
  float edge = smoothstep(0.0, 0.3, dens) * (1.0 - smoothstep(0.3, 0.8, dens));
  cloud += uSunColor * edge * (0.20 + 0.9 * sunSide);
  // Underlighting: the low sun lights the cloud bases amber near the horizon on the sun side.
  cloud += uSunColor * 0.30 * glowWide * (1.0 - smoothstep(0.04, 0.30, d.y)) * (1.0 - dens * 0.4);
  // The lowest cloud is hazed by the far air (light touch so the towers keep their contrast).
  cloud = mix(cloud, haze, 0.30 * (1.0 - smoothstep(0.02, 0.18, d.y)));
  // A bright break always sits around the sun (about 8 degrees) so a sun disc and shafts are possible.
  dens *= 1.0 - 0.65 * pow(scp, 40.0);
  col = mix(col, cloud, dens);
  // Sun disc + corona in linear HDR so they exceed the bloom threshold (1.0) and feed the shaft pass.
  col += uSunColor * (smoothstep(0.9990, 0.9996, sc) * 12.0 + pow(scp, 64.0) * 1.8) * (1.0 - dens * 0.6);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
 }`;
}

const cloudVertex = /* glsl */`
 varying vec3 vW;
 void main() {
  vW = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
 }`;

function cloudFragment(octaves) {
 return /* glsl */`
 #define OCT ${octaves}
 varying vec3 vW;
 uniform float uTime;
 uniform float uCover;
 uniform float uAlpha;
 uniform vec3 uSunDir;
 uniform vec3 uSunColor;
 uniform vec3 uTint;
 uniform vec3 fogColor;
 uniform float fogDensity;
 ${fogGLSL}
 ${noiseGLSL}
 void main() {
  // 1 noise unit = 200 m: seen from 215 m below, billows are 20-40 degrees wide, not one smooth blob.
  vec2 p = vW.xz * 0.005 + vec2(uTime * 0.006, 0.0);
  float d = fbm(p);
  float dens = smoothstep(1.0 - uCover, 1.0 - uCover + 0.22, d);
  // Density gradient toward the sun approximates self-shadowing: thin edges facing the sun glow.
  float toward = fbm(p + uSunDir.xz * 0.05);
  float lit = clamp((d - toward) * 9.0 + 0.30, 0.0, 1.0);
  lit *= lit;
  vec3 v = normalize(vW - cameraPosition);
  float sc = max(dot(v, uSunDir), 0.0);
  float sunSide = pow(sc, 6.0);
  // Bases deep purple-grey; the thin sunward parts glow amber (contrast is what sells the storm ceiling).
  vec3 dark = mix(vec3(0.09, 0.095, 0.13), vec3(0.03, 0.03, 0.05), smoothstep(0.3, 0.9, dens));
  vec3 col = mix(dark, uSunColor * (0.45 + 0.6 * sunSide), lit * (1.0 - dens * 0.6));
  // Silver lining on the thin edges, hottest toward the sun.
  float edge = smoothstep(0.0, 0.3, dens) * (1.0 - smoothstep(0.3, 0.8, dens));
  col += uSunColor * edge * (0.15 + 0.9 * sunSide);
  // Purple storm tint inside the thick parts (the v066 cumulonimbus look).
  col += uTint * smoothstep(0.5, 0.9, dens);
  float a = dens * 0.96 * uAlpha;
  // A bright break always sits around the sun so the shaft pass has something to shine through.
  a *= 1.0 - 0.75 * pow(sc, 30.0);
  // A flat plane seen edge-on (below ~24 degrees up, v.y < 0.4) is only horizontal streaks that grey out
  // the horizon; fade it there and let the dome's cloud towers own the strip the rider actually sees.
  a *= smoothstep(0.12, 0.40, v.y);
  // The layer fogs itself at half density (fog:false on the material so it does not double up).
  float fogF = heightFogAmount(cameraPosition, vW, fogDensity * 0.5);
  col = mix(col, fogInscatter(cameraPosition, vW), clamp(fogF, 0.0, 1.0));
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
 }`;
}

// Soft radial glow texture for the lens flare (no image file needed).
function makeFlareTexture(size, inner, outer) {
 const canvas = document.createElement('canvas');
 canvas.width = canvas.height = size;
 const ctx = canvas.getContext('2d');
 const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
 g.addColorStop(0, inner);
 g.addColorStop(0.35, 'rgba(255,225,190,0.35)');
 g.addColorStop(1, outer);
 ctx.fillStyle = g;
 ctx.fillRect(0, 0, size, size);
 const t = new THREE.CanvasTexture(canvas);
 t.colorSpace = THREE.SRGBColorSpace;
 return t;
}

// Returns a copy of the HDR with every channel clamped to maxValue, for the PMREM only. Measured on
// kiara_8_sunset_2k: the sun texels sit at 65504 (the half-float ceiling, 452 texels over 50). Fed raw
// into the PMREM they come out as blocky white squares on chrome and turn flat water into a white mirror.
// The DirectionalLight is the sun; the environment only needs a soft hot spot on the sun side.
// skyBoost: the sky half of kiara_8_sunset averages only 0.083 radiance (measured on the 1k file; the sunlit ground
// half is 0.44), so the image-based light carried almost no sky light and every face turned away from the sun (wings,
// neck top, fists, the shaded wall) came out black. The copy that feeds the PMREM has its sky half multiplied so the
// mean sky radiance is ~0.5 next to the 3.2 sun, i.e. the bright overcast sky of the reference frames. The visible
// dome still samples the raw file, so the picture of the sky does not change.
function clampedHdrCopy(t, maxValue, skyBoost = 1) {
 const src = t.image.data;
 const dst = src.slice();
 const {width, height} = t.image;
 const stride = dst.length / (width * height);
 const isHalf = src instanceof Uint16Array;
 const smooth = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
 for (let row = 0; row < height; row++) {
  const v = t.flipY ? 1 - (row + 0.5) / height : (row + 0.5) / height;
  const elevation = (v - 0.5) * Math.PI;
  const boost = 1 + (skyBoost - 1) * smooth(-0.05, 0.15, elevation);
  const from = row * width * stride, to = from + width * stride;
  for (let i = from; i < to; i++) {
   if (stride === 4 && (i - from) % 4 === 3) continue;   // alpha channel untouched
   let value = isHalf ? THREE.DataUtils.fromHalfFloat(dst[i]) : dst[i];
   if (value > maxValue) value = maxValue;
   value *= boost;
   dst[i] = isHalf ? THREE.DataUtils.toHalfFloat(value) : value;
  }
 }
 const c = new THREE.DataTexture(dst, t.image.width, t.image.height, t.format, t.type);
 c.mapping = THREE.EquirectangularReflectionMapping;
 c.colorSpace = t.colorSpace;
 c.flipY = t.flipY;
 c.minFilter = THREE.LinearFilter;
 c.magFilter = THREE.LinearFilter;
 c.generateMipmaps = false;
 c.needsUpdate = true;
 return c;
}

// Finds the brightest texel of the equirect HDR and returns its world direction (three's convention).
function findHdrSun(texture) {
 const {width, height, data} = texture.image;
 const stride = data.length / (width * height);
 let best = -1, bi = 0;
 for (let i = 0; i < width * height; i++) {
  const v = data[i * stride] + data[i * stride + 1] + data[i * stride + 2];
  if (v > best) { best = v; bi = i; }
 }
 const row = Math.floor(bi / width);
 const u = (bi % width + 0.5) / width;
 const v = texture.flipY ? 1 - (row + 0.5) / height : (row + 0.5) / height;
 const theta = (u - 0.5) * 2 * Math.PI, phi = (v - 0.5) * Math.PI;
 return new THREE.Vector3(Math.cos(theta) * Math.cos(phi), Math.sin(phi), Math.sin(theta) * Math.cos(phi));
}

// ---------------------------------------------------------------------------------------------
// createSky({renderer, scene}) -> {sunDirection, sunColor, sunLight, skyDome, clouds, ready, update, fogUniforms, dispose}
// ---------------------------------------------------------------------------------------------
export function createSky({renderer, scene}) {
 const tier = TIER;                       // read at CALL time so a dev page can pick the tier first
 const budget = BUDGET[tier];
 const sunDirection = SUN_DIRECTION.clone();
 const sunColor = new THREE.Color(SUN_COLOR_HEX);
 const info = {tier, hdrSize: '', sunElevDeg: 0, yawDeg: 0, cloudOctaves: tier === 'phone' ? 4 : 5};

 // Fog: built-in materials read fogColor/fogDensity from scene.fog. No background: the sky is a mesh.
 scene.fog = new THREE.FogExp2(fogUniforms.fogColor.value.clone(), fogUniforms.fogDensity.value);
 scene.background = null;

 // Lights: one sun, one hemisphere fill. Shadow box +/-24 m follows the dragon (update()).
 const sunLight = new THREE.DirectionalLight(sunColor, 3.2);
 sunLight.castShadow = true;
 sunLight.shadow.mapSize.set(budget.shadowMap, budget.shadowMap);
 Object.assign(sunLight.shadow.camera, {left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 260});
 sunLight.shadow.bias = -0.0003;
 sunLight.shadow.normalBias = 0.04;
 sunLight.shadow.camera.updateProjectionMatrix();
 sunLight.position.copy(sunDirection).multiplyScalar(120);
 scene.add(sunLight, sunLight.target);
 // Fill 0.45 (contract said 0.25): with the sun ahead, the rider sees only unlit back faces of the neck, fists and
 // pommel; at 0.25 they measured 1-13/255 in the game frame against 21-58 in the reference frames.
 // 1.2: three divides this light by pi in the Lambert term, so 1.2 x the sky colour (~0.25) is only ~0.1 of reflected
 // sky light on an up-facing face; the HDRI's own sky averages 0.083 radiance (measured), i.e. almost no sky light.
 const hemi = new THREE.HemisphereLight(0x6f8aa0, 0x2a2118, 0.6);
 scene.add(hemi);
 renderer.shadowMap.enabled = true;
 renderer.shadowMap.type = tier === 'phone' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;

 // Sky dome: HDRI above the horizon (darkened), fog colour below, sun disc + corona in HDR.
 const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: {
   uSky: {value: null}, uRot: {value: 0}, uHasSky: {value: 0}, uTime: {value: 0},
   fogColor: fogUniforms.fogColor,
   uSunDir: {value: sunDirection}, uSunColor: {value: sunColor},
  },
  vertexShader: skyVertex, fragmentShader: skyFragment(info.cloudOctaves),
 });
 const skyDome = new THREE.Mesh(new THREE.SphereGeometry(1900, 48, 28), skyMat);
 skyDome.frustumCulled = false;
 skyDome.renderOrder = -10;
 skyDome.name = 'skyDome';
 scene.add(skyDome);

 // Cloud ceiling: a huge flat plane 215 m above the camera. High tier adds a thinner second layer.
 const cloudGeo = new THREE.PlaneGeometry(6000, 6000, 1, 1);
 cloudGeo.rotateX(-Math.PI / 2);
 function makeCloudLayer(cover, alpha, order) {
  const mat = new THREE.ShaderMaterial({
   transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
   uniforms: {
    uTime: {value: 0}, uCover: {value: cover}, uAlpha: {value: alpha},
    uSunDir: {value: sunDirection}, uSunColor: {value: sunColor},
    uTint: {value: new THREE.Vector3(0.05, 0.015, 0.08)},
    fogColor: fogUniforms.fogColor, fogDensity: fogUniforms.fogDensity,
   },
   vertexShader: cloudVertex, fragmentShader: cloudFragment(info.cloudOctaves),
  });
  const mesh = new THREE.Mesh(cloudGeo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  mesh.name = 'clouds';
  scene.add(mesh);
  return mesh;
 }
 const clouds = makeCloudLayer(0.72, 1.0, -5);
 const cloudsHigh = tier === 'phone' ? null : makeCloudLayer(0.55, 0.6, -6);

 // Lens flare (high only): a soft glow on the sun plus two small ghosts; occluded by walls via depth.
 let flare = null, flareTextures = [];
 if (tier !== 'phone') {
  try {
   flare = new Lensflare();
   const glow = makeFlareTexture(256, 'rgba(255,240,215,0.9)', 'rgba(255,200,150,0)');
   const ghost = makeFlareTexture(128, 'rgba(255,215,170,0.30)', 'rgba(255,190,140,0)');
   flareTextures = [glow, ghost];
   flare.addElement(new LensflareElement(glow, 300, 0, sunColor));
   flare.addElement(new LensflareElement(ghost, 44, 0.6, new THREE.Color(0xffc98a)));
   flare.addElement(new LensflareElement(ghost, 64, 0.9, new THREE.Color(0xd9a56e)));
   flare.name = 'lensflare';
   scene.add(flare);
  } catch (e) {
   console.warn('sky: lens flare unavailable: ' + e.message);
   flare = null;
  }
 }

 // HDRI: PMREM for image-based light, the raw equirect for the visible sky dome.
 let hdrTexture = null;
 const hdrName = budget.textureSize === '2k' ? 'kiara_8_sunset_2k.hdr' : 'kiara_8_sunset_1k.hdr';
 const ready = new Promise(resolve => {
  new RGBELoader().load(new URL('./assets/' + hdrName, import.meta.url).href, t => {
   t.mapping = THREE.EquirectangularReflectionMapping;
   hdrTexture = t;
   const hdrSun = findHdrSun(t);
   // Yaw so the HDRI sun's azimuth matches sunDirection's azimuth (elevation stays the HDRI's ~3.9 deg).
   const yaw = Math.atan2(sunDirection.z, sunDirection.x) - Math.atan2(hdrSun.z, hdrSun.x);
   try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    // Clamp at 400, not 32: at 32 the clearcoat highlight the HDRI sun paints along the neck top (the one thing that
    // lit the neck on dev/dragon.html, which PMREMs the raw file) was gone. water.js caps its own radiance at 4.
    const clamped = clampedHdrCopy(t, 400, 2.5);   // 2.5x: mean sky ~0.21; at 6x the frame washed out (neck 114, fists 123-149 vs reference 58 / 35)
    scene.environment = pmrem.fromEquirectangular(clamped).texture;
    pmrem.dispose();
    clamped.dispose();
    scene.environmentIntensity = 0.6;
    scene.environmentRotation.set(0, yaw, 0);
   } catch (e) {
    console.warn('sky: PMREM failed, no image-based light: ' + e.message);
   }
   skyMat.uniforms.uSky.value = t;
   skyMat.uniforms.uRot.value = yaw;
   skyMat.uniforms.uHasSky.value = 1;
   info.hdrSize = t.image.width + 'x' + t.image.height;
   info.sunElevDeg = Math.asin(hdrSun.y) * 180 / Math.PI;
   info.yawDeg = yaw * 180 / Math.PI;
   resolve();
  }, undefined, e => {
   console.warn('sky: HDR load failed, flat sky and no image-based light: ' + (e && e.message ? e.message : e));
   resolve();
  });
 });

 const tmp = new THREE.Vector3();
 function update(time, cameraWorldPosition, shadowAnchorPosition) {
  const cam = cameraWorldPosition, anchor = shadowAnchorPosition || cameraWorldPosition;
  skyDome.position.copy(cam);
  skyMat.uniforms.uTime.value = time;
  clouds.position.set(cam.x, cam.y + 215, cam.z);
  clouds.material.uniforms.uTime.value = time;
  if (cloudsHigh) {
   cloudsHigh.position.set(cam.x, cam.y + 330, cam.z);
   cloudsHigh.material.uniforms.uTime.value = time * 0.7 + 100;
  }
  if (flare) flare.position.copy(cam).addScaledVector(sunDirection, 1500);
  sunLight.position.copy(anchor).addScaledVector(sunDirection, 120);
  sunLight.target.position.copy(anchor);
  // Live fog values propagate to every built-in material through scene.fog.
  scene.fog.color.copy(fogUniforms.fogColor.value);
  scene.fog.density = fogUniforms.fogDensity.value;
 }

 function dispose() {
  scene.remove(skyDome, clouds, sunLight, sunLight.target, hemi);
  if (cloudsHigh) { scene.remove(cloudsHigh); cloudsHigh.material.dispose(); }
  if (flare) { scene.remove(flare); flare.dispose(); }
  for (const t of flareTextures) t.dispose();
  skyDome.geometry.dispose(); skyMat.dispose();
  cloudGeo.dispose(); clouds.material.dispose();
  if (scene.environment) { scene.environment.dispose(); scene.environment = null; }
  if (hdrTexture) hdrTexture.dispose();
  sunLight.dispose();
 }

 return {sunDirection, sunColor, sunLight, hemiLight: hemi, skyDome, clouds, cloudsHigh, lensflare: flare, ready, update, fogUniforms, info, dispose};
}
