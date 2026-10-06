/* ============ Osciloscópio das sondas lambda ============ */
// Lê as duas sondas com prioridade (em toda volta do motor de leitura) e desenha as tensões
// rolando na tela como num osciloscópio. As métricas usam os tempos reais de cada amostra.
let lamOn = false, lamPausedAt = null, lamRaf = false;
const lamMarks = [];      // { t, label }
const PRE_C = '#ffb000', POST_C = '#3dd6d0';
const br = (x, d = 2) => x.toFixed(d).replace('.', ',');

const O2_PIDS = [];
for (let p = 0x14; p <= 0x1B; p++) O2_PIDS.push(p);
for (let p = 0x24; p <= 0x2B; p++) O2_PIDS.push(p);
for (let p = 0x34; p <= 0x3B; p++) O2_PIDS.push(p);

function lamCh(key){
  const p = parseInt(key.slice(1), 16), wide = p >= 0x24;
  return wide
    ? { key, p, wide, lo: 0.7, hi: 1.3, mid: 1.0, unit: 'λ', dec: 3, rich: x => x < 0.98, lean: x => x > 1.02, richSide: x => x < 1 }
    : { key, p, wide, lo: 0, hi: 1.0, mid: 0.45, unit: 'V', dec: 3, rich: x => x > 0.6, lean: x => x < 0.3, richSide: x => x > 0.45 };
}
const sName = p => { const i = (p - 0x14) % 8; return 'B' + (i < 4 ? 1 : 2) + 'S' + (i % 4 + 1); };
function o2Label(p){
  const s = sName(p), pos = s.endsWith('S1') ? 'antes do catalisador' : s.endsWith('S2') ? 'depois do catalisador' : 'adicional';
  return s + ' · ' + pos + (p >= 0x34 ? ' · banda larga (corrente)' : p >= 0x24 ? ' · banda larga' : '');
}
function o2Short(p){
  const s = sName(p);
  return s + (s.endsWith('S1') ? ' · pré-cat.' : s.endsWith('S2') ? ' · pós-cat.' : '') + (p >= 0x24 ? ' · larga' : '');
}
function lamOptions(){
  const known = state.pids?.size;
  const list = O2_PIDS.filter(p => !known || state.pids.has(p));
  for (const id of ['lamPre', 'lamPost']){
    const cur = cfg.lambda[id === 'lamPre' ? 'pre' : 'post'];
    $(id).innerHTML = (list.length ? list : O2_PIDS).map(p => '<option value="p' + hex2(p) + '"' + ('p' + hex2(p) === cur ? ' selected' : '') + '>' + o2Short(p) + '</option>').join('');
  }
}
// Escolhe sozinho as sondas do banco 1 que o carro tem
function lamAutoPick(){
  if (!state.pids?.size) return;
  const has = p => state.pids.has(p);
  const pre = [0x14, 0x24, 0x34, 0x18, 0x28].find(has), post = [0x15, 0x25, 0x35, 0x19, 0x29].find(has);
  const curPre = parseInt(cfg.lambda.pre.slice(1), 16), curPost = parseInt(cfg.lambda.post.slice(1), 16);
  if (pre && !has(curPre)) cfg.lambda.pre = 'p' + hex2(pre);
  if (post && !has(curPost)) cfg.lambda.post = 'p' + hex2(post);
  lamOptions();
}

function lamNeed(){
  if (!lamOn) return;
  const { pre, post, focus } = cfg.lambda;
  const fast = focus === 'pre' ? [pre] : [pre, post];
  // Condições do motor para o diagnóstico: temperatura, malha, giro e ajuste curto
  need('sondas', ['p05', 'p03', 'p0C', 'p06', post], fast);
}
async function lamStart(on){
  lamOn = on && !!link;
  $('btnLam').textContent = lamOn ? '■ Parar' : '▶ Iniciar leitura das sondas';
  $('btnLam').classList.toggle('primary', !lamOn);
  if (!lamOn){ release('sondas'); return; }
  lamPausedAt = null; $('btnLamPause').textContent = '⏸ Congelar';
  lamNeed();
  if (!state.pids) await new Promise(r => { const t = setInterval(() => { if (state.pids || !lamOn){ clearInterval(t); r(); } }, 300); });
  lamAutoPick(); lamNeed(); lamKick();
}
$('btnLam').onclick = () => lamStart(!lamOn);
addEventListener('disconnected', () => { if (lamOn) lamStart(false); });

/* ---- Métricas ---- */
function lamMetrics(ch, winMs, now){
  const { t, v } = store.since(ch.key, winMs, now);
  const n = v.length;
  if (n < 3) return { n };
  let min = Infinity, max = -Infinity, sum = 0, rich = 0;
  for (const x of v){ if (x < min) min = x; if (x > max) max = x; sum += x; if (ch.richSide(x)) rich++; }
  // Trocas com histerese: só conta quando passa de um lado ao outro do limite (0,3 ↔ 0,6 V)
  let zone = null, sw = 0, lastL = null, lastR = null;
  const lr = [], rl = [];
  for (let i = 0; i < n; i++){
    const x = v[i], z = ch.rich(x) ? 'R' : ch.lean(x) ? 'L' : null;
    if (z === 'L') lastL = t[i];
    if (z === 'R') lastR = t[i];
    if (z && zone && z !== zone){
      sw++;
      if (z === 'R' && lastL != null) lr.push(t[i] - lastL);
      if (z === 'L' && lastR != null) rl.push(t[i] - lastR);
    }
    if (z) zone = z;
    if (z === 'R') lastL = null;
    if (z === 'L') lastR = null;
  }
  const span = (t[n - 1] - t[0]) / 1000;
  const med = a => a.length ? a.slice().sort((x, y) => x - y)[a.length >> 1] : null;
  return {
    n, min, max, avg: sum / n, amp: max - min, sw, span, rate: span > 0 ? (n - 1) / span : 0,
    hz: span > 0 ? sw / 2 / span : 0, per10: span > 0 ? sw * 10 / span : 0, richPct: rich * 100 / n,
    lr: med(lr), rl: med(rl), step: span > 0 ? span * 1000 / (n - 1) : null, last: v[n - 1]
  };
}

function lamDiagnose(pre, post, mp, mq){
  const out = [];   // [nível, texto]
  const rpm = fresh('p0C', 8000), temp = fresh('p05', 15000), fs = fresh('p03', 15000);
  if (!mp || mp.n < 8) return [['info', 'Juntando amostras…']];
  if (rpm === 0) out.push(['info', 'Motor parado: ligue o motor para ver a sonda trabalhar.']);
  else if (temp != null && temp < 70) out.push(['info', 'Motor frio (' + temp + ' °C). A sonda só manda na mistura com o motor quente; espere passar de 70 °C.']);
  if (typeof fs === 'string' && /aberta/i.test(fs)) out.push(['info', 'ECU em malha aberta (“' + fs + '”): ela ignora a sonda neste momento. Em marcha lenta quente deve voltar para malha fechada.']);
  if (mp.rate < 2) out.push(['warn', 'Taxa de leitura baixa (' + mp.rate.toFixed(1) + ' amostras/s na pré). Oscilações rápidas aparecem achatadas. Use “Prioridade na pré” e feche as outras abas de leitura.']);
  const closed = rpm > 0 && !(temp != null && temp < 70) && !(typeof fs === 'string' && /aberta/i.test(fs));
  // Fora da malha fechada a ECU não usa a sonda: só os casos extremos valem algum comentário
  if (!pre.wide){
    if (mp.max < 0.35) out.push([closed ? 'bad' : 'info', 'Pré no POBRE o tempo todo (máx. ' + br(mp.max) + ' V). ' + (closed ? 'Suspeitas: entrada falsa de ar, falta de combustível (bomba, filtro, bico), furo no escape antes da sonda ou sonda ruim.' : 'Normal no corte de combustível; confira em marcha lenta quente.')]);
    else if (mp.min > 0.55) out.push([closed ? 'bad' : 'info', 'Pré no RICO o tempo todo (mín. ' + br(mp.min) + ' V). ' + (closed ? 'Suspeitas: excesso de combustível (bico pingando, regulador de pressão, cânister), sensor de temperatura mentindo ou sonda contaminada.' : 'Normal com o motor frio ou em aceleração forte.')]);
    else if (!closed) out.push(['info', 'Fora da malha fechada não dá para julgar a sonda. A avaliação completa é com o motor quente, em marcha lenta ou a 2.500 rpm constantes.']);
    else if (mp.amp < 0.2) out.push(['bad', 'Pré quase parada em ' + br(mp.avg) + ' V com o motor quente em malha fechada: sonda morta ou sem aquecimento.']);
    else if (mp.hz < 0.15 && mp.span > 8) out.push(['warn', 'Pré lenta: ' + br(mp.per10, 1) + ' trocas a cada 10 s. A sonda boa troca de lado pelo menos 1 vez por segundo a 2.500 rpm. Pode estar envelhecida.']);
    else if (mp.max < 0.75 || mp.min > 0.2) out.push(['warn', 'Pré oscila, mas com amplitude curta (' + br(mp.min) + ' a ' + br(mp.max) + ' V). A sonda boa vai de menos de 0,2 a mais de 0,8 V. Pode estar desgastada.']);
    else out.push(['ok', 'Pré oscilando bem: ' + br(mp.hz) + ' ciclos/s, de ' + br(mp.min) + ' a ' + br(mp.max) + ' V, ' + mp.richPct.toFixed(0) + '% do tempo no rico.']);
    if (closed && mp.lr != null && mp.step && mp.lr > 300 && mp.lr > mp.step * 2.5) out.push(['warn', 'Passagem do pobre para o rico levou ≈' + Math.round(mp.lr) + ' ms (o normal fica abaixo de 100–300 ms). Resolução desta leitura: ' + Math.round(mp.step) + ' ms.']);
  } else {
    if (!closed) out.push(['info', 'Fora da malha fechada a mistura não precisa ficar em λ 1.']);
    else if (mp.avg < 0.97) out.push(['warn', 'Banda larga pré com mistura rica em média (λ ' + br(mp.avg, 3) + ').']);
    else if (mp.avg > 1.03) out.push(['warn', 'Banda larga pré com mistura pobre em média (λ ' + br(mp.avg, 3) + ').']);
    else out.push(['ok', 'Banda larga pré em torno de λ 1 (' + br(mp.min, 3) + ' a ' + br(mp.max, 3) + ').']);
  }
  if (mq && mq.n >= 5 && !post.wide){
    const ratio = mp.sw >= 4 ? mq.sw / mp.sw : null;
    if (closed && ratio != null && ratio > 0.7 && mq.amp > 0.4) out.push(['bad', 'A pós está copiando a pré (' + mq.sw + ' trocas contra ' + mp.sw + '). O catalisador não está segurando oxigênio: provavelmente gasto.']);
    else if (closed && mq.avg < 0.3 && mq.amp < 0.2) out.push(['warn', 'Pós sempre pobre (média ' + br(mq.avg) + ' V). Suspeitas: furo no escape antes da sonda ou sonda ruim. Logo após uma desaceleração longa é normal.']);
    else if (mq.amp < 0.2 && mq.avg >= 0.45) out.push(['ok', 'Pós estável em ' + br(mq.avg) + ' V: o catalisador está armazenando oxigênio (bom sinal).']);
    else if (mq.amp >= 0.2) out.push(['info', 'Pós variando ' + br(mq.amp) + ' V. É normal logo após acelerar ou desacelerar. Confira com 30 s em 2.500 rpm constantes.']);
  }
  return out;
}

/* ---- Desenho ---- */
function lamKick(){ if (!lamRaf){ lamRaf = true; requestAnimationFrame(lamFrame); } }
let lamLastDom = 0;
function lamFrame(){
  const visible = (tabOpen('sondas') || document.fullscreenElement === $('lamWrap')) && !document.hidden;
  if (!visible){ lamRaf = false; return; }
  const now = lamPausedAt ?? Date.now();
  lamDraw(now);
  if (Date.now() - lamLastDom > 300){ lamLastDom = Date.now(); lamPanel(now); }
  requestAnimationFrame(lamFrame);
}
addEventListener('tab', e => { if (e.detail === 'sondas'){ lamOptions(); lamSize(); lamKick(); } });

function lamSize(){
  const cv = $('lamCv'), dpr = devicePixelRatio || 1;
  cv.width = Math.round(cv.clientWidth * dpr); cv.height = Math.round(cv.clientHeight * dpr);
}
new ResizeObserver(lamSize).observe($('lamCv'));

function lamDraw(now){
  const cv = $('lamCv'), g = cv.getContext('2d'), dpr = devicePixelRatio || 1, W = cv.width, H = cv.height;
  if (!W || !H) return;
  const pre = lamCh(cfg.lambda.pre), post = lamCh(cfg.lambda.post);
  const split = cfg.lambda.layout === 'split' || pre.wide !== post.wide;
  const win = cfg.lambda.win * 1000;
  // Fundo de tubo de osciloscópio
  const bg = g.createRadialGradient(W / 2, H / 2, H * .1, W / 2, H / 2, Math.max(W, H) * .75);
  bg.addColorStop(0, '#0d1620'); bg.addColorStop(1, '#05080b');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const pl = 40 * dpr, pr = 58 * dpr, pt = 12 * dpr, pb = 22 * dpr;
  const lanes = split
    ? [{ ch: pre, col: PRE_C, y: pt, h: (H - pt - pb - 22 * dpr) / 2, name: 'PRÉ' }, { ch: post, col: POST_C, y: pt + (H - pt - pb + 22 * dpr) / 2, h: (H - pt - pb - 22 * dpr) / 2, name: 'PÓS' }]
    : [{ ch: pre, col: PRE_C, y: pt, h: H - pt - pb, name: '' }];
  const w = W - pl - pr, xOf = t => pl + (1 - (now - t) / win) * w;
  for (const L of lanes){
    const ch = L.ch, yOf = x => L.y + L.h - clamp((x - ch.lo) / (ch.hi - ch.lo), 0, 1) * L.h;
    // Zonas rica/pobre
    const yMid = yOf(ch.mid);
    g.fillStyle = 'rgba(239,83,80,.06)'; ch.wide ? g.fillRect(pl, yMid, w, L.y + L.h - yMid) : g.fillRect(pl, L.y, w, yMid - L.y);
    g.fillStyle = 'rgba(90,169,230,.06)'; ch.wide ? g.fillRect(pl, L.y, w, yMid - L.y) : g.fillRect(pl, yMid, w, L.y + L.h - yMid);
    // Grade fina e grossa
    const stepV = ch.wide ? 0.05 : 0.1;
    g.font = 500 + ' ' + 10 * dpr + 'px ' + FONT; g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let x = ch.lo, i = 0; x <= ch.hi + 1e-9; x += stepV, i++){
      const y = yOf(x), major = i % 2 === 0;
      g.fillStyle = major ? 'rgba(147,161,177,.16)' : 'rgba(147,161,177,.07)'; g.fillRect(pl, Math.round(y), w, 1 * dpr);
      if (major){ g.fillStyle = C.muted; g.fillText(x.toFixed(ch.wide ? 2 : 1), pl - 6 * dpr, y); }
    }
    for (let s = 0; s <= cfg.lambda.win; s++){
      const x = pl + w - (s * 1000 + (now % 1000)) / win * w; if (x < pl) break;
      const major = Math.floor((now - s * 1000) / 1000) % 5 === 0;
      g.fillStyle = major ? 'rgba(147,161,177,.14)' : 'rgba(147,161,177,.05)'; g.fillRect(Math.round(x), L.y, 1 * dpr, L.h);
    }
    // Linha de λ = 1 e limites de troca
    g.setLineDash([6 * dpr, 5 * dpr]); g.strokeStyle = 'rgba(233,230,222,.45)'; g.lineWidth = 1 * dpr;
    g.beginPath(); g.moveTo(pl, yMid); g.lineTo(pl + w, yMid); g.stroke();
    g.setLineDash([2 * dpr, 6 * dpr]); g.strokeStyle = 'rgba(233,230,222,.18)';
    for (const z of ch.wide ? [0.98, 1.02] : [0.3, 0.6]){ g.beginPath(); g.moveTo(pl, yOf(z)); g.lineTo(pl + w, yOf(z)); g.stroke(); }
    g.setLineDash([]);
    g.fillStyle = 'rgba(233,230,222,.5)'; g.textAlign = 'left'; g.textBaseline = 'bottom'; g.font = 500 + ' ' + 9.5 * dpr + 'px ' + FONT;
    g.fillText(ch.wide ? 'λ = 1' : '0,45 V · λ = 1', pl + 6 * dpr, yMid - 2 * dpr);
    g.fillStyle = 'rgba(239,83,80,.55)'; g.textBaseline = 'top'; g.fillText('RICA', pl + 6 * dpr, ch.wide ? yMid + 3 * dpr : L.y + 3 * dpr);
    g.fillStyle = 'rgba(90,169,230,.6)'; g.textBaseline = 'bottom'; g.fillText('POBRE', pl + 6 * dpr, ch.wide ? L.y + 14 * dpr : L.y + L.h - 3 * dpr);
    if (L.name){ g.fillStyle = L.col; g.textAlign = 'right'; g.textBaseline = 'top'; g.font = 700 + ' ' + 11 * dpr + 'px ' + FONT; g.fillText(L.name + ' · ' + sName(ch.p), pl + w - 6 * dpr, L.y + 3 * dpr); }
    // Traços
    const traces = split ? [[L.ch, L.col]] : [[post, POST_C], [pre, PRE_C]];
    g.save(); g.beginPath(); g.rect(pl, L.y - 2 * dpr, w + 2 * dpr, L.h + 4 * dpr); g.clip();
    for (const [c, col] of traces){
      const { t, v } = store.since(c.key, win + 2000, now);
      if (!t.length) continue;
      const yOfC = x => L.y + L.h - clamp((x - c.lo) / (c.hi - c.lo), 0, 1) * L.h;
      g.beginPath();
      for (let i = 0; i < t.length; i++){
        const x = xOf(t[i]), y = yOfC(v[i]);
        if (!i || t[i] - t[i - 1] > 2500) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.strokeStyle = col; g.lineWidth = 2.2 * dpr; g.lineJoin = 'round'; g.shadowColor = col; g.shadowBlur = 10 * dpr; g.stroke();
      g.shadowBlur = 0;
      // Com poucas amostras por segundo, mostra onde estão as leituras reais
      const rate = t.length > 1 ? (t.length - 1) * 1000 / (t[t.length - 1] - t[0]) : 0;
      if (rate && rate < 6){ g.fillStyle = col; for (let i = 0; i < t.length; i++){ g.beginPath(); g.arc(xOf(t[i]), yOfC(v[i]), 1.8 * dpr, 0, Math.PI * 2); g.fill(); } }
      const lx = xOf(t[t.length - 1]), ly = yOfC(v[v.length - 1]);
      g.beginPath(); g.arc(lx, ly, 4 * dpr, 0, Math.PI * 2); g.fillStyle = col; g.shadowColor = col; g.shadowBlur = 14 * dpr; g.fill(); g.shadowBlur = 0;
    }
    g.restore();
    // Etiquetas com o valor atual na borda direita, como os cursores de um osciloscópio (afastadas se colidirem)
    const tags = traces.map(([c, col]) => { const e = store.get(c.key); return e && typeof e.v === 'number' ? { c, col, v: e.v,
      y: clamp(L.y + L.h - clamp((e.v - c.lo) / (c.hi - c.lo), 0, 1) * L.h, L.y + 9 * dpr, L.y + L.h - 9 * dpr) } : null; }).filter(Boolean).sort((a, b) => a.y - b.y);
    for (let i = 1; i < tags.length; i++) if (tags[i].y - tags[i - 1].y < 20 * dpr){
      const mid = (tags[i].y + tags[i - 1].y) / 2;
      tags[i - 1].y = clamp(mid - 10 * dpr, L.y + 9 * dpr, L.y + L.h - 29 * dpr); tags[i].y = tags[i - 1].y + 20 * dpr;
    }
    for (const { c, col, v: tv, y } of tags){
      const e = { v: tv };
      g.fillStyle = col; roundRect(g, pl + w + 4 * dpr, y - 9 * dpr, pr - 8 * dpr, 18 * dpr, 4 * dpr); g.fill();
      g.fillStyle = '#05080b'; g.font = 700 + ' ' + 10.5 * dpr + 'px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(e.v.toFixed(c.wide ? 3 : 2), pl + w + pr / 2, y);
    }
  }
  // Marcas de evento
  g.font = 600 + ' ' + 9.5 * dpr + 'px ' + FONT; g.textAlign = 'left'; g.textBaseline = 'top';
  for (const m of lamMarks){
    const x = xOf(m.t); if (x < pl || x > pl + w) continue;
    g.fillStyle = 'rgba(180,140,242,.8)'; g.fillRect(x, pt, 1.5 * dpr, H - pt - pb);
    g.fillText(m.label, x + 3 * dpr, pt + 2 * dpr);
  }
  // Eixo do tempo
  g.fillStyle = C.muted; g.font = 500 + ' ' + 10 * dpr + 'px ' + FONT; g.textBaseline = 'bottom';
  g.textAlign = 'left'; g.fillText('−' + cfg.lambda.win + ' s', pl, H - 4 * dpr);
  g.textAlign = 'center'; g.fillText('−' + cfg.lambda.win / 2 + ' s', pl + w / 2, H - 4 * dpr);
  g.textAlign = 'right'; g.fillText('agora', pl + w, H - 4 * dpr);
  if (!split){
    g.textAlign = 'right'; g.textBaseline = 'top'; g.font = 700 + ' ' + 10.5 * dpr + 'px ' + FONT;
    g.fillStyle = POST_C; const tw = g.measureText('■ pós ' + sName(post.p)).width;
    g.fillText('■ pós ' + sName(post.p), pl + w - 6 * dpr, pt + 4 * dpr);
    g.fillStyle = PRE_C; g.fillText('■ pré ' + sName(pre.p), pl + w - 16 * dpr - tw, pt + 4 * dpr);
  }
  if (lamPausedAt){
    g.fillStyle = 'rgba(240,180,41,.9)'; roundRect(g, pl + w / 2 - 55 * dpr, pt + 6 * dpr, 110 * dpr, 22 * dpr, 6 * dpr); g.fill();
    g.fillStyle = '#1b1300'; g.font = 700 + ' ' + 11 * dpr + 'px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('CONGELADO', pl + w / 2, pt + 17 * dpr);
  }
  if (!lamOn && !store.get(pre.key)){
    g.fillStyle = C.muted; g.font = 600 + ' ' + 13 * dpr + 'px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(link ? 'Toque em “Iniciar leitura das sondas”' : 'Conecte o scanner (ou use o modo demonstração)', pl + w / 2, H / 2);
  }
}

/* ---- Painel de números ---- */
function lamCard(id, ch, m, col){
  const e = store.get(ch.key), v = e && typeof e.v === 'number' ? e.v : null;
  const trim = fresh('o' + hex2(ch.p), 5000);
  const f = v == null ? 0.5 : clamp((v - ch.lo) / (ch.hi - ch.lo), 0, 1);
  const side = v == null ? '' : ch.richSide(v) ? 'rica' : 'pobre';
  const row = (k, val) => '<div><span>' + k + '</span><b>' + val + '</b></div>';
  const ms = x => x == null ? '—' : '≈' + Math.round(x) + ' ms';
  $(id).innerHTML =
    '<div class="lhead"><span style="color:' + col + '">' + (id === 'lamPreCard' ? 'PRÉ' : 'PÓS') + ' · ' + esc(o2Label(ch.p)) + '</span></div>' +
    '<div class="lval" style="color:' + col + '">' + (v == null ? '--' : v.toFixed(ch.wide ? 3 : 3)) + '<small>' + ch.unit + '</small><em>' + side + '</em></div>' +
    '<div class="lbar"><i style="left:' + (f * 100).toFixed(1) + '%;background:' + col + '"></i><span>pobre</span><span>rica</span></div>' +
    '<div class="lgrid">' +
      row('mín / máx', m.n > 2 ? m.min.toFixed(2) + ' / ' + m.max.toFixed(2) : '—') +
      row('amplitude', m.n > 2 ? m.amp.toFixed(2) + ' ' + ch.unit : '—') +
      row('trocas / 10 s', m.n > 2 ? m.per10.toFixed(1) : '—') +
      row('frequência', m.n > 2 ? m.hz.toFixed(2) + ' Hz' : '—') +
      row('tempo no rico', m.n > 2 ? m.richPct.toFixed(0) + '%' : '—') +
      row('pobre → rico', ms(m.lr)) +
      row('amostras/s', m.n > 2 ? m.rate.toFixed(1) : '—') +
      row('ajuste da sonda', trim == null ? '—' : trim.toFixed(1) + '%') +
    '</div>';
}
let lastDiag = [];
function lamPanel(now){
  const pre = lamCh(cfg.lambda.pre), post = lamCh(cfg.lambda.post), win = cfg.lambda.win * 1000;
  const mp = lamMetrics(pre, win, now), mq = lamMetrics(post, win, now);
  lamCard('lamPreCard', pre, mp, PRE_C);
  lamCard('lamPostCard', post, mq, POST_C);
  // Índice do catalisador: trocas da pós ÷ trocas da pré (0 = ótimo, perto de 1 = gasto)
  const ratio = mp.sw >= 4 && mq.n > 2 ? mq.sw / mp.sw : null;
  $('lamCatFill').style.width = ratio == null ? '0' : clamp(ratio * 100, 2, 100) + '%';
  $('lamCatFill').style.background = ratio == null ? '' : ratio < 0.3 ? 'var(--ok)' : ratio < 0.7 ? 'var(--warn)' : 'var(--bad)';
  $('lamCatTxt').textContent = ratio == null ? 'Precisa de pelo menos 4 trocas da pré na janela.' :
    ratio.toFixed(2) + ' · ' + (ratio < 0.3 ? 'catalisador eficiente' : ratio < 0.7 ? 'eficiência reduzida, acompanhe' : 'catalisador provavelmente gasto');
  lastDiag = lamDiagnose(pre, post, mp, mq);
  $('lamDiag').innerHTML = lastDiag.map(([lv, t]) => '<div class="dg ' + lv + '">' + esc(t) + '</div>').join('');
  const temp = fresh('p05', 15000), fs = fresh('p03', 15000), rpm = fresh('p0C', 8000);
  $('lamCond').textContent = [rpm != null ? rpm + ' rpm' : null, temp != null ? temp + ' °C' : null, typeof fs === 'string' ? fs : null].filter(Boolean).join(' · ') || 'Condições do motor: aguardando leitura';
}

/* ---- Controles ---- */
function lamSync(){
  $('lamWin').value = String(cfg.lambda.win); $('lamFocus').value = cfg.lambda.focus; $('lamLayout').value = cfg.lambda.layout;
  lamOptions(); lamNeed();
}
function lamBindCtl(){
  lamSync();
  $('lamWin').onchange = e => { cfg.lambda.win = +e.target.value; saveCfg(); };
  $('lamFocus').onchange = e => { cfg.lambda.focus = e.target.value; saveCfg(); lamNeed(); };
  $('lamLayout').onchange = e => { cfg.lambda.layout = e.target.value; saveCfg(); };
  $('lamPre').onchange = e => { cfg.lambda.pre = e.target.value; saveCfg(); lamNeed(); };
  $('lamPost').onchange = e => { cfg.lambda.post = e.target.value; saveCfg(); lamNeed(); };
  $('btnLamPause').onclick = () => {
    lamPausedAt = lamPausedAt ? null : Date.now();
    $('btnLamPause').textContent = lamPausedAt ? '▶ Continuar' : '⏸ Congelar';
    lamKick();
  };
  $('btnLamMark').onclick = () => { lamMarks.push({ t: Date.now(), label: 'marca ' + (lamMarks.length + 1) }); if (lamMarks.length > 30) lamMarks.shift(); };
  $('btnLamFull').onclick = async () => {
    if (document.fullscreenElement){ document.exitFullscreen(); return; }
    try { await $('lamWrap').requestFullscreen({ navigationUI: 'hide' }); screen.orientation?.lock?.('landscape').catch(() => {}); } catch {}
  };
  document.addEventListener('fullscreenchange', () => {
    $('btnLamFull').textContent = document.fullscreenElement === $('lamWrap') ? '✕ Sair' : '⛶ Tela cheia';
    setTimeout(lamSize, 120); lamKick();
  });
  $('btnLamPng').onclick = () => {
    $('lamCv').toBlob(b => { if (!b) return; const a = document.createElement('a'); a.href = URL.createObjectURL(b);
      a.download = 'sondas-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); });
  };
  $('btnLamSnap').onclick = lamSnapTest;
}

// Teste de resposta: acelerar fundo e soltar. A pré deve ir acima de 0,8 V (enriquecimento)
// e cair abaixo de 0,15 V no corte de combustível da desaceleração.
let snapT = null;
function lamSnapTest(){
  if (!lamOn){ alert('Inicie a leitura das sondas primeiro, com o motor quente em marcha lenta.'); return; }
  clearTimeout(snapT);
  const t0 = Date.now();
  lamMarks.push({ t: t0, label: 'acelere!' });
  $('lamSnapOut').innerHTML = '<div class="dg info">Agora: acelere fundo até ~3.000 rpm e solte de uma vez. Medindo por 10 s…</div>';
  navigator.vibrate?.(80);
  snapT = setTimeout(() => {
    const ch = lamCh(cfg.lambda.pre), { t, v } = store.since(ch.key, Date.now() - t0 + 200);
    lamMarks.push({ t: Date.now(), label: 'fim' });
    if (v.length < 5){ $('lamSnapOut').innerHTML = '<div class="dg warn">Poucas amostras para avaliar. Use “Prioridade na pré” e repita.</div>'; return; }
    const max = Math.max(...v), min = Math.min(...v), iMax = v.indexOf(max);
    let fall = null;
    for (let i = iMax; i < v.length; i++) if (ch.lean(v[i])){ fall = t[i] - t[iMax]; break; }
    const res = [];
    if (ch.wide){
      res.push([min < 0.95 ? 'ok' : 'warn', 'Enriquecimento ao acelerar: λ mín. ' + min.toFixed(3) + (min < 0.95 ? ' (ok)' : ' (fraco)')]);
      res.push([max > 1.2 ? 'ok' : 'warn', 'Corte na desaceleração: λ máx. ' + max.toFixed(3) + (max > 1.2 ? ' (ok)' : ' (não apareceu)')]);
    } else {
      res.push([max >= 0.8 ? 'ok' : 'warn', 'Pico rico ao acelerar: ' + max.toFixed(2) + ' V ' + (max >= 0.8 ? '(ok, acima de 0,8 V)' : '(baixo: o ideal passa de 0,8 V)')]);
      res.push([min <= 0.15 ? 'ok' : 'warn', 'Queda no corte da desaceleração: ' + min.toFixed(2) + ' V ' + (min <= 0.15 ? '(ok, abaixo de 0,15 V)' : '(alta: o ideal fica abaixo de 0,15 V)')]);
      if (fall != null) res.push([fall < 400 ? 'ok' : 'warn', 'Do rico ao pobre em ≈' + Math.round(fall) + ' ms' + (fall < 400 ? '' : ' (lenta)') + '. Resolução: ' + Math.round((t[t.length - 1] - t[0]) / (t.length - 1)) + ' ms.']);
    }
    snapResult = { quando: new Date(t0).toISOString(), resultados: res.map(r => r[1]) };
    $('lamSnapOut').innerHTML = res.map(([lv, x]) => '<div class="dg ' + lv + '">' + esc(x) + '</div>').join('');
  }, 10000);
}
let snapResult = null;

// Exportação para JSON / IA
function sondasData(){
  const pre = lamCh(cfg.lambda.pre), post = lamCh(cfg.lambda.post), win = cfg.lambda.win * 1000, now = lamPausedAt ?? Date.now();
  const pack = (ch) => {
    const { t, v } = store.since(ch.key, win, now), step = Math.max(1, Math.ceil(t.length / 600));
    const m = lamMetrics(ch, win, now);
    const r = x => x == null ? null : +x.toFixed(3);
    return {
      sensor: o2Label(ch.p), pid: '01' + hex2(ch.p), unidade: ch.unit,
      metricas: m.n > 2 ? { min: r(m.min), max: r(m.max), media: r(m.avg), amplitude: r(m.amp), trocas: m.sw, trocasPor10s: r(m.per10),
        frequenciaHz: r(m.hz), tempoNoRicoPct: r(m.richPct), pobreParaRico_ms: m.lr && Math.round(m.lr), amostrasPorSegundo: r(m.rate) } : null,
      amostras: t.filter((_, i) => i % step === 0).map((x, i) => [+((x - now) / 1000).toFixed(2), v[i * step]])
    };
  };
  return {
    janela_s: cfg.lambda.win,
    condicoes: { rpm: fresh('p0C', 8000), temperaturaMotor: fresh('p05', 15000), sistemaCombustivel: fresh('p03', 15000), ajusteCurtoB1: fresh('p06', 8000) },
    pre: pack(pre), pos: pack(post),
    diagnosticoDoApp: lastDiag.map(d => d[1]), testeDeAceleracao: snapResult,
    observacao: 'Amostras como [segundos até agora, valor]. Leitura via ELM327: a taxa de amostragem limita a resolução de tempo.'
  };
}
EXPORTS.sondas = ['Osciloscópio das sondas lambda (pré e pós-catalisador)', sondasData];
