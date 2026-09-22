// River water: MeshStandardMaterial with two scrolling normal-map layers, HDRI reflection through the scene environment,
// teal depth absorption by distance from shore, shore foam plus a faint centre-current foam line, sun glitter,
// canyon-wall reflection occlusion, and the real dragon shadow (receiveShadow on the river meshes) from the sun's
// shadow map. Fog and tone mapping come from the standard chunks (sky.js overrides them globally), so no fog code here.
import * as THREE from 'three';
import {TIER} from './quality.js';

// Two colour moods: 'teal' (v080: opaque bright river) and 'dark' (v059/v066: near-black mirror between dark walls).
const MOODS={
 teal:{deep:0x0c3a44,shallow:0x3a8c92},   // muted teal (v080); 0x2c9da3 read as a saturated cyan plate
 dark:{deep:0x06262c,shallow:0x1b5c62}
};

// createWater({renderer}) -> {material, update(time)}. update() writes material.userData.uniforms.uTime.
export function createWater({renderer}){
 const tier=TIER;// read at call time so a dev page can pick the tier first
 const loader=new THREE.TextureLoader();
 const asset=name=>new URL('./assets/'+name,import.meta.url).href;// module-relative so dev pages work too
 const normalMap=loader.load(asset('water_normal_512.png'));normalMap.wrapS=normalMap.wrapT=THREE.RepeatWrapping;normalMap.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());
 const noise=loader.load(asset('noise_512.png'));noise.wrapS=noise.wrapT=THREE.RepeatWrapping;
 const material=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.09,metalness:0,envMapIntensity:.7});
 // Deep/shallow are the water's own (diffuse) colour: the reference rivers are opaque, sediment-laden teal, so they are
 // bright enough to show through the Fresnel reflection when the rider looks down at them.
 const uniforms={
  uTime:{value:0},uWaterNormal:{value:normalMap},uNoise:{value:noise},
  uWaveStrength:{value:tier==='high'?.55:.45},
  uDeep:{value:new THREE.Color(MOODS.teal.deep)},uShallow:{value:new THREE.Color(MOODS.teal.shallow)},
  uFoam:{value:new THREE.Color(0xcfe3e0)}
 };
 material.userData.uniforms=uniforms;
 material.userData.textures=[normalMap,noise];
 material.userData.setMood=name=>{const m=MOODS[name]||MOODS.teal;uniforms.uDeep.value.setHex(m.deep);uniforms.uShallow.value.setHex(m.shallow);return name in MOODS?name:'teal';};
 material.onBeforeCompile=shader=>{
  Object.assign(shader.uniforms,uniforms);
  shader.vertexShader=shader.vertexShader
   .replace('#include <common>','#include <common>\nvarying vec3 vWPos;')
   .replace('#include <worldpos_vertex>','#include <worldpos_vertex>\nvWPos=(modelMatrix*vec4(transformed,1.)).xyz;');
  shader.fragmentShader=shader.fragmentShader
   .replace('#include <common>',`#include <common>
    varying vec3 vWPos;uniform float uTime;uniform sampler2D uWaterNormal;uniform sampler2D uNoise;uniform float uWaveStrength;
    uniform vec3 uDeep;uniform vec3 uShallow;uniform vec3 uFoam;
    float centerAt(float d){return 28.*sin(d*.0027)+15.*sin(d*.0061);}
    // The bank is the canyon edge (terrain.js edgeAt), NOT the 65 m river-mesh half width: the mesh runs on under the
    // rock, so foam measured from the mesh edge was buried inside the wall and never seen.
    float edgeAt(float d){return 40.+6.*sin(d*.014);}
    float shoreDist(vec3 p){return edgeAt(-p.z)-abs(p.x-centerAt(-p.z));}
    float centerDist(vec3 p){return abs(p.x-centerAt(-p.z));}
   `)
   // Base colour: teal absorption by shore distance (a stand-in for water depth) + foam within 9 m of the bank,
   // plus a faint broken foam line along the centre current so the water has structure at the rider's distance.
   .replace('#include <map_fragment>',`
    float shore=shoreDist(vWPos);
    float depthT=smoothstep(0.,26.,shore);
    vec3 waterCol=mix(uShallow,uDeep,depthT);
    float foamNoise=texture2D(uNoise,vWPos.xz*.05+vec2(uTime*.02,0.)).r*.6+texture2D(uNoise,vWPos.xz*.17-vec2(0.,uTime*.05)).r*.4;
    // A thin broken line of foam at the bank (v080): a wide continuous band read as a beige road from the saddle.
    // A third, larger noise gates the band so the foam is broken patches, not a continuous beige road edge.
    float foamBreak=texture2D(uNoise,vWPos.xz*.31+vec2(-uTime*.01,uTime*.015)).r;
    float foam=smoothstep(4.5,0.,shore)*smoothstep(.5,.8,foamNoise)*smoothstep(.35,.85,foamBreak);
    float cd=centerDist(vWPos);
    float currentNoise=texture2D(uNoise,vec2(vWPos.x*.08,vWPos.z*.02+uTime*.03)).r;
    float current=smoothstep(8.,2.,cd)*smoothstep(.55,.8,currentNoise)*.25;
    foam=max(foam,current);
    waterCol=mix(waterCol,uFoam,foam);
    diffuseColor.rgb=waterCol;
   `)
   // Roughness: near mirror, broken by a drifting noise so the sun highlight sparkles (glitter); foam is matte.
   .replace('#include <roughnessmap_fragment>',`
    // Roughness floor 0.14: below that the sun's GGX peak on the water is thousands of times brighter than the scene and
    // the bloom pass smears it over the walls. The glitter noise still breaks the highlight into moving sparkles.
    float glitter=texture2D(uNoise,vWPos.xz*.32+vec2(uTime*.11,-uTime*.07)).r;
    float roughnessFactor=mix(.14,.35,glitter);
    roughnessFactor=mix(roughnessFactor,.9,foam);
   `)
   // Two normal layers scrolling in different directions, whiteout-blended, mapped from the +Y plane into view space.
   .replace('#include <normal_fragment_maps>',`
    vec2 p=vWPos.xz;
    vec3 n1=texture2D(uWaterNormal,p*.045+vec2(uTime*.018,uTime*.024)).xyz*2.-1.;
    vec3 n2=texture2D(uWaterNormal,p*.13-vec2(uTime*.03,uTime*.016)).xyz*2.-1.;
    vec3 nw=normalize(vec3((n1.xy+n2.xy)*uWaveStrength*(1.-foam*.7),n1.z*n2.z));
    vec3 worldN=normalize(vec3(nw.x,nw.z,nw.y));
    normal=normalize((viewMatrix*vec4(worldN,0.)).xyz);
   `)
   // The HDRI only holds sky. Reflection rays that would hit the canyon walls (low or sideways) get darkened so the water
   // reads as a dark mirror between cliffs instead of a bright sky plate.
   // The sun's GGX peak on rippled water is a wide band of values far above 1.0; a soft knee keeps the sparkle texture
   // but caps the band at ~0.67 linear (below the 1.0 bloom threshold) so the path is a soft teal-white band, never a sheet.
   .replace('#include <lights_fragment_end>',`
    #include <lights_fragment_end>
    reflectedLight.directSpecular=reflectedLight.directSpecular/(1.+reflectedLight.directSpecular*1.5);
   `)
   .replace('#include <lights_fragment_maps>',`
    #include <lights_fragment_maps>
    vec3 rView=reflect(-geometryViewDir,normal);
    vec3 rWorld=transpose(mat3(viewMatrix))*rView;
    // Floor .35 (was .12): at .12 every reflection that was not straight up went flat, so no wall or sky detail
    // showed in the water beyond ~40 m. The lit wall now mirrors in the river like v080.
    float wallOcc=mix(.35,1.,smoothstep(.03,.4,rWorld.y))*(1.-.4*smoothstep(.35,.85,abs(rWorld.x)));
    // The HDR sun is ~240,000x brighter than the sky; mirrored straight into the eye it becomes a white blob that floods
    // the bloom pass. Clamp the reflected sky and let the DirectionalLight + glitter roughness make the sparkle instead.
    radiance=min(radiance*wallOcc,vec3(4.));
   `);
 };
 material.customProgramCacheKey=()=>'water-'+tier;
 function update(time){uniforms.uTime.value=time;}
 function dispose(){normalMap.dispose();noise.dispose();material.dispose();}
 return {material,update,dispose};
}
