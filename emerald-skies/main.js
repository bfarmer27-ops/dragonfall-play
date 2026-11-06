import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {RGBELoader} from 'three/addons/loaders/RGBELoader.js';
import {createWorld} from './world.js';
import {createControls} from './controls.js';
import {newFlight,stepFlight,clamp} from './flight.js';

const $=id=>document.getElementById(id);
const VERSION='emerald-skies-2026-11-06';
let settings={mode:'one',quality:'auto',invert:false,sensitivity:1};
let best=0;
try{settings={...settings,...JSON.parse(localStorage.getItem('dragonfall-emerald-settings')||'{}')};best=Number(localStorage.getItem('dragonfall-emerald-best'))||0;}catch{}
if(!['one','two'].includes(settings.mode))settings.mode='one';
if(!['auto','phone','high'].includes(settings.quality))settings.quality='auto';
settings.sensitivity=clamp(Number(settings.sensitivity)||1,.5,2);
let renderer,scene,camera,world,dragon,mixer,ready=false,mode='intro',state=newFlight(),time=0;
let last=performance.now(),hudAt=0,frameN=0,frameMs=0,adaptiveAt=0,ratio=1;
const input={x:0,y:0},center=new T.Vector3(),ahead=new T.Vector3(),cameraGoal=new T.Vector3(),look=new T.Vector3();
const metrics={version:VERSION,frames:0,totalFrames:0,drawCalls:0,triangles:0,geometries:0,textures:0,frameMs:0,ratio:1,ready:false};
const samples=new Float32Array(600);let sampleIndex=0,sampleCount=0;
const controls=createControls({single:$('single-pad'),left:$('left-pad'),right:$('right-pad')});
const ringPool=[];let sun,sky;
function configure(){
 controls.configure(settings);document.body.dataset.controls=settings.mode;
 $('control-mode').value=settings.mode;$('quality').value=settings.quality;$('invert').checked=settings.invert;$('sensitivity').value=settings.sensitivity;
 document.querySelectorAll('[data-control-mode]').forEach(b=>{b.classList.toggle('is-selected',b.dataset.controlMode===settings.mode);b.setAttribute('aria-pressed',String(b.dataset.controlMode===settings.mode));});
 const output=document.querySelector('output[for="sensitivity"]');if(output)output.textContent=settings.sensitivity.toFixed(1)+'×';
 try{localStorage.setItem('dragonfall-emerald-settings',JSON.stringify(settings));}catch{}
 resize();
}
function setMode(next){
 mode=next;document.body.dataset.mode=next;
 $('welcome').hidden=next!=='intro';$('pause-screen').hidden=next!=='paused';$('game-over').hidden=next!=='over';
 $('thumb-controls').hidden=next!=='flying';$('pause').disabled=!ready||next==='intro'||next==='over';
 if(next!=='flying')controls.reset();
 if(gain&&audio)gain.gain.setTargetAtTime(soundOn&&next==='flying'?.07:0,audio.currentTime,.3);
}
function reset(){state=newFlight();time=0;controls.reset();for(let i=0;i<ringPool.length;i++)placeRing(ringPool[i],i);world.update(0,0);pose(1);hud();}
function start(){if(!ready)return;reset();setMode('flying');}
function pause(){if(mode==='flying')setMode('paused');else if(mode==='paused')setMode('flying');}
function hud(){
 $('distance').textContent=Math.floor(state.distance).toLocaleString()+' m';$('rings').textContent=state.rings;
 $('best').textContent=Math.floor(best).toLocaleString()+' m';$('speed').textContent=Math.round(state.speed*3.6)+' km/h';
 $('health').textContent='◆'.repeat(Math.max(0,state.health))+'◇'.repeat(3-Math.max(0,state.health));
 $('health').setAttribute('aria-label',`${state.health} shields remaining`);
}
let toastTimer;
function toast(text){$('toast').textContent=text;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),1600);}
function end(){
 best=Math.max(best,state.distance);try{localStorage.setItem('dragonfall-emerald-best',String(Math.floor(best)));}catch{}
 $('final-distance').textContent=Math.floor(state.distance).toLocaleString();$('final-rings').textContent=state.rings;setMode('over');hud();
}
function resize(){
 if(!renderer)return;const phone=settings.quality==='phone'||settings.quality==='auto'&&(matchMedia('(pointer:coarse)').matches||innerWidth<800);
 ratio=Math.min(devicePixelRatio,phone?1.25:1.5);renderer.setPixelRatio(ratio);renderer.setSize(innerWidth,innerHeight);
 camera.aspect=innerWidth/innerHeight;camera.fov=innerHeight>innerWidth?64:55;camera.updateProjectionMatrix();
 renderer.shadowMap.enabled=!phone;adaptiveAt=time+8;
}
function pose(dt){
 world.route(state.distance,center);world.route(state.distance+55,ahead);
 dragon.position.set(center.x+state.x,center.y+state.y,center.z);
 const yaw=Math.atan2(-(ahead.x-center.x),-(ahead.z-center.z));
 dragon.rotation.set(state.vy*.008,yaw-state.vx*.005,-state.vx*.014,'YXZ');
 const dist=innerHeight>innerWidth?62:31;
 cameraGoal.set(dragon.position.x+Math.sin(yaw)*dist,dragon.position.y+10,dragon.position.z+Math.cos(yaw)*dist);
 const a=dt>=1?1:1-Math.exp(-6*dt);camera.position.lerp(cameraGoal,a);
 look.set(dragon.position.x-Math.sin(yaw)*22,dragon.position.y+5,dragon.position.z-Math.cos(yaw)*22);camera.lookAt(look);
 sky.position.copy(camera.position);
 sun.position.set(center.x-150,center.y+220,center.z+70);sun.target.position.copy(dragon.position);
}
function placeRing(ring,n){
 ring.userData.n=n;ring.userData.distance=150+n*105;ring.userData.passed=false;
 world.route(ring.userData.distance,ring.position);
 ring.position.x+=Math.sin(n*.73)*23;ring.position.y+=Math.sin(n*.49)*10+2;
 world.route(ring.userData.distance+5,ahead);ring.rotation.y=Math.atan2(-(ahead.x-(ring.position.x-Math.sin(n*.73)*23)),5);
 ring.visible=true;
}
function buildRings(){
 const geometry=new T.TorusGeometry(7,.19,8,72);
 const material=new T.MeshStandardMaterial({color:0xffd484,emissive:0xffa940,emissiveIntensity:1.5,metalness:.65,roughness:.3});
 for(let i=0;i<12;i++){const ring=new T.Mesh(geometry,material);scene.add(ring);ringPool.push(ring);placeRing(ring,i);}
}
function ringsTick(previous){
 for(const ring of ringPool){const d=ring.userData.distance;
  if(!ring.userData.passed&&previous<d&&state.distance>=d){
   ring.userData.passed=true;
   if(Math.hypot(dragon.position.x-ring.position.x,dragon.position.y-ring.position.y)<7.8){state.rings++;ring.visible=false;toast(`Ring ${state.rings} · clean flight`);chime();}
  }
  if(d<state.distance-60)placeRing(ring,ring.userData.n+ringPool.length);
 }
}
let audio,gain,soundOn=false;
function toggleSound(){
 try{if(!audio){audio=new(window.AudioContext||window.webkitAudioContext)();gain=audio.createGain();gain.gain.value=0;gain.connect(audio.destination);
 const b=audio.createBuffer(1,audio.sampleRate*3,audio.sampleRate),data=b.getChannelData(0);let v=0;for(let i=0;i<data.length;i++){v=(v+(Math.random()*2-1)*.025)/1.025;data[i]=v;}
 const src=audio.createBufferSource();src.buffer=b;src.loop=true;const filter=audio.createBiquadFilter();filter.type='lowpass';filter.frequency.value=900;src.connect(filter);filter.connect(gain);src.start();}
 audio.resume();soundOn=!soundOn;gain.gain.setTargetAtTime(soundOn&&mode==='flying'?.07:0,audio.currentTime,.3);$('sound').textContent=soundOn?'Sound on':'Sound off';$('sound').setAttribute('aria-pressed',String(soundOn));}catch{toast('Sound is unavailable in this browser.');}
}
function chime(){if(!soundOn||!audio)return;const o=audio.createOscillator(),g=audio.createGain();o.type='sine';o.frequency.setValueAtTime(660,audio.currentTime);o.frequency.exponentialRampToValueAtTime(990,audio.currentTime+.16);g.gain.setValueAtTime(.035,audio.currentTime);g.gain.exponentialRampToValueAtTime(.0001,audio.currentTime+.5);o.connect(g);g.connect(audio.destination);o.start();o.stop(audio.currentTime+.5);o.onended=()=>{o.disconnect();g.disconnect();};}
$('start').onclick=start;$('restart').onclick=start;$('again').onclick=start;$('resume').onclick=pause;$('pause').onclick=pause;$('sound').onclick=toggleSound;
const dialog=$('settings');let resumeSettings=false;
$('settings-open').onclick=()=>{resumeSettings=mode==='flying';if(resumeSettings)setMode('paused');dialog.showModal();};
 document.querySelectorAll('[data-open-settings]').forEach(b=>b.onclick=$('settings-open').onclick);
dialog.addEventListener('close',()=>{controls.reset();if(resumeSettings&&mode==='paused')setMode('flying');resumeSettings=false;});
for(const id of ['control-mode','quality','invert','sensitivity'])$(id).addEventListener('change',()=>{settings={mode:$('control-mode').value,quality:$('quality').value,invert:$('invert').checked,sensitivity:Number($('sensitivity').value)};configure();});
document.querySelectorAll('[data-control-mode]').forEach(b=>b.onclick=()=>{settings.mode=b.dataset.controlMode;configure();});
window.addEventListener('keydown',e=>{if(dialog.open)return;if(e.code==='Escape'||e.code==='KeyP')pause();if(e.code==='KeyR')start();});
window.addEventListener('resize',resize);window.addEventListener('blur',()=>{if(mode==='flying')setMode('paused');});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&mode==='flying')setMode('paused');last=performance.now();});
$('view').addEventListener('webglcontextlost',e=>{e.preventDefault();setMode('paused');toast('Graphics paused. Reload to restore the display.');});
async function init(){
 try{
 renderer=new T.WebGLRenderer({canvas:$('view'),antialias:true,powerPreference:'high-performance'});
 renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;renderer.shadowMap.type=T.PCFSoftShadowMap;
 scene=new T.Scene();scene.fog=new T.FogExp2(0xb7c9bd,.00165);camera=new T.PerspectiveCamera(55,innerWidth/innerHeight,.5,2800);
 scene.add(new T.HemisphereLight(0xd8ece9,0x3d503c,2.1));sun=new T.DirectionalLight(0xffe2ad,3.2);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-85,right:85,top:85,bottom:-85,near:1,far:420});sun.shadow.normalBias=.6;scene.add(sun,sun.target);
 const fill=new T.DirectionalLight(0x9ddad8,.9);fill.position.set(30,50,100);scene.add(fill);
 sky=new T.Mesh(new T.SphereGeometry(2200,32,16),new T.ShaderMaterial({side:T.BackSide,depthWrite:false,uniforms:{},vertexShader:'varying vec3 v;void main(){v=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:`
 varying vec3 v;
 float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
 float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
 float fbm(vec2 p){return noise(p)*.5+noise(p*2.03)*.25+noise(p*4.01)*.125+noise(p*8.07)*.0625;}
 void main(){
 vec3 d=normalize(v);float h=smoothstep(-.06,.8,d.y);
 vec3 c=mix(vec3(.72,.49,.35),vec3(.075,.22,.39),h);
 vec2 uv=d.xz/max(.12,d.y)*1.6;
 float cloud=smoothstep(.46,.72,fbm(uv+vec2(11.,3.)))*smoothstep(.02,.16,d.y);
 c=mix(c,vec3(1.02,.79,.58),cloud*.58);
 float angle=max(dot(d,normalize(vec3(-.5,.38,-.8))),0.);
 c+=vec3(1.,.68,.28)*pow(angle,35.)*.35;
 c+=vec3(1.5,1.15,.65)*pow(angle,650.);
 gl_FragColor=vec4(c,1.);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 }`}));scene.add(sky);
 configure();$('loading').textContent='Preparing canyon and dragon…';
 const [w,gltf,hdr]=await Promise.all([createWorld(scene),new GLTFLoader().loadAsync('../assets/models/norberto-dragon.glb'),new RGBELoader().loadAsync('../assets/kiara_8_sunset_1k.hdr')]);world=w;
 const pmrem=new T.PMREMGenerator(renderer);scene.environment=pmrem.fromEquirectangular(hdr).texture;scene.environmentIntensity=.65;hdr.dispose();pmrem.dispose();
 dragon=new T.Group();dragon.rotation.order='YXZ';const source=gltf.scene;source.rotation.y=Math.PI;source.scale.setScalar(.0688);dragon.add(source);scene.add(dragon);
 source.traverse(n=>{if(n.isMesh){n.castShadow=true;n.receiveShadow=false;if(n.material?.map)n.material.map.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());}});
 mixer=new T.AnimationMixer(source);for(const clip of gltf.animations)mixer.clipAction(clip).play();
 buildRings();reset();renderer.compile(scene,camera);renderer.render(scene,camera);
 ready=true;metrics.ready=true;$('start').disabled=false;$('loading').textContent='Ready · endless flight';setMode('intro');
 renderer.setAnimationLoop(tick);
 }catch(e){console.error(e);$('loading').textContent=`Could not load the game: ${e.message}. Reload to retry.`;}
}
function tick(now){
 metrics.totalFrames++;
 const raw=Math.max(0,(now-last)/1000);last=now;const dt=Math.min(raw,.05);time+=dt;
 if(mode==='flying'){
  controls.sample(input);const previous=state.distance;const hit=stepFlight(state,input,dt);
  if(hit){toast(`${state.health} shields left · stay inside the canyon`);document.body.classList.add('hit');setTimeout(()=>document.body.classList.remove('hit'),250);}
  world.update(state.distance,time);pose(dt);ringsTick(previous);if(state.health<=0)end();
 }else if(mode==='intro'){world.update(0,time);pose(dt);}
 if(mode==='flying'||mode==='intro')mixer.update(dt*.85);
 renderer.render(scene,camera);
 if(raw>0&&raw<.25){samples[sampleIndex++%samples.length]=raw*1000;sampleCount=Math.min(samples.length,sampleCount+1);frameMs+=raw*1000;frameN++;}
 if(now-hudAt>500){hud();Object.assign(metrics,{frames:++metrics.frames,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,frameMs:frameMs/Math.max(1,frameN),ratio});hudAt=now;
  if(settings.quality==='auto'&&time>adaptiveAt&&mode==='flying'&&frameN>15){const avg=frameMs/frameN;if(avg>23&&ratio>1){ratio=Math.max(1,ratio-.25);renderer.setPixelRatio(ratio);renderer.setSize(innerWidth,innerHeight);adaptiveAt=time+8;}}
  frameMs=0;frameN=0;
 }
}
// Read-only run diagnostics plus deterministic QA hooks only on an explicit test URL.
window.__dragonfall={metrics,get state(){return {...state,mode};},get settings(){return {...settings};},performance(){return {samples:Array.from(samples.slice(0,sampleCount)),...metrics};}};
if(new URLSearchParams(location.search).has('test'))Object.assign(window.__dragonfall,{start,pause,resetSamples(){sampleIndex=sampleCount=0;},renderer:()=>renderer,scene:()=>scene,seek(d){state.distance=Math.max(0,d);world.update(state.distance,time);for(let i=0;i<ringPool.length;i++)placeRing(ringPool[i],Math.floor(state.distance/105)+i);pose(1);},damage(){state.health=1;state.x=44;}});
init();

