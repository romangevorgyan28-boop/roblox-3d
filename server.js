<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>🧱 Roblox 3D</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;outline:none;touch-action:manipulation}
body{overflow:hidden;background:#0a0a12;font-family:system-ui,sans-serif;color:#fff}
#reg-modal{position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:200;display:flex;align-items:center;justify-content:center}
.reg-box{background:rgba(15,18,25,0.95);border:1px solid rgba(255,255,255,0.08);padding:24px;border-radius:12px;text-align:center;max-width:320px;width:90%}
.reg-input{width:100%;padding:10px;background:#000;border:1px solid rgba(255,255,255,0.08);color:#fff;border-radius:6px;margin-bottom:12px}
.btn{padding:10px 20px;border:none;border-radius:6px;font-weight:bold;cursor:pointer;width:100%;background:#00e5ff;color:#000}
#main-menu{position:fixed;inset:0;display:none;flex-direction:column;align-items:center;padding:20px;background:radial-gradient(circle at 50% 20%,#111827,#000);overflow-y:auto;scrollbar-width:thin;scrollbar-color:#00e5ff transparent;z-index:100}
#main-menu.active{display:flex}
.menu-header{text-align:center;margin-bottom:24px;flex-shrink:0}
.menu-header h1{font-size:36px;background:linear-gradient(90deg,#fff,#00e5ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.game-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;max-width:900px;width:100%;padding-bottom:40px}
.game-card{background:rgba(15,18,25,0.95);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px;cursor:pointer;transition:0.2s;display:flex;flex-direction:column;gap:8px}
.game-card:hover{transform:translateY(-4px);border-color:#00e5ff}
.tags{display:flex;gap:6px;flex-wrap:wrap}
.tag{font-size:10px;padding:2px 6px;background:rgba(255,255,255,0.1);border-radius:4px}
.play-btn{margin-top:auto;padding:8px;background:#00e5ff;border:none;border-radius:6px;color:#000;font-weight:bold;cursor:pointer}
#game-ui{display:none;position:fixed;inset:0}
#game-ui.active{display:block}
#hud-top{position:fixed;top:0;left:0;width:100%;height:40px;background:linear-gradient(180deg,rgba(0,0,0,0.8),transparent);display:flex;align-items:center;justify-content:space-between;padding:0 12px;z-index:20}
#hud-info{display:flex;gap:12px;align-items:center;font-size:12px}
#crosshair{position:fixed;top:50%;left:50%;width:10px;height:10px;border:2px solid #fff;border-radius:50%;transform:translate(-50%,-50%);pointer-events:none;display:none}
#chat-container{position:fixed;top:10px;left:10px;width:260px;z-index:25;pointer-events:none}
#chat-box{max-height:160px;overflow-y:auto;padding:8px;background:rgba(0,0,0,0.6);border-radius:8px 8px 0 0;border:1px solid rgba(255,255,255,0.1);border-bottom:none;font-size:11px;pointer-events:auto}
#chat-input{width:100%;padding:6px 8px;background:rgba(0,0,0,0.8);border:1px solid rgba(255,255,255,0.1);border-radius:0 0 8px 8px;color:#fff;font-size:11px;pointer-events:auto}
.msg{margin:2px 0;line-height:1.3}
.msg .n{font-weight:bold;color:#8b5cf6}
.msg.sys{color:#00ff88;font-style:italic}
#exit-btn{position:fixed;top:10px;right:10px;background:#ff2a2a;color:#fff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;z-index:30}
#name-tags{position:fixed;inset:0;pointer-events:none;z-index:10;overflow:hidden}
.name-tag{position:absolute;transform:translate(-50%,-100%);background:rgba(0,0,0,0.6);padding:2px 6px;border-radius:4px;font-size:10px;font-weight:bold;white-space:nowrap}
#mobile-controls{display:none;position:fixed;inset:0;pointer-events:none;z-index:30}
#mobile-controls.active{display:block}
#joy-zone{position:absolute;left:20px;bottom:20px;width:110px;height:110px;pointer-events:all}
#joy-base{width:100%;height:100%;background:rgba(255,255,255,0.1);border:2px solid rgba(255,255,255,0.3);border-radius:50%;position:relative}
#joy-stick{width:44px;height:44px;background:#00e5ff;border-radius:50%;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)}
#look-zone{position:absolute;right:0;top:0;width:50%;height:70%;pointer-events:all}
.mob-btn{position:absolute;right:20px;width:60px;height:60px;background:rgba(255,255,255,0.15);border:2px solid rgba(255,255,255,0.3);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:24px;pointer-events:all}
#btn-jump{bottom:20px}#btn-action{bottom:95px;right:95px;background:rgba(168,85,247,0.3);border-color:#a855f7}
canvas{display:block;width:100%;height:100%;position:fixed;top:0;left:0;z-index:1}
#loading{position:fixed;inset:0;background:#0a0a12;display:flex;align-items:center;justify-content:center;z-index:150;color:#00e5ff;font-size:18px;transition:opacity 0.3s}
#loading.hidden{opacity:0;pointer-events:none}
</style>
</head><body>
<div id="loading">Загрузка мира...</div>
<div id="reg-modal"><div class="reg-box"><h2>👋 Добро пожаловать!</h2><p style="font-size:12px;color:#8a8f98;margin-bottom:12px">Введите никнейм</p><input type="text" id="reg-input" class="reg-input" placeholder="Никнейм" maxlength="16"><button class="btn" id="reg-btn">Играть</button></div></div>
<div id="main-menu">
  <div class="menu-header"><h1>🧱 ROBLOX 3D</h1><p style="color:#8a8f98;font-size:13px">Оптимизировано • Стабильно • Мгновенный запуск</p></div>
  <div class="game-grid">
    <div class="game-card" data-game="brookhaven"><h3>🏡 Brookhaven RP</h3><p>Открытый мир</p><div class="tags"><span class="tag">RP</span></div><button class="play-btn">Войти</button></div>
    <div class="game-card" data-game="shooter"><h3>🔫 Team Shooter</h3><p>Командный бой</p><div class="tags"><span class="tag">FPS</span></div><button class="play-btn">Войти</button></div>
    <div class="game-card" data-game="brainrot"><h3>🧠 Steal a Brainrot</h3><p>Укради артефакт</p><div class="tags"><span class="tag">Action</span></div><button class="play-btn">Войти</button></div>
    <div class="game-card" data-game="cheese"><h3>🧀 Horror of Cheese</h3><p>Лабиринт с крысой</p><div class="tags"><span class="tag">Horror</span></div><button class="play-btn">Войти</button></div>
  </div>
</div>
<div id="game-ui">
  <canvas id="c"></canvas>
  <div id="hud-top"><span id="hud-name">Player</span><div id="hud-info"><span id="hud-online">● 1</span><span id="hud-cheese-count" style="display:none;color:#ffd700">🧀 0/9</span></div></div>
  <div id="chat-container"><div id="chat-box"></div><input type="text" id="chat-input" placeholder="Чат..."></div>
  <div id="crosshair"></div><button id="exit-btn">🏠 Меню</button><div id="name-tags"></div>
  <div id="mobile-controls"><div id="joy-zone"><div id="joy-base"><div id="joy-stick"></div></div></div><div id="look-zone"></div><div id="btn-jump" class="mob-btn">⬆️</div><div id="btn-action" class="mob-btn">🎯</div></div>
</div>
<script type="importmap">{"imports":{"three":"https://unpkg.com/three@0.160.0/build/three.module.js","three/addons/":"https://unpkg.com/three@0.160.0/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const isMobile = ('ontouchstart' in window) || navigator.maxTouchPoints > 0 || window.innerWidth < 768;
const CELL_SIZE = 5.0;
const GRID_SIZE = 19;
const S = { ws:null, id:null, name:localStorage.getItem('roblox_name')||'', gameId:'menu', players:new Map(), scene:null, cam:null, ren:null, localPlayer:null, yaw:0, pitch:0, inp:{f:0,r:0,jump:false,action:false}, joyId:null, lookId:null, joyStart:{x:0,y:0}, lookPrev:{x:0,y:0}, walls:[], cheeses:new Map(), ratModel:null, exitMesh:null, cheeseTex:null, pendingMap:null, deadPlayers:[], mazeGrid:[], connected:false };

const regModal=document.getElementById('reg-modal'), regInput=document.getElementById('reg-input'), regBtn=document.getElementById('reg-btn');
if(S.name){regModal.style.display='none';showMenu();}else{regModal.style.display='flex';regBtn.onclick=()=>{const n=regInput.value.trim();if(n.length<2)return alert('Минимум 2 символа');S.name=n;localStorage.setItem('roblox_name',n);regModal.style.display='none';showMenu();}}

function showMenu(){document.getElementById('main-menu').classList.add('active');document.querySelectorAll('.game-card').forEach(c=>c.querySelector('.play-btn').onclick=()=>startGame(c.dataset.game));}

function startGame(gameId){
  S.gameId=gameId;
  document.getElementById('main-menu').classList.remove('active');
  document.getElementById('game-ui').classList.add('active');
  if(isMobile) document.getElementById('mobile-controls').classList.add('active');
  document.getElementById('hud-name').textContent=S.name;
  document.getElementById('hud-cheese-count').style.display=gameId==='cheese'?'block':'none';
  document.getElementById('crosshair').style.display=gameId==='shooter'?'block':'none';
  document.getElementById('chat-box').innerHTML='';
  init3D();
  setupInput();
  connect();
  // Гарантированно скрываем загрузку через 1 сек
  setTimeout(()=>document.getElementById('loading').classList.add('hidden'), 1000);
}
function leaveGame(){
  document.getElementById('game-ui').classList.remove('active');
  document.getElementById('main-menu').classList.add('active');
  document.getElementById('loading').classList.remove('hidden');
  if(S.ws){S.ws.close();S.ws=null;}
  if(S.ren){S.ren.dispose();S.ren=null;}
}
document.getElementById('exit-btn').onclick=leaveGame;

function connect(){
  if(S.ws && S.ws.readyState === WebSocket.OPEN) return;
  const proto=location.protocol==='https:'?'wss:':'ws:';
  S.ws=new WebSocket(`${proto}//${location.host}`);
  S.ws.onopen=()=>{S.ws.send(JSON.stringify({type:'register',name:S.name}));};
  S.ws.onmessage=e=>{
    try{
      const d=JSON.parse(e.data);
      if(d.type==='registered'){S.id=d.id;S.ws.send(JSON.stringify({playerId:S.id,type:'joinGame',gameId:S.gameId}));S.connected=true;}
      if(d.type==='existingPlayers'){d.players.forEach(p=>spawnRemote(p));}
      if(d.type==='playerJoined'){if(!d.isDead)spawnRemote(d);else createDeathEffect(d.x,d.y,d.z);}
      if(d.type==='playerLeft'){removeRemote(d.playerId);}
      if(d.type==='playerMoved'){const p=S.players.get(d.player.id);if(p){p.mesh.group.position.set(d.player.x,d.player.y,d.player.z);p.mesh.group.rotation.y=-d.player.yaw;}}
      if(d.type==='snapshot'){
        d.players.forEach(p=>{
          if(!S.players.has(p.id) && !p.isDead) spawnRemote(p);
          else if(!p.isDead){const r=S.players.get(p.id);r.mesh.group.position.x+=(p.x-r.mesh.group.position.x)*0.18;r.mesh.group.position.y+=(p.y-r.mesh.group.position.y)*0.18;r.mesh.group.position.z+=(p.z-r.mesh.group.position.z)*0.18;r.mesh.group.rotation.y+=(-p.yaw-r.mesh.group.rotation.y)*0.18;r.animState=p.anim;}
        });
        if(d.rat&&S.ratModel){S.ratModel.position.x+=(d.rat.x-S.ratModel.position.x)*0.2;S.ratModel.position.z+=(d.rat.z-S.ratModel.position.z)*0.2;S.ratModel.rotation.y=-d.rat.yaw;}
        if(d.exit&&S.exitMesh) S.exitMesh.visible=d.exit.open;
        document.getElementById('hud-online').textContent=`● ${d.players.length+1}`;
      }
      if(d.type==='playerDied'){
        if(d.playerId === S.id) {
          S.localPlayer.userData.isDead = true; S.scene.remove(S.localPlayer.group);
          const btn = document.createElement('button'); btn.textContent='💀 Возродиться';
          btn.style.cssText='position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);padding:15px 30px;font-size:20px;background:#ff2a2a;color:#fff;border:none;border-radius:10px;cursor:pointer;z-index:100;';
          btn.onclick=()=>{S.ws.send(JSON.stringify({playerId:S.id,type:'respawn'}));S.localPlayer.userData.isDead=false;btn.remove();S.scene.add(S.localPlayer.group);unstuckPlayer();};
          document.body.appendChild(btn);
        } else { if(S.players.has(d.playerId)){createDeathEffect(d.x,d.y,d.z);S.scene.remove(S.players.get(d.playerId).mesh.group);S.players.delete(d.playerId);} }
      }
      if(d.type==='mapData'){
        S.pendingMap=d;
        S.mazeGrid=[];const half=9.5;
        for(let y=0;y<GRID_SIZE;y++){S.mazeGrid[y]=[];for(let x=0;x<GRID_SIZE;x++)S.mazeGrid[y][x]={isWall:false};}
        d.walls.forEach(w=>{const gx=Math.floor((w.x/CELL_SIZE)+half),gz=Math.floor((w.z/CELL_SIZE)+half);if(gx>=0&&gx<GRID_SIZE&&gz>=0&&gz<GRID_SIZE)S.mazeGrid[gz][gx].isWall=true;});
        if(S.cheeseTex) spawnMap(d); else loadAssets().then(()=>spawnMap(d));
      }
      if(d.type==='collectCheese') document.getElementById('hud-cheese-count').textContent=`🧀 ${d.total}/9`;
      if(d.type==='win'){alert(`🏆 Победа! Счёт: ${d.score}`);leaveGame();}
      if(d.type==='chat') addChat(d.name,d.msg);    }catch(err){}
  };
  S.ws.onclose=()=>{S.connected=false;setTimeout(connect,2000);};
}

function spawnMap(d){
  const mat=S.cheeseTex?new THREE.MeshStandardMaterial({map:S.cheeseTex,color:0xffffff,roughness:0.5}):new THREE.MeshStandardMaterial({color:0xddaa00});
  d.walls.forEach(w=>{
    const m=new THREE.Mesh(new THREE.BoxGeometry(w.w,w.h||6.0,w.d),mat);
    m.position.set(w.x,(w.h||6.0)/2,w.z);m.castShadow=true;m.receiveShadow=true;
    S.scene.add(m);S.walls.push({mesh:m,x:w.x,z:w.z,w:w.w,d:w.d,h:w.h||6.0});
  });
  if(d.greenZones)d.greenZones.forEach(gz=>{const z=new THREE.Mesh(new THREE.PlaneGeometry(5,5),new THREE.MeshBasicMaterial({color:0x00ff88,transparent:true,opacity:0.2,side:THREE.DoubleSide}));z.rotation.x=-Math.PI/2;z.position.set(gz.x,0.05,gz.z);S.scene.add(z);});
  d.cheeses.forEach(c=>{if(!c.collected)spawnCheese(c);});
}

function createRig(color){
  const g=new THREE.Group();const mB=new THREE.MeshStandardMaterial({color});const mS=new THREE.MeshStandardMaterial({color:0xffcc88});const mP=new THREE.MeshStandardMaterial({color:0x333366});
  g.add(Object.assign(new THREE.Mesh(new THREE.BoxGeometry(1,1.2,0.6),mB),{position:new THREE.Vector3(0,1.8,0),castShadow:true}));
  g.add(Object.assign(new THREE.Mesh(new THREE.BoxGeometry(0.8,0.8,0.8),mS),{position:new THREE.Vector3(0,2.8,0),castShadow:true}));
  function limb(w,h,d,mat,x,y,z){const p=new THREE.Group();p.position.set(x,y,z);p.add(Object.assign(new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat),{position:new THREE.Vector3(0,-h/2,0),castShadow:true}));g.add(p);return p;}
  return{group:g,lA:limb(0.35,1.1,0.35,mS,-0.7,2.3,0),rA:limb(0.35,1.1,0.35,mS,0.7,2.3,0),lL:limb(0.4,1.1,0.4,mP,-0.25,1.15,0),rL:limb(0.4,1.1,0.4,mP,0.25,1.15,0)};
}

function spawnRemote(d){if(d.id===S.id)return;const r=createRig(d.gameId==='shooter'?(d.team==='red'?0xff2a2a:0x2a8aff):0x3366cc);r.group.position.set(d.x,d.y,d.z);r.group.rotation.y=-d.yaw;S.scene.add(r.group);S.players.set(d.id,{mesh:r,tx:d.x,ty:d.y,tz:d.z,tryaw:d.yaw,name:d.name,animState:0});const tag=document.createElement('div');tag.className='name-tag';tag.textContent=d.name;document.getElementById('name-tags').appendChild(tag);S.players.get(d.id).tag=tag;}
function removeRemote(id){const p=S.players.get(id);if(p){S.scene.remove(p.mesh.group);if(p.tag)p.tag.remove();S.players.delete(id);}}
function spawnCheese(c){const g=new THREE.Group();g.add(Object.assign(new THREE.Mesh(new THREE.CylinderGeometry(0.15,0.15,1.2,8),new THREE.MeshStandardMaterial({color:0x5c3a21})),{position:new THREE.Vector3(0,0.6,0)}));const top=new THREE.Mesh(new THREE.BoxGeometry(1.4,0.1,1.4),new THREE.MeshStandardMaterial({color:0x6b4423}));top.position.y=1.25;top.castShadow=true;top.receiveShadow=true;g.add(top);const m=S.cheeseTex?new THREE.MeshStandardMaterial({map:S.cheeseTex,color:0xffffff,roughness:0.3}):new THREE.MeshStandardMaterial({color:0xffd700});const cheese=new THREE.Mesh(new THREE.ConeGeometry(0.45,0.7,8),m);cheese.position.y=1.65;cheese.rotation.x=Math.PI/6;cheese.castShadow=true;g.add(cheese);g.position.set(c.x,0,c.z);S.scene.add(g);S.cheeses.set(c.id,g);}
function createDeathEffect(x,y,z){const colors=[0xff3333,0x3366cc,0xffcc88,0x333366];for(let i=0;i<10;i++){const m=new THREE.Mesh(new THREE.BoxGeometry(0.3,0.3,0.3),new THREE.MeshStandardMaterial({color:colors[i%4]}));m.position.set(x+(Math.random()-0.5)*1.5,y+Math.random()*2,z+(Math.random()-0.5)*1.5);S.scene.add(m);const v=new THREE.Vector3((Math.random()-0.5)*4,Math.random()*4+1,(Math.random()-0.5)*4);S.deadPlayers.push({mesh:m,vel:v,timer:3+Math.random()});}}
function unstuckPlayer(){if(!S.localPlayer||!S.mazeGrid.length)return;const half=9.5,gx=Math.floor((S.localPlayer.group.position.x/CELL_SIZE)+half),gz=Math.floor((S.localPlayer.group.position.z/CELL_SIZE)+half);if(gx>=0&&gx<GRID_SIZE&&gz>=0&&gz<GRID_SIZE&&S.mazeGrid[gz][gx].isWall){S.localPlayer.group.position.set((1.0-half)*CELL_SIZE,1,(1.0-half)*CELL_SIZE);}}

async function loadAssets(){
  try{
    const tex=await new Promise(r=>new THREE.TextureLoader().load('cheese_texture.png',t=>r(t),undefined,()=>r(null)));
    if(tex){tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.repeat.set(2,2);S.cheeseTex=tex;S.walls.forEach(w=>w.mesh.material.map=tex);S.cheeses.forEach(c=>c.children[2].material.map=tex);}
  }catch(e){}
  try{
    const g=await new Promise(r=>new GLTFLoader().load('rat.glb',gl=>r(gl.scene),undefined,()=>r(null)));
    if(g){const b=new THREE.Box3().setFromObject(g);g.scale.setScalar(3.8/(b.max.y-b.min.y));g.position.set(0,0.5,0);g.traverse(n=>{if(n.isMesh){n.castShadow=true;n.receiveShadow=true;}});S.scene.add(g);S.ratModel=g;}
  }catch(e){}
}

function init3D(){
  const cv=document.getElementById('c');cv.width=innerWidth;cv.height=innerHeight;
  S.scene=new THREE.Scene();S.scene.background=new THREE.Color(0x2a2a35);S.scene.fog=new THREE.Fog(0x2a2a35,25,60);
  S.cam=new THREE.PerspectiveCamera(70,cv.width/cv.height,0.1,100);
  S.ren=new THREE.WebGLRenderer({canvas:cv,antialias:true,powerPreference:'high-performance'});
  S.ren.setSize(cv.width,cv.height);S.ren.setPixelRatio(Math.min(devicePixelRatio,2));
  S.ren.shadowMap.enabled=true;S.ren.shadowMap.type=THREE.PCFSoftShadowMap;
  S.scene.add(new THREE.AmbientLight(0xffffff,0.9));
  const sun=new THREE.DirectionalLight(0xffffff,1.2);sun.position.set(12,25,12);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);S.scene.add(sun);  const g=new THREE.Mesh(new THREE.PlaneGeometry(120,120),new THREE.MeshStandardMaterial({color:0x22222a}));g.rotation.x=-Math.PI/2;g.receiveShadow=true;S.scene.add(g);
  S.localPlayer=createRig(0xff3333);S.localPlayer.group.position.y=1;S.localPlayer.userData.isDead=false;S.scene.add(S.localPlayer.group);
  if(S.gameId==='cheese'){const ex=new THREE.Mesh(new THREE.TorusGeometry(2,0.25,8,20),new THREE.MeshStandardMaterial({color:0x00ff88,emissive:0x00ff88,emissiveIntensity:0.8}));ex.rotation.x=Math.PI/2;ex.position.y=2;ex.visible=false;S.scene.add(ex);S.exitMesh=ex;}
  startLoop();
}

function setupInput(){
  if(!isMobile){
    document.addEventListener('keydown',e=>{if(e.code==='KeyW')S.inp.f=-1;if(e.code==='KeyS')S.inp.f=1;if(e.code==='KeyA')S.inp.r=-1;if(e.code==='KeyD')S.inp.r=1;if(e.code==='Space')S.inp.jump=true;if(e.code==='KeyE')S.inp.action=true;});
    document.addEventListener('keyup',e=>{if(['KeyW','KeyS'].includes(e.code))S.inp.f=0;if(['KeyA','KeyD'].includes(e.code))S.inp.r=0;if(e.code==='Space')S.inp.jump=false;if(e.code==='KeyE')S.inp.action=false;});
    document.addEventListener('mousemove',e=>{if(document.pointerLockElement){S.yaw-=e.movementX*0.002;S.pitch=Math.max(-1.2,Math.min(1.2,S.pitch-e.movementY*0.002));}});
    document.addEventListener('click',()=>{if(!document.pointerLockElement)S.ren.domElement.requestPointerLock();});
  }else{
    const joy=document.getElementById('joy-zone'),stick=document.getElementById('joy-stick'),look=document.getElementById('look-zone');
    joy.addEventListener('touchstart',e=>{e.preventDefault();const t=e.changedTouches[0];S.joyId=t.identifier;S.joyStart={x:t.clientX,y:t.clientY};},{passive:false});
    look.addEventListener('touchstart',e=>{e.preventDefault();const t=e.changedTouches[0];S.lookId=t.identifier;S.lookPrev={x:t.clientX,y:t.clientY};},{passive:false});
    window.addEventListener('touchmove',e=>{e.preventDefault();for(const t of e.changedTouches){if(t.identifier===S.joyId){const dx=t.clientX-S.joyStart.x,dy=t.clientY-S.joyStart.y,dist=Math.min(45,Math.hypot(dx,dy)),ang=Math.atan2(dy,dx);stick.style.transform=`translate(calc(-50% + ${Math.cos(ang)*dist}px), calc(-50% + ${Math.sin(ang)*dist}px))`;S.inp.r=Math.cos(ang)*(dist/45);S.inp.f=Math.sin(ang)*(dist/45);}if(t.identifier===S.lookId){S.yaw-=(t.clientX-S.lookPrev.x)*0.009;S.pitch=Math.max(-1.2,Math.min(1.2,S.pitch-(t.clientY-S.lookPrev.y)*0.009));S.lookPrev={x:t.clientX,y:t.clientY};}}},{passive:false});
    window.addEventListener('touchend',e=>{for(const t of e.changedTouches){if(t.identifier===S.joyId){S.joyId=null;S.inp.f=0;S.inp.r=0;stick.style.transform='translate(-50%,-50%)';}if(t.identifier===S.lookId)S.lookId=null;}});
    document.getElementById('btn-jump').addEventListener('touchstart',e=>{e.preventDefault();S.inp.jump=true;});document.getElementById('btn-jump').addEventListener('touchend',()=>S.inp.jump=false);
    document.getElementById('btn-action').addEventListener('touchstart',e=>{e.preventDefault();S.inp.action=true;});document.getElementById('btn-action').addEventListener('touchend',()=>S.inp.action=false);
  }
  document.getElementById('chat-input').addEventListener('keypress',e=>{if(e.key==='Enter'&&e.target.value.trim()&&S.ws?.readyState===1){S.ws.send(JSON.stringify({playerId:S.id,type:'chat',msg:e.target.value.trim()}));addChat(S.name,e.target.value.trim(),true);e.target.value='';}});
}

let lt=0;function startLoop(){requestAnimationFrame(loop);}
function loop(t){
  requestAnimationFrame(loop);
  const dt=Math.min((t-lt)/1000,0.1);lt=t;
  
  for(let i=S.deadPlayers.length-1;i>=0;i--){
    const d=S.deadPlayers[i];d.timer-=dt;d.vel.y-=15*dt;d.mesh.position.add(d.vel.clone().multiplyScalar(dt));d.mesh.rotation.x+=dt*5;d.mesh.rotation.z+=dt*3;
    if(d.timer<=0||d.mesh.position.y<-5){S.scene.remove(d.mesh);S.deadPlayers.splice(i,1);}
  }

  if(S.localPlayer && !S.localPlayer.userData.isDead){
    const sp=0.16;const fwd=new THREE.Vector3(-Math.sin(S.yaw),0,-Math.cos(S.yaw));const rgt=new THREE.Vector3(Math.cos(S.yaw),0,-Math.sin(S.yaw));
    let mv=new THREE.Vector3();if(S.inp.f<0)mv.add(fwd);if(S.inp.f>0)mv.sub(fwd);if(S.inp.r<0)mv.sub(rgt);if(S.inp.r>0)mv.add(rgt);
    if(mv.length()>0){
      mv.normalize();const nx=S.localPlayer.group.position.x+mv.x*sp,nz=S.localPlayer.group.position.z+mv.z*sp;
      const half=9.5,gx=Math.floor((nx/CELL_SIZE)+half),gz=Math.floor((nz/CELL_SIZE)+half);
      if(!(gx>=0&&gx<GRID_SIZE&&gz>=0&&gz<GRID_SIZE&&S.mazeGrid[gz]?.[gx]?.isWall)){S.localPlayer.group.position.x=nx;S.localPlayer.group.position.z=nz;}
      S.localPlayer.group.rotation.y=S.yaw+Math.PI;
    }
    if(S.inp.jump&&S.localPlayer.group.position.y<=1.01){S.localPlayer.group.position.y=3.5;S.inp.jump=false;}
    if(S.localPlayer.group.position.y>1)S.localPlayer.group.position.y-=0.2;if(S.localPlayer.group.position.y<1)S.localPlayer.group.position.y=1;
    
    const mvng=Math.abs(S.inp.f)>0.1||Math.abs(S.inp.r)>0.1;const spd=mvng?4:0;const amp=mvng?0.6:0;const tm=t*0.01;
    S.localPlayer.lL.rotation.x=Math.sin(tm*spd)*amp;S.localPlayer.rL.rotation.x=-Math.sin(tm*spd)*amp;S.localPlayer.lA.rotation.x=-Math.sin(tm*spd)*amp;S.localPlayer.rA.rotation.x=Math.sin(tm*spd)*amp;
    
    if(S.connected){S.ws.send(JSON.stringify({playerId:S.id,type:'input',f:S.inp.f,r:S.inp.r,jump:S.inp.jump,action:S.inp.action,yaw:S.yaw}));S.inp.action=false;}    const cd=isMobile?4:7,ch=isMobile?2.8:4;
    S.cam.position.set(S.localPlayer.group.position.x+Math.sin(S.yaw)*cd,S.localPlayer.group.position.y+ch+Math.sin(S.pitch)*1.5,S.localPlayer.group.position.z+Math.cos(S.yaw)*cd);
    S.cam.lookAt(S.localPlayer.group.position.x,S.localPlayer.group.position.y+1.5,S.localPlayer.group.position.z);
    
    S.players.forEach(p=>{
      if(p.tag){const pos=p.mesh.group.position.clone();pos.y+=3.5;pos.project(S.cam);if(pos.z<1){p.tag.style.display='block';p.tag.style.left=(pos.x*0.5+0.5)*innerWidth+'px';p.tag.style.top=(-pos.y*0.5+0.5)*innerHeight+'px';}else p.tag.style.display='none';}
      const om=p.animState===1;const os=om?4:0;const oa=om?0.6:0;p.mesh.lL.rotation.x=Math.sin(t*0.01*os)*oa;p.mesh.rL.rotation.x=-Math.sin(t*0.01*os)*oa;p.mesh.lA.rotation.x=-Math.sin(t*0.01*os)*oa;p.mesh.rA.rotation.x=Math.sin(t*0.01*os)*oa;
    });
    S.cheeses.forEach(c=>{c.rotation.y+=0.01;c.position.y=Math.sin(Date.now()*0.002)*0.05;});
  }
  S.ren.render(S.scene,S.cam);
}

function addChat(n,m,self=false){const b=document.getElementById('chat-box'),d=document.createElement('div');d.className='msg '+(self?'':'sys');d.innerHTML=self?`<span class="n">${n}:</span> ${m}`:m;b.appendChild(d);b.scrollTop=b.scrollHeight;}
window.addEventListener('resize',()=>{if(S.cam&&S.ren){const cv=document.getElementById('c');cv.width=innerWidth;cv.height=innerHeight;S.cam.aspect=innerWidth/innerHeight;S.cam.updateProjectionMatrix();S.ren.setSize(innerWidth,innerHeight);}});
</script>
</body>
</html>
