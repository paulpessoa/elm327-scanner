/* ============ Mostradores ============ */
// Cada tipo desenha num canvas. s = estado já resolvido do mostrador:
// { title, unit, lo, hi, dec, v (valor real), a (valor animado), color, zones, alert, peak, hist, stats, win, auto, text }

const FONT = '"Chakra Petch", system-ui, sans-serif';
const C = { face:'#0f151c', face2:'#16202b', line:'#34465a', text:'#e9e6de', muted:'#93a1b1', ok:'#4cc38a', warn:'#f0b429', bad:'#ef5350', grid:'rgba(147,161,177,.14)' };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const fmtV = (v, dec) => v == null ? '--' : typeof v === 'string' ? v : v.toFixed(dec);
const frac = (s, v) => clamp((v - s.lo) / ((s.hi - s.lo) || 1), 0, 1);

// Divisões "redondas" para a escala
function niceStep(range, target){
  const raw = range / target, mag = 10 ** Math.floor(Math.log10(raw)), n = raw / mag;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
}
function ticks(lo, hi, target = 6){
  const st = niceStep(hi - lo, target), out = [];
  for (let v = Math.ceil(lo / st - 1e-9) * st; v <= hi + st * 1e-6; v += st) out.push(+v.toFixed(6));
  return { st, list: out };
}
// Rótulo curto da escala: 7000 rpm vira "7" com "×1000"
function scaleDiv(s){ return Math.max(Math.abs(s.lo), Math.abs(s.hi)) >= 2000 ? 1000 : 1; }
const tickLabel = (v, div, st) => { const x = v / div; return (st / div) < 1 ? x.toFixed(String(st / div).split('.')[1]?.length || 1) : String(Math.round(x)); };

function fitText(g, txt, maxW, size, weight = 700){
  let px = size;
  g.font = weight + ' ' + px + 'px ' + FONT;
  while (px > 9 && g.measureText(txt).width > maxW){ px -= 1; g.font = weight + ' ' + px + 'px ' + FONT; }
  return px;
}
function valueColor(s){ return s.alert ? C.bad : s.color; }

// Faixas coloridas: vermelho fora dos limites de alerta, verde na faixa ideal
function zoneList(s){
  const z = [];
  if (s.zones.ok) z.push([s.zones.ok[0], s.zones.ok[1], C.ok, .55]);
  if (s.zones.min != null) z.push([s.lo, s.zones.min, C.bad, .8]);
  if (s.zones.max != null) z.push([s.zones.max, s.hi, C.bad, .8]);
  return z.map(([a, b, c, o]) => [clamp(a, s.lo, s.hi), clamp(b, s.lo, s.hi), c, o]).filter(([a, b]) => b > a);
}

/* ---- Histórico embutido (faixa inferior) ---- */
function drawSpark(g, x, y, w, h, s, dpr){
  const pts = s.hist; if (!pts || pts.t.length < 2) {
    g.fillStyle = C.muted; g.font = 500 + ' ' + 10 * dpr + 'px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('histórico: aguardando dados', x + w / 2, y + h / 2); return;
  }
  const now = Date.now(), t0 = now - s.win * 1000;
  let lo = Infinity, hi = -Infinity;
  for (const v of pts.v){ if (v < lo) lo = v; if (v > hi) hi = v; }
  const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.05 || 1;
  const L = lo - pad, H = hi + pad;
  g.save();
  g.fillStyle = 'rgba(255,255,255,.025)'; g.fillRect(x, y, w, h);
  g.beginPath();
  pts.t.forEach((t, i) => { const px = x + (t - t0) / (s.win * 1000) * w, py = y + h - (pts.v[i] - L) / (H - L) * h; i ? g.lineTo(px, py) : g.moveTo(px, py); });
  g.strokeStyle = s.color; g.globalAlpha = .9; g.lineWidth = 1.5 * dpr; g.stroke();
  g.globalAlpha = 1;
  g.fillStyle = C.muted; g.font = 500 + ' ' + 9.5 * dpr + 'px ' + FONT; g.textAlign = 'right';
  g.textBaseline = 'top'; g.fillText('máx ' + fmtV(hi, s.dec), x + w - 3 * dpr, y + 2 * dpr);
  g.textBaseline = 'bottom'; g.fillText('mín ' + fmtV(lo, s.dec), x + w - 3 * dpr, y + h - 2 * dpr);
  g.textAlign = 'left'; g.fillText(winLabel(s.win), x + 3 * dpr, y + h - 2 * dpr);
  g.restore();
}
const winLabel = sec => sec >= 60 ? (sec / 60) + ' min' : sec + ' s';

function drawTitle(g, s, W, dpr, align = 'left'){
  g.fillStyle = C.muted; g.textBaseline = 'top'; g.textAlign = align;
  fitText(g, s.title, W - 16 * dpr, 12 * dpr, 600);
  g.fillText(s.title, align === 'left' ? 8 * dpr : W / 2, 7 * dpr);
}

/* ---- Ponteiro ---- */
function drawDial(g, W, H, s, dpr){
  // Reserva a faixa do título no topo
  const top = 22 * dpr, av = H - top, cx = W / 2, R = Math.min(W * 0.46, av * 0.47), cy = top + av / 2 + R * 0.02;
  const A0 = Math.PI * 0.75, SW = Math.PI * 1.5, ang = v => A0 + frac(s, v) * SW;
  // Mostrador
  const grd = g.createRadialGradient(cx, cy - R * .3, R * .1, cx, cy, R);
  grd.addColorStop(0, '#1c2733'); grd.addColorStop(1, '#0b1016');
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fillStyle = grd; g.fill();
  g.lineWidth = 2 * dpr; g.strokeStyle = C.line; g.stroke();
  // Faixas
  for (const [a, b, c, o] of zoneList(s)){
    g.beginPath(); g.arc(cx, cy, R * .86, ang(a), ang(b)); g.strokeStyle = c; g.globalAlpha = o; g.lineWidth = R * .07; g.stroke();
  }
  g.globalAlpha = 1;
  // Marcas
  const div = scaleDiv(s), { st, list } = ticks(s.lo, s.hi, R > 70 * dpr ? 8 : 5);
  g.strokeStyle = C.text; g.fillStyle = C.text; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 600 + ' ' + Math.max(9 * dpr, R * .12) + 'px ' + FONT;
  for (const v of list){
    const a = ang(v), c = Math.cos(a), sn = Math.sin(a);
    g.beginPath(); g.moveTo(cx + c * R * .78, cy + sn * R * .78); g.lineTo(cx + c * R * .93, cy + sn * R * .93);
    g.lineWidth = 2.2 * dpr; g.stroke();
    g.fillText(tickLabel(v, div, st), cx + c * R * .64, cy + sn * R * .64);
    for (let k = 1; k < 5; k++){
      const vm = v + st * k / 5; if (vm > s.hi) break;
      const am = ang(vm);
      g.beginPath(); g.moveTo(cx + Math.cos(am) * R * .86, cy + Math.sin(am) * R * .86);
      g.lineTo(cx + Math.cos(am) * R * .93, cy + Math.sin(am) * R * .93); g.lineWidth = 1 * dpr; g.globalAlpha = .5; g.stroke(); g.globalAlpha = 1;
    }
  }
  if (div > 1){ g.fillStyle = C.muted; g.font = 500 + ' ' + R * .09 + 'px ' + FONT; g.fillText('×1000', cx, cy - R * .32); }
  // Marca de pico
  if (s.peak && s.max != null){
    const a = ang(s.max);
    g.beginPath(); g.moveTo(cx + Math.cos(a) * R * .95, cy + Math.sin(a) * R * .95);
    g.lineTo(cx + Math.cos(a - .05) * R * 1.0, cy + Math.sin(a - .05) * R * 1.0); g.lineTo(cx + Math.cos(a + .05) * R, cy + Math.sin(a + .05) * R);
    g.fillStyle = C.bad; g.fill();
  }
  // Ponteiro
  if (typeof s.a === 'number'){
    const a = ang(s.a), col = valueColor(s);
    g.save(); g.translate(cx, cy); g.rotate(a);
    g.shadowColor = col; g.shadowBlur = 10 * dpr;
    g.beginPath(); g.moveTo(-R * .14, -R * .025); g.lineTo(R * .88, -R * .006); g.lineTo(R * .88, R * .006); g.lineTo(-R * .14, R * .025); g.closePath();
    g.fillStyle = col; g.fill(); g.restore();
  }
  g.beginPath(); g.arc(cx, cy, R * .09, 0, Math.PI * 2); g.fillStyle = '#2a3746'; g.fill(); g.strokeStyle = C.line; g.lineWidth = 1.5 * dpr; g.stroke();
  // Valor
  g.fillStyle = valueColor(s); g.textAlign = 'center'; g.textBaseline = 'middle';
  fitText(g, fmtV(s.v, s.dec), R * .95, R * .28);
  g.fillText(fmtV(s.v, s.dec), cx, cy + R * .66);
  g.fillStyle = C.muted; g.font = 500 + ' ' + Math.max(9 * dpr, R * .11) + 'px ' + FONT;
  g.fillText(s.unit, cx, cy + R * .87);
}

/* ---- Arco ---- */
function drawArc(g, W, H, s, dpr){
  const top = 24 * dpr, av = H - top, cx = W / 2, R = Math.min(W * 0.38, av * 0.4), lw = R * .2, cy = top + av * 0.52;
  const A0 = Math.PI * 0.8333, SW = Math.PI * 1.3333, ang = v => A0 + frac(s, v) * SW;
  g.lineCap = 'round';
  g.beginPath(); g.arc(cx, cy, R, A0, A0 + SW); g.strokeStyle = '#0b1016'; g.lineWidth = lw; g.stroke();
  g.lineCap = 'butt';
  for (const [a, b, c] of zoneList(s)){
    g.beginPath(); g.arc(cx, cy, R + lw * .72, ang(a), ang(b)); g.strokeStyle = c; g.globalAlpha = .75; g.lineWidth = 3 * dpr; g.stroke();
  }
  g.globalAlpha = 1;
  if (typeof s.a === 'number'){
    const col = valueColor(s);
    g.lineCap = 'round'; g.save(); g.shadowColor = col; g.shadowBlur = 12 * dpr;
    g.beginPath(); g.arc(cx, cy, R, A0, Math.max(A0 + 0.001, ang(s.a))); g.strokeStyle = col; g.lineWidth = lw * .78; g.stroke();
    g.restore(); g.lineCap = 'butt';
  }
  if (s.peak && s.max != null){
    const a = ang(s.max);
    g.beginPath(); g.moveTo(cx + Math.cos(a) * (R - lw * .5), cy + Math.sin(a) * (R - lw * .5));
    g.lineTo(cx + Math.cos(a) * (R + lw * .5), cy + Math.sin(a) * (R + lw * .5)); g.strokeStyle = C.bad; g.lineWidth = 2 * dpr; g.stroke();
  }
  g.fillStyle = valueColor(s); g.textAlign = 'center'; g.textBaseline = 'middle';
  fitText(g, fmtV(s.v, s.dec), R * 1.35, R * .5);
  g.fillText(fmtV(s.v, s.dec), cx, cy);
  g.fillStyle = C.muted; g.font = 500 + ' ' + Math.max(9 * dpr, R * .16) + 'px ' + FONT;
  g.fillText(s.unit, cx, cy + R * .42);
  g.font = 500 + ' ' + Math.max(8.5 * dpr, R * .13) + 'px ' + FONT;
  g.fillText(fmtV(s.lo, 0), cx + Math.cos(A0) * R, cy + Math.sin(A0) * R + lw * 1.1);
  g.fillText(fmtV(s.hi, 0), cx + Math.cos(A0 + SW) * R, cy + Math.sin(A0 + SW) * R + lw * 1.1);
}

/* ---- Digital ---- */
function drawDigital(g, W, H, s, dpr){
  const txt = fmtV(s.v, s.dec), col = valueColor(s);
  const statsH = s.stats ? 20 * dpr : 0;
  const isTxt = typeof s.v === 'string';
  g.textBaseline = 'middle'; g.textAlign = 'center';
  const px = fitText(g, txt, W * (isTxt ? .9 : .78), Math.min(H - statsH - 26 * dpr, W * .42) * (isTxt ? .45 : .82));
  g.save(); g.shadowColor = col; g.shadowBlur = 14 * dpr; g.fillStyle = col;
  const cy = 22 * dpr + (H - 22 * dpr - statsH) / 2;
  if (isTxt){
    // Texto longo (ex.: sistema de combustível) quebra em até 2 linhas
    const words = txt.split(' '), lines = [''];
    for (const w of words){ const t = (lines[lines.length - 1] + ' ' + w).trim(); if (g.measureText(t).width > W * .9 && lines[lines.length - 1]) lines.push(w); else lines[lines.length - 1] = t; }
    lines.slice(0, 3).forEach((l, i, a) => g.fillText(l, W / 2, cy + (i - (a.length - 1) / 2) * px * 1.15));
  } else {
    g.fillText(txt, W / 2 - (s.unit ? px * .18 : 0), cy);
  }
  g.restore();
  if (!isTxt && s.unit){
    g.fillStyle = C.muted; g.textAlign = 'left'; g.font = 500 + ' ' + Math.max(10 * dpr, px * .28) + 'px ' + FONT;
    const w = (g.font = 700 + ' ' + px + 'px ' + FONT, g.measureText(txt).width);
    g.font = 500 + ' ' + Math.max(10 * dpr, px * .28) + 'px ' + FONT;
    g.fillText(s.unit, Math.min(W - g.measureText(s.unit).width - 4 * dpr, W / 2 - px * .18 + w / 2 + 4 * dpr), cy + px * .2);
  }
  if (s.stats){
    g.fillStyle = C.muted; g.font = 500 + ' ' + 10.5 * dpr + 'px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'bottom';
    const st = s.st;
    g.fillText(st ? 'mín ' + fmtV(st.min, s.dec) + '  ·  méd ' + fmtV(st.avg, s.dec) + '  ·  máx ' + fmtV(st.max, s.dec) : 'mín · méd · máx', W / 2, H - 5 * dpr);
  }
}

/* ---- Barra horizontal ---- */
function drawHBar(g, W, H, s, dpr){
  const x = 10 * dpr, w = W - 20 * dpr, y = Math.max(28 * dpr, H * .5), h = Math.min(18 * dpr, H * .22);
  g.fillStyle = valueColor(s); g.textAlign = 'right'; g.textBaseline = 'top';
  fitText(g, fmtV(s.v, s.dec) + ' ' + s.unit, W * .45, Math.min(24 * dpr, H * .3));
  g.fillText(fmtV(s.v, s.dec) + ' ' + s.unit, W - 8 * dpr, 5 * dpr);
  roundRect(g, x, y, w, h, h / 2); g.fillStyle = '#0b1016'; g.fill();
  for (const [a, b, c, o] of zoneList(s)){ g.fillStyle = c; g.globalAlpha = o * .35; g.fillRect(x + frac(s, a) * w, y, (frac(s, b) - frac(s, a)) * w, h); }
  g.globalAlpha = 1;
  if (typeof s.a === 'number'){
    const col = valueColor(s), lo0 = s.lo < 0 && s.hi > 0 ? frac(s, 0) : 0, f = frac(s, s.a);
    const gr = g.createLinearGradient(x, 0, x + w, 0); gr.addColorStop(0, col + '88'); gr.addColorStop(1, col);
    g.save(); g.shadowColor = col; g.shadowBlur = 8 * dpr; g.fillStyle = gr;
    roundRect(g, x + Math.min(lo0, f) * w, y + 2 * dpr, Math.max(2 * dpr, Math.abs(f - lo0) * w), h - 4 * dpr, (h - 4 * dpr) / 2); g.fill(); g.restore();
  }
  if (s.peak && s.max != null){ g.fillStyle = C.bad; g.fillRect(x + frac(s, s.max) * w - 1 * dpr, y - 3 * dpr, 2 * dpr, h + 6 * dpr); }
  const div = scaleDiv(s), { st, list } = ticks(s.lo, s.hi, Math.max(3, Math.floor(w / (55 * dpr))));
  g.fillStyle = C.muted; g.textAlign = 'center'; g.textBaseline = 'top'; g.font = 500 + ' ' + 9.5 * dpr + 'px ' + FONT;
  for (const v of list){ const px = x + frac(s, v) * w; g.fillRect(px - .5 * dpr, y + h + 2 * dpr, 1 * dpr, 4 * dpr); g.fillText(tickLabel(v, div, st), px, y + h + 7 * dpr); }
}

/* ---- Barra vertical ---- */
function drawVBar(g, W, H, s, dpr){
  const top = 28 * dpr, bot = H - 8 * dpr, h = bot - top, bw = Math.min(W * .22, 34 * dpr), x = W * .42 - bw / 2;
  roundRect(g, x, top, bw, h, 6 * dpr); g.fillStyle = '#0b1016'; g.fill();
  const yOf = v => bot - frac(s, v) * h;
  for (const [a, b, c, o] of zoneList(s)){ g.fillStyle = c; g.globalAlpha = o * .35; g.fillRect(x, yOf(b), bw, yOf(a) - yOf(b)); }
  g.globalAlpha = 1;
  if (typeof s.a === 'number'){
    const col = valueColor(s), y = yOf(s.a);
    const gr = g.createLinearGradient(0, bot, 0, top); gr.addColorStop(0, col + '77'); gr.addColorStop(1, col);
    g.save(); g.shadowColor = col; g.shadowBlur = 8 * dpr; g.fillStyle = gr; roundRect(g, x + 3 * dpr, y, bw - 6 * dpr, Math.max(2 * dpr, bot - y - 3 * dpr), 4 * dpr); g.fill(); g.restore();
  }
  if (s.peak && s.max != null){ g.fillStyle = C.bad; g.fillRect(x - 4 * dpr, yOf(s.max) - 1 * dpr, bw + 8 * dpr, 2 * dpr); }
  const div = scaleDiv(s), { st, list } = ticks(s.lo, s.hi, Math.max(3, Math.floor(h / (28 * dpr))));
  g.fillStyle = C.muted; g.textAlign = 'left'; g.textBaseline = 'middle'; g.font = 500 + ' ' + 9.5 * dpr + 'px ' + FONT;
  for (const v of list){ const y = yOf(v); g.fillRect(x + bw + 3 * dpr, y - .5 * dpr, 5 * dpr, 1 * dpr); g.fillText(tickLabel(v, div, st), x + bw + 10 * dpr, y); }
  g.fillStyle = valueColor(s); g.textAlign = 'right'; g.textBaseline = 'top';
  fitText(g, fmtV(s.v, s.dec), W * .4, Math.min(22 * dpr, W * .16));
  g.fillText(fmtV(s.v, s.dec), W - 8 * dpr, 7 * dpr);
}

/* ---- Gráfico (histórico) ---- */
function drawGraph(g, W, H, s, dpr){
  const pl = 34 * dpr, pr = 8 * dpr, pt = 30 * dpr, pb = 16 * dpr, w = W - pl - pr, h = H - pt - pb;
  const pts = s.hist || { t: [], v: [] }, now = Date.now(), span = s.win * 1000;
  let lo = s.lo, hi = s.hi;
  if (s.auto && pts.v.length){
    lo = Math.min(...pts.v); hi = Math.max(...pts.v);
    const pad = (hi - lo) * .15 || Math.abs(hi) * .05 || 1; lo -= pad; hi += pad;
  }
  const yOf = v => pt + h - clamp((v - lo) / ((hi - lo) || 1), 0, 1) * h;
  const xOf = t => pl + (1 - (now - t) / span) * w;
  // Grade e escala
  const { st, list } = ticks(lo, hi, Math.max(2, Math.floor(h / (26 * dpr))));
  g.font = 500 + ' ' + 9.5 * dpr + 'px ' + FONT; g.textAlign = 'right'; g.textBaseline = 'middle';
  for (const v of list){
    const y = yOf(v); g.fillStyle = C.grid; g.fillRect(pl, y, w, 1 * dpr);
    g.fillStyle = C.muted; g.fillText(Math.abs(v) >= 1000 ? (v / 1000) + 'k' : (st < 1 ? v.toFixed(String(st).split('.')[1]?.length || 1) : String(v)), pl - 4 * dpr, y);
  }
  if (s.zones.ok){ g.fillStyle = 'rgba(76,195,138,.08)'; const a = yOf(s.zones.ok[1]), b = yOf(s.zones.ok[0]); g.fillRect(pl, a, w, b - a); }
  g.setLineDash([5 * dpr, 4 * dpr]); g.strokeStyle = C.bad; g.lineWidth = 1 * dpr;
  for (const z of [s.zones.min, s.zones.max]) if (z != null && z > lo && z < hi){ g.beginPath(); g.moveTo(pl, yOf(z)); g.lineTo(pl + w, yOf(z)); g.stroke(); }
  g.setLineDash([]);
  g.fillStyle = C.muted; g.textAlign = 'left'; g.textBaseline = 'top';
  g.fillText('−' + winLabel(s.win), pl, pt + h + 3 * dpr); g.textAlign = 'right'; g.fillText('agora', pl + w, pt + h + 3 * dpr);
  // Curva
  if (pts.t.length > 1){
    const col = valueColor(s);
    g.save(); g.beginPath(); g.rect(pl, pt, w, h); g.clip();
    g.beginPath();
    pts.t.forEach((t, i) => { const x = xOf(t), y = yOf(pts.v[i]); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    const lastX = xOf(pts.t[pts.t.length - 1]), firstX = xOf(pts.t[0]);
    g.strokeStyle = col; g.lineWidth = 2 * dpr; g.lineJoin = 'round'; g.shadowColor = col; g.shadowBlur = 6 * dpr; g.stroke();
    g.shadowBlur = 0; g.lineTo(lastX, pt + h); g.lineTo(firstX, pt + h); g.closePath();
    const gr = g.createLinearGradient(0, pt, 0, pt + h); gr.addColorStop(0, col + '40'); gr.addColorStop(1, col + '00');
    g.fillStyle = gr; g.fill();
    g.beginPath(); g.arc(lastX, yOf(pts.v[pts.v.length - 1]), 3 * dpr, 0, Math.PI * 2); g.fillStyle = col; g.fill();
    g.restore();
  }
  g.fillStyle = valueColor(s); g.textAlign = 'right'; g.textBaseline = 'top';
  fitText(g, fmtV(s.v, s.dec) + ' ' + s.unit, W * .42, 17 * dpr);
  g.fillText(fmtV(s.v, s.dec) + ' ' + s.unit, W - 8 * dpr, 6 * dpr);
}

function roundRect(g, x, y, w, h, r){
  r = Math.min(r, w / 2, h / 2);
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

const DRAW = { dial: drawDial, arc: drawArc, digital: drawDigital, hbar: drawHBar, vbar: drawVBar, graph: drawGraph };
const WTYPE_LABEL = { dial:'Ponteiro', arc:'Arco', digital:'Digital', hbar:'Barra', vbar:'Barra vertical', graph:'Gráfico' };

// Desenha um mostrador completo (título, corpo e histórico embutido) num canvas já dimensionado
function renderGauge(cv, s){
  const dpr = devicePixelRatio || 1, W = cv.width, H = cv.height, g = cv.getContext('2d');
  g.clearRect(0, 0, W, H);
  if (!W || !H) return;
  const sparkH = s.hist && s.showHist && s.type !== 'graph' ? Math.min(H * .28, 46 * dpr) : 0;
  drawTitle(g, s, s.type === 'hbar' || s.type === 'vbar' || s.type === 'graph' ? W * .58 : W, dpr, 'left');
  g.save();
  DRAW[s.type](g, W, H - sparkH, s, dpr);
  g.restore();
  if (sparkH) drawSpark(g, 6 * dpr, H - sparkH - 4 * dpr, W - 12 * dpr, sparkH, s, dpr);
}
