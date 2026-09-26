// Stationary course geometry only. The live two-thumb player never follows routeAt.
// Direction comes from waterfall-flight.js and the player's controls.
export const FLIGHT_SPEED = 52; // Retired one-thumb helper only.
export const DEFAULT_SPEED_MULTIPLIER = 7;
export const SPEED_MULTIPLIER_MIN = .75;
export const SPEED_MULTIPLIER_MAX = 15;
// Keep the smooth course at high speeds rather than spacing its bend rings apart.
export const RING_SPACING_SPEED_MAX = SPEED_MULTIPLIER_MAX;
// Reset the former capped preference once; later choices on this key persist.
export const SPEED_STORAGE_KEY = 'dragonfall-waterfall-speed-v2';
// Give the rider a longer level opening before the first waterfall bend.
export const FALL_START = 2600;
export const ARC_RADIUS = 360;
export const ARC_LENGTH = Math.PI * ARC_RADIUS / 2;
export const VERTICAL_START = FALL_START + ARC_LENGTH;
export const VERTICAL_END = VERTICAL_START + 1200;
export const FALL_END = VERTICAL_END + ARC_LENGTH;
// Keep a longer river run after the waterfall so the course does not end at the pool.
export const ROUTE_LENGTH = FALL_END + 1500;
// Fixed cues make both the approach and the waterfall exit readable.
export const WATERFALL_APPROACH_RING_DISTANCE = FALL_START - 420;
export const WATERFALL_TURN_RING_DISTANCE = FALL_START + ARC_RADIUS * Math.PI / 4;
export const WATERFALL_DESCENT_RING_DISTANCE = VERTICAL_START + 360;
export const WATERFALL_DESCENT_FOLLOW_RING_DISTANCE = VERTICAL_START + 800;
export const WATERFALL_EXIT_RING_DISTANCE = VERTICAL_END + ARC_RADIUS * Math.PI / 4;
export const WATERFALL_DESCENT_CLEARANCE = 90;
export const ENTRY_TOP_Y = 20 + ARC_RADIUS * 2 + (VERTICAL_END - VERTICAL_START);
const VERTICAL_TOP_Y = ENTRY_TOP_Y - ARC_RADIUS;
const VERTICAL_BOTTOM_Y = 20 + ARC_RADIUS;
const DROP_ENTRY_Z = -FALL_START;
const DROP_VERTICAL_Z = DROP_ENTRY_Z - ARC_RADIUS;
export const FLIGHT_LIMITS = Object.freeze({side:34,minAltitude:10,maxAltitude:ENTRY_TOP_Y+80});
// The opening and placement share these values with the visible ring meshes.
export const WATERFALL_RING_RADIUS = 24;
export const WATERFALL_CRUISE_SPEED = 24;
// Ring gaps are timed from the real flight speed. The old 1.25x cap made the
// default 7x flight put a ring in front of the rider about every 0.7 seconds.
export const WATERFALL_RING_SECONDS = 5;
export const WATERFALL_BEND_RING_SECONDS = 5;
export const WATERFALL_RING_SPACING = WATERFALL_CRUISE_SPEED * WATERFALL_RING_SECONDS;
export const WATERFALL_APPROACH_RING_SPACING = WATERFALL_RING_SPACING;
export const WATERFALL_RING_OFFSET = 0;
export const WATERFALL_OBSTACLE_START = 320;
export const WATERFALL_OBSTACLE_SPACING = 420;
export const clamp = (n,lo,hi) => Math.min(hi,Math.max(lo,n));

// distance is real arc length throughout. The level plateau leads directly into
// a forward-only quarter circle, straight fall, quarter-circle exit and level run.
export function routeAt(distance) {
 const d=clamp(distance,0,ROUTE_LENGTH);
 if(d<FALL_START)return {x:0,y:ENTRY_TOP_Y,z:-d,pitch:0,fall:0};
 if(d<VERTICAL_START){
  const u=(d-FALL_START)/ARC_RADIUS;
  return {x:0,y:ENTRY_TOP_Y-ARC_RADIUS*(1-Math.cos(u)),z:DROP_ENTRY_Z-ARC_RADIUS*Math.sin(u),pitch:u,fall:1};
 }
 if(d<VERTICAL_END)return {x:0,y:VERTICAL_TOP_Y-(d-VERTICAL_START),z:DROP_VERTICAL_Z,pitch:Math.PI/2,fall:1};
 if(d<FALL_END){
  const u=(d-VERTICAL_END)/ARC_RADIUS;
  return {x:0,y:VERTICAL_BOTTOM_Y-ARC_RADIUS*Math.sin(u),z:DROP_VERTICAL_Z-ARC_RADIUS*(1-Math.cos(u)),pitch:Math.PI/2-u,fall:1};
 }
 return {x:0,y:20,z:DROP_VERTICAL_Z-ARC_RADIUS-(d-FALL_END),pitch:0,fall:0};
}
export function routeTangent(distance){
 const d=clamp(distance,0,ROUTE_LENGTH);
 if(d<FALL_START||d>=FALL_END)return {x:0,y:0,z:-1};
 if(d<VERTICAL_START){const u=(d-FALL_START)/ARC_RADIUS;return {x:0,y:-Math.sin(u),z:-Math.cos(u)};}
 if(d<VERTICAL_END)return {x:0,y:-1,z:0};
 const u=(d-VERTICAL_END)/ARC_RADIUS;return {x:0,y:-Math.cos(u),z:-Math.sin(u)};
}
export function segmentAt(distance){return distance<FALL_START?'approach':distance<FALL_END?'waterfall descent':'river exit';}

export function readSpeedMultiplier(){
 try{
  const raw=globalThis.localStorage?.getItem(SPEED_STORAGE_KEY),v=Number(raw);
  if(raw==null||!Number.isFinite(v)||v<=0)return DEFAULT_SPEED_MULTIPLIER;
  const selected=clamp(v,SPEED_MULTIPLIER_MIN,SPEED_MULTIPLIER_MAX);
  if(selected!==v)globalThis.localStorage?.setItem(SPEED_STORAGE_KEY,String(selected));
  return selected;
 }catch{return DEFAULT_SPEED_MULTIPLIER;}
}
let speedMultiplier=readSpeedMultiplier();
export function getSpeedMultiplier(){return speedMultiplier;}
export function setSpeedMultiplier(v){const value=Number(v);speedMultiplier=clamp(Number.isFinite(value)?value:DEFAULT_SPEED_MULTIPLIER,SPEED_MULTIPLIER_MIN,SPEED_MULTIPLIER_MAX);try{globalThis.localStorage?.setItem(SPEED_STORAGE_KEY,String(speedMultiplier));}catch{}return speedMultiplier;}

export function createRings(selectedSpeed=getSpeedMultiplier()){
 // Ring locations are fixed so the course does not change shape when speed changes.
 void selectedSpeed;
 // These are deliberate course cues, not a random ring stream: one level cue,
 // one 45-degree entry cue, two same-plane descent cues, and one 45-degree exit cue.
 const forced=[
  {distance:WATERFALL_APPROACH_RING_DISTANCE,forced:true,normal:{x:0,y:0,z:-1}},
  {distance:WATERFALL_TURN_RING_DISTANCE,forced:true,normal:{x:0,y:-Math.SQRT1_2,z:-Math.SQRT1_2}},
  {distance:WATERFALL_DESCENT_RING_DISTANCE,forced:true},
  {distance:WATERFALL_DESCENT_FOLLOW_RING_DISTANCE,forced:true},
  {distance:WATERFALL_EXIT_RING_DISTANCE,forced:true,normal:{x:0,y:-Math.SQRT1_2,z:-Math.SQRT1_2}},
 ];
 const curtainZ=routeAt(FALL_START).z-(ARC_RADIUS-60);
 const descentZ=curtainZ-WATERFALL_DESCENT_CLEARANCE;
 const out=[];
 for(const placement of forced){
  const {distance}=placement,p=routeAt(distance),normal=placement.normal||routeTangent(distance);
  // Keep every ring after the straight drop in one forward plane or farther
  // from the waterfall. This prevents an alternating near/far line beside it.
  const z=distance>=VERTICAL_START?Math.min(p.z,descentZ):p.z;
  const x=p.x,y=p.y,center={x,y,z};
  out.push({distance,x,altitude:y,z,center,normal,radius:WATERFALL_RING_RADIUS,pitch:p.pitch,fall:p.fall,caught:false,forced:placement.forced});
 }
 return out;
}

export function createWaterfallObstacles(){
 const lanes=[-22,24,-18,20,-25,17],heights=[18,25,21,29,20,24],out=[];
 for(let index=0,distance=WATERFALL_OBSTACLE_START;distance<ROUTE_LENGTH-260;index++,distance+=WATERFALL_OBSTACLE_SPACING){
  const p=routeAt(distance),lane=lanes[index%lanes.length];
  out.push({distance,index,x:p.x+lane,altitude:p.y+(index%3-1)*9,z:p.z,radius:4.5+(index%2)*.8,height:heights[index%heights.length],hit:false});
 }
 return out;
}

// Compatibility helpers belong only to the retired waterfall.js prototype.
// Neither live game uses these helpers to move the player or the scenery.
export function createState(){const p=routeAt(0);return {distance:0,x:0,altitude:p.y,roll:0,pitch:p.pitch,elapsed:0,speed:FLIGHT_SPEED*speedMultiplier,speedMultiplier,mode:'ready',rings:0,hits:0};}
export function stepFlight(state,input,dt){if(state.mode!=='flying')return state;dt=clamp(Number(dt)||0,0,.05);const h=clamp(Number(input.x)||0,-1,1),v=clamp(Number(input.y)||0,-1,1);speedMultiplier=getSpeedMultiplier();state.speedMultiplier=speedMultiplier;state.speed=FLIGHT_SPEED*speedMultiplier;state.distance=Math.min(ROUTE_LENGTH,state.distance+state.speed*dt);const p=routeAt(state.distance);state.x=clamp(state.x+h*30*dt,-FLIGHT_LIMITS.side,FLIGHT_LIMITS.side);state.altitude=clamp(p.y+v*10,FLIGHT_LIMITS.minAltitude,FLIGHT_LIMITS.maxAltitude);const blend=1-Math.exp(-7*dt);state.pitch+=(p.pitch+v*.1-state.pitch)*blend;state.roll+=(-h*.3-state.roll)*blend;state.elapsed+=dt;if(state.distance>=ROUTE_LENGTH)state.mode='complete';return state;}
export function createHazards(){return Array.from({length:16},(_,index)=>{const distance=FALL_START+(ROUTE_LENGTH-FALL_START-400)*index/15,p=routeAt(distance);return {distance,index,x:p.x+(index%2?24:-24),altitude:p.y+(index%3-1)*18,radius:index>9?9:7,height:index>9?28:22,hit:false};});}
export function cameraPose(state,aspect=1){const back=aspect<.8?38:32;return {position:{x:0,y:8,z:back},target:{x:0,y:2,z:-34},back};}
