/* ============ Gravação das viagens e reprodução ============ */
// Além do resumo (trips.js), cada viagem grava as leituras ao longo do tempo: o que o app estava
// lendo, a posição do GPS (se ligado) e os eventos (aceleração, frenagem e curva fortes).
// Formato "longo" [tempo, chave, valor]: cada carro informa sensores diferentes, então não há colunas fixas.
// Fica no IndexedDB deste aparelho, em pedaços de alguns segundos (append-only). Não entra no backup
// (é grande) e é apagado junto com "Apagar dados deste aparelho": o trajeto do GPS é dado pessoal.
const REC_DB = 'elm327-rec', REC_KEEP = 30;
const REC_EXTRA = ['p11', 'atrv'];   // além do que a viagem já lê: borboleta e bateria, úteis para rever
const REC_GAP = { fast: 100, calc: 500, same: 2000 };   // ms entre amostras da mesma chave

/* ---- Banco ---- */
let recDb = null;
function recOpen(){
  if (!recDb){
    recDb = new Promise((res, rej) => {
      const r = indexedDB.open(REC_DB, 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('trips', { keyPath: 'id' });
        r.result.createObjectStore('chunks', { keyPath: ['trip', 'seq'] });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    recDb.catch(() => { recDb = null; });
  }
  return recDb;
}
// Uma transação; fn monta os pedidos e pode devolver um deles para ler o resultado
async function recTx(stores, mode, fn){
  const db = await recOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(stores, mode);
    const req = fn(tx);
    tx.oncomplete = () => res(req?.result);
    tx.onerror = tx.onabort = () => rej(tx.error);
  });
}
const chunkRange = id => IDBKeyRange.bound([id, 0], [id, Infinity]);
const recMetas = () => recTx(['trips'], 'readonly', tx => tx.objectStore('trips').getAll());
function recDelete(id){
  recIds.delete(id);
  return recTx(['trips', 'chunks'], 'readwrite', tx => { tx.objectStore('trips').delete(id); tx.objectStore('chunks').delete(chunkRange(id)); })
    .catch(e => log('⚠ Apagar gravação: ' + e.message));
}
function recClear(){
  recIds.clear();
  return recTx(['trips', 'chunks'], 'readwrite', tx => { tx.objectStore('trips').clear(); tx.objectStore('chunks').clear(); })
    .catch(() => {});
}
// Fica com as gravações das últimas REC_KEEP viagens do histórico; o resto (e viagem curta demais) sai
async function recPrune(){
  const keep = new Set(cfg.runs.slice(-REC_KEEP).map(r => r.t0));
  for (const m of await recMetas()) if (!keep.has(m.id) && m.id !== tripRec.id) await recDelete(m.id);
}

/* ---- Gravador ---- */
const recIds = new Set();   // viagens que têm gravação (para o botão "Rever" aparecer na lista)
const recHas = id => recIds.has(id);
const tripRec = { id: null, meta: null, seq: 0, buf: [], last: new Map(), n: 0, keys: new Set(), timer: null };

function recStart({ t0, car, sim }){
  if (!('indexedDB' in window) || tripRec.id != null) return;
  Object.assign(tripRec, { id: t0, seq: 0, buf: [], n: 0, meta: { id: t0, t0, t1: t0, car, sim, n: 0, keys: [] } });
  tripRec.last.clear(); tripRec.keys.clear();
  need('gravacao', REC_EXTRA);
  tripRec.timer = setInterval(recFlush, 5000);
  // Pede ao navegador para não apagar os dados quando faltar espaço (o Chrome decide sem perguntar)
  navigator.storage?.persist?.().catch(() => {});
}
function recPush(t, k, v){ if (tripRec.id != null) tripRec.buf.push([t, k, v]); }
engineOn('value', (k, v, t) => {
  if (tripRec.id == null || !sensorDef(k)) return;
  const l = tripRec.last.get(k), gap = k.startsWith('c:') ? REC_GAP.calc : REC_GAP.fast;
  if (l && (t - l.t < gap || (v === l.v && t - l.t < REC_GAP.same))) return;
  tripRec.last.set(k, { t, v });
  recPush(t, k, v);
});
addEventListener('gpsfix', e => {
  const p = e.detail, l = tripRec.last.get('g:pos'), t = Date.now();
  if (l && t - l.t < 1000) return;
  tripRec.last.set('g:pos', { t });
  recPush(t, 'g:pos', [+p.lat.toFixed(6), +p.lon.toFixed(6), Math.round(p.acc)]);
});
addEventListener('drive', e => recPush(e.detail.t, 'e:' + e.detail.k, e.detail.v));

async function recFlush(){
  if (tripRec.id == null || !tripRec.buf.length) return;
  // Copia tudo antes de esperar o banco: a viagem pode terminar enquanto grava
  const id = tripRec.id, seq = tripRec.seq++, s = tripRec.buf;
  tripRec.buf = []; tripRec.n += s.length;
  for (const x of s) tripRec.keys.add(x[1]);
  const meta = { ...tripRec.meta, t1: s[s.length - 1][0], n: tripRec.n, keys: [...tripRec.keys] };
  tripRec.meta = meta;
  try {
    await recTx(['trips', 'chunks'], 'readwrite', tx => { tx.objectStore('chunks').put({ trip: id, seq, s }); tx.objectStore('trips').put(meta); });
    recIds.add(id);
  } catch (e) { log('⚠ Gravação da viagem: ' + e.message); }
}
async function recStop({ t0, kept }){
  if (tripRec.id !== t0) return;
  clearInterval(tripRec.timer); release('gravacao');
  await recFlush();
  tripRec.id = null;
  if (!kept) await recDelete(t0);
  await recPrune().catch(() => {});
  renderRuns();
}
addEventListener('runstart', e => recStart(e.detail));
addEventListener('runend', e => recStop(e.detail));

// Ao abrir: limpa sobras (viagens curtas, app fechado no meio) e descobre quais viagens têm gravação
(async () => {
  if (!('indexedDB' in window)) return;
  try {
    await recPrune();
    for (const m of await recMetas()) recIds.add(m.id);
    renderRuns();
  } catch (e) { log('⚠ Gravações de viagem indisponíveis: ' + e.message); }
})();

/* ---- Reprodução ---- */
// A gravação vira uma "fonte" com a mesma cara do store (get e since), com o tempo parado no momento
// escolhido. Assim os mostradores do painel (gaugeState + renderGauge) desenham a viagem sem código novo.
const rp = { id: null, meta: null, run: null, series: new Map(), gps: [], events: [], at: 0, playing: false, speed: 16, wall: 0, drawT: 0, page: 0 };
const lowerB = (a, x) => { let lo = 0, hi = a.length; while (lo < hi){ const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; } return lo; };
const upperB = (a, x) => { let lo = 0, hi = a.length; while (lo < hi){ const m = (lo + hi) >> 1; if (a[m] <= x) lo = m + 1; else hi = m; } return lo; };
const rpSrc = {
  get(k){ const s = rp.series.get(k); if (!s) return null; const i = upperB(s.t, rp.at) - 1; return i < 0 ? null : { v: s.v[i], t: s.t[i] }; },
  // Só números no histórico, como no store
  since(k, ms, now){
    const s = rp.series.get(k); if (!s) return { t: [], v: [] };
    const a = lowerB(s.nt, now - ms), b = upperB(s.nt, now);
    return { t: s.nt.slice(a, b), v: s.nv.slice(a, b) };
  }
};
async function recLoad(id){
  const [meta, chunks] = await recTx(['trips', 'chunks'], 'readonly', tx => {
    const m = tx.objectStore('trips').get(id), c = tx.objectStore('chunks').getAll(chunkRange(id));
    return { get result(){ return [m.result, c.result]; } };
  });
  if (!meta) return null;
  const series = new Map(), gps = [], events = [];
  for (const ch of chunks) for (const [t, k, v] of ch.s){
    if (k === 'g:pos'){ gps.push({ t, lat: v[0], lon: v[1], acc: v[2] }); continue; }
    if (k.startsWith('e:')){ events.push({ t, k: k.slice(2), v }); continue; }
    let s = series.get(k);
    if (!s){ s = { t: [], v: [], nt: [], nv: [] }; series.set(k, s); }
    if (s.t.length && t < s.t[s.t.length - 1]) continue;   // relógio voltou: ignora para manter a ordem
    s.t.push(t); s.v.push(v);
    if (typeof v === 'number'){ s.nt.push(t); s.nv.push(v); }
  }
  return { meta, series, gps, events };
}

async function replayOpen(id){
  rpPause();
  go('replay');
  $('rpHead').textContent = 'Carregando a gravação…';
  $('rpBody').hidden = true;
  let r = null;
  try { r = await recLoad(id); } catch (e) { log('⚠ ' + e.message); }
  if (!r || !r.series.size){ rp.id = null; $('rpHead').textContent = 'Esta viagem não tem leituras gravadas.'; return; }
  Object.assign(rp, { id, meta: r.meta, series: r.series, gps: r.gps, events: r.events, at: r.meta.t0, run: cfg.runs.find(x => x.t0 === id) || null });
  rp.page = Math.min(rp.page, cfg.pages.length - 1);
  const run = rp.run, dur = (rp.meta.t1 - rp.meta.t0) / 1000;
  $('rpHead').textContent = new Date(rp.meta.t0).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) + ' · ' + mins(dur) +
    (run ? ' · ' + run.km.toFixed(1) + ' km' : '') + ' · ' + profName(rp.meta.car) + (rp.meta.sim ? ' · simulação' : '') +
    ' · ' + rp.meta.n.toLocaleString('pt-BR') + ' leituras';
  $('rpPage').innerHTML = cfg.pages.map((p, i) => '<option value="' + i + '"' + (i === rp.page ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('');
  $('rpBody').hidden = false;
  rpGrid(); rpEvents();
  $('rpMapBox').hidden = rp.gps.filter(p => p.acc <= GPS_ACC).length < 2;
  requestAnimationFrame(() => { rpSize(); rpDraw(true); });
}
const rpPageW = () => (cfg.pages[rp.page] || cfg.pages[0]).w;
function rpGrid(){
  $('rpGrid').innerHTML = rpPageW().map(w => '<div class="wg" data-id="' + esc(w.id) + '"><canvas></canvas></div>').join('') ||
    '<p class="empty">Esta página do painel não tem mostradores.</p>';
  // A gravação só tem o que o app estava lendo: no modo simples, o painel completo não estava aberto
  const miss = rpPageW().filter(w => !rp.series.has(w.k)).map(w => sensorDef(w.k)?.name || w.k);
  $('rpMiss').textContent = miss.length ? 'Sem dados nesta viagem: ' + miss.join(', ') + '. A gravação guarda só o que o app estava lendo (o painel completo lê mais sensores que o modo simples).' : '';
  layoutGrid($('rpGrid'), rpPageW(), false, () => rpDraw(true));
}
function rpSize(){
  const dpr = devicePixelRatio || 1;
  for (const id of ['rpLine', 'rpMap']){ const cv = $(id); if (cv.clientWidth){ cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr; } }
}

/* ---- Desenho ---- */
const fmtClock = s => { s = Math.max(0, Math.round(s)); const h = s / 3600 | 0, m = (s % 3600) / 60 | 0, x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
const EV_INFO = { acc: ['▲', 'Aceleração forte', 'm/s²', C.warn], brk: ['▼', 'Frenagem forte', 'm/s²', C.bad], crv: ['◆', 'Curva forte', 'g', '#b48cf2'] };
function rpDraw(force){
  if (!rp.id || !tabOpen('replay')) return;
  const now = performance.now();
  if (!force && now - rp.drawT < 60) return;
  rp.drawT = now;
  const span = rp.meta.t1 - rp.meta.t0;
  $('rpPos').value = span > 0 ? Math.round((rp.at - rp.meta.t0) / span * 1000) : 0;
  $('rpTime').textContent = fmtClock((rp.at - rp.meta.t0) / 1000) + ' / ' + fmtClock(span / 1000) + ' · ' + new Date(rp.at).toLocaleTimeString();
  document.querySelectorAll('#rpGrid .wg[data-id]').forEach(el => {
    const w = rpPageW().find(x => x.id === el.dataset.id); if (!w) return;
    const s = gaugeState(w, rp.at, rpSrc);
    el.classList.toggle('alerting', !!s.alert);
    try { renderGauge(el.querySelector('canvas'), s); } catch (e) { console.error(e); }
  });
  rpLine();
  if (!$('rpMapBox').hidden) rpMap();
}
// Linha do tempo da viagem inteira: velocidade, giro (mais apagado), eventos e o cursor
function rpLine(){
  const cv = $('rpLine'), g = cv.getContext('2d'), W = cv.width, H = cv.height, dpr = devicePixelRatio || 1;
  if (!W) return;
  g.clearRect(0, 0, W, H);
  const t0 = rp.meta.t0, span = (rp.meta.t1 - t0) || 1, pt = 14 * dpr, pb = 6 * dpr, h = H - pt - pb;
  const x = t => (t - t0) / span * W;
  const line = (k, max, color, alpha) => {
    const s = rp.series.get(k); if (!s || s.nt.length < 2) return false;
    g.beginPath(); let started = false, lastT = 0;
    for (let i = 0; i < s.nt.length; i++){
      const px = x(s.nt[i]), py = pt + h - Math.min(1, s.nv[i] / max) * h;
      // Buraco de mais de 15 s sem leitura: não liga os pontos
      if (!started || s.nt[i] - lastT > 15000){ g.moveTo(px, py); started = true; } else g.lineTo(px, py);
      lastT = s.nt[i];
    }
    g.strokeStyle = color; g.globalAlpha = alpha; g.lineWidth = 1.5 * dpr; g.stroke(); g.globalAlpha = 1;
    return true;
  };
  g.fillStyle = 'rgba(255,255,255,.03)'; g.fillRect(0, pt, W, h);
  line('p0C', 7000, C.muted, 0.45);
  const spdKey = rp.series.get('p0D')?.nt.length ? 'p0D' : 'c:gspd';
  const vmax = (rp.series.get(spdKey)?.nv || []).reduce((a, b) => Math.max(a, b), 60);
  line(spdKey, vmax * 1.1, '#5aa9e6', 1);
  g.font = 600 + ' ' + 10 * dpr + 'px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'top';
  for (const e of rp.events){ const i = EV_INFO[e.k]; if (!i) continue; g.fillStyle = i[3]; g.fillText(i[0], x(e.t), 0); }
  g.fillStyle = C.muted; g.textAlign = 'left'; g.textBaseline = 'bottom'; g.fillText('máx. ' + Math.round(vmax) + ' km/h', 4 * dpr, H - 2 * dpr);
  const cx = x(rp.at);
  g.fillStyle = '#ffb000'; g.fillRect(cx - 1 * dpr, pt, 2 * dpr, h);
}
// Trajeto do GPS sem mapa de fundo (o app não baixa nada de fora): colorido pela velocidade
function rpMap(){
  const cv = $('rpMap'), g = cv.getContext('2d'), W = cv.width, H = cv.height, dpr = devicePixelRatio || 1;
  if (!W) return;
  g.clearRect(0, 0, W, H);
  const pts = rp.gps.filter(p => p.acc <= GPS_ACC);
  let la0 = Infinity, la1 = -Infinity, lo0 = Infinity, lo1 = -Infinity;
  for (const p of pts){ la0 = Math.min(la0, p.lat); la1 = Math.max(la1, p.lat); lo0 = Math.min(lo0, p.lon); lo1 = Math.max(lo1, p.lon); }
  const k = Math.cos((la0 + la1) / 2 * Math.PI / 180), pad = 14 * dpr;
  const sx = (lo1 - lo0) * k || 1e-6, sy = (la1 - la0) || 1e-6, sc = Math.min((W - 2 * pad) / sx, (H - 2 * pad) / sy);
  const ox = (W - sx * sc) / 2, oy = (H - sy * sc) / 2;
  const P = p => [ox + (p.lon - lo0) * k * sc, H - oy - (p.lat - la0) * sc];
  const spd = rp.series.get('p0D') || rp.series.get('c:gspd');
  const spdAt = t => { if (!spd) return null; const i = upperB(spd.nt, t) - 1; return i < 0 ? null : spd.nv[i]; };
  g.lineWidth = 4 * dpr; g.lineCap = 'round';
  for (let i = 1; i < pts.length; i++){
    if (pts[i].t - pts[i - 1].t > 30000) continue;
    const v = spdAt(pts[i].t);
    g.strokeStyle = v == null ? C.muted : 'hsl(' + Math.round(200 - Math.min(1, v / 120) * 200) + ',80%,55%)';
    const [x0, y0] = P(pts[i - 1]), [x1, y1] = P(pts[i]);
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  }
  // Onde o carro estava no momento escolhido
  const i = Math.max(0, upperB(pts.map(p => p.t), rp.at) - 1), [cx, cy] = P(pts[i]);
  g.beginPath(); g.arc(cx, cy, 7 * dpr, 0, Math.PI * 2); g.fillStyle = '#ffb000'; g.fill();
  g.lineWidth = 2 * dpr; g.strokeStyle = '#1b1300'; g.stroke();
  const [sx0, sy0] = P(pts[0]); g.fillStyle = C.ok; g.beginPath(); g.arc(sx0, sy0, 4 * dpr, 0, Math.PI * 2); g.fill();
}
function rpEvents(){
  const evs = rp.events.filter(e => EV_INFO[e.k]);
  $('rpEvents').innerHTML = evs.length ? evs.map(e => { const [ic, name, unit] = EV_INFO[e.k];
    return '<button class="rpev" data-t="' + e.t + '"><b>' + ic + '</b> ' + fmtClock((e.t - rp.meta.t0) / 1000) + ' · ' + name +
      (typeof e.v === 'number' ? ' (' + String(Math.abs(e.v)).replace('.', ',') + ' ' + unit + ')' : '') + '</button>'; }).join('')
    : '<p class="small muted">Nenhuma aceleração, frenagem ou curva forte nesta viagem.</p>';
}

/* ---- Tocar ---- */
function rpSeek(t){ rp.at = Math.max(rp.meta.t0, Math.min(rp.meta.t1, t)); rpDraw(true); }
function rpPlay(){
  if (!rp.id) return;
  if (rp.at >= rp.meta.t1) rp.at = rp.meta.t0;
  rp.playing = true; rp.wall = performance.now(); $('rpPlay').textContent = '⏸';
  requestAnimationFrame(rpTick);
}
function rpPause(){ rp.playing = false; $('rpPlay').textContent = '▶'; }
function rpTick(ts){
  if (!rp.playing) return;
  if (!tabOpen('replay')){ rpPause(); return; }
  rp.at += (ts - rp.wall) * rp.speed; rp.wall = ts;
  if (rp.at >= rp.meta.t1){ rp.at = rp.meta.t1; rpPause(); rpDraw(true); return; }
  rpDraw(false);
  requestAnimationFrame(rpTick);
}

/* ---- Exportar ---- */
function rpCsv(){
  const rows = [];
  const dec = v => typeof v === 'number' ? String(v).replace('.', ',') : v == null ? '' : String(v);
  const q = v => /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  const hora = t => { const d = new Date(t); return d.toLocaleTimeString('pt-BR') + ',' + String(d.getMilliseconds()).padStart(3, '0'); };
  for (const [k, s] of rp.series){ const d = sensorDef(k), name = d ? d.name + (d.unit ? ' (' + d.unit + ')' : '') : k;
    for (let i = 0; i < s.t.length; i++) rows.push([s.t[i], name, dec(s.v[i])]); }
  for (const p of rp.gps) rows.push([p.t, 'GPS (lat, lon, precisão m)', p.lat + ', ' + p.lon + ', ' + p.acc]);
  for (const e of rp.events) rows.push([e.t, EV_INFO[e.k]?.[1] || e.k, dec(e.v)]);
  rows.sort((a, b) => a[0] - b[0]);
  const body = rows.map(r => [hora(r[0]), q(r[1]), q(r[2])].join(';'));
  download('viagem-' + new Date(rp.meta.t0).toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.csv', '﻿' + ['Hora;Sensor;Valor', ...body].join('\n'), 'text/csv');
}

/* ---- Tela ---- */
$('rpPlay').onclick = () => rp.playing ? rpPause() : rpPlay();
$('rpPos').oninput = e => { if (rp.id) rpSeek(rp.meta.t0 + (rp.meta.t1 - rp.meta.t0) * e.target.value / 1000); };
$('rpSpeed').onchange = e => { rp.speed = +e.target.value; };
$('rpPage').onchange = e => { rp.page = +e.target.value; rpGrid(); };
$('rpEvents').onclick = e => { const b = e.target.closest('[data-t]'); if (b) rpSeek(+b.dataset.t - 5000); };
$('rpLine').addEventListener('pointerdown', e => {
  if (!rp.id) return;
  const cv = $('rpLine'), seek = ev => { const r = cv.getBoundingClientRect(); rpSeek(rp.meta.t0 + (rp.meta.t1 - rp.meta.t0) * (ev.clientX - r.left) / r.width); };
  seek(e); cv.setPointerCapture(e.pointerId);
  cv.onpointermove = ev => { if (ev.buttons) seek(ev); };
});
$('rpCsv').onclick = () => rp.id && rpCsv();
$('rpDel').onclick = async () => {
  if (!rp.id || !confirm('Apagar a gravação desta viagem? O resumo continua no histórico.')) return;
  await recDelete(rp.id); rp.id = null; renderRuns(); go('viagens');
};
new ResizeObserver(() => { if (rp.id && tabOpen('replay')){ rpSize(); layoutGrid($('rpGrid'), rpPageW(), false, () => rpDraw(true)); } }).observe($('rpBody'));
addEventListener('tab', e => {
  if (e.detail !== 'replay'){ rpPause(); return; }
  if (!rp.id){ $('rpHead').textContent = 'Escolha uma viagem em Viagens e toque em “▶ Rever esta viagem”.'; $('rpBody').hidden = true; }
  else requestAnimationFrame(() => { rpSize(); rpDraw(true); });
});
