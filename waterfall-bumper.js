// A movement boundary for the complete animated dragon, independent of its heading.
// Measured authored animation: maximum vertex radius 21.971m; 24m leaves >2m.
export const WATERFALL_BUMPER_RADIUS = 24;
export const WATERFALL_BUMPER_SOFT_DISTANCE = 8;
const SWEEP_STEP = 2;
const lerp = (a,b,t) => ({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t});

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
  const distance=Math.hypot(candidate.x-previous.x,candidate.y-previous.y,candidate.z-previous.z);
  const slices=Math.max(1,Math.ceil(distance/SWEEP_STEP));
  let lastSafe=0;
  // Initial penetration can occur only from an external placement/debug reset.
  // Allow a move that reduces it; never teleport upward or deepen penetration.
  const startClearance=previous.y-startFloor;
  const minimumClearance=Math.min(0,startClearance);
  for(let i=1;i<=slices;i++) {
    const t=i/slices,p=lerp(previous,candidate,t);
    if(p.y-floorAt(p)<minimumClearance) {
      let lo=lastSafe,hi=t;
      for(let j=0;j<24;j++) {
        const mid=(lo+hi)/2,q=lerp(previous,candidate,mid);
        if(q.y-floorAt(q)>=minimumClearance)lo=mid;else hi=mid;
      }
      return {...lerp(previous,candidate,lo),active:true};
    }
    lastSafe=t;
  }
  return {...candidate,active:Math.abs(candidate.y-proposed.y)>1e-10};
}
