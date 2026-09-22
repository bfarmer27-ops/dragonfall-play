// Fireballs: a glowing core, an additive flame sprite, a smoke/ember trail, a point light on the high tier, and an
// explosion burst when they hit rock, a rider, or time out. Hit tests are simple distance checks the game feeds in.
// update() moves every ball in sub-steps of at most HIT_STEP metres and runs the hit test after each one, so a ball
// at 200-290 m/s can never jump over a 4 m boulder or a 7 m rider between two slow frames (20 fps = 10-14 m a frame).
// Trail particles spawn per second of game time (not per call) and are capped per tier, so a volley cannot pile up
// draw calls on a phone: every particle is one sprite = one draw call.
import * as THREE from 'three';
import {TIER} from './quality.js';
function radialTexture(inner='rgba(255,240,200,1)',mid='rgba(255,120,30,.55)',outer='rgba(255,60,0,0)'){
 const c=document.createElement('canvas');c.width=c.height=128;const g=c.getContext('2d');const grad=g.createRadialGradient(64,64,0,64,64,64);
 grad.addColorStop(0,inner);grad.addColorStop(.35,mid);grad.addColorStop(1,outer);g.fillStyle=grad;g.fillRect(0,0,128,128);
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;
}
const HIT_STEP=3;                 // metres a ball may travel between two hit tests (smallest boulder hit diameter is 8.2 m)
export function createFireballs({scene,maxBalls=6,onExplode=()=>{}}={}){
 const high=TIER==='high';
 const TRAIL_RATE=high?20:10;     // trail particles per second per ball
 const MAX_PARTICLES=high?160:48; // live sprites (trail + bursts) across all balls; beyond this, new ones are skipped
 const glowTex=radialTexture(),smokeTex=radialTexture('rgba(90,70,60,.55)','rgba(60,50,45,.25)','rgba(40,35,30,0)');
 const glowMat=new THREE.SpriteMaterial({map:glowTex,blending:THREE.AdditiveBlending,depthWrite:false,transparent:true,fog:false});
 const coreMat=new THREE.MeshBasicMaterial({color:0xffe2a0,fog:false});
 const smokeMat=new THREE.SpriteMaterial({map:smokeTex,depthWrite:false,transparent:true,opacity:.7});
 const balls=[],particles=[];
 const trailPool=[];
 function particle(pos,vel,life,scale,mat){
  if(particles.length>=MAX_PARTICLES)return;
  let s=trailPool.pop();if(!s){s=new THREE.Sprite(mat.clone());scene.add(s);}
  s.material=mat;s.position.copy(pos);s.scale.setScalar(scale);s.visible=true;
  particles.push({s,vel,life,age:0,scale0:scale});
 }
 const api={
  // origin/direction are world-space THREE.Vector3; speed in units/s; owner tags whose fireball it is (multiplayer).
  // maxBalls is a PER-OWNER cap: a friend's fire event must never burst one of your own live balls. A hard global
  // cap (4x) still bounds the scene when a whole room fires at once.
  fire({origin,direction,speed=140,owner='me',range=520}){
   const mine=balls.filter(b=>b.owner===owner);
   if(mine.length>=maxBalls)api.burst(mine[0],'timeout');
   if(balls.length>=maxBalls*4)api.burst(balls[0],'timeout');
   const g=new THREE.Group();
   const core=new THREE.Mesh(new THREE.SphereGeometry(.9,12,10),coreMat);g.add(core);
   const glow=new THREE.Sprite(glowMat);glow.scale.setScalar(7);g.add(glow);
   let light=null;if(high){light=new THREE.PointLight(0xff8a30,60,90,2);g.add(light);}
   g.position.copy(origin);scene.add(g);
   const b={g,core,glow,light,vel:direction.clone().normalize().multiplyScalar(speed),owner,age:0,life:range/speed,alive:true,trail:0};
   balls.push(b);return b;
  },
  // hits: (position:THREE.Vector3, ball) => 'rock' | 'rider' | 'player:<id>' | null ; called after every sub-step of
  // at most HIT_STEP metres for every live ball (a swept test), so nothing thinner than HIT_STEP can be jumped over.
  update(dt,hits=()=>null){
   for(const b of balls.slice()){
    if(!b.alive)continue;
    b.age+=dt;
    const pulse=1+Math.sin(b.age*40)*.12;b.glow.scale.setScalar(7*pulse);b.core.scale.setScalar(pulse);
    const n=Math.max(1,Math.ceil(b.vel.length()*dt/HIT_STEP)),sub=dt/n;
    let kind=null;
    for(let k=0;k<n&&!kind;k++){
     b.g.position.addScaledVector(b.vel,sub);b.vel.y-=6*sub; // slight arc
     kind=hits(b.g.position,b);
    }
    // Trail: TRAIL_RATE particles per second of game time, laid out along this frame's path behind the ball so a
    // slow frame still leaves an even streak instead of one clump.
    b.trail+=dt*TRAIL_RATE;const spawn=Math.floor(b.trail);b.trail-=spawn;
    for(let i=0;i<spawn;i++)particle(b.g.position.clone().addScaledVector(b.vel,-dt*(i+.5)/spawn),new THREE.Vector3((Math.random()-.5)*4,2+Math.random()*3,(Math.random()-.5)*4),.6+Math.random()*.5,1.6+Math.random()*1.2,Math.random()<.5?glowMat:smokeMat);
    if(kind||b.age>b.life)api.burst(b,kind||'timeout');
   }
   for(const p of particles.slice()){
    p.age+=dt;p.s.position.addScaledVector(p.vel,dt);const k=p.age/p.life;p.s.scale.setScalar(p.scale0*(1+k*1.8));p.s.material.opacity=Math.max(0,(1-k))*(p.s.material===glowMat?1:.7);
    if(p.age>=p.life){p.s.visible=false;particles.splice(particles.indexOf(p),1);trailPool.push(p.s);}
   }
  },
  burst(b,kind){
   if(!b||!b.alive)return;b.alive=false;balls.splice(balls.indexOf(b),1);scene.remove(b.g);
   const n=high?26:12;for(let i=0;i<n;i++){const v=new THREE.Vector3((Math.random()-.5)*2,(Math.random()-.2)*2,(Math.random()-.5)*2).normalize().multiplyScalar(14+Math.random()*26);particle(b.g.position,v,.5+Math.random()*.6,3+Math.random()*3,i%3?glowMat:smokeMat);}
   onExplode(b.g.position.clone(),kind,b.owner);
  },
  get live(){return balls;},
  dispose(){for(const b of balls.slice())api.burst(b,'dispose');for(const p of particles)scene.remove(p.s);for(const s of trailPool)scene.remove(s);}
 };
 return api;
}
