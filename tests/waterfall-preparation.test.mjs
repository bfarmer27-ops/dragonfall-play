import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const game=readFileSync(new URL('../game.js',import.meta.url),'utf8');
test('takeoff waits for the complete scene preparation promise',()=>{
  const start=game.slice(game.indexOf('async function start()'),game.indexOf('function ',game.indexOf('async function start()')+22));
  assert.match(start,/await waterfallPreparation/,'loading images alone does not wait for graphics programs');
});
test('preparation waits for scenery, dragon and sky before uploading textures and compiling',async()=>{
  const {prepareWaterfallScene}=await import('../waterfall-prepare.js');
  let readyScene,readyDragon,readySky,readyCompile;
  const pending=[new Promise(r=>readyScene=r),new Promise(r=>readyDragon=r),new Promise(r=>readySky=r)];
  const events=[],texture={},previous={},target={},scene={},camera={};
  const renderer={
    target:previous,getRenderTarget(){return this.target;},setRenderTarget(t){this.target=t;},
    initTexture(t){assert.equal(t,texture);events.push('texture');},
    compileAsync(s,c){assert.equal(s,scene);assert.equal(c,camera);assert.equal(this.target,target);events.push('compile');return new Promise(r=>readyCompile=r);}
  };
  let complete=false;
  const task=prepareWaterfallScene({renderer,scene,camera,target,ready:pending,textures:()=>[texture,texture]}).then(()=>complete=true);
  readyScene();readyDragon();await Promise.resolve();
  assert.deepEqual(events,[]);assert.equal(complete,false);
  readySky();await new Promise(r=>setImmediate(r));
  assert.deepEqual(events,['texture','compile']);
  assert.equal(renderer.target,previous,'restore target immediately; the normal frame loop keeps running while compile resolves');
  assert.equal(complete,false);
  readyCompile();await task;assert.equal(complete,true);
});
test('a failed graphics preparation restores the previous render target',async()=>{
  const {prepareWaterfallScene}=await import('../waterfall-prepare.js');
  const previous={},renderer={target:previous,getRenderTarget(){return this.target;},setRenderTarget(t){this.target=t;},initTexture(){},compileAsync(){throw Error('compiler failed');}};
  await assert.rejects(prepareWaterfallScene({renderer,scene:{},camera:{},target:{},ready:[],textures:()=>[]}),/compiler failed/);
  assert.equal(renderer.target,previous);
});
