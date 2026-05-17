const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname, { maxAge: '1d' }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const CONFIG = { TICK_RATE: 15, GRAVITY: 18, MOVE_SPEED: 8.0, JUMP_FORCE: 9.0 };
const CELL = 5.0, GRID = 19;

// Безопасная генерация лабиринта
function generateMaze() {
  try {
    const m = Array(GRID).fill().map(() => Array(GRID).fill(1));
    for(let y=0; y<3; y++) for(let x=0; x<3; x++) m[y][x] = 0;
    m[1][1] = 2;
    const stack = [{x:3,y:3}]; m[3][3] = 0;
    const dirs = [{x:0,y:-2},{x:0,y:2},{x:-2,y:0},{x:2,y:0}];
    while(stack.length) {
      const c = stack[stack.length-1], nb = [];
      for(const d of dirs) {
        const nx=c.x+d.x, ny=c.y+d.y;
        if(nx>2 && nx<GRID-1 && ny>2 && ny<GRID-1 && m[ny][nx]===1) nb.push({x:nx,y:ny,dx:d.x/2,dy:d.y/2});
      }
      if(nb.length) {
        const ch = nb[Math.floor(Math.random()*nb.length)];
        m[ch.y][ch.x]=0; m[c.y+ch.dy][c.x+ch.dx]=0; stack.push({x:ch.x,y:ch.y});
      } else stack.pop();
    }
    for(let i=0;i<10;i++) { const x=2+Math.floor(Math.random()*(GRID-4)), y=2+Math.floor(Math.random()*(GRID-4)); if(m[y][x]===1) m[y][x]=0; }
    m[GRID-2][GRID-2]=4; if(m[GRID-2][GRID-3]===1) m[GRID-2][GRID-3]=0;
    let p=0, a=0; while(p<9 && a<100) { const x=2+Math.floor(Math.random()*(GRID-4)), y=2+Math.floor(Math.random()*(GRID-4)); if(m[y][x]===0){m[y][x]=3;p++;} a++; }
    return m;
  } catch(e) { console.error('[MAZE]', e); return Array(GRID).fill().map(()=>Array(GRID).fill(0)); }
}

const MAP = generateMaze();
const SPOTS = [];
for(let y=0;y<GRID;y++) for(let x=0;x<GRID;x++) if(MAP[y][x]===0 && !(x<3&&y<3)) SPOTS.push({x:(x-GRID/2)*CELL, z:(y-GRID/2)*CELL});

const players = new Map();
let nextId = 1;

const game = {  walls: MAP.flatMap((r,y)=>r.map((c,x)=>c===1?{x:(x-GRID/2)*CELL, z:(y-GRID/2)*CELL, w:CELL, d:CELL, h:6}:null).filter(Boolean)),
  cheeses: [], greenZones: [],
  rat: {x:0,z:0,spd:4.5,yaw:0,tx:0,tz:0},
  exit: {x:0,z:0,open:false},
  spawn: {x:(1-GRID/2)*CELL, z:(1-GRID/2)*CELL},
  time: 0
};

for(let y=0;y<GRID;y++) for(let x=0;x<GRID;x++) {
  const wx=(x-GRID/2)*CELL, wz=(y-GRID/2)*CELL;
  if(MAP[y][x]===2) game.greenZones.push({x:wx,z:wz});
  if(MAP[y][x]===3) game.cheeses.push({id:`c${game.cheeses.length}`,x:wx,z:wz,col:false});
  if(MAP[y][x]===4) game.exit={x:wx,z:wz,open:false};
}

class Player {
  constructor(id,ws,name){
    this.id=id; this.ws=ws; this.name=name.slice(0,16);
    this.gid='menu'; this.x=0; this.y=1; this.z=0; this.vx=0; this.vy=0; this.vz=0; this.yaw=0; this.gnd=false;
    this.inp={f:0,r:0,j:false,a:false}; this.hp=100; this.cheese=0; this.dead=false;
  }
  reset(gid){
    this.gid=gid; this.x=game.spawn.x+(Math.random()-0.5)*2; this.z=game.spawn.z+(Math.random()-0.5)*2;
    this.y=1; this.vx=this.vy=this.vz=0; this.hp=100; this.cheese=0; this.dead=false;
    if(SPOTS.length){const s=SPOTS[Math.floor(Math.random()*SPOTS.length)]; game.rat.x=s.x; game.rat.z=s.z;}
  }
  pub(){return {id:this.id,name:this.name,x:this.x,y:this.y,z:this.z,yaw:this.yaw,hp:this.hp,gid:this.gid,anim:(Math.abs(this.inp.f)>0.1||Math.abs(this.inp.r)>0.1)?1:0,dead:this.dead};}
}

wss.on('connection',(ws)=>{
  ws.isAlive=true; ws.on('pong',()=>ws.isAlive=true);
  ws.on('message',raw=>{
    try{
      const d=JSON.parse(raw);
      if(!d.pid && d.type==='reg'){
        const id=nextId++, p=new Player(id,ws,d.name||`P${id}`);
        players.set(id,p); ws.send(JSON.stringify({type:'reg',id,name:p.name}));
        return;
      }
      const p=players.get(d.pid); if(!p) return;
      if(d.type==='inp'){
        p.inp={f:Math.max(-1,Math.min(1,d.f||0)),r:Math.max(-1,Math.min(1,d.r||0)),j:!!d.j,a:!!d.a};
        if(typeof d.yaw==='number') p.yaw=d.yaw;
      }
      if(d.type==='join' && ['b','s','br','c'].includes(d.gid)){
        p.reset(d.gid);
        const ex=Array.from(players.values()).filter(o=>o.id!==p.id&&o.gid===d.gid).map(o=>o.pub());
        ws.send(JSON.stringify({type:'ex',players:ex}));
        if(d.gid==='c') ws.send(JSON.stringify({type:'map',walls:game.walls,cheeses:game.cheeses,spawn:game.spawn,green:game.greenZones,exit:game.exit}));
        broad({type:'join',player:p.pub()},p.id,d.gid);      }
      if(d.type==='resp'){p.reset('c'); broad({type:'join',player:p.pub()},null,'c');}
      if(d.type==='chat'&&d.msg) broad({type:'chat',name:p.name,msg:d.msg.slice(0,120)},null,p.gid);
    }catch(e){}
  });
  ws.on('close',()=>{for(const[id,pl]of players){if(pl.ws===ws){players.delete(id);broad({type:'left',id,gid:pl.gid},null,pl.gid);break;}}});
  ws.on('error',()=>{});
});

function broad(data,ex,gid){
  const m=JSON.stringify(data);
  players.forEach(p=>{if(p.id!==ex&&p.ws.readyState===1&&(!gid||p.gid===gid))try{p.ws.send(m);}catch(e){}});
}

function canMove(x,z){
  const gx=Math.floor(x/CELL+GRID/2), gz=Math.floor(z/CELL+GRID/2);
  return gx>=0&&gx<GRID&&gz>=0&&gz<GRID&&MAP[gz][gx]!==1;
}

setInterval(()=>{
  if(players.size===0) return;
  const dt=1/CONFIG.TICK_RATE;
  players.forEach(p=>{
    if(p.ws.readyState!==1||p.gid==='menu'||p.dead) return;
    const fx=-Math.sin(p.yaw), fz=-Math.cos(p.yaw), rx=Math.cos(p.yaw), rz=-Math.sin(p.yaw);
    p.vx=(p.inp.f*fx+p.inp.r*rx)*CONFIG.MOVE_SPEED;
    p.vz=(p.inp.f*fz+p.inp.r*rz)*CONFIG.MOVE_SPEED;
    if(p.inp.j&&p.gnd){p.vy=CONFIG.JUMP_FORCE;p.gnd=false;}
    p.vy-=CONFIG.GRAVITY*dt;
    let nx=p.x+p.vx*dt, nz=p.z+p.vz*dt, ny=p.y+p.vy*dt;
    if(ny<=1){ny=1;p.vy=0;p.gnd=true;}
    if(p.gid==='c'){
      if(!canMove(nx,p.z)) nx=p.x; if(!canMove(p.x,nz)) nz=p.z;
      const r=game.rat; let near=null, md=999;
      players.forEach(o=>{if(o.gid==='c'&&!o.dead){const d=Math.hypot(o.x-r.x,o.z-r.z);if(d<md){md=d;near=o;}}});
      if(near){r.tx=near.x;r.tz=near.z;}
      const dx=r.tx-r.x, dz=r.tz-r.z, dist=Math.hypot(dx,dz);
      if(dist>0.5){const nx2=r.x+(dx/dist)*r.spd*dt, nz2=r.z+(dz/dist)*r.spd*dt; if(canMove(nx2,nz2)){r.x=nx2;r.z=nz2;r.yaw=Math.atan2(dx,dz);}}
      if(md<2.0){p.hp-=100*dt; if(p.hp<=0&&!p.dead){p.dead=true;p.hp=0; p.ws.send(JSON.stringify({type:'die',x:p.x,y:p.y,z:p.z,name:p.name,pid:p.id})); broad({type:'die',x:p.x,y:p.y,z:p.z,name:p.name,pid:p.id},null,'c');}}
      game.cheeses.forEach(c=>{if(!c.col&&p.inp.a&&Math.hypot(p.x-c.x,p.z-c.z)<5.0){c.col=true;p.cheese++;p.ws.send(JSON.stringify({type:'cheese',t:p.cheese}));if(p.cheese>=9)game.exit.open=true;}});
      if(game.exit.open&&Math.hypot(p.x-game.exit.x,p.z-game.exit.z)<5.0) p.ws.send(JSON.stringify({type:'win',score:Math.floor(1000-game.time)}));
    }
    p.x=nx;p.z=nz;p.y=ny;
    p.ws.send(JSON.stringify({type:'snap',players:Array.from(players.values()).filter(o=>o.id!==p.id&&o.gid===p.gid).map(o=>o.pub()),rat:p.gid==='c'?game.rat:null,exit:p.gid==='c'?game.exit:null}));
  });
  if(game) game.time+=dt;
},1000/CONFIG.TICK_RATE);

setInterval(()=>{wss.clients.forEach(ws=>{if(!ws.isAlive)return ws.terminate();ws.isAlive=false;ws.ping();});},15000);
process.on('uncaughtException',e=>console.error('[FATAL]',e));server.listen(PORT,'0.0.0.0',()=>console.log(`✅ RUN :${PORT}`));
process.on('SIGINT',()=>process.exit(0));
