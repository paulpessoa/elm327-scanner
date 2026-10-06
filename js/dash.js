/* ============ Painel personalizável ============ */
let dashOn = false, editMode = false;
const anim = new Map();      // id do mostrador → valor animado (ponteiro e barras deslizam até o valor novo)
const drawnAt = new Map();
const page = () => cfg.pages[cfg.page] || cfg.pages[0];

function defaultType(k){
  const d = sensorDef(k);
  if (!d) return 'digital';
  if (d.text) return 'digital';
  if (k === 'p0C') return 'dial';
  if (['p0D', 'p05', 'p0F', 'p5C', 'p46'].includes(k)) return 'arc';
  if (d.pid >= 0x14 && d.pid <= 0x3B && d.unit !== '°C') return 'graph';
  if (d.unit === '%' && d.r[0] < 0) return 'hbar';
  return 'digital';
}
function newWidget(k){
  const type = defaultType(k);
  return cleanWidget({ k, type, w: type === 'graph' || type === 'hbar' ? 2 : 1, h: type === 'hbar' ? 1 : 2, win: type === 'graph' ? 30 : 60 });
}
function dashAddSensor(k){
  const w = newWidget(k); if (!w) return;
  page().w.push(w); saveCfg(); renderDash();
}

/* ---- Estrutura da tela ---- */
function renderPages(){
  $('pages').innerHTML = cfg.pages.map((p, i) =>
    '<button class="chip" role="tab" aria-selected="' + (i === cfg.page) + '" data-pg="' + i + '">' + esc(p.name) + '</button>').join('') +
    (editMode ? '<button class="chip add" data-pg="new" aria-label="Nova página">＋ página</button>' : '');
  $('pageEdit').hidden = !editMode;
}
$('pages').onclick = e => {
  const b = e.target.closest('[data-pg]'); if (!b) return;
  if (b.dataset.pg === 'new'){
    if (cfg.pages.length >= 12) return;
    cfg.pages.push({ name: 'Painel ' + (cfg.pages.length + 1), w: [] }); cfg.page = cfg.pages.length - 1;
  } else cfg.page = +b.dataset.pg;
  saveCfg(); renderDash(); dashNeed();
};
$('btnPgRename').onclick = () => {
  const n = prompt('Nome da página:', page().name);
  if (n != null && n.trim()){ page().name = str(n.trim(), 30); saveCfg(); renderPages(); }
};
$('btnPgDel').onclick = () => {
  if (cfg.pages.length < 2){ alert('É preciso ter pelo menos uma página.'); return; }
  if (!confirm('Apagar a página “' + page().name + '” e seus mostradores?')) return;
  cfg.pages.splice(cfg.page, 1); cfg.page = Math.max(0, cfg.page - 1); saveCfg(); renderDash(); dashNeed();
};

function renderDash(){
  renderPages();
  const ws = page().w;
  $('grid').innerHTML = ws.map(w => {
    const d = sensorDef(w.k);
    return '<div class="wg" data-id="' + esc(w.id) + '" role="img" aria-label="' + esc(w.title || d?.name || w.k) + '" tabindex="0">' +
      '<canvas></canvas>' +
      (editMode ? '<div class="wtools"><button data-act="left" aria-label="Mover para trás">◀</button><button data-act="cfg" aria-label="Configurar">⚙</button>' +
        '<button data-act="right" aria-label="Mover para frente">▶</button><button data-act="del" aria-label="Remover">✕</button></div>' : '') + '</div>';
  }).join('') + (editMode || !ws.length ? '<button class="wg wadd" data-act="add">＋ Adicionar mostrador</button>' : '');
  $('btnEdit').textContent = editMode ? '✓ Concluir' : '✎ Editar';
  layoutDash();
}

function layoutDash(){
  const grid = $('grid'), W = grid.clientWidth; if (!W) return;
  const fs = document.fullscreenElement === $('dashWrap');
  const cols = W < 520 ? 2 : W < 860 ? 3 : (fs && W > 1300 ? 6 : 4);
  const gap = 8, cell = (W - gap * (cols - 1)) / cols;
  let row = cell * 0.5;
  // Em tela cheia deitada, encolhe as linhas para caber tudo sem rolar
  if (fs){
    const rows = packRows(page().w, cols), maxH = grid.clientHeight || innerHeight - 60;
    if (rows) row = Math.min(row, (maxH - gap * (rows - 1)) / rows);
  }
  grid.style.setProperty('--cols', cols); grid.style.setProperty('--row', Math.max(40, row) + 'px');
  grid.querySelectorAll('.wg[data-id]').forEach(el => {
    const w = page().w.find(x => x.id === el.dataset.id); if (!w) return;
    el.style.gridColumn = 'span ' + Math.min(w.w, cols); el.style.gridRow = 'span ' + w.h;
  });
  requestAnimationFrame(() => {
    const dpr = devicePixelRatio || 1;
    grid.querySelectorAll('.wg[data-id] canvas').forEach(cv => {
      cv.width = Math.round(cv.clientWidth * dpr); cv.height = Math.round(cv.clientHeight * dpr);
    });
    drawnAt.clear(); kickDraw();
  });
}
// Quantas linhas a grade vai ocupar (simulação simples do auto-placement em fluxo)
function packRows(ws, cols){
  let r = 0, c = 0, rowH = 0, total = 0;
  for (const w of ws){
    const span = Math.min(w.w, cols);
    if (c + span > cols){ total += rowH; c = 0; rowH = 0; }
    c += span; rowH = Math.max(rowH, w.h);
  }
  return total + rowH;
}
new ResizeObserver(() => layoutDash()).observe($('grid'));

/* ---- Desenho contínuo ---- */
let rafOn = false, lastFrame = 0;
function kickDraw(){ if (!rafOn){ rafOn = true; lastFrame = performance.now(); requestAnimationFrame(frame); } }
function frame(ts){
  const visible = (tabOpen('painel') || document.fullscreenElement === $('dashWrap')) && !document.hidden;
  if (!visible){ rafOn = false; return; }
  const dt = Math.min(0.1, (ts - lastFrame) / 1000); lastFrame = ts;
  const now = Date.now();
  let moving = false;
  document.querySelectorAll('#grid .wg[data-id]').forEach(el => {
    const w = page().w.find(x => x.id === el.dataset.id); if (!w) return;
    const s = gaugeState(w, now);
    if (typeof s.v === 'number'){
      const a0 = anim.get(w.id);
      const a = a0 == null || !isFinite(a0) ? s.v : a0 + (s.v - a0) * Math.min(1, dt * 9);
      anim.set(w.id, a); s.a = a;
      if (Math.abs(a - s.v) > (s.hi - s.lo) * 0.0015) moving = true;
    } else anim.delete(w.id);
    el.classList.toggle('alerting', !!s.alert);
    const stale = now - (drawnAt.get(w.id) || 0) > (w.type === 'graph' || w.hist ? 200 : 500);
    if (moving || stale){
      try { renderGauge(el.querySelector('canvas'), s); } catch (e) { console.error(e); }
      drawnAt.set(w.id, now);
    }
  });
  requestAnimationFrame(frame);
}
function gaugeState(w, now = Date.now()){
  const d = sensorDef(w.k) || { name: w.k, unit: '', r: [0, 100], d: 1, ok: null };
  const al = cfg.alerts[w.k], e = store.get(w.k);
  const v = e && now - e.t < 15000 ? e.v : null;
  let lo = w.lo ?? d.r[0], hi = w.hi ?? d.r[1];
  if (!(hi > lo)){ lo = d.r[0]; hi = d.r[1]; }
  const dec = w.dec ?? d.d;
  const needHist = w.type === 'graph' || w.hist || w.peak || w.stats;
  const hist = needHist ? store.since(w.k, w.win * 1000, now) : null;
  let max = null, st = null;
  if (hist?.v.length){
    let mn = Infinity, mx = -Infinity, sum = 0;
    for (const x of hist.v){ if (x < mn) mn = x; if (x > mx) mx = x; sum += x; }
    max = mx; st = { min: mn, max: mx, avg: sum / hist.v.length };
  }
  return {
    type: d.text ? 'digital' : w.type, title: w.title || d.name, unit: d.unit, lo, hi, dec, v, a: v,
    color: ACCENTS[w.color], zones: { ok: d.ok, min: al?.on ? al.min : null, max: al?.on ? al.max : null },
    alert: alertActive(w.k), peak: w.peak, max, hist, showHist: w.hist, stats: w.stats, st, win: w.win, auto: w.auto
  };
}
engineOn('value', () => kickDraw());
addEventListener('tab', e => { if (e.detail === 'painel'){ layoutDash(); kickDraw(); } });
document.addEventListener('visibilitychange', () => { if (!document.hidden) kickDraw(); });

/* ---- Interação com os mostradores ---- */
let pressT = null;
$('grid').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const el = b.closest('.wg'), ws = page().w, i = ws.findIndex(x => x.id === el?.dataset.id);
  switch (b.dataset.act){
    case 'add': openWidgetDlg(null); break;
    case 'cfg': openWidgetDlg(ws[i]); break;
    case 'del': if (confirm('Remover este mostrador?')){ ws.splice(i, 1); saveCfg(); renderDash(); dashNeed(); } break;
    case 'left': if (i > 0){ [ws[i - 1], ws[i]] = [ws[i], ws[i - 1]]; saveCfg(); renderDash(); } break;
    case 'right': if (i < ws.length - 1){ [ws[i + 1], ws[i]] = [ws[i], ws[i + 1]]; saveCfg(); renderDash(); } break;
  }
});
// Toque longo (ou duplo clique) abre a configuração, como nos apps de painel de carro
$('grid').addEventListener('pointerdown', e => {
  const el = e.target.closest('.wg[data-id]'); if (!el || e.target.closest('button')) return;
  clearTimeout(pressT);
  pressT = setTimeout(() => { navigator.vibrate?.(15); openWidgetDlg(page().w.find(x => x.id === el.dataset.id)); }, 550);
});
['pointerup', 'pointerleave', 'pointercancel', 'pointermove'].forEach(ev => $('grid').addEventListener(ev, e => {
  if (ev === 'pointermove' && Math.abs(e.movementX) + Math.abs(e.movementY) < 4) return;
  clearTimeout(pressT);
}));
$('grid').addEventListener('dblclick', e => { const el = e.target.closest('.wg[data-id]'); if (el) openWidgetDlg(page().w.find(x => x.id === el.dataset.id)); });
$('grid').addEventListener('keydown', e => { if (e.key === 'Enter'){ const el = e.target.closest('.wg[data-id]'); if (el) openWidgetDlg(page().w.find(x => x.id === el.dataset.id)); } });
$('grid').addEventListener('contextmenu', e => { if (e.target.closest('.wg[data-id]')) e.preventDefault(); });

$('btnEdit').onclick = () => { editMode = !editMode; renderDash(); };

/* ---- Leitura ---- */
function dashKeys(){
  const ks = new Set(page().w.map(w => w.k));
  for (const [k, a] of Object.entries(cfg.alerts)) if (a.on) ks.add(k);
  return [...ks].filter(k => sensorDef(k));
}
function dashNeed(){ if (dashOn) need('painel', dashKeys()); }
function setDash(on){
  dashOn = on && !!link;
  $('btnDash').textContent = dashOn ? '■ Parar leitura' : '▶ Ler painel';
  $('btnDash').classList.toggle('primary', !dashOn);
  if (dashOn) dashNeed(); else release('painel');
}
$('btnDash').onclick = () => setDash(!dashOn);
addEventListener('connected', () => setDash(true));
addEventListener('disconnected', () => setDash(false));
engineOn('status', s => $('dashInfo').textContent = s);
setInterval(() => {
  if (!dashOn || !link) return;
  $('dashInfo').textContent = engine.rate ? engine.rate.toFixed(1) + ' leituras/s' + (engine.multi ? ' · vários PIDs por pedido' : '') : 'Lendo…';
}, 1500);

/* ---- Tela cheia ---- */
$('btnFull').onclick = async () => {
  if (document.fullscreenElement){ document.exitFullscreen(); return; }
  try {
    await $('dashWrap').requestFullscreen({ navigationUI: 'hide' });
    screen.orientation?.lock?.('landscape').catch(() => {});
  } catch (e) { alert('Este navegador não permitiu tela cheia.'); }
};
document.addEventListener('fullscreenchange', () => {
  $('btnFull').textContent = document.fullscreenElement ? '✕ Sair da tela cheia' : '⛶ Tela cheia';
  setTimeout(layoutDash, 120); kickDraw();
});

/* ---- Diálogo de configuração ---- */
let dlgW = null, dlgNew = false;
function sensorOptions(sel){
  const all = sensorList();
  const grp = (label, list) => list.length ? '<optgroup label="' + esc(label) + '">' + list.map(d =>
    '<option value="' + d.key + '"' + (d.key === sel ? ' selected' : '') + '>' + esc(d.name + (d.unit ? ' (' + d.unit + ')' : '')) + '</option>').join('') + '</optgroup>' : '';
  const calc = all.filter(d => d.calc || d.key === 'atrv');
  const pids = all.filter(d => d.pid != null);
  const known = !!state.pids?.size;
  return grp('Calculados e bateria', calc) +
    (known ? grp('Este carro fornece', pids.filter(d => supported(d.key))) + grp('O carro não informa (ficará vazio)', pids.filter(d => !supported(d.key)))
      : grp('Sensores OBD-II (conecte para saber quais o carro tem)', pids));
}
function openWidgetDlg(w){
  dlgNew = !w;
  dlgW = w ? { ...w } : newWidget(page().w.length ? 'p05' : 'p0C');
  $('wSensor').innerHTML = sensorOptions(dlgW.k);
  $('wDel').hidden = dlgNew;
  $('wdlgTitle').textContent = dlgNew ? 'Novo mostrador' : 'Configurar mostrador';
  fillDlg();
  $('wdlg').showModal();
  drawPreview();
}
function fillDlg(){
  const d = sensorDef(dlgW.k), al = cfg.alerts[dlgW.k];
  $('wSensor').value = dlgW.k;
  document.querySelectorAll('#wType button').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.t === dlgW.type);
    b.disabled = !!d?.text && b.dataset.t !== 'digital';
  });
  $('wTitle').value = dlgW.title; $('wTitle').placeholder = d?.name || '';
  $('wLo').value = dlgW.lo ?? ''; $('wLo').placeholder = d?.r[0] ?? '';
  $('wHi').value = dlgW.hi ?? ''; $('wHi').placeholder = d?.r[1] ?? '';
  $('wDec').value = dlgW.dec == null ? '' : String(dlgW.dec);
  $('wW').value = String(dlgW.w); $('wH').value = String(dlgW.h);
  $('wHist').checked = dlgW.hist; $('wWin').value = String(dlgW.win);
  $('wAuto').checked = dlgW.auto; $('wPeak').checked = dlgW.peak; $('wStats').checked = dlgW.stats;
  document.querySelectorAll('#wColor button').forEach(b => b.setAttribute('aria-pressed', b.dataset.c === dlgW.color));
  $('aOn').checked = !!al?.on; $('aMin').value = al?.min ?? ''; $('aMax').value = al?.max ?? '';
  $('aUnit').textContent = d?.unit ? '(' + d.unit + ')' : '';
  $('wNote').textContent = d && !supported(d.key) ? 'O carro não informa este sensor: o mostrador vai ficar vazio.' :
    d?.calc ? 'Valor calculado pelo app a partir de outros sensores. Ajuste o carro e o combustível em Ajustes.' : '';
}
const optInput = el => el.value.trim() === '' ? null : optNum(parseFloat(el.value.replace(',', '.')));
function readDlg(){
  const k = $('wSensor').value;
  if (k !== dlgW.k){ dlgW.k = k; if (dlgNew) dlgW.type = defaultType(k); dlgW.lo = dlgW.hi = dlgW.dec = null; fillDlg(); }
  dlgW.title = str($('wTitle').value.trim(), 40);
  dlgW.lo = optInput($('wLo')); dlgW.hi = optInput($('wHi'));
  dlgW.dec = $('wDec').value === '' ? null : +$('wDec').value;
  dlgW.w = +$('wW').value; dlgW.h = +$('wH').value;
  dlgW.hist = $('wHist').checked; dlgW.win = +$('wWin').value;
  dlgW.auto = $('wAuto').checked; dlgW.peak = $('wPeak').checked; dlgW.stats = $('wStats').checked;
}
function drawPreview(){
  const cv = $('wPrev'), dpr = devicePixelRatio || 1;
  const box = cv.parentElement.clientWidth;
  const ratio = dlgW.h * 0.5 / Math.max(1, Math.min(dlgW.w, 2));
  cv.style.height = Math.min(260, Math.max(90, box * ratio)) + 'px';
  cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr;
  const s = gaugeState(dlgW);
  // Sem dados ao vivo, a prévia mostra um valor de exemplo no meio da escala
  if (s.v == null && !sensorDef(dlgW.k)?.text){
    s.v = s.a = +(s.lo + (s.hi - s.lo) * 0.62).toFixed(s.dec);
    if (!s.hist?.t.length){
      const now = Date.now(), t = [], v = [];
      for (let i = 0; i < 60; i++){ t.push(now - (59 - i) * s.win * 1000 / 60); v.push(s.lo + (s.hi - s.lo) * (0.5 + 0.25 * Math.sin(i / 6) + 0.05 * Math.sin(i * 1.7))); }
      s.hist = { t, v }; s.max = Math.max(...v); s.st = { min: Math.min(...v), max: s.max, avg: v.reduce((a, b) => a + b) / v.length };
    }
  }
  const al = { on: $('aOn').checked, min: optInput($('aMin')), max: optInput($('aMax')) };
  s.zones.min = al.on ? al.min : null; s.zones.max = al.on ? al.max : null;
  if (typeof s.v === 'number') s.alert = al.on && ((al.min != null && s.v < al.min) || (al.max != null && s.v > al.max));
  renderGauge(cv, s);
}
$('wdlg').addEventListener('input', () => { readDlg(); drawPreview(); });
$('wdlg').addEventListener('change', () => { readDlg(); drawPreview(); });
$('wType').onclick = e => { const b = e.target.closest('[data-t]'); if (!b || b.disabled) return;
  dlgW.type = b.dataset.t;
  if (b.dataset.t === 'graph' && dlgW.w < 2) { dlgW.w = 2; $('wW').value = '2'; }
  if (b.dataset.t === 'hbar' && dlgW.h > 1 && dlgNew) { dlgW.h = 1; $('wH').value = '1'; }
  fillDlg(); drawPreview(); };
$('wColor').onclick = e => { const b = e.target.closest('[data-c]'); if (!b) return; dlgW.color = b.dataset.c; fillDlg(); drawPreview(); };
$('wColor').innerHTML = Object.entries(ACCENTS).map(([k, c]) => '<button type="button" data-c="' + k + '" style="--c:' + c + '" aria-label="Cor ' + k + '"></button>').join('');
$('wType').innerHTML = WTYPES.map(t => '<button type="button" data-t="' + t + '">' + WTYPE_LABEL[t] + '</button>').join('');
$('wSave').onclick = e => {
  e.preventDefault(); readDlg();
  const w = cleanWidget(dlgW); if (!w) return;
  const ws = page().w, i = ws.findIndex(x => x.id === w.id);
  if (i >= 0) ws[i] = w; else ws.push(w);
  const min = optInput($('aMin')), max = optInput($('aMax'));
  if (min == null && max == null) delete cfg.alerts[w.k];
  else cfg.alerts[w.k] = { on: $('aOn').checked, min, max };
  anim.delete(w.id);
  saveCfg(); $('wdlg').close(); renderDash(); dashNeed(); renderAlertList();
};
$('wDel').onclick = e => {
  e.preventDefault();
  const ws = page().w, i = ws.findIndex(x => x.id === dlgW.id);
  if (i >= 0) ws.splice(i, 1);
  saveCfg(); $('wdlg').close(); renderDash(); dashNeed();
};
$('wCancel').onclick = e => { e.preventDefault(); $('wdlg').close(); };
