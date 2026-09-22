// Phone tilt steering (Ryan's 2026-09-09 rule): lower the TOP edge to dive, raise it to climb; lower the LEFT edge
// to bank left, the RIGHT edge to bank right. Pushing one corner down does both at once (top-left corner down =
// dive + bank left). Works at any holding angle, flat or upright, without turning the phone like a compass.
const rad=Math.PI/180;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
// World "up" expressed in device axes (x right, y top, z out of the screen), from DeviceOrientation beta/gamma,
// then rotated by the screen orientation angle so landscape holds behave like portrait.
export function upVector(beta,gamma,angle=0){
 const b=beta*rad,g=gamma*rad,a=angle*rad;
 const x=Math.cos(b)*Math.sin(g),y=Math.sin(b),z=Math.cos(b)*Math.cos(g);
 return {x:x*Math.cos(a)+y*Math.sin(a),y:y*Math.cos(a)-x*Math.sin(a),z};
}
// Tilt angles (degrees) of an up vector: pitch = forward/back lean around the phone's left-right axis,
// lean = left/right lean measured after the pitch is removed, so it stays valid when the phone is upright.
export function tiltAngles(up){
 const pitch=Math.atan2(up.y,up.z);
 const c=Math.cos(-pitch),s=Math.sin(-pitch);
 const y=up.y*c-up.z*s,z=up.y*s+up.z*c;
 const lean=Math.atan2(up.x,Math.hypot(y,z));
 return {pitch:pitch/rad,lean:lean/rad};
}
export function screenTilt(beta,gamma,angle=0){return tiltAngles(upVector(beta,gamma,angle));}
const delta=(a,b)=>((a-b+540)%360)-180;
// 2 degree dead zone, full input at 25 degrees from the calibrated neutral hold.
const axis=v=>(Math.sign(v)*clamp((Math.abs(v)-2)/23,0,1))||0; // '|| 0' turns -0 into 0
// Lowering the top edge (pitch below neutral) = dive (negative). Lowering the left edge = bank left (negative bank).
export function tiltCommands(current,neutral){return {pitch:axis(delta(current.pitch,neutral.pitch)),bank:(-axis(delta(current.lean,neutral.lean)))||0};}
export function createTilt(){
 let latest=null,neutral=null,stamp=0,authorized=false;
 const angle=()=>globalThis.screen?.orientation?.angle??globalThis.orientation??0;
 globalThis.addEventListener?.('deviceorientation',e=>{if(!Number.isFinite(e.beta)||!Number.isFinite(e.gamma))return;latest=screenTilt(e.beta,e.gamma,angle());stamp=performance.now();if(!neutral)neutral=latest;});
 return {
  async enable(){
   if(!globalThis.DeviceOrientationEvent)throw Error('Tilt is unavailable on this device. Select Two thumbs in Settings.');
   if(!authorized&&typeof DeviceOrientationEvent.requestPermission==='function'&&await DeviceOrientationEvent.requestPermission()!=='granted')throw Error('Motion permission was denied. Allow motion in your browser or select Two thumbs.');
   authorized=true;
   const started=performance.now();
   while(!latest||performance.now()-stamp>500){if(performance.now()-started>2500)throw Error('No motion data received. Allow motion access or select Two thumbs.');await new Promise(r=>setTimeout(r,50));}
   neutral=latest;
  },
  calibrate(){neutral=latest&&performance.now()-stamp<500?latest:null;},
  rotate(){latest=null;neutral=null;},
  read(){return latest&&neutral&&performance.now()-stamp<1000?tiltCommands(latest,neutral):{pitch:0,bank:0};}
 };
}
