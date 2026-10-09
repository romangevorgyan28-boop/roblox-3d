// ===================== ROBLOX 3D ULTIMATE — CLIENT ENGINE =====================
import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { EffectComposer } from 'https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FXAAShader } from 'https://unpkg.com/three@0.160.0/examples/jsm/shaders/FXAAShader.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';

const State = {
  ws: null, playerId: null, playerName: 'Guest', myTeam: null, currentGame: null,
  token: localStorage.getItem('r3d_token') || null, authenticated: false, avatar: null,
  scene: null, camera: null, renderer: null, composer: null, fxaaPass: null, playerMesh: null,
  otherPlayers: new Map(), keys: {}, yaw: 0, pitch: 0, chatInitialized: false,
  studioObjects: [], airplaneState: null, cheeseWalls: [], cheeses: [], rat: null,
  audioCtx: null, shootSound: null, weaponMesh: null, health: 100, maxHealth: 100,
  ammo: 30, magSize: 30, reserve: 90, reloading: false, kills: 0, deaths: 0, streak: 0,
  scores: { red: 0, blue: 0 }, vel: new THREE.Vector3(), onGround: true,
  particles: [], raycaster: new THREE.Raycaster(), clock: new THREE.Clock(),
  lastInputSent: 0, hitMarkerT: 0, damageFlashT: 0, lowHealthWarned: false,
  racingState: null, raceLap: 0, raceCheckpoint: -1, raceTime: 0, bestTime: null,
  bokeh: null, sunLight: null, hemiLight: null, sky: null, fogBase: null,
  inputHandlerAttached: false, planeCamShake: 0, smokeTimer: 0, engineAudio: null,
  cheeseEaten: 0, cheeseScore: 0, cheeseLevel: 1, timerStart: Date.now(), gameStartTime: Date.now()
};

let DOM = {};
function cacheDom() {
  const ids = ['gameUI','canvas','chatMessages','chatInput','playerCount','studioPanel','objCount',
   'settingsPanel','settingsName','settingsMsg','shooterHud','healthBar','healthText','ammoCounter',
   'crosshair','hitMarker','damageFlash','killFeed','scoreboard','fpsCounter','speedometer','altitude',
   'lapInfo','timerInfo','cheeseInfo','staminaBar','objective','teamLabel','minimap','minimapCanvas',
   'deathOverlay','respawnBtn','lowHealthVignette','weaponDisplay','compass','compassStrip','toastBox',
   'batteryBar','online-hud'].concat([
   'btn-settings','btn-studio','btn-save-name','btn-spawn-cube','btn-spawn-sphere','btn-change-color',
   'btn-clear-objects','btn-run-code','btn-upload-model','exit-game','code-editor','model-upload',
   'sb-red','sb-blue','sb-kills','sb-deaths','sb-streak','sb-ping']);
  ids.forEach(id => DOM[id] = document.getElementById(id));
  // expose every element id under its camelCase key as well
  document.querySelectorAll('[id]').forEach(el => {
    const camel = el.id.replace(/-([a-z])/g, (m, c) => c.toUpperCase());
    if (!DOM[camel]) DOM[camel] = el;
  });
  // expose every element id under its camelCase key as well
  document.querySelectorAll('[id]').forEach(el => {
    const camel = el.id.replace(/-([a-z])/g, (m, c) => c.toUpperCase());
    if (!DOM[camel]) DOM[camel] = el;
  });
}

// ===================== AUDIO ENGINE =====================
function initAudio() {
  if (State.audioCtx) return;
  try { State.audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
  if (State.audioCtx) {
    State.masterGain = State.audioCtx.createGain();
    State.masterGain.gain.value = 0.5;
    State.masterGain.connect(State.audioCtx.destination);
  }
  State.shootSound = new Audio('shoot.mp3');
  State.shootSound.volume = 0.35;
  State.shootSound.preload = 'auto';
}
function tone(freq, dur, type = 'sine', vol = 0.15, slideTo = null) {
  if (!State.audioCtx) initAudio();
  if (!State.audioCtx) return;
  const o = State.audioCtx.createOscillator(), g = State.audioCtx.createGain();
  o.type = type; o.frequency.value = freq;
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), State.audioCtx.currentTime + dur);
  g.gain.setValueAtTime(vol, State.audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, State.audioCtx.currentTime + dur);
  o.connect(g); g.connect(State.masterGain || State.audioCtx.destination);
  o.start(); o.stop(State.audioCtx.currentTime + dur);
}
function noiseBurst(dur = 0.15, vol = 0.2, lp = 1200) {
  if (!State.audioCtx) initAudio();
  if (!State.audioCtx) return;
  const len = Math.floor(State.audioCtx.sampleRate * dur);
  const buf = State.audioCtx.createBuffer(1, len, State.audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = State.audioCtx.createBufferSource(); src.buffer = buf;
  const f = State.audioCtx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp;
  const g = State.audioCtx.createGain(); g.gain.value = vol;
  src.connect(f); f.connect(g); g.connect(State.masterGain || State.audioCtx.destination);
  src.start();
}
function playShootSound() {
  if (!State.shootSound) initAudio();
  try {
    const c = State.shootSound.cloneNode(true);
    c.volume = 0.35; c.play().catch(() => {});
  } catch (e) {}
  noiseBurst(0.08, 0.12, 3000);
}
function playHitSound()   { tone(1400, 0.07, 'square', 0.12, 900); }
function playKillSound()  { tone(660, 0.12, 'triangle', 0.18, 990); setTimeout(() => tone(990, 0.18, 'triangle', 0.18, 1320), 110); }
function playHurtSound()  { tone(180, 0.2, 'sawtooth', 0.15, 90); }
function playJumpSound()  { tone(300, 0.12, 'sine', 0.08, 500); }
function playLandSound()  { noiseBurst(0.06, 0.08, 500); }
function playPickupSound(){ tone(880, 0.08, 'sine', 0.12, 1320); setTimeout(() => tone(1320, 0.1, 'sine', 0.1), 70); }
function playReloadSound(){ tone(500, 0.05, 'square', 0.08); setTimeout(() => tone(700, 0.05, 'square', 0.08), 250); }
function playDeathSound() { tone(400, 0.6, 'sawtooth', 0.2, 60); }
function playErrorSound() { tone(200, 0.15, 'square', 0.1, 150); }
function startEngineSound() {
  stopEngineSound();
  if (!State.audioCtx) initAudio();
  if (!State.audioCtx) return;
  const o = State.audioCtx.createOscillator(), o2 = State.audioCtx.createOscillator();
  const g = State.audioCtx.createGain(), f = State.audioCtx.createBiquadFilter();
  o.type = 'sawtooth'; o2.type = 'square';
  f.type = 'lowpass'; f.frequency.value = 400;
  g.gain.value = 0.0;
  o.connect(f); o2.connect(f); f.connect(g); g.connect(State.masterGain || State.audioCtx.destination);
  o.frequency.value = 60; o2.frequency.value = 30;
  o.start(); o2.start();
  State.engineAudio = { o, o2, g, f };
}
function updateEngineSound(rpm) {
  if (!State.engineAudio) return;
  State.engineAudio.o.frequency.value = 40 + rpm * 90;
  State.engineAudio.o2.frequency.value = 20 + rpm * 45;
  State.engineAudio.g.gain.value = 0.03 + rpm * 0.05;
  State.engineAudio.f.frequency.value = 300 + rpm * 1500;
}
function stopEngineSound() {
  if (State.engineAudio) {
    try { State.engineAudio.o.stop(); State.engineAudio.o2.stop(); } catch (e) {}
    State.engineAudio = null;
  }
}

// ===================== UTILITIES =====================
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtTime(ms) {
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
function showToast(msg, color = '#fff') {
  const box = document.getElementById('toastBox');
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  t.style.borderColor = color;
  box.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 2600);
}
function bigCenterText(main, sub, color = '#00d9ff', dur = 1500) {
  const el = document.getElementById('center-announce');
  el.innerHTML = `<div class="ca-main" style="color:${color}">${main}</div>` + (sub ? `<div class="ca-sub">${sub}</div>` : '');
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), dur);
}

// ===================== PARTICLES =====================
function spawnParticles(pos, color, count = 12, speed = 5, size = 0.12, life = 0.6, gravity = -9) {
  if (!State.scene) return;
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(size, size, size),
      new THREE.MeshBasicMaterial({ color, transparent: true })
    );
    m.position.copy(pos);
    const v = new THREE.Vector3((Math.random() - 0.5), Math.random() * 0.8 + 0.2, (Math.random() - 0.5)).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8));
    State.particles.push({ mesh: m, vel: v, life, maxLife: life, gravity });
    State.scene.add(m);
  }
  if (State.particles.length > 250) {
    const old = State.particles.splice(0, State.particles.length - 250);
    old.forEach(p => { State.scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); });
  }
}
function updateParticles(dt) {
  studioPhysics(dt);
  for (let i = State.particles.length - 1; i >= 0; i--) {
    const p = State.particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      State.scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose();
      State.particles.splice(i, 1); continue;
    }
    p.vel.y += p.gravity * dt;
    p.mesh.position.addScaledVector(p.vel, dt);
    if (p.mesh.position.y < 0.05) { p.mesh.position.y = 0.05; p.vel.set(p.vel.x * 0.5, Math.abs(p.vel.y) * 0.3, p.vel.z * 0.5); }
    p.mesh.material.opacity = clamp(p.life / p.maxLife, 0, 1);
    const sc = clamp(p.life / p.maxLife, 0.1, 1);
    p.mesh.scale.setScalar(sc);
  }
}

// ===================== TRACERS =====================
function addTracer(from, to) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const mat = new THREE.LineBasicMaterial({ color: 0xffdd66, transparent: true, opacity: 0.9 });
  const line = new THREE.Line(geo, mat);
  State.scene.add(line);
  setTimeout(() => { State.scene.remove(line); geo.dispose(); mat.dispose(); }, 90);
}

// ===================== NETWORK =====================
function connectToServer() {
  if (State.ws && State.ws.readyState === 1) return;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  State.ws = new WebSocket(`${proto}//${location.host}`);
  State.ws.onopen = () => State.ws.send(JSON.stringify({ type: 'register', name: State.playerName, token: State.token || undefined }));
  State.ws.onmessage = (e) => {
    try { handleNet(JSON.parse(e.data)); } catch (err) { console.error('WS:', err); }
  };
  State.ws.onclose = () => {
    if (State.currentGame) {
      addChat('sys', '⚠️ Соединение потеряно, переподключение...');
      setTimeout(() => { if (State.currentGame) connectToServer(); }, 2000);
    }
  };
}
function send(obj) {
  if (State.ws && State.ws.readyState === 1) State.ws.send(JSON.stringify(obj));
}

function handleNet(d) {
  switch (d.type) {
    case 'registered':
      State.playerId = d.id;
      State.authenticated = !!d.authenticated;
      if (State.authenticated) { State.playerName = d.name; localStorage.setItem('r3d_name', d.name); }
      send({ type: 'join', gameId: State.currentGame });
      addChat('sys', `Добро пожаловать, ${d.name}! 🎮`);
      break;
    case 'stats':
      applyStats(d.online, d.perGame);
      break;
    case 'playerAvatar': {
      const e = State.otherPlayers.get(d.id);
      if (e && e.applyAvatar) e.applyAvatar(d.avatar);
      break;
    }
    case 'error':
      showToast('❌ ' + d.msg, '#ff4757'); break;
    case 'gameReady':
      State.myTeam = d.team;
      if (DOM.teamLabel) {
        if (d.team) { DOM.teamLabel.textContent = d.team === 'red' ? '🔴 КРАСНЫЕ' : '🔵 СИНИЕ'; DOM.teamLabel.style.color = d.team === 'red' ? '#ff4757' : '#54a0ff'; }
        else DOM.teamLabel.textContent = '';
      }
      break;
    case 'snapshot': {
      if (DOM.playerCount) DOM.playerCount.textContent = d.gamePlayers !== undefined ? d.gamePlayers : (d.players.length + 1);
      if (DOM['online-hud']) DOM['online-hud'].textContent = d.online !== undefined ? d.online : (d.players.length + 1);
      if (typeof d.ping === 'number' && DOM['sb-ping']) DOM['sb-ping'].textContent = d.ping + ' ms';
      if (d.health !== undefined) {
        if (d.health < State.health && d.health > 0) { State.damageFlashT = 0.35; playHurtSound(); }
        if (State.health <= 0 && d.health > 0) { // respawned
          hideDeathOverlay();
          if (State.playerMesh && !State.otherPlayers.size) {}
        }
        State.health = d.health;
        updateHealthUI();
      }
      if (d.scores) {
        State.scores = d.scores;
        DOM['sb-red'].textContent = d.scores.red;
        DOM['sb-blue'].textContent = d.scores.blue;
      }
      if (d.kills !== undefined) { State.kills = d.kills; DOM['sb-kills'].textContent = d.kills; }
      if (d.deaths !== undefined) { State.deaths = d.deaths; DOM['sb-deaths'].textContent = d.deaths; }
      syncOtherPlayers(d.players);
      break;
    }
    case 'chat': addChat(d.name, d.msg, d.sys); break;
    case 'shoot': break;
    case 'hit':
      State.hitMarkerT = 0.2;
      DOM.hitMarker.classList.add('hit');
      playHitSound();
      if (d.kill) {
        playKillSound();
        State.kills++; State.streak++;
        DOM['sb-kills'].textContent = State.kills;
        DOM['sb-streak'].textContent = State.streak;
        addKillFeed(`💀 Вы убил <b>${escapeHtml(d.victim)}</b>` + (State.streak >= 3 ? ` · серия ${State.streak}!` : ''), '#2ed573');
        bigCenterText('+1 УБИЙСТВО', State.streak >= 5 ? 'НЕВЕРОЯТНАЯ СЕРИЯ!' : State.streak >= 3 ? 'Серия убийств!' : '', '#2ed573', 1200);
      } else {
        addKillFeed(`🎯 Попадание${d.damage ? ' (-' + d.damage + ')' : ''}`, '#ffa502');
      }
      break;
    case 'killedBy':
      State.deaths++; State.streak = 0;
      DOM['sb-deaths'].textContent = State.deaths;
      DOM['sb-streak'].textContent = 0;
      playDeathSound();
      showDeathOverlay(d.killer);
      break;
    case 'respawn':
      hideDeathOverlay();
      State.ammo = State.magSize; State.reserve = 90;
      updateAmmoUI();
      if (State.currentGame === 'shooter') bigCenterText('🔄 ВОЗРОЖДЕНИЕ', '', '#00d9ff', 800);
      playJumpSound();
      break;
    case 'rateLimited':
      showToast('⏳ Медленнее!', '#ffa502'); break;
  }
}

function syncOtherPlayers(list) {
  const seen = new Set();
  list.forEach(p => {
    seen.add(p.id);
    let e = State.otherPlayers.get(p.id);
    if (!e) {
      e = createAvatar(p.name, p.team, p.avatar);
      e.mesh.position.set(p.x, p.y, p.z);
      State.scene.add(e.mesh);
      State.otherPlayers.set(p.id, e);
    } else if (p.avatar && e.lastAvatarStr !== JSON.stringify(p.avatar)) {
      e.applyAvatar(p.avatar);
    }
    e.lastAvatarStr = e.lastAvatarStr || JSON.stringify(p.avatar || null);
    e.tx = p.x; e.ty = p.y; e.tz = p.z; e.tYaw = -p.yaw + Math.PI;
    if (p.hp !== undefined) {
      if (e.lastHp !== p.hp) { e.lastHp = p.hp; e.drawTag(p.hp); }
    }
    if (p.moving !== undefined) e.moving = p.moving;
  });
  State.otherPlayers.forEach((e, id) => {
    if (!seen.has(id)) {
      State.scene.remove(e.mesh);
      disposeObject(e.mesh);
      State.otherPlayers.delete(id);
    }
  });
}
function disposeObject(root) {
  root.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
  });
}

// ===================== AVATARS =====================
function teamColor(team) { return team === 'red' ? 0xff4757 : team === 'blue' ? 0x3742fa : 0x00d9ff; }

const FACE_STYLES = ['😀', ':)', ';)', '😎', '😮', '😠', '😢', '😈']; // classic/simple/cool/surprised/angry/sad/devilish
const HAIR_STYLES = ['Без волос', 'Ёжик', 'Каштан', 'Дреды', 'Хвост', 'Ирокез', 'Каре', 'Лысый'];
const HAT_STYLES  = ['Нет', 'Кепка', 'Цилиндр', 'Корона', 'Ведро', 'Ушанка'];

function drawFaceCanvas(fc, faceIdx, skinCss) {
  fc.clearRect(0, 0, 64, 64);
  fc.fillStyle = skinCss; fc.fillRect(0, 0, 64, 64);
  fc.fillStyle = '#222'; fc.strokeStyle = '#222'; fc.lineWidth = 3;
  const eye = (x, y, r) => { fc.beginPath(); fc.arc(x, y, r, 0, 7); fc.fill(); };
  switch (faceIdx) {
    case 0: eye(22, 26, 4); eye(42, 26, 4); fc.beginPath(); fc.arc(32, 38, 10, .15 * Math.PI, .85 * Math.PI); fc.stroke(); break; // smile
    case 1: eye(22, 26, 4); eye(42, 26, 4); fc.beginPath(); fc.moveTo(24, 40); fc.lineTo(40, 40); fc.stroke(); break; // flat
    case 2: eye(22, 26, 4); fc.beginPath(); fc.arc(42, 26, 4, 0, 7); fc.stroke(); fc.beginPath(); fc.arc(32, 38, 10, .15 * Math.PI, .85 * Math.PI); fc.stroke(); break; // wink
    case 3: fc.fillRect(15, 22, 14, 6); fc.fillRect(35, 22, 14, 6); fc.beginPath(); fc.moveTo(15, 25); fc.lineTo(8, 23); fc.moveTo(49, 25); fc.lineTo(56, 23); fc.stroke(); fc.beginPath(); fc.arc(32, 38, 9, .2 * Math.PI, .8 * Math.PI); fc.stroke(); break; // cool (shades)
    case 4: fc.beginPath(); fc.arc(22, 26, 5, 0, 7); fc.stroke(); fc.beginPath(); fc.arc(42, 26, 5, 0, 7); fc.stroke(); fc.beginPath(); fc.arc(32, 42, 5, 0, 7); fc.fill(); break; // surprised
    case 5: fc.lineWidth = 3.5; fc.beginPath(); fc.moveTo(16, 20); fc.lineTo(27, 25); fc.moveTo(48, 20); fc.lineTo(37, 25); fc.stroke(); eye(22, 30, 3.5); eye(42, 30, 3.5); fc.beginPath(); fc.arc(32, 48, 9, 1.2 * Math.PI, 1.8 * Math.PI); fc.stroke(); break; // angry
    case 6: eye(22, 26, 4); eye(42, 26, 4); fc.fillStyle = '#4aa0e0'; fc.fillRect(19, 30, 5, 12); fc.fillRect(39, 30, 5, 12); fc.beginPath(); fc.arc(32, 48, 8, 1.15 * Math.PI, 1.85 * Math.PI); fc.stroke(); break; // sad tears
    default: fc.beginPath(); fc.moveTo(18, 22); fc.lineTo(27, 26); fc.lineTo(18, 30); fc.closePath(); fc.fill(); fc.beginPath(); fc.moveTo(46, 22); fc.lineTo(37, 26); fc.lineTo(46, 30); fc.closePath(); fc.fill(); fc.beginPath(); fc.arc(32, 40, 10, 1.1 * Math.PI, 1.9 * Math.PI); fc.stroke(); fc.beginPath(); fc.moveTo(24, 40); fc.quadraticCurveTo(32, 52, 40, 40); fc.stroke(); break; // devilish grin
  }
}
function hexToCss(h) { return '#' + new THREE.Color(h).getHexString(); }

function createAvatar(name, team, av) {
  av = av || {};
  const g = new THREE.Group();
  const col = av.shirt ? new THREE.Color(av.shirt).getHex() : teamColor(team);
  const skinCol = av.skin ? new THREE.Color(av.skin).getHex() : 0xf1c27d;
  const pantsCol = av.pants ? new THREE.Color(av.pants).getHex() : 0x2f3542;
  // torso (blocky roblox-style)
  const torsoMat = new THREE.MeshStandardMaterial({ color: col });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.0, 0.5), torsoMat);
  torso.position.y = 1.45; torso.castShadow = true; g.add(torso);
  // head
  const headMat = new THREE.MeshStandardMaterial({ color: skinCol });
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), headMat);
  head.position.y = 2.3; head.castShadow = true; g.add(head);
  // face
  const faceCv = document.createElement('canvas');
  faceCv.width = 64; faceCv.height = 64;
  const faceTex = new THREE.CanvasTexture(faceCv);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.58), new THREE.MeshBasicMaterial({ map: faceTex }));
  face.position.set(0, 2.3, 0.31); g.add(face);
  // arms
  const armMat = new THREE.MeshStandardMaterial({ color: skinCol });
  const armGeo = new THREE.BoxGeometry(0.28, 0.95, 0.28);
  const armL = new THREE.Mesh(armGeo, armMat); armL.position.set(-0.62, 1.42, 0); armL.castShadow = true; g.add(armL);
  const armR = new THREE.Mesh(armGeo, armMat); armR.position.set(0.62, 1.42, 0); armR.castShadow = true; g.add(armR);
  // legs
  const legMat = new THREE.MeshStandardMaterial({ color: pantsCol });
  const legGeo = new THREE.BoxGeometry(0.36, 0.95, 0.36);
  const legL = new THREE.Mesh(legGeo, legMat); legL.position.set(-0.24, 0.48, 0); legL.castShadow = true; g.add(legL);
  const legR = new THREE.Mesh(legGeo, legMat); legR.position.set(0.24, 0.48, 0); legR.castShadow = true; g.add(legR);
  // hair / hat group (rebuilt on avatar change)
  const headGear = new THREE.Group(); headGear.position.y = 2.6; g.add(headGear);
  const rebuildHeadGear = (hairIdx, hatIdx) => {
    while (headGear.children.length) { const o = headGear.children.pop(); headGear.remove(o); if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }
    const hairCols = [0x000000, 0x3b2a1a, 0x7a4a1e, 0xd4a017, 0x9932cd, 0xff4d9d, 0x2ed573, 0xcccccc];
    const hc = hairCols[(hairIdx || 0) % hairCols.length];
    const hmat = () => new THREE.MeshStandardMaterial({ color: hc });
    if (hairIdx === 1) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.14, 0.62), hmat()); headGear.add(m); }
    else if (hairIdx === 2) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.24, 0.66), hmat()); m.position.y = 0.04; headGear.add(m); }
    else if (hairIdx === 3) { for (let i = 0; i < 5; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.1), hmat()); m.position.set(-0.25 + i * 0.125, -0.15, 0.28); headGear.add(m); } const t = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.12, 0.62), hmat()); headGear.add(t); }
    else if (hairIdx === 4) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.14, 0.62), hmat()); headGear.add(t); const p = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.5, 0.18), hmat()); p.position.set(0, -0.2, -0.35); headGear.add(p); }
    else if (hairIdx === 5) { for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.35 - i * 0.06, 0.5), hmat()); m.position.set(0, 0.05 + i * 0.02, -0.18 + i * 0.12); headGear.add(m); } }
    else if (hairIdx === 6) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.34, 0.68), hmat()); m.position.y = -0.06; headGear.add(m); }
    // hats override colors from hair palette using own mats
    const hatCols = [0x00d9ff, 0xff4757, 0x2f3542, 0xffd700, 0x8a8f98, 0x6b4a2f];
    if (hatIdx >= 1) {
      const hcol = hatCols[hatIdx % hatCols.length];
      const hm = () => new THREE.MeshStandardMaterial({ color: hcol });
      if (hatIdx === 1) { const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.16, 12), hm()); cap.position.y = 0.06; headGear.add(cap); const brim = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.3), hm()); brim.position.set(0, 0.0, 0.42); headGear.add(brim); }
      else if (hatIdx === 2) { const base = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.06, 12), hm()); headGear.add(base); const top = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.55, 12), hm()); top.position.y = 0.3; headGear.add(top); }
      else if (hatIdx === 3) { for (let i = 0; i < 5; i++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.08), hm()); const a = i / 5 * Math.PI * 2; sp.position.set(Math.cos(a) * 0.28, 0.12, Math.sin(a) * 0.28); headGear.add(sp); } const ring = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.05, 6, 16), hm()); ring.rotation.x = Math.PI / 2; headGear.add(ring); }
      else if (hatIdx === 4) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.24, 0.34, 12), hm()); b.position.y = 0.12; headGear.add(b); const rim = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.04, 6, 16), hm()); rim.rotation.x = Math.PI / 2; headGear.add(rim); }
      else if (hatIdx === 5) { const u = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.24, 0.66), hm()); u.position.y = 0.1; headGear.add(u); const l = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.3, 0.3), hm()); l.position.set(-0.4, -0.02, 0); headGear.add(l); const r = l.clone(); r.position.x = 0.4; headGear.add(r); }
    }
  };
  rebuildHeadGear(av.hair || 0, av.hat || 0);
  const setFace = (idx) => { drawFaceCanvas(faceCv.getContext('2d'), idx || 0, hexToCss(skinCol)); faceTex.needsUpdate = true; };
  setFace(av.face || 0);
  // nametag + health bar drawn together on one canvas (updated live)
  const tagCv = document.createElement('canvas');
  tagCv.width = 256; tagCv.height = 80;
  const tagTex = new THREE.CanvasTexture(tagCv);
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tagTex, depthTest: false, transparent: true }));
  tag.scale.set(3.2, 1.0, 1);
  tag.position.y = 3.05; g.add(tag);
  const drawTag = (hp) => {
    const c = tagCv.getContext('2d');
    c.clearRect(0, 0, 256, 80);
    c.font = 'bold 26px Segoe UI, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = 'rgba(0,0,0,0.5)';
    const w = c.measureText(name).width + 18;
    c.fillRect(128 - w / 2, 4, w, 34);
    c.fillStyle = '#fff';
    c.fillText(name, 128, 22);
    if (hp !== undefined && hp !== null) {
      c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(48, 48, 160, 14);
      const pct = clamp(hp / 100, 0, 1);
      c.fillStyle = pct > 0.6 ? '#2ed573' : pct > 0.3 ? '#ffa502' : '#ff4757';
      c.fillRect(50, 50, 156 * pct, 10);
    }
    tagTex.needsUpdate = true;
  };
  drawTag(100);
  const entry = { mesh: g, tx: 0, ty: 0, tz: 0, tYaw: 0, moving: false, walkPhase: 0, drawTag,
    parts: { armL, armR, legL, legR },
    applyAvatar(nv) {
      nv = nv || {};
      if (nv.shirt) torsoMat.color.set(nv.shirt);
      if (nv.skin) { headMat.color.set(nv.skin); armMat.color.set(nv.skin); }
      if (nv.pants) legMat.color.set(nv.pants);
      setFace(nv.face || 0);
      rebuildHeadGear(nv.hair || 0, nv.hat || 0);
    }
  };
  return entry;
}

function createOwnAvatar() {
  const e = createAvatar(State.playerName, State.myTeam, State.avatar);
  e.mesh.traverse(o => { if (o.isSprite) o.visible = false; });
  State.avatarParts = e.parts;
  State.avatarEntry = e;
  return e.mesh;
}

// ===================== SKY =====================
function createSky(topColor, bottomColor) {
  const cv = document.createElement('canvas');
  cv.width = 32; cv.height = 256;
  const ctx = cv.getContext('2d');
  const gr = ctx.createLinearGradient(0, 0, 0, 256);
  const c1 = new THREE.Color(topColor), c2 = new THREE.Color(bottomColor);
  gr.addColorStop(0, `#${c1.getHexString()}`);
  gr.addColorStop(0.65, `#${c2.getHexString()}`);
  gr.addColorStop(1, `#${c2.clone().lerp(c1, 0.3).getHexString()}`);
  ctx.fillStyle = gr; ctx.fillRect(0, 0, 32, 256);
  const tex = new THREE.CanvasTexture(cv);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  const geo = new THREE.SphereGeometry(500, 32, 16);
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false });
  const sky = new THREE.Mesh(geo, mat);
  State.scene.add(sky);
  State.sky = sky;
  return sky;
}

// ===================== GAME START / EXIT =====================
function startGame(gameId) {
  State.currentGame = gameId;
  State.health = 100; State.kills = 0; State.deaths = 0; State.streak = 0;
  State.ammo = 30; State.reserve = 90; State.reloading = false;
  State.gameStartTime = Date.now(); State.timerStart = Date.now();
  State.vel.set(0, 0, 0); State.onGround = true;
  State.yaw = 0; State.pitch = 0;
  DOM.gameUI.style.display = 'block';
  DOM.shooterHud.style.display = gameId === 'shooter' ? 'block' : 'none';
  DOM.minimap.style.display = (gameId === 'cheese' || gameId === 'brookhaven') ? 'block' : 'none';
  DOM.speedometer.style.display = gameId === 'racing' ? 'flex' : 'none';
  DOM.altitude.style.display = gameId === 'airplane' ? 'block' : 'none';
  DOM.lapInfo.style.display = gameId === 'racing' ? 'block' : 'none';
  DOM.timerInfo.style.display = (gameId === 'cheese' || gameId === 'brookhaven') ? 'block' : 'none';
  DOM.cheeseInfo.style.display = gameId === 'cheese' ? 'block' : 'none';
  DOM['staminaBar'].parentElement.style.display = (gameId === 'cheese' || gameId === 'brookhaven') ? 'block' : 'none';
  const bw = document.getElementById('battery-wrap'); if (bw) bw.style.display = gameId === 'cheese' ? 'block' : 'none';
  DOM.objective.style.display = 'block';
  DOM.scoreboard.style.display = gameId === 'shooter' ? 'block' : 'none';
  DOM.compass.style.display = (gameId === 'shooter' || gameId === 'brookhaven' || gameId === 'cheese') ? 'block' : 'none';
  DOM.deathOverlay.style.display = 'none';
  hideDeathOverlay();
  updateHealthUI(); updateAmmoUI();
  DOM['sb-kills'].textContent = '0'; DOM['sb-deaths'].textContent = '0'; DOM['sb-streak'].textContent = '0';
  DOM['sb-red'].textContent = '0'; DOM['sb-blue'].textContent = '0';

  const objectives = {
    shooter: '🎯 Уничтожайте противников синей/красной команды',
    brookhaven: '🏡 Исследуйте город. Открывайте двери (E), гудите в машине (E)',
    cheese: '🧀 Найдите и соберите весь сыр! Избегайте Крысу-монстра!',
    airplane: '✈️ Пролетите сквозь все кольца! W/S — тангаж, A/D — поворот, Space — газ',
    racing: '🏎️ Гонка на кругах! WASD/стрелки, Shift — нитро, пробел — тормоз'
  };
  DOM.objective.textContent = objectives[gameId] || '';

  if (gameId === 'airplane') initAirplaneGame();
  else if (gameId === 'racing') initRacingGame();
  else init3D(gameId);

  connectToServer();
  showToast(`🎮 Загрузка: ${document.querySelector(`[data-game="${gameId}"] .game-title`)?.textContent || gameId}`, '#00d9ff');
}

function exitGame() {
  stopEngineSound();
  if (State.ws) { try { State.ws.close(); } catch (e) {} State.ws = null; }
  if (State.composer) { State.composer.dispose && State.composer.dispose(); State.composer = null; }
  if (State.renderer) { State.renderer.dispose(); State.renderer = null; }
  if (State.scene) { disposeObject(State.scene); State.scene.clear(); State.scene = null; }
  State.otherPlayers.clear();
  State.particles = [];
  State.playerMesh = null; State.weaponMesh = null; State.avatarParts = null;
  State.chatInitialized = false;
  State.studioObjects = []; State.airplaneState = null; State.cheeseWalls = []; State.rat = null;
  State.racingState = null; State.bokeh = null; State.sky = null;
  State.currentGame = null;
  State.inputHandlerAttached = false;
  State.uiClockStarted = false;
  lastTime = 0;
  DOM.gameUI.style.display = 'none';
  DOM.shooterHud.style.display = 'none';
  DOM.deathOverlay.style.display = 'none';
  DOM.chatMessages.innerHTML = '';
  DOM.killFeed.innerHTML = '';
  State.keys = {};
  if (document.pointerLockElement) document.exitPointerLock();
}

// ===================== HEALTH / AMMO UI =====================
function updateHealthUI() {
  const pct = clamp(State.health, 0, 100);
  DOM.healthBar.style.width = pct + '%';
  DOM.healthBar.style.background = pct > 60 ? 'linear-gradient(90deg,#2ed573,#7bed9f)' : pct > 30 ? 'linear-gradient(90deg,#ffa502,#ffcc00)' : 'linear-gradient(90deg,#ff4757,#ff6b81)';
  DOM.healthText.textContent = Math.round(pct);
  DOM.lowHealthVignette.style.opacity = pct < 35 && pct > 0 ? (35 - pct) / 35 : 0;
}
function updateAmmoUI() {
  DOM.ammoCounter.textContent = `${State.ammo} / ${State.reserve}`;
  DOM.ammoCounter.style.color = State.ammo === 0 ? '#ff4757' : State.ammo <= 8 ? '#ffa502' : '#00d9ff';
}

// ===================== DEATH OVERLAY =====================
function showDeathOverlay(killer) {
  DOM.deathOverlay.style.display = 'flex';
  DOM.deathKiller.textContent = killer ? `Убит игроком ${killer}` : 'Вы погибли';
  State.respawnCountdown = 5;
  DOM.respawnBtn.disabled = true;
  DOM.respawnBtn.textContent = 'Возрождение через 5...';
  clearInterval(State._respawnInt);
  State._respawnInt = setInterval(() => {
    State.respawnCountdown--;
    if (State.respawnCountdown <= 0) {
      clearInterval(State._respawnInt);
      DOM.respawnBtn.disabled = false;
      DOM.respawnBtn.textContent = '🔄 Возродиться';
    } else {
      DOM.respawnBtn.textContent = `Возрождение через ${State.respawnCountdown}...`;
    }
  }, 1000);
  if (State.playerMesh) {
    spawnParticles(State.playerMesh.position.clone(), teamColor(State.myTeam), 25, 6, 0.15, 1);
  }
}
function hideDeathOverlay() {
  DOM.deathOverlay.style.display = 'none';
  clearInterval(State._respawnInt);
  if (State.playerMesh) {
    State.playerMesh.visible = true;
    State.playerMesh.position.set(0, 1.5, 0);
  }
}

// ===================== KILL FEED =====================
function addKillFeed(html, color) {
  const d = document.createElement('div');
  d.className = 'kf-msg';
  d.style.color = color;
  d.innerHTML = html;
  DOM.killFeed.prepend(d);
  while (DOM.killFeed.children.length > 6) DOM.killFeed.removeChild(DOM.killFeed.lastChild);
  setTimeout(() => { d.style.opacity = '0'; setTimeout(() => d.remove(), 500); }, 5000);
}

// ===================== CHAT =====================
function addChat(name, msg, sys = false) {
  const d = document.createElement('div');
  d.className = 'msg';
  if (name === 'sys' || sys) { d.classList.add('sys'); d.textContent = msg; }
  else d.innerHTML = `<span class="n">${escapeHtml(name)}:</span> ${escapeHtml(msg)}`;
  DOM.chatMessages.appendChild(d);
  DOM.chatMessages.scrollTop = DOM.chatMessages.scrollHeight;
  if (DOM.chatMessages.children.length > 60) DOM.chatMessages.removeChild(DOM.chatMessages.firstChild);
}

// ===================== 3D CORE =====================
function initRenderer(withShadows = true) {
  const cv = DOM.canvas;
  cv.width = window.innerWidth; cv.height = window.innerHeight;
  State.camera = new THREE.PerspectiveCamera(72, cv.width / cv.height, 0.1, 1200);
  State.renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' });
  State.renderer.setSize(cv.width, cv.height);
  State.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  if (withShadows) {
    State.renderer.shadowMap.enabled = true;
    State.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    State.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    State.renderer.outputColorSpace = THREE.SRGBColorSpace;
  }
}
function buildComposer() {
  State.composer = new EffectComposer(State.renderer);
  State.composer.addPass(new RenderPass(State.scene, State.camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.35, 0.6, 0.85);
  State.composer.addPass(bloom);
  State.fxaaPass = new ShaderPass(FXAAShader);
  updateFxaa();
  State.composer.addPass(State.fxaaPass);
}
function updateFxaa() {
  if (!State.fxaaPass) return;
  const pr = State.renderer.getPixelRatio();
  State.fxaaPass.material.uniforms['resolution'].value.set(1 / (window.innerWidth * pr), 1 / (window.innerHeight * pr));
}
function renderFrame() {
  if (State.composer) State.composer.render();
  else if (State.renderer && State.scene && State.camera) State.renderer.render(State.scene, State.camera);
}

function init3D(gameId) {
  initRenderer();
  State.scene = new THREE.Scene();

  let topCol, botCol, fogCol, fogNear, fogFar;
  if (gameId === 'shooter')    { topCol = 0x1e2a3a; botCol = 0x4a5c6e; fogCol = 0x39485a; fogNear = 40; fogFar = 160; }
  else if (gameId === 'cheese'){ topCol = 0x05060e; botCol = 0x141830; fogCol = 0x0a0d1c; fogNear = 6;  fogFar = 42; }
  else                         { topCol = 0x4a90d9; botCol = 0xbfe3ff; fogCol = 0xa8d5f7; fogNear = 60; fogFar = 260; }

  createSky(topCol, botCol);
  State.scene.fog = new THREE.FogExp2(fogCol, gameId === 'cheese' ? 0.045 : 0.008);
  State.fogBase = gameId === 'cheese' ? 0.045 : 0.008;

  State.hemiLight = new THREE.HemisphereLight(topCol, 0x333322, gameId === 'cheese' ? 0.25 : 0.7);
  State.scene.add(State.hemiLight);
  State.sunLight = new THREE.DirectionalLight(gameId === 'cheese' ? 0x8899ff : 0xffffff, gameId === 'cheese' ? 0.35 : 1.3);
  State.sunLight.position.set(30, 50, 20);
  State.sunLight.castShadow = true;
  State.sunLight.shadow.mapSize.set(2048, 2048);
  State.sunLight.shadow.camera.left = -70; State.sunLight.shadow.camera.right = 70;
  State.sunLight.shadow.camera.top = 70; State.sunLight.shadow.camera.bottom = -70;
  State.sunLight.shadow.bias = -0.0004;
  State.scene.add(State.sunLight);

  // ground
  const groundCol = gameId === 'shooter' ? 0x57606a : gameId === 'cheese' ? 0x1c1f33 : 0x55a35a;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshStandardMaterial({ color: groundCol, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
  State.scene.add(floor);
  if (gameId !== 'cheese') {
    const grid = new THREE.GridHelper(100, 20, 0x00d9ff, 0x224455);
    grid.material.transparent = true; grid.material.opacity = 0.25;
    State.scene.add(grid);
  }

  State.colliders = []; // {x,z,hw,hd,h} AABB list for collision

  if (gameId === 'shooter') createShooterMap();
  if (gameId === 'cheese') createCheeseMaze();
  if (gameId === 'brookhaven') createBrookhaven();

  State.playerMesh = createOwnAvatar();
  State.playerMesh.position.set(0, 0, 0);
  State.scene.add(State.playerMesh);

  if (gameId === 'shooter') loadWeapon();
  setupInput();
  buildComposer();
  mainLoop();
  mainUIClock();
}

// ===================== SHOOTER MAP =====================
function addCollider(x, z, hw, hd, h = 6, mesh) {
  State.colliders.push({ x, z, hw, hd, h });
  if (mesh) { mesh.castShadow = true; mesh.receiveShadow = true; State.scene.add(mesh); }
  return mesh;
}
function createShooterMap() {
  const mats = [
    new THREE.MeshStandardMaterial({ color: 0x6b7683, roughness: 0.8 }),
    new THREE.MeshStandardMaterial({ color: 0x8a7a5e, roughness: 0.85 }),
    new THREE.MeshStandardMaterial({ color: 0x5e6f8a, roughness: 0.8 })
  ];
  // arena walls
  [[-50, 0, 2, 102], [50, 0, 2, 102], [0, -50, 102, 2], [0, 50, 102, 2]].forEach(([x, z, w, d]) => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 8, d), mats[0]);
    wall.position.set(x, 4, z);
    addCollider(x, z, w / 2, d / 2, 8, wall);
  });
  // covers
  const spots = [[-20,-20],[20,20],[-25,15],[25,-15],[0,25],[0,-25],[15,0],[-15,0],[35,35],[-35,-35],[35,-35],[-35,35],[10,-35],[-10,35]];
  spots.forEach(([x, z], i) => {
    const w = 3 + Math.random() * 3, d = 3 + Math.random() * 3, h = 2 + Math.random() * 2;
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats[i % 3]);
    box.position.set(x, h / 2, z);
    addCollider(x, z, w / 2, d / 2, h, box);
    if (i % 4 === 0) { // crates stack accent
      const small = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, h * 0.5, d * 0.6), mats[(i + 1) % 3]);
      small.position.set(x, h + h * 0.25, z);
      State.scene.add(small); small.castShadow = true;
    }
  });
  // central tower
  const tower = new THREE.Mesh(new THREE.BoxGeometry(8, 12, 8), mats[2]);
  tower.position.set(0, 6, 0);
  addCollider(0, 0, 4, 4, 12, tower);
  const beacon = new THREE.PointLight(0x00d9ff, 30, 40);
  beacon.position.set(0, 14, 0);
  State.scene.add(beacon);
  // ramp onto the tower (jump pad alternative)
  const rampMat = new THREE.MeshStandardMaterial({ color: 0x4a6b8a, roughness: 0.7 });
  [[-6.5, 0, 0.32], [6.5, 0, -0.32], [0, -6.5, 1.5 + 0.32], [0, 6.5, 1.5 - 0.32]].forEach(([rx, rz, rot]) => {
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(5, 0.4, 7), rampMat);
    ramp.position.set(rx, 2.2, rz);
    ramp.rotation.y = Math.abs(rot - 1.5) < 0.1 ? Math.PI / 2 : 0;
    ramp.rotation.x = rot > 1.5 ? -0.34 : 0.34 * (rx > 0 ? -1 : 1) * (rx !== 0 ? 1 : 0) || (rz > 0 ? -0.34 : 0.34);
    ramp.castShadow = true; ramp.receiveShadow = true;
    State.scene.add(ramp);
  });
  // rooftops around arena for sniper positions
  [[-38, 8, -8], [38, 8, 8], [-8, 8, 38], [8, 8, -38]].forEach(([bx, by, bz], i) => {
    const roof = new THREE.Mesh(new THREE.BoxGeometry(10, 1, 10), mats[i % 3]);
    roof.position.set(bx, by, bz);
    roof.castShadow = true; roof.receiveShadow = true;
    State.scene.add(roof);
    const p1 = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 1), mats[0]); p1.position.set(bx, by + 2.5, bz - 5);
    const p2 = new THREE.Mesh(new THREE.BoxGeometry(1, 4, 10), mats[0]); p2.position.set(bx - 5, by + 2.5, bz);
    p1.castShadow = p2.castShadow = true; State.scene.add(p1, p2);
    addCollider(bx, bz, 5, 5, by + 1, undefined);
    const lamp = new THREE.PointLight(0xffe066, 12, 22); lamp.position.set(bx, by + 3.5, bz); State.scene.add(lamp);
  });
  // team spawn lights
  const redSpawn = new THREE.PointLight(0xff4757, 20, 30); redSpawn.position.set(-42, 3, -42); State.scene.add(redSpawn);
  const blueSpawn = new THREE.PointLight(0x3742fa, 20, 30); blueSpawn.position.set(42, 3, 42); State.scene.add(blueSpawn);
  // spawn pads with colored glow rings
  [[-42, -42, 0xff4757], [42, 42, 0x3742fa]].forEach(([sx, sz, sc]) => {
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 0.3, 24), new THREE.MeshStandardMaterial({ color: sc, emissive: sc, emissiveIntensity: 0.5 }));
    pad.position.set(sx, 0.16, sz); pad.receiveShadow = true; State.scene.add(pad);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(4, 0.18, 8, 32), new THREE.MeshBasicMaterial({ color: sc }));
    ring.rotation.x = Math.PI / 2; ring.position.set(sx, 0.5, sz); State.scene.add(ring);
  });
  // jump pads near mid
  State.jumpPads = [];
  [[-18, 8], [18, -8]].forEach(([jx, jz]) => {
    const jp = new THREE.Mesh(new THREE.BoxGeometry(3, 0.4, 3), new THREE.MeshStandardMaterial({ color: 0x7bff9e, emissive: 0x2ed573, emissiveIntensity: 0.8 }));
    jp.position.set(jx, 0.2, jz); State.scene.add(jp);
    State.jumpPads.push(jp);
  });
  // health packs
  State.healthPacks = [];
  for (let i = 0; i < 4; i++) {
    const hp = new THREE.Group();
    const cross1 = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 0.4), new THREE.MeshStandardMaterial({ color: 0x2ed573, emissive: 0x2ed573, emissiveIntensity: 0.6 }));
    const cross2 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 1.2), cross1.material.clone());
    hp.add(cross1, cross2);
    const glow = new THREE.PointLight(0x2ed573, 6, 8); hp.add(glow);
    hp.position.set([-30, 30, -30, 30][i], 1.2, [-30, -30, 30, 30][i]);
    hp.userData.kind = 'healthpack';
    State.scene.add(hp);
    State.healthPacks.push(hp);
  }
  // ammo boxes
  State.ammoBoxes = [];
  for (let i = 0; i < 3; i++) {
    const ab = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 1.2), new THREE.MeshStandardMaterial({ color: 0xffa502, emissive: 0xffa502, emissiveIntensity: 0.4 }));
    ab.position.set([0, -40, 40][i], 0.5, [40, 0, 0][i]);
    ab.userData.kind = 'ammobox';
    State.scene.add(ab);
    State.ammoBoxes.push(ab);
  }
}

// ===================== CHEESE MAZE (HORROR) =====================
function createCheeseMaze() {
  const maze = [
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,0,0,0,1,0,0,0,0,0,1,0,0,1],
    [1,0,1,0,1,0,1,1,1,0,1,0,1,1],
    [1,0,1,0,0,0,0,0,1,0,0,0,0,1],
    [1,0,1,1,1,1,0,1,1,1,1,1,0,1],
    [1,0,0,0,0,1,0,0,0,0,0,1,0,1],
    [1,1,1,0,1,1,1,1,1,1,0,1,0,1],
    [1,0,0,0,1,0,0,0,0,1,0,0,0,1],
    [1,0,1,1,1,0,1,1,0,1,1,1,1,1],
    [1,0,0,0,0,0,1,0,0,0,0,0,0,1],
    [1,1,1,1,1,0,1,1,1,1,1,1,0,1],
    [1,0,0,0,1,0,0,0,0,0,0,1,0,1],
    [1,0,1,0,0,0,1,1,1,1,0,0,0,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1]
  ];
  const cell = 6;
  State.mazeGrid = maze; State.mazeCell = cell;
  State.mazeOffX = -(maze[0].length / 2) * cell;
  State.mazeOffZ = -(maze.length / 2) * cell;

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a2f45, roughness: 0.9 });
  State.cheeseWalls = [];
  for (let r = 0; r < maze.length; r++) for (let c = 0; c < maze[r].length; c++) if (maze[r][c] === 1) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(cell, 5, cell), wallMat);
    wall.position.set(State.mazeOffX + c * cell + cell / 2, 2.5, State.mazeOffZ + r * cell + cell / 2);
    wall.castShadow = true; wall.receiveShadow = true;
    State.scene.add(wall);
    State.cheeseWalls.push({ x: wall.position.x, z: wall.position.z, w: cell, d: cell });
    State.colliders.push({ x: wall.position.x, z: wall.position.z, hw: cell / 2, hd: cell / 2, h: 5 });
  }

  // flashlight
  State.flashlight = new THREE.SpotLight(0xfff4d6, 60, 45, 0.5, 0.45, 1.4);
  State.flashlight.castShadow = false;
  State.scene.add(State.flashlight);
  State.scene.add(State.flashlight.target);
  State.battery = 100; State.flashOn = true;

  // cheese collectibles with glow + bobbing
  State.cheeses = [];
  const openCells = [];
  for (let r = 1; r < maze.length - 1; r++) for (let c = 1; c < maze[r].length - 1; c++) if (maze[r][c] === 0) openCells.push([r, c]);
  // shuffle
  for (let i = openCells.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[openCells[i], openCells[j]] = [openCells[j], openCells[i]]; }
  const cheeseCount = 10;
  for (let i = 0; i < cheeseCount; i++) {
    const [r, c] = openCells[i];
    const cheese = new THREE.Group();
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 1.1, 0.7, 3),
      new THREE.MeshStandardMaterial({ color: 0xFFD700, emissive: 0xFFA500, emissiveIntensity: 0.7 })
    );
    base.rotation.x = Math.PI / 2;
    cheese.add(base);
    for (let j = 0; j < 4; j++) {
      const hole = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), new THREE.MeshStandardMaterial({ color: 0xB8860B }));
      hole.position.set((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 0.4, 0.36);
      cheese.add(hole);
    }
    const glow = new THREE.PointLight(0xffcc44, 8, 7);
    cheese.add(glow);
    cheese.position.set(State.mazeOffX + c * cell + cell / 2, 1.2, State.mazeOffZ + r * cell + cell / 2);
    cheese.userData.phase = Math.random() * 6.28;
    State.scene.add(cheese);
    State.cheeses.push(cheese);
  }
  State.cheeseEaten = 0; State.cheeseTotal = cheeseCount;

  // THE RAT (monster)
  State.rat = createRatModel();
  State.rat.position.set(State.mazeOffX + 11 * cell + cell / 2, 0, State.mazeOffZ + 11 * cell + cell / 2);
  State.scene.add(State.rat);
  State.ratState = { speed: 2.2, chaseSpeed: 4.6, mode: 'patrol', target: null, repath: 0, growlT: 0, caughtCooldown: 0 };
  State.ratLight = new THREE.PointLight(0xff2222, 10, 12);
  State.scene.add(State.ratLight);

  // green creepy ambient flicker light
  State.flicker = new THREE.PointLight(0x33ff66, 4, 25);
  State.scene.add(State.flicker);

  DOM.objective.textContent = `🧀 Соберите весь сыр: 0/${cheeseCount}. Берегись Крысы! (F — фонарик, Shift — бег)`;
}

function createRatModel() {
  const g = new THREE.Group();
  const furMat = new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.95 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 10), furMat);
  body.scale.set(1.6, 1, 1); body.position.y = 1.3; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.65, 10, 8), furMat);
  head.position.set(1.9, 1.5, 0); g.add(head);
  const snout = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.7, 8), new THREE.MeshStandardMaterial({ color: 0xd8a0a0 }));
  snout.rotation.z = -Math.PI / 2; snout.position.set(2.55, 1.4, 0); g.add(snout);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 2 });
  const eyeGeo = new THREE.SphereGeometry(0.12, 8, 8);
  const e1 = new THREE.Mesh(eyeGeo, eyeMat); e1.position.set(2.25, 1.75, 0.3); g.add(e1);
  const e2 = new THREE.Mesh(eyeGeo, eyeMat); e2.position.set(2.25, 1.75, -0.3); g.add(e2);
  const earMat = new THREE.MeshStandardMaterial({ color: 0xc08080 });
  const earGeo = new THREE.SphereGeometry(0.35, 8, 6);
  const er1 = new THREE.Mesh(earGeo, earMat); er1.scale.set(1, 1, 0.4); er1.position.set(1.7, 2.15, 0.45); g.add(er1);
  const er2 = new THREE.Mesh(earGeo, earMat); er2.scale.set(1, 1, 0.4); er2.position.set(1.7, 2.15, -0.45); g.add(er2);
  // tail
  const tailPts = [new THREE.Vector3(-1.6, 1.2, 0), new THREE.Vector3(-2.6, 1.5, 0.3), new THREE.Vector3(-3.4, 0.9, -0.2), new THREE.Vector3(-4.2, 1.3, 0.2)];
  const tailCurve = new THREE.CatmullRomCurve3(tailPts);
  const tail = new THREE.Mesh(new THREE.TubeGeometry(tailCurve, 12, 0.12, 6), new THREE.MeshStandardMaterial({ color: 0xd8a0a0 }));
  g.add(tail);
  // legs
  const legMat = furMat;
  const legGeo = new THREE.CylinderGeometry(0.16, 0.13, 1.1, 6);
  const legs = [];
  [[0.9, 0.5], [0.9, -0.5], [-0.9, 0.5], [-0.9, -0.5]].forEach(([x, z]) => {
    const l = new THREE.Mesh(legGeo, legMat);
    l.position.set(x, 0.55, z); g.add(l); legs.push(l);
  });
  g.userData.legs = legs;
  g.traverse(o => o.castShadow = true);
  return g;
}

// BFS pathfinding in maze grid
function mazePath(fromPos, toPos) {
  const { mazeGrid: M, mazeCell: cell, mazeOffX: ox, mazeOffZ: oz } = State;
  const rc = (p) => [Math.floor((p.z - oz) / cell), Math.floor((p.x - ox) / cell)];
  const center = (r, c) => new THREE.Vector3(ox + c * cell + cell / 2, 0, oz + r * cell + cell / 2);
  const [sr, sc] = rc(fromPos), [tr, tc] = rc(toPos);
  if (sr < 0 || sc < 0 || tr < 0 || tc < 0 || sr >= M.length || sc >= M[0].length || tr >= M.length || tc >= M[0].length) return null;
  if (M[sr][sc] === 1 || M[tr][tc] === 1) return null;
  const key = (r, c) => r * 100 + c;
  const prev = new Map(); prev.set(key(sr, sc), null);
  const q = [[sr, sc]];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (q.length) {
    const [r, c] = q.shift();
    if (r === tr && c === tc) {
      const path = [];
      let cur = key(r, c);
      while (cur !== null) {
        path.unshift(center(Math.floor(cur / 100), cur % 100));
        cur = prev.get(cur);
      }
      return path;
    }
    for (const [dr, dc] of dirs) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nc < 0 || nr >= M.length || nc >= M[0].length || M[nr][nc] === 1) continue;
      if (prev.has(key(nr, nc))) continue;
      prev.set(key(nr, nc), key(r, c));
      q.push([nr, nc]);
    }
  }
  return null;
}

function updateRat(dt, t) {
  const rat = State.rat, rs = State.ratState;
  if (!rat || !State.playerMesh) return;
  const pp = State.playerMesh.position;
  const dist = rat.position.distanceTo(pp);

  // detect player: LOS-ish by distance + noise
  const canSee = dist < 22 && (!State.mazeGrid || directLineClear(rat.position, pp));
  rs.mode = canSee ? 'chase' : (rs.mode === 'chase' && dist < 30 ? 'search' : 'patrol');

  rs.repath -= dt;
  if (rs.repath <= 0) {
    rs.repath = 0.5;
    if (rs.mode === 'chase') rs.path = mazePath(rat.position, pp);
    else if (rs.mode === 'search') {
      rs.path = rs.searchTarget ? mazePath(rat.position, rs.searchTarget) : null;
      if (!rs.path || rat.position.distanceTo(rs.searchTarget) < 2) {
        rs.searchTarget = new THREE.Vector3(pp.x + (Math.random() - 0.5) * 12, 0, pp.z + (Math.random() - 0.5) * 12);
        rs.path = mazePath(rat.position, rs.searchTarget);
      }
    } else {
      // patrol: random open cell
      const M = State.mazeGrid, cell = State.mazeCell;
      const open = [];
      for (let r = 1; r < M.length - 1; r++) for (let c = 1; c < M[r].length - 1; c++) if (M[r][c] === 0) open.push([r, c]);
      const [r, c] = open[Math.floor(Math.random() * open.length)];
      rs.path = mazePath(rat.position, new THREE.Vector3(State.mazeOffX + c * cell + cell / 2, 0, State.mazeOffZ + r * cell + cell / 2));
    }
  }

  const speed = (rs.mode === 'chase' ? rs.chaseSpeed : rs.speed) * (1 + (State.cheeseEaten / State.cheeseTotal) * 0.8);
  if (rs.path && rs.path.length > 1) {
    const next = rs.path[1];
    const dir = new THREE.Vector3(next.x - rat.position.x, 0, next.z - rat.position.z);
    const dl = dir.length();
    if (dl < 0.4) rs.path.shift();
    else {
      dir.normalize();
      rat.position.addScaledVector(dir, speed * dt);
      const targetYaw = Math.atan2(dir.x, dir.z) - Math.PI / 2;
      let dy = targetYaw - rat.rotation.y;
      while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
      rat.rotation.y += dy * Math.min(1, dt * 6);
    }
  }

  // animate legs & body
  const legs = rat.userData.legs;
  if (legs) legs.forEach((l, i) => { l.rotation.x = Math.sin(t * (4 + speed * 2) + i * Math.PI / 2) * 0.6; });
  rat.position.y = Math.abs(Math.sin(t * 6)) * 0.08;

  // eyes glow stronger when chasing
  rat.traverse(o => {
    if (o.isMesh && o.material && o.material.emissive && o.material.emissive.getHex() === 0xff0000) {
      o.material.emissiveIntensity = rs.mode === 'chase' ? 4 : 1.5;
    }
  });
  State.ratLight.position.copy(rat.position).add(new THREE.Vector3(0, 2, 0));
  State.ratLight.intensity = rs.mode === 'chase' ? 25 : 8;

  // growl sound proximity
  rs.growlT -= dt;
  if (rs.growlT <= 0 && dist < 18) {
    rs.growlT = clamp(dist / 4, 0.7, 3);
    tone(70 + Math.random() * 30, 0.5, 'sawtooth', clamp(0.25 - dist * 0.01, 0.03, 0.2), 40);
  }

  // catch player
  rs.caughtCooldown -= dt;
  if (dist < 1.8 && rs.caughtCooldown <= 0 && State.health > 0) {
    rs.caughtCooldown = 2;
    State.health = Math.max(0, State.health - 40);
    updateHealthUI();
    State.damageFlashT = 0.6;
    playHurtSound();
    bigCenterText('🐀 КРЫСА ДОГНАЛА!', '-40 HP', '#ff4757', 1000);
    // knockback
    const kb = new THREE.Vector3().subVectors(pp, rat.position).setY(0).normalize().multiplyScalar(4);
    State.vel.add(kb);
    if (State.health <= 0) {
      send({ type: 'cheeseDie' });
      showDeathOverlay('Крыса-монстр 🐀');
      State.health = 0; updateHealthUI();
    }
  }
}

function directLineClear(a, b) {
  const M = State.mazeGrid, cell = State.mazeCell, ox = State.mazeOffX, oz = State.mazeOffZ;
  const steps = 12;
  for (let i = 1; i < steps; i++) {
    const x = lerp(a.x, b.x, i / steps), z = lerp(a.z, b.z, i / steps);
    const c = Math.floor((x - ox) / cell), r = Math.floor((z - oz) / cell);
    if (r < 0 || c < 0 || r >= M.length || c >= M[0].length || M[r][c] === 1) return false;
  }
  return true;
}

// ===================== BROOKHAVEN RP =====================
function createBrookhaven() {
  // roads
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x3b3f46, roughness: 0.9 });
  const mkRoad = (x, z, w, d) => {
    const r = new THREE.Mesh(new THREE.PlaneGeometry(w, d), roadMat);
    r.rotation.x = -Math.PI / 2; r.position.set(x, 0.02, z); r.receiveShadow = true;
    State.scene.add(r);
    // markings
    const markMat = new THREE.MeshBasicMaterial({ color: 0xf7f7f7 });
    for (let i = -Math.max(w, d) / 2 + 3; i < Math.max(w, d) / 2; i += 7) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w > d ? 2.5 : 0.35, w > d ? 0.35 : 2.5), markMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(w > d ? x + i : x, 0.03, w > d ? z : z + i);
      State.scene.add(m);
    }
  };
  mkRoad(0, 0, 100, 10); mkRoad(0, 0, 10, 100); mkRoad(0, -35, 100, 8); mkRoad(0, 35, 100, 8);

  const houseColors = [0xf8f9fa, 0xffe0ac, 0xa8d8ea, 0xffb6b9, 0xc1e1c5, 0xe2c6ff];
  State.interactiveDoors = [];
  const positions = [];
  for (let gx = -1; gx <= 1; gx++) for (let gz = -1; gz <= 1; gz++) {
    if (gx === 0 && gz === 0) continue;
    positions.push([gx * 35, gz * 35]);
  }
  positions.forEach(([bx, bz], i) => {
    const house = new THREE.Group();
    const hc = houseColors[i % houseColors.length];
    const walls = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 10), new THREE.MeshStandardMaterial({ color: hc }));
    walls.position.y = 3; walls.castShadow = true; walls.receiveShadow = true; house.add(walls);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(9.5, 4, 4), new THREE.MeshStandardMaterial({ color: 0xb33939 }));
    roof.position.y = 8; roof.rotation.y = Math.PI / 4; roof.castShadow = true; house.add(roof);
    // door
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.6, 3, 0.2), new THREE.MeshStandardMaterial({ color: 0x6b4226 }));
    door.position.set(0, 1.5, 5.05); house.add(door);
    door.geometry.translate(0.8, 0, 0); // hinge at left edge
    door.position.set(-0.8, 1.5, 5.05);
    State.interactiveDoors.push({ mesh: door, open: false, angle: 0, target: 0 });
    // windows
    const winMat = new THREE.MeshStandardMaterial({ color: 0x9bd7ff, emissive: 0x334455, emissiveIntensity: 0.4 });
    [[-4, 3.5, 5.05], [4, 3.5, 5.05], [-4, 3.5, -5.05], [4, 3.5, -5.05]].forEach(([x, y, z]) => {
      const w = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 0.15), winMat);
      w.position.set(x, y, z); house.add(w);
    });
    house.position.set(bx, 0, bz);
    house.rotation.y = Math.atan2(-bx, -bz);
    State.scene.add(house);
    addCollider(bx, bz, 7, 7, 6);
  });

  // trees
  for (let i = 0; i < 26; i++) {
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 3, 8), new THREE.MeshStandardMaterial({ color: 0x8B4513 }));
    trunk.position.y = 1.5; trunk.castShadow = true; tree.add(trunk);
    const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(2.4, 1), new THREE.MeshStandardMaterial({ color: 0x27ae60, flatShading: true }));
    leaves.position.y = 4.2; leaves.castShadow = true; tree.add(leaves);
    let x = (Math.random() - 0.5) * 180, z = (Math.random() - 0.5) * 180;
    if (Math.abs(x) < 7 && Math.abs(z) < 100) x += 15;
    if (Math.abs(z) < 7 && Math.abs(x) < 100) z += 15;
    tree.position.set(x, 0, z);
    State.scene.add(tree);
    addCollider(x, z, 0.7, 0.7, 3);
  }

  // park pond
  const pond = new THREE.Mesh(new THREE.CircleGeometry(9, 32), new THREE.MeshStandardMaterial({ color: 0x3aa0d8, transparent: true, opacity: 0.85, roughness: 0.1 }));
  pond.rotation.x = -Math.PI / 2; pond.position.set(-35, 0.05, 35);
  State.scene.add(pond);

  // drivable car
  const car = createCarMesh(0xe74c3c);
  car.position.set(12, 0, 8);
  car.userData.kind = 'car';
  State.scene.add(car);
  State.car = car;
  State.carState = { driving: false, speed: 0, heading: 0 };

  // street lamps
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x2f3542 });
  [[-20, -15], [20, 15], [-20, 15], [20, -15], [0, -25], [0, 25]].forEach(([x, z]) => {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 5, 6), lampMat);
    pole.position.set(x, 2.5, z); pole.castShadow = true; State.scene.add(pole);
    const lampHead = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 8), new THREE.MeshStandardMaterial({ color: 0xfff4c4, emissive: 0xffee88, emissiveIntensity: 1.2 }));
    lampHead.position.set(x, 5.2, z); State.scene.add(lampHead);
    const pl = new THREE.PointLight(0xffe9b0, 8, 14); pl.position.set(x, 5, z); State.scene.add(pl);
  });

  // fountain in center
  const fb = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 4, 1, 20), new THREE.MeshStandardMaterial({ color: 0xdfe6e9 }));
  fb.position.set(0, 0.5, 0); fb.castShadow = true; State.scene.add(fb);
  addCollider(0, 0, 4, 4, 1);
  const water = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.1, 0.2, 20), new THREE.MeshStandardMaterial({ color: 0x74b9ff, transparent: true, opacity: 0.8 }));
  water.position.set(0, 1, 0); State.scene.add(water);
  State.fountainWater = water;
  const jet = new THREE.Mesh(new THREE.ConeGeometry(0.4, 2.2, 8), new THREE.MeshStandardMaterial({ color: 0xa8d8ff, transparent: true, opacity: 0.6 }));
  jet.position.set(0, 2.2, 0); State.scene.add(jet);
  State.fountainJet = jet;
}

function createCarMesh(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.7, 4), new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.4 }));
  body.position.y = 0.75; body.castShadow = true; g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 1.8), new THREE.MeshStandardMaterial({ color: 0x2d3436, metalness: 0.6, roughness: 0.2 }));
  cabin.position.set(0, 1.35, -0.2); cabin.castShadow = true; g.add(cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1e2124 });
  State.carWheels = [];
  [[0.95, 1.3], [-0.95, 1.3], [0.95, -1.3], [-0.95, -1.3]].forEach(([x, z]) => {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.position.set(x, 0.42, z); g.add(w); State.carWheels.push(w);
  });
  const hlMat = new THREE.MeshStandardMaterial({ color: 0xfff9c4, emissive: 0xffff99, emissiveIntensity: 1 });
  [[0.6, -2.01], [-0.6, -2.01]].forEach(([x, z]) => {
    const hl = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.1, 10), hlMat);
    hl.rotation.x = Math.PI / 2; hl.position.set(x, 0.8, z); g.add(hl);
  });
  return g;
}

// ===================== WEAPON =====================
function loadWeapon() {
  const loader = new GLTFLoader();
  const fallback = () => {
    const gun = new THREE.Group();
    const mk = (w, h, d, x, y, z, col) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: col, metalness: 0.6, roughness: 0.4 }));
      m.position.set(x, y, z); gun.add(m); return m;
    };
    mk(0.09, 0.1, 0.55, 0, 0, -0.25, 0x22282e);   // receiver
    mk(0.05, 0.05, 0.45, 0, 0.02, -0.65, 0x111518); // barrel
    mk(0.08, 0.22, 0.1, 0, -0.14, 0.02, 0x2d3436);  // magazine
    mk(0.08, 0.18, 0.1, 0, -0.12, 0.22, 0x3d3227);  // grip
    mk(0.06, 0.06, 0.2, 0, 0.09, -0.05, 0x444a52);  // sight
    gun.children.forEach(c => c.castShadow = true);
    attachWeapon(gun);
  };
  loader.load('rifle.glb', (gltf) => {
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const sc = 0.9 / maxDim;
    model.scale.setScalar(sc);
    const center = box.getCenter(new THREE.Vector3()).multiplyScalar(sc);
    model.position.sub(center);
    const wrapper = new THREE.Group();
    wrapper.add(model);
    attachWeapon(wrapper);
  }, undefined, fallback);
}
function attachWeapon(gun) {
  gun.rotation.y = Math.PI;
  gun.position.set(0.28, -0.26, -0.55);
  State.weaponRoot = new THREE.Group();
  State.weaponRoot.add(gun);
  State.weaponMesh = gun;
  State.camera.add(State.weaponRoot);
  State.scene.add(State.camera);
}

// ===================== SHOOTING =====================
let lastShot = 0;
function shoot() {
  if (State.currentGame !== 'shooter' || State.health <= 0) return;
  const now = performance.now();
  if (State.reloading || now - lastShot < 130) return;
  if (State.ammo <= 0) { reload(); return; }
  lastShot = now;
  State.ammo--;
  updateAmmoUI();
  playShootSound();
  send({ type: 'action' });

  // recoil visual
  if (State.weaponRoot) {
    State.weaponRoot.position.z += 0.09;
    State.weaponRoot.rotation.x -= 0.06;
  }
  State.pitch = clamp(State.pitch + 0.012, -1.2, 1.2);

  // muzzle flash
  if (State.weaponMesh) {
    const tip = new THREE.Vector3(0, 0.02, -0.95);
    if (State.weaponMesh.geometry || true) {
      const wp = tip.clone();
      State.weaponMesh.localToWorld(wp);
      spawnParticles(wp, 0xffcc44, 4, 3, 0.06, 0.15, -2);
      const fl = new THREE.PointLight(0xffaa33, 12, 6);
      fl.position.copy(wp);
      State.scene.add(fl);
      setTimeout(() => State.scene.remove(fl), 55);
    }
  }

  // hitscan
  State.raycaster.setFromCamera(new THREE.Vector2(0, 0), State.camera);
  State.raycaster.far = 150;
  const targets = [];
  State.otherPlayers.forEach(e => targets.push(e.mesh));
  const hits = State.raycaster.intersectObjects(targets, true);
  const origin = State.camera.position.clone().add(new THREE.Vector3(0, -0.2, 0).applyQuaternion(State.camera.quaternion));
  if (hits.length) {
    const hitPoint = hits[0].point;
    addTracer(origin, hitPoint);
    spawnParticles(hitPoint, 0xffdd88, 6, 4, 0.08, 0.4);
    // find owner id
    let obj = hits[0].object;
    while (obj.parent && obj.parent !== State.scene) obj = obj.parent;
    let hitId = null;
    State.otherPlayers.forEach((e, id) => { if (e.mesh === obj) hitId = id; });
    if (hitId) send({ type: 'hitTry', target: hitId });
  } else {
    const far = origin.add(State.raycaster.ray.direction.clone().multiplyScalar(100));
    addTracer(State.camera.position.clone(), far);
  }
}
function reload() {
  if (State.reloading || State.ammo === State.magSize || State.reserve <= 0) return;
  State.reloading = true;
  playReloadSound();
  DOM.ammoCounter.innerHTML = `<span class="reloading">ПЕРЕЗАРЯДКА...</span>`;
  setTimeout(() => {
    const need = State.magSize - State.ammo;
    const take = Math.min(need, State.reserve);
    State.ammo += take; State.reserve -= take;
    State.reloading = false;
    updateAmmoUI();
    if (State.weaponRoot) State.weaponRoot.rotation.x = 0;
  }, 1400);
}

// ===================== INPUT =====================
function setupInput() {
  buildCompass();
  if (State.inputHandlerAttached) return;
  State.inputHandlerAttached = true;
  document.addEventListener('keydown', e => {
    if (document.activeElement === DOM.chatInput) { if (e.code === 'Escape') DOM.chatInput.blur(); return; }
    State.keys[e.code] = true;
    if (e.code === 'KeyR' && State.currentGame === 'shooter') reload();
    if (e.code === 'KeyF' && State.currentGame === 'cheese') toggleFlashlight();
    if (e.code === 'KeyE') interact();
    if (e.code === 'Tab') { e.preventDefault(); DOM.scoreboard.classList.add('expanded'); }
    if (e.code === 'KeyM') { DOM.minimap.style.display = DOM.minimap.style.display === 'none' ? 'block' : 'none'; }
    if (e.code === 'Escape' && document.pointerLockElement) document.exitPointerLock();
  });
  document.addEventListener('keyup', e => { State.keys[e.code] = false; });
  document.addEventListener('mousemove', e => {
    if (document.pointerLockElement) {
      const sens = 0.0022;
      State.yaw -= e.movementX * sens;
      State.pitch = clamp(State.pitch - e.movementY * sens, -1.2, 1.2);
    }
  });
  DOM.canvas.addEventListener('mousedown', e => {
    if (e.button === 0 && document.pointerLockElement) State.firing = true;
  });
  document.addEventListener('mouseup', () => { State.firing = false; });
  document.addEventListener('click', () => {
    if (State.currentGame && !document.pointerLockElement && document.activeElement !== DOM.chatInput) {
      DOM.canvas.requestPointerLock?.();
    }
  });
  document.addEventListener('pointerlockchange', () => {
    if (State.currentGame === 'shooter') DOM.crosshair.style.transform = document.pointerLockElement ? 'translate(-50%,-50%) scale(1)' : 'translate(-50%,-50%) scale(1.6)';
  });
  if (!State.chatInitialized) {
    DOM.chatInput.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter' && e.target.value.trim()) {
        const msg = e.target.value.trim();
        if (msg.startsWith('/')) {
          handleCommand(msg);
        } else {
          send({ type: 'chat', msg });
        }
        e.target.value = '';
        DOM.chatInput.blur();
      }
      if (e.key === 'Escape') DOM.chatInput.blur();
    });
    // T opens chat when playing
    document.addEventListener('keydown', e => {
      if (e.code === 'KeyT' && State.currentGame && document.activeElement !== DOM.chatInput && !e.repeat) {
        e.preventDefault();
        if (document.pointerLockElement) document.exitPointerLock();
        setTimeout(() => DOM.chatInput.focus(), 50);
      }
    });
    State.chatInitialized = true;
  }
  window.addEventListener('blur', () => { State.keys = {}; State.firing = false; });
}

function handleCommand(cmd) {
  const parts = cmd.split(' ');
  const c = parts[0].toLowerCase();
  if (c === '/heal' && State.currentGame === 'shooter') { send({ type: 'chat', msg: 'is using admin command 😏' }); }
  else if (c === '/goto') { /* teleport disabled online */ addChat('sys', 'Телепорт отключен на сервере'); }
  else if (c === '/volume') { if (State.masterGain) State.masterGain.gain.value = clamp(parseFloat(parts[1]) || 0.5, 0, 1); addChat('sys', 'Громкость установлена'); }
  else if (c === '/clear') { DOM.chatMessages.innerHTML = ''; }
  else if (c === '/help') { addChat('sys', 'Команды: /help /volume 0..1 /clear /roll'); }
  else if (c === '/roll') { addChat('sys', `🎲 Выпало: ${1 + Math.floor(Math.random() * 100)}`); }
  else addChat('sys', 'Неизвестная команда. /help');
}

function interact() {
  if (!State.playerMesh) return;
  const pp = State.playerMesh.position;
  if (State.currentGame === 'brookhaven') {
    // enter/exit car
    if (State.carState.driving) {
      State.carState.driving = false;
      State.playerMesh.visible = true;
      showToast('🚶 Вы вышли из машины');
      return;
    }
    if (State.car && State.car.position.distanceTo(pp) < 4) {
      State.carState.driving = true;
      State.carState.speed = 0;
      State.playerMesh.visible = false;
      showToast('🚗 Вы сели в машину! WASD — ехать, E — выйти');
      startEngineSound();
      return;
    }
    // doors
    for (const d of State.interactiveDoors) {
      const wp = new THREE.Vector3();
      d.mesh.getWorldPosition(wp);
      if (wp.distanceTo(pp) < 4) {
        d.open = !d.open;
        d.target = d.open ? -Math.PI / 2 : 0;
        tone(300, 0.15, 'sine', 0.08, d.open ? 500 : 200);
        showToast(d.open ? '🚪 Дверь открыта' : '🚪 Дверь закрыта');
        return;
      }
    }
    showToast('Рядом нет объектов для взаимодействия');
  } else if (State.currentGame === 'shooter') {
    reload();
  }
}

function toggleFlashlight() {
  State.flashOn = !State.flashOn;
  showToast(State.flashOn ? '🔦 Фонарик включён' : '🔦 Фонарик выключен');
  tone(800, 0.05, 'square', 0.06);
}

// ===================== COLLISION =====================
function collideMove(pos, dx, dz, radius = 0.55) {
  const tryX = pos.x + dx, tryZ = pos.z + dz;
  let blockedX = false, blockedZ = false;
  for (const c of State.colliders) {
    if (Math.abs(tryX - c.x) < c.hw + radius && Math.abs(pos.z - c.z) < c.hd + radius) blockedX = true;
    if (Math.abs(pos.x - c.x) < c.hw + radius && Math.abs(tryZ - c.z) < c.hd + radius) blockedZ = true;
  }
  if (!blockedX) pos.x = tryX;
  if (!blockedZ) pos.z = tryZ;
  return !blockedX || !blockedZ;
}

// ===================== MAIN LOOP (walker games) =====================
let lastTime = 0, fpsAcc = 0, fpsFrames = 0, fpsTimer = 0;
function mainLoop() {
  requestAnimationFrame(mainLoop);
  if (!State.playerMesh || !State.scene || !State.camera) return;
  if (State.currentGame === 'airplane' || State.currentGame === 'racing') return;
  const t = performance.now();
  const dt = Math.min((t - lastTime) / 1000, 0.05) || 0.016;
  lastTime = t;
  const time = t / 1000;

  // FPS
  fpsFrames++; fpsTimer += dt;
  if (fpsTimer >= 0.5) {
    fpsAcc = Math.round(fpsFrames / fpsTimer); fpsFrames = 0; fpsTimer = 0;
    DOM.fpsCounter.textContent = fpsAcc + ' FPS';
    DOM.fpsCounter.style.color = fpsAcc > 50 ? '#2ed573' : fpsAcc > 30 ? '#ffa502' : '#ff4757';
  }

  const pm = State.playerMesh;
  const dead = State.health <= 0;

  // movement
  let moved = false;
  if (!dead && document.pointerLockElement) {
    const sprint = State.keys['ShiftLeft'] || State.keys['ShiftRight'];
    let speed = (sprint ? 9 : 5.2);
    if (State.currentGame === 'cheese') speed = sprint ? (State.batteryStaminaOk ? 8 : 5) : 4.2;
    const f = (State.keys['KeyW'] ? 1 : 0) - (State.keys['KeyS'] ? 1 : 0);
    const r = (State.keys['KeyD'] ? 1 : 0) - (State.keys['KeyA'] ? 1 : 0);
    if (f || r) {
      moved = true;
      const len = Math.hypot(f, r);
      const dirX = (f * -Math.sin(State.yaw) + r * Math.cos(State.yaw)) / len;
      const dirZ = (f * -Math.cos(State.yaw) - r * Math.sin(State.yaw)) / len;
      collideMove(pm, dirX * speed * dt, dirZ * speed * dt);
      pm.position.x = clamp(pm.position.x, -140, 140);
      pm.position.z = clamp(pm.position.z, -140, 140);
    }
    // jump
    if (State.keys['Space'] && State.onGround) {
      State.vel.y = 7.5; State.onGround = false; playJumpSound();
    }
    // gravity
    State.vel.y -= 22 * dt;
    pm.position.y += State.vel.y * dt;
    if (pm.position.y <= 0) {
      if (!State.onGround) playLandSound();
      pm.position.y = 0; State.vel.y = 0; State.onGround = true;
    }
    // walk animation
    State.walkPhase = (State.walkPhase || 0) + dt * (sprint ? 14 : 10);
    if (State.avatarParts) {
      const sw = moved ? Math.sin(State.walkPhase) * 0.7 : 0;
      State.avatarParts.armL.rotation.x = sw;
      State.avatarParts.armR.rotation.x = -sw;
      State.avatarParts.legL.rotation.x = -sw;
      State.avatarParts.legR.rotation.x = sw;
    }
    pm.rotation.y = -State.yaw + Math.PI;
  }

  // third person camera
  const camDist = State.currentGame === 'cheese' ? 5.5 : 6.5;
  const camHeight = 2.2 + Math.sin(State.pitch) * -3.2;
  const back = new THREE.Vector3(Math.sin(State.yaw) * camDist, camHeight, Math.cos(State.yaw) * camDist);
  const desired = pm.position.clone().add(back).add(new THREE.Vector3(0, 1.4, 0));
  State.camera.position.lerp(desired, Math.min(1, dt * 12));
  State.camera.lookAt(pm.position.x, pm.position.y + 1.6, pm.position.z);

  // auto fire
  if (State.firing && State.currentGame === 'shooter') shoot();

  // weapon sway/recoil recovery
  if (State.weaponRoot) {
    State.weaponRoot.position.z = lerp(State.weaponRoot.position.z, 0, dt * 10);
    State.weaponRoot.rotation.x = lerp(State.weaponRoot.rotation.x, 0, dt * 8);
    const sway = Math.sin(time * 2) * 0.004;
    State.weaponRoot.position.y = sway;
  }

  // interpolate other players
  State.otherPlayers.forEach(e => {
    e.mesh.position.x = lerp(e.mesh.position.x, e.tx, Math.min(1, dt * 10));
    e.mesh.position.y = lerp(e.mesh.position.y, e.ty - 1, Math.min(1, dt * 10));
    e.mesh.position.z = lerp(e.mesh.position.z, e.tz, Math.min(1, dt * 10));
    e.mesh.rotation.y = lerp(e.mesh.rotation.y, e.tYaw, Math.min(1, dt * 8));
    if (e.parts) {
      e.walkPhase += dt * 9;
      const sw = (e.moving ? Math.sin(e.walkPhase) * 0.6 : 0);
      e.parts.armL.rotation.x = sw; e.parts.armR.rotation.x = -sw;
      e.parts.legL.rotation.x = -sw; e.parts.legR.rotation.x = sw;
    }
  });

  updateParticles(dt);

  // ---- game-specific updates ----
  if (State.currentGame === 'shooter') updateShooter(dt, time);
  if (State.currentGame === 'cheese') updateCheese(dt, time);
  if (State.currentGame === 'brookhaven') updateBrookhaven(dt, time);

  // dynamic fog for cheese (rat nearby = thicker)
  if (State.currentGame === 'cheese' && State.rat && State.scene.fog) {
    const d = State.rat.position.distanceTo(pm.position);
    State.scene.fog.density = State.fogBase + (d < 15 ? (15 - d) * 0.004 : 0);
  }

  // minimap
  drawMinimap();

  // network input at ~15Hz
  if (State.ws?.readyState === 1 && t - State.lastInputSent > 66) {
    State.lastInputSent = t;
    send({
      type: 'input',
      f: (State.keys['KeyW'] ? 1 : 0) - (State.keys['KeyS'] ? 1 : 0),
      r: (State.keys['KeyD'] ? 1 : 0) - (State.keys['KeyA'] ? 1 : 0),
      jump: !!State.keys['Space'],
      yaw: State.yaw,
      moving: moved,
      x: pm.position.x, y: pm.position.y, z: pm.position.z
    });
  }

  // compass
  updateCompass();

  renderFrame();
}

function buildCompass() {
  if (!DOM.compassStrip || DOM.compassStrip.dataset.built) return;
  let html = '';
  for (let d = 0; d < 360; d += 15) {
    const lbl = d === 0 ? '<b>\u0421</b>' : d === 90 ? '<b>\u0412</b>' : d === 180 ? '<b>\u042e</b>' : d === 270 ? '<b>\u0417</b>' : d + '\u00b0';
    html += '<span style="display:inline-block;width:30px;text-align:center">' + lbl + '</span>';
  }
  DOM.compassStrip.innerHTML = html + html;
  DOM.compassStrip.dataset.built = '1';
}
function updateCompass() {
  if (!DOM.compassStrip) return;
  const deg = ((-State.yaw * 180 / Math.PI) % 360 + 360) % 360;
  DOM.compassStrip.style.transform = `translateX(${-(deg * 2) - 240 + 100}px)`;
}

// ===================== SHOOTER LOGIC =====================
function updateShooter(dt, time) {
  // floating pickups animation + pickup detection
  const pm = State.playerMesh.position;
  // jump pads
  State.jumpPads?.forEach((jp, i) => {
    jp.material.emissiveIntensity = 0.6 + Math.sin(time * 5 + i) * 0.35;
    if (Math.abs(pm.x - jp.position.x) < 2 && Math.abs(pm.z - jp.position.z) < 2 && pm.y < 1.6) {
      State.vel.y = 16;
      State.onGround = false;
      playJumpSound();
      spawnParticles(jp.position.clone(), 0x7bff9e, 14, 5, 0.1, 0.5);
    }
  });
  State.healthPacks?.forEach((hp, i) => {
    if (!hp.visible) return;
    hp.rotation.y += dt * 2;
    hp.position.y = 1.2 + Math.sin(time * 2 + i) * 0.2;
    if (hp.position.distanceTo(pm) < 2.2 && State.health < 100) {
      hp.visible = false;
      send({ type: 'healRequest' });
      playPickupSound();
      spawnParticles(hp.position.clone(), 0x2ed573, 12, 4, 0.1, 0.6);
      showToast('💚 Аптечка +35 HP', '#2ed573');
      setTimeout(() => { hp.visible = true; }, 20000);
    }
  });
  State.ammoBoxes?.forEach((ab, i) => {
    if (!ab.visible) return;
    ab.rotation.y += dt * 1.5;
    ab.position.y = 0.5 + Math.sin(time * 2.5 + i) * 0.15;
    if (ab.position.distanceTo(pm) < 2.2 && State.reserve < 120) {
      ab.visible = false;
      State.reserve = Math.min(150, State.reserve + 60);
      updateAmmoUI();
      playPickupSound();
      spawnParticles(ab.position.clone(), 0xffa502, 12, 4, 0.1, 0.6);
      showToast('🔫 Патроны +60', '#ffa502');
      setTimeout(() => { ab.visible = true; }, 25000);
    }
  });
  // hit marker fade
  if (State.hitMarkerT > 0) {
    State.hitMarkerT -= dt;
    if (State.hitMarkerT <= 0) DOM.hitMarker.classList.remove('hit');
  }
  // damage flash
  if (State.damageFlashT > 0) {
    State.damageFlashT -= dt;
    DOM.damageFlash.style.opacity = clamp(State.damageFlashT / 0.35, 0, 0.7);
  } else DOM.damageFlash.style.opacity = 0;
}

// ===================== CHEESE LOGIC =====================
function updateCheese(dt, time) {
  const pm = State.playerMesh.position;
  updateRat(dt, time);

  // battery
  if (State.flashOn) {
    State.battery = Math.max(0, State.battery - dt * 1.4);
    if (State.battery <= 0) { State.flashOn = false; showToast('🔋 Батарея села!', '#ff4757'); }
  } else {
    State.battery = Math.min(100, State.battery + dt * 3);
  }
  const batEl = document.getElementById('battery-bar');
  if (batEl) { batEl.style.width = State.battery + '%'; batEl.style.background = State.battery > 30 ? '#ffcc00' : '#ff4757'; }
  const bw = document.getElementById('battery-wrap');
  if (bw) bw.style.display = 'block';

  // stamina
  const sprinting = (State.keys['ShiftLeft'] || State.keys['ShiftRight']) && (State.keys['KeyW'] || State.keys['KeyS'] || State.keys['KeyA'] || State.keys['KeyD']);
  if (sprinting) State.stamina = Math.max(0, (State.stamina ?? 100) - dt * 22);
  else State.stamina = Math.min(100, (State.stamina ?? 100) + dt * 14);
  State.batteryStaminaOk = (State.stamina ?? 100) > 3;
  const stEl = DOM.staminaBar;
  stEl.style.width = (State.stamina ?? 100) + '%';

  // flashlight follows camera aim
  if (State.flashlight) {
    State.flashlight.visible = State.flashOn;
    if (State.flashOn) {
      State.flashlight.position.copy(State.camera.position);
      const dir = new THREE.Vector3();
      State.camera.getWorldDirection(dir);
      State.flashlight.target.position.copy(State.camera.position).addScaledVector(dir, 20);
      State.flashlight.target.updateMatrixWorld();
    }
  }
  // flicker ambience
  State.flicker.position.set(pm.x + Math.sin(time * 0.3) * 20, 4, pm.z + Math.cos(time * 0.2) * 20);
  State.flicker.intensity = 2 + Math.random() * 2.5;

  // collect cheese
  for (let i = State.cheeses.length - 1; i >= 0; i--) {
    const ch = State.cheeses[i];
    ch.rotation.y += dt * 1.5;
    ch.position.y = 1.2 + Math.sin(time * 2 + ch.userData.phase) * 0.25;
    if (ch.position.distanceTo(pm) < 1.8) {
      State.scene.remove(ch); disposeObject(ch);
      State.cheeses.splice(i, 1);
      State.cheeseEaten++;
      playPickupSound();
      spawnParticles(ch.position.clone(), 0xffd700, 15, 5, 0.12, 0.8);
      showToast(`🧀 Сыр ${State.cheeseEaten}/${State.cheeseTotal}`, '#ffcc00');
      DOM.objective.textContent = `🧀 Соберите весь сыр: ${State.cheeseEaten}/${State.cheeseTotal}. Берегись Крысы! (F — фонарик, Shift — бег)`;
      // rat gets faster and angrier
      State.ratState.chaseSpeed += 0.35;
      if (State.cheeses.length === 0) {
        bigCenterText('🏆 ПОБЕДА!', `Все сыры собраны за ${fmtTime(Date.now() - State.gameStartTime)}`, '#2ed573', 4000);
        playKillSound();
        send({ type: 'chat', msg: 'Я собрал весь сыр! 🧀🏆' });
        // bonus round
        setTimeout(() => {
          if (State.currentGame === 'cheese') {
            showToast('⭐ Новый уровень: крыса стала ещё быстрее!', '#ff4757');
            createCheeseReset();
          }
        }, 4000);
      }
    }
  }
  const ci = DOM.cheeseInfo;
  ci.innerHTML = `🧀 ${State.cheeseEaten}/${State.cheeseTotal} &nbsp; ⏱️ ${fmtTime(Date.now() - State.gameStartTime)}`;

  // heartbeat when rat close
  if (State.rat) {
    const d = State.rat.position.distanceTo(pm);
    if (d < 10) {
      State.heartbeatT = (State.heartbeatT || 0) - dt;
      if (State.heartbeatT <= 0) {
        State.heartbeatT = clamp(d / 10, 0.35, 0.9);
        tone(60, 0.1, 'sine', clamp(0.3 - d * 0.02, 0.05, 0.25));
      }
    }
  }
}

function createCheeseReset() {
  // remove old cheeses/walls/rat and rebuild harder
  State.cheeses.forEach(c => { State.scene.remove(c); disposeObject(c); });
  State.cheeses = [];
  State.ratState.chaseSpeed += 0.8;
  State.battery = 100;
  const maze = State.mazeGrid, cell = State.mazeCell;
  const open = [];
  for (let r = 1; r < maze.length - 1; r++) for (let c = 1; c < maze[r].length - 1; c++) if (maze[r][c] === 0) open.push([r, c]);
  for (let i = open.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[open[i], open[j]] = [open[j], open[i]]; }
  State.cheeseTotal = 8; State.cheeseEaten = 0;
  for (let i = 0; i < 8; i++) {
    const [r, c] = open[i];
    const cheese = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 0.7, 3), new THREE.MeshStandardMaterial({ color: 0xFFD700, emissive: 0xFFA500, emissiveIntensity: 0.7 }));
    base.rotation.x = Math.PI / 2; cheese.add(base);
    const glow = new THREE.PointLight(0xffcc44, 8, 7); cheese.add(glow);
    cheese.position.set(State.mazeOffX + c * cell + cell / 2, 1.2, State.mazeOffZ + r * cell + cell / 2);
    cheese.userData.phase = Math.random() * 6.28;
    State.scene.add(cheese);
    State.cheeses.push(cheese);
  }
  DOM.objective.textContent = `🧀 Уровень ${State.cheeseLevel++}: соберите 8 сыров. Крыса быстрее!`;
}

// ===================== BROOKHAVEN LOGIC =====================
function updateBrookhaven(dt, time) {
  const pm = State.playerMesh;
  // doors animation
  State.interactiveDoors.forEach(d => {
    d.angle = lerp(d.angle, d.target, dt * 5);
    d.mesh.rotation.y = d.angle;
  });
  // fountain shimmer
  if (State.fountainWater) State.fountainWater.rotation.z += dt * 0.3;
  if (State.fountainJet) State.fountainJet.scale.y = 1 + Math.sin(time * 5) * 0.15;

  // car driving
  if (State.carState.driving) {
    const cs = State.carState;
    const accel = (State.keys['KeyW'] || State.keys['ArrowUp']) ? 1 : (State.keys['KeyS'] || State.keys['ArrowDown']) ? -1 : 0;
    const brake = State.keys['Space'];
    cs.speed += accel * 14 * dt;
    if (brake) cs.speed *= Math.pow(0.02, dt);
    cs.speed *= Math.pow(0.6, dt); // drag
    cs.speed = clamp(cs.speed, -12, 22);
    const steer = ((State.keys['KeyA'] || State.keys['ArrowLeft']) ? 1 : 0) - ((State.keys['KeyD'] || State.keys['ArrowRight']) ? 1 : 0);
    cs.heading += steer * 1.8 * dt * clamp(Math.abs(cs.speed) / 8, 0, 1) * Math.sign(cs.speed || 1);
    const dir = new THREE.Vector3(-Math.sin(cs.heading), 0, -Math.cos(cs.heading));
    const np = State.car.position.clone().addScaledVector(dir, cs.speed * dt);
    // simple collider check for car
    let blocked = false;
    for (const c of State.colliders) {
      if (Math.abs(np.x - c.x) < c.hw + 1.2 && Math.abs(np.z - c.z) < c.hd + 1.2) { blocked = true; break; }
    }
    if (blocked) { cs.speed *= -0.3; spawnParticles(State.car.position.clone().add(new THREE.Vector3(0, 0.5, 0)), 0xffaa00, 4, 3, 0.08, 0.4); }
    else State.car.position.copy(np);
    State.car.position.x = clamp(State.car.position.x, -140, 140);
    State.car.position.z = clamp(State.car.position.z, -140, 140);
    State.car.rotation.y = cs.heading;
    State.carWheels?.forEach(w => w.rotation.x += cs.speed * dt * 2);
    pm.position.copy(State.car.position);
    updateEngineSound(clamp(Math.abs(cs.speed) / 22, 0.05, 1));
    // chase cam
    const camPos = State.car.position.clone().add(new THREE.Vector3(Math.sin(cs.heading) * 10, 5, Math.cos(cs.heading) * 10));
    State.camera.position.lerp(camPos, dt * 5);
    State.camera.lookAt(State.car.position.x, 1.5, State.car.position.z);
    // horn
    if (State.keys['KeyH']) { tone(400, 0.2, 'square', 0.12); tone(520, 0.2, 'square', 0.1); State.keys['KeyH'] = false; }
  } else {
    updateEngineSound(0.02);
  }
  // proximity hint
  if (!State.carState.driving && State.car) {
    const near = State.car.position.distanceTo(pm.position) < 4;
    const hint = document.getElementById('interact-hint');
    hint.style.display = near ? 'block' : 'none';
    if (near) hint.textContent = '[E] Сесть в машину';
  } else {
    document.getElementById('interact-hint').style.display = 'none';
  }
}

// ===================== MINIMAP =====================
function drawMinimap() {
  if (DOM.minimap.style.display === 'none' || !State.playerMesh) return;
  const cv = DOM.minimapCanvas, ctx = cv.getContext('2d');
  const S = cv.width, range = State.currentGame === 'cheese' ? 60 : 120;
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = 'rgba(10,15,25,0.85)';
  ctx.fillRect(0, 0, S, S);
  const px = State.playerMesh.position.x, pz = State.playerMesh.position.z;
  const toMap = (x, z) => [((x - px) / range + 0.5) * S, ((z - pz) / range + 0.5) * S];
  // colliders
  ctx.fillStyle = 'rgba(120,140,170,0.5)';
  State.colliders.forEach(c => {
    const [mx, my] = toMap(c.x - c.hw, c.z - c.hd);
    const w = (c.hw * 2 / range) * S, h = (c.hd * 2 / range) * S;
    if (mx > -w && mx < S && my > -h && my < S) ctx.fillRect(mx, my, w, h);
  });
  if (State.currentGame === 'cheese') {
    ctx.fillStyle = '#ffd700';
    State.cheeses.forEach(c => {
      const [mx, my] = toMap(c.position.x, c.position.z);
      ctx.beginPath(); ctx.arc(mx, my, 3, 0, 7); ctx.fill();
    });
    if (State.rat) {
      const [rx, ry] = toMap(State.rat.position.x, State.rat.position.z);
      ctx.fillStyle = '#ff2222';
      ctx.beginPath(); ctx.arc(rx, ry, 4, 0, 7); ctx.fill();
    }
  }
  // other players
  State.otherPlayers.forEach(e => {
    const [mx, my] = toMap(e.mesh.position.x, e.mesh.position.z);
    ctx.fillStyle = '#54a0ff';
    ctx.beginPath(); ctx.arc(mx, my, 3, 0, 7); ctx.fill();
  });
  // self arrow
  ctx.save();
  ctx.translate(S / 2, S / 2);
  ctx.rotate(-State.yaw + Math.PI);
  ctx.fillStyle = '#2ed573';
  ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4, 5); ctx.lineTo(-4, 5); ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = '#00d9ff'; ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, S - 2, S - 2);
}

// ===================== AIRPLANE GAME =====================
function initAirplaneGame() {
  initRenderer();
  State.scene = new THREE.Scene();
  createSky(0x2f7fd1, 0xbfe3ff);
  State.scene.fog = new THREE.Fog(0xa8d5f7, 200, 1400);

  State.hemiLight = new THREE.HemisphereLight(0xcfe8ff, 0x6f9a54, 0.9);
  State.scene.add(State.hemiLight);
  const sun = new THREE.DirectionalLight(0xfff1cf, 1.2);
  sun.position.set(120, 180, 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -150; sun.shadow.camera.right = 150;
  sun.shadow.camera.top = 150; sun.shadow.camera.bottom = -150;
  State.scene.add(sun); State.sunLight = sun;

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ color: 0x5f9c4a }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
  State.scene.add(floor);

  // runway
  const runway = new THREE.Mesh(new THREE.PlaneGeometry(24, 220), new THREE.MeshStandardMaterial({ color: 0x3b3f46 }));
  runway.rotation.x = -Math.PI / 2; runway.position.set(0, 0.05, 100);
  State.scene.add(runway);
  for (let i = -100; i < 100; i += 16) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    m.rotation.x = -Math.PI / 2; m.position.set(0, 0.06, 100 + i);
    State.scene.add(m);
  }

  // city blocks
  State.colliders = [];
  for (let i = 0; i < 60; i++) {
    const h = 15 + Math.random() * 70;
    const b = new THREE.Mesh(new THREE.BoxGeometry(12 + Math.random() * 16, h, 12 + Math.random() * 16),
      new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(Math.random(), 0.25, 0.55) }));
    const x = (Math.random() - 0.5) * 1400, z = (Math.random() - 0.5) * 1400;
    if (Math.abs(x) < 60 && Math.abs(z - 100) < 140) continue;
    b.position.set(x, h / 2, z);
    b.castShadow = true;
    State.scene.add(b);
    State.colliders.push({ x, z, hw: b.geometry.parameters.width / 2, hd: b.geometry.parameters.depth / 2, h });
  }

  // clouds
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, roughness: 1 });
  for (let i = 0; i < 40; i++) {
    const cl = new THREE.Group();
    for (let j = 0; j < 5; j++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(8 + Math.random() * 10, 8, 6), cloudMat);
      puff.position.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 20);
      cl.add(puff);
    }
    cl.position.set((Math.random() - 0.5) * 1600, 120 + Math.random() * 150, (Math.random() - 0.5) * 1600);
    State.scene.add(cl);
  }

  // rings course
  State.rings = [];
  State.ringsPassed = 0;
  let rx = 0, rz = 60, ry = 30;
  for (let i = 0; i < 12; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(14, 1.2, 10, 32),
      new THREE.MeshStandardMaterial({ color: 0xff6348, emissive: 0xff6348, emissiveIntensity: 0.8 }));
    rx += (Math.random() - 0.5) * 180;
    rz -= 120 + Math.random() * 80;
    ry = 25 + Math.random() * 60;
    ring.position.set(rx, ry, rz);
    ring.rotation.y = Math.random() * 0.6 - 0.3;
    ring.userData.index = i;
    State.scene.add(ring);
    State.rings.push(ring);
  }

  const airplane = createAirplane();
  airplane.position.set(0, 12, 140);
  State.scene.add(airplane);
  State.playerMesh = airplane;
  State.airplaneState = { speed: 24, pitch: 0, yaw: Math.PI, roll: 0, stalled: false };
  State.yaw = Math.PI;

  setupInput();
  buildComposer();
  startEngineSound();
  airplaneLoop();
  mainUIClock();
}

function createAirplane() {
  const g = new THREE.Group();
  const matRed = new THREE.MeshStandardMaterial({ color: 0xd84332, metalness: 0.3, roughness: 0.5 });
  const matWhite = new THREE.MeshStandardMaterial({ color: 0xf4f1e8, metalness: 0.2, roughness: 0.5 });
  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 4.6, 16), matRed);
  fuselage.rotation.x = Math.PI / 2; fuselage.castShadow = true; g.add(fuselage);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.36, 12, 8), matWhite);
  nose.position.z = -2.3; g.add(nose);
  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), new THREE.MeshStandardMaterial({ color: 0x224466, metalness: 0.8, roughness: 0.1 }));
  cockpit.position.set(0, 0.35, -0.8); cockpit.scale.set(1, 0.7, 1.6); g.add(cockpit);
  const wings = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.16, 1.7), matWhite);
  wings.position.set(0, 0.12, -0.15); wings.castShadow = true; g.add(wings);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.14, 1.05), matWhite);
  tail.position.set(0, 0.3, 2.1); tail.castShadow = true; g.add(tail);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 1.0), matRed);
  fin.position.set(0, 0.8, 2.1); g.add(fin);
  const prop = new THREE.Group();
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.4, 10), new THREE.MeshStandardMaterial({ color: 0x2f3640 }));
  hub.rotation.x = Math.PI / 2; prop.add(hub);
  [0, Math.PI / 2].forEach(a => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.24, 2.7, 0.1), new THREE.MeshStandardMaterial({ color: 0x22262b }));
    b.rotation.z = a; prop.add(b);
  });
  prop.position.z = -3.1; g.add(prop); g.userData.propeller = prop;
  // landing gear
  [[-0.9, -0.6], [0.9, -0.6], [0, 1.6]].forEach(([x, z]) => {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 6), new THREE.MeshStandardMaterial({ color: 0x333 }));
    strut.position.set(x, -0.7, z); g.add(strut);
    const w = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), new THREE.MeshStandardMaterial({ color: 0x111 }));
    w.position.set(x, -1.05, z); g.add(w);
  });
  return g;
}

function airplaneLoop() {
  requestAnimationFrame(airplaneLoop);
  if (!State.playerMesh || State.currentGame !== 'airplane') return;
  const dt = Math.min(State.clock.getDelta(), 0.05);
  const time = performance.now() / 1000;
  const plane = State.playerMesh, s = State.airplaneState;

  const turn = (State.keys['KeyA'] || State.keys['ArrowLeft'] ? 1 : 0) - (State.keys['KeyD'] || State.keys['ArrowRight'] ? 1 : 0);
  const pitchIn = (State.keys['KeyW'] || State.keys['ArrowUp'] ? 1 : 0) - (State.keys['KeyS'] || State.keys['ArrowDown'] ? 1 : 0);
  const acc = State.keys['Space'] ? 1 : 0;

  s.speed = clamp(s.speed + acc * 22 * dt - 3 * dt, 8, 70);
  s.yaw += turn * 1.2 * dt * clamp(s.speed / 30, 0.35, 1.2);
  s.pitch = clamp(s.pitch + pitchIn * 0.9 * dt, -1.2, 1.2);
  s.roll += (turn * 0.7 - s.roll) * Math.min(1, dt * 4);

  // stall physics: too slow -> sink
  const liftFactor = clamp((s.speed - 14) / 20, 0, 1);
  plane.rotation.set(-s.pitch, s.yaw, s.roll, 'YXZ');
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(plane.quaternion);
  plane.position.addScaledVector(fwd, s.speed * dt);
  plane.position.y += (-2.5 * (1 - liftFactor)) * dt;
  plane.position.y = clamp(plane.position.y, 1.2, 450);

  // ground crash
  if (plane.position.y <= 1.3 && s.speed > 30 && fwd.y < -0.15) {
    spawnParticles(plane.position.clone(), 0xff6600, 30, 8, 0.3, 1.2);
    noiseBurst(0.4, 0.3, 800);
    bigCenterText('💥 ЖЁСТКАЯ ПОСАДКА!', 'Скорость сброшена', '#ff4757', 1500);
    s.speed = 12;
    plane.position.y = 2;
  }

  if (plane.userData.propeller) plane.userData.propeller.rotation.z -= (10 + s.speed * 1.8) * dt;
  updateEngineSound(clamp(s.speed / 70, 0.05, 1));

  // rings
  State.rings?.forEach(r => {
    r.rotation.z += dt * 0.5;
    if (!r.userData.passed && r.position.distanceTo(plane.position) < 14) {
      r.userData.passed = true;
      r.material.color.setHex(0x2ed573);
      r.material.emissive.setHex(0x2ed573);
      State.ringsPassed++;
      playPickupSound();
      spawnParticles(r.position.clone(), 0x2ed573, 20, 6, 0.2, 0.8);
      bigCenterText(`🟢 КОЛЬЦО ${State.ringsPassed}/${State.rings.length}`, State.ringsPassed === State.rings.length ? 'КУРС ПРОЙДЕН! 🏆' : '', '#2ed573', 1200);
      if (State.ringsPassed === State.rings.length) {
        send({ type: 'chat', msg: `Я прошёл весь курс на самолёте! ✈️🏆 (${fmtTime(Date.now() - State.gameStartTime)})` });
      }
    }
  });

  // camera follow
  const camOff = new THREE.Vector3(0, 4.8, 14).applyQuaternion(plane.quaternion).add(plane.position);
  State.camera.position.lerp(camOff, Math.min(1, dt * 4));
  State.camera.up.set(0, 1, 0);
  State.camera.lookAt(plane.position.clone().add(new THREE.Vector3(0, 1, 0)));

  // HUD
  DOM.speedometer.style.display = 'flex';
  DOM['spd-num'].textContent = Math.round(s.speed * 3.6);
  DOM.altitude.style.display = 'block';
  DOM['alt-num'].textContent = Math.round(plane.position.y * 10) + ' м';
  DOM.timerInfo.style.display = 'block';
  DOM.timerInfo.textContent = `⏱️ ${fmtTime(Date.now() - State.gameStartTime)} · 💍 ${State.ringsPassed}/${State.rings?.length || 0}`;
  DOM.objective.textContent = '✈️ Пролетите сквозь все красные кольца!';

  updateParticles(dt);
  renderFrame();
}

// ===================== RACING GAME =====================
function initRacingGame() {
  initRenderer();
  State.scene = new THREE.Scene();
  createSky(0x3f8fd6, 0xcfe8ff);
  State.scene.fog = new THREE.Fog(0xa8d5f7, 150, 500);

  State.hemiLight = new THREE.HemisphereLight(0xffffff, 0x445533, 0.8);
  State.scene.add(State.hemiLight);
  const dir = new THREE.DirectionalLight(0xffffff, 1.6);
  dir.position.set(80, 120, 50);
  dir.castShadow = true;
  dir.shadow.mapSize.set(2048, 2048);
  dir.shadow.camera.left = -120; dir.shadow.camera.right = 120;
  dir.shadow.camera.top = 120; dir.shadow.camera.bottom = -120;
  State.scene.add(dir); State.sunLight = dir;

  // grass
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.MeshStandardMaterial({ color: 0x4c9a52 }));
  grass.rotation.x = -Math.PI / 2; grass.receiveShadow = true;
  State.scene.add(grass);

  // oval track built from segments
  State.trackCenter = [];
  const A = 90, B = 55;
  for (let i = 0; i < 120; i++) {
    const a = i / 120 * Math.PI * 2;
    State.trackCenter.push(new THREE.Vector2(Math.cos(a) * A, Math.sin(a) * B));
  }
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x3b3f46, roughness: 0.9 });
  for (let i = 0; i < 120; i++) {
    const p1 = State.trackCenter[i], p2 = State.trackCenter[(i + 1) % 120];
    const mid = new THREE.Vector2((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
    const len = p1.distanceTo(p2) + 1.2;
    const ang = Math.atan2(p2.x - p1.x, p2.y - p1.y);
    const seg = new THREE.Mesh(new THREE.PlaneGeometry(16, len), roadMat);
    seg.rotation.x = -Math.PI / 2; seg.rotation.z = -ang;
    seg.position.set(mid.x, 0.03, mid.y);
    seg.receiveShadow = true;
    State.scene.add(seg);
  }
  // curbs (red/white)
  for (let i = 0; i < 120; i += 2) {
    const p = State.trackCenter[i];
    const n = new THREE.Vector2(p.x / (A * A), p.y / (B * B)).normalize();
    [1, -1].forEach(side => {
      const curb = new THREE.Mesh(new THREE.BoxGeometry(2, 0.4, 4), new THREE.MeshStandardMaterial({ color: (i / 2) % 2 ? 0xff4757 : 0xffffff }));
      curb.position.set(p.x + n.x * 9 * side, 0.2, p.y + n.y * 9 * side);
      curb.rotation.y = Math.atan2(p.x, p.y);
      State.scene.add(curb);
    });
  }
  // start line
  const startLine = new THREE.Mesh(new THREE.PlaneGeometry(16, 2), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  startLine.rotation.x = -Math.PI / 2;
  startLine.position.set(A, 0.05, 0);
  State.scene.add(startLine);

  // checkpoints every quarter
  State.checkpoints = [0, 30, 60, 90].map(i => ({ idx: i, pos: State.trackCenter[i], passed: false }));

  // scenery trees around
  for (let i = 0; i < 40; i++) {
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 3, 6), new THREE.MeshStandardMaterial({ color: 0x8B4513 }));
    trunk.position.y = 1.5; tree.add(trunk);
    const lv = new THREE.Mesh(new THREE.IcosahedronGeometry(2.2, 1), new THREE.MeshStandardMaterial({ color: 0x27ae60, flatShading: true }));
    lv.position.y = 4; lv.castShadow = true; tree.add(lv);
    const ang = Math.random() * Math.PI * 2;
    const rr = 1.5 + Math.random() * 0.8;
    tree.position.set(Math.cos(ang) * A * rr, 0, Math.sin(ang) * B * rr);
    State.scene.add(tree);
  }

  const kart = createKart(0xe53935);
  kart.position.set(A, 0, 4);
  State.scene.add(kart);
  State.playerMesh = kart;
  State.racingState = { speed: 0, heading: Math.PI / 2, nitro: 100, boosting: false, lapProgress: 0, lastIdx: 0, wrongWayT: 0 };

  // AI karts
  State.aiKarts = [];
  const aiColors = [0x3742fa, 0x2ed573, 0xffcc00];
  aiColors.forEach((col, i) => {
    const k = createKart(col);
    State.scene.add(k);
    State.aiKarts.push({ mesh: k, t: i * 0.08, speed: 26 + i * 2.5 });
  });

  setupInput();
  buildComposer();
  racingLoop();
  mainUIClock();
}

function createKart(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 2.6), new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.4 }));
  body.position.y = 0.5; body.castShadow = true; g.add(body);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.25, 0.7), new THREE.MeshStandardMaterial({ color: 0xdddddd }));
  nose.position.set(0, 0.45, -1.5); g.add(nose);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: 0x222 }));
  seat.position.set(0, 0.85, 0.5); g.add(seat);
  // driver (roblox guy)
  const drv = new THREE.Group();
  const dt1 = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.6, 0.35), new THREE.MeshStandardMaterial({ color: 0x00d9ff }));
  dt1.position.y = 1.2; drv.add(dt1);
  const dh = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), new THREE.MeshStandardMaterial({ color: 0xffe066 }));
  dh.position.y = 1.75; drv.add(dh);
  drv.position.set(0, 0.1, 0.3); g.add(drv);
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.34, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x22252a });
  g.userData.wheels = [];
  [[0.9, 1.0], [-0.9, 1.0], [0.9, -1.0], [-0.9, -1.0]].forEach(([x, z]) => {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.position.set(x, 0.42, z); w.castShadow = true;
    g.add(w); g.userData.wheels.push(w);
  });
  // spoiler
  const sp = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.5), new THREE.MeshStandardMaterial({ color: 0x111 }));
  sp.position.set(0, 1.1, 1.3); g.add(sp);
  return g;
}

function nearestTrackIndex(pos) {
  let best = 0, bd = Infinity;
  State.trackCenter.forEach((p, i) => {
    const d = (p.x - pos.x) ** 2 + (p.y - pos.z) ** 2;
    if (d < bd) { bd = d; best = i; }
  });
  return { idx: best, dist: Math.sqrt(bd) };
}

function racingLoop() {
  requestAnimationFrame(racingLoop);
  if (!State.playerMesh || State.currentGame !== 'racing') return;
  const dt = Math.min(State.clock.getDelta(), 0.05);
  const kart = State.playerMesh, rs = State.racingState;

  const throttle = (State.keys['KeyW'] || State.keys['ArrowUp'] ? 1 : 0) - (State.keys['KeyS'] || State.keys['ArrowDown'] ? 1 : 0);
  const steer = (State.keys['KeyA'] || State.keys['ArrowLeft'] ? 1 : 0) - (State.keys['KeyD'] || State.keys['ArrowRight'] ? 1 : 0);
  const braking = State.keys['Space'];
  rs.boosting = (State.keys['ShiftLeft'] || State.keys['ShiftRight']) && rs.nitro > 0 && throttle > 0;

  const maxSpeed = rs.boosting ? 55 : 38;
  if (throttle > 0) rs.speed += (rs.boosting ? 30 : 18) * dt;
  else if (throttle < 0) rs.speed -= 16 * dt;
  else rs.speed *= Math.pow(0.5, dt);
  if (braking) rs.speed *= Math.pow(0.05, dt);
  rs.speed = clamp(rs.speed, -12, maxSpeed);
  if (rs.boosting) rs.nitro = Math.max(0, rs.nitro - 28 * dt);
  else rs.nitro = Math.min(100, rs.nitro + 6 * dt);

  rs.heading += steer * 2.2 * dt * clamp(Math.abs(rs.speed) / 15, 0, 1) * Math.sign(rs.speed || 1);
  const dir = new THREE.Vector3(-Math.sin(rs.heading), 0, -Math.cos(rs.heading));
  kart.position.addScaledVector(dir, rs.speed * dt);
  kart.rotation.y = rs.heading;
  kart.userData.wheels.forEach(w => w.rotation.x += rs.speed * dt * 2.5);
  // front wheels steer
  if (kart.userData.wheels[0]) { kart.userData.wheels[0].rotation.y = steer * 0.4; kart.userData.wheels[1].rotation.y = steer * 0.4; }

  // off-track slowdown + dust
  const nt = nearestTrackIndex(kart.position);
  if (nt.dist > 9) {
    rs.speed *= Math.pow(0.25, dt);
    if (Math.abs(rs.speed) > 5 && Math.random() < 0.3) spawnParticles(kart.position.clone().add(new THREE.Vector3(0, 0.3, 0)), 0x8a7a5e, 2, 2, 0.15, 0.5, -3);
  }
  // boost flame
  if (rs.boosting && Math.random() < 0.6) {
    const rear = kart.position.clone().addScaledVector(dir, -1.6).add(new THREE.Vector3(0, 0.5, 0));
    spawnParticles(rear, 0x66bbff, 2, 3, 0.15, 0.3, 1);
  }

  // lap logic via checkpoint progression
  const N = State.trackCenter.length;
  const cpIdx = Math.floor(nt.idx / 30) % 4;
  if (cpIdx !== rs.lastCP) {
    if (cpIdx === (rs.lastCP + 1) % 4) {
      rs.seenCP = (rs.seenCP | 0) | (1 << cpIdx);
      if (cpIdx === 0 && (rs.seenCP & 0b1111) === 0b1111) {
        State.raceLap++;
        rs.seenCP = 0;
        const lapMs = Date.now() - (State.lapStart || State.gameStartTime);
        if (!State.bestTime || lapMs < State.bestTime) { State.bestTime = lapMs; bigCenterText('🏁 НОВЫЙ РЕКОРД!', fmtTime(lapMs), '#ffcc00', 1800); playKillSound(); }
        else bigCenterText(`🏁 КРУГ ${State.raceLap}`, fmtTime(lapMs), '#00d9ff', 1400);
        State.lapStart = Date.now();
      }
    }
    rs.lastCP = cpIdx;
  }
  // wrong way detection
  const fwdDot = dir.dot(new THREE.Vector3(State.trackCenter[(nt.idx + 3) % N].x - State.trackCenter[nt.idx].x, 0, State.trackCenter[(nt.idx + 3) % N].y - State.trackCenter[nt.idx].y).normalize());
  if (fwdDot < -0.3 && Math.abs(rs.speed) > 5) {
    rs.wrongWayT += dt;
    if (rs.wrongWayT > 1) document.getElementById('wrong-way').style.display = 'block';
  } else { rs.wrongWayT = 0; document.getElementById('wrong-way').style.display = 'none'; }

  // AI karts
  State.aiKarts.forEach(ai => {
    ai.t = (ai.t + (ai.speed * dt) / (Math.PI * 145)) % 1;
    const ang = ai.t * Math.PI * 2;
    ai.mesh.position.set(Math.cos(ang) * 90, 0, Math.sin(ang) * 55);
    ai.mesh.rotation.y = Math.atan2(Math.sin(ang) * 55, Math.cos(ang) * 90) + Math.PI / 2;
    ai.mesh.userData.wheels.forEach(w => w.rotation.x += ai.speed * dt * 2);
  });

  // camera: chase with FOV kick
  const camPos = kart.position.clone().addScaledVector(dir, -9).add(new THREE.Vector3(0, 4.5, 0));
  State.camera.position.lerp(camPos, Math.min(1, dt * 6));
  State.camera.lookAt(kart.position.clone().add(new THREE.Vector3(0, 1.5, 0)).addScaledVector(dir, 4));
  const targetFov = 62 + clamp(Math.abs(rs.speed), 0, 55) * 0.45 + (rs.boosting ? 8 : 0);
  State.camera.fov = lerp(State.camera.fov, targetFov, dt * 4);
  State.camera.updateProjectionMatrix();

  // HUD
  DOM['spd-num'].textContent = Math.round(Math.abs(rs.speed) * 3.6);
  DOM['nitro-bar'].style.width = rs.nitro + '%';
  DOM.speedometer.style.display = 'flex';
  DOM.lapInfo.style.display = 'block';
  DOM.lapInfo.innerHTML = `🏁 Круг: <b>${State.raceLap}</b><br>⏱️ Лучший: ${State.bestTime ? fmtTime(State.bestTime) : '—'}<br>Текущий: ${fmtTime(Date.now() - (State.lapStart || State.gameStartTime))}`;

  updateParticles(dt);
  renderFrame();
}


// ===================== GLOBAL UI CLOCK =====================
function mainUIClock() {
  if (State.uiClockStarted) return;
  State.uiClockStarted = true;
  setInterval(() => {
    if (!State.currentGame) return;
    if (State.currentGame === 'brookhaven' || State.currentGame === 'cheese') {
      DOM.timerInfo.textContent = `⏱️ ${fmtTime(Date.now() - State.gameStartTime)}`;
    }
  }, 500);
}

// ===================== STUDIO =====================
function spawnCube() {
  if (!State.scene) { showToast('Откройте любую игру сначала!', '#ffa502'); return; }
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial({ color: Math.random() * 0xffffff, metalness: 0.2, roughness: 0.6 }));
  const p = State.playerMesh ? State.playerMesh.position : new THREE.Vector3();
  mesh.position.set(p.x + (Math.random() - 0.5) * 10, 5, p.z + (Math.random() - 0.5) * 10);
  mesh.castShadow = true;
  State.scene.add(mesh);
  State.studioObjects.push({ mesh, vy: 0, settled: false });
  DOM.objCount.textContent = State.studioObjects.length;
  playPickupSound();
}
function spawnSphere() {
  if (!State.scene) { showToast('Откройте любую игру сначала!', '#ffa502'); return; }
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1.5, 24, 24), new THREE.MeshStandardMaterial({ color: Math.random() * 0xffffff, metalness: 0.3, roughness: 0.4 }));
  const p = State.playerMesh ? State.playerMesh.position : new THREE.Vector3();
  mesh.position.set(p.x + (Math.random() - 0.5) * 10, 6, p.z + (Math.random() - 0.5) * 10);
  mesh.castShadow = true;
  State.scene.add(mesh);
  State.studioObjects.push({ mesh, vy: 0, settled: false });
  DOM.objCount.textContent = State.studioObjects.length;
  playPickupSound();
}
function changeColor() {
  State.studioObjects.forEach(o => o.mesh.material.color.setHex(Math.random() * 0xffffff));
}
function clearObjects() {
  State.studioObjects.forEach(o => { State.scene.remove(o.mesh); disposeObject(o.mesh); });
  State.studioObjects = [];
  DOM.objCount.textContent = '0';
}
function runCode() {
  try {
    const api = { spawnCube, spawnSphere, changeColor, clearObjects, scene: State.scene, player: State.playerMesh, THREE, toast: showToast };
    const fn = new Function('api', `"use strict";\n${document.getElementById('code-editor').value}`);
    fn(api);
    showToast('✅ Код выполнен!', '#2ed573');
  } catch (e) { showToast('❌ Ошибка: ' + e.message, '#ff4757'); }
}
function uploadModel() {
  const input = document.getElementById('model-upload');
  if (!input.files[0] || !State.scene) { showToast('❌ Выберите файл и откройте игру', '#ff4757'); return; }
  const loader = new GLTFLoader();
  const url = URL.createObjectURL(input.files[0]);
  loader.load(url, (gltf) => {
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    model.scale.setScalar(4 / maxDim);
    const p = State.playerMesh ? State.playerMesh.position : new THREE.Vector3();
    model.position.set(p.x, 0, p.z);
    model.traverse(o => { if (o.isMesh) o.castShadow = true; });
    State.scene.add(model);
    State.studioObjects.push({ mesh: model, vy: 0, settled: true });
    DOM.objCount.textContent = State.studioObjects.length;
    showToast('✅ Модель загружена!', '#2ed573');
    URL.revokeObjectURL(url);
  }, undefined, () => { showToast('❌ Ошибка загрузки модели', '#ff4757'); URL.revokeObjectURL(url); });
}

// ===================== PHYSICS FOR STUDIO OBJECTS =====================
function studioPhysics(dt) {
  State.studioObjects.forEach(o => {
    if (o.settled || !o.mesh || !State.scene) return;
    o.vy -= 20 * dt;
    o.mesh.position.y += o.vy * dt;
    o.mesh.rotation.x += dt;
    if (o.mesh.position.y <= 1) {
      o.mesh.position.y = 1;
      if (Math.abs(o.vy) > 2) { o.vy = -o.vy * 0.4; } else { o.vy = 0; o.settled = true; }
    }
  });
}

// ===================== EVENTS BIND =====================
function bindEvents() {
  DOM['btn-settings'].onclick = () => {
    DOM.settingsPanel.classList.toggle('active');
    DOM.studioPanel.classList.remove('active');
  };
  DOM['btn-studio'].onclick = () => {
    DOM.studioPanel.classList.toggle('active');
    DOM.settingsPanel.classList.remove('active');
  };
  DOM['btn-save-name'].onclick = saveName;
  DOM['btn-spawn-cube'].onclick = spawnCube;
  DOM['btn-spawn-sphere'].onclick = spawnSphere;
  DOM['btn-change-color'].onclick = changeColor;
  DOM['btn-clear-objects'].onclick = clearObjects;
  DOM['btn-run-code'].onclick = runCode;
  DOM['btn-upload-model'].onclick = uploadModel;
  DOM['exit-game'].onclick = exitGame;
  DOM.respawnBtn.onclick = () => { if (!DOM.respawnBtn.disabled) send({ type: 'respawn' }); };
  document.querySelectorAll('.game-card').forEach(card => {
    card.onclick = () => { if (card.dataset.game) startGame(card.dataset.game); };
  });
  document.addEventListener('keyup', e => { if (e.code === 'Tab') DOM.scoreboard.classList.remove('expanded'); });
}

function saveName() {
  const name = DOM.settingsName.value.trim();
  if (name.length >= 2 && name.length <= 16) {
    State.playerName = name;
    localStorage.setItem('r3d_name', name);
    DOM.settingsMsg.textContent = '✅ Имя сохранено!';
    DOM.settingsMsg.style.color = '#2ed573';
    if (State.playerMesh) send({ type: 'rename', name });
    setTimeout(() => DOM.settingsMsg.textContent = '', 2000);
  } else {
    DOM.settingsMsg.textContent = '❌ Имя должно быть от 2 до 16 символов';
    DOM.settingsMsg.style.color = '#ff6b6b';
    setTimeout(() => { DOM.settingsMsg.style.color = '#2ed573'; DOM.settingsMsg.textContent = ''; }, 2000);
  }
}

// ===================== RESIZE =====================
window.addEventListener('resize', () => {
  if (!State.camera || !State.renderer) return;
  State.camera.aspect = window.innerWidth / window.innerHeight;
  State.camera.updateProjectionMatrix();
  State.renderer.setSize(window.innerWidth, window.innerHeight);
  if (State.composer) State.composer.setSize(window.innerWidth, window.innerHeight);
  updateFxaa();
});

// studio physics inside loops: hook into particle update
// studio physics runs inside updateParticles

// ===================== INIT =====================
function init() {
  cacheDom();
  const saved = localStorage.getItem('r3d_name');
  if (saved) { State.playerName = saved; DOM.settingsName.value = saved; }
  bindEvents();
  // welcome toast
  setTimeout(() => showToast('👋 Выберите игру и нажмите на карточку!', '#00d9ff'), 600);
  console.log('✅ Roblox 3D Ultimate initialized');
}
init();
