// Multiplayer over WebRTC using PeerJS (dist/vendor/peerjs.min.js, loaded by index.html as window.Peer).
// One player HOSTS and gets a 4-letter room code; friends JOIN with that code. Every joiner connects to the host and the
// host relays every packet to everyone else (star shape), so all riders see each other in the same canyon.
// Packets: {t:'hello',id,name}  {t:'s',id,x,a,d,p,r,y,ph,h,n,k,pz} (state; k = that rider's kills, pz = 1 while paused)
// Waterfall state additionally has wf:1, z (world Z), q:[x,y,z,w] (flight quaternion).
// Its existing x/a are world X/Y; r remains the separate visual bank angle.
//          {t:'e',id,k,...} (event: fire, hit, hitok, down, respawn)  {t:'bye',id}
// Callbacks: onStatus(status) with status = {mode:'offline'|'host'|'guest', code, error, note, count};
//            onPlayer('join'|'leave', id, player, silent) - silent = true when WE left the room (no 'X LEFT' toast);
//            onEvent(packet) for every 'e' packet from another rider.
// host()/join() retry a transient signalling failure ('server-error', 'network', 'socket-error', 'socket-closed', or
// no answer from the room within 8 s) up to 3 times with 1.5 s then 3 s waits; status.note carries the progress text.
const ALPHABET='BCDFGHJKLMNPQRSTVWXZ';
export const roomCode=()=>Array.from({length:4},()=>ALPHABET[Math.floor(Math.random()*ALPHABET.length)]).join('');
export const peerIdFor=code=>'dragonfall-'+String(code||'').toUpperCase().replace(/[^A-Z]/g,'');
export function readName(){try{return localStorage.getItem('dragonfall-name')||'';}catch{return '';}}
export function saveName(n){try{localStorage.setItem('dragonfall-name',n);}catch{}return n;}
export function packFlightState(flight,phase,{id,name,paused=false}={}){
 const packet={t:'s',id,n:name,x:+flight.x.toFixed(2),a:+flight.alt.toFixed(2),d:+flight.distance.toFixed(1),p:+flight.pitch.toFixed(3),r:+flight.roll.toFixed(3),y:+flight.yaw.toFixed(3),ph:+((phase||0)%6.2832).toFixed(2),h:flight.health,k:flight.kills||0,pz:paused?1:0};
 const orientation=flight.orientation;
 if(orientation&&Number.isFinite(flight.z)){
  const q=[orientation.x,orientation.y,orientation.z,orientation.w],length=Math.hypot(...q);
  if(q.every(Number.isFinite)&&Number.isFinite(length)&&length>1e-12){packet.wf=1;packet.z=+flight.z.toFixed(2);packet.q=q.map(value=>+(value/length).toFixed(5));}
 }
 return packet;
}
export function createNet({onStatus=()=>{},onPlayer=()=>{},onEvent=()=>{}}={}){
 const players=new Map(); // id -> {name, state, seen}
 let peer=null,hostConn=null,isHost=false,code='',myId='',name=readName()||('Rider-'+roomCode().slice(0,2)),sendTimer=0;
 const conns=new Map(); // host side: peer id -> DataConnection
 const status={mode:'offline',code:'',error:'',note:'',count:0};
 const report=(patch)=>{Object.assign(status,patch);status.count=players.size;onStatus(status);};
 function ensurePeerLib(){if(!globalThis.Peer)throw Error('Multiplayer library did not load. Reload the page.');}
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const TRANSIENT=['server-error','network','socket-error','socket-closed','no-answer'];
 const RETRY_WAITS=[1500,3000]; // after attempt 1 and attempt 2; 3 attempts in all
 // Runs attempt(n) up to 3 times. A transient failure destroys that attempt's peer, tells the UI, waits and tries
 // again; any other failure (a wrong code = 'peer-unavailable', a taken id, no library) is thrown at once.
 async function withRetries(attempt){
  for(let n=1;;n++){
   try{return await attempt(n);}
   catch(e){
    const type=e?.type||'';
    try{peer?.destroy();}catch{}peer=null;hostConn=null;
    if(n>RETRY_WAITS.length||!TRANSIENT.includes(type))throw e;
    report({error:'',note:'Could not reach the room server, trying again ('+(n+1)+' of 3)...'});
    await sleep(RETRY_WAITS[n-1]);
   }
  }
 }
 // A new PeerJS peer (a fixed id for the host, a random one for a guest), resolved once the signalling server answers.
 function openPeer(id){
  peer=id?new Peer(id,{debug:0}):new Peer({debug:0});
  const p=peer;
  return new Promise((resolve,reject)=>{p.on('open',pid=>{myId=pid;resolve(p);});p.on('error',e=>{if(p===peer)report({error:String(e?.type||e)});reject(e);});});
 }
 function handle(packet,from){
  if(!packet||!packet.id||packet.id===myId)return;
  if(isHost)for(const [id,c] of conns)if(id!==from&&c.open)c.send(packet); // relay to everyone else
  if(packet.t==='bye'){players.delete(packet.id);onPlayer('leave',packet.id);report({});return;}
  let p=players.get(packet.id);
  if(!p){p={name:packet.name||packet.n||'Rider',state:null,seen:performance.now()};players.set(packet.id,p);onPlayer('join',packet.id,p);report({});}
  p.seen=performance.now();
  if(packet.t==='s'){p.state=packet;if(packet.n)p.name=packet.n;}
  else if(packet.t==='e')onEvent(packet);
 }
 function wire(conn){
  conn.on('open',()=>{conns.set(conn.peer,conn);conn.send({t:'hello',id:myId,name});report({});});
  conn.on('data',d=>handle(d,conn.peer));
  conn.on('close',()=>{conns.delete(conn.peer);handle({t:'bye',id:conn.peer},conn.peer);});
  conn.on('error',e=>report({error:String(e?.message||e)}));
 }
 function send(packet){
  if(isHost){for(const c of conns.values())if(c.open)c.send(packet);}
  else if(hostConn?.open)hostConn.send(packet);
 }
 const api={
  status,players,
  get id(){return myId;},get name(){return name;},
  setName(n){name=saveName((n||'').trim().slice(0,14)||name);},
  async host(){
   ensurePeerLib();api.leave();code=roomCode();isHost=true;
   await withRetries(()=>openPeer(peerIdFor(code)));
   peer.on('connection',wire);report({mode:'host',code,error:'',note:''});return code;
  },
  async join(roomCodeText){
   ensurePeerLib();api.leave();code=String(roomCodeText||'').toUpperCase().replace(/[^A-Z]/g,'').slice(0,4);isHost=false;
   await withRetries(async()=>{
    const p=await openPeer();
    const conn=hostConn=p.connect(peerIdFor(code),{reliable:true});
    await new Promise((resolve,reject)=>{
     const timer=setTimeout(()=>reject(Object.assign(Error('No room "'+code+'" answered. Check the code and that the host is online.'),{type:'no-answer'})),8000);
     conn.on('open',()=>{clearTimeout(timer);resolve();});
     p.on('error',e=>{clearTimeout(timer);reject(Object.assign(Error(e?.type==='peer-unavailable'?'No room "'+code+'" is open. Check the code and that the host is online.':'Could not reach room '+code+' ('+(e?.type||e)+').'),{type:e?.type||''}));});
    });
    conn.on('data',d=>handle(d,'host'));
    // Only a close of the CURRENT host link means the host went away; leave() nulls hostConn first, so our own
    // leave never reports 'The host left.'. leave() runs first so its offline report does not wipe the error text.
    conn.on('close',()=>{if(hostConn!==conn)return;api.leave();report({error:'The host left.'});});
    conn.send({t:'hello',id:myId,name});
   });
   report({mode:'guest',code,error:'',note:''});return code;
  },
  leave(){
   try{send({t:'bye',id:myId});}catch{}
   for(const c of conns.values())try{c.close();}catch{}conns.clear();
   const closing=hostConn;hostConn=null;try{closing?.close();}catch{}
   try{peer?.destroy();}catch{}peer=null;
   // Every remote rider leaves silently (the game removes its dragon; no 'X LEFT' toast: we are the one leaving).
   for(const [id,p] of [...players]){players.delete(id);onPlayer('leave',id,p,true);}
   isHost=false;code='';report({mode:'offline',code:'',error:'',note:''});
  },
  // Call every frame in EVERY mode (paused, Settings open, intro): a rider that stops sending for 6 s is dropped by
  // everyone else, so a paused rider keeps sending and simply hovers in place for friends, tagged pz=1 (paused).
  // Sends the local state at ~12 Hz and drops riders silent for 6 s.
  update(flight,phase,dt,paused=false){
   if(status.mode==='offline')return;
   sendTimer+=dt;if(sendTimer>=1/12){sendTimer=0;send(packFlightState(flight,phase,{id:myId,name,paused}));}
   const t=performance.now();for(const [id,p] of players)if(t-p.seen>6000){players.delete(id);onPlayer('leave',id);report({});}
  },
  event(kind,data){send({t:'e',id:myId,k:kind,...data});},
  shareLink(){const u=new URL(location.href);u.search='?room='+code;return u.toString();},
 };
 return api;
}
