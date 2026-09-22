// All game sound, synthesized with Web Audio. No sound files are loaded.
// Beds (continuous): wind, river water, waterfall roar, cloud rush. One-shots: wing flap, wall hit, gate bell,
// fireball launch, explosion, player hit. Everything routes through one master gain so mute is instant.
export function createAudio(){
 let ctx=null,master=null,enabled=false,reverb=null;
 const beds={};
 const now=()=>ctx.currentTime;
 function noiseBuffer(seconds,kind){
  const rate=ctx.sampleRate,buffer=ctx.createBuffer(1,Math.floor(rate*seconds),rate),data=buffer.getChannelData(0);
  let b0=0,b1=0,b2=0,last=0;
  for(let i=0;i<data.length;i++){const w=Math.random()*2-1;
   if(kind==='white')data[i]=w;
   else if(kind==='brown'){last=(last+.02*w)/1.02;data[i]=last*3.5;}
   else{b0=.99765*b0+w*.0990460;b1=.96300*b1+w*.2965164;b2=.57000*b2+w*1.0526913;data[i]=(b0+b1+b2+w*.1848)*.11;}}
  return buffer;
 }
 function loop(kind,seconds=3){const src=ctx.createBufferSource();src.buffer=noiseBuffer(seconds,kind);src.loop=true;src.start();return src;}
 function bed(name,kind,filterType,freq,q=1){
  const src=loop(kind),filter=ctx.createBiquadFilter(),gain=ctx.createGain();
  filter.type=filterType;filter.frequency.value=freq;filter.Q.value=q;gain.gain.value=0;
  src.connect(filter).connect(gain).connect(master);beds[name]={src,filter,gain};
 }
 function makeReverb(){
  const seconds=1.6,rate=ctx.sampleRate,buffer=ctx.createBuffer(2,rate*seconds,rate);
  for(let c=0;c<2;c++){const d=buffer.getChannelData(c);for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/d.length,2.6);}
  const conv=ctx.createConvolver();conv.buffer=buffer;const wet=ctx.createGain();wet.gain.value=.35;conv.connect(wet).connect(master);return conv;
 }
 function ensure(){
  if(ctx)return;
  ctx=new (globalThis.AudioContext||globalThis.webkitAudioContext)();
  master=ctx.createGain();master.gain.value=0;master.connect(ctx.destination);
  reverb=makeReverb();
  bed('wind','brown','bandpass',420,.7);
  bed('water','brown','lowpass',320,.5);
  bed('falls','pink','bandpass',700,.6);
  bed('cloud','white','bandpass',3200,.4);
 }
 function setBed(name,level,timeConstant=.25){const b=beds[name];if(b)b.gain.gain.setTargetAtTime(Math.max(0,level),now(),timeConstant);}
 // Short filtered-noise burst with a frequency sweep: the basis of whooshes and impacts.
 function burst({kind='pink',duration=.35,from=900,to=150,type='bandpass',q=1.2,level=.5,delay=0,toReverb=false}){
  const src=ctx.createBufferSource();src.buffer=noiseBuffer(duration+.05,kind);
  const f=ctx.createBiquadFilter();f.type=type;f.Q.value=q;const t=now()+delay;
  f.frequency.setValueAtTime(from,t);f.frequency.exponentialRampToValueAtTime(Math.max(20,to),t+duration);
  const g=ctx.createGain();g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(level,t+.02);g.gain.exponentialRampToValueAtTime(.001,t+duration);
  src.connect(f).connect(g).connect(master);if(toReverb&&reverb)g.connect(reverb);src.start(t);src.stop(t+duration+.05);
 }
 function tone({freq=220,to=freq,duration=.5,type='sine',level=.3,delay=0,toReverb=true}){
  const o=ctx.createOscillator(),g=ctx.createGain();const t=now()+delay;o.type=type;
  o.frequency.setValueAtTime(freq,t);o.frequency.exponentialRampToValueAtTime(Math.max(20,to),t+duration);
  g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(level,t+.01);g.gain.exponentialRampToValueAtTime(.001,t+duration);
  o.connect(g).connect(master);if(toReverb&&reverb)g.connect(reverb);o.start(t);o.stop(t+duration+.05);
 }
 const api={
  get enabled(){return enabled;},
  async enable(){ensure();if(ctx.state==='suspended')await ctx.resume();enabled=true;master.gain.setTargetAtTime(1,now(),.1);},
  disable(){if(!ctx)return;enabled=false;master.gain.setTargetAtTime(0,now(),.1);},
  async toggle(){if(enabled)api.disable();else await api.enable();return enabled;},
  // Called ~10x per second with the flight state. speed in world units/s (divide by the speed multiplier for feel),
  // alt = metres above water, falls = 0..1 closeness to the nearest waterfall, cloud = 0..1 inside mist/cloud.
  update({speed=0,alt=30,falls=0,cloud=0,playing=true}={}){
   if(!ctx||!enabled)return;
   const s=Math.max(0,speed);
   if(!playing){setBed('wind',.03);setBed('water',.02);setBed('falls',0);setBed('cloud',0);return;}
   setBed('wind',.06+s*.0022);beds.wind.filter.frequency.setTargetAtTime(300+s*9,now(),.3);
   setBed('water',.22/(1+Math.max(0,alt)/14));
   setBed('falls',.5*falls*falls);
   setBed('cloud',.3*cloud);beds.cloud.filter.frequency.setTargetAtTime(2200+s*12,now(),.2);
  },
  // Wing downstroke: a soft whoosh whose weight follows the flap strength (0..1).
  flap(strength=.7){if(!ctx||!enabled)return;burst({kind:'pink',duration:.32+strength*.15,from:700,to:140,level:.10+strength*.16,q:.8});burst({kind:'brown',duration:.18,from:120,to:60,type:'lowpass',level:.08*strength});},
  // Scraping a canyon wall or rock: crunch plus a low thud.
  hitWall(){if(!ctx||!enabled)return;burst({kind:'white',duration:.28,from:1800,to:300,level:.35,q:.5});burst({kind:'brown',duration:.5,from:200,to:40,type:'lowpass',level:.5});tone({freq:70,to:38,duration:.45,level:.35,type:'sine'});},
  // Passing a ring: a soft rising-and-falling air rush, not a bell.
  gate(){if(!ctx||!enabled){return;}burst({kind:'pink',duration:.5,from:2200,to:180,level:.34,q:.65,toReverb:true});burst({kind:'white',duration:.22,from:4200,to:900,level:.1,q:.8,delay:.03});},
  // Fireball leaves the dragon's mouth: a roar with a rising rush.
  fireball(){if(!ctx||!enabled)return;tone({freq:60,to:38,duration:.7,type:'sawtooth',level:.22});burst({kind:'pink',duration:.6,from:180,to:2400,level:.34,q:.9,toReverb:true});burst({kind:'brown',duration:.5,from:400,to:120,type:'lowpass',level:.25});},
  // Fireball bursts: near = 1 right beside you, 0 far away.
  explosion(near=1){if(!ctx||!enabled)return;const n=Math.max(.05,Math.min(1,near));burst({kind:'brown',duration:.9,from:260,to:40,type:'lowpass',level:.7*n,toReverb:true});burst({kind:'white',duration:.25,from:3000,to:400,level:.25*n});},
  // A fireball hit you (multiplayer) or you hit another rider.
  hitPlayer(){if(!ctx||!enabled)return;tone({freq:180,to:90,duration:.3,type:'square',level:.18});burst({kind:'pink',duration:.3,from:1200,to:300,level:.3});},
  // Flying through a cloud bank edge: a soft swell.
  cloudEnter(){if(!ctx||!enabled)return;burst({kind:'white',duration:.9,from:1500,to:4000,type:'bandpass',level:.14,q:.4});},
 };
 return api;
}
