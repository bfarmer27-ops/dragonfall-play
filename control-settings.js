const KEY='dragonfall-invert-vertical-v1';
export function readInvertSetting(mode='thumbs'){try{const v=localStorage.getItem(mode==='tilt'?KEY+'-tilt':KEY);return v===null?mode!=='tilt':v!=='false';}catch{return mode!=='tilt';}}
export function saveInvertSetting(enabled,mode='thumbs'){try{localStorage.setItem(mode==='tilt'?KEY+'-tilt':KEY,String(enabled));}catch{/* Keep the choice for this session if storage is blocked. */}}
export function invertVerticalControls(left,right,enabled){
 // Negate average pitch while preserving differential bank.
 return enabled?[-right,-left]:[left,right];
}

// Two thumbs is the default on every device (Ryan's order 2026-09-09); phone tilt stays selectable in Settings.
export function readControlMode(){try{return localStorage.getItem('dragonfall-control-mode')==='tilt'?'tilt':'thumbs';}catch{return 'thumbs';}}
export function saveControlMode(mode){try{localStorage.setItem('dragonfall-control-mode',mode);}catch{}}
