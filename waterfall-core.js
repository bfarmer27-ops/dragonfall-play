// Stationary course geometry only. The live two-thumb player never follows routeAt.
// Direction comes from waterfall-flight.js and the player's controls.
export const ROUTE_LENGTH = 5600;
export const FLIGHT_SPEED = 52;
export const DEFAULT_SPEED_MULTIPLIER = 1;
export const SPEED_MULTIPLIER_MIN = 0.75;
export const SPEED_MULTIPLIER_MAX = 6;
export const FLIGHT_LIMITS = Object.freeze({side: 34, minAltitude: 10, maxAltitude: 230});
export const CLIMB_START = 700;
export const CLIMB_END = 2100;
export const FALL_START = 2500;
export const ARC_RADIUS = 96;
export const ARC_LENGTH = Math.PI * ARC_RADIUS / 2;
// The opening and placement share these values with the visible ring meshes.
export const WATERFALL_RING_RADIUS = 24;
export const WATERFALL_RING_SPACING = 32;
export const WATERFALL_APPROACH_RING_SPACING = 70;
export const WATERFALL_RING_OFFSET = 4;
export const VERTICAL_START = FALL_START + ARC_LENGTH;
export const VERTICAL_END = VERTICAL_START + 1050;
export const FALL_END = VERTICAL_END + ARC_LENGTH;
const ENTRY_TOP_Y = 396;
const VERTICAL_TOP_Y = 300;
const VERTICAL_BOTTOM_Y = 116;
const CLIMB_FORWARD = 1800;
const CREST_Z = -CLIMB_START - CLIMB_FORWARD;
const DROP_ENTRY_Z = CREST_Z - 400;
const DROP_VERTICAL_Z = DROP_ENTRY_Z - ARC_RADIUS;
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export function routeAt(distance) {
 const d=clamp(distance,0,ROUTE_LENGTH);
 if(d<CLIMB_START) return {x:0,y:42,z:-d,pitch:0,fall:0};
 if(d<CLIMB_END){
  const t=(d-CLIMB_START)/(CLIMB_END-CLIMB_START),a=t*Math.PI*2;
  // Ease into and out of the climb with a forward tangent at both joins.
  const ease=t*t*(3-2*t),envelope=Math.sin(Math.PI*t)**2;
  return {x:200*Math.sin(a)*envelope,y:42+354*ease,z:-CLIMB_START-100*(1-Math.cos(a))-CLIMB_FORWARD*t,pitch:-.25*Math.sin(Math.PI*t),fall:0};
 }
 if(d<FALL_START){
  const t=(d-CLIMB_END)/(FALL_START-CLIMB_END);
  return {x:0,y:ENTRY_TOP_Y,z:CREST_Z-400*t,pitch:0,fall:0};
 }
 if(d<VERTICAL_START){
  const u=(d-FALL_START)/ARC_LENGTH*Math.PI/2;
  return {x:0,y:ENTRY_TOP_Y-ARC_RADIUS*(1-Math.cos(u)),z:DROP_ENTRY_Z-ARC_RADIUS*Math.sin(u),pitch:u,fall:1};
 }
 if(d<VERTICAL_END){
  const t=(d-VERTICAL_START)/(VERTICAL_END-VERTICAL_START);
  return {x:0,y:VERTICAL_TOP_Y-(VERTICAL_TOP_Y-VERTICAL_BOTTOM_Y)*t,z:DROP_VERTICAL_Z,pitch:Math.PI/2,fall:1};
 }
 if(d<FALL_END){
  const u=(d-VERTICAL_END)/ARC_LENGTH*Math.PI/2;
  return {x:0,y:VERTICAL_BOTTOM_Y-ARC_RADIUS*Math.sin(u),z:DROP_VERTICAL_Z-ARC_RADIUS*(1-Math.cos(u)),pitch:Math.PI/2-u,fall:1};
 }
 const t=(d-FALL_END)/(ROUTE_LENGTH-FALL_END);
 return {x:18*Math.sin(t*Math.PI)**2,y:20,z:DROP_VERTICAL_Z-ARC_RADIUS-(d-FALL_END),pitch:0,fall:0};
}

export function segmentAt(distance){
 if(distance<CLIMB_START)return 'approach';
 if(distance<CLIMB_END)return 'rising circle';
 if(distance<FALL_START)return 'cloud crest';
 if(distance<FALL_END)return 'waterfall descent';
 return 'river exit';
}

export function readSpeedMultiplier(){try{const v=Number(globalThis.localStorage?.getItem('dragonfall-waterfall-speed'));return v>=SPEED_MULTIPLIER_MIN&&v<=SPEED_MULTIPLIER_MAX?v:DEFAULT_SPEED_MULTIPLIER;}catch{return DEFAULT_SPEED_MULTIPLIER;}}
let speedMultiplier=readSpeedMultiplier();
export function getSpeedMultiplier(){return speedMultiplier;}
export function setSpeedMultiplier(v){speedMultiplier=clamp(Number(v)||DEFAULT_SPEED_MULTIPLIER,SPEED_MULTIPLIER_MIN,SPEED_MULTIPLIER_MAX);try{globalThis.localStorage?.setItem('dragonfall-waterfall-speed',String(speedMultiplier));}catch{}return speedMultiplier;}
export function createState(){const p=routeAt(0);return {distance:0,x:0,altitude:p.y,roll:0,pitch:p.pitch,elapsed:0,speed:FLIGHT_SPEED*speedMultiplier,speedMultiplier,mode:'ready',rings:0,hits:0};}
export function stepFlight(state,input,dt){if(state.mode!=='flying')return state;dt=clamp(Number(dt)||0,0,.05);const h=clamp(Number(input.x)||0,-1,1),v=clamp(Number(input.y)||0,-1,1);speedMultiplier=getSpeedMultiplier();state.speedMultiplier=speedMultiplier;state.speed=FLIGHT_SPEED*speedMultiplier;state.distance=Math.min(ROUTE_LENGTH,state.distance+state.speed*dt);const p=routeAt(state.distance);state.x=clamp(state.x+h*30*dt,-FLIGHT_LIMITS.side,FLIGHT_LIMITS.side);state.altitude=clamp(p.y+v*10,FLIGHT_LIMITS.minAltitude,FLIGHT_LIMITS.maxAltitude);const blend=1-Math.exp(-7*dt);state.pitch+=(p.pitch+v*.1-state.pitch)*blend;state.roll+=(-h*.3-state.roll)*blend;state.elapsed+=dt;if(state.distance>=ROUTE_LENGTH)state.mode='complete';return state;}
export function createRings(){
 const out=[];let travelled=0,courseTravel=119,previous=routeAt(119);
 // Physical spacing matters: the old distance parameter compresses 1,050 route
 // units into 184 metres of vertical drop. Do not stack rings using that counter.
 for(let d=120;d<ROUTE_LENGTH-100;d+=1){
  const p=routeAt(d),step=Math.hypot(p.x-previous.x,p.y-previous.y,p.z-previous.z);travelled+=step;courseTravel+=step;previous=p;
  // Keep the closer spacing through the lead-in and exit as well, so the
  // change to open straight flight cannot hide either end of the bend.
  const nearDrop=d>=FALL_START-ARC_RADIUS&&d<=FALL_END+ARC_RADIUS;
  const spacing=nearDrop?WATERFALL_RING_SPACING:WATERFALL_APPROACH_RING_SPACING;
  if(out.length&&travelled<spacing)continue;
  travelled=0;
  const normal=routeTangent(d),across=Math.hypot(normal.y,normal.z)||1;
  // right = tangent x world X's perpendicular companion, stable through a
  // vertical drop; up completes its perpendicular plane (X/Z when vertical).
  const up={x:0,y:-normal.z/across,z:normal.y/across};
  const right={x:normal.y*up.z-normal.z*up.y,y:normal.z*up.x-normal.x*up.z,z:normal.x*up.y-normal.y*up.x};
  // Both bends stay centred. Small vertical variations ease in and out, and
  // their phase follows real metres, not the compressed vertical parameter.
  // The full corridor centreline remains inside every larger opening.
  let envelope=1;
  if(d<FALL_START)envelope=Math.sin(Math.PI*.5*clamp((FALL_START-d)/ARC_RADIUS,0,1))**2;
  else if(d<VERTICAL_START)envelope=0;
  else if(d<VERTICAL_END)envelope=Math.sin(Math.PI*(p.y-VERTICAL_BOTTOM_Y)/(VERTICAL_TOP_Y-VERTICAL_BOTTOM_Y))**2;
  else if(d<FALL_END)envelope=0;
  else envelope=Math.sin(Math.PI*.5*clamp((d-FALL_END)/ARC_RADIUS,0,1))**2;
  const radius=WATERFALL_RING_OFFSET*envelope,phase=courseTravel*.006,rx=Math.cos(phase)*radius,ry=Math.sin(phase)*radius;
  const center={x:p.x+right.x*rx+up.x*ry,y:p.y+right.y*rx+up.y*ry,z:p.z+right.z*rx+up.z*ry};
  out.push({distance:d,x:center.x,altitude:center.y,z:center.z,center,normal,radius:WATERFALL_RING_RADIUS,pitch:p.pitch,fall:p.fall,caught:false});
 }
 return out;
}
export function createHazards(){return [820,1010,1210,1450,1660,1900,2140,2310,2480,2810,3070,3320,3540,3950,4330,4780].map((distance,index)=>{const p=routeAt(distance);return {distance,index,x:p.x+(index%2?24:-24),altitude:p.y+(index%3-1)*18,radius:index>9?9:7,height:index>9?28:22,hit:false};});}
export function routeTangent(distance){const a=routeAt(Math.max(0,distance-.001)),b=routeAt(Math.min(ROUTE_LENGTH,distance+.001)),dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z,len=Math.hypot(dx,dy,dz)||1;return {x:dx/len,y:dy/len,z:dz/len};}
export function cameraPose(state,aspect=1){const back=aspect<.8?38:32;return {position:{x:0,y:8,z:back},target:{x:0,y:2,z:-34},back};}
