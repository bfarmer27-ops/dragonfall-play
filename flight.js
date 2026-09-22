// Pure flight physics and tuning. No DOM, no three.js: node tests import this file directly.
export const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
export const damp=(a,b,k,dt)=>a+(b-a)*(1-Math.exp(-k*dt));

// Forward speed: ChatGPT's accepted build was 1.75x the original. Ryan (2026-09-09) asked for 1.4x faster than
// what he played, so the default is 1.75 * 1.4 = 2.45x. It is live-adjustable (Settings slider, saved in
// localStorage 'dragonfall-speed') through getSpeedMultiplier()/setSpeedMultiplier().
export const FLIGHT_SPEED_MULTIPLIER=2.45;
export const SPEED_MULTIPLIER_MIN=1,SPEED_MULTIPLIER_MAX=10;
let speedMultiplier=readSpeedSetting();
function readSpeedSetting(){try{const v=Number(globalThis.localStorage?.getItem('dragonfall-speed'));return v>=SPEED_MULTIPLIER_MIN&&v<=SPEED_MULTIPLIER_MAX?v:FLIGHT_SPEED_MULTIPLIER;}catch{return FLIGHT_SPEED_MULTIPLIER;}}
export function getSpeedMultiplier(){return speedMultiplier;}
export function setSpeedMultiplier(v){const n=Number(v);speedMultiplier=clamp(Number.isFinite(n)?n:FLIGHT_SPEED_MULTIPLIER,SPEED_MULTIPLIER_MIN,SPEED_MULTIPLIER_MAX);try{globalThis.localStorage?.setItem('dragonfall-speed',String(speedMultiplier));}catch{}return speedMultiplier;}

export const VERTICAL_SPEED_MULTIPLIER=2;
export const TURN_STRENGTH_MULTIPLIER=1.5;
export const MOVEMENT_ACCELERATION_RATE=14;
export const PHYSICS_STEP=1/120;

// Landscape phones have little vertical thumb travel, so climb/dive input is amplified there (Ryan, 2026-09-09).
// The gain scales only the shared (pitch) part of the two wing commands; the difference (bank) is untouched.
export const LANDSCAPE_VERTICAL_GAIN=1.5;
export function applyVerticalGain(left,right,gain){const pitch=(left+right)*.5*gain,bank=(right-left)*.5;return [clamp(pitch-bank,-1,1),clamp(pitch+bank,-1,1)];}

// Nose dive: holding a full dive for longer than NOSE_DIVE_HOLD seconds tips the dragon into a steep plunge
// with a speed surge; easing off the dive input ends it (Ryan, 2026-09-09).
export const NOSE_DIVE_HOLD=2,NOSE_DIVE_TRIGGER=-.85,NOSE_DIVE_RELEASE=-.5,NOSE_DIVE_PITCH=-1.05,NOSE_DIVE_SPEED_BOOST=1.4,NOSE_DIVE_SINK=-60;

export function wingCommand(left,right){return {pitch:clamp((left+right)*.5,-1,1),bank:clamp((right-left)*.5,-1,1)}}
export function centerAt(d){return 28*Math.sin(d*.0027)+15*Math.sin(d*.0061)}
export function newFlight(){return {distance:0,x:centerAt(0),alt:29,speed:35*speedMultiplier,pitch:0,roll:0,yaw:0,vx:0,vy:-.5*VERTICAL_SPEED_MULTIPLIER,gates:0,health:3,invulnerable:0,elapsed:0,diveHold:0,noseDive:false}}
export function stepFlight(f,left,right,dt){
 const command=wingCommand(left,right);
 // Nose-dive state machine.
 if(command.pitch<=NOSE_DIVE_TRIGGER)f.diveHold=(f.diveHold||0)+dt;else if(command.pitch>NOSE_DIVE_RELEASE)f.diveHold=0;
 if(!f.noseDive&&f.diveHold>NOSE_DIVE_HOLD)f.noseDive=true;
 if(f.noseDive&&command.pitch>NOSE_DIVE_RELEASE){f.noseDive=false;f.diveHold=0;}
 const dive=f.noseDive;
 f.pitch=damp(f.pitch,dive?NOSE_DIVE_PITCH:command.pitch*.34,dive?2.2:3.3,dt);
 f.roll=damp(f.roll,command.bank*.97*(dive?.5:1),16,dt);
 // Scale lateral steering per forward meter, with direct input response.
 // Heading no longer waits for the bank animation to catch up first.
 const targetYaw=Math.atan(TURN_STRENGTH_MULTIPLIER*Math.tan(command.bank*.83*.64*(dive?.6:1)));
 f.yaw=damp(f.yaw,targetYaw,12,dt);
 const cruise=clamp(37+f.elapsed*.055-command.pitch*14,22,69)*speedMultiplier;
 f.speed=damp(f.speed,dive?cruise*NOSE_DIVE_SPEED_BOOST:cruise,dive?1.4:.65,dt);
 f.vx=damp(f.vx,-Math.sin(f.yaw)*f.speed,MOVEMENT_ACCELERATION_RATE,dt);
 f.vy=damp(f.vy,dive?NOSE_DIVE_SINK:(command.pitch*16-.65)*VERTICAL_SPEED_MULTIPLIER,dive?3:MOVEMENT_ACCELERATION_RATE,dt);
 f.distance+=f.speed*Math.cos(f.yaw)*dt;
 f.x+=f.vx*dt;
 f.alt=clamp(f.alt+f.vy*dt,-1,88);
 f.elapsed+=dt;f.invulnerable=Math.max(0,f.invulnerable-dt);
 return f;
}
