// Demon dragon: the same createDragon() API and conventions as dragon.js, built around the
// "Demon Dragon Full Texture" GLB (endlessvoidmc, CC-BY-4.0, dist/assets/models/CREDITS.txt).
//
// Conventions kept from dragon.js (game.js and rider.js rely on them):
//   - the returned `dragon` group is scaled by DRAGON_SCALE (1.6); everything under it is authored in
//     dragon-LOCAL units, the dragon points along -Z with +Y up, the flight sim rotates the group (YXZ)
//   - saddleAnchor: an Object3D the rider rig (rider.js) and the rider camera hang from. It is parented
//     to the spine bone just behind the neck base and scaled so that its WORLD scale is 1 (rider.js
//     authors its geometry in metres, exactly like the 1/1.6 anchor in dragon.js)
//   - headAnchor: focus point at the head (DOF focus, fireball origin); bridleAnchors[2]: rein ends
//   - wings[2], wingTip(i, pose): world position of the wing tip (chase-camera streamers)
//   - update(pose, flight, l, r, time): wingbeat, head-leads / neck-follows / tail-lags chain
//   - setSun / setHurt / follow / setFollowGains / materials / tailSegments / neckBones / profileAt
//
// Loading is asynchronous. createDragon() returns synchronously with a placeholder body under
// `dragon` and the anchors at the classic positions, so game.js never waits; when the GLB is in, the
// placeholder is swapped for the model, the anchors are re-parented to bones and onReady(model) fires.
//
// Wingbeat: the GLB carries ONE clip, 'flying_skeletal.3' (13.125 s). Its shoulder rotation peaks at
// 1.79, 5.08, 8.38 and 11.71 s, i.e. FOUR identical flaps per clip, one flap = 3.28 s of clip time. The
// mixer is advanced by dt * pose.frequency * 3.28 s so one clip flap = one wingbeat of wingbeat.js, and
// the clip is offset so that clip "wings at the top" = wingbeat phase 0 (start of the power stroke).
// pose.sweep / pose.tip / the rider's wing input are blended in as additive bone rotations on top.
//
// The clip is split into four actions so its violent parts can be weighted (TUNE_DEFAULT):
//   wings  (shoulder..fingers)  wingAmp .55  - at 1 the power stroke folds the wings down and back
//                                             against the body in 0.5 s (no wing in the rider's frame)
//   neck   (neck_01..head, eyes) neckAmp .25 - at 1 the head dips out of the rider's frame every beat
//   torso  (spine_01..08, hips) torsoAmp .35 - at 1 the torso arches so the head moves 5 m relative to
//                                             the seat every beat
//   body   (everything else: pelvis, clavicles, legs, tail, spikes) at 1; the pelvis translation (a
//          3.3 m heave per flap at game scale) is post-processed to bodyBob (.2) about its flap mean.
//
// Scale (measured 09-10, dev/dragon-gltf.html): the model's wings and tail are out of proportion to
// its torso (raw span 3.0 units against a 1.0-unit torso), so the rig is scaled by BODY LENGTH: rigScale
// makes the seat-to-head-anchor distance HEAD_FROM_SEAT (6.1 units, eye-to-head ~10 m like the classic
// dragon's 11.4 m), the shoulder+hand bones are scaled down so the widest span is SPAN_TARGET_WORLD
// (46 m; classic 34.6 m), the 30 tail bones are scaled by a common factor so the tail is TAIL_LENGTH_LOCAL
// (9 units; classic 8.3). The seat is spine_04 (2.4 m behind the shoulders, 3 bones back), placed at
// the classic saddle spot (0,.79,.55) so game.js/rider.js geometry lands where it does on dragon.js;
// the three dorsal spikes in the saddle zone are collapsed. The back's cross-section is measured from
// the skinned mesh (bounds.profile, model.profileAt) so a rider rig can wrap straps around THIS back.
//
// Material: the GLB is a glTF METALLIC material (metalness 1, bright base colour, packed
// roughness/metalness map, AO map, NO normal map). It is rebuilt as a dielectric MeshStandardMaterial
// with a warm tint (0x8b5a45), roughness .92, envMapIntensity .35 and a small (.03, pow 4) sun rim on
// the silhouette only: at rim .06/pow 3 the rim alone turned the whole back cream from the chase camera.
import * as THREE from './vendor/three.module.js';
import {GLTFLoader} from './vendor/addons/loaders/GLTFLoader.js';
import {clone as cloneSkeleton} from './vendor/addons/utils/SkeletonUtils.js';
import {TIER,BUDGET} from './quality.js';
import {profileAt} from './dragon.js';

// ---------------------------------------------------------------------------------------------
// Dragon style switch (which module game.js should build the dragon from)
// ---------------------------------------------------------------------------------------------
export const DRAGON_STYLES=['classic','demon'];
const STYLE_KEY='dragonfall-dragon';
export function readDragonStyle(){
 try{const v=localStorage.getItem(STYLE_KEY);if(DRAGON_STYLES.includes(v))return v;}catch{}
 return 'demon';
}
export function saveDragonStyle(style){
 const v=DRAGON_STYLES.includes(style)?style:'demon';
 try{localStorage.setItem(STYLE_KEY,v);}catch{}
 return v;
}

// ---------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------
export const MODEL_URL=new URL('./assets/models/demon-dragon.glb',import.meta.url).href;
export const DRAGON_SCALE=1.6;
const FLAPS_PER_CLIP=4;              // measured from the shoulder rotation track (see header)
const CLIP_NAME='flying_skeletal.3';
// The rig is scaled by BODY LENGTH, not by wingspan: the model's wings and tail are out of proportion
// to its body (raw span 3.1 units against a 1.0-unit torso), so a wingspan-based scale left the head
// 3.9 m from the rider's eye. rigScale is picked so that the seat-to-head-anchor distance is
// HEAD_FROM_SEAT dragon-local units (the classic dragon: seat z=.55, head anchor z=-6.6 -> 7.15 units,
// 11.4 m; the rider's eye sits 0.85 m behind the seat). The wing and tail bone chains are then scaled
// DOWN so the span and the tail length land near the classic numbers.
const HEAD_FROM_SEAT=6.1;            // dragon-local units, seat anchor -> head anchor (9.8 m; eye -> head ~10.6 m)
const SPAN_TARGET_WORLD=46;          // metres tip to tip at the widest point of one flap (classic 34.6 m; wider is accepted)
const TAIL_LENGTH_LOCAL=9.0;         // dragon-local units, tail root -> tail tip (classic tail 8.3 from z=2.53)
const SEAT_BONE='spine_04';          // 3 spine bones behind the shoulders (spine_08 carries the clavicles)
const NECK_TAPER_BONES=3;            // how many neck bones before the head get tune.neckTaper (neck_09..neck_11)
// Pose corrections applied on top of the clip every frame (radians). The clip curls the neck up
// Pose corrections applied on top of the clip every frame (radians). The clip curls the neck up
// (head high and close) and the tail 12 m up; these spread a constant bend along the chains.
// createDragon(renderer, {tune: {...}}) overrides them; model.tune is live.
const TUNE_DEFAULT={
 neckExtend:-0.7,     // total pitch over the neck bones (+ = head raised toward the rider's eye line); the head bone
 headLevel:1,        //   is counter-rotated by headLevel * neckExtend so it keeps looking ahead.
                     //   Measured 09-11 (real game, rider view): at +.25 the neck climbed 27 degrees from its base and
                     //   the head top sat at 27 % of the screen height (horn tips 18 %), hiding the gate rings (Ryan:
                     //   "the head is in the way"). -.7 runs the neck ahead and DOWN: head top 52 % (1280x720),
                     //   51 % (390x844), 47 % (844x390), the ring and the canyon clear above it
 headScale:0.7,      // uniform scale of the head bone in the RIDER view (horns, jaw, eyes and the anchors follow);
                     //   at .65 the horns vanished behind the neck spikes, .7 keeps the head readable
 neckTaper:0.92,     // uniform scale of each of the last NECK_TAPER_BONES neck bones in the rider view (compounds:
                     //   .92^3 = .78 at the head, so the head's total shrink is headScale * .78 = .55)
 chaseNeckExtend:0.25,  // the same three knobs for the CHASE view (setRiderView(false)): the pre-09-11 look, unchanged.
 chaseHeadScale:1.0,    //   The chase camera (game.js positionCamera) sits 17 m behind and looks 35 m ahead, so the head
 chaseNeckTaper:1.0,    //   never blocks anything there. Measured 09-11 at 1280x720: with -.25/.85/.96 the head from
                        //   behind was a hornless bump 6.4 % of the width wide (top 58 %); at +.25/1/1 the horned head
                        //   stands above the back, 9.4 % wide (top 54 %). The rider-view shrink is rider-only by design.
 tailDroop:1.0,      // total pitch over the tail bones (+ = tail down)
 bodyPitch:0,        // nose angle after the spine has been levelled (+ = nose up), used at install
 wingAmp:0.55,       // weight of the clip's wing-bone tracks (1 = the clip's full stroke, 0 = T-pose).
                     //   Measured 09-10 (dev page __clipScan): at 1 every power stroke folds the wings
                     //   down and BACK against the body in 0.5 s (tips 19 m below and 10 m behind the
                     //   seat), which is the "no wing anywhere in frame" half of the beat; .55 keeps a
                     //   ~55-degree stroke about level so both wings stay at the sides of the rider view
 neckAmp:0.25,       // weight of the clip's neck/head tracks (1 = full head bob, which dips the head
                     //   out of the rider's frame on the downstroke)
 torsoAmp:0.35,      // weight of the clip's spine_01..08 / hips tracks: the clip arches and stretches
                     //   the torso every flap (head 5 m up and down relative to the seat at weight 1)
 headPitchMax:0.20,  // clamp on the follow chain's head pitch (rad) so the horns stay in the upper half of the frame
 rim:0.03,           // sun rim strength (dragon.js uses 0.12 with pow 3 on its much darker skin). Measured
                     //   09-10: at .06 the rim alone turned the whole back cream from the chase camera with
                     //   the sun ahead (the back is seen at grazing angles, so 1-n.v is high everywhere);
                     //   .03 with pow 4 keeps it on the silhouette edges
 bodyBob:0.2,        // weight of the clip's pelvis heave (the raw clip lifts the whole body 3.3 m per flap
                     //   at this scale; the classic pose.body heave is +-0.2 m)
 saddleSpikes:0.001, // scale of the dorsal spikes in the saddle zone (spineSpike_02..04 sit under/at the seat)
 frontSpike:0.5,     // scale of spineSpike_01, 1.6 units ahead of the pommel
 tint:0x8b5a45,      // warm tint: the baked base colour is bright (authored for a metallic look); a warm
                     //   mid-brown keeps the red-brown skin instead of the olive-khaki a grey tint gave
 roughness:0.92,     // dragon.js skin runs at roughness 1; at .62 the sunset HDRI specular bleached the demon
 envMapIntensity:0.35
};
const WING_BONE_RE=/^(l|r)_(clavicle|shoulder|shoulderTwist|forearm|hand|handMid|finger[A-G]_\d+|wingFlap[A-D]_\d+)$/;
const NECK_BONE_RE=/^(neck_\d+|head|jaw_\d+|tongue_\d+|fireBreath|[lr]_(eye|upperLid|lowerLid|browIn|browOut|nose|neckSpike\w*))$/;
const TORSO_BONE_RE=/^(spine_\d+|hips)$/;   // pelvis stays in the body clip (its translation is handled by bodyBob)
const SEAT_PAD=.06;
// Classic anchor spots used for the placeholder until the GLB is in.
const CLASSIC_SADDLE=new THREE.Vector3(0,.79,.55);
const CLASSIC_HEAD=new THREE.Vector3(0,.55,-6.6);
const CLASSIC_BRIDLE=[new THREE.Vector3(-.55,.30,-6.4),new THREE.Vector3(.55,.30,-6.4)];
const CLASSIC_TIP=[new THREE.Vector3(-10.82,.31,-4.0),new THREE.Vector3(10.82,.31,-4.0)];

const RIM_GLSL=`#include <lights_fragment_end>
{
 float rim = pow(1.0 - saturate(dot(normal, geometryViewDir)), 4.0);
 reflectedLight.directSpecular += uSunColor * uRim * rim;
}`;

// ---------------------------------------------------------------------------------------------
// One shared GLB load per page; every createDragon() clones the skinned scene (SkeletonUtils).
// ---------------------------------------------------------------------------------------------
let gltfPromise=null;
export function loadDemonDragon(){
 if(!gltfPromise){
  gltfPromise=new Promise((resolve,reject)=>{
   new GLTFLoader().load(MODEL_URL,gltf=>{
    // GLTFLoader strips '.' from node names ('spine_01.6_152' -> 'spine_016_152'), which makes the
    // trailing '.N_M' export suffix inseparable from the bone name. Map sanitized -> plain key
    // from the raw glTF JSON so bones are found by their authored names (spine_01, neck_03, head...).
    const table=new Map();
    for(const n of (gltf.parser.json.nodes||[]))if(n.name)table.set(THREE.PropertyBinding.sanitizeNodeName(n.name),boneKey(n.name));
    gltf.boneKeys=table;
    resolve(gltf);
   },undefined,reject);
  });
 }
 return gltfPromise;
}

const boneKey=name=>name.replace(/\.\d+_\d+$/,'');   // 'neck_01.14_58' -> 'neck_01'
const wrapAngle=a=>Math.atan2(Math.sin(a),Math.cos(a));
const TAU=Math.PI*2;

// Downscale a loaded texture image to `size` px (phone budget) through a canvas.
function downscaleTexture(tex,size){
 const img=tex.image;
 if(!img||!img.width||img.width<=size)return tex;
 try{
  const c=document.createElement('canvas');
  c.width=size;c.height=Math.max(1,Math.round(img.height*size/img.width));
  c.getContext('2d').drawImage(img,0,0,c.width,c.height);
  const t=new THREE.CanvasTexture(c);
  t.colorSpace=tex.colorSpace;t.wrapS=tex.wrapS;t.wrapT=tex.wrapT;t.flipY=tex.flipY;
  t.channel=tex.channel;t.anisotropy=tex.anisotropy;
  return t;
 }catch{return tex;}
}

// ---------------------------------------------------------------------------------------------
// createDragon
// ---------------------------------------------------------------------------------------------
export function createDragon(renderer,{onReady,onError,tune:tuneIn}={}){
 const high=TIER==='high';
 const tune=Object.assign({},TUNE_DEFAULT,tuneIn||{});
 const budget=BUDGET[TIER]||BUDGET.high;
 const dragon=new THREE.Group();
 dragon.name='demon-dragon';
 dragon.rotation.order='YXZ';
 dragon.scale.setScalar(DRAGON_SCALE);

 // ---- shared uniforms (same names as dragon.js so the dev pages and game.js can poke them)
 const uSunDir={value:new THREE.Vector3(-0.18,0.21,-0.90).normalize()};
 const uSunColor={value:new THREE.Color(0xffd7a8).multiplyScalar(3.2)};
 const uRim={value:tune.rim};
 function rimHook(shader){
  shader.uniforms.uSunColor=uSunColor;
  shader.uniforms.uRim=uRim;
  shader.fragmentShader=shader.fragmentShader
   .replace('#include <common>','#include <common>\nuniform vec3 uSunColor; uniform float uRim;')
   .replace('#include <lights_fragment_end>',RIM_GLSL);
 }

 // ---- anchors: classic spots until the model is in (rider.js attaches its rig to saddleAnchor at once)
 const saddleAnchor=new THREE.Object3D();
 saddleAnchor.name='saddleAnchor';
 saddleAnchor.position.copy(CLASSIC_SADDLE);
 saddleAnchor.scale.setScalar(1/DRAGON_SCALE);
 dragon.add(saddleAnchor);
 const headAnchor=new THREE.Object3D();
 headAnchor.name='headAnchor';
 headAnchor.position.copy(CLASSIC_HEAD);
 dragon.add(headAnchor);
 const bridleAnchors=CLASSIC_BRIDLE.map((p,i)=>{const a=new THREE.Object3D();a.name='bridle'+i;a.position.copy(p);dragon.add(a);return a;});
 // Rein route for rider.js (saddle-local metres). This dragon's neck is 2 m thick and the rider-view tune hangs the
 // mouth 2.25 m below the seat, so the rope has to run along the UPPER FLANK, outside the neck spikes and above the
 // jaw flare, instead of the classic dragon's fixed points at seat height. Measured 09-11 in the real game: the neck's
 // half-width stays under 1.10 m at heights -1.25..-1.75 from the shoulder to z=-8.5; the jaw flares to 1.73 m at
 // height -2 near z=-8. shoulder = a fixed point; flank/skull = [x, y above the bridle ring, z behind the bridle ring].
 // The classic dragon sets no route and keeps its old rope.
 for(const a of bridleAnchors)a.userData.reinRoute={shoulder:[1.15,-.85,-4.0],flank:[1.2,.7,2.7],skull:[1.2,.6,.9]};

 // ---- placeholder body (a dark loft-ish capsule and two wing slabs) shown until the GLB arrives
 const placeholder=new THREE.Group();
 placeholder.name='placeholder';
 const phMat=new THREE.MeshStandardMaterial({color:0x4a3a30,roughness:.8,metalness:0});
 const body=new THREE.Mesh(new THREE.CapsuleGeometry(.8,8,4,12),phMat);
 body.rotation.x=Math.PI/2;body.position.set(0,0,-2);
 placeholder.add(body);
 for(const side of [-1,1]){
  const w=new THREE.Mesh(new THREE.BoxGeometry(9,.08,4),phMat);
  w.position.set(side*5.3,.2,-1.6);
  placeholder.add(w);
 }
 placeholder.traverse(m=>{if(m.isMesh){m.castShadow=true;m.receiveShadow=true;}});
 dragon.add(placeholder);

 // ---- materials (filled when the GLB is in; `skin` is the one material of the model)
 const materials={skin:phMat,armor:phMat,keratin:phMat,membrane:phMat};

 // ---- follow-through state (identical structure to dragon.js; arrays are resized on load)
 const follow={
  rate:{yaw:0,pitch:0,roll:0},
  head:{yaw:0,pitch:0,roll:0},
  neck:Array.from({length:7},()=>({yaw:0,pitch:0,roll:0})),
  tail:Array.from({length:9},()=>({yaw:0,pitch:0,roll:0})),
  gains:{leadYaw:.35,leadPitch:.30,leadRoll:.20,staticYaw:.12,staticPitch:.08,staticRoll:-.25,
         tailYaw:-.30,tailPitch:-.22,tailRoll:-.15,maxLead:.40,headK:12,neckK:5,tailK:9,tailLagK:.9,rateK:14}
 };
 // Additive wing terms on top of the clip (radians): rider input per side, pose.sweep boost, tip bend.
 const wingGains={input:.09,sweep:.10,tip:.55,rest:0};
 let prevYaw=null,prevPitch=0,prevRoll=0;
 const AXES=['yaw','pitch','roll'];
 function stepFollow(yaw,pitch,roll,dt,realDt){
  const g=follow.gains;
  if(prevYaw!==null&&dt>0){
   const ry=wrapAngle(yaw-prevYaw)/realDt,rp=wrapAngle(pitch-prevPitch)/realDt,rr=wrapAngle(roll-prevRoll)/realDt;
   follow.rate.yaw=THREE.MathUtils.damp(follow.rate.yaw,THREE.MathUtils.clamp(ry,-6,6),g.rateK,dt);
   follow.rate.pitch=THREE.MathUtils.damp(follow.rate.pitch,THREE.MathUtils.clamp(rp,-6,6),g.rateK,dt);
   follow.rate.roll=THREE.MathUtils.damp(follow.rate.roll,THREE.MathUtils.clamp(rr,-6,6),g.rateK,dt);
  }
  prevYaw=yaw;prevPitch=pitch;prevRoll=roll;
  const targetYaw=THREE.MathUtils.clamp(-yaw*g.staticYaw-follow.rate.yaw*g.leadYaw,-g.maxLead,g.maxLead);
  const targetPitch=THREE.MathUtils.clamp(pitch*g.staticPitch-follow.rate.pitch*g.leadPitch,-g.maxLead,g.maxLead);
  const targetRoll=THREE.MathUtils.clamp(roll*g.staticRoll-follow.rate.roll*g.leadRoll,-g.maxLead,g.maxLead);
  const last=follow.neck.length-1,n=follow.tail.length;
  for(const ax of AXES){
   const target=ax==='yaw'?targetYaw:ax==='pitch'?targetPitch:targetRoll;
   follow.head[ax]=THREE.MathUtils.damp(follow.head[ax],target,g.headK,dt);
   if(ax==='pitch'&&tune.headPitchMax!==undefined)follow.head[ax]=THREE.MathUtils.clamp(follow.head[ax],-tune.headPitchMax,tune.headPitchMax);
   follow.neck[last][ax]=follow.head[ax];
   for(let i=last-1;i>=1;i--){
    const k=g.neckK+(g.headK-g.neckK)*(i/last);
    const share=Math.pow(i/last,1.3)/Math.pow((i+1)/last,1.3);
    follow.neck[i][ax]=THREE.MathUtils.damp(follow.neck[i][ax],follow.neck[i+1][ax]*share,k,dt);
   }
   follow.neck[0][ax]=0;
   const tailTarget=follow.rate[ax]*(ax==='yaw'?g.tailYaw:ax==='pitch'?g.tailPitch:g.tailRoll);
   for(let i=1;i<n;i++){
    const k=g.tailK*Math.pow(g.tailLagK,i);
    const ahead=i===1?tailTarget/(n-1):follow.tail[i-1][ax]/(i-1);
    follow.tail[i][ax]=THREE.MathUtils.damp(follow.tail[i][ax],ahead*i,k,dt);
   }
   follow.tail[0][ax]=0;
  }
 }
 function setFollowGains(patch){Object.assign(follow.gains,patch||{});}

 // ---- per-instance model state, filled by install()
 let ready=false,rig=null,mixer=null,action=null,wingAction=null,neckAction=null,torsoAction=null,clipDuration=0,beatSeconds=1,clipTopOffset=0;
 let torsoBone=null,neckChain=[],tailChain=[],tailRootBone=null,shoulderBones=[null,null],handBones=[null,null];
 let tipBones=[null,null],tipOffsets=[new THREE.Vector3(),new THREE.Vector3()],eyeBones=[];
 let saddleBase=new THREE.Vector3(),saddleUp=new THREE.Vector3(0,1,0),saddleUnit=1;
 let bodyProfile=null,applyBoneScalesFn=null,bobState=null;
 // Rider view (default) vs chase view: the head/neck shrink and the neck bend differ per view (see TUNE_DEFAULT).
 let riderView=tune.riderView===undefined?true:!!tune.riderView;
 let headBone=null,taperBones=[],boneScalesRef=null;
 const viewTune=key=>riderView?tune[key]:(tune['chase'+key[0].toUpperCase()+key.slice(1)]!==undefined?tune['chase'+key[0].toUpperCase()+key.slice(1)]:tune[key]);
 function applyViewScales(){
  if(!boneScalesRef||!headBone)return;
  const hs=Math.max(1e-3,viewTune('headScale')),ts=Math.max(1e-3,viewTune('neckTaper'));
  boneScalesRef.set(headBone,hs);
  for(const b of taperBones)boneScalesRef.set(b,ts);
 }
 function setRiderView(flag){
  riderView=!!flag;
  applyViewScales();
  if(applyBoneScalesFn)applyBoneScalesFn();
  return riderView;
 }
 const _bobTmp=new THREE.Vector3();
 const wings=[];
 const tailSegments=[];
 const neckBones=[];
 const bounds={};
 let hurtLeft=0,hurtDuration=1,lastTime=null;
 let animTime=0;

 // Rotation of `node` relative to the dragon group (product of the local quaternions from the rig down).
 const _chain=[];
 function frameQuat(node,out){
  out.identity();
  _chain.length=0;
  for(let n=node;n&&n!==dragon;n=n.parent)_chain.push(n);
  for(let i=_chain.length-1;i>=0;i--)out.multiply(_chain[i].quaternion);
  return out;
 }
 // Pre-multiply bone.quaternion so that the bone's children turn by R (given in the dragon frame)
 // about the bone's pivot; parentQ is the parent's rotation in the dragon frame.
 // three.js's PropertyMixer only writes a bone when the clip value CHANGED since its last write
 // (constant tracks, a held clip time, bones without tracks: never rewritten). If the extra rotation
 // were simply pre-multiplied every frame it would compound on those bones: 10x after ten frames,
 // off unit length, then NaN. So each bone remembers the quaternion we produced last frame; if it
 // still holds exactly that value the mixer did not write, and the pre-additive value is restored.
 const _qa=new THREE.Quaternion(),_qb=new THREE.Quaternion();
 const addState=new Map();
 let trackedQuat=new Set();
 function applyFrameRotation(bone,parentQ,R){
  let st=addState.get(bone);
  if(!st){st={mixed:new THREE.Quaternion(),result:new THREE.Quaternion(),init:false};addState.set(bone,st);}
  if(st.init&&bone.quaternion.equals(st.result))bone.quaternion.copy(st.mixed);
  st.mixed.copy(bone.quaternion);
  _qa.copy(parentQ).invert().multiply(R).multiply(parentQ);
  bone.quaternion.premultiply(_qa).normalize();
  st.result.copy(bone.quaternion);
  st.init=true;
 }
 const _euler=new THREE.Euler(),_R=new THREE.Quaternion(),_pq=new THREE.Quaternion();
 const _axisZ=new THREE.Vector3(0,0,1),_axisY=new THREE.Vector3(0,1,0);

 function install(gltf){
  const scene=cloneSkeleton(gltf.scene);
  const bones={};
  const meshes=[];
  const keys=gltf.boneKeys||new Map();
  scene.traverse(o=>{
   if(o.isBone)bones[keys.get(o.name)||boneKey(o.name)]=o;
   if(o.isMesh)meshes.push(o);
  });
  const need=['spine_01','spine_06','spine_07','spine_08','neck_01','head','tail_01','tail_30','hips','l_shoulder','r_shoulder','l_hand','r_hand','l_fingerD_04','r_fingerD_04'];
  for(const k of need)if(!bones[k])throw new Error('demon-dragon.glb: bone '+k+' missing');

  // ---- rig: turn the model so the head points -Z (it loads pointing +Z).
  rig=new THREE.Group();
  rig.name='demon-rig';
  rig.rotation.y=Math.PI;
  rig.add(scene);

  // ---- animation FIRST: the clip carries a pelvis translation far from the rest pose (the rest
  // pose is a T with the body elsewhere), so every measurement below is taken in the flying pose.
  const clip=gltf.animations.find(a=>a.name===CLIP_NAME)||gltf.animations[0];
  mixer=new THREE.AnimationMixer(scene);
  // The clip swings the shoulders 103 degrees, so the membranes sweep up over the rider's head at the
  // top of every stroke and hide the neck. The wing-bone tracks are split into their own clip and played
  // at weight tune.wingAmp; the remainder is the rest pose (a T with the wings level), which shrinks the
  // stroke around level. Body tracks (spine, neck, tail, legs, pelvis bob) keep full weight.
  // The neck/head tracks get their own clip too (tune.neckAmp): at full weight the clip dips the
  // head below the rider's frame on every downstroke.
  const wingTracks=[],bodyTracks=[],neckTracks=[],torsoTracks=[];
  for(const tr of clip.tracks){
   const node=tr.name.split('.')[0],key=keys.get(node)||node;
   (WING_BONE_RE.test(key)?wingTracks:NECK_BONE_RE.test(key)?neckTracks:TORSO_BONE_RE.test(key)?torsoTracks:bodyTracks).push(tr);
  }
  const torsoClip=new THREE.AnimationClip(clip.name+'-torso',clip.duration,torsoTracks);
  torsoAction=mixer.clipAction(torsoClip);
  torsoAction.setLoop(THREE.LoopRepeat,Infinity);
  torsoAction.setEffectiveWeight(tune.torsoAmp);
  torsoAction.play();
  const neckClip=new THREE.AnimationClip(clip.name+'-neck',clip.duration,neckTracks);
  neckAction=mixer.clipAction(neckClip);
  neckAction.setLoop(THREE.LoopRepeat,Infinity);
  neckAction.setEffectiveWeight(tune.neckAmp);
  neckAction.play();
  trackedQuat=new Set(clip.tracks.filter(t=>t.name.endsWith('.quaternion')).map(t=>t.name.split('.')[0]));
  const bodyClip=new THREE.AnimationClip(clip.name+'-body',clip.duration,bodyTracks);
  const wingClip=new THREE.AnimationClip(clip.name+'-wings',clip.duration,wingTracks);
  action=mixer.clipAction(bodyClip);
  action.setLoop(THREE.LoopRepeat,Infinity);
  action.play();
  wingAction=mixer.clipAction(wingClip);
  wingAction.setLoop(THREE.LoopRepeat,Infinity);
  wingAction.setEffectiveWeight(tune.wingAmp);
  wingAction.play();
  clipDuration=clip.duration;
  beatSeconds=clipDuration/FLAPS_PER_CLIP;
  // ---- bone-chain scales (wings and tail shrunk to the classic proportions; see the constants).
  // Every bone has a constant scale track in the clip, and three.js's PropertyMixer writes a bone
  // only when the clip value changed since its last write, so the clip writes these scales once
  // (first evaluation) and never again; applyBoneScales() re-applies ours after every mixer step.
  const boneScales=new Map();   // bone -> scalar
  boneScalesRef=boneScales;
  function applyBoneScales(){
   for(const [b,k] of boneScales)b.scale.setScalar(k);
   const st=bobState;
   if(st){
    if(st.init&&st.bone.position.equals(st.result))st.bone.position.copy(st.clip);
    st.clip.copy(st.bone.position);
    st.bone.position.copy(st.mean).addScaledVector(_bobTmp.subVectors(st.clip,st.mean),tune.bodyBob);
    st.result.copy(st.bone.position);
    st.init=true;
   }
  }
  applyBoneScalesFn=applyBoneScales;
  const setPose=t=>{mixer.setTime(t);applyBoneScales();rig.updateMatrixWorld(true);for(const m of meshes)if(m.isSkinnedMesh)m.skeleton.update();};
  setPose(0);

  // The finger tip is the vertex skinned mostly to fingerD_04 that lies farthest from the bone
  // origin (bone-local offset, so it is pose independent).
  for(const [i,key] of [[0,'l_fingerD_04'],[1,'r_fingerD_04']]){
   const bone=bones[key];
   let best=0;
   const v=new THREE.Vector3();
   for(const m of meshes){
    if(!m.isSkinnedMesh)continue;
    const idx=m.skeleton.bones.indexOf(bone);
    if(idx<0)continue;
    const si=m.geometry.attributes.skinIndex,sw=m.geometry.attributes.skinWeight;
    for(let k=0;k<si.count;k++){
     let w=0;
     if(si.getX(k)===idx)w=sw.getX(k);else if(si.getY(k)===idx)w=sw.getY(k);else if(si.getZ(k)===idx)w=sw.getZ(k);else if(si.getW(k)===idx)w=sw.getW(k);
     if(w<.5)continue;
     m.getVertexPosition(k,v).applyMatrix4(m.matrixWorld);   // skinned, mesh-local -> rig frame
     bone.worldToLocal(v);
     const d=v.lengthSq();
     if(d>best){best=d;tipOffsets[i].copy(v);}
    }
   }
   tipBones[i]=bone;
  }
  const wp=(k,out)=>bones[k].getWorldPosition(out||new THREE.Vector3());
  const tipAt=(i,out)=>tipBones[i].localToWorld(out.copy(tipOffsets[i]));

  // ---- sample one flap of the clip: widest span, wings-at-the-top time, spine pitch
  const N=48;
  const tA=new THREE.Vector3(),tB=new THREE.Vector3(),s01=new THREE.Vector3(),s08=new THREE.Vector3(),tmp=new THREE.Vector3();
  function sampleFlap(){
   let span=0,tT=0,tY=-1e9;
   s01.set(0,0,0);s08.set(0,0,0);
   for(let k=0;k<N;k++){
    const t=beatSeconds*k/N;
    setPose(t);
    tipAt(0,tA);tipAt(1,tB);
    span=Math.max(span,tA.distanceTo(tB));
    const y=tA.y+tB.y;
    if(y>tY){tY=y;tT=t;}
    s01.add(wp('spine_01',tmp));s08.add(wp('spine_08',tmp));
   }
   s01.divideScalar(N);s08.divideScalar(N);
   return {span,topT:tT};
  }
  const first=sampleFlap();
  const rawSpan=first.span,topT=first.topT;
  const axis=tmp.subVectors(s08,s01);                 // hips -> shoulders, forward is -z in the rig frame
  const bodyPitch=Math.atan2(axis.y,-axis.z);         // + = chest above hips
  rig.rotation.x=-bodyPitch+tune.bodyPitch;           // level the spine, then the tuned nose angle
  clipTopOffset=topT;
  setPose(topT);

  // ---- rig scale from the seat-to-head distance (body length), measured at the wings-at-the-top pose
  const seatBone=bones[SEAT_BONE]||bones.spine_04||bones.spine_05,seatBoneName=SEAT_BONE;
  const eyeMidRaw=bones.l_eye&&bones.r_eye?wp('l_eye').add(wp('r_eye')).multiplyScalar(.5):wp('head');
  const seatRaw=wp(SEAT_BONE);
  const headFromSeat=tune.headFromSeat||HEAD_FROM_SEAT;
  const s=headFromSeat/eyeMidRaw.distanceTo(seatRaw);
  rig.scale.setScalar(s);
  setPose(topT);

  // ---- wings: shrink the shoulder->hand chain so the span at the widest point is SPAN_TARGET_WORLD.
  // Split evenly over shoulder and hand (cumulative at the fingers = product) so the membrane root
  // is not pinched; one corrective pass on the hand because the span is not exactly linear in it.
  const spanLocal=(tune.spanWorld||SPAN_TARGET_WORLD)/DRAGON_SCALE;
  const wingScale=Math.min(1,spanLocal/(rawSpan*s));
  const wingChainScale={shoulder:Math.sqrt(wingScale),hand:Math.sqrt(wingScale)};
  for(const k of ['l_shoulder','r_shoulder'])boneScales.set(bones[k],wingChainScale.shoulder);
  for(const k of ['l_hand','r_hand'])boneScales.set(bones[k],wingChainScale.hand);
  let spanNow=sampleFlap().span;
  if(wingScale<1&&spanNow>0){
   wingChainScale.hand=THREE.MathUtils.clamp(wingChainScale.hand*spanLocal/spanNow,.3,1);
   for(const k of ['l_hand','r_hand'])boneScales.set(bones[k],wingChainScale.hand);
   spanNow=sampleFlap().span;
  }
  setPose(topT);

  // ---- tail: 30 bones; each bone scaled by the same factor a so the chain tapers smoothly
  //      (cumulative a^i) and the root -> tip length becomes TAIL_LENGTH_LOCAL.
  const tailBonesAll=[];
  for(let i=1;i<=60;i++){const b=bones['tail_'+String(i).padStart(2,'0')];if(!b)break;tailBonesAll.push(b);}
  const segLen=[];
  for(let i=0;i<tailBonesAll.length-1;i++)segLen.push(tailBonesAll[i].getWorldPosition(tA).distanceTo(tailBonesAll[i+1].getWorldPosition(tB)));
  const tailLenNow=segLen.reduce((x,y)=>x+y,0);
  const tailTarget=tune.tailLength||TAIL_LENGTH_LOCAL;
  let tailA=1;
  if(tailLenNow>tailTarget){
   const lengthAt=a=>{let L=0,c=1;for(let i=0;i<segLen.length;i++){c*=a;L+=segLen[i]*c;}return L;};
   let lo=.5,hi=1;
   for(let it=0;it<40;it++){const mid=(lo+hi)/2;if(lengthAt(mid)>tailTarget)hi=mid;else lo=mid;}
   tailA=(lo+hi)/2;
   for(const b of tailBonesAll)boneScales.set(b,tailA);
  }
  setPose(topT);

  // ---- dorsal spikes: the clip's saddle zone carries three 1.3 m spikes (spineSpike_02 at the
  //      pommel, _03 through the seat, _04 under the rider); collapse them like dragon.js keeps its
  //      dorsal ridge out of -0.3..+1.8. spineSpike_01 (1.6 units ahead) is kept, halved.
  for(const k of ['spineSpike_02','spineSpike_03','spineSpike_04'])if(bones[k])boneScales.set(bones[k],Math.max(1e-3,tune.saddleSpikes));
  if(bones.spineSpike_01)boneScales.set(bones.spineSpike_01,Math.max(1e-3,tune.frontSpike));
  setPose(topT);

  // ---- head + neck-tip shrink (after the rig scale, so the seat-to-head distance is NOT re-grown to
  //      compensate). The head bone and the last NECK_TAPER_BONES neck bones get a uniform scale
  //      (tune.headScale / tune.neckTaper in the rider view, the chase* twins in the chase view; see
  //      setRiderView). Applied before the anchors are measured so they land on the shrunken head.
  {
   headBone=bones.head;
   const nb=[];
   for(let i=1;i<=40;i++){const b=bones['neck_'+String(i).padStart(2,'0')];if(!b)break;nb.push(b);}
   taperBones=nb.slice(Math.max(0,nb.length-NECK_TAPER_BONES));
   applyViewScales();
   setPose(topT);
  }

  // ---- pelvis heave: the clip translates the pelvis (whole body) by 2.05 units over a flap at this
  //      scale; keep tune.bodyBob of it about the flap-mean position. Applied after every mixer step
  //      (the track has 316 keys so the mixer rewrites the bone each frame; when it does not, the
  //      previous clip value is restored first, the same guard applyFrameRotation uses).
  {
   const pelvis=bones.pelvis;
   const mean=new THREE.Vector3();
   for(let k=0;k<N;k++){mixer.setTime(beatSeconds*k/N);mean.add(pelvis.position);}
   mean.divideScalar(N);
   bobState={bone:pelvis,mean,clip:new THREE.Vector3(),result:new THREE.Vector3(),init:false};
   setPose(topT);
  }

  // ---- place the rig so the seat (top of the back above SEAT_BONE) lands on the classic saddle spot.
  // Top of the back near the seat: highest skinned vertex within |x|<.25 and |z-seatZ|<.5 (dragon-local);
  // vertices whose main bone is a dorsal spike are skipped, or the seat lands on a spike tip.
  function backTopAt(z,halfX,halfZ){
   let top=-1e9,n=0;
   const v=new THREE.Vector3();
   for(const m of meshes){
    if(!m.isSkinnedMesh)continue;
    const pos=m.geometry.attributes.position,si=m.geometry.attributes.skinIndex;
    const spike=m.skeleton.bones.map(b=>/spike/i.test(keys.get(b.name)||b.name));
    for(let k=0;k<pos.count;k++){
     if(spike[si.getX(k)])continue;
     m.getVertexPosition(k,v).applyMatrix4(m.matrixWorld);
     if(Math.abs(v.x)<halfX&&Math.abs(v.z-z)<halfZ){n++;if(v.y>top)top=v.y;}
    }
   }
   return {top,n};
  }
  {
   const sp=wp(SEAT_BONE);
   const {top,n}=backTopAt(sp.z,.25,.5);
   const topY=n?top:sp.y+.6*s;
   rig.position.add(tmp.set(0-sp.x,CLASSIC_SADDLE.y-SEAT_PAD-topY,CLASSIC_SADDLE.z-sp.z));
   setPose(topT);
   bounds.seatTopVerts=n;
  }

  // ---- measurements (dragon-local units at the wings-at-the-top pose; world = x1.6)
  const box=new THREE.Box3().setFromObject(rig,true),size=box.getSize(new THREE.Vector3());
  Object.assign(bounds,{
   rawSpan,rigScale:s,wingScale:wingChainScale,spanLocal:spanNow,spanWorld:spanNow*DRAGON_SCALE,tailBoneScale:tailA,tailLengthLocal:tailLenNow,
   bodyPitchDeg:bodyPitch*180/Math.PI,rigPitchDeg:rig.rotation.x*180/Math.PI,rigPosition:rig.position.toArray(),
   min:box.min.toArray(),max:box.max.toArray(),size:size.toArray(),sizeWorld:size.clone().multiplyScalar(DRAGON_SCALE).toArray(),
   head:wp('head').toArray(),neck01:wp('neck_01').toArray(),spine08:wp('spine_08').toArray(),spine07:wp('spine_07').toArray(),spine06:wp('spine_06').toArray(),
   spine04:wp('spine_04').toArray(),spine01:wp('spine_01').toArray(),hips:wp('hips').toArray(),tail01:wp('tail_01').toArray(),tail30:wp('tail_30').toArray(),
   lShoulder:wp('l_shoulder').toArray(),rShoulder:wp('r_shoulder').toArray(),lHand:wp('l_hand').toArray(),
   tipL:tipAt(0,new THREE.Vector3()).toArray(),tipR:tipAt(1,new THREE.Vector3()).toArray(),
   lEye:bones.l_eye?wp('l_eye').toArray():null,rEye:bones.r_eye?wp('r_eye').toArray():null,jaw:bones.jaw_01?wp('jaw_01').toArray():null,
   tris:meshes.reduce((n,m)=>n+(m.geometry.index?m.geometry.index.count:m.geometry.attributes.position.count)/3,0),meshes:meshes.length,
   clip:clip.name,clipDuration,beatSeconds,clipTopOffset
  });

  // ---- wings: left = the shoulder on -x
  const lx=bounds.lShoulder[0]<bounds.rShoulder[0];
  shoulderBones=lx?[bones.l_shoulder,bones.r_shoulder]:[bones.r_shoulder,bones.l_shoulder];
  handBones=lx?[bones.l_hand,bones.r_hand]:[bones.r_hand,bones.l_hand];
  if(!lx){tipBones.reverse();tipOffsets.reverse();}
  wings.length=0;wings.push(shoulderBones[0],shoulderBones[1]);

  // ---- neck chain (neck_01..neck_11 + head) and tail chain (tail_01..tail_30)
  torsoBone=bones.spine_08;
  neckChain=[];
  for(let i=1;i<=40;i++){const b=bones['neck_'+String(i).padStart(2,'0')];if(!b)break;neckChain.push(b);}
  neckChain.push(bones.head);
  neckBones.length=0;neckBones.push(...neckChain);
  tailChain=tailBonesAll.slice();
  tailRootBone=tailChain[0].parent;
  tailSegments.length=0;tailSegments.push(...tailChain);
  eyeBones=[bones.l_eye,bones.r_eye].filter(Boolean);
  follow.neck=Array.from({length:neckChain.length+1},()=>({yaw:0,pitch:0,roll:0}));
  follow.tail=Array.from({length:tailChain.length},()=>({yaw:0,pitch:0,roll:0}));
  // 30 tail bones instead of 9: keep the tip's settling time the same (9*.9^8 = 3.9 -> k^29 = .43).
  follow.gains.tailLagK=Math.pow(0.43,1/(tailChain.length-1));

  // ---- saddle anchor on SEAT_BONE at the classic saddle spot (world scale 1, like dragon.js's anchor)
  const seatWorld=CLASSIC_SADDLE.clone();
  const boneQ=seatBone.getWorldQuaternion(new THREE.Quaternion());
  const boneS=seatBone.getWorldScale(new THREE.Vector3()).x;   // dragon-local units per bone unit
  seatBone.add(saddleAnchor);
  saddleAnchor.position.copy(seatBone.worldToLocal(seatWorld.clone()));
  saddleAnchor.quaternion.copy(boneQ).invert();
  saddleAnchor.scale.setScalar(1/(boneS*DRAGON_SCALE));
  saddleBase.copy(saddleAnchor.position);
  saddleUp.set(0,1,0).applyQuaternion(_qb.copy(boneQ).invert());
  saddleUnit=1/boneS;
  Object.assign(bounds,{seatBone:seatBoneName,seatWorld:seatWorld.toArray(),boneScale:boneS,anchorLocal:saddleAnchor.position.toArray()});

  // ---- body profile measured from the skinned torso (dragon-local, wings-at-the-top pose):
  //      [z, half width, half height, centre height] per station, the same shape dragon.js's
  //      BODY_PROFILE has, so a rider rig can wrap girth straps around THIS back (model.profileAt).
  {
   const v=new THREE.Vector3();
   const zMin=wp('neck_01').z,zMax=wp('tail_01').z,step=.5;
   const stations=[];
   for(let z=zMin;z<=zMax+1e-6;z+=step)stations.push({z,w:0,top:-1e9,bot:1e9,n:0});
   for(const m of meshes){
    if(!m.isSkinnedMesh)continue;
    const pos=m.geometry.attributes.position,si=m.geometry.attributes.skinIndex;
    const body=m.skeleton.bones.map(b=>/^(spine_\d+|pelvis|hips|neck_0[12]|[lr]_clavicle)$/.test(keys.get(b.name)||boneKey(b.name)));
    for(let k=0;k<pos.count;k++){
     if(!body[si.getX(k)])continue;
     m.getVertexPosition(k,v).applyMatrix4(m.matrixWorld);
     const i=Math.round((v.z-zMin)/step);
     if(i<0||i>=stations.length)continue;
     const st=stations[i];st.n++;
     if(Math.abs(v.x)>st.w)st.w=Math.abs(v.x);
     if(v.y>st.top)st.top=v.y;if(v.y<st.bot)st.bot=v.y;
    }
   }
   bodyProfile=stations.filter(st=>st.n>=8).map(st=>[+st.z.toFixed(3),+st.w.toFixed(3),+((st.top-st.bot)/2).toFixed(3),+((st.top+st.bot)/2).toFixed(3)]);
   bounds.profile=bodyProfile;
  }

  // ---- head anchor (between the eyes) and bridle anchors (mouth corners), on the head bone
  const head=bones.head;
  const headQ=head.getWorldQuaternion(new THREE.Quaternion()),headS=head.getWorldScale(new THREE.Vector3()).x;
  const headPos=wp('head');
  const eyeMid=bounds.lEye&&bounds.rEye?new THREE.Vector3().fromArray(bounds.lEye).add(new THREE.Vector3().fromArray(bounds.rEye)).multiplyScalar(.5):headPos.clone();
  const jaw=bounds.jaw?new THREE.Vector3().fromArray(bounds.jaw):headPos.clone();
  const eyeHalf=bounds.lEye&&bounds.rEye?Math.abs(bounds.lEye[0]-bounds.rEye[0])*.5:.4;
  head.add(headAnchor);
  headAnchor.position.copy(head.worldToLocal(eyeMid.clone()));
  headAnchor.quaternion.copy(headQ).invert();
  headAnchor.scale.setScalar(1/headS);
  for(let i=0;i<2;i++){
   const side=i===0?-1:1;
   const p=new THREE.Vector3(side*eyeHalf*1.15,jaw.y-eyeHalf*.3,jaw.z-eyeHalf*.4);
   head.add(bridleAnchors[i]);
   bridleAnchors[i].position.copy(head.worldToLocal(p));
   bridleAnchors[i].quaternion.copy(headQ).invert();
   bridleAnchors[i].scale.setScalar(1/headS);
  }
  Object.assign(bounds,{headAnchor:eyeMid.toArray(),bridle:[bridleAnchors[0].getWorldPosition(new THREE.Vector3()).toArray(),bridleAnchors[1].getWorldPosition(new THREE.Vector3()).toArray()]});

  // ---- materials: one MeshStandardMaterial keeping the baked maps, rim light like dragon.js
  const maxAniso=Math.min(high?8:4,renderer.capabilities.getMaxAnisotropy());
  const texSize=budget.textureSize==='1k'?1024:4096;
  const srcMats=new Map();
  for(const m of meshes){
   const src=m.material;
   if(!srcMats.has(src)){
    bounds.srcMaterial={type:src.type,map:!!src.map,normalMap:!!src.normalMap,roughnessMap:!!src.roughnessMap,metalnessMap:!!src.metalnessMap,aoMap:!!src.aoMap,emissiveMap:!!src.emissiveMap,roughness:src.roughness,metalness:src.metalness,color:src.color.getHexString(),alphaTest:src.alphaTest,transparent:src.transparent,side:src.side,mapSize:src.map&&src.map.image?[src.map.image.width,src.map.image.height]:null};
    let map=src.map||null;
    if(map){map.anisotropy=maxAniso;if(texSize<4096)map=downscaleTexture(map,texSize);}
    let normalMap=src.normalMap||null;
    if(normalMap){normalMap.anisotropy=maxAniso;if(texSize<4096)normalMap=downscaleTexture(normalMap,texSize);}
    // The GLB is a glTF METALLIC material (metalness 1, bright base colour = the metal's specular
    // colour, a packed roughness/metalness texture, NO normal map). Rendered as a dielectric the
    // bright albedo bleaches under the sunset sun/HDRI, so: warm tint (0x8b5a45 keeps the red-brown,
    // a grey tint gave olive-khaki), roughness .92 (dragon.js skin runs at 1), envMapIntensity .35
    // (the HDRI specular was the cream wash with the sun ahead), the packed roughness map is
    // optional (tune.roughMap=1: its green channel is fairly dark, which is what made the specular).
    let roughnessMap=null;
    if(tune.roughMap&&src.roughnessMap){roughnessMap=src.roughnessMap;roughnessMap.anisotropy=maxAniso;if(texSize<4096)roughnessMap=downscaleTexture(roughnessMap,texSize);}
    const mat=new THREE.MeshStandardMaterial({
     color:tune.tint!==undefined?tune.tint:TUNE_DEFAULT.tint,map,normalMap,normalScale:new THREE.Vector2(1,1),
     roughness:tune.roughness!==undefined?tune.roughness:TUNE_DEFAULT.roughness,roughnessMap,metalness:0,side:THREE.DoubleSide,
     envMapIntensity:tune.envMapIntensity!==undefined?tune.envMapIntensity:TUNE_DEFAULT.envMapIntensity,
     alphaTest:tune.alphaTest!==undefined?tune.alphaTest:(src.alphaTest||0),transparent:false,
     aoMap:tune.ao===0?null:(src.aoMap||null),aoMapIntensity:.6,
     emissive:new THREE.Color(0x7a1a0e),emissiveIntensity:0
    });
    if(mat.aoMap)mat.aoMap.channel=src.aoMap.channel;
    mat.name='demon-skin';
    mat.onBeforeCompile=rimHook;
    mat.customProgramCacheKey=()=>'demon-skin-'+(high?'high':'phone');
    srcMats.set(src,mat);
   }
   m.material=srcMats.get(src);
   m.castShadow=true;m.receiveShadow=true;m.frustumCulled=false;
  }
  const skin=srcMats.values().next().value;
  materials.skin=materials.armor=materials.keratin=materials.membrane=skin;


  Object.assign(bounds,{trackedChainBones:[...neckChain,...tailChain,...shoulderBones,...handBones,...eyeBones].filter(b=>trackedQuat.has(b.name)).length,chainBones:neckChain.length+tailChain.length+4+eyeBones.length});

  // ---- swap the placeholder for the model
  dragon.remove(placeholder);
  placeholder.traverse(m=>{if(m.isMesh)m.geometry.dispose();});
  dragon.add(rig);
  ready=true;
  console.log('[dragon-gltf] demon dragon ready',JSON.stringify(bounds));
 }

 loadDemonDragon().then(g=>{
  try{install(g);}catch(e){console.error('[dragon-gltf] install failed',e);if(onError)onError(e);return;}
  if(onReady)onReady(model);
 },e=>{console.error('[dragon-gltf] load failed',e);if(onError)onError(e);});

 // ---- per-frame
 const _tailQ=new THREE.Quaternion();
 function update(pose,flight,l,r,time){
  const rawDt=lastTime===null?0:Math.max(0,time-lastTime);
  const dt=Math.min(.1,rawDt);
  lastTime=time;
  const yaw=flight.yaw||0,pitch=flight.pitch||0,roll=flight.roll||0;
  stepFollow(yaw,pitch,roll,dt,Math.max(rawDt,1e-3));
  if(hurtLeft>0){hurtLeft=Math.max(0,hurtLeft-dt);materials.skin.emissiveIntensity=0.9*hurtLeft/hurtDuration;}
  else if(materials.skin.emissiveIntensity!==0)materials.skin.emissiveIntensity=0;
  if(!ready)return;
  // 1. the clip: advance by one flap per wingbeat (pose.frequency is beats per second)
  const freq=pose.frequency||.77;
  animTime+=dt*freq*beatSeconds;
  applyViewScales();   // tune.headScale / neckTaper are live (dev page); cheap: 4 map writes
  if(wingAction.getEffectiveWeight()!==tune.wingAmp)wingAction.setEffectiveWeight(tune.wingAmp);
  if(neckAction.getEffectiveWeight()!==tune.neckAmp)neckAction.setEffectiveWeight(tune.neckAmp);
  if(torsoAction.getEffectiveWeight()!==tune.torsoAmp)torsoAction.setEffectiveWeight(tune.torsoAmp);
  mixer.setTime((animTime+clipTopOffset)%clipDuration);
  applyBoneScalesFn();
  // 2. wings: rider input, sweep boost and tip bend on top of the clip (dragon-frame rotations
  //    about the flap axis Z; positive lifts the wing on both sides like dragon.js).
  if(tune.noFollow){uRim.value=tune.rim;return;}   // debug: clip only, no additive chains
  for(let i=0;i<2;i++){
   const side=i===0?-1:1,input=i?r:l;
   const a=side*(pose.sweep*wingGains.sweep+input*wingGains.input+wingGains.rest);
   frameQuat(shoulderBones[i].parent,_pq);
   _R.setFromAxisAngle(_axisZ,a);
   applyFrameRotation(shoulderBones[i],_pq,_R);
   const b=side*pose.tip*wingGains.tip;
   frameQuat(handBones[i].parent,_pq);
   _R.setFromAxisAngle(_axisZ,b);
   applyFrameRotation(handBones[i],_pq,_R);
  }
  // 3. neck: head leads, each bone turns by its share (delta to the bone behind it) + a little sway
  frameQuat(torsoBone,_pq);
  const nSway=6/neckChain.length*(tune.sway!==undefined?tune.sway:1),nLast=neckChain.length-1;
  const neckExtend=viewTune('neckExtend'),extend=neckExtend/nLast;
  for(let i=0;i<neckChain.length;i++){
   const prev=follow.neck[i],cur=follow.neck[i+1];
   _euler.set(
    (cur.pitch-prev.pitch)+Math.sin(time*1.5-i*0.25)*0.008*nSway+(i<nLast?extend:-neckExtend*tune.headLevel),
    (cur.yaw-prev.yaw)+Math.sin(time*0.7-i*0.3)*0.02*nSway,
    (cur.roll-prev.roll),'YXZ');
   _R.setFromEuler(_euler);
   applyFrameRotation(neckChain[i],_pq,_R);
   _pq.multiply(neckChain[i].quaternion);
  }
  // 4. tail: lags the body the other way
  frameQuat(tailRootBone,_pq);
  const tSway=8/tailChain.length*(tune.sway!==undefined?tune.sway:1),droop=tune.tailDroop/tailChain.length;
  for(let i=0;i<tailChain.length;i++){
   const prev=i?follow.tail[i-1]:follow.tail[0],cur=follow.tail[i];
   _euler.set(
    (cur.pitch-prev.pitch)+(.019+Math.sin(time*1.5-i*.25)*.015)*tSway+droop,
    (cur.yaw-prev.yaw)+(Math.sin(time*1.25-i*.36)*.024-roll*.014)*tSway,
    (cur.roll-prev.roll),'YXZ');
   _R.setFromEuler(_euler);
   applyFrameRotation(tailChain[i],_pq,_R);
   _pq.multiply(tailChain[i].quaternion);
  }
  // 5. eyes glance into the turn
  if(eyeBones.length){
   _R.setFromAxisAngle(_axisY,THREE.MathUtils.clamp(-yaw*0.3,-.25,.25));
   for(const e of eyeBones){frameQuat(e.parent,_pq);applyFrameRotation(e,_pq,_R);}
  }
  // 6. breathing lifts the seat ~5 cm (dragon-local) like dragon.js
  uRim.value=tune.rim;
  const breath=Math.sin(time*0.25*TAU)*.5+.5;
  saddleAnchor.position.copy(saddleBase).addScaledVector(saddleUp,breath*0.05*saddleUnit);
 }

 // Cross-section of the demon's back at dragon-local z, {w: half width, h: half height, y: centre
 // height}, measured from the skinned torso at install (bounds.profile); the classic loft before that.
 function demonProfileAt(z){
  if(!bodyProfile||bodyProfile.length<2)return profileAt(z);
  return profileAt(z,bodyProfile);
 }
 // World position of wing i's tip (game.js draws streamers from it).
 function wingTip(i,pose){
  if(!ready)return dragon.localToWorld(CLASSIC_TIP[i].clone());
  return tipBones[i].localToWorld(tipOffsets[i].clone());
 }
 function setSun(direction,color){
  uSunDir.value.copy(direction).normalize();
  uSunColor.value.copy(color).multiplyScalar(3.2);
 }
 function setHurt(seconds){hurtLeft=hurtDuration=Math.max(.01,seconds);}
 function setWingGains(patch){Object.assign(wingGains,patch||{});}
 // Jump the wingbeat to a fraction of one flap (0 = wings at the top / start of the power stroke).
 function seekBeat(fraction){animTime=(fraction||0)*beatSeconds;}

 const model={
  dragon,wings,tailSegments,neckBones,saddleAnchor,headAnchor,bridleAnchors,
  materials,
  update,wingTip,setSun,setHurt,follow,setFollowGains,profileAt:demonProfileAt,
  // demon-only extras
  style:'demon',bounds,wingGains,setWingGains,tune,seekBeat,
  // setRiderView(true): rider-view head/neck shrink + neck bend (tune.headScale/neckTaper/neckExtend);
  // false: the chase* twins. game.js calls it from setCameraMode. Safe before the GLB is in.
  setRiderView,get riderView(){return riderView;},
  get ready(){return ready;},get mixer(){return mixer;},get rig(){return rig;},get animTime(){return animTime;},
  get clipTime(){return mixer?mixer.time:0;}
 };
 return model;
}
