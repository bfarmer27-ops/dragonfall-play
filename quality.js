// Shared graphics tier for every module. 'high' = desktop / strong GPU; 'phone' = handheld or weak GPU.
// Modules read TIER at import time so they agree; game.js may call setTier() before creating the scene if the user picks one in Settings.
export const TIERS=['auto','high','phone'];
function guess(){
 try{const forced=localStorage.getItem('dragonfall-graphics');if(forced==='high'||forced==='phone')return forced;}catch{}
 const ua=navigator.userAgent||'';const mobile=/Android|iPhone|iPad|iPod|Mobile/i.test(ua)||(navigator.maxTouchPoints>1&&Math.min(screen.width,screen.height)<900);
 const cores=navigator.hardwareConcurrency||4,mem=navigator.deviceMemory||4;
 return (mobile||cores<=4||mem<=4)?'phone':'high';
}
export let TIER=guess();
export function setTier(t){TIER=t==='auto'?guess():t;try{localStorage.setItem('dragonfall-graphics',t);}catch{}return TIER;}
export function readTierSetting(){try{return localStorage.getItem('dragonfall-graphics')||'auto';}catch{return 'auto';}}
// Budgets each module should respect per tier.
export const BUDGET={
 high:{maxPixelRatio:2,shadowMap:2048,postFX:true,gtao:true,dof:true,smaa:true,bloom:true,transmission:true,textureSize:'2k',cloudSteps:24},
 phone:{maxPixelRatio:2,shadowMap:1024,postFX:true,gtao:false,dof:false,smaa:false,bloom:true,transmission:false,textureSize:'1k',cloudSteps:10}
};
