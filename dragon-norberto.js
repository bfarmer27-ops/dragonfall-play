// Ryan's selected Dragon flying by NORBERTO-3D, CC BY 4.0.
// The preserved GLB is byte-identical to the downloaded source. Its animation is
// a 51-frame morph sequence, not a bone rig: never substitute skeletal animation.
import * as THREE from './vendor/three.module.js';
import {GLTFLoader} from './vendor/addons/loaders/GLTFLoader.js';

export const SOURCE_URL = 'https://sketchfab.com/3d-models/dragon-flying-78f809b98bbe426e94d4024dc894b206';
export const MODEL_URL = new URL('./assets/models/norberto-dragon.glb', import.meta.url).href;
export const DRAGON_SCALE = 1.6;
// Source faces +Z, with Y up; flight and both cameras expect -Z. This uniform
// scale preserves the artist's proportions, including the tail and wing stroke.
export const SOURCE_SCALE = .043;
export const CLIP_NAME = 'Object_0';
export const GLIDE_FRAME_TIME = 35 / 30;
// The selected NORBERTO mesh stores the tail motion in the authored morph frames.
// Keep the source file unchanged, but reduce only the rear morph displacement in the runtime copy.
export const TAIL_MOTION_SCALE = .6;
export const TAIL_MOTION_TIME_BLEND = .2;
export const TAIL_MOTION_START = 78;
export const TAIL_MOTION_END = 20;
export function tailMotionFactor(sourceZ) {
  if (sourceZ >= TAIL_MOTION_START) return 1;
  if (sourceZ <= TAIL_MOTION_END) return TAIL_MOTION_SCALE;
  const t = (TAIL_MOTION_START - sourceZ) / (TAIL_MOTION_START - TAIL_MOTION_END);
  return 1 - (1 - TAIL_MOTION_SCALE) * t;
}
const preparedTailGeometries = new WeakSet();
const SADDLE = new THREE.Vector3(0, .79, .55);
const SOURCE_SEAT = new THREE.Vector3(0, 92, 76);
const COLORS = {emerald: '#62bb87', ice: '#8ed3ff', ember: '#ed8551', royal: '#b18cda'};
let loadPromise;
export function loadNorbertoDragon() {
  if (!loadPromise) loadPromise = new GLTFLoader().loadAsync(MODEL_URL).catch(error => {loadPromise = null; throw error;});
  return loadPromise;
}
function prepareTailMorphs(scene) {
  const body = scene.getObjectByName('yh_rd_long001');
  const base = body?.geometry?.attributes?.position;
  if (!body || !base || preparedTailGeometries.has(body.geometry)) return;
  for (const kind of ['position', 'normal']) {
    const sourceMorphs = (body.geometry.morphAttributes[kind] || []).map(morph => ({
      x: Array.from({length: base.count}, (_, i) => morph.getX(i)),
      y: Array.from({length: base.count}, (_, i) => morph.getY(i)),
      z: Array.from({length: base.count}, (_, i) => morph.getZ(i)),
    }));
    for (let m = 0; m < sourceMorphs.length; m++) {
      const morph = body.geometry.morphAttributes[kind][m];
      const prev = sourceMorphs[(m + sourceMorphs.length - 1) % sourceMorphs.length];
      const current = sourceMorphs[m];
      const next = sourceMorphs[(m + 1) % sourceMorphs.length];
      for (let i = 0; i < base.count; i++) {
        const factor = tailMotionFactor(base.getZ(i));
        if (factor === 1) continue;
        const blend = TAIL_MOTION_TIME_BLEND;
        morph.setX(i, (prev.x[i] * blend + current.x[i] * (1 - blend * 2) + next.x[i] * blend) * factor);
        morph.setY(i, (prev.y[i] * blend + current.y[i] * (1 - blend * 2) + next.y[i] * blend) * factor);
        morph.setZ(i, (prev.z[i] * blend + current.z[i] * (1 - blend * 2) + next.z[i] * blend) * factor);
      }
      morph.needsUpdate = true;
    }
  }
  preparedTailGeometries.add(body.geometry);
}

export function createDragon(renderer, {onReady, onError, gltf} = {}) {
  const dragon = new THREE.Group();
  dragon.name = 'norberto-dragon'; dragon.rotation.order = 'YXZ'; dragon.scale.setScalar(DRAGON_SCALE);
  const rigRoot = new THREE.Group();
  rigRoot.rotation.y = Math.PI; rigRoot.scale.setScalar(SOURCE_SCALE); dragon.add(rigRoot);
  function anchor(name, position) {
    const node = new THREE.Object3D(); node.name = name; node.position.copy(position); dragon.add(node); return node;
  }
  const saddleAnchor = anchor('saddleAnchor', SADDLE);
  saddleAnchor.scale.setScalar(1 / DRAGON_SCALE);
  const headAnchor = anchor('headAnchor', new THREE.Vector3(0, -.2, -2));
  const bridleAnchors = [-1, 1].map(side => anchor('bridle' + side, new THREE.Vector3(side * .25, -.2, -1.8)));
  const hornAnchor = anchor('cosmeticHorns', new THREE.Vector3(0, .4, -1.6));
  const hornMaterial = new THREE.MeshStandardMaterial({color: 0xd9bf82, roughness: .7});
  const horns = [];
  for (let i = 0; i < 4; i++) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(.11, .85, 7), hornMaterial);
    horn.position.set((i % 2 ? 1 : -1) * (i < 2 ? .34 : .18), .2, i < 2 ? 0 : -.25);
    horn.rotation.z = (i % 2 ? -1 : 1) * .25;
    hornAnchor.add(horn); horns.push(horn);
  }
  const saddleMaterial = new THREE.MeshStandardMaterial({color: 0x684426, roughness: .85, metalness: .05});
  const saddleAddon = new THREE.Mesh(new THREE.BoxGeometry(.96, .12, 1.26), saddleMaterial);
  saddleAddon.name = 'earned-saddle'; saddleAddon.position.set(0, -.1, -.1); saddleAnchor.add(saddleAddon);
  const materials = {skin: null, armor: null, keratin: hornMaterial, membrane: null};
  const appearance = {color: 'original', horns: 'standard', saddle: 'standard'};
  const authoredRider = [], materialRecords = [];
  const bounds = {source: SOURCE_URL, spanWorld: 0, triangles: 0, vertices: 0, clip: CLIP_NAME};
  let ready = false, error = null, rig = null, mesh = null, mixer = null, lastTime = null, disposed = false;
  let flightAction = null, glideAction = null, glideTarget = 0, glideWeight = 0;
  let riderView = false, hurtLeft = 0, hurtDuration = 1, clipTime = 0;
  let vertexIds = null;
  const point = new THREE.Vector3(), inverseDragon = new THREE.Matrix4();
  // Mesh vertices are sampled after AnimationMixer updates their morph weights.
  // Mouth/reins/wing streamers therefore follow the real animated surface.
  function vertexInDragon(index, out = new THREE.Vector3()) {
    mesh.getVertexPosition(index, out).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverseDragon);
    return out;
  }
  function nearestVertex(target) {
    let best = 0, distance = Infinity;
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);
      const d = point.distanceToSquared(target);
      if (d < distance) {best = i; distance = d;}
    }
    return best;
  }
  function syncAnchors() {
    if (!mesh) return;
    dragon.updateMatrixWorld(true); inverseDragon.copy(dragon.matrixWorld).invert();
    vertexInDragon(vertexIds.seat, saddleAnchor.position); saddleAnchor.position.y += .08;
    vertexInDragon(vertexIds.mouth, headAnchor.position);
    vertexInDragon(vertexIds.jaw[0], bridleAnchors[0].position);
    vertexInDragon(vertexIds.jaw[1], bridleAnchors[1].position);
    vertexInDragon(vertexIds.crown, hornAnchor.position);
    dragon.updateMatrixWorld(true);
  }
  function setRiderView(value) {
    riderView = Boolean(value);
    // The selected asset already contains an armed rider. In first person that
    // rider's head/armor would block our camera and hands. Keep the dragon whole.
    for (const part of authoredRider) part.visible = !riderView;
    return riderView;
  }
  function setAppearance(value = {}) {
    if (value.color !== undefined || value.scale !== undefined || value.scales !== undefined) {
      const color = value.color ?? value.scale ?? value.scales;
      appearance.color = color === 'original' ? 'original' : (COLORS[color] || color);
    }
    if (value.horns !== undefined) appearance.horns = ['standard', 'swept', 'crown'].includes(value.horns) ? value.horns : 'standard';
    if (value.saddle !== undefined) appearance.saddle = ['standard', 'explorer', 'armored'].includes(value.saddle) ? value.saddle : 'standard';
    for (const rec of materialRecords) {
      rec.material.color.copy(rec.color);
      if (rec.dragonBody && appearance.color !== 'original') rec.material.color.multiply(new THREE.Color(appearance.color));
    }
    hornAnchor.visible = appearance.horns !== 'standard';
    for (let i = 0; i < horns.length; i++) {
      horns[i].visible = appearance.horns === 'crown' || i < 2;
      horns[i].rotation.x = appearance.horns === 'swept' ? .85 : .15;
      horns[i].scale.y = appearance.horns === 'swept' ? 1.4 : 1;
    }
    saddleAddon.visible = appearance.saddle !== 'standard';
    saddleMaterial.color.setHex(appearance.saddle === 'armored' ? 0x859ca6 : 0x6e4828);
    saddleMaterial.metalness = appearance.saddle === 'armored' ? .55 : .05;
    return {...appearance};
  }
  function install(source) {
    if (source.parser?.json?.asset?.extras?.source !== SOURCE_URL) throw new Error('Dragon source does not match Ryan\'s selected NORBERTO-3D asset.');
    const clip = source.animations.find(c => c.name === CLIP_NAME);
    if (!clip || !clip.tracks.some(t => t.name.endsWith('.morphTargetInfluences'))) throw new Error('Selected dragon flight animation is missing.');
    prepareTailMorphs(source.scene);
    rig = source.scene.clone(true);
    mesh = rig.getObjectByName('yh_rd_long001');
    if (!mesh?.isMesh || mesh.geometry.morphAttributes.position?.length !== 51) throw new Error('Selected dragon animated body was not found.');
    // clone(true) shares geometry/texture bytes but each Mesh has its own morph
    // weights and each rider gets separate materials, mixer and cosmetics.
    rig.traverse(object => {
      if (!object.isMesh) return;
      const body = object === mesh;
      const originals = Array.isArray(object.material) ? object.material : [object.material];
      const cloned = originals.map(original => {
        const material = original.clone();
        materialRecords.push({material, color: material.color.clone(), emissive: material.emissive?.clone(), intensity: material.emissiveIntensity || 0, dragonBody: body});
        return material;
      });
      object.material = Array.isArray(object.material) ? cloned : cloned[0];
      object.castShadow = true; object.receiveShadow = true;
      // Animated bounds must include the complete authored wing stroke.
      object.frustumCulled = false;
      bounds.triangles += (object.geometry.index?.count || object.geometry.attributes.position.count) / 3;
      bounds.vertices += object.geometry.attributes.position.count;
      if (object !== mesh && object.name !== 'yh_rd_long001_zuo') authoredRider.push(object);
    });
    materials.skin = mesh.material; materials.armor = saddleMaterial; materials.membrane = mesh.material;
    mixer = new THREE.AnimationMixer(rig); flightAction = mixer.clipAction(clip).play();
    // Hold the artist's own wings-down frame in narrow caves. Every track is
    // sampled from the original clip, including body/rider motion. Blending
    // changes only animation weights; the source mesh and normal clip stay intact.
    const heldTracks = clip.tracks.map(track => {
      const value = Array.from(track.createInterpolant().evaluate(GLIDE_FRAME_TIME));
      return new track.constructor(track.name, [0, 1], [...value, ...value], track.getInterpolation());
    });
    glideAction = mixer.clipAction(new THREE.AnimationClip('Authored cave glide', 1, heldTracks)).play();
    glideAction.setEffectiveWeight(0); mixer.setTime(0); rig.updateMatrixWorld(true);
    // Measure in the source frame before adding normalization or game placement.
    vertexIds = {
      seat: nearestVertex(SOURCE_SEAT), mouth: nearestVertex(new THREE.Vector3(0, 68, 136)),
      jaw: [nearestVertex(new THREE.Vector3(8, 67, 133)), nearestVertex(new THREE.Vector3(-8, 67, 133))],
      crown: nearestVertex(new THREE.Vector3(0, 85, 119)), tips: [0, 0]
    };
    let left = Infinity, right = -Infinity;
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);
      if (point.x < left) {left = point.x; vertexIds.tips[1] = i;}
      if (point.x > right) {right = point.x; vertexIds.tips[0] = i;}
    }
    bounds.spanWorld = (right - left) * SOURCE_SCALE * DRAGON_SCALE;
    mesh.getVertexPosition(vertexIds.seat, point).applyMatrix4(mesh.matrixWorld);
    // Rotation around Y maps source +Z to flight -Z. Keep the skin just beneath
    // the stable game seat; the anchor follows its small authored motion later.
    rigRoot.position.set(point.x * SOURCE_SCALE, SADDLE.y - .08 - point.y * SOURCE_SCALE, SADDLE.z + point.z * SOURCE_SCALE);
    rigRoot.add(rig); bounds.clipDuration = clip.duration; ready = true;
    setAppearance(appearance); setRiderView(riderView); syncAnchors();
    dragon.userData.loading = false; dragon.userData.source = SOURCE_URL;
    onReady?.(model);
    return model;
  }
  function update(pose = {}, flight = {}, l = 0, r = 0, time = 0) {
    const dt = lastTime === null ? 0 : Math.max(0, Math.min(.1, time - lastTime)); lastTime = time;
    if (!ready) return;
    glideWeight += Math.sign(glideTarget - glideWeight) * Math.min(Math.abs(glideTarget - glideWeight), dt * 4);
    flightAction.setEffectiveWeight(1 - glideWeight); glideAction.setEffectiveWeight(glideWeight);
    const frequency = Number.isFinite(pose.frequency) ? pose.frequency : .77;
    mixer.update(dt * frequency * bounds.clipDuration); clipTime = mixer.time;
    syncAnchors();
    hurtLeft = Math.max(0, hurtLeft - dt);
    for (const rec of materialRecords) {
      if (!rec.material.emissive) continue;
      rec.material.emissive.copy(rec.emissive);
      rec.material.emissiveIntensity = rec.intensity;
      if (hurtLeft && rec.dragonBody) {rec.material.emissive.setHex(0xff3015); rec.material.emissiveIntensity = .9 * hurtLeft / hurtDuration;}
    }
  }
  function wingTip(side) {
    if (!ready) return dragon.localToWorld(new THREE.Vector3(side ? 10 : -10, 0, 0));
    mesh.getVertexPosition(vertexIds.tips[side ? 1 : 0], point);
    return point.clone().applyMatrix4(mesh.matrixWorld);
  }
  function setHurt(seconds) {hurtLeft = hurtDuration = Math.max(.01, seconds || .5);}
  function setCaveGlide(amount) {glideTarget = Number.isFinite(Number(amount)) ? THREE.MathUtils.clamp(Number(amount), 0, 1) : 0; return glideTarget;}
  function profileAt(z) {
    // Sample the visible back near the centreline; wing membrane outliers are
    // excluded. Kept for callers that fit saddle straps to this model.
    let lo = Infinity, hi = -Infinity, width = 0;
    if (ready) {
      dragon.updateMatrixWorld(true); inverseDragon.copy(dragon.matrixWorld).invert();
      for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
        vertexInDragon(i, point);
        if (Math.abs(point.z - z) < .35 && Math.abs(point.x) < 1.1) {
          lo = Math.min(lo, point.y); hi = Math.max(hi, point.y); width = Math.max(width, Math.abs(point.x));
        }
      }
    }
    return Number.isFinite(lo) ? {w: Math.max(.1, width), h: Math.max(.1, (hi - lo) / 2), y: (hi + lo) / 2} : {w: .4, h: .3, y: -.1};
  }
  function dispose() {
    if (disposed) return;
    disposed = true; ready = false; dragon.userData.loading = false;
    mixer?.stopAllAction();
    if (rig) mixer?.uncacheRoot(rig);
    for (const rec of materialRecords) rec.material.dispose();
    for (const horn of horns) horn.geometry.dispose();
    hornMaterial.dispose(); saddleMaterial.dispose(); saddleAddon.geometry.dispose();
    // Original GLB geometry and textures remain cached for other players.
  }
  // Original materials use normal scene illumination, with no custom sun shader.
  function setSun() {}
  const follow = {gains: {}};
  const model = {dragon, saddleAnchor, headAnchor, mouthAnchor: headAnchor, bridleAnchors,
    style: 'norberto', materials, authoredRider, bounds, appearance,
    wings: [], tailSegments: [], neckBones: [], follow,
    setFollowGains: patch => Object.assign(follow.gains, patch || {}),
    setRiderView, setAppearance, setSun, setHurt, setCaveGlide, update, wingTip, profileAt, dispose,
    get ready() {return ready;}, get error() {return error;}, get disposed() {return disposed;},
    get mixer() {return mixer;}, get rig() {return rig;}, get clipTime() {return clipTime;}, get glideWeight() {return glideWeight;}
  };
  dragon.userData.loading = true;
  setAppearance();
  // Resolve with the model even on error, so start gates can show model.error
  // without an unhandled rejection. ready remains false on every error path.
  model.loading = Promise.resolve(gltf || loadNorbertoDragon()).then(source => disposed ? model : install(source)).catch(cause => {
    ready = false; error = cause; dragon.userData.loading = false; dragon.userData.loadError = String(cause);
    console.error('[dragon-norberto] load failed', cause); onError?.(cause); return model;
  });
  return model;
}
