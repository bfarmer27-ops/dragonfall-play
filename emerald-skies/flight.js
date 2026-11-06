export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function newFlight(){return {distance:0,x:0,y:0,vx:0,vy:0,speed:44,health:3,rings:0,cooldown:0};}
export function stepFlight(s,input,dt){
 dt=clamp(dt,0,.05); s.cooldown=Math.max(0,s.cooldown-dt);
 const smoothing=1-Math.exp(-4*dt);
 s.vx+=(input.x*32-s.vx)*smoothing;s.vy+=(input.y*24-s.vy)*smoothing;
 s.x+=s.vx*dt;s.y+=s.vy*dt;
 s.speed+=(44+Math.min(22,s.distance/1200)-input.y*5-s.speed)*(1-Math.exp(-dt*2));
 s.distance+=s.speed*dt;
 let hit=false;
 if(Math.abs(s.x)>43||s.y< -17||s.y>65){
  if(s.cooldown===0){s.health--;s.cooldown=2;hit=true;}
  s.x=clamp(s.x,-42.8,42.8);s.y=clamp(s.y,-16.8,64.8);s.vx*=-.35;s.vy*=-.35;
 }
 return hit;
}
