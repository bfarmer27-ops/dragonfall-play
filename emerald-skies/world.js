import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Dragonfall canyon environment. Geometry stays in a seven-chunk pool; only a
// chunk crossing causes its buffers and instance matrices to be rebuilt.
const CHUNK = 240;
const CHUNKS = 7;
const HALF_RIVER = 65;
const OUTER = 270;
const NX = 34;
const NZ = 64;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hash = (n, seed = 0) => { const x = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453123; return x - Math.floor(x); };
const lerp = (a, b, t) => a + (b - a) * t;
function noise(x, z, seed = 0) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  return lerp(lerp(hash(ix + seed, iz), hash(ix + 1 + seed, iz), u), lerp(hash(ix + seed, iz + 1), hash(ix + 1 + seed, iz + 1), u), v);
}
function fbm(x, z, seed = 0) {
  let sum = 0, amp = .55, norm = 0;
  for (let i = 0; i < 5; i++) { sum += (noise(x, z, seed + i * 37) - .5) * amp; norm += amp; x *= 2.03; z *= 1.91; amp *= .52; }
  return sum / norm;
}
function centerAt(d) { return Math.sin(d * .0018) * 80 + Math.sin(d * .004) * 18; }
function cliffHeight(q, d, side) {
  const rise = 5 + (90+30*Math.sin(d*.007+side*2)+22*Math.sin(d*.019)) * (1 - Math.exp(-Math.max(0, q) * .04));
  const broad = fbm(side * q * .008 + side * 11.3, d * .006, side * 19);
  const ridge = Math.abs(fbm(side * q * .021 + 4.2, d * .017 + side * 7, 51));
  const rib = Math.pow(Math.max(0, Math.sin(q * .115 + d * .006 + side * 1.7 + broad * 3.1)), 7) * 9;
  const shelves = Math.sin((rise + broad * 25) * .19 + fbm(q * .018, d * .012, 93) * 3) * 3.2;
  const detail = fbm(q * .075 + side * 4, d * .052, 117) * 8;
  const upper = smooth(35, 125, q);
  const face = rise + broad * 22 + ridge * 17 + rib + shelves * upper + detail * smooth(1, 18, q);
  return lerp(-14, Math.max(4, face), smooth(0, 18, q));
}

function makeCliffGeometry(side) {
  const cols = NX + 1, rows = NZ + 1, count = cols * rows;
  const pos = new Float32Array(count * 3), uv = new Float32Array(count * 2), color = new Float32Array(count * 3);
  const indices = new Uint32Array(NX * NZ * 6);
  let k = 0;
  for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) {
    const a = z * cols + x, b = a + cols;
    if (side > 0) {
      indices[k++] = a; indices[k++] = a + 1; indices[k++] = b;
      indices[k++] = a + 1; indices[k++] = b + 1; indices[k++] = b;
    } else {
      indices[k++] = a; indices[k++] = b; indices[k++] = a + 1;
      indices[k++] = a + 1; indices[k++] = b; indices[k++] = b + 1;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(color, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.userData.rows = rows; geo.userData.cols = cols;
  return geo;
}

function fillCliff(geo, start, side) {
  const p = geo.attributes.position.array, uv = geo.attributes.uv.array, c = geo.attributes.color.array;
  let n = 0, t = 0;
  for (let j = 0; j <= NZ; j++) {
    const localD = CHUNK * j / NZ, d = start + localD;
    const bend = centerAt(d) - centerAt(start);
    for (let i = 0; i <= NX; i++) {
      const u = i / NX, q = u * (OUTER - HALF_RIVER);
      const faceNoise = fbm(q * .016 + side * 8, d * .014, 211);
      const ledgeCut = Math.max(0, Math.sin((q + faceNoise * 21) * .12 + d * .004 + side) - .62) * 3.5 * smooth(9, 35, q);
      const rockRibs=(Math.sin(d*.063+q*.085)*5+fbm(q*.055,d*.045,71)*15)*smooth(0,18,q);
      const x = side * (HALF_RIVER + q + rockRibs) + bend;
      const y = cliffHeight(q, d, side) - ledgeCut;
      p[n++] = x; p[n++] = y; p[n++] = -localD;
      // Texture scale is in world metres. A mild vertical offset prevents every chunk sharing a visible seam.
      uv[t++] = d / 22; uv[t++] = y / 22 + q / 48;
      const strata = .86 + .10 * Math.sin(y * .14 + faceNoise * 2) + (noise(q * .035, d * .025, 61) - .5) * .12;
      const moss = smooth(18, 65, q) * (.35+.65*noise(q*.025,d*.025,93));
      c[n - 3] = strata * (1 - moss * .68);
      c[n - 2] = strata * (1 - moss * .35);
      c[n - 1] = strata * (1 - moss * .75);
    }
  }
  geo.attributes.position.needsUpdate = true; geo.attributes.uv.needsUpdate = true; geo.attributes.color.needsUpdate = true;
  geo.computeVertexNormals(); geo.computeBoundingSphere();
}

function makeRiverGeometry(start) {
  const p = new Float32Array((NZ + 1) * 6), uv = new Float32Array((NZ + 1) * 4), indices = new Uint32Array(NZ * 6);
  for (let j = 0; j <= NZ; j++) {
    const d = CHUNK * j / NZ, row = j * 2, ix = j * 4;
    const bend = centerAt(start + d) - centerAt(start);
    p[row * 3] = bend - HALF_RIVER; p[row * 3 + 1] = 0; p[row * 3 + 2] = -d;
    p[(row + 1) * 3] = bend + HALF_RIVER; p[(row + 1) * 3 + 1] = 0; p[(row + 1) * 3 + 2] = -d;
    uv[ix] = 0; uv[ix + 1] = d / 18; uv[ix + 2] = 1; uv[ix + 3] = d / 18;
    if (j < NZ) { const a = row; const k = j * 6; indices[k] = a; indices[k + 1] = a + 2; indices[k + 2] = a + 1; indices[k + 3] = a + 1; indices[k + 4] = a + 2; indices[k + 5] = a + 3; }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(new THREE.BufferAttribute(indices, 1)); g.computeVertexNormals(); return g;
}
function makeRiverGeometryInto(g, start) {
  const p = g.attributes.position.array;
  for (let j = 0; j <= NZ; j++) {
    const d = CHUNK * j / NZ, row = j * 2, bend = centerAt(start + d) - centerAt(start);
    p[row * 3] = bend - HALF_RIVER; p[row * 3 + 1] = 0; p[row * 3 + 2] = -d;
    p[(row + 1) * 3] = bend + HALF_RIVER; p[(row + 1) * 3 + 1] = 0; p[(row + 1) * 3 + 2] = -d;
  }
  g.attributes.position.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingSphere();
}

export async function createWorld(scene) {
  const loader = new THREE.TextureLoader();
  const loadTexture = (path, color = false) => new Promise((resolve, reject) => loader.load(path, tex => {
    if (color) tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.anisotropy = 8; resolve(tex);
  }, undefined, error => reject(new Error(`Required Dragonfall texture failed to load: ${path} (${error?.message || 'load error'})`))));
  const [rockColor, rockNormal, rockArm, waterNormal,twig,alpha] = await Promise.all([
    loadTexture('../assets/waterfall/rock_face_03_diff_1k.jpg', true),
    loadTexture('../assets/waterfall/rock_face_03_nor_gl_1k.jpg'),
    loadTexture('../assets/waterfall/rock_face_03_arm_1k.jpg'),
    loadTexture('../assets/water_normal_512.png'),
    loadTexture('../assets/waterfall/fir_tree_01_twig_diff_2k.jpg',true),
    loadTexture('../assets/waterfall/fir_tree_01_twig_alpha_2k.png'),
  ]);
  const gltfLoader = new GLTFLoader();
  const [cliffB, fernModel,treeModel] = await Promise.all([
    gltfLoader.loadAsync('../assets/waterfall/models/rock_moss_set_01.glb'),
    gltfLoader.loadAsync('../assets/waterfall/models/fern_02.glb'),
    gltfLoader.loadAsync('../assets/waterfall/models/fab/fab_trees_phone.glb'),
  ]);
  rockColor.repeat.set(1, 1); rockNormal.repeat.set(1, 1); rockArm.repeat.set(1, 1);
  if (waterNormal) waterNormal.repeat.set(4, 12);

  const cliffMat = new THREE.MeshStandardMaterial({ color: 0xaeb7a1, map: rockColor, normalMap: rockNormal,
    roughnessMap: rockArm, roughness: .91, metalness: .01, vertexColors: true, side: THREE.DoubleSide });
  if (cliffMat.normalScale) cliffMat.normalScale.set(1.35, 1.35);
  const riverMat = new THREE.ShaderMaterial({ fog: true, transparent: false, toneMapped: true, uniforms: {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    uTime: { value: 0 }, uNormal: { value: waterNormal }, uHasNormal: { value: 1 },
  }, vertexShader: `varying vec2 vUv; varying vec3 vWorld;
    #include <fog_pars_vertex>
    void main(){ vUv=uv; vec4 w=modelMatrix*vec4(position,1.0); vWorld=w.xyz; vec4 mvPosition=viewMatrix*w; gl_Position=projectionMatrix*mvPosition;
      #include <fog_vertex>
    }`,
  side: THREE.DoubleSide, fragmentShader: `uniform float uTime; uniform sampler2D uNormal; uniform float uHasNormal; varying vec2 vUv; varying vec3 vWorld;
    #include <fog_pars_fragment>
    void main(){vec2 q=vWorld.xz*.028;vec3 a=texture2D(uNormal,q+vec2(uTime*.008,-uTime*.023)).xyz*2.-1.;vec3 b=texture2D(uNormal,q*1.7+vec2(-uTime*.012,uTime*.011)).xyz*2.-1.;vec3 n=normalize(vec3((a.x+b.x)*.42,1.,(a.y+b.y)*.42));
    vec3 viewDir=normalize(cameraPosition-vWorld);float fresnel=pow(1.-max(dot(n,viewDir),0.),4.);
    vec3 col=mix(vec3(.012,.105,.095),vec3(.36,.50,.48),fresnel*.7);
    vec3 halfDir=normalize(viewDir+normalize(vec3(-.5,.8,.25)));float spec=pow(max(dot(n,halfDir),0.),56.);col+=vec3(1.15,1.02,.78)*spec*.75;
    float edge=abs(vWorld.x-(sin(-vWorld.z*.0018)*80.+sin(-vWorld.z*.004)*18.));float foam=smoothstep(61.,66.,edge)*smoothstep(.25,.8,a.x+b.y)*.25;col+=vec3(.3,.36,.27)*foam;gl_FragColor=vec4(col,1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
    }` });

  const cliffGeo = Array.from({ length: CHUNKS * 2 }, (_, i) => makeCliffGeometry(i % 2 === 0 ? -1 : 1));
  const riverGeo = Array.from({ length: CHUNKS }, () => makeRiverGeometry(0));
  const chunks = [];
  for (let i = 0; i < CHUNKS; i++) {
    const group = new THREE.Group();
    const left = new THREE.Mesh(cliffGeo[i * 2], cliffMat), right = new THREE.Mesh(cliffGeo[i * 2 + 1], cliffMat);
    const river = new THREE.Mesh(riverGeo[i], riverMat); river.frustumCulled = false;
    left.frustumCulled = false; right.frustumCulled = false;
    group.add(left, right, river); scene.add(group); chunks.push({ group, left, right, river, start: NaN });
  }

  const foliage = new THREE.Group(); scene.add(foliage);
  const treeCount = CHUNKS * 2, fernCount = CHUNKS * 6;
  const rockCount = CHUNKS * 3;
  const familyMeshes = [];
  const makeFamily = (gltf, capacity,normalize=false) => {
    gltf.scene.updateMatrixWorld(true);
    const box=new THREE.Box3().setFromObject(gltf.scene),mid=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
    const family = [];
    gltf.scene.traverse(node => {
      if (!node.isMesh) return;
      const geometry = node.geometry.clone().applyMatrix4(node.matrixWorld);
      if(normalize){geometry.translate(-mid.x,-box.min.y,-mid.z);geometry.scale(1/size.y,1/size.y,1/size.y);}
      geometry.computeBoundingSphere();
      const instance = new THREE.InstancedMesh(geometry, node.material, capacity);
      instance.frustumCulled = false; foliage.add(instance); family.push(instance); familyMeshes.push(instance);
    });
    if (!family.length) throw new Error('Required scanned Dragonfall model has no mesh.');
    return family;
  };
  const forestCount=CHUNKS*35;
  const leavesGeo=new THREE.PlaneGeometry(1,1),leafUV=leavesGeo.attributes.uv;
  for(let i=0;i<leafUV.count;i++)leafUV.setXY(i,.64453125+leafUV.getX(i)*.302734375,.619140625+leafUV.getY(i)*.3486328125);
  const leaves=new THREE.InstancedMesh(leavesGeo,new THREE.MeshStandardMaterial({map:twig,alphaMap:alpha,alphaTest:.4,side:THREE.DoubleSide,color:0x779d72,roughness:.9}),forestCount*12);
  const trunkGeo=new THREE.CylinderGeometry(.13,.32,1,6);
  const trunks=new THREE.InstancedMesh(trunkGeo,new THREE.MeshStandardMaterial({color:0x504536,roughness:1}),forestCount);
  for(const m of [leaves,trunks]){m.frustumCulled=false;foliage.add(m);familyMeshes.push(m);}
  const pick=(model,name)=>{let node;const clean=s=>s.replace(/[^a-zA-Z0-9_]/g,'');model.scene.traverse(n=>{if(clean(n.name)===clean(name))node=n;});if(!node)throw Error('Missing selected model '+name);return {scene:node};};
  const trees=makeFamily(pick(treeModel,'Tree.001_1'),treeCount,true);
  const ferns = makeFamily(pick(fernModel,'fern_02_a'), fernCount,true);
  const rockA = makeFamily(pick(cliffB,'rock_moss_set_01_rock01'), rockCount,true);
  const rockB = makeFamily(pick(cliffB,'rock_moss_set_01_rock03'), rockCount,true);

  // One instanced spray sheet per pool slot; the noise-torn edge and translucent
  // turquoise material give the drops a moving edge without adding draw calls.
  const fallGeo = new THREE.PlaneGeometry(1, 1, 1, 16);
  fallGeo.rotateY(Math.PI/2);
  const fp = fallGeo.attributes.position;
  for (let i = 0; i < fp.count; i++) fp.setX(i,(fp.getY(i)+.5)*.32);
  fallGeo.computeVertexNormals();
  const fallMat = new THREE.ShaderMaterial({ fog: true, toneMapped: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.NormalBlending,
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: { value: 0 } }, vertexShader: `#include <common>
      #include <fog_pars_vertex>
      varying vec2 vUv;
      void main(){ vUv=uv; vec4 local=vec4(position,1.0);
      #ifdef USE_INSTANCING
        local=instanceMatrix*local;
      #endif
      vec4 mvPosition=modelViewMatrix*local; gl_Position=projectionMatrix*mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: `#include <common>
      #include <fog_pars_fragment>
      uniform float uTime; varying vec2 vUv;
      void main(){float side=1.-smoothstep(.3,.5,abs(vUv.x-.5));float ends=smoothstep(0.,.04,vUv.y)*(1.-smoothstep(.97,1.,vUv.y));float strands=sin(vUv.x*97.+sin(vUv.y*14.-uTime*4.))*sin(vUv.x*41.+vUv.y*9.-uTime*6.);float a=side*ends*(.46+strands*.22);gl_FragColor=vec4(.65,.83,.79,a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
      }` });
  const fallCount = CHUNKS * 3;
  const falls = new THREE.InstancedMesh(fallGeo, fallMat, fallCount); falls.frustumCulled = false; scene.add(falls);
  const mistGeo = new THREE.SphereGeometry(1, 8, 6);
  const mistMat = new THREE.MeshBasicMaterial({ color: 0xd6eee0, transparent: true, opacity: .105, depthWrite: false });
  const mistCount = CHUNKS * 8, mist = new THREE.InstancedMesh(mistGeo, mistMat, mistCount); mist.frustumCulled = false; scene.add(mist);

  const dummy = new THREE.Object3D();
  let disposed = false;
  const setFamilyAt = (family, slot, x, y, z, scale, yaw) => {
    dummy.position.set(x, y, z); dummy.rotation.set(0, yaw, 0); dummy.scale.setScalar(scale); dummy.updateMatrix();
    for (let i = 0; i < family.length; i++) family[i].setMatrixAt(slot, dummy.matrix);
  };
  const rebuildChunk = (chunk, start) => {
    chunk.start = start; chunk.group.position.set(centerAt(start), 0, -start);
    fillCliff(chunk.left.geometry, start, -1); fillCliff(chunk.right.geometry, start, 1);
    const chunkSlot = chunks.indexOf(chunk), treeBase = chunkSlot * 2, fernBase = chunkSlot * 6, rockBase = chunkSlot * 3;
    for(let i=0;i<35;i++){
      const seed=start+i*17,d=start+hash(seed,3)*CHUNK,q=22+hash(seed,4)*140,side=i%2?1:-1;
      const x=centerAt(d)+side*(HALF_RIVER+q),y=cliffHeight(q,d,side)-3,size=13+hash(seed,8)*18,slot=chunkSlot*35+i;
      dummy.position.set(x,y+size*.5,-d);dummy.rotation.set(0,0,0);dummy.scale.set(size*.32,size,size*.32);dummy.updateMatrix();trunks.setMatrixAt(slot,dummy.matrix);
      for(let j=0;j<12;j++){const layer=Math.floor(j/4),a=j*Math.PI*.5+hash(seed,8)*6,w=size*(.85-layer*.19);dummy.position.set(x+Math.cos(a)*w*.18,y+size*(.38+layer*.22),-d+Math.sin(a)*w*.18);dummy.scale.set(w,w*714/620,1);dummy.rotation.set(-.12,a+Math.PI*.5,(hash(j,seed)-.5)*.4);dummy.updateMatrix();leaves.setMatrixAt(slot*12+j,dummy.matrix);}
    }
    for (let i = 0; i < 2; i++) {
      const seed = Math.floor(start / CHUNK) * 109 + i * 13 + 7, localD = 12 + hash(seed, 2) * (CHUNK - 24), d = start + localD;
      const side = hash(seed, 3) < .5 ? -1 : 1;
      const q = 20 + hash(seed, 4) * 55, x = centerAt(start) + (centerAt(d) - centerAt(start)) + side * (HALF_RIVER + q);
      const y = cliffHeight(q, d, side)-2, scale = 22 + hash(seed, 5) * 20;
      setFamilyAt(trees, treeBase + i, x, y, -d, scale, (hash(seed, 6) - .5) * .34);
    }
    for (let i = 0; i < 6; i++) {
      const seed = Math.floor(start / CHUNK) * 313 + i * 17 + 9, localD = hash(seed, 1) * CHUNK, d = start + localD;
      const side = hash(seed, 2) < .5 ? -1 : 1, q = 2 + hash(seed, 3) * 54;
      setFamilyAt(ferns, fernBase + i, centerAt(start) + (centerAt(d) - centerAt(start)) + side * (HALF_RIVER + q), cliffHeight(q, d, side) + .15, -d, 2.3 + hash(seed, 6) * 3.1, hash(seed, 4) * Math.PI * 2);
    }
    for (let i = 0; i < 3; i++) {
      const seed = Math.floor(start / CHUNK) * 419 + i * 31 + 5, d = start + 14 + hash(seed, 1) * (CHUNK - 28), side = hash(seed, 2) < .5 ? -1 : 1;
      const q = hash(seed, 3)*5, x = centerAt(start) + (centerAt(d) - centerAt(start)) + side * (HALF_RIVER + q);
      const y = -5, scale = 8 + hash(seed, 4) * 8, yaw = (side < 0 ? Math.PI : 0) + (hash(seed, 5) - .5) * .9;
      const selected = (i & 1) ? rockA : rockB, hidden = (i & 1) ? rockB : rockA;
      setFamilyAt(selected, rockBase + i, x, y, -d, scale, yaw);
      setFamilyAt(hidden, rockBase + i, x, y, -d, 0, yaw);
    }
    for (let i = 0; i < 3; i++) {
      const seed = Math.floor(start / CHUNK) * 83 + i * 7 + 1, d = start + 34 + i * 82 + hash(seed, 1) * 24;
      const side = i % 2 ? 1 : -1, top = cliffHeight(22,d,side)+8;
      dummy.position.set(centerAt(d)+side*(HALF_RIVER+2),top*.5,-d);
      dummy.rotation.set(0,0,0);dummy.scale.set(side*top,top,5+hash(seed,5)*5);dummy.updateMatrix();falls.setMatrixAt(chunks.indexOf(chunk)*3+i,dummy.matrix);
    }
    for (let i = 0; i < 8; i++) {
      const seed = Math.floor(start / CHUNK) * 101 + i * 11, d = start + hash(seed, 1) * CHUNK, side = hash(seed, 2) < .5 ? -1 : 1;
      dummy.position.set(centerAt(start) + (centerAt(d) - centerAt(start)) + side * (HALF_RIVER + 24 + hash(seed, 3) * 18), 8 + hash(seed, 4) * 12, -d);
      const s = 5 + hash(seed, 5) * 10; dummy.scale.set(s * 1.8, s * .46, s); dummy.updateMatrix(); mist.setMatrixAt(chunks.indexOf(chunk) * 8 + i, dummy.matrix);
    }
  };

  const route = (distance, out) => out.set(Math.sin(distance * .0018) * 80 + Math.sin(distance * .004) * 18,
    24 + Math.sin(distance * .002) * 6, -distance);
  const update = (distance, time) => {
    if (disposed) return;
    const playerChunk = Math.floor(distance / CHUNK), first = playerChunk - 1;
    let recycled = false;
    for (let i = 0; i < CHUNKS; i++) {
      const idx = first + i, start = idx * CHUNK, slot = ((idx % CHUNKS) + CHUNKS) % CHUNKS;
      if (chunks[slot].start !== start) { rebuildChunk(chunks[slot], start); makeRiverGeometryInto(riverGeo[slot], start); recycled = true; }
    }
    riverMat.uniforms.uTime.value = time; fallMat.uniforms.uTime.value = time;
    if (recycled) {
      for (let i = 0; i < familyMeshes.length; i++) familyMeshes[i].instanceMatrix.needsUpdate = true;
      falls.instanceMatrix.needsUpdate = true; mist.instanceMatrix.needsUpdate = true;
    }
  };
  update(0, 0);
  return {
    update,
    route,
    stats: { chunks: CHUNKS, drawCalls: CHUNKS * 3 + familyMeshes.length + 2, treeClusters: treeCount, ferns: fernCount, scannedRockInstances: rockCount * 2, waterfallSheets: fallCount, mistPuffs: mistCount },
    dispose() {
      if (disposed) return; disposed = true;
      scene.remove(foliage); chunks.forEach(c => scene.remove(c.group)); scene.remove(falls, mist);
      cliffGeo.forEach(g => g.dispose()); riverGeo.forEach(g => g.dispose()); familyMeshes.forEach(m => m.geometry.dispose()); fallGeo.dispose(); mistGeo.dispose();
      [cliffMat, riverMat, fallMat, mistMat].forEach(m => m.dispose());
      [rockColor, rockNormal, rockArm, waterNormal].forEach(t => t.dispose());
      const mats = new Set(), textures = new Set();
      for (const model of [cliffA, cliffB, fernModel, treeModel]) model.scene.traverse(o => { if (!o.isMesh) return; for (const m of (Array.isArray(o.material) ? o.material : [o.material])) { if (mats.has(m)) continue; mats.add(m); for (const value of Object.values(m)) if (value?.isTexture) textures.add(value); } });
      textures.forEach(t => t.dispose()); mats.forEach(m => m.dispose());
    },
  };
}
