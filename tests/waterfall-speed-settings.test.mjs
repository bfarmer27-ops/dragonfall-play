import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as core from '../waterfall-core.js';
import {initializeWaterfallFlight,stepWaterfallFlight} from '../waterfall-flight.js';

test('Waterfall starts at 7x and Settings offers up to 10x',()=>{
 assert.equal(core.DEFAULT_SPEED_MULTIPLIER,7);
 assert.equal(core.SPEED_MULTIPLIER_MAX,10);
 const html=readFileSync(new URL('../waterfall/index.html',import.meta.url),'utf8');
 assert.match(html,/id="speed-slider"[^>]*max="10"[^>]*value="7"/);
});

test('saved 12x release resets once, then 7x and 10x persist without changing ordinary speed',()=>{
 const saved=new Map([['dragonfall-waterfall-speed-v3','12'],['dragonfall-speed','3.5']]);
 globalThis.localStorage={getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v)};
 try {
  assert.equal(core.readSpeedMultiplier(),7);
  for(const choice of [7,10]) {assert.equal(core.setSpeedMultiplier(choice),choice);assert.equal(core.readSpeedMultiplier(),choice);}
  assert.equal(core.setSpeedMultiplier(15),10);
  assert.equal(saved.get('dragonfall-speed'),'3.5');
 } finally {delete globalThis.localStorage;core.setSpeedMultiplier(7);}
});

test('real movement follows 7x and 10x including a live speed change',()=>{
 core.setSpeedMultiplier(7);
 const f=initializeWaterfallFlight({});
 for(const choice of [7,10]) {
  core.setSpeedMultiplier(choice);
  const start=f.distance;
  for(let i=0;i<120;i++)stepWaterfallFlight(f,0,0,1/120);
  const metres=f.distance-start;
  assert.equal(f.speedMultiplier,choice);assert.ok(Math.abs(metres-24*choice)<1e-6);
  console.log(JSON.stringify({choice,metresPerGameSecond:metres}));
 }
 core.setSpeedMultiplier(7);
});
