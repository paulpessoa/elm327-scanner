/* ============ Fora do app: tela ligada, janela flutuante, tela bloqueada ============ */
// O navegador não deixa uma página desenhar por cima da tela bloqueada. Os caminhos que existem:
//  · Janela flutuante (picture-in-picture): um vídeo gerado de um canvas, que fica sobre outros apps.
//  · Controle de mídia: um áudio silencioso faz o Android mostrar o "player" na tela bloqueada,
//    e o título, o artista e a capa desse player são os valores dos sensores.
//  · Notificação fixa, atualizada a cada poucos segundos (aparece na tela bloqueada).
//  · Manter a tela ligada (Wake Lock), o mais confiável para usar como painel no carro.
const SHORT = { p05:'Motor', p0C:'RPM', p0D:'Velocidade', atrv:'Bateria', p42:'ECU', 'c:avg':'Média', 'c:kml':'Consumo', 'c:lph':'L/h',
  'c:km':'Viagem', 'c:fuel':'Gasto', 'c:cost':'Custo', p2F:'Tanque', p0F:'Admissão', p14:'Sonda pré', p15:'Sonda pós', p0B:'MAP', p04:'Carga', p5C:'Óleo' };
const out = { wake: false, pip: false, lock: false, notif: false };
let wakeLock = null, pipVideo = null, pipCv = null, pipT = null, lockAudio = null, lockT = null, lockArt = null, notifT = null;

function outsideItems(){
  return cfg.outside.keys.map(k => {
    const d = sensorDef(k); if (!d) return null;
    const v = fresh(k, 15000);
    return { k, name: SHORT[k] || d.name.split(' ')[0], v: fmtV(v, d.d), unit: d.unit, alert: alertActive(k) };
  }).filter(Boolean);
}
const itemTxt = i => i.name + ' ' + i.v + (i.unit && i.v !== '--' ? (i.unit.length > 2 ? ' ' : '') + i.unit : '');
function outsideNeed(){
  if (out.pip || out.lock || out.notif) need('fora', cfg.outside.keys); else release('fora');
  updOutBtns();
}
function updOutBtns(){
  const set = (id, on, a, b) => { const el = $(id); if (!el) return; el.textContent = on ? a : b; el.classList.toggle('on', on); el.setAttribute('aria-pressed', on); };
  set('btnWake', out.wake, '☀ Tela ligada: sim', '☀ Manter tela ligada');
  set('btnPip', out.pip, '◳ Fechar janela', '◳ Janela flutuante');
  set('btnLock', out.lock, '🔒 Tela bloqueada: sim', '🔒 Tela bloqueada');
  set('btnNotif', out.notif, '🔔 Notificação: sim', '🔔 Notificação fixa');
}

/* ---- Mini painel num canvas (janela flutuante e capa do player) ---- */
function drawMini(cv, square){
  const g = cv.getContext('2d'), W = cv.width, H = cv.height, items = outsideItems();
  g.fillStyle = '#0f151c'; g.fillRect(0, 0, W, H);
  const head = H * (square ? .1 : .14);
  g.fillStyle = '#1b2430'; g.fillRect(0, 0, W, head);
  g.fillStyle = C.muted; g.font = 600 + ' ' + head * .5 + 'px ' + FONT; g.textBaseline = 'middle'; g.textAlign = 'left';
  g.fillText('ELM327 · ' + new Date().toLocaleTimeString().slice(0, 5), W * .03, head / 2);
  g.textAlign = 'right'; g.fillStyle = link ? C.ok : C.bad; g.fillText(link ? '● ao vivo' : '● desconectado', W * .97, head / 2);
  const n = Math.max(1, items.length), cols = n === 1 ? 1 : 2, rows = Math.ceil(n / cols);
  const cw = W / cols, ch = (H - head) / rows;
  items.forEach((it, i) => {
    const x = (i % cols) * cw, y = head + Math.floor(i / cols) * ch;
    g.strokeStyle = '#34465a'; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, cw - 2, ch - 2);
    g.fillStyle = C.muted; g.textAlign = 'center'; g.textBaseline = 'top'; g.font = 600 + ' ' + ch * .15 + 'px ' + FONT;
    g.fillText(it.name, x + cw / 2, y + ch * .08);
    g.fillStyle = it.alert ? C.bad : '#ffb000'; g.textBaseline = 'middle';
    fitText(g, it.v, cw * .9, ch * .42);
    g.fillText(it.v, x + cw / 2, y + ch * .55);
    g.fillStyle = C.muted; g.font = 500 + ' ' + ch * .12 + 'px ' + FONT; g.textBaseline = 'bottom';
    g.fillText(it.unit, x + cw / 2, y + ch * .96);
  });
  if (!items.length){ g.fillStyle = C.muted; g.textAlign = 'center'; g.font = 500 + ' ' + H * .07 + 'px ' + FONT; g.fillText('Escolha os sensores em Ajustes', W / 2, H / 2); }
}

/* ---- Manter a tela ligada ---- */
async function setWake(on){
  out.wake = on;
  if (on){
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (e) { out.wake = false; alert('Não foi possível manter a tela ligada: ' + (navigator.wakeLock ? e.message : 'navegador sem suporte.')); }
  } else { await wakeLock?.release().catch(() => {}); wakeLock = null; }
  updOutBtns();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && out.wake && !wakeLock) setWake(true); });

/* ---- Janela flutuante ---- */
async function setPip(on){
  if (!on){ if (document.pictureInPictureElement) await document.exitPictureInPicture().catch(() => {}); stopPip(); return; }
  if (!document.pictureInPictureEnabled || !HTMLCanvasElement.prototype.captureStream){
    alert('Este navegador não tem janela flutuante (picture-in-picture). No Android, use o Chrome atualizado.'); return;
  }
  try {
    pipCv = pipCv || Object.assign(document.createElement('canvas'), { width: 480, height: 300 });
    drawMini(pipCv, false);
    if (!pipVideo){
      pipVideo = document.createElement('video');
      pipVideo.muted = true; pipVideo.playsInline = true; pipVideo.className = 'offscreen';
      document.body.append(pipVideo);
      pipVideo.addEventListener('leavepictureinpicture', stopPip);
    }
    pipVideo.srcObject = pipCv.captureStream(4);
    await pipVideo.play();
    await pipVideo.requestPictureInPicture();
    out.pip = true; clearInterval(pipT);
    pipT = setInterval(() => drawMini(pipCv, false), 500);
    outsideNeed();
  } catch (e) { alert('Não consegui abrir a janela flutuante: ' + e.message); stopPip(); }
}
function stopPip(){ out.pip = false; clearInterval(pipT); outsideNeed(); }

/* ---- Tela bloqueada (controle de mídia) ---- */
// WAV de 10 s com ruído de amplitude ±2 em 16 bits (≈ −84 dB): inaudível, mas o sistema o trata como áudio tocando
function quietWav(sec = 10, rate = 8000){
  const n = sec * rate, buf = new ArrayBuffer(44 + n * 2), d = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => d.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); d.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); d.setUint32(16, 16, true);
  d.setUint16(20, 1, true); d.setUint16(22, 1, true); d.setUint32(24, rate, true); d.setUint32(28, rate * 2, true);
  d.setUint16(32, 2, true); d.setUint16(34, 16, true); w(36, 'data'); d.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) d.setInt16(44 + i * 2, (Math.random() * 5 | 0) - 2, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}
async function setLock(on){
  if (!on){ stopLock(); return; }
  if (!('mediaSession' in navigator)){ alert('Este navegador não mostra controles de mídia na tela bloqueada.'); return; }
  try {
    if (!lockAudio){ lockAudio = new Audio(quietWav()); lockAudio.loop = true; }
    await lockAudio.play();
    const ms = navigator.mediaSession;
    ms.setActionHandler('pause', stopLock);
    ms.setActionHandler('stop', stopLock);
    ms.setActionHandler('play', () => lockAudio.play());
    out.lock = true; updateLock(); clearInterval(lockT); lockT = setInterval(updateLock, 2000);
    outsideNeed();
  } catch (e) { alert('Não consegui ativar: ' + e.message); stopLock(); }
}
function stopLock(){
  out.lock = false; clearInterval(lockT); lockAudio?.pause();
  if ('mediaSession' in navigator){ navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'; }
  outsideNeed();
}
const artCv = Object.assign(document.createElement('canvas'), { width: 512, height: 512 });
function updateLock(){
  if (!out.lock) return;
  const it = outsideItems();
  drawMini(artCv, true);
  artCv.toBlob(b => {
    if (!b || !out.lock) return;
    const url = URL.createObjectURL(b);
    navigator.mediaSession.metadata = new MediaMetadata({
      title: it.slice(0, 2).map(itemTxt).join(' · ') || 'ELM327 Scanner',
      artist: it.slice(2).map(itemTxt).join(' · ') || (link ? 'ao vivo' : 'desconectado'),
      album: 'ELM327 Scanner · ' + new Date().toLocaleTimeString().slice(0, 5),
      artwork: [{ src: url, sizes: '512x512', type: 'image/png' }]
    });
    navigator.mediaSession.playbackState = 'playing';
    if (lockArt) setTimeout(URL.revokeObjectURL, 5000, lockArt);
    lockArt = url;
  });
}

/* ---- Notificação fixa ---- */
async function setNotif(on){
  if (!on){ stopNotif(); return; }
  if (!('Notification' in window)){ alert('Este navegador não tem notificações.'); return; }
  if (Notification.permission === 'default') await Notification.requestPermission();
  if (Notification.permission !== 'granted'){ alert('As notificações estão bloqueadas. Libere nas configurações do site.'); return; }
  out.notif = true; outsideNeed(); pushNotif(); clearInterval(notifT); notifT = setInterval(pushNotif, 5000);
}
function pushNotif(){
  const it = outsideItems();
  notify('ELM327 · ' + (link ? 'ao vivo' : 'desconectado'), it.map(itemTxt).join('  ·  ') || 'sem sensores escolhidos', 'status', false);
}
async function stopNotif(){
  out.notif = false; clearInterval(notifT); outsideNeed();
  try { const reg = await navigator.serviceWorker?.getRegistration(); (await reg?.getNotifications({ tag: 'status' }))?.forEach(n => n.close()); } catch {}
}

$('btnWake').onclick = () => setWake(!out.wake);
$('btnPip').onclick = () => setPip(!out.pip);
$('btnLock').onclick = () => setLock(!out.lock);
$('btnNotif').onclick = () => setNotif(!out.notif);
addEventListener('connected', outsideNeed);

function bindOutsideSettings(){
  const opts = sel => '<option value="">—</option>' + sensorList().map(d => '<option value="' + d.key + '"' + (d.key === sel ? ' selected' : '') + '>' + esc(d.name + (d.unit ? ' (' + d.unit + ')' : '')) + '</option>').join('');
  for (let i = 0; i < 4; i++){
    const el = $('out' + i);
    el.innerHTML = opts(cfg.outside.keys[i] || '');
    el.onchange = () => {
      cfg.outside.keys = [0, 1, 2, 3].map(j => $('out' + j).value).filter(k => KEY_RE.test(k));
      saveCfg(); outsideNeed(); if (out.lock) updateLock();
    };
  }
  updOutBtns();
}
