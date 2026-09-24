// Physical target selection never moves the camera, dragon, course, or score.
// Ryan removed the on-screen direction popup; ring visibility still uses selection.

function forwardOf(flight) {
 const q=flight.orientation||{x:0,y:0,z:0,w:1};
 return {x:-2*(q.x*q.z+q.w*q.y),y:2*(q.w*q.x-q.y*q.z),z:2*(q.x*q.x+q.y*q.y)-1};
}

export function waterfallGuideCue(normal,forward) {
 if(normal.y<-.94)return 'Straight down';
 if(normal.y<-.15)return forward.y<normal.y-.07?'Ease up':'Ease down';
 if(normal.y>.15)return 'Climb gently';
 return 'Level flight';
}

export function selectWaterfallTarget(gates,flight,previousIndex=null) {
 const forward=forwardOf(flight),candidates=[];
 for(let index=0;index<gates.length;index++) {
  const gate=gates[index],ring=gate.ring;
  if(!ring||gate.caught||gate.passed)continue;
  const center=ring.center||{x:ring.x,y:ring.altitude,z:ring.z},normal=ring.normal;
  if(!center||!normal)continue;
  const dx=center.x-flight.x,dy=center.y-flight.alt,dz=center.z-flight.z;
  const distance=Math.hypot(dx,dy,dz),ahead=dx*normal.x+dy*normal.y+dz*normal.z;
  if(!Number.isFinite(distance)||ahead<-.05)continue;
  const alignment=normal.x*forward.x+normal.y*forward.y+normal.z*forward.z;
  // At a bend the nearest physical opening remains the target. Opposite-facing
  // course sections receive a penalty so a nearby return leg cannot steal it.
  const score=distance+(alignment<-.25?180:0);
  candidates.push({gate,index,center,normal,distance,score,cue:waterfallGuideCue(normal,forward)});
 }
 if(!candidates.length)return null;
 candidates.sort((a,b)=>a.score-b.score||a.index-b.index);
 const nearest=candidates[0],previous=candidates.find(c=>c.index===previousIndex);
 // Small hysteresis prevents flicker between neighbouring openings while the
 // plane test above guarantees a missed ring cannot remain the target behind us.
 return previous&&previous.score<nearest.score+8?previous:nearest;
}

export function guideScreenPoint({x,y,behind},width,height) {
 // A target exactly on the camera plane has an infinite projection. Its
 // direction is still meaningful, so clamp that projection before edge math.
 if(!Number.isFinite(x))x=Math.sign(x)||0;
 if(!Number.isFinite(y))y=Math.sign(y)||0;
 const offscreen=behind||Math.abs(x)>.82||Math.abs(y)>.72;
 let dx=x*width/2,dy=-y*height/2;
 if(behind){dx=-dx;dy=-dy;if(Math.hypot(dx,dy)<1)dy=1;}
 const angle=Math.atan2(dy,dx)*180/Math.PI+90;
 // Leave room for the distance label, including at the narrow phone edges.
 const left=80,right=width-80,top=88,bottom=height-70;
 const cx=width/2,cy=height/2;
 if(offscreen){
  const sx=(dx<0?cx-left:right-cx)/Math.max(.001,Math.abs(dx));
  const sy=(dy<0?cy-top:bottom-cy)/Math.max(.001,Math.abs(dy));
  const scale=Math.min(sx,sy);dx*=scale;dy*=scale;
 }
 return {x:Math.max(left,Math.min(right,cx+dx)),y:Math.max(top,Math.min(bottom,cy+dy)),angle,offscreen};
}

// Keep the game/debug lifecycle API while drawing no target or contact popup.
// Selection remains available for nearby physical rings, independently of this UI.
export function createWaterfallGuide({container,gates}) {
 const root=container.ownerDocument.createElement('div');
 root.className='waterfall-guide';root.hidden=true;root.setAttribute('aria-hidden','true');
 container.append(root);
 let previousIndex=null,disposed=false;
 return {
  element:root,
  update(flight) {
   if(disposed)return null;
   const target=selectWaterfallTarget(gates,flight,previousIndex);
   previousIndex=target?.index??null;
   return target;
  },
  reset(){previousIndex=null;},
  dispose(){disposed=true;root.remove();}
 };
}
