// Local microphone level fire. It does not record, upload, or use speech recognition.
// The first second sets the quiet room level. A louder sound fires, with a short cooldown.
export const DEFAULT_NOISE_THRESHOLD = 8;
export const NOISE_FIRE_COOLDOWN_MS = 900;
export const NOISE_BASELINE_MS = 1000;
const STORAGE_KEY = 'dragonfall-noise-threshold';
export function normalizeNoiseThreshold(value){
  if(value===null||value===undefined||value==='')return DEFAULT_NOISE_THRESHOLD;
  const n=Number(value);return Number.isFinite(n)?Math.min(100,Math.max(1,Math.round(n))):DEFAULT_NOISE_THRESHOLD;
}
function storage(){try{return globalThis.localStorage;}catch{return undefined;}}
export function readNoiseThreshold(s=storage()){try{return normalizeNoiseThreshold(s?.getItem(STORAGE_KEY));}catch{return DEFAULT_NOISE_THRESHOLD;}}
export function saveNoiseThreshold(value,s=storage()){const n=normalizeNoiseThreshold(value);try{s?.setItem(STORAGE_KEY,String(n));}catch{}return n;}
export function calculateRms(samples){
  if(!samples?.length)return 0;let energy=0;
  for(const x of samples)if(Number.isFinite(x))energy+=x*x;
  return Math.min(1,Math.sqrt(energy/samples.length));
}
export function createNoiseDetector({threshold=DEFAULT_NOISE_THRESHOLD,cooldownMs=NOISE_FIRE_COOLDOWN_MS}={}){
  let chosen=normalizeNoiseThreshold(threshold),last=-Infinity;
  const cooldown=Number.isFinite(cooldownMs)?Math.max(0,cooldownMs):NOISE_FIRE_COOLDOWN_MS;
  return {setThreshold(v){chosen=normalizeNoiseThreshold(v);return chosen;},reset(){last=-Infinity;},sample(level,timeMs,playing=true){
    if(!playing||!Number.isFinite(level)||!Number.isFinite(timeMs)||level<=chosen/100||timeMs-last<cooldown)return false;
    last=timeMs;return true;
  }};
}
export function createNoiseFire({onFire=()=>{},onStatus=()=>{},onLevel=()=>{},isPlaying=()=>true,deps={}}={}){
  const media=globalThis.navigator?.mediaDevices;
  const Audio=globalThis.AudioContext||globalThis.webkitAudioContext;
  const getUserMedia=Object.hasOwn(deps,'getUserMedia')?deps.getUserMedia:media?.getUserMedia?.bind(media);
  const createAudioContext=Object.hasOwn(deps,'createAudioContext')?deps.createAudioContext:(Audio?()=>new Audio():null);
  const raf=Object.hasOwn(deps,'requestAnimationFrame')?deps.requestAnimationFrame:globalThis.requestAnimationFrame?.bind(globalThis);
  const cancel=Object.hasOwn(deps,'cancelAnimationFrame')?deps.cancelAnimationFrame:globalThis.cancelAnimationFrame?.bind(globalThis);
  const now=Object.hasOwn(deps,'now')?deps.now:()=>globalThis.performance.now();
  const state={supported:typeof getUserMedia==='function'&&typeof createAudioContext==='function'&&typeof raf==='function',listening:false,status:'idle',level:0,baseline:0,threshold:readNoiseThreshold(),calibrating:false,error:''};
  if(!state.supported)state.status='unsupported';
  const detector=createNoiseDetector({threshold:state.threshold});
  let wanted=false,run=null,frame=null,token=0;
  const publish=()=>onStatus(state);
  function release(r){
    if(!r)return;if(frame!==null){cancel?.(frame);frame=null;}
    for(const [target,event,fn] of r.listeners)target.removeEventListener?.(event,fn);
    try{r.source?.disconnect();}catch{} try{r.analyser?.disconnect();}catch{}
    for(const track of r.stream?.getTracks?.()||[])try{track.stop();}catch{}
    try{r.context?.close?.();}catch{};run=null;
  }
  function fail(status,error=''){if(!run)return;const r=run;wanted=false;release(r);state.listening=false;state.level=0;state.status=status;state.error=error;onLevel(0,state);publish();}
  function tick(r){
    frame=null;if(!wanted||run!==r||r.token!==token){release(r);return;}
    if(r.context.state==='running'){
      r.analyser.getFloatTimeDomainData(r.samples);state.level=calculateRms(r.samples);
      const elapsed=now()-r.started;
      if(elapsed<NOISE_BASELINE_MS){state.calibrating=true;state.baseline=state.baseline*.92+state.level*.08;state.threshold=normalizeNoiseThreshold(Math.max(DEFAULT_NOISE_THRESHOLD,(state.baseline*220+4)));detector.setThreshold(state.threshold);}
      else state.calibrating=false;
      onLevel(state.level,state);
      if(wanted&&!state.calibrating&&detector.sample(state.level,now(),isPlaying()))onFire({source:'noise',level:state.level,threshold:state.threshold});
    }else{state.level=0;state.status='suspended';state.listening=false;onLevel(0,state);}
    if(wanted&&run===r)frame=raf(()=>tick(r));
  }
  async function begin(r){
    try{
      r.context=createAudioContext();await r.context.resume();
      r.stream=await getUserMedia({video:false,audio:{echoCancellation:true,noiseSuppression:false,autoGainControl:false}});
      if(!wanted||run!==r){release(r);return false;}
      const tracks=r.stream.getAudioTracks?.()||[];if(!tracks.length){fail('audio-capture');return false;}
      const ended=()=>tracks.some(t=>t.readyState==='ended');if(ended()){fail('audio-capture');return false;}
      r.listeners.push(...tracks.map(track=>{const fn=()=>fail('audio-capture');track.addEventListener?.('ended',fn);return [track,'ended',fn];}));
      r.analyser=r.context.createAnalyser();r.analyser.fftSize=1024;r.analyser.smoothingTimeConstant=0;r.samples=new Float32Array(r.analyser.fftSize);
      r.source=r.context.createMediaStreamSource(r.stream);r.source.connect(r.analyser);r.started=now();state.baseline=0;state.calibrating=true;state.listening=true;state.status='listening';publish();frame=raf(()=>tick(r));return true;
    }catch(e){fail(e?.name==='NotAllowedError'?'not-allowed':e?.name==='NotFoundError'?'audio-capture':'error',String(e?.message||e));return false;}
  }
  return {state,start(){
    if(!state.supported||wanted)return Promise.resolve(state.listening);wanted=true;const r={token:++token,context:null,stream:null,source:null,analyser:null,samples:null,started:0,listeners:[]};run=r;state.status='starting';state.error='';publish();return begin(r);
  },stop(){wanted=false;token++;release(run);detector.reset();state.listening=false;state.level=0;state.status=state.supported?'idle':'unsupported';state.error='';onLevel(0,state);publish();},dispose(){this.stop();state.status='disposed';},setThreshold(v){state.threshold=saveNoiseThreshold(v);detector.setThreshold(state.threshold);return state.threshold;}};
}
