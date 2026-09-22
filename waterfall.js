import * as THREE from './vendor/three.module.js';
import {EffectComposer} from './vendor/addons/postprocessing/EffectComposer.js';
import {RenderPass} from './vendor/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from './vendor/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from './vendor/addons/postprocessing/OutputPass.js';
import {RGBELoader} from './vendor/addons/loaders/RGBELoader.js';
import {createDragon} from './dragon-norberto.js';
import {createState, stepFlight, cameraPose, routeAt, segmentAt, ROUTE_LENGTH, clamp, getSpeedMultiplier, setSpeedMultiplier, SPEED_MULTIPLIER_MIN, SPEED_MULTIPLIER_MAX, createRings, createHazards} from './waterfall-core.js?v=1';

const $ = id => document.getElementById(id);
const centreAt = distance => routeAt(distance).x;
const regionAt = distance => segmentAt(distance).toUpperCase();
const state = createState(), input = {x:0,y:0}, keys = new Set();
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9cb6bc);
scene.fog = new THREE.FogExp2(0x9cb6bc, .0028);
const camera = new THREE.PerspectiveCamera(57, innerWidth / innerHeight, .3, 1300);
const debug = new URLSearchParams(location.search).has('debug');
let renderer, composer, model, clockTime = 0, frames = 0, animation, disposed = false;
const ownedTextures = [], ownedMaterials = [], ownedGeometry = [], ownedTargets = [];
const rings = createRings(), hazards = createHazards();
const ringObjects = [], hazardObjects = [];
const textureLoader = new THREE.TextureLoader();
const mobile = matchMedia('(pointer:coarse)').matches;
function texture(name, color = false, repeat = 1) {
  const tex = textureLoader.load(new URL('./assets/' + name, import.meta.url).href);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(repeat, repeat);
  if (color) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  ownedTextures.push(tex); return tex;
}
function material(settings) {const m = new THREE.MeshStandardMaterial(settings); ownedMaterials.push(m); return m;}
function geometry(g) {ownedGeometry.push(g);return g;}
function random(index) {const x = Math.sin(index * 127.1 + 311.7) * 43758.5453123;return x - Math.floor(x);}
function rockDetail(x,y,z) {
  return Math.sin(x*.117+y*.072+z*.033)*2.7 + Math.sin(x*.37-y*.12+z*.083)*1.3 + Math.sin(x*.81+y*.33-z*.21)*.48;
}
function rockWall(side, rock) {
  const positions=[],uv=[],indices=[],colors=[],rows=16,cols=240;
  for(let j=0;j<=cols;j++) {
    const d=-140+j*(ROUTE_LENGTH+500)/cols;
    const rim=115+Math.sin(d*.027)*28+Math.sin(d*.081)*13;
    for(let i=0;i<=rows;i++) {
      const t=i/rows,y=-14+t*rim;
      const base=58+Math.pow(t,1.4)*34;
      const edge=base+rockDetail(side*base,y,d)*1.8+Math.sin(d*.052+t*8)*5;
      positions.push(centreAt(d)+side*edge,y,-d);
      uv.push(d*.025,y*.025);
      const tint=.75+random(j*31+i)*.2;colors.push(tint*.81,tint*.9,tint);
      // The hollow has its own enclosing rock. Canyon walls must not slice
      // through its larger interior or protrude through the crystal clusters.
      if(i<rows&&j<cols&&(d<630||d>1320)) {const a=j*(rows+1)+i,b=a+rows+1;indices.push(a,b,a+1,b,b+1,a+1);}
    }
  }
  const g=geometry(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setIndex(indices);g.computeVertexNormals();
  const wall=new THREE.Mesh(g,rock);wall.castShadow=true;wall.receiveShadow=true;scene.add(wall);
}
function arch(distance, radius, rock, seed) {
  const g=geometry(new THREE.TorusGeometry(radius,11,9,46,Math.PI));
  const p=g.attributes.position;
  for(let i=0;i<p.count;i++) {
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i),n=rockDetail(x+seed,y,z+distance)*.8;
    p.setXYZ(i,x+n,y+n*.6,z+Math.sin(x*.13+y*.18)*3+n);
  }
  g.computeVertexNormals();const m=new THREE.Mesh(g,rock);m.position.set(centreAt(distance),-4,-distance);m.castShadow=true;m.receiveShadow=true;scene.add(m);
}
function tunnel(rock) {
  const positions=[],uv=[],indices=[],rings=75,sides=42,start=625,length=710;
  for(let j=0;j<=rings;j++)for(let i=0;i<=sides;i++) {
    const d=start+j*length/rings,a=i/sides*Math.PI*2;
    const r=76+Math.sin(a*7+d*.025)*3+Math.sin(d*.091+a*3)*2;
    positions.push(centreAt(d)+Math.cos(a)*r,28+Math.sin(a)*r,-d);uv.push(i/sides*11,d*.025);
    if(j<rings&&i<sides) {const n=j*(sides+1)+i,k=n+sides+1;indices.push(n,n+1,k,n+1,k+1,k);}
  }
  const g=geometry(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();
  const shell=new THREE.Mesh(g,rock);shell.receiveShadow=true;scene.add(shell);
  const crystalGeo=geometry(new THREE.LatheGeometry([new THREE.Vector2(0,-4),new THREE.Vector2(1,-3.8),new THREE.Vector2(1.1,2),new THREE.Vector2(0,4)],6));
  const palette=[0x35ddec,0x945bf4,0xf6b767];const object=new THREE.Object3D();
  for(let group=0;group<3;group++) {
    const body=new THREE.Color(palette[group]).multiplyScalar(.38);
    const mat=material({color:body,emissive:palette[group],emissiveIntensity:.1,metalness:.65,roughness:.12,envMapIntensity:2.4,flatShading:true});
    const tipMaterial=material({color:palette[group],emissive:palette[group],emissiveIntensity:2.2,roughness:.16,metalness:.35});
    const crystals=new THREE.InstancedMesh(crystalGeo,mat,170);crystals.name=['Cyan crystals','Amethyst crystals','Amber crystals'][group];
    const tips=new THREE.InstancedMesh(crystalGeo,tipMaterial,170);tips.name=crystals.name+' glints';
    for(let i=0;i<170;i++) {
      const seed=i*9+group*1700,cluster=Math.floor(i/5)*9+group*1700;
      const d=685+random(cluster)*585+(random(seed+5)-.5)*16,a=random(cluster+1)*Math.PI*2+(random(seed+6)-.5)*.28,r=72+random(seed+2)*4;
      object.position.set(centreAt(d)+Math.cos(a)*r,28+Math.sin(a)*r,-d);
      const direction=new THREE.Vector3(-Math.cos(a)+(random(seed+7)-.5)*.32,-Math.sin(a)+(random(seed+8)-.5)*.32,.65*(random(seed+3)-.5)).normalize();
      object.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction);
      const s=.45+Math.pow(random(seed+4),1.4)*2.35;object.scale.set(.5+s*.35,s,.6+s*.2);object.updateMatrix();crystals.setMatrixAt(i,object.matrix);
      // A small bright tip gives a glint without turning the whole crystal
      // into a flat glowing rod. The larger body keeps its reflected facets.
      object.position.addScaledVector(direction,s*3.7);object.scale.set(.16+s*.045,.11+s*.025,.18+s*.035);object.updateMatrix();tips.setMatrixAt(i,object.matrix);
    }
    crystals.instanceMatrix.needsUpdate=true;tips.instanceMatrix.needsUpdate=true;scene.add(crystals,tips);
  }
}
function buildCourse() {
  const ringGeometry=geometry(new THREE.TorusGeometry(13.5,.18,8,64)), ringMaterial=material({color:0x9fffe8,emissive:0x38d8ba,emissiveIntensity:1.8,metalness:.35,roughness:.25});
  const haloGeometry=geometry(new THREE.TorusGeometry(13.5,.7,6,64)), haloMaterial=material({color:0x58ffe0,transparent:true,opacity:.08,depthWrite:false,blending:THREE.AdditiveBlending});
  for (const ring of rings) {
    const group=new THREE.Group(), main=new THREE.Mesh(ringGeometry,ringMaterial), halo=new THREE.Mesh(haloGeometry,haloMaterial);
    const p=routeAt(ring.distance);group.position.set(p.x,p.y,p.z);group.rotation.set(ring.pitch,0,0);scene.add(group);ringObjects.push({group,ring});
  }
  const crystalGeometry=geometry(new THREE.ConeGeometry(1,2,6)), crystalMaterial=material({color:0x5b2e9d,emissive:0x4c1ec0,emissiveIntensity:1.5,metalness:.4,roughness:.18});
  for (const hazard of hazards) {
    const p=routeAt(hazard.distance);const mesh=new THREE.Mesh(crystalGeometry,crystalMaterial);mesh.position.set(p.x+(hazard.x-p.x),hazard.altitude,p.z);mesh.scale.set(hazard.radius,hazard.height,hazard.radius);mesh.rotation.z=(hazard.index%2?-.18:.18);mesh.castShadow=true;scene.add(mesh);hazardObjects.push({mesh,hazard});
  }
}
function updateCourse() {
  for (const item of ringObjects) { const relative=item.ring.distance-state.distance;item.group.visible=!item.ring.caught&&relative>-90&&relative<420; }
  for (const item of hazardObjects) { const relative=item.hazard.distance-state.distance;item.mesh.visible=relative>-120&&relative<430; }
  for (const item of ringObjects) {
    const relative=item.ring.distance-state.distance;
    if(!item.ring.caught&&relative<0) {
      item.ring.caught=true;
      if(Math.hypot(state.x-(item.ring.x-centreAt(item.ring.distance)),state.altitude-item.ring.altitude)<14) state.rings++;
    }
  }
  for (const item of hazardObjects) {
    const relative=item.hazard.distance-state.distance;
    if(relative<8&&relative>-8&&!item.hazard.hit&&Math.hypot(state.x-(item.hazard.x-centreAt(item.hazard.distance)),state.altitude-item.hazard.altitude)<item.hazard.radius+3) { item.hazard.hit=true;state.hits++;state.x=clamp(state.x-(item.hazard.x>centreAt(item.hazard.distance)?6:-6),-34,34); }
  }
}
function buildWaterfallFeatures(){
  const p=routeAt((2700+3700)/2),waterMat=material({color:0x58e8ff,emissive:0x1aaee8,emissiveIntensity:1.3,transparent:true,opacity:.62,roughness:.08,metalness:.1,side:THREE.DoubleSide});
  const sheet=geometry(new THREE.PlaneGeometry(260,360,16,24));const water=new THREE.Mesh(sheet,waterMat);water.position.set(p.x,102,p.z);scene.add(water);
  for(const [width,opacity,offset] of [[180,.22,-80],[120,.3,65],[80,.36,0]]){const m=material({color:0xb6fbff,emissive:0x39d6ff,emissiveIntensity:1.1,transparent:true,opacity,depthWrite:false,side:THREE.DoubleSide});const g=geometry(new THREE.PlaneGeometry(width,330,8,18));const spray=new THREE.Mesh(g,m);spray.position.set(p.x+offset,102,p.z-1);spray.rotation.y=(offset/260)*.35;scene.add(spray);}
  const pool=material({color:0x42d9ec,emissive:0x0b91bd,emissiveIntensity:.7,transparent:true,opacity:.48,roughness:.12,metalness:.18});const basin=new THREE.Mesh(geometry(new THREE.CylinderGeometry(120,145,8,48)),pool);basin.position.set(p.x,10,p.z+10);scene.add(basin);
  const cliff=material({color:0x374b55,roughness:.92,metalness:.02});for(const side of [-1,1]){const rock=new THREE.Mesh(geometry(new THREE.IcosahedronGeometry(105,2)),cliff);rock.scale.set(.75,1.35,.8);rock.position.set(p.x+side*145,92,p.z);scene.add(rock);}
}
function buildWater() {
  const normal=texture('water_normal_512.png',false);
  const water=material({color:0x086573,metalness:.2,roughness:.18,normalMap:normal,normalScale:new THREE.Vector2(.65,.65),envMapIntensity:1.4});
  normal.repeat.set(16,190);
  const river=new THREE.Mesh(geometry(new THREE.PlaneGeometry(210,ROUTE_LENGTH+800,1,1)),water);river.rotation.x=-Math.PI/2;river.position.set(0,-.5,-ROUTE_LENGTH/2);river.receiveShadow=true;scene.add(river);
  return normal;
}
function buildSky() {
  const skyMat=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:{uTunnel:{value:0}},vertexShader:'varying vec3 vDir; void main(){vDir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:`varying vec3 vDir;uniform float uTunnel;void main(){vec3 d=normalize(vDir);float up=smoothstep(-.04,.8,d.y);vec3 c=mix(vec3(.66,.77,.79),vec3(.18,.32,.38),up);float cloud=sin(d.x*21.+d.z*15.+sin(d.z*37.)*.7)*sin(d.x*47.-d.z*23.);c+=cloud*.022;float sun=pow(max(dot(d,normalize(vec3(-.2,.22,-1.))),0.),150.);c+=sun*vec3(.32,.36,.33);gl_FragColor=vec4(c*(1.-uTunnel*.45),1.);#include <colorspace_fragment>}`.replace(';#include',';\n#include')});
  ownedMaterials.push(skyMat);const sky=new THREE.Mesh(geometry(new THREE.SphereGeometry(1100,24,16)),skyMat);scene.add(sky);return sky;
}
function showError(error) {$('error').hidden=false;$('error').textContent='The scene could not start. '+error.message;$('start').textContent='Scene unavailable';console.error(error);}
try {
  renderer=new THREE.WebGLRenderer({canvas:$('scenic-canvas'),antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,mobile?1.5:1.75));renderer.setSize(innerWidth,innerHeight);
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.03;
  renderer.shadowMap.enabled=!mobile;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  composer=new EffectComposer(renderer);composer.addPass(new RenderPass(scene,camera));
  const bloom=new UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight),.27,.6,1.05);composer.addPass(bloom);composer.addPass(new OutputPass());
  const hemi=new THREE.HemisphereLight(0xbadce2,0x19353e,2.5);scene.add(hemi);
  const sun=new THREE.DirectionalLight(0xe3f0e7,3.2);sun.position.set(-80,130,-180);sun.castShadow=!mobile;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-100;sun.shadow.camera.right=100;sun.shadow.camera.top=100;sun.shadow.camera.bottom=-100;sun.shadow.camera.near=20;sun.shadow.camera.far=450;sun.shadow.bias=-.0005;sun.shadow.normalBias=.12;sun.shadow.radius=3;scene.add(sun,sun.target);
  const fill=new THREE.DirectionalLight(0x83c9e5,1.8);scene.add(fill,fill.target);
  const nearLight=new THREE.PointLight(0x86dcfa,0,190,1.2),nextLight=new THREE.PointLight(0xbc70f9,0,190,1.2),warmLight=new THREE.PointLight(0xffa34f,0,190,1.2);scene.add(nearLight,nextLight,warmLight);
  const diff=texture('cliff_side_diff_2k.jpg',true),nor=texture('cliff_side_nor_gl_2k.jpg'),arm=texture('cliff_side_arm_2k.jpg');
  const rock=material({color:0x8b9e9f,map:diff,normalMap:nor,normalScale:new THREE.Vector2(1.5,1.5),roughnessMap:arm,roughness:.85,metalness:.03,side:THREE.DoubleSide,vertexColors:true});
  rockWall(-1,rock);rockWall(1,rock);
  const solidRock=rock.clone();solidRock.vertexColors=false;ownedMaterials.push(solidRock);
  arch(300,96,solidRock,1);arch(610,96,solidRock,2);arch(1370,98,solidRock,3);
  const caveRock=solidRock.clone();caveRock.color.set(0x33304c);caveRock.roughness=.6;ownedMaterials.push(caveRock);tunnel(caveRock);buildCourse();buildWaterfallFeatures();
  const waterNormal=buildWater(),sky=buildSky();
  const envLoader=new RGBELoader();envLoader.load(new URL('./assets/'+(mobile?'kiara_8_sunset_1k.hdr':'kiara_8_sunset_2k.hdr'),import.meta.url).href,tex=>{if(disposed){tex.dispose();return;}tex.mapping=THREE.EquirectangularReflectionMapping;const pmrem=new THREE.PMREMGenerator(renderer);const target=pmrem.fromEquirectangular(tex);scene.environment=target.texture;scene.environmentIntensity=.32;ownedTargets.push(target);tex.dispose();pmrem.dispose();});
  model=createDragon(renderer);scene.add(model.dragon);model.setRiderView(false);
  model.loading.then(()=>{if(model.error){showError(model.error);return;}$('start').disabled=false;$('start').textContent='Take flight';});
  function position() {
    const route=routeAt(state.distance),x=route.x+state.x;
    model.dragon.position.set(x,state.altitude,route.z);model.dragon.rotation.set(state.pitch,state.roll*.25,state.roll,'YXZ');
    const pose=cameraPose(state,camera.aspect);camera.position.set(pose.position.x,pose.position.y,pose.position.z);camera.lookAt(pose.target.x,pose.target.y,pose.target.z);
    camera.up.set(-state.roll*.08,1,0);
    sky.position.copy(camera.position);
    const tunnelAmount=segmentAt(state.distance)==='waterfall descent'?0.15:0;
    scene.fog.color.set(0x9cb6bc).lerp(new THREE.Color(0x17415a),tunnelAmount);scene.fog.density=.0028+tunnelAmount*.001;
    sky.material.uniforms.uTunnel.value=tunnelAmount;hemi.intensity=2.5-tunnelAmount*.4;sun.intensity=3.2-tunnelAmount*.7;fill.intensity=1.8;scene.environmentIntensity=.32+tunnelAmount*.08;
    sun.position.set(x-75,state.altitude+110,route.z-150);sun.target.position.set(x,0,route.z-25);
    fill.position.set(x+20,state.altitude+30,route.z+35);fill.target.position.copy(model.dragon.position);
    const near=routeAt(state.distance+5),next=routeAt(state.distance+65),warm=routeAt(state.distance+125);nearLight.position.set(near.x-30,near.y+25,near.z);nextLight.position.set(next.x+33,next.y+35,next.z);warmLight.position.set(warm.x,warm.y-18,warm.z);
    nearLight.intensity=95*tunnelAmount;nextLight.intensity=145*tunnelAmount;warmLight.intensity=130*tunnelAmount;
    $('region').textContent=regionAt(state.distance);$('progress').style.width=(state.distance/ROUTE_LENGTH*100)+'%';
  }
  function syncUI() {
    $('welcome').hidden=state.mode!=='ready';$('pause-panel').hidden=!['paused','complete'].includes(state.mode);$('pause').hidden=!['flying','paused'].includes(state.mode);$('pause').textContent=state.mode==='paused'?'Resume':'Pause';
    $('pause-title').innerHTML=state.mode==='complete'?'One more<br>flight?':'A moment<br>to breathe.';$('resume').hidden=state.mode==='complete';$('steer-hint').hidden=state.mode!=='flying';
  }
  function syncSettings() {
    $('slow-speed').value=String(getSpeedMultiplier());$('slow-speed-value').textContent=getSpeedMultiplier().toFixed(1).replace('.0','')+'x';
    try{$('slow-graphics').value=localStorage.getItem('dragonfall-slow-graphics')||'auto';}catch{}
  }
  function applyGraphics(value) {
    const ratio=value==='phone'?1.15:value==='high'?1.9:Math.min(devicePixelRatio,mobile?1.5:1.75);
    renderer.setPixelRatio(ratio);renderer.shadowMap.enabled=value!=='phone'&&!mobile;renderer.setSize(innerWidth,innerHeight);composer.setSize(innerWidth,innerHeight);
    try{localStorage.setItem('dragonfall-slow-graphics',value);}catch{}
  }
  function clearInput(){input.x=input.y=0;keys.clear();drag=null;$('joystick').hidden=true;}
  function start(){if(!model.ready)return;state.mode='flying';$('credits').open=false;syncUI();}
  function pause(){if(state.mode==='flying'){state.mode='paused';clearInput();}else if(state.mode==='paused')state.mode='flying';syncUI();}
  function restart(){Object.assign(state,createState());for(const item of ringObjects){item.ring.caught=false;}for(const item of hazardObjects){item.hazard.hit=false;}clearInput();position();start();}
  $('start').addEventListener('click',start);$('pause').addEventListener('click',pause);$('resume').addEventListener('click',pause);$('restart').addEventListener('click',restart);
  $('settings').addEventListener('click',()=>{$('settings-panel').hidden=!$('settings-panel').hidden;syncSettings();});$('close-settings').addEventListener('click',()=>{$('settings-panel').hidden=true;});
  $('slow-speed').addEventListener('input',()=>{setSpeedMultiplier($('slow-speed').value);syncSettings();});$('slow-graphics').addEventListener('change',()=>applyGraphics($('slow-graphics').value));
  let drag=null;
  $('scenic-canvas').addEventListener('pointerdown',event=>{if(state.mode!=='flying'||event.button!==0)return;event.preventDefault();drag={id:event.pointerId,x:event.clientX,y:event.clientY};event.target.setPointerCapture(event.pointerId);$('joystick').hidden=false;$('joystick').style.left=(event.clientX-40)+'px';$('joystick').style.top=(event.clientY-40)+'px';});
  $('scenic-canvas').addEventListener('pointermove',event=>{if(!drag||drag.id!==event.pointerId)return;input.x=clamp((event.clientX-drag.x)/85,-1,1);input.y=clamp((drag.y-event.clientY)/85,-1,1);$('joystick').firstElementChild.style.transform=`translate(${input.x*28}px,${-input.y*28}px)`;});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])$('scenic-canvas').addEventListener(type,()=>clearInput());
  addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' ','Escape'].includes(event.key)){event.preventDefault();if([' ','Escape'].includes(event.key)){if(!event.repeat){if(state.mode==='ready')start();else if(state.mode==='complete')restart();else pause();}}else keys.add(event.key);}});
  addEventListener('keyup',event=>keys.delete(event.key));
  addEventListener('blur',()=>{if(state.mode==='flying')pause();});document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.mode==='flying')pause();});
  addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);composer.setSize(innerWidth,innerHeight);position();});
  let previous=performance.now();
  function frame(now){if(disposed)return;const dt=Math.min(.05,(now-previous)/1000);previous=now;clockTime+=dt;frames++;
    const control=drag?input:{x:Number(keys.has('ArrowRight'))-Number(keys.has('ArrowLeft')),y:Number(keys.has('ArrowUp'))-Number(keys.has('ArrowDown'))};
    const old=state.mode;stepFlight(state,control,dt);if(state.mode==='flying')updateCourse();if(old!==state.mode)syncUI();
    // Paused flight freezes the visible movement; ready screen keeps its wings alive.
    if(state.mode==='flying'||state.mode==='ready'){model.update({frequency:.66},state,0,0,state.mode==='ready'?clockTime:state.elapsed);waterNormal.offset.y=clockTime*.007;}
    position();composer.render();animation=requestAnimationFrame(frame);
  }
  position();syncUI();syncSettings();try{applyGraphics(localStorage.getItem('dragonfall-slow-graphics')||'auto');}catch{applyGraphics('auto');}animation=requestAnimationFrame(frame);
  function dispose(){if(disposed)return;disposed=true;cancelAnimationFrame(animation);model.dispose();for(const x of ownedTextures)x.dispose();for(const x of ownedMaterials)x.dispose();for(const x of ownedGeometry)x.dispose();for(const x of ownedTargets)x.dispose();for(const pass of composer.passes)pass.dispose?.();composer.dispose();renderer.dispose();}
  addEventListener('pagehide',event=>{if(!event.persisted)dispose();});
  if(debug)window.__scenic={scene,camera,renderer,composer,model,state,input,start,pause,restart,position,get frames(){return frames;},setDistance(d){state.distance=clamp(d,0,ROUTE_LENGTH);position();},dispose};
} catch(error){showError(error);}
