import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from '../vendor/three.module.js';

const source = readFileSync(new URL('../waterfall-environment.js', import.meta.url), 'utf8');
// Run the production function with Three's real camera/matrix math and an instrumented renderer.
const reflectionSource = source.slice(source.indexOf(' const mirrorCamera ='), source.indexOf('\n const _v =', source.indexOf(' const mirrorCamera =')));
function reflectionFixture(visibility, fail = false) {
  const riverMeshes = visibility.map(visible => ({visible}));
  const foam = {visible:false}, originalTarget = {}, reflectTarget = {}, scene = {};
  const renderer = {
    target:originalTarget, xr:{enabled:true}, shadowMap:{autoUpdate:true},
    getRenderTarget(){return this.target;}, setRenderTarget(t){this.target=t;}, clear(){},
    render(){
      assert.ok(riverMeshes.every(m => !m.visible));
      assert.equal(foam.visible,false);
      assert.equal(this.target,reflectTarget);
      if(fail)throw Error('render failed');
    }
  };
  const uniforms = {uReflMix:{value:0},uReflMatrix:{value:new THREE.Matrix4()}};
  const render = new Function('THREE','useReflection','riverUniforms','riverMeshes','foam','renderer','scene','reflectTarget',
    reflectionSource + '\nreturn renderReflection;')(THREE,true,uniforms,riverMeshes,foam,renderer,scene,reflectTarget);
  const camera = new THREE.PerspectiveCamera(56,2,.1,9000);
  camera.position.set(0,100,0);camera.lookAt(0,100,-100);camera.updateMatrixWorld();
  return {render:()=>render(camera,0),renderer,riverMeshes,foam,originalTarget};
}
for(const visibility of [[true,false,false],[false,true,true]]) {
  test('reflection preserves culled river pieces '+visibility,()=>{
    const f=reflectionFixture(visibility);
    f.render();
    assert.deepEqual(f.riverMeshes.map(m=>m.visible),visibility,'a mirror pass must not make distant water visible again');
    assert.equal(f.foam.visible,false);
    assert.equal(f.renderer.target,f.originalTarget);
    assert.equal(f.renderer.xr.enabled,true);
    assert.equal(f.renderer.shadowMap.autoUpdate,true);
  });
}
test('reflection restores render state even when drawing fails',()=>{
  const f=reflectionFixture([true,false,true],true);
  assert.throws(f.render,/render failed/);
  assert.equal(f.renderer.target,f.originalTarget);
  assert.deepEqual(f.riverMeshes.map(m=>m.visible),[true,false,true]);
  assert.equal(f.foam.visible,false);
  assert.equal(f.renderer.xr.enabled,true);
  assert.equal(f.renderer.shadowMap.autoUpdate,true);
});
test('stationary island descendants stop rebuilding transforms while birds and mist still move',()=>{
  const group=new THREE.Group(),islands=new THREE.Group(),rock=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());
  islands.add(rock);group.add(islands);
  const mist=new THREE.Sprite(),birds=new THREE.Group(),wing=new THREE.Object3D();
  group.add(mist,birds);birds.add(wing);
  const body=source.slice(source.indexOf(' function freezeStaticScenery()'),source.indexOf('\n ready.then(freezeStaticScenery'));
  new Function('group','sprites','flocks','bursts',body+'\nfreezeStaticScenery();')(group,[mist],[{birds}],[]);
  let rockUpdates=0;rock.updateMatrix=()=>rockUpdates++;
  const before=rock.matrixWorld.clone();
  mist.position.y=7;birds.position.x=9;wing.rotation.y=.3;
  group.updateMatrixWorld(true);
  assert.equal(rockUpdates,0,'freezing only the island parent still rebuilds every child');
  assert.deepEqual(rock.matrixWorld.elements,before.elements);
  assert.equal(mist.matrixWorld.elements[13],7);
  assert.equal(wing.matrixWorld.elements[12],9);
  assert.ok(Math.abs(wing.matrix.elements[0]-Math.cos(.3))<1e-12);
});
