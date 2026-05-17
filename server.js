// ... (начало файла index.html без изменений) ...

// Добавь эти переменные в объект S
S.deadPlayers = []; // Массив для хранения развалившихся игроков

// ... (код функции connect без изменений) ...

// В функции spawnRemote добавь проверку на смерть
function spawnRemote(d){
  if(d.id===S.id)return;
  if(d.isDead) {
    // Если игрок умер - создаем обломки
    createDeathEffect(d.x, d.y, d.z);
    return;
  }
  const r=createRig(d.gameId==='shooter'?(d.team==='red'?0xff2a2a:0x2a8aff):0x3366cc);
  r.group.position.set(d.x,d.y,d.z);r.group.rotation.y=-d.yaw;
  S.scene.add(r.group);S.players.set(d.id,{mesh:r,tx:d.x,ty:d.y,tz:d.z,tryaw:d.yaw,name:d.name,animState:0, isDead: false});
  const tag=document.createElement('div');tag.className='name-tag';tag.textContent=d.name;
  document.getElementById('name-tags').appendChild(tag);S.players.get(d.id).tag=tag;
}

// Функция создания эффекта смерти (разлет на кубики)
function createDeathEffect(x, y, z) {
  const colors = [0xff3333, 0x3366cc, 0xffcc88, 0x333366];
  const debris = [];
  const count = 15;
  
  for(let i=0; i<count; i++) {
    const size = 0.2 + Math.random() * 0.3;
    const geo = new THREE.BoxGeometry(size, size, size);
    const mat = new THREE.MeshStandardMaterial({ color: colors[Math.floor(Math.random()*colors.length)] });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x + (Math.random()-0.5)*1.5, y + Math.random()*2, z + (Math.random()-0.5)*1.5);
    mesh.castShadow = true;
    
    // Скорость разлета
    const vel = new THREE.Vector3(
      (Math.random()-0.5) * 5,
      Math.random() * 5 + 2,
      (Math.random()-0.5) * 5
    );
    
    S.scene.add(mesh);
    debris.push({ mesh, vel, rotVel: new THREE.Vector3(Math.random()*10, Math.random()*10, Math.random()*10) });
  }
  
  S.deadPlayers.push({ debris, timer: 5.0 });
}
// Обновляем функцию loop
function loop(t){
  if(!S.ws||S.ws.readyState!==1)return;requestAnimationFrame(loop);
  const dt=Math.min((t-lt)/1000,0.1);lt=t;
  
  // Обновление мертвых игроков (физика обломков)
  for(let i = S.deadPlayers.length - 1; i >= 0; i--) {
    const dead = S.deadPlayers[i];
    dead.timer -= dt;
    dead.debris.forEach(d => {
      d.vel.y -= 15 * dt; // Гравитация для обломков
      d.mesh.position.add(d.vel.clone().multiplyScalar(dt));
      d.mesh.rotation.x += d.rotVel.x * dt;
      d.mesh.rotation.y += d.rotVel.y * dt;
      d.mesh.rotation.z += d.rotVel.z * dt;
      
      if(d.mesh.position.y < -2) { // Упало слишком низко
        S.scene.remove(d.mesh);
        dead.debris = dead.debris.filter(x => x !== d);
      }
    });
    if(dead.timer <= 0 || dead.debris.length === 0) {
      dead.debris.forEach(d => S.scene.remove(d.mesh));
      S.deadPlayers.splice(i, 1);
    }
  }

  if(S.localPlayer && !S.localPlayer.userData.isDead){
    const sp=0.18;const fwd=new THREE.Vector3(-Math.sin(S.yaw),0,-Math.cos(S.yaw));const rgt=new THREE.Vector3(Math.cos(S.yaw),0,-Math.sin(S.yaw));
    let mv=new THREE.Vector3();if(S.inp.f<0)mv.add(fwd);if(S.inp.f>0)mv.sub(fwd);if(S.inp.r<0)mv.sub(rgt);if(S.inp.r>0)mv.add(rgt);
    if(mv.length()>0){mv.normalize();const nx=S.localPlayer.group.position.x+mv.x*sp,nz=S.localPlayer.group.position.z+mv.z*sp;let col=false;const pr=0.35;for(const w of S.walls){if(nx>w.x-w.w/2-pr&&nx<w.x+w.w/2+pr&&nz>w.z-w.d/2-pr&&nz<w.z+w.d/2+pr){col=true;break;}}if(!col){S.localPlayer.group.position.x=nx;S.localPlayer.group.position.z=nz;}S.localPlayer.group.rotation.y=S.yaw+Math.PI;}
    if(S.inp.jump&&S.localPlayer.group.position.y<=1.01){S.localPlayer.group.position.y=3.5;S.inp.jump=false;}
    if(S.localPlayer.group.position.y>1)S.localPlayer.group.position.y-=0.22;if(S.localPlayer.group.position.y<1)S.localPlayer.group.position.y=1;
    const mvng=Math.abs(S.inp.f)>0.1||Math.abs(S.inp.r)>0.1;const spd=mvng?4.5:0;const amp=mvng?0.7:0;const tm=t*0.012;
    S.localPlayer.lL.rotation.x=Math.sin(tm*spd)*amp;S.localPlayer.rL.rotation.x=-Math.sin(tm*spd)*amp;S.localPlayer.lA.rotation.x=-Math.sin(tm*spd)*amp;S.localPlayer.rA.rotation.x=Math.sin(tm*spd)*amp;
    S.ws.send(JSON.stringify({playerId:S.id,type:'input',f:S.inp.f,r:S.inp.r,jump:S.inp.jump,action:S.inp.action,yaw:S.yaw}));S.inp.action=false;
    const cd=isMobile?5.5:9.0,ch=isMobile?3.5:5.5;
    S.cam.position.set(S.localPlayer.group.position.x+Math.sin(S.yaw)*cd,S.localPlayer.group.position.y+ch+Math.sin(S.pitch)*1.5,S.localPlayer.group.position.z+Math.cos(S.yaw)*cd);
    S.cam.lookAt(S.localPlayer.group.position.x,S.localPlayer.group.position.y+1.5,S.localPlayer.group.position.z);
    S.players.forEach(p=>{
      if(p.tag){const pos=p.mesh.group.position.clone();pos.y+=3.5;pos.project(S.cam);if(pos.z<1){p.tag.style.display='block';p.tag.style.left=(pos.x*0.5+0.5)*innerWidth+'px';p.tag.style.top=(-pos.y*0.5+0.5)*innerHeight+'px';}else p.tag.style.display='none';}
      const om=p.animState===1;const os=om?4.5:0;const oa=om?0.7:0;p.mesh.lL.rotation.x=Math.sin(t*0.012*os)*oa;p.mesh.rL.rotation.x=-Math.sin(t*0.012*os)*oa;p.mesh.lA.rotation.x=-Math.sin(t*0.012*os)*oa;p.mesh.rA.rotation.x=Math.sin(t*0.012*os)*oa;
    });
    S.cheeses.forEach(c=>{c.rotation.y+=0.015;c.position.y=Math.sin(Date.now()*0.002)*0.05;});
  }
  S.ren.render(S.scene,S.cam);
}

// В функции connect добавь обработку смерти
// ... внутри S.ws.onmessage ...      if(d.type==='playerDied'){
        addChat('sys', `💀 ${d.name} погиб!`);
        if(d.playerId === S.id) {
          S.localPlayer.userData.isDead = true;
          S.scene.remove(S.localPlayer.group); // Скрываем модель
          // Показываем кнопку "Возродиться"
          if(!document.getElementById('respawn-btn')) {
            const btn = document.createElement('button');
            btn.id = 'respawn-btn';
            btn.textContent = '💀 Вы погибли! Возродиться';
            btn.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);padding:15px 30px;font-size:20px;background:#ff2a2a;color:#fff;border:none;border-radius:10px;cursor:pointer;z-index:100;';
            btn.onclick = () => {
              S.ws.send(JSON.stringify({ playerId: S.id, type: 'respawn' }));
              S.localPlayer.userData.isDead = false;
              btn.remove();
              // Снова показываем модель
              S.localPlayer.group.position.set(0,1,0); // Временно
              S.scene.add(S.localPlayer.group);
            };
            document.body.appendChild(btn);
          }
        } else {
          // Если умер другой - создаем обломки
          if(S.players.has(d.playerId)) {
             const p = S.players.get(d.playerId);
             createDeathEffect(d.x, d.y, d.z);
             S.scene.remove(p.mesh.group);
             if(p.tag) p.tag.remove();
             S.players.delete(d.playerId);
          }
        }
      }
// ...
