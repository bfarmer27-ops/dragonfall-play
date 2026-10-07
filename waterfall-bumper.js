// A movement boundary for the complete animated dragon, independent of its heading.
// Measured authored animation: maximum vertex radius 21.971m; 24m leaves >2m.
export const WATERFALL_BUMPER_RADIUS = 24;
export const WATERFALL_BUMPER_SOFT_DISTANCE = 8;
const SWEEP_STEP = 2;
const lerp = (a,b,t) => ({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t});

// Fraction (0..1) of the straight move from a to b that keeps the bumper clear of the surface.
function sweep(a, b, floorAt, minimumClearance) {
  const distance=Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z);
  const slices=Math.max(1,Math.ceil(distance/SWEEP_STEP));
  let lastSafe=0;
  for(let i=1;i<=slices;i++) {
    const t=i/slices,p=lerp(a,b,t);
    if(p.y-floorAt(p)<minimumClearance) {
      let lo=lastSafe,hi=t;
      for(let j=0;j<24;j++) {
        const mid=(lo+hi)/2,q=lerp(a,b,mid);
        if(q.y-floorAt(q)>=minimumClearance)lo=mid;else hi=mid;
      }
      return lo;
    }
    lastSafe=t;
  }
  return 1;
}

// surfaceHeight(x,z,radius) must return the highest real surface under the whole
// horizontal footprint, or -Infinity where no surface exists. The environment
// supplies a conservative maximum over intersecting terrain and water cells.
// No rotation enters this function. Contact never levels or steers the player.
export function limitWaterfallMovement(previous, proposed, surfaceHeight) {
  if (typeof surfaceHeight !== 'function') return {...proposed,active:false};
  const floorAt = p => surfaceHeight(p.x,p.z,WATERFALL_BUMPER_RADIUS)+WATERFALL_BUMPER_RADIUS;
  const startFloor=floorAt(previous),endFloor=floorAt(proposed);
  let candidate={...proposed};
  // Brake only the downward component above water: sideways flight and manual
  // upward escape remain responsive. A rising ground edge is swept below.
  if(candidate.y<previous.y) {
    const clearance=previous.y-Math.max(startFloor,endFloor);
    const gain=Math.min(1,Math.max(0,clearance/WATERFALL_BUMPER_SOFT_DISTANCE));
    candidate.y=previous.y+(candidate.y-previous.y)*gain;
  }
  // Initial penetration can occur only from an external placement/debug reset.
  // Allow a move that reduces it; never teleport upward or deepen penetration.
  const startClearance=previous.y-startFloor;
  const minimumClearance=Math.min(0,startClearance);
  const safe=sweep(previous,candidate,floorAt,minimumClearance);
  if(safe>=1) return {...candidate,active:Math.abs(candidate.y-proposed.y)>1e-10};
  // Blocked: slide along the surface instead of freezing in front of it (Ryan, 2026-10-07: the dragon
  // stopped dead in front of the gold orb beside the river bank). First ride up over the edge, rising at
  // most as far as the move goes sideways; then try the move without its sideways (x) part, which also
  // covers the Hollow, whose floorAt reports the CEILING near the side walls so rising cannot help there.
  const contact=lerp(previous,candidate,safe);
  const rest={x:candidate.x-contact.x,y:candidate.y-contact.y,z:candidate.z-contact.z};
  const across=Math.hypot(rest.x,rest.z);
  const target={x:contact.x+rest.x,y:contact.y+rest.y,z:contact.z+rest.z};
  const needed=floorAt(target)+minimumClearance-target.y+1e-3;
  for(const lift of [Math.min(across,Math.max(0,needed)),across]) {
    if(!(lift>0)) continue;
    const lifted={...target,y:target.y+lift};
    if(sweep(contact,lifted,floorAt,minimumClearance)>=1) return {...lifted,active:true};
  }
  const straight={x:contact.x,y:target.y,z:target.z};
  if(sweep(contact,straight,floorAt,minimumClearance)>=1) return {...straight,active:true};
  // A terrain step taller than one move: climb straight up (again at most the move's sideways length) so the
  // next moves get over it, instead of stopping in the same place every frame.
  const climb={x:contact.x,y:contact.y+Math.min(across,Math.max(0,needed)),z:contact.z};
  if(climb.y>contact.y&&sweep(contact,climb,floorAt,minimumClearance)>=1) return {...climb,active:true};
  return {...contact,active:true};
}
