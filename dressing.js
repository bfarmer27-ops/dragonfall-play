// World dressing: sheet waterfalls (scrolling noise sheets, some doubled into wide curtains), base spray + a tall spray
// shaft that catches the sun, drifting low mist banks, a far "water haze" band over the river, and distant flapping birds.
// Everything is pooled and recycled ahead of the rider; nothing is allocated per frame.
// Fog: the ShaderMaterials follow the contract pattern (fog:true, cloned UniformsLib.fog, mvPosition + <fog_vertex>,
// <fog_fragment> BEFORE tonemapping/colorspace) so sky.js's global height fog applies with zero plumbing.
// All sprites/planes are transparent, so render.js hides them during its AO/DOF pre-passes automatically.
import * as THREE from 'three';
import {centerAt} from './flight.js';
import {TIER} from './quality.js';
import {terrainHeight,edgeAt,worldSlope} from './terrain.js';

const hash=(a,b=0)=>{const n=Math.sin(a*127.1+b*311.7)*43758.5453;return n-Math.floor(n);};

// Waterfall placement rule (exported so the dev page and integration can compute where the next fall is):
// one every ~220 m from 230 m on, every third one (n % 3 == 2) is a wide two-sheet curtain.
export const FALL_SPACING=220,FALL_FIRST=230;
export function fallPlacement(n){
 const d=FALL_FIRST+n*FALL_SPACING+(hash(n,11)-.5)*50;
 const side=hash(n,12)<.5?-1:1;
 const curtain=n%3===2;
 const width=curtain?28:10+hash(n,13)*10;
 return {n,d,side,curtain,width};
}
// Index of the first waterfall still ahead of flown distance d (use fallPlacement(n) for its details).
export function nextWaterfall(d){
 let n=Math.max(0,Math.floor((d-FALL_FIRST-25)/FALL_SPACING));
 while(fallPlacement(n).d<d)n++;
 return n;
}

// A soft puff texture (radial falloff x noise) drawn once on a canvas; used by every mist sprite.
function makePuffTexture(noiseImage){
 const size=256,c=document.createElement('canvas');c.width=c.height=size;const ctx=c.getContext('2d');
 const g=ctx.createRadialGradient(size/2,size/2,0,size/2,size/2,size/2);g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(.55,'rgba(255,255,255,.45)');g.addColorStop(1,'rgba(255,255,255,0)');
 ctx.fillStyle=g;ctx.fillRect(0,0,size,size);
 if(noiseImage){ctx.globalCompositeOperation='multiply';ctx.drawImage(noiseImage,0,0,size,size);ctx.globalCompositeOperation='destination-in';ctx.fillStyle=g;ctx.fillRect(0,0,size,size);}
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;
}

// createDressing({scene, renderer, sunColor, sunDirection}) -> {update(time, flight), reset(), dispose()}
export function createDressing({scene,renderer,sunColor=new THREE.Color(0xffd7a8),sunDirection=new THREE.Vector3(-.18,.21,-.90).normalize()}){
 const tier=TIER;// read at call time
 const high=tier==='high';
 const time={value:0};
 const loader=new THREE.TextureLoader();
 const noise=loader.load(new URL('./assets/noise_512.png',import.meta.url).href);noise.wrapS=noise.wrapT=THREE.RepeatWrapping;
 // The puff texture needs the noise image pixels; until the image arrives a plain radial puff is used, then rebuilt once.
 let puff=makePuffTexture(null),puffRebuilt=false;
 const sunDir=sunDirection.clone().normalize();
 const disposables=[noise,puff];

 // --- Waterfalls -------------------------------------------------------------------------------------------------
 const fallMat=new THREE.ShaderMaterial({
  transparent:true,depthWrite:false,side:THREE.DoubleSide,fog:true,
  // UniformsUtils.merge would clone `time`; spread a clone of the fog uniforms and keep our shared object references.
  uniforms:{...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),uTime:time,uNoise:{value:noise},uSun:{value:sunColor},uSunDir:{value:sunDir}},
  vertexShader:`varying vec2 vUv;varying float vSunlit;uniform vec3 uSunDir;
   #include <fog_pars_vertex>
   void main(){
    vUv=uv;
    // The sheet faces +Z in its own space; sunlit when its face (either side) points toward the sun.
    vec3 n=normalize(mat3(modelMatrix)*vec3(0.,0.,1.));
    vSunlit=smoothstep(.3,.7,abs(dot(n,uSunDir)));
    vec4 w=modelMatrix*vec4(position,1.);
    vec4 mvPosition=viewMatrix*w;
    gl_Position=projectionMatrix*mvPosition;
    #include <fog_vertex>
   }`,
  fragmentShader:`varying vec2 vUv;varying float vSunlit;uniform float uTime;uniform sampler2D uNoise;uniform vec3 uSun;
   #include <fog_pars_fragment>
   void main(){
    // Three streak octaves (18 / 37 / 70 columns across the sheet) at different speeds plus a slow wide swell. The old
    // single 5-column sample with a hard smoothstep(.3,.75) drew 4-6 white bars (a barcode); a soft knee at .45-.65
    // over the sum keeps every strand under ~3% of the sheet width.
    // Vertical stretch 3-9 (was up to 60 m per noise unit): each strand now breaks up every ~8-20 m down the sheet
    // instead of running the full height as one line of a comb.
    float n1=texture2D(uNoise,vec2(vUv.x*18.,vUv.y*3.+uTime*.6)).r;
    float n2=texture2D(uNoise,vec2(vUv.x*37.+.3,vUv.y*6.+uTime*1.2)).r;
    float n3=texture2D(uNoise,vec2(vUv.x*70.+.7,vUv.y*9.+uTime*1.8)).r;
    float n4=texture2D(uNoise,vec2(vUv.x*1.3,vUv.y*.35+uTime*.2)).r;
    float streak=smoothstep(.42,.62,n1*.5+n2*.3+n3*.1+n4*.1);
    float edge=smoothstep(0.,.25,vUv.x)*smoothstep(1.,.75,vUv.x);
    // Alpha 0 at the lip, full by 25% down, fading again over the bottom 15% into the foot spray.
    float body=smoothstep(1.,.75,vUv.y)*smoothstep(0.,.15,vUv.y);
    // A faint continuous veil (n4) sits behind the strands so the sheet reads as one falling mass, not separate lines.
    float alpha=(streak*.75+n4*.35)*edge*body;
    // Peak 1.05 linear (under the bloom threshold); a sun-facing core may reach 1.5 so only the lit sheet glows.
    vec3 col=mix(vec3(.62,.72,.78),vec3(1.05,1.02,.98),streak)*mix(vec3(1.),uSun,.35);
    col*=1.+.43*vSunlit*streak;
    gl_FragColor=vec4(col,alpha*.6);
    #include <fog_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`
 });
 const sprayMat=new THREE.SpriteMaterial({map:puff,color:0xc4ced2,transparent:true,opacity:.28,depthWrite:false,fog:true});
 // Second, wider and denser mist puff at the foot so the sheet dissolves into spray instead of ending on a line.
 const spray2Mat=new THREE.SpriteMaterial({map:puff,color:0xc4ced2,transparent:true,opacity:.4,depthWrite:false,fog:true});
 const shaftMat=new THREE.SpriteMaterial({map:puff,color:0xd8dcd6,transparent:true,opacity:.12,depthWrite:false,fog:true});
 const fallCount=high?6:4,falls=[];
 const fallGeo=new THREE.PlaneGeometry(1,1,1,8);
 function placeFall(f,n){
  const p=fallPlacement(n);
  f.n=n;f.d=p.d;
  const {d,side,curtain,width}=p,edge=edgeAt(d),center=centerAt(d);
  // The sheet foot stands 2 m outside the canyon edge (the wall is near-vertical there, so the foot meets the water in
  // front of the rock) and its top leans 8 m back into the wall, where the face has receded, so the whole sheet stays
  // in front of the rock instead of the lower half being buried inside it. It is turned ~25 degrees off the rider's
  // line of sight so it is seen face-on on approach (an exactly wall-parallel sheet would be edge-on and vanish).
  const footX=center+side*(edge+2);
  const top=Math.max(30,terrainHeight(footX+side*10,d)*.86+4);
  const base=-d*worldSlope,height=top+5,lean=Math.atan2(8,height);
  const x=footX+side*4;// sheet centre, halfway along the lean
  f.x=x;f.y=base;f.top=top;f.side=side;f.width=width;f.curtain=curtain;
  f.sheet.position.set(x,(top-5)/2+base,-d);
  f.sheet.scale.set(width,height,1);
  f.sheet.rotation.order='ZYX';// yaw toward the rider first, then lean the top into the wall about the WORLD z axis
  f.sheet.rotation.set(0,side*.45,-side*lean);
  // Curtain: a second, offset sheet overlapping the first (v066 frames 2 and 6).
  f.sheet2.visible=curtain;
  if(curtain){
   f.sheet2.position.set(x+side*3,(top-5)/2+base+6,-d+9);
   f.sheet2.scale.set(width*.8,height+6,1);
   f.sheet2.rotation.order='ZYX';
   f.sheet2.rotation.set(0,side*.35,-side*lean);
  }
  // Base spray: a low, modest puff (<= 35 m wide). Big bright sprites read as a white glare in the sun, not as spray.
  const sprayW=Math.min(35,width*1.6);
  f.spray.position.set(footX-side*4,-2+base,-d);
  f.spray.scale.set(sprayW,sprayW*.5,1);
  // Spray shaft: tall thin sprite standing over the base to catch the sun.
  f.shaft.position.set(footX-side*3,12+base,-d+2);
  f.shaft.scale.set(8,30,1);
  // Wide foot spray (placed after the shaft: on phone the same sprite object serves as both, and this placement wins).
  f.spray2.position.set(footX-side*5,1+base,-d+1);
  f.spray2.scale.set(sprayW*1.4,sprayW*.6,1);
 }
 for(let i=0;i<fallCount;i++){
  const sheet=new THREE.Mesh(fallGeo,fallMat),sheet2=new THREE.Mesh(fallGeo,fallMat);
  const spray=new THREE.Sprite(sprayMat),shaft=new THREE.Sprite(shaftMat);
  // Phone keeps the draw-call budget (<= 110): the tall spray shaft is a high-only sprite, so on phone that same
  // sprite object is re-used as the wide foot spray instead of adding a draw call.
  const spray2=high?new THREE.Sprite(spray2Mat):shaft;
  if(high)scene.add(spray2);else{shaft.material=spray2Mat;spray.visible=false;}// phone: the wide puff alone marks the foot (same call count as before)
  scene.add(sheet,sheet2,spray,shaft);
  const f={sheet,sheet2,spray,shaft,spray2};placeFall(f,i);falls.push(f);
 }
 // --- Mist banks -------------------------------------------------------------------------------------------------
 // Mist banks: wide, LOW and thin, hugging the water like the reference; never closer than 90 m ahead of the rider
 // when spawned so a bank cannot sit on the camera as a bright veil.
 const bankMat=new THREE.SpriteMaterial({map:puff,color:0xb8c2c6,transparent:true,opacity:high?.14:.11,depthWrite:false,fog:true});
 const bankCount=high?12:6,banks=[];
 function placeBank(b,n){
  b.n=n;const d=90+n*(high?110:220)+hash(n,21)*80;b.d=d;
  const x=centerAt(d)+(hash(n,22)-.5)*70,y=-1+hash(n,23)*7;
  b.sprite.position.set(x,y-d*worldSlope,-d);
  b.sprite.scale.set(60+hash(n,24)*70,9+hash(n,25)*8,1);
 }
 for(let i=0;i<bankCount;i++){const sprite=new THREE.Sprite(bankMat);scene.add(sprite);const b={sprite};placeBank(b,i);banks.push(b);}
 // --- Water haze -------------------------------------------------------------------------------------------------
 // Four very wide, very faint bands over the river 150-600 m ahead so the far river always reads misty. They live at
 // fixed world slots of 150 m (never locked to the camera, which would read as a smudge on the lens).
 const hazeMat=new THREE.SpriteMaterial({map:puff,color:0xaebcc2,transparent:true,opacity:.08,depthWrite:false,fog:true});
 const hazes=[];
 for(let i=0;i<4;i++){const s=new THREE.Sprite(hazeMat);s.scale.set(200,14,1);scene.add(s);hazes.push(s);}
 function placeHazes(distance){
  const slot0=Math.floor((distance+150)/150);
  for(let i=0;i<4;i++){const d=(slot0+i)*150;hazes[i].position.set(centerAt(d),2-d*worldSlope,-d);}
 }
 placeHazes(0);
 // --- Birds ------------------------------------------------------------------------------------------------------
 const birdCount=high?22:12;
 const pos=[],flap=[],phase=[];
 for(let i=0;i<birdCount;i++){
  const x=(hash(i,2)-.5)*170,y=70+hash(i,8)*100,z=-150-hash(i,1)*800,s=1.4+hash(i,4);
  // Two triangles per bird: body point + wing tip + tail point. aFlap = 1 on wing tips so the vertex shader can flap them.
  pos.push(x,y,z,x-s*1.8,y,z+s*.3,x,y,z+s*.7,  x,y,z,x,y,z+s*.7,x+s*1.8,y,z+s*.3);
  flap.push(0,1,0,0,0,1);const ph=hash(i,9)*6.28;for(let k=0;k<6;k++)phase.push(ph);
 }
 const birdGeo=new THREE.BufferGeometry();
 birdGeo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
 birdGeo.setAttribute('aFlap',new THREE.Float32BufferAttribute(flap,1));
 birdGeo.setAttribute('aPhase',new THREE.Float32BufferAttribute(phase,1));
 const birdMat=new THREE.ShaderMaterial({side:THREE.DoubleSide,fog:true,
  uniforms:{...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),uTime:time},
  vertexShader:`attribute float aFlap;attribute float aPhase;uniform float uTime;
   #include <fog_pars_vertex>
   void main(){
    vec3 p=position;p.y+=aFlap*sin(uTime*7.5+aPhase)*1.1;
    vec4 mvPosition=modelViewMatrix*vec4(p,1.);
    gl_Position=projectionMatrix*mvPosition;
    #include <fog_vertex>
   }`,
  fragmentShader:`
   #include <fog_pars_fragment>
   void main(){
    gl_FragColor=vec4(vec3(.05,.06,.07),1.);
    #include <fog_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`});
 const birds=new THREE.Mesh(birdGeo,birdMat);birds.frustumCulled=false;scene.add(birds);

 // --- Per-frame ----------------------------------------------------------------------------------------------------
 function rebuildPuff(){
  const img=noise.image;
  if(puffRebuilt||!img||!img.width)return;
  puffRebuilt=true;
  const next=makePuffTexture(img);
  for(const m of[sprayMat,spray2Mat,shaftMat,bankMat,hazeMat]){m.map=next;m.needsUpdate=true;}
  disposables.push(next);
 }
 function update(t,flight){
  time.value=t;
  rebuildPuff();
  const d=flight.distance;
  for(const f of falls){if(f.d<d-120)placeFall(f,f.n+fallCount);f.spray.material.opacity=.26+Math.sin(t*.7+f.n)*.04;}
  for(const b of banks){if(b.d<d-80)placeBank(b,b.n+bankCount);b.sprite.position.x+=Math.sin(t*.13+b.n)*.004;}
  placeHazes(d);
  birds.position.set(centerAt(d),-d*worldSlope,-d-Math.sin(t*.06)*100);
 }
 function reset(){
  falls.forEach((f,i)=>placeFall(f,i));
  banks.forEach((b,i)=>placeBank(b,i));
  placeHazes(0);
 }
 // World-space positions of everything that makes a sound, for the audio module: each waterfall's foot
 // (x, y = water level, z), its flown distance d, side (-1 left / +1 right), width, height and whether it is a wide
 // curtain; and the centre of every mist bank. Cheap to call every frame (only the two returned arrays are allocated).
 function sources(){
  return {
   waterfalls:falls.map(f=>({n:f.n,d:f.d,x:f.x,y:f.y,z:-f.d,side:f.side,width:f.width,height:f.top,curtain:f.curtain})),
   mist:banks.map(b=>({n:b.n,d:b.d,x:b.sprite.position.x,y:b.sprite.position.y,z:b.sprite.position.z}))
  };
 }
 function dispose(){
  for(const f of falls)scene.remove(f.sheet,f.sheet2,f.spray,f.shaft,f.spray2);
  for(const b of banks)scene.remove(b.sprite);
  for(const h of hazes)scene.remove(h);
  scene.remove(birds);
  fallGeo.dispose();birdGeo.dispose();
  for(const m of[fallMat,sprayMat,spray2Mat,shaftMat,bankMat,hazeMat,birdMat])m.dispose();
  for(const t of disposables)t.dispose();
 }
 return {update,reset,dispose,sources,falls,banks,hazes,birds,materials:{fallMat,sprayMat,spray2Mat,shaftMat,bankMat,hazeMat,birdMat}};
}
