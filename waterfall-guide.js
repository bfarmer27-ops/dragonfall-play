// A screen marker only. Selection reads physical ring planes and the player's
// actual position; it never moves the camera, dragon, course, or score.
import {Vector3} from './vendor/three.module.js';

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

export function createWaterfallGuide({container,camera,gates}) {
 const doc=container.ownerDocument,root=doc.createElement('div');
 root.className='waterfall-guide';root.setAttribute('aria-hidden','true');
 root.style.cssText='position:absolute;inset:0;pointer-events:none;z-index:4;overflow:hidden;display:none';
 const marker=doc.createElement('div');
 marker.style.cssText='position:absolute;display:flex;flex-direction:column;align-items:center;gap:4px;transform:translate(-50%,-50%);color:#ffe9a1;text-shadow:0 1px 4px #102d30,0 0 2px #000;font:600 11px/1.25 Manrope,Arial,sans-serif;white-space:nowrap';
 const icon=doc.createElement('span');
 icon.style.cssText='display:block;width:17px;height:17px;font-size:21px;line-height:17px;text-align:center';
 const label=doc.createElement('span');
 label.style.cssText='padding:4px 7px;border-radius:4px;background:#092f36b8;border:1px solid #ffe9a13d;max-width:145px;text-align:center';
 marker.append(icon,label);root.append(marker);container.append(root);
 const world=new Vector3(),projected=new Vector3(),view=new Vector3();
 let previousIndex=null,disposed=false;
 function update(flight) {
  if(disposed)return null;
  if(!doc.body.classList.contains('playing')){root.style.display='none';return null;}
  const target=selectWaterfallTarget(gates,flight,previousIndex);
  if(!target){root.style.display='none';previousIndex=null;return null;}
  previousIndex=target.index;
  world.set(target.center.x,target.center.y,target.center.z);
  camera.updateMatrixWorld();view.copy(world).applyMatrix4(camera.matrixWorldInverse);
  projected.copy(world).project(camera);
  const position=guideScreenPoint({x:projected.x,y:projected.y,behind:view.z>=0},container.clientWidth,container.clientHeight);
  root.style.display='block';marker.style.left=`${position.x}px`;marker.style.top=`${position.y}px`;
  icon.textContent=position.offscreen?'\u2191':'\u25c7';
  icon.style.transform=position.offscreen?`rotate(${position.angle}deg)`:'none';
  label.textContent=`${Math.round(target.distance)} m \u00b7 ${target.cue}`;
  root.dataset.ring=String(target.index);root.dataset.offscreen=String(position.offscreen);
  return target;
 }
 return {element:root,update,reset(){previousIndex=null;root.style.display='none';},dispose(){disposed=true;root.remove();}};
}
