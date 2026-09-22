import * as THREE from './vendor/three.module.js';
export function createEnvironment(renderer,scene){
 const loader=new THREE.TextureLoader();
 const cliffTexture=loader.load('./cliff-basalt.webp');cliffTexture.colorSpace=THREE.SRGBColorSpace;cliffTexture.wrapS=cliffTexture.wrapT=THREE.RepeatWrapping;cliffTexture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
 const skyTexture=loader.load('./aurora-sky.webp',texture=>{texture.mapping=THREE.EquirectangularReflectionMapping;const pmrem=new THREE.PMREMGenerator(renderer);const env=pmrem.fromEquirectangular(texture);scene.environment=env.texture;scene.environmentIntensity=.55;pmrem.dispose();});skyTexture.colorSpace=THREE.SRGBColorSpace;skyTexture.wrapS=THREE.RepeatWrapping;
 const skyMaterial=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:{uTime:{value:0},uSky:{value:skyTexture}},vertexShader:`varying vec3 vDir;void main(){vDir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,fragmentShader:`varying vec3 vDir;uniform sampler2D uSky;uniform float uTime;void main(){vec3 d=normalize(vDir);vec2 uv=vec2(atan(d.x,-d.z)/6.2831853+.5,clamp(.295+asin(d.y)/3.14159265*.91,.025,.99));uv.x+=uTime*.00014;vec3 c=texture2D(uSky,uv).rgb;float horizon=pow(1.-abs(d.y),14.);c=mix(c,vec3(.27,.37,.38),horizon*.25);gl_FragColor=vec4(c,1.);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 }`});
 const sky=new THREE.Mesh(new THREE.SphereGeometry(1800,48,28),skyMaterial);scene.add(sky);
 const cliffMat=new THREE.MeshStandardMaterial({color:0xbdc6c0,roughness:.91,metalness:.025,vertexColors:true,flatShading:false});
 cliffMat.onBeforeCompile=shader=>{shader.uniforms.uCliff={value:cliffTexture};shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vRock;varying vec3 vRockNormal;').replace('#include <begin_vertex>','#include <begin_vertex>\nvRock=(modelMatrix*vec4(position,1.)).xyz;vRockNormal=normalize(mat3(modelMatrix)*normal);');shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
 varying vec3 vRock;varying vec3 vRockNormal;uniform sampler2D uCliff;
 vec3 rockSample(vec3 p,vec3 n){vec3 w=pow(abs(n),vec3(5.));w/=max(w.x+w.y+w.z,.001);return texture2D(uCliff,p.yz).rgb*w.x+texture2D(uCliff,p.xz).rgb*w.y+texture2D(uCliff,p.xy).rgb*w.z;}`);shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
 vec3 rock=rockSample(vRock*.073,normalize(vRockNormal));vec3 fine=rockSample(vRock*.31,normalize(vRockNormal));diffuseColor.rgb*=rock*(.78+fine*.85);float wet=1.-smoothstep(0.,17.,vRock.y-vRock.z*.04);diffuseColor.rgb*=1.-wet*.3;`);};
 const waterMat=new THREE.ShaderMaterial({uniforms:{uTime:{value:0},uCamera:{value:new THREE.Vector3()},uSky:{value:skyTexture},fogColor:{value:scene.fog.color},fogDensity:{value:scene.fog.density},uDragon:{value:new THREE.Vector3()}},vertexShader:`varying vec3 vPos;varying float vDepth;void main(){vec4 w=modelMatrix*vec4(position,1.);vPos=w.xyz;vec4 mv=viewMatrix*w;vDepth=-mv.z;gl_Position=projectionMatrix*mv;}`,fragmentShader:`varying vec3 vPos;varying float vDepth;uniform float uTime;uniform vec3 uCamera;uniform sampler2D uSky;uniform vec3 fogColor;uniform float fogDensity;uniform vec3 uDragon;
 float wave(vec2 p){return sin(p.x*.42+p.y*.22+uTime*1.1)*.46+sin(p.x*.83-p.y*.36+uTime*1.7)*.2+sin(p.x*1.81+p.y*.81-uTime*2.1)*.085+sin(p.x*4.4-p.y*2.1+uTime*2.8)*.021;}
 vec3 skyColor(vec3 d){vec2 uv=vec2(atan(d.x,-d.z)/6.2831853+.5,clamp(.295+asin(clamp(d.y,-1.,1.))/3.14159265*.91,.025,.99));return texture2D(uSky,uv).rgb;}
 void main(){vec2 p=vPos.xz;float e=.085;float dx=wave(p+vec2(e,0.))-wave(p-vec2(e,0.));float dz=wave(p+vec2(0.,e))-wave(p-vec2(0.,e));vec3 n=normalize(vec3(-dx,1.6,-dz));vec3 view=normalize(uCamera-vPos);float fres=.035+.965*pow(1.-max(dot(n,view),0.),5.);vec3 reflectSky=skyColor(reflect(-view,n));vec3 base=vec3(.004,.085,.101);float current=wave(p*.14)*.04;base+=vec3(.004,.025,.025)*current;vec3 c=mix(base,reflectSky,fres*.82);float spec=pow(max(dot(reflect(-normalize(vec3(-.3,.38,-1.)),n),view),0.),135.);c+=vec3(.9,.96,.91)*spec*.5;float d=length((vPos.xz-uDragon.xz)/vec2(8.,4.));float shadow=exp(-d*d*1.4)*.36;c*=1.-shadow;float haze=1.-exp(-fogDensity*fogDensity*vDepth*vDepth);c=mix(c,fogColor,clamp(haze,0.,1.));gl_FragColor=vec4(c,1.);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 }`});
 return {sky,skyMaterial,cliffMat,waterMat};
}
