/* ============ Viagens: uma por conexão, estilo de direção, dicas e abastecimentos ============ */
// Cada vez que o adaptador conecta começa uma viagem; ao desconectar (ou ao reabrir o app, se ele
// foi fechado no meio) ela vai para o histórico. Distância e litros vêm dos mesmos hodômetros da
// viagem de Ajustes (diferença entre o início e o fim), então o método é o mesmo em todas.
// Início e fim viram os eventos 'runstart' e 'runend', e cada aceleração, frenagem ou curva forte
// vira um evento 'drive': a gravação (rec.js) escuta os três sem que este arquivo saiba dela.
// Critérios do estilo (ficam visíveis na tela para ninguém achar que é mágica):
const ST = { acc: 2.5, brk: 3.5, launch: 20, rpm: 3000, fast: 110, gap: 4, lat: 0.35, latMs: 1000 };   // m/s², m/s², km/h, rpm, km/h, s entre eventos, g, ms na curva
// A6 (hodômetro, 0,1 km) e 31 (km desde que as falhas foram apagadas, 1 km) conferem a distância somada pelo app
const RUN_SPEED = ['p0D', 'p0C', 'p05', 'c:lph', 'pA6', 'p31'];
// Se a conexão cai sozinha e volta em até RUN_GRACE ms, é a mesma viagem (Bluetooth instável, parada rápida)
const RUN_GRACE = 3 * 60 * 1000;
let run = null;   // viagem em andamento (com os valores iniciais dos hodômetros)
let runGrace = null;

function runStart(force){
  if (run || !link || (!force && (!cfg.runOpt.auto || link.kind === 'Demo'))) return;
  const t = cfg.trip;
  run = { t0: Date.now(), kmObd0: t.kmObd, kmGps0: t.kmGps, L0: t.L, car: cfg.vehicle.car, fuel: cfg.vehicle.fuel, eth: cfg.vehicle.ethanol,
    price: cfg.vehicle.price, corr: cfg.vehicle.corr, idle_s: 0, move_s: 0, hirpm_s: 0, fast_s: 0, vmax: 0, acc: 0, arr: 0, brk: 0, crv: 0, glat: 0,
    idleL: 0, temp0: null, odo: {}, sim: link.kind === 'Demo', win: [], last: null, evT: 0, latT: 0, saveT: 0 };
  need('viagem', RUN_SPEED);
  dispatchEvent(new CustomEvent('runstart', { detail: { t0: run.t0, car: run.car, sim: run.sim } }));
  runUi();
}
const driveEvent = (k, t, v) => dispatchEvent(new CustomEvent('drive', { detail: { k, t, v } }));
// Resumo no formato do histórico (serve também para salvar a viagem em andamento)
function runSummary(r = run, now = Date.now()){
  const t = cfg.trip;
  const kmO = t.kmObd - r.kmObd0, kmG = t.kmGps - r.kmGps0;
  const gps = cfg.vehicle.dist === 'gps' && kmG > 0.05;
  let km = Math.max(0, gps ? kmG : kmO);
  // O hodômetro da central não perde trecho: se ele andou mais do que o app somou, vale ele
  const odo = odoKm(r);
  if (odo && odo.km > km + odo.res) km = odo.km;
  return cleanRun({ ...r, t1: now, km, src: gps ? 'gps' : 'obd', L: Math.max(0, t.L - r.L0) });
}
// Distância pelos contadores da central (primeira e última leitura da viagem); res = resolução em km
function odoKm(r){
  for (const [k, res] of [['pA6', 0.2], ['p31', 1]]){
    const o = r.odo?.[k];
    if (o && o.b > o.a && o.b - o.a < 2000) return { km: o.b - o.a, res };
  }
  return null;
}
function runEnd(){
  clearTimeout(runGrace); runGrace = null;
  if (!run) return;
  const s = runSummary();
  run = null; release('viagem');
  cfg.runCur = null;
  const kept = !!s && (s.km >= 0.3 || s.t1 - s.t0 > 120000);
  if (kept){ cfg.runs.push(s); if (cfg.runs.length > 300) cfg.runs.shift(); }
  saveCfg(); runUi(); renderRuns();
  if (s) dispatchEvent(new CustomEvent('runend', { detail: { t0: s.t0, kept } }));
}
// Curva forte: força lateral (medida pelo celular, motion.js) acima de ST.lat por ST.latMs, andando
function curveTick(g, t){
  const spd = fresh('p0D', 5000) ?? fresh('c:gspd', 5000) ?? 0;
  if (g == null || spd < ST.launch){ run.latT = 0; return; }
  if (g > run.glat) run.glat = g;
  if (g < ST.lat){ run.latT = 0; return; }
  if (!run.latT) run.latT = t;
  if (t - run.latT >= ST.latMs && t - run.evT > ST.gap * 1000){ run.crv++; run.evT = t; run.latT = 0; driveEvent('crv', t, g); }
}
engineOn('value', (k, v, t) => {
  if (!run) return;
  if (k === 'c:glat'){ curveTick(v, t); return; }
  if (typeof v !== 'number') return;
  if (k === 'p05' && run.temp0 == null) run.temp0 = v;
  if (k === 'pA6' || k === 'p31'){ const o = run.odo[k] ||= { a: v, b: v }; o.b = v; return; }
  // A velocidade marca o compasso: tempo parado, andando, giro alto, acima de 110, acelerações e frenagens
  const spdKey = fresh('p0D', 5000) != null ? 'p0D' : 'c:gspd';
  if (k !== spdKey) return;
  const rpm = fresh('p0C', 5000), last = run.last;
  run.last = { v, t };
  if (v > run.vmax) run.vmax = v;
  if (last){
    const dt = (t - last.t) / 1000;
    if (dt > 0 && dt < 5){
      if (v < 3){ if (rpm > 300){ run.idle_s += dt; run.idleL += (fresh('c:lph', 5000) || 0) * dt / 3600; } }
      else { run.move_s += dt; if (rpm > ST.rpm) run.hirpm_s += dt; if (v > ST.fast) run.fast_s += dt; }
    }
  }
  // Aceleração medida entre 1 e 3 s atrás, para a velocidade em km/h inteiros não virar ruído
  const w = run.win; w.push({ v, t });
  while (w.length && t - w[0].t > 3000) w.shift();
  const old = w.find(x => t - x.t >= 1000);
  if (old && t - run.evT > ST.gap * 1000){
    const a = (v - old.v) / 3.6 / ((t - old.t) / 1000);
    if (a >= ST.acc){ run.acc++; if (old.v < ST.launch) run.arr++; run.evT = t; driveEvent('acc', t, +a.toFixed(1)); }
    else if (a <= -ST.brk){ run.brk++; run.evT = t; driveEvent('brk', t, +a.toFixed(1)); }
  }
  if (t - run.saveT > 15000){ run.saveT = t; cfg.runCur = runSummary(run, t); saveCfg(); }
});
addEventListener('connected', () => {
  // Voltou dentro do prazo: continua a mesma viagem (o motor de leitura esqueceu os pedidos ao desconectar)
  if (runGrace && run?.car === cfg.vehicle.car){
    clearTimeout(runGrace); runGrace = null;
    need('viagem', RUN_SPEED); run.last = null; run.win = [];
    dispatchEvent(new CustomEvent('runresume', { detail: { t0: run.t0 } }));
    runUi(); return;
  }
  if (runGrace) runEnd();   // outro carro: a viagem anterior termina aqui
  runStart();
});
addEventListener('disconnected', e => {
  if (run && e.detail?.lost && !run.sim){
    cfg.runCur = runSummary(); saveCfg();
    clearTimeout(runGrace); runGrace = setTimeout(runEnd, RUN_GRACE);
    runUi(); return;
  }
  runEnd();
});
// App fechado no meio de uma viagem: o que foi salvo vira uma viagem do histórico
if (cfg.runCur){ const r = cfg.runCur; cfg.runCur = null; if (r.km >= 0.3 || r.t1 - r.t0 > 120000) cfg.runs.push(r); saveCfg(); }

/* ---- Avaliação ---- */
const kml = r => r.L > 0.02 && r.km >= 0.3 ? r.km / r.L : null;
function styleOf(r){
  if (r.km < 1 || r.move_s < 60) return null;
  const ev = (r.acc + r.brk + r.crv) / r.km * 10, hi = r.hirpm_s / r.move_s * 100;
  if (ev > 4 || hi > 15) return ['bad', 'Pé pesado'];
  if (ev < 1.5 && hi < 5) return ['ok', 'Pé leve'];
  return ['warn', 'Moderado'];
}
const mins = s => s < 90 ? Math.round(s) + ' s' : Math.round(s / 60) + ' min';
function tipsOf(r){
  const out = [], tot = r.idle_s + r.move_s;
  if (tot > 300 && r.idle_s / tot > 0.2)
    out.push('Ficou ' + mins(r.idle_s) + ' parado com o motor ligado (' + Math.round(r.idle_s / tot * 100) + '% do tempo)' +
      (r.idleL > 0.01 ? ' e gastou cerca de ' + r.idleL.toFixed(2) + ' L assim' : '') + '. Em paradas longas, desligar o motor economiza.');
  if (r.move_s > 60 && r.hirpm_s / r.move_s > 0.08)
    out.push('Rodou ' + Math.round(r.hirpm_s / r.move_s * 100) + '% do tempo acima de ' + ST.rpm.toLocaleString('pt-BR') + ' rpm. ' + SHIFT_TIP);
  if (r.acc) out.push(r.acc + (r.acc > 1 ? ' acelerações fortes' : ' aceleração forte') + (r.arr ? ' (' + r.arr + ' saindo de parado)' : '') +
    '. Acelerar aos poucos gasta menos e poupa embreagem e pneus.');
  if (r.brk) out.push(r.brk + (r.brk > 1 ? ' frenagens fortes' : ' frenagem forte') + '. Olhar mais longe e tirar o pé antes aproveita o corte de combustível: com a marcha engatada e o pé fora do acelerador, a injeção desliga.');
  if (r.crv) out.push(r.crv + (r.crv > 1 ? ' curvas fortes' : ' curva forte') + ' (até ' + r.glat.toFixed(2).replace('.', ',') + ' g). Reduzir antes de entrar na curva e acelerar de leve na saída é mais seguro e poupa pneus e suspensão.');
  if (r.fast_s > 60) out.push(mins(r.fast_s) + ' acima de ' + ST.fast + ' km/h. A resistência do ar cresce rápido com a velocidade, e o consumo junto.');
  if (r.temp0 != null && r.temp0 < 50 && r.km < 5) out.push('Viagem curta com o motor frio (' + Math.round(r.temp0) + ' °C na saída). Até esquentar o motor gasta mais; juntar pequenos trajetos ajuda.');
  if (!out.length && r.km >= 1) out.push('Boa! Nada para melhorar nesta viagem pelos critérios do app.');
  return out;
}
function sum(list){
  const s = { n: list.length, km: 0, L: 0, cost: 0 };
  for (const r of list){ s.km += r.km; s.L += r.L; s.cost += r.L * r.price; }
  s.kml = s.L > 0.05 && s.km >= 1 ? s.km / s.L : null;
  return s;
}

/* ---- Abastecimentos: o consumo real, pelo hodômetro e pela bomba ---- */
// Entre dois tanques cheios: km = diferença do hodômetro; litros = tudo que entrou depois do primeiro.
// O combustível queimado é o que foi colocado no primeiro (e nos parciais do meio).
function fillIntervals(){
  const f = carFills(), out = [];
  let j = -1;
  for (let i = 0; i < f.length; i++){
    if (!f[i].full) continue;
    if (j >= 0){
      const km = f[i].odo - f[j].odo; let L = 0, pL = 0, pS = 0; const fuels = new Set();
      for (let x = j + 1; x <= i; x++) L += f[x].L;
      // Preço do que foi queimado: o que estava no tanque (abastecimentos de j até o anterior a i)
      for (let x = j; x < i; x++){ fuels.add(f[x].fuel); pL += f[x].L; pS += f[x].L * f[x].price; }
      if (km > 0 && L > 0) out.push({ from: f[j].t, to: f[i].t, km, L, kml: km / L, rkm: L * (pS / pL) / km, fuel: fuels.size === 1 ? [...fuels][0] : 'mix' });
    }
    j = i;
  }
  return out;
}
// Cada carro tem o próprio hodômetro: os abastecimentos são separados por carro
const carFills = () => cfg.fills.filter(f => f.car === cfg.vehicle.car);
const FUEL_NAME = { gas: 'Gasolina', eth: 'Etanol', mix: 'Mistura', diesel: 'Diesel' };
function fuelCompare(){
  const iv = fillIntervals(), by = {};
  for (const x of iv){ const g = by[x.fuel] ||= { km: 0, L: 0, cost: 0, n: 0 }; g.km += x.km; g.L += x.L; g.cost += x.rkm * x.km; g.n++; }
  let html = Object.entries(by).map(([f, g]) => '<div><b>' + (g.km / g.L).toFixed(1) + '</b><span>km/L · ' + FUEL_NAME[f] + '</span><small>R$ ' +
    (g.cost / g.km).toFixed(2) + '/km · ' + Math.round(g.km) + ' km</small></div>').join('');
  let verdict = '';
  if (by.gas && by.eth){
    const ratio = (by.eth.km / by.eth.L) / (by.gas.km / by.gas.L);
    const cheaper = by.eth.cost / by.eth.km < by.gas.cost / by.gas.km ? 'etanol' : 'gasolina';
    verdict = 'No <b>seu carro</b>, o etanol rendeu ' + Math.round(ratio * 100) + '% da gasolina. Então o etanol compensa quando custar até <b>' +
      Math.round(ratio * 100) + '%</b> do preço da gasolina (a regra geral é 70%). Pelos preços que você pagou, saiu mais barato por km: <b>' + cheaper + '</b>.';
  } else verdict = 'Para comparar gasolina e etanol com números reais, registre abastecimentos de tanque cheio com cada um (pelo menos dois seguidos do mesmo combustível).';
  return { html, verdict, iv };
}

/* ---- Tela ---- */
function runUi(){
  const el = $('runNow'); if (!el) return;
  el.innerHTML = run && runGrace ? '⏸ A conexão caiu. Se o adaptador voltar em até ' + RUN_GRACE / 60000 + ' min, esta viagem continua; senão, ela vai para a lista.'
    : run ? '● Gravando esta viagem desde ' + new Date(run.t0).toLocaleTimeString() + '.'
    : link?.kind === 'Demo' ? 'Modo demonstração: as viagens não começam sozinhas. Toque em “Começar viagem agora” para gravar uma de teste.'
    : !link ? (cfg.runOpt.auto ? 'Conecte o adaptador: a viagem começa a ser gravada sozinha.' : 'Gravação automática desligada.')
    : 'Nenhuma viagem em andamento.';
  $('btnRunGo').textContent = run ? '■ Encerrar esta viagem' : '● Começar viagem agora';
  $('btnRunGo').classList.toggle('primary', !run);
  $('runMotion').checked = cfg.runOpt.motion;
}
function renderRuns(){
  if (!$('runSum')) return;
  // Viagens do modo demonstração aparecem na lista, mas não entram nos totais nem na comparação de estilos
  const runs = cfg.runs.filter(r => !r.sim), all = sum(runs);
  $('runSum').innerHTML =
    '<div><b>' + all.n + '</b><span>viagens</span></div><div><b>' + all.km.toFixed(0) + '</b><span>km</span></div>' +
    '<div><b>' + (all.kml ? all.kml.toFixed(1) : '--') + '</b><span>km/L geral</span></div><div><b>' + all.cost.toFixed(0) + '</b><span>R$ estimado</span></div>';
  // Mesmo método de cálculo em todas: a comparação entre estilos é justa mesmo com litros estimados
  const groups = { ok: [], warn: [], bad: [] };
  runs.forEach(r => { const s = styleOf(r); if (s) groups[s[0]].push(r); });
  const gl = { ok: 'Pé leve', warn: 'Moderado', bad: 'Pé pesado' };
  const rows = Object.entries(groups).filter(([, l]) => l.length).map(([k, l]) => { const s = sum(l);
    return '<tr><td><span class="lvl lvl-' + k + '">' + gl[k] + '</span></td><td>' + l.length + '</td><td>' + s.km.toFixed(0) + '</td><td>' + (s.kml ? s.kml.toFixed(1) : '--') + '</td></tr>'; });
  $('runStyle').innerHTML = rows.length ? '<tr><th>Estilo</th><th>viagens</th><th>km</th><th>km/L</th></tr>' + rows.join('') : '<tr><td class="muted">Rode pelo menos 1 km para avaliar.</td></tr>';
  $('runList').innerHTML = cfg.runs.length ? cfg.runs.slice().reverse().slice(0, 50).map(r => {
    const s = styleOf(r), k = kml(r), dur = (r.t1 - r.t0) / 1000;
    return '<details class="run"><summary><span>' + new Date(r.t0).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' }) + ' ' +
      new Date(r.t0).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) + '</span><span><b>' + r.km.toFixed(1) + '</b> km</span><span><b>' +
      (k ? k.toFixed(1) : '--') + '</b> km/L</span>' + (s ? '<span class="lvl lvl-' + s[0] + '">' + s[1] + '</span>' : '<span class="muted small">curta</span>') +
      (r.sim ? '<span class="lvl lvl-info">simulação</span>' : '') + '</summary>' +
      '<p class="small muted">' + mins(dur) + ' · ' + FUEL_NAME[r.fuel] + ' · R$ ' + (r.L * r.price).toFixed(2) + ' · máx. ' + Math.round(r.vmax) + ' km/h' +
      (r.glat ? ' · curvas até ' + r.glat.toFixed(2).replace('.', ',') + ' g' : '') + ' · distância pelo ' + r.src.toUpperCase() +
      (profOf(r.car) ? ' · ' + esc(profName(r.car)) : '') + '</p>' +
      '<ul class="small">' + tipsOf(r).map(t => '<li>' + t + '</li>').join('') + '</ul>' +
      (recHas(r.t0) ? '<div class="row"><button class="mini" data-replay="' + r.t0 + '">▶ Rever esta viagem</button></div>' : '') + '</details>';
  }).join('') : '<p class="empty">Nenhuma viagem ainda. Conecte o adaptador no carro e dirija: ao desconectar, a viagem aparece aqui.</p>';
  const fc = fuelCompare();
  $('fuelCmp').innerHTML = fc.html; $('fuelVerdict').innerHTML = fc.verdict;
  $('fillList').innerHTML = carFills().length ? '<tr><th>data</th><th>hodômetro</th><th>litros</th><th>R$/L</th><th></th><th></th></tr>' +
    carFills().slice().reverse().map(f => '<tr><td>' + new Date(f.t).toLocaleDateString() + '</td><td>' + f.odo + '</td><td>' + f.L.toFixed(2) + '</td><td>' + f.price.toFixed(2) +
      '</td><td>' + FUEL_NAME[f.fuel] + (f.full ? '' : ' (parcial)') + '</td><td><button class="mini danger" data-delfill="' + f.t + '" aria-label="Apagar">✕</button></td></tr>').join('')
    : '<tr><td class="muted">Nenhum abastecimento registrado.</td></tr>';
  runUi();
}
function bindRuns(){
  $('runAuto').checked = cfg.runOpt.auto;
  $('runAuto').onchange = e => { cfg.runOpt.auto = e.target.checked; saveCfg(); if (e.target.checked) runStart(); runUi(); };
  $('btnRunClr').onclick = () => { if (confirm('Apagar todo o histórico de viagens, com as gravações?')){ cfg.runs = []; saveCfg(); recClear(); renderRuns(); } };
  $('btnRunGo').onclick = () => run ? runEnd() : runStart(true);
  $('runMotion').onchange = e => motionToggle(e.target.checked);
  $('runList').onclick = e => { const b = e.target.closest('[data-replay]'); if (b) replayOpen(+b.dataset.replay); };
  $('fPrice').value = cfg.vehicle.price; $('fFuel').value = cfg.vehicle.fuel === 'eth' ? 'eth' : 'gas';
  $('btnFill').onclick = () => {
    const n = id => parseFloat(String($(id).value).replace(',', '.'));
    const f = cleanFill({ t: Date.now(), odo: n('fOdo'), L: n('fL'), price: n('fPrice'), fuel: $('fFuel').value, full: $('fFull').checked, car: cfg.vehicle.car });
    if (!f || !(f.price > 0)){ alert('Preencha o hodômetro (km do painel), os litros e o preço por litro.'); return; }
    const prev = carFills().at(-1);
    if (prev && f.odo <= prev.odo){ alert('O hodômetro precisa ser maior que o do último abastecimento (' + prev.odo + ' km).'); return; }
    cfg.fills.push(f); cfg.fills.sort((a, b) => a.odo - b.odo);
    // O preço e o combustível do abastecimento passam a valer para o consumo e o custo da viagem
    cfg.vehicle.price = f.price;
    if (f.fuel !== 'mix') cfg.vehicle.fuel = f.fuel;
    saveCfg(); bindVehicle(); renderRuns(); renderMaint();
    $('fOdo').value = ''; $('fL').value = '';
  };
  $('fillList').onclick = e => {
    const b = e.target.closest('[data-delfill]'); if (!b || !confirm('Apagar este abastecimento?')) return;
    cfg.fills = cfg.fills.filter(f => f.t !== +b.dataset.delfill); saveCfg(); renderRuns();
  };
  renderRuns();
}
addEventListener('tab', e => { if (e.detail === 'viagens') renderRuns(); });
addEventListener('connected', runUi);

EXPORTS.viagens = ['Histórico de viagens e abastecimentos', () => {
  const all = sum(cfg.runs.filter(r => !r.sim)), fc = fuelCompare();
  return {
    criteriosDoEstilo: { aceleracaoForte_ms2: ST.acc, frenagemForte_ms2: ST.brk, curvaForte_g: ST.lat, curvaForte_s: ST.latMs / 1000, giroAlto_rpm: ST.rpm, velocidadeAlta_kmh: ST.fast,
      pePesado: 'mais de 4 acelerações, frenagens ou curvas fortes a cada 10 km ou mais de 15% do tempo acima do giro alto', peLeve: 'menos de 1,5 a cada 10 km e menos de 5% acima do giro alto' },
    resumo: { viagens: all.n, km: +all.km.toFixed(1), litrosEstimados: +all.L.toFixed(2), kmPorLitro: all.kml ? +all.kml.toFixed(1) : null },
    viagens: cfg.runs.map(r => ({ inicio: new Date(r.t0).toISOString(), minutos: Math.round((r.t1 - r.t0) / 60000), km: +r.km.toFixed(2), litros: +r.L.toFixed(3),
      kmPorLitro: kml(r) ? +kml(r).toFixed(1) : null, combustivel: FUEL_NAME[r.fuel], estilo: styleOf(r)?.[1] || null, paradoLigado_s: Math.round(r.idle_s),
      acimaDoGiroAlto_s: Math.round(r.hirpm_s), aceleracoesFortes: r.acc, arrancadasFortes: r.arr, frenagensFortes: r.brk, curvasFortes: r.crv,
      forcaLateralMax_g: r.glat || null, velMax: r.vmax, simulacao: r.sim, dicas: tipsOf(r) })),
    abastecimentos: cfg.fills.map(f => ({ data: new Date(f.t).toISOString(), hodometro: f.odo, litros: f.L, precoLitro: f.price, combustivel: FUEL_NAME[f.fuel], tanqueCheio: f.full, carro: profOf(f.car) ? profName(f.car) : f.car })),
    consumoRealEntreTanquesCheios: fc.iv.map(x => ({ km: x.km, litros: +x.L.toFixed(2), kmPorLitro: +x.kml.toFixed(2), reaisPorKm: +x.rkm.toFixed(3), combustivel: FUEL_NAME[x.fuel] }))
  };
}];
