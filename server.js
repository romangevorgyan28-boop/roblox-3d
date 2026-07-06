<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ===== ГЛОБАЛЬНОЕ СОСТОЯНИЕ =====
const isMobile = /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(navigator.userAgent) || window.innerWidth < 768;
const State = {
  ws: null,
  playerId: null,
  playerName: '',
  currentGame: null,
  scene: null,
  camera: null,
  renderer: null,
  playerMesh: null,
  gunMesh: null,
  otherPlayers: new Map(),
  joystick: { x: 0, y: 0, active: false },
  keys: { f: 0, r: 0, jump: false },
  isShooting: false,
  audioContext: null,
  sounds: {},
  textures: {},
  playerHealth: 100
};

// ===== DOM ЭЛЕМЕНТЫ =====
const DOM = {
  regModal: document.getElementById('reg-modal'),
  regInput: document.getElementById('reg-input'),
  regBtn: document.getElementById('reg-btn'),
  regError: document.getElementById('reg-error'),
  loadingScreen: document.getElementById('loading-screen'),
  loadText: document.getElementById('load-text'),
  mainMenu: document.getElementById('main-menu'),
  menuAvatar: document.getElementById('menu-avatar'),
  menuUsername: document.getElementById('menu-username'),
  gameUI: document.getElementById('game-ui'),
  canvas: document.getElementById('game-canvas'),
  chatMessages: document.getElementById('chat-messages'),
  chatInput: document.getElementById('chat-input'),
  joyZone: document.getElementById('joy-zone'),
  joyKnob: document.getElementById('joy-knob'),
  jumpBtn: document.getElementById('jump-btn'),
  shooterHud: document.getElementById('shooter-hud'),
  healthFill: document.getElementById('health-fill'),
  scoreBoard: document.getElementById('score-board')
};

// ===== ИНИЦИАЛИЗАЦИЯ РЕГИСТРАЦИИ =====
function initRegistration() {
  const savedName = localStorage.getItem('r3d_player_name');
  if (savedName && savedName.length >= 2 && savedName.length <= 16) {
    State.playerName = savedName;
    DOM.regModal.style.display = 'none';
    showMenu();
    return;
  }

  DOM.regInput.addEventListener('input', () => {
    const value = DOM.regInput.value.trim();
    const isValid = value.length >= 2 && value.length <= 16;
    
    if (isValid) {
      DOM.regError.textContent = '';
      DOM.regBtn.disabled = false;
    } else {
      DOM.regError.textContent = value.length === 0 ? '' : (value.length < 2 ? 'Минимум 2 символа' : 'Максимум 16 символов');
      DOM.regBtn.disabled = true;
    }
  });

  DOM.regInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !DOM.regBtn.disabled) {
      completeRegistration();
    }
  });

  DOM.regBtn.addEventListener('click', completeRegistration);
  DOM.regInput.focus();
}

function completeRegistration() {
  const name = DOM.regInput.value.trim();
  if (name.length < 2 || name.length > 16) return;
  
  State.playerName = name;
  localStorage.setItem('r3d_player_name', name);
  DOM.regModal.style.display = 'none';
  showMenu();
}

// ===== МЕНЮ =====
function showMenu() {
  DOM.mainMenu.style.display = 'flex';
  DOM.menuUsername.textContent = State.playerName;
  DOM.menuAvatar.textContent = State.playerName.charAt(0).toUpperCase();
  
  document.querySelectorAll('.game-card').forEach(card => {
    card.onclick = () => {
      const gameId = card.dataset.game;
      startGameSession(gameId);
    };
  });
}

// ===== НОВАЯ ФУНКЦИЯ ЗАПУСКА ИГРЫ =====
function startGameSession(gameId) {
  State.currentGame = gameId;
  DOM.mainMenu.style.display = 'none';
  DOM.loadingScreen.style.display = 'flex';
  DOM.loadText.textContent = 'Подключение к серверу...';
  connectToServer();
}

window.exitGame = function() {
  if (State.ws) State.ws.close();
  if (State.renderer) {
    State.renderer.dispose();
    State.renderer = null;
  }
  if (State.scene) {
    State.scene.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    });
    State.scene = null;
  }
  
  State.currentGame = null;
  State.otherPlayers.clear();
  State.playerMesh = null;
  State.gunMesh = null;
  
  DOM.gameUI.style.display = 'none';
  DOM.shooterHud.style.display = 'none';
  DOM.scoreBoard.style.display = 'none';
  DOM.chatMessages.innerHTML = '';
  DOM.loadingScreen.style.display = 'none';
  showMenu();
};

// ===== СЕТЬ =====
function connectToServer() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  State.ws = new WebSocket(`${protocol}//${location.host}`);
  
  State.ws.onopen = () => {
    State.ws.send(JSON.stringify({ type: 'register', name: State.playerName }));
  };
  
  State.ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      
      if (data.type === 'registered') {
        State.playerId = data.id;
        DOM.loadText.textContent = 'Загрузка ресурсов...';
        loadAssets().then(() => {
          DOM.loadingScreen.style.display = 'none';
          init3DScene(State.currentGame);
          State.ws.send(JSON.stringify({ type: 'join', gameId: State.currentGame }));
          startGameLoop();
        });
      }
      
      if (data.type === 'gameReady') {
        addChatMessage('sys', `Вы вошли в игру. Команда: ${data.team || 'Наблюдатель'}`);
        if (State.currentGame === 'shooter') {
          DOM.shooterHud.style.display = 'block';
          DOM.scoreBoard.style.display = 'block';
        }
      }
      
      if (data.type === 'snapshot') {
        if (data.health !== undefined) {
          State.playerHealth = data.health;
          if (State.currentGame === 'shooter') {
            DOM.healthFill.style.width = `${Math.max(0, data.health)}%`;
          }
        }
        if (data.scores) {
          DOM.scoreBoard.textContent = `🔴 ${data.scores.red} : ${data.scores.blue} 🔵`;
        }
        
        data.players.forEach(p => {
          if (!State.otherPlayers.has(p.id)) {
            spawnOtherPlayer(p);
          } else {
            const mesh = State.otherPlayers.get(p.id);
            mesh.position.set(p.x, p.y, p.z);
            mesh.rotation.y = -p.yaw;
          }
        });
      }
      
      if (data.type === 'chat') {
        addChatMessage(data.name, data.msg);
      }
      
      if (data.type === 'shoot') {
        playSound('shoot');
      }
      
      if (data.type === 'kill') {
        addChatMessage('sys', `💀 ${data.killer} убил ${data.victim}`);
      }
      
    } catch (e) {
      console.error('WebSocket message error:', e);
    }
  };
  
  State.ws.onclose = () => {
    addChatMessage('sys', '⚠️ Соединение разорвано. Переподключение...');
    setTimeout(() => {
      if (State.currentGame) {
        DOM.loadingScreen.style.display = 'flex';
        connectToServer();
      }
    }, 3000);
  };
}

// ===== РЕСУРСЫ =====
async function loadAssets() {
  const loader = new THREE.TextureLoader();
  
  State.textures.floor = await new Promise(resolve => {
    loader.load('floor.png', resolve, undefined, () => resolve(null));
  });
  State.textures.wall = await new Promise(resolve => {
    loader.load('wall.png', resolve, undefined, () => resolve(null));
  });
  
  State.gunModel = await new Promise(resolve => {
    new GLTFLoader().load('pistol.glb', gltf => resolve(gltf.scene), undefined, () => {
      const fallback = new THREE.Group();
      fallback.add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.35), new THREE.MeshStandardMaterial({ color: 0x222 })));
      fallback.add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.08), new THREE.MeshStandardMaterial({ color: 0x444 })).translateY(-0.12));
      resolve(fallback);
    });
  });
  
  State.audioContext = new (window.AudioContext || window.webkitAudioContext)();
  State.sounds.shoot = createFallbackSound(800, 0.1, 0.1);
  State.sounds.hit = createFallbackSound(200, 0.15, 0.15);
  State.sounds.reload = createFallbackSound(400, 0.1, 0.2);
  
  try {
    const audioShoot = new Audio('shoot.mp3'); audioShoot.volume = 0.3; State.sounds.shootFile = audioShoot;
    const audioHit = new Audio('hit.mp3'); audioHit.volume = 0.3; State.sounds.hitFile = audioHit;
    const audioReload = new Audio('reload.mp3'); audioReload.volume = 0.3; State.sounds.reloadFile = audioReload;
  } catch(e) {}
}

function createFallbackSound(freq, vol, dur) {
  return () => {
    if (!State.audioContext) return;
    const osc = State.audioContext.createOscillator();
    const gain = State.audioContext.createGain();
    osc.connect(gain);
    gain.connect(State.audioContext.destination);
    osc.frequency.value = freq;
    gain.gain.value = vol;
    osc.start();
    osc.stop(State.audioContext.currentTime + dur);
  };
}

function playSound(type) {
  if (State.audioContext?.state === 'suspended') State.audioContext.resume();
  const file = State.sounds[type + 'File'];
  if (file) {
    const clone = file.cloneNode();
    clone.play().catch(() => State.sounds[type]());
  } else {
    State.sounds[type]();
  }
}

// ===== 3D СЦЕНА =====
function init3DScene(gameId) {
  const cv = DOM.canvas;
  cv.width = window.innerWidth;
  cv.height = window.innerHeight;
  
  State.scene = new THREE.Scene();
  State.scene.background = new THREE.Color(gameId === 'shooter' ? 0x1a1a24 : 0x87CEEB);
  State.scene.fog = new THREE.Fog(State.scene.background, 20, 60);
  
  State.camera = new THREE.PerspectiveCamera(70, cv.width / cv.height, 0.1, 100);
  State.renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' });
  State.renderer.setSize(cv.width, cv.height);
  State.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  State.renderer.shadowMap.enabled = true;
  
  State.scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const sun = new THREE.DirectionalLight(0xffffff, 0.8);
  sun.position.set(15, 25, 15);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  State.scene.add(sun);
  
  const floorMat = new THREE.MeshStandardMaterial({ color: gameId === 'shooter' ? 0x333344 : 0x2a8a2a });
  if (State.textures.floor) {
    State.textures.floor.wrapS = State.textures.floor.wrapT = THREE.RepeatWrapping;
    State.textures.floor.repeat.set(10, 10);
    floorMat.map = State.textures.floor;
    floorMat.color.set(0xffffff);
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  State.scene.add(floor);
  
  if (gameId === 'shooter' && State.textures.wall) {
    State.textures.wall.wrapS = State.textures.wall.wrapT = THREE.RepeatWrapping;
    State.textures.wall.repeat.set(3, 1);
    const wMat = new THREE.MeshStandardMaterial({ map: State.textures.wall });
    const walls = [
      { x: -38, z: 0, w: 2, d: 78 },
      { x: 38, z: 0, w: 2, d: 78 },
      { x: 0, z: -38, w: 78, d: 2 },
      { x: 0, z: 38, w: 78, d: 2 }
    ];
    walls.forEach(w => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w.w, 7, w.d), wMat);
      m.position.set(w.x, 3.5, w.z);
      m.castShadow = true;
      State.scene.add(m);
    });
  }
  
  State.playerMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 1.8, 0.8),
    new THREE.MeshStandardMaterial({ color: 0xff3333 })
  );
  State.playerMesh.position.y = 1;
  State.playerMesh.castShadow = true;
  State.scene.add(State.playerMesh);
  
  State.gunMesh = State.gunModel.clone();
  State.gunMesh.position.set(0.35, -0.25, -0.5);
  State.gunMesh.rotation.y = Math.PI;
  State.camera.add(State.gunMesh);
  State.scene.add(State.camera);
  
  setupInputControls(gameId);
}

function spawnOtherPlayer(data) {
  const color = data.team === 'red' ? 0xff2222 : (data.team === 'blue' ? 0x2266ff : 0x888888);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 1.8, 0.8),
    new THREE.MeshStandardMaterial({ color })
  );
  mesh.position.set(data.x, data.y, data.z);
  mesh.rotation.y = -data.yaw;
  mesh.castShadow = true;
  State.scene.add(mesh);
  State.otherPlayers.set(data.id, mesh);
}

// ===== УПРАВЛЕНИЕ =====
function setupInputControls(gameId) {
  if (!isMobile) {
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyW') State.keys.f = -1;
      if (e.code === 'KeyS') State.keys.f = 1;
      if (e.code === 'KeyA') State.keys.r = -1;
      if (e.code === 'KeyD') State.keys.r = 1;
      if (e.code === 'Space') State.keys.jump = true;
      if (e.code === 'KeyE') State.isShooting = true;
      if (e.code === 'KeyR') { playSound('reload'); State.isShooting = false; }
    });
    
    document.addEventListener('keyup', (e) => {
      if (e.code === 'KeyW' || e.code === 'KeyS') State.keys.f = 0;
      if (e.code === 'KeyA' || e.code === 'KeyD') State.keys.r = 0;
      if (e.code === 'Space') State.keys.jump = false;
      if (e.code === 'KeyE') State.isShooting = false;
    });
    
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement) {
        State.camera.rotation.y -= e.movementX * 0.002;
        State.camera.rotation.x = Math.max(-1.2, Math.min(1.2, State.camera.rotation.x - e.movementY * 0.002));
      }
    });
    
    document.addEventListener('click', () => {
      if (!document.pointerLockElement && State.renderer?.domElement) {
        State.renderer.domElement.requestPointerLock();
      }
      if (gameId === 'shooter' && document.pointerLockElement) {
        State.isShooting = true;
      }
    });
  } else {
    let startX = 0, startY = 0;
    DOM.joyZone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      startX = t.clientX;
      startY = t.clientY;
      State.joystick.active = true;
    }, { passive: false });
    
    DOM.joyZone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (!State.joystick.active) return;
      const t = e.changedTouches[0];
      let dx = t.clientX - startX;
      let dy = t.clientY - startY;
      const dist = Math.min(35, Math.hypot(dx, dy));
      const angle = Math.atan2(dy, dx);
      DOM.joyKnob.style.transform = `translate(calc(-50% + ${Math.cos(angle) * dist}px), calc(-50% + ${Math.sin(angle) * dist}px))`;
      State.joystick.x = Math.cos(angle) * (dist / 35);
      State.joystick.y = Math.sin(angle) * (dist / 35);
    }, { passive: false });
    
    const resetJoystick = () => {
      State.joystick.active = false;
      State.joystick.x = 0;
      State.joystick.y = 0;
      DOM.joyKnob.style.transform = 'translate(-50%, -50%)';
    };
    DOM.joyZone.addEventListener('touchend', resetJoystick);
    DOM.joyZone.addEventListener('touchcancel', resetJoystick);
    
    DOM.jumpBtn.addEventListener('touchstart', (e) => { e.preventDefault(); State.keys.jump = true; }, { passive: false });
    DOM.jumpBtn.addEventListener('touchend', () => State.keys.jump = false);
  }
  
  DOM.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.value.trim() && State.ws?.readyState === 1) {
      State.ws.send(JSON.stringify({ type: 'chat', msg: e.target.value.trim() }));
      e.target.value = '';
    }
  });
}

// ===== ИГРОВОЙ ЦИКЛ =====
let lastTime = 0;
function startGameLoop() {
  requestAnimationFrame(gameLoop);
}

function gameLoop(timestamp) {
  if (!State.ws || State.ws.readyState !== 1 || !State.playerMesh) {
    requestAnimationFrame(gameLoop);
    return;
  }
  
  const dt = Math.min((timestamp - lastTime) / 1000, 0.1);
  lastTime = timestamp;
  
  const forward = isMobile ? State.joystick.y : State.keys.f;
  const right = isMobile ? State.joystick.x : State.keys.r;
  const speed = 0.18;
  
  const yaw = State.camera.rotation.y;
  State.playerMesh.position.x += (forward * Math.sin(yaw + Math.PI) + right * Math.cos(yaw)) * speed;
  State.playerMesh.position.z += (forward * Math.cos(yaw + Math.PI) - right * Math.sin(yaw)) * speed;
  
  if (State.keys.jump && State.playerMesh.position.y <= 1.1) {
    State.playerMesh.position.y = 3.2;
    State.keys.jump = false;
  }
  if (State.playerMesh.position.y > 1) {
    State.playerMesh.position.y -= 0.22;
  }
  if (State.playerMesh.position.y < 1) {
    State.playerMesh.position.y = 1;
  }
  
  State.playerMesh.rotation.y = yaw + Math.PI;
  
  if (State.isShooting && State.currentGame === 'shooter') {
    State.ws.send(JSON.stringify({ type: 'action' }));
    playSound('shoot');
    State.isShooting = false;
  }
  
  State.ws.send(JSON.stringify({
    type: 'input',
    f: forward,
    r: right,
    jump: State.keys.jump,
    yaw: yaw
  }));
  State.keys.jump = false;
  
  const camDist = isMobile ? 4 : 6;
  const camHeight = isMobile ? 2.5 : 4;
  State.camera.position.set(
    State.playerMesh.position.x + Math.sin(yaw) * camDist,
    State.playerMesh.position.y + camHeight,
    State.playerMesh.position.z + Math.cos(yaw) * camDist
  );
  State.camera.lookAt(State.playerMesh.position.x, State.playerMesh.position.y + 1.5, State.playerMesh.position.z);
  
  if (State.gunMesh) {
    State.gunMesh.position.y = -0.25 + Math.sin(timestamp * 0.005) * 0.008;
    State.gunMesh.rotation.x = State.isShooting ? -0.25 : 0;
  }
  
  State.renderer.render(State.scene, State.camera);
  requestAnimationFrame(gameLoop);
}

// ===== УТИЛИТЫ =====
function addChatMessage(name, message) {
  const div = document.createElement('div');
  div.className = 'msg';
  if (name === 'sys') {
    div.classList.add('sys');
    div.textContent = message;
  } else {
    div.innerHTML = `<span class="n">${name}:</span> ${message}`;
  }
  DOM.chatMessages.appendChild(div);
  DOM.chatMessages.scrollTop = DOM.chatMessages.scrollHeight;
  
  if (DOM.chatMessages.children.length > 50) {
    DOM.chatMessages.removeChild(DOM.chatMessages.firstChild);
  }
}

// ===== ЗАПУСК =====
window.addEventListener('resize', () => {
  if (State.camera && State.renderer) {
    const cv = DOM.canvas;
    cv.width = window.innerWidth;
    cv.height = window.innerHeight;
    State.camera.aspect = window.innerWidth / window.innerHeight;
    State.camera.updateProjectionMatrix();
    State.renderer.setSize(window.innerWidth, window.innerHeight);
  }
});

initRegistration();
</script>
