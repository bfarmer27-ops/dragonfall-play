// Exercise the real Settings UI and real flight in an owned disposable browser.
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {existsSync,mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {resolve,join,sep,extname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
const arg=(name,fallback)=>process.argv.find(a=>a.startsWith('--'+name+'='))?.split('=').slice(1).join('=')??fallback;
const out=resolve(arg('out','D:/AgentWork/Temp/codex/waterfall-speed-current/browser'));
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const report={startedAt:new Date().toISOString(),checks:[],errors:[],httpErrors:[],softwarePixelRatio:.5};
mkdirSync(out,{recursive:true});
let server,proc,ws,profile,seq=0;const pending=new Map();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('Timeout '+method));},60000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});}
async function ev(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;}
async function until(expression){const deadline=Date.now()+120000;while(Date.now()<deadline){const value=await ev(expression);if(value)return value;await sleep(50);}throw Error('Waiting for '+expression);}
function check(name,passed,detail){report.checks.push({name,passed:!!passed,detail});console.log(`${passed?'PASS':'FAIL'} ${name}: ${JSON.stringify(detail)}`);writeFileSync(join(out,'progress.json'),JSON.stringify(report,null,2));}
async function key(key,type='keyDown'){await send('Input.dispatchKeyEvent',{type,key,code:key,windowsVirtualKeyCode:{Escape:27,End:35,ArrowLeft:37}[key]});}
async function tap(keyName){await key(keyName);await key(keyName,'keyUp');}
async function click(selector){const point=await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});}
async function ready(){await until('window.__game && __game.model.ready && __frames>3');await ev('__game.rs.setPixelRatioCap(.5)');}
async function reloadGame(){const origin=await ev('performance.timeOrigin');await send('Page.reload');await until(`performance.timeOrigin!==${origin}`);await ready();}
async function setting(){return ev(`({value:Number(document.querySelector('#speed-slider').value),max:Number(document.querySelector('#speed-slider').max),label:document.querySelector('#speed-value').value,flight:__game.flight.speedMultiplier,saved:localStorage.getItem('dragonfall-waterfall-speed-v4'),ordinary:localStorage.getItem('dragonfall-speed')})`);}
try{
 server=createServer(async(req,res)=>{try{const p=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));if(p!==root&&!p.startsWith(root+sep)){res.writeHead(403).end();return;}const f=(await stat(p)).isDirectory()?join(p,'index.html'):p;res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.glb':'model/gltf-binary','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'}[extname(f)]||'application/octet-stream','Cache-Control':'no-store'}).end(await readFile(f));}catch{res.writeHead(404).end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 profile=mkdtempSync(join(tmpdir(),'dragonfall-speed-test-'));report.profile=profile;
 proc=spawn(arg('browser','C:/Users/Neo/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe'),['--headless=new','--enable-automation','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1',`--user-data-dir=${profile}`,'--window-size=960,540','--autoplay-policy=no-user-gesture-required','about:blank'],{stdio:'ignore',windowsHide:true});report.pid=proc.pid;
 const portFile=join(profile,'DevToolsActivePort');await (async()=>{for(let i=0;i<150&&!existsSync(portFile);i++)await sleep(100);})();
 const port=Number((await readFile(portFile,'utf8')).split('\n')[0]);let page;
 for(let i=0;i<150&&!page;i++){try{page=(await(await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t=>t.type==='page');}catch{}if(!page)await sleep(100);}
 if(!page)throw Error('No owned browser page');
 ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')report.errors.push(m.params.exceptionDetails.text);if(m.method==='Network.responseReceived'&&m.params.response.status>=400)report.httpErrors.push({url:m.params.response.url,status:m.params.response.status});};
 await send('Runtime.enable');await send('Page.enable');await send('Network.enable');
 // Seed only this disposable profile. No secrets or user profile are read.
 const setup=await send('Page.addScriptToEvaluateOnNewDocument',{source:`if(!sessionStorage.getItem('speed-test-seeded')){localStorage.setItem('dragonfall-private-access-v1','unlocked');localStorage.setItem('dragonfall-waterfall-speed-v3','12');localStorage.removeItem('dragonfall-waterfall-speed-v4');localStorage.setItem('dragonfall-speed','3.5');sessionStorage.setItem('speed-test-seeded','1');}localStorage.setItem('dragonfall-voice-fire','false');localStorage.setItem('dragonfall-noise-fire','false');`});
 const url=new URL(arg('url',`http://127.0.0.1:${server.address().port}/waterfall/`));url.searchParams.set('debug','1');url.searchParams.set('tier','phone');report.url=url.href;
 const response=await fetch(url);report.documentResponse={status:response.status,type:response.headers.get('content-type'),bytes:(await response.arrayBuffer()).byteLength};
 if(response.status!==200||!report.documentResponse.type?.includes('text/html'))throw Error('Expected game HTML: '+JSON.stringify(report.documentResponse));
 report.navigation=await send('Page.navigate',{url:url.href});
 if(report.navigation.errorText)throw Error('Navigation failed: '+report.navigation.errorText);
 await ready();
 const initial=await setting();check('previous 12x preference opens at the new 7x default',initial.value===7&&initial.flight===7&&initial.label==='7.00x',initial);check('Settings allows 10x',initial.max===10,initial);
 for(const selected of [10,7]){
  await click('#settings');await until('document.querySelector("#settings-dialog").open');
  await ev('document.querySelector("#speed-slider").focus()');await tap('End');
  if(selected===7)for(let i=0;i<60;i++)await tap('ArrowLeft');
  const chosen=await setting();check('real slider keyboard input selects '+selected+'x',chosen.value===selected&&chosen.label===selected.toFixed(2)+'x'&&chosen.saved===String(selected),chosen);
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  await ev('document.querySelector("#speed-slider").scrollIntoView({block:"center"})');
  const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(out,`settings-${selected}x.png`),Buffer.from(shot.data,'base64'));
  await send('Emulation.setDeviceMetricsOverride',{width:960,height:540,deviceScaleFactor:1,mobile:false});
  await tap('Escape');await until('!document.querySelector("#settings-dialog").open');
  const mode=await ev('__game.mode');await click(mode==='intro'?'#start':'#restart');await until('__game.mode==="playing"');
  const start=await ev('({time:__game.flight.elapsed,distance:__game.flight.distance})');await until(`__game.flight.elapsed>=${start.time+.5}`);await tap('Escape');await until('__game.mode==="paused"');
  const end=await ev('({time:__game.flight.elapsed,distance:__game.flight.distance,multiplier:__game.flight.speedMultiplier,speed:__game.flight.speed})');
  const measured=(end.distance-start.distance)/(end.time-start.time);
  check('real '+selected+'x flight moves at '+selected*24+' metres per game second',end.multiplier===selected&&Math.abs(measured-selected*24)<1e-5,{start,end,measured});
  check('ordinary game speed stays separate',(await setting()).ordinary==='3.5',await setting());
  await reloadGame();const restored=await setting();check(selected+'x persists after page reload',restored.value===selected&&restored.flight===selected&&restored.saved===String(selected),restored);
 }
 await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:setup.identifier});
}catch(e){report.failure=String(e.stack||e);}finally{
 if(ws?.readyState===1)try{await send('Browser.close');}catch{}ws?.close();for(const p of pending.values())clearTimeout(p.timer);
 if(proc?.pid){for(let i=0;i<30;i++){if(proc.exitCode!==null){report.processClosed=true;break;}await sleep(100);}if(!report.processClosed){spawnSync('taskkill',['/PID',String(proc.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});report.processClosed=!spawnSync('tasklist',['/FI',`PID eq ${proc.pid}`,'/NH'],{encoding:'utf8',windowsHide:true}).stdout.includes('chrome.exe');}}
 if(profile){const path=resolve(profile);if(!path.startsWith(resolve(tmpdir())+sep)||!path.split(sep).at(-1).startsWith('dragonfall-speed-test-'))throw Error('Unexpected cleanup path');for(let i=0;i<30;i++){try{rmSync(path,{recursive:true,force:true});}catch{}if(!existsSync(path)){report.profileRemoved=true;break;}await sleep(100);}}
 if(server){await new Promise(r=>server.close(r));report.localServerClosed=!server.listening;}
 report.passed=!report.failure&&report.checks.every(c=>c.passed)&&!report.errors.length&&!report.httpErrors.length&&report.processClosed&&report.profileRemoved;
 report.finishedAt=new Date().toISOString();writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));process.exitCode=report.passed?0:1;
 if(report.processClosed&&report.profileRemoved&&report.localServerClosed)process.exit(process.exitCode);
}
