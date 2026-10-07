// Stationary course geometry only. The live two-thumb player never follows routeAt.
// Direction comes from waterfall-flight.js and the player's controls.
export const FLIGHT_SPEED = 52; // Retired one-thumb helper only.
export const DEFAULT_SPEED_MULTIPLIER = 12;
export const SPEED_MULTIPLIER_MIN = .75;
export const SPEED_MULTIPLIER_MAX = 15;
// Keep the smooth course at high speeds rather than spacing its bend rings apart.
export const RING_SPACING_SPEED_MAX = SPEED_MULTIPLIER_MAX;
// Reset the former capped preference once; later choices on this key persist.
export const SPEED_STORAGE_KEY='dragonfall-waterfall-speed-v3';
// The Hollow (2026-10-07): a 7 km cave run through the mountain, flown BEFORE the Sky Isles. Then the
// Sky Isles: a prelude of floating islands above a cloud sea before the gorge begins (2026-10-06).
export const HOLLOW_LENGTH = 7000;
export const ISLES_LENGTH = 2200;
export const PRELUDE_LENGTH = HOLLOW_LENGTH + ISLES_LENGTH;
export const WATERFALL_PRELUDE_RING_DISTANCES = Object.freeze([520, 1120, 1720].map(d => d + HOLLOW_LENGTH));
// Give the rider a longer level opening before the first waterfall bend.
export const FALL_START = 2600 + PRELUDE_LENGTH;
export const ARC_RADIUS = 360;
export const ARC_LENGTH = Math.PI * ARC_RADIUS / 2;
export const VERTICAL_START = FALL_START + ARC_LENGTH;
export const VERTICAL_END = VERTICAL_START + 1200;
export const FALL_END = VERTICAL_END + ARC_LENGTH;
// Keep a longer river run after the waterfall so the course does not end at the pool.
export const ROUTE_LENGTH = FALL_END + 1500;
// Fixed cues make both the approach and the waterfall exit readable.
export const WATERFALL_APPROACH_RING_DISTANCE = FALL_START - 420;
export const WATERFALL_OPENING_RING_DISTANCES = Object.freeze([620,1160,1700].map(d => d + PRELUDE_LENGTH));
export const WATERFALL_TURN_RING_DISTANCE = FALL_START + ARC_RADIUS * Math.PI / 4;
export const WATERFALL_DESCENT_RING_DISTANCE = VERTICAL_START + 180;
export const WATERFALL_DESCENT_FOLLOW_RING_DISTANCE = VERTICAL_START + 680;
export const WATERFALL_EXIT_RING_DISTANCE = VERTICAL_END + ARC_RADIUS * Math.PI / 4;
export const WATERFALL_RIVER_CLEARANCE = 120;
export const WATERFALL_DESCENT_CLEARANCE = 140;
export const ENTRY_TOP_Y = 20 + ARC_RADIUS * 2 + (VERTICAL_END - VERTICAL_START);
const VERTICAL_TOP_Y = ENTRY_TOP_Y - ARC_RADIUS;
const VERTICAL_BOTTOM_Y = 20 + ARC_RADIUS;
const DROP_ENTRY_Z = -FALL_START;
const DROP_VERTICAL_Z = DROP_ENTRY_Z - ARC_RADIUS;
export const FLIGHT_LIMITS = Object.freeze({side:34,minAltitude:10,maxAltitude:ENTRY_TOP_Y+80});

// ---------------------------------------------------------------------------------------------
// The Hollow. d = metres flown from the start ledge (z = -d). The mouth in the mountain face is at
// HOLLOW_MOUTH, the exit onto the cloud sea at HOLLOW_EXIT. Zones: ledge (outside), throat (a winding
// crystal tunnel), cathedral (a huge chamber over a lake with crystal pillars), vault (a lava river with
// fire geysers), roots (a hall of giant roots and glowing fungus), shaft (a dive and climb), gate (the
// climb out to daylight). hollowPath(d) gives the tunnel's centre line, radius, floor and the clear
// radius the player may use (wall bumps and the 24 m dragon bumper already taken off).
// ---------------------------------------------------------------------------------------------
export const HOLLOW_MOUTH=520, HOLLOW_EXIT=6900;
export const HOLLOW_ZONES=Object.freeze([
 Object.freeze({name:'ledge',start:0,end:HOLLOW_MOUTH}),
 Object.freeze({name:'throat',start:HOLLOW_MOUTH,end:1900}),
 Object.freeze({name:'cathedral',start:1900,end:3100}),
 Object.freeze({name:'vault',start:3100,end:4300}),
 Object.freeze({name:'roots',start:4300,end:5500}),
 Object.freeze({name:'shaft',start:5500,end:6200}),
 Object.freeze({name:'gate',start:6200,end:HOLLOW_EXIT}),
 Object.freeze({name:'open',start:HOLLOW_EXIT,end:HOLLOW_LENGTH}),
]);
const sm=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const wave=(d,start,length,amp)=>d>start&&d<start+length?amp*Math.sin((d-start)/length*Math.PI*2):0;
export function hollowZone(d){for(const z of HOLLOW_ZONES)if(d<z.end)return z.name;return 'open';}
export function hollowPath(d){
 // Gentle bends (round 5: Ryan asked for a bigger, easier cave): amplitude x (2*pi/length)^2 < 1/550.
 const x=wave(d,760,1140,70)+wave(d,3100,1200,-70)+wave(d,4300,1200,60);
 const y=ENTRY_TOP_Y-90*sm(HOLLOW_MOUTH,1900,d)-30*sm(1900,3100,d)-150*sm(3100,4300,d)+100*sm(4300,5500,d)
  -(d>5500&&d<6200?170*Math.sin((d-5500)/700*Math.PI):0)+170*sm(6200,HOLLOW_EXIT,d);
 let r;
 if(d<640)r=170+120*sm(640,HOLLOW_MOUTH,d);
 else if(d<1900)r=170-30*sm(640,1200,d);
 else if(d<3100)r=140+200*sm(1900,2150,d)-200*sm(2850,3100,d);
 else if(d<4300)r=140+15*sm(3100,3400,d)-15*sm(4000,4300,d);
 else if(d<5500)r=140+60*sm(4300,4500,d)-45*sm(5300,5500,d);
 else if(d<6200)r=155;
 else r=155+25*sm(6200,6600,d)+110*sm(6700,HOLLOW_EXIT,d);
 const floor=y-r*.78;
 const inside=d>=HOLLOW_MOUTH&&d<=HOLLOW_EXIT;
 return {x,y,z:-d,r,floor,clear:inside?Math.max(20,r*.86-30):Infinity,zone:hollowZone(d),inside};
}
// Orb cues through the Hollow: [distance, across, up] from the tunnel's centre line. Every ring sits inside
// the clear radius so the whole ring can be flown through.
// Each cue sits on the far side of the hazard that follows it, so the line from cue to cue stays clear.
// 2026-10-07: from the cathedral on, the cues cut the tunnel's bends instead of adding to them, and the up/down
// swings are smaller (the shaft cue sits above the dip), so every cue can be flown with 60% of the stick at
// every speed (tests/course-check.mjs). The old cathedral cues needed a 160 m sideways shift in 350 m.
export const HOLLOW_RING_CUES=Object.freeze([
 [420,0,0],[900,-34,8],[1300,32,-14],[1700,30,18],
 [2150,25,10],[2500,-25,-10],[2850,25,8],
 [3350,30,0],[3800,-30,0],[4150,-20,10],
 [4600,-60,10],[5000,62,-10],[5350,30,5],
 [5850,0,60],[6150,-20,-20],
 [6600,-22,10],[HOLLOW_EXIT,0,0],
].map(Object.freeze));
// Golden orbs in the Hollow: one high over the cue line in the cathedral, one low over the lava; each is off the
// line between its two cues but close enough to reach and still make the next cue.
export const HOLLOW_BONUS_ORBS=Object.freeze([[2650,0,25],[4000,-52,-12]].map(Object.freeze));
// Hazards in the Hollow: a vertical cylinder at (centre + side*across). Stalactites hang from the ceiling to
// just under the centre line, crystals rise from the lake floor to just over it, roots run floor to ceiling,
// geysers are lava columns that are only dangerous while they are up (period/up seconds, phase offset).
export const HOLLOW_HAZARDS=Object.freeze([
 {kind:'stalactite',distance:1100,side:1,across:30,radius:11},
 {kind:'stalactite',distance:1500,side:-1,across:30,radius:11},
 {kind:'crystal',distance:2300,side:-1,across:70,radius:20},
 {kind:'crystal',distance:2650,side:1,across:85,radius:22},
 {kind:'crystal',distance:2950,side:-1,across:60,radius:18},
 {kind:'geyser',distance:3550,side:-1,across:34,radius:15,period:3.8,up:1.5,phase:0},
 {kind:'geyser',distance:3950,side:1,across:34,radius:15,period:3.8,up:1.5,phase:1.9},
 {kind:'root',distance:4500,side:1,across:40,radius:15},
 {kind:'root',distance:4900,side:-1,across:44,radius:15},
 {kind:'stalactite',distance:5050,side:1,across:22,radius:11},
 {kind:'root',distance:5250,side:-1,across:40,radius:14},
 {kind:'stalactite',distance:6050,side:1,across:22,radius:11},
].map(Object.freeze));
// Wind rivers: glowing streams of air. Riding one gives a steady speed boost. Points are [distance, across, up]
// from the centre line; the river's curve passes through them in order.
export const HOLLOW_WIND_RIVERS=Object.freeze([
 Object.freeze({name:'cathedral',points:[[1950,0,-10],[2200,90,60],[2450,-70,100],[2700,-130,50],[2950,60,-20],[3120,0,0]]}),
 Object.freeze({name:'vault',points:[[3150,0,-20],[3450,-20,-36],[3750,30,-38],[4050,-30,-34],[4280,0,-10]]}),
 Object.freeze({name:'shaft',points:[[5450,0,10],[5650,20,-20],[5850,-10,-28],[6050,15,0],[6230,0,10]]}),
]);
export const HOLLOW_WIND_RADIUS=38;
export function hollowWindPoint(river,index){const [d,across,up]=river.points[index],p=hollowPath(d);return {x:p.x+across,y:p.y+up,z:-d,d};}
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

// Golden bonus orbs: off the main line, worth five, never break the streak when skipped.
// One hangs low over the river before the drop; one sits low over the lake at the end.
// The first one was at [62,-58], beside the right river bank: the dragon's 24 m bumper touched the bank before
// the orb, so the dragon froze in front of it (Ryan, 2026-10-07). It now sits over open water on the left, 50 m
// clear of the bumper floor and 46 m off the line between its neighbour orbs (tests/course-check.mjs).
export const WATERFALL_BONUS_ORBS=Object.freeze([
 Object.freeze({distance:FALL_START-140,offset:[-40,-42]}),
 Object.freeze({distance:FALL_END+700,offset:[-48,-70]}),
]);
export const WATERFALL_BONUS_VALUE=5;
// Catching an orb gives a short speed burst. The gain grows with the streak (consecutive orbs).
export const WATERFALL_BOOST_SECONDS=1.6;
export const WATERFALL_BOOST_GAIN_BASE=.25;
export const WATERFALL_BOOST_GAIN_PER_STREAK=.05;
export const WATERFALL_BOOST_GAIN_MAX=.5;
export function boostGainForStreak(streak){return clamp(WATERFALL_BOOST_GAIN_BASE+WATERFALL_BOOST_GAIN_PER_STREAK*Math.max(0,Math.floor(Number(streak)||0)),WATERFALL_BOOST_GAIN_BASE,WATERFALL_BOOST_GAIN_MAX);}

export function createRings(selectedSpeed=getSpeedMultiplier()){
 // Ring locations are fixed so the course does not change shape when speed changes.
 void selectedSpeed;
 // These are deliberate course cues, not a random ring stream: four opening level cues,
 // one 45-degree entry cue, two same-plane descent cues, and one 45-degree exit cue.
 const offsets=[[-26,22],[24,-18],[-22,26],[22,-20],[-18,10],[22,8],[-24,-12],[18,0]];
 // Sky Isles cues weave wider between the floating islands.
 const preludeOffsets=[[-44,12],[46,-26],[-34,30]];
 const forced=[
  ...HOLLOW_RING_CUES.map(([distance,across,up])=>({distance,forced:true,hollow:true,normal:{x:0,y:0,z:-1},offset:[across,up]})),
  ...HOLLOW_BONUS_ORBS.map(([distance,across,up])=>({distance,forced:true,hollow:true,bonus:true,normal:{x:0,y:0,z:-1},offset:[across,up]})),
  ...WATERFALL_PRELUDE_RING_DISTANCES.map((distance,index)=>({distance,forced:true,normal:{x:0,y:0,z:-1},offset:preludeOffsets[index]})),
  ...WATERFALL_OPENING_RING_DISTANCES.map((distance,index)=>({distance,forced:true,normal:{x:0,y:0,z:-1},offset:offsets[index]})),
  {distance:WATERFALL_APPROACH_RING_DISTANCE,forced:true,normal:{x:0,y:0,z:-1},offset:offsets[3]},
  {distance:WATERFALL_TURN_RING_DISTANCE,forced:true,normal:{x:0,y:-Math.SQRT1_2,z:-Math.SQRT1_2},offset:offsets[4]},
  {distance:WATERFALL_DESCENT_RING_DISTANCE,forced:true,offset:offsets[5]},
  {distance:WATERFALL_DESCENT_FOLLOW_RING_DISTANCE,forced:true,offset:offsets[6]},
  {distance:WATERFALL_EXIT_RING_DISTANCE,forced:true,normal:{x:0,y:-Math.SQRT1_2,z:-Math.SQRT1_2},offset:offsets[7]},
  ...WATERFALL_BONUS_ORBS.map(b=>({distance:b.distance,forced:true,bonus:true,normal:{x:0,y:0,z:-1},offset:b.offset})),
 ];
 forced.sort((a,b)=>a.distance-b.distance);
 const curtainZ=routeAt(FALL_START).z-(ARC_RADIUS-60);
 const descentZ=curtainZ-WATERFALL_DESCENT_CLEARANCE;
 const out=[];
 for(const placement of forced){
  const {distance}=placement,p=routeAt(distance),normal=placement.normal||routeTangent(distance);
  // Keep every ring after the straight drop in one forward plane or farther
  // from the waterfall. This prevents an alternating near/far line beside it.
  const z=distance>=VERTICAL_START?Math.min(p.z,descentZ):p.z;
  // Hollow cues hang off the tunnel's centre line instead of the straight route.
  const base=placement.hollow?hollowPath(distance):p;
  const [offsetX,offsetY]=placement.offset||[0,0],x=base.x+offsetX,y=base.y+offsetY,center={x,y,z};
  const bonus=!!placement.bonus;
  // Hollow cues are bigger targets (the cave is dark and fast).
  const radius=bonus?WATERFALL_RING_RADIUS*.75:placement.hollow?WATERFALL_RING_RADIUS*1.35:WATERFALL_RING_RADIUS;
  out.push({distance,x,altitude:y,z,center,normal,radius,pitch:p.pitch,fall:p.fall,caught:false,forced:placement.forced,bonus,hollow:!!placement.hollow,value:bonus?WATERFALL_BONUS_VALUE:1});
 }
 return out;
}

// Designed hazards, not a random stream. Spires: four rock needles rising out of the upper river in the
// gorge slalom, alternating sides, each leaving a clear line past it. Totems: three carved stone pillars on
// mossy islands in the lower river after the fall. Every hazard starts at its river surface and rises into
// the flight corridor; grazing one costs a shield; a fireball shatters it.
// Each spire stands beside an opening orb, on the side opposite that orb (the orbs alternate -x/+x, so the
// spires alternate +x/-x). The straight line from orb to orb then clears every spire (2026-10-07: the old
// spires between the orbs stood on that line, so following the orbs flew into them).
export const WATERFALL_SPIRE_DISTANCES=Object.freeze([...WATERFALL_OPENING_RING_DISTANCES,WATERFALL_APPROACH_RING_DISTANCE]);
export const WATERFALL_TOTEM_DISTANCES=Object.freeze([319,769,1219].map(d=>d+FALL_END));
export function createWaterfallObstacles(){
 const out=[];let index=0;
 for(const distance of WATERFALL_SPIRE_DISTANCES){
  const p=routeAt(distance),side=index%2?-1:1,radius=18+(index%2)*3;
  const base=p.y-WATERFALL_RIVER_CLEARANCE,top=p.y+36+(index%2)*10;
  out.push({kind:'spire',distance,index,side,x:p.x+side*30,altitude:(base+top)/2,base,top,z:p.z,radius,thickness:top-base,hit:false});
  index++;
 }
 for(const distance of WATERFALL_TOTEM_DISTANCES){
  const p=routeAt(distance),side=index%2?1:-1,radius=14;
  const base=p.y-WATERFALL_RIVER_CLEARANCE,top=p.y+24;
  out.push({kind:'totem',distance,index,side,x:p.x+side*27,altitude:(base+top)/2,base,top,z:p.z,radius,thickness:top-base,hit:false});
  index++;
 }
 // The Hollow's hazards hang from, rise from or span the tunnel at (centre + side*across).
 for(const h of HOLLOW_HAZARDS){
  const p=hollowPath(h.distance),x=p.x+h.side*h.across;
  let base,top;
  if(h.kind==='stalactite'){top=p.y+p.r*.92;base=p.y-p.r*.15;}
  else if(h.kind==='crystal'){base=p.floor-6;top=p.y+50;}
  else if(h.kind==='geyser'){base=p.floor-4;top=p.y+60;}
  else{base=p.floor-6;top=p.y+p.r*.92;}
  out.push({kind:h.kind,distance:h.distance,index,side:h.side,x,altitude:(base+top)/2,base,top,z:-h.distance,radius:h.radius,thickness:top-base,hit:false,hollow:true,centre:{x:p.x,y:p.y},clear:p.clear,period:h.period,up:h.up,phase:h.phase});
  index++;
 }
 out.sort((a,b)=>a.distance-b.distance);
 return out;
}

// Compatibility helpers belong only to the retired waterfall.js prototype.
// Neither live game uses these helpers to move the player or the scenery.
export function createState(){const p=routeAt(0);return {distance:0,x:0,altitude:p.y,roll:0,pitch:p.pitch,elapsed:0,speed:FLIGHT_SPEED*speedMultiplier,speedMultiplier,mode:'ready',rings:0,hits:0};}
export function stepFlight(state,input,dt){if(state.mode!=='flying')return state;dt=clamp(Number(dt)||0,0,.05);const h=clamp(Number(input.x)||0,-1,1),v=clamp(Number(input.y)||0,-1,1);speedMultiplier=getSpeedMultiplier();state.speedMultiplier=speedMultiplier;state.speed=FLIGHT_SPEED*speedMultiplier;state.distance=Math.min(ROUTE_LENGTH,state.distance+state.speed*dt);const p=routeAt(state.distance);state.x=clamp(state.x+h*30*dt,-FLIGHT_LIMITS.side,FLIGHT_LIMITS.side);state.altitude=clamp(p.y+v*10,FLIGHT_LIMITS.minAltitude,FLIGHT_LIMITS.maxAltitude);const blend=1-Math.exp(-7*dt);state.pitch+=(p.pitch+v*.1-state.pitch)*blend;state.roll+=(-h*.3-state.roll)*blend;state.elapsed+=dt;if(state.distance>=ROUTE_LENGTH)state.mode='complete';return state;}
export function createHazards(){return Array.from({length:16},(_,index)=>{const distance=FALL_START+(ROUTE_LENGTH-FALL_START-400)*index/15,p=routeAt(distance);return {distance,index,x:p.x+(index%2?24:-24),altitude:p.y+(index%3-1)*18,radius:index>9?9:7,height:index>9?28:22,hit:false};});}
export function cameraPose(state,aspect=1){const back=aspect<.8?38:32;return {position:{x:0,y:8,z:back},target:{x:0,y:2,z:-34},back};}
