const KEY='dragonfall-invert-vertical-v1';
export function readInvertSetting(mode='thumbs'){try{const v=localStorage.getItem(mode==='tilt'?KEY+'-tilt':KEY);return v===null?mode!=='tilt':v!=='false';}catch{return mode!=='tilt';}}
export function saveInvertSetting(enabled,mode='thumbs'){try{localStorage.setItem(mode==='tilt'?KEY+'-tilt':KEY,String(enabled));}catch{/* Keep the choice for this session if storage is blocked. */}}
export function invertVerticalControls(left,right,enabled){
 // Negate average pitch while preserving differential bank.
 return enabled?[-right,-left]:[left,right];
}

// A thumb dragged to the phone edge is a full command, even when the visible
// stick cannot provide the full travel distance near the bottom of the screen.
export function normalizeThumbInput(startY,currentY,range,viewportHeight){
 const travel=Math.max(1,Number(range)||1),displacement=Number(startY)-Number(currentY);
 let value=Math.max(-1,Math.min(1,displacement/travel));
 const edgeBand=Math.max(10,Math.min(24,(Number(viewportHeight)||0)*.03));
 if(displacement>0&&currentY<=edgeBand)value=1;
 if(displacement<0&&currentY>=viewportHeight-edgeBand)value=-1;
 return Math.abs(value)<.02?0:Math.sign(value)*(Math.abs(value)-.02)/.98;
}

// Two thumbs is the default on every device (Ryan's order 2026-09-09); phone tilt stays selectable in Settings.
export function readControlMode(){try{return localStorage.getItem('dragonfall-control-mode')==='tilt'?'tilt':'thumbs';}catch{return 'thumbs';}}
export function saveControlMode(mode){try{localStorage.setItem('dragonfall-control-mode',mode);}catch{}}
