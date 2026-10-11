/* ============ Viagens: uma por conexão, estilo de direção, dicas e abastecimentos ============ */
// Cada vez que o adaptador conecta começa uma viagem; ao desconectar (ou ao reabrir o app, se ele
// foi fechado no meio) ela vai para o histórico. Distância e litros vêm dos mesmos hodômetros da
// viagem de Ajustes (diferença entre o início e o fim), então o método é o mesmo em todas.
// Critérios do estilo (ficam visíveis na tela para ninguém achar que é mágica):
const ST = { acc: 2.5, brk: 3.5, launch: 20, rpm: 3000, fast: 110, gap: 4 };   // m/s², m/s², km/h, rpm, km/h, s entre eventos
const RUN_SPEED = ['p0D', 'p0C', 'p05', 'c:lph'];
let run = null;   // viagem em andamento (com os valores iniciais dos hodômetros)

function runStart(force){
  if (run || !link || (!force && (!cfg.runOpt.auto || link.kind === 'Demo'))) return;
  const t = cfg.trip;
  run = { t0: Date.now(), kmObd0: t.kmObd, kmGps0: t.kmGps, L0: t.L, car: cfg.vehicle.car, fuel: cfg.vehicle.fuel, eth: cfg.vehicle.ethanol,
    price: cfg.vehicle.price, corr: cfg.vehicle.corr, idle_s: 0, move_s: 0, hirpm_s: 0, fast_s: 0, vmax: 0, acc: 0, arr: 0, brk: 0, idleL: 0,
    temp0: null, win: [], last: null, evT: 0, saveT: 0 };
  need('viagem', RUN_SPEED);
  runUi();
}
// Resumo no formato do histórico (serve também para salvar a viagem em andamento)
function runSummary(r = run, now = Date.now()){
  const t = cfg.trip;
  const kmO = t.kmObd - r.kmObd0, kmG = t.kmGps - r.kmGps0;
  const gps = cfg.vehicle.dist === 'gps' && kmG > 0.05;
  return cleanRun({ ...r, t1: now, km: Math.max(0, gps ? kmG : kmO), src: gps ? 'gps' : 'obd', L: Math.max(0, t.L - r.L0) });
}
function runEnd(){
  if (!run) return;
  const s = runSummary();
  run = null; release('viagem');
  cfg.runCur = null;
  if (s && (s.km >= 0.3 || s.t1 - s.t0 > 120000)){ cfg.runs.push(s); if (cfg.runs.length > 300) cfg.runs.shift(); }
  saveCfg(); runUi(); renderRuns();
}
engineOn('value', (k, v, t) => {
  if (!run || typeof v !== 'number') return;
  if (k === 'p05' && run.temp0 == null) run.temp0 = v;
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
    if (a >= ST.acc){ run.acc++; if (old.v < ST.launch) run.arr++; run.evT = t; }
    else if (a <= -ST.brk){ run.brk++; run.evT = t; }
  }
  if (t - run.saveT > 15000){ run.saveT = t; cfg.runCur = runSummary(run, t); saveCfg(); }
});
addEventListener('connected', () => runStart());
addEventListener('disconnected', runEnd);
// App fechado no meio de uma viagem: o que foi salvo vira uma viagem do histórico
if (cfg.runCur){ const r = cfg.runCur; cfg.runCur = null; if (r.km >= 0.3 || r.t1 - r.t0 > 120000) cfg.runs.push(r); saveCfg(); }

/* ---- Avaliação ---- */
const kml = r => r.L > 0.02 && r.km >= 0.3 ? r.km / r.L : null;
function styleOf(r){
  if (r.km < 1 || r.move_s < 60) return null;
  const ev = (r.acc + r.brk) / r.km * 10, hi = r.hirpm_s / r.move_s * 100;
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
  const f = cfg.fills, out = [];
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
  el.innerHTML = run ? '● Gravando esta viagem desde ' + new Date(run.t0).toLocaleTimeString() + '.'
    : link?.kind === 'Demo' ? 'Modo demonstração: viagens não são gravadas.' : cfg.runOpt.auto ? 'Conecte o adaptador: a viagem começa a ser gravada sozinha.' : 'Gravação automática desligada.';
}
function renderRuns(){
  if (!$('runSum')) return;
  const runs = cfg.runs, all = sum(runs);
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
  $('runList').innerHTML = runs.length ? runs.slice().reverse().slice(0, 50).map((r, i) => {
    const s = styleOf(r), k = kml(r), dur = (r.t1 - r.t0) / 1000;
    return '<details class="run"><summary><span>' + new Date(r.t0).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' }) + ' ' +
      new Date(r.t0).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) + '</span><span><b>' + r.km.toFixed(1) + '</b> km</span><span><b>' +
      (k ? k.toFixed(1) : '--') + '</b> km/L</span>' + (s ? '<span class="lvl lvl-' + s[0] + '">' + s[1] + '</span>' : '<span class="muted small">curta</span>') + '</summary>' +
      '<p class="small muted">' + mins(dur) + ' · ' + FUEL_NAME[r.fuel] + ' · R$ ' + (r.L * r.price).toFixed(2) + ' · máx. ' + Math.round(r.vmax) + ' km/h · distância pelo ' + r.src.toUpperCase() +
      (CARS[r.car] ? ' · ' + esc(CARS[r.car].label) : '') + '</p>' +
      '<ul class="small">' + tipsOf(r).map(t => '<li>' + t + '</li>').join('') + '</ul></details>';
  }).join('') : '<p class="empty">Nenhuma viagem ainda. Conecte o adaptador no carro e dirija: ao desconectar, a viagem aparece aqui.</p>';
  const fc = fuelCompare();
  $('fuelCmp').innerHTML = fc.html; $('fuelVerdict').innerHTML = fc.verdict;
  $('fillList').innerHTML = cfg.fills.length ? '<tr><th>data</th><th>hodômetro</th><th>litros</th><th>R$/L</th><th></th><th></th></tr>' +
    cfg.fills.slice().reverse().map(f => '<tr><td>' + new Date(f.t).toLocaleDateString() + '</td><td>' + f.odo + '</td><td>' + f.L.toFixed(2) + '</td><td>' + f.price.toFixed(2) +
      '</td><td>' + FUEL_NAME[f.fuel] + (f.full ? '' : ' (parcial)') + '</td><td><button class="mini danger" data-delfill="' + f.t + '" aria-label="Apagar">✕</button></td></tr>').join('')
    : '<tr><td class="muted">Nenhum abastecimento registrado.</td></tr>';
  runUi();
}
function bindRuns(){
  $('runAuto').checked = cfg.runOpt.auto;
  $('runAuto').onchange = e => { cfg.runOpt.auto = e.target.checked; saveCfg(); if (e.target.checked) runStart(); runUi(); };
  $('btnRunClr').onclick = () => { if (confirm('Apagar todo o histórico de viagens?')){ cfg.runs = []; saveCfg(); renderRuns(); } };
  $('fPrice').value = cfg.vehicle.price; $('fFuel').value = cfg.vehicle.fuel === 'eth' ? 'eth' : 'gas';
  $('btnFill').onclick = () => {
    const n = id => parseFloat(String($(id).value).replace(',', '.'));
    const f = cleanFill({ t: Date.now(), odo: n('fOdo'), L: n('fL'), price: n('fPrice'), fuel: $('fFuel').value, full: $('fFull').checked });
    if (!f || !(f.price > 0)){ alert('Preencha o hodômetro (km do painel), os litros e o preço por litro.'); return; }
    const prev = cfg.fills[cfg.fills.length - 1];
    if (prev && f.odo <= prev.odo){ alert('O hodômetro precisa ser maior que o do último abastecimento (' + prev.odo + ' km).'); return; }
    cfg.fills.push(f);
    // O preço e o combustível do abastecimento passam a valer para o consumo e o custo da viagem
    cfg.vehicle.price = f.price;
    if (f.fuel !== 'mix') cfg.vehicle.fuel = f.fuel;
    saveCfg(); bindVehicle(); renderRuns();
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
  const all = sum(cfg.runs), fc = fuelCompare();
  return {
    criteriosDoEstilo: { aceleracaoForte_ms2: ST.acc, frenagemForte_ms2: ST.brk, giroAlto_rpm: ST.rpm, velocidadeAlta_kmh: ST.fast,
      pePesado: 'mais de 4 acelerações/frenagens fortes a cada 10 km ou mais de 15% do tempo acima do giro alto', peLeve: 'menos de 1,5 a cada 10 km e menos de 5% acima do giro alto' },
    resumo: { viagens: all.n, km: +all.km.toFixed(1), litrosEstimados: +all.L.toFixed(2), kmPorLitro: all.kml ? +all.kml.toFixed(1) : null },
    viagens: cfg.runs.map(r => ({ inicio: new Date(r.t0).toISOString(), minutos: Math.round((r.t1 - r.t0) / 60000), km: +r.km.toFixed(2), litros: +r.L.toFixed(3),
      kmPorLitro: kml(r) ? +kml(r).toFixed(1) : null, combustivel: FUEL_NAME[r.fuel], estilo: styleOf(r)?.[1] || null, paradoLigado_s: Math.round(r.idle_s),
      acimaDoGiroAlto_s: Math.round(r.hirpm_s), aceleracoesFortes: r.acc, arrancadasFortes: r.arr, frenagensFortes: r.brk, velMax: r.vmax, dicas: tipsOf(r) })),
    abastecimentos: cfg.fills.map(f => ({ data: new Date(f.t).toISOString(), hodometro: f.odo, litros: f.L, precoLitro: f.price, combustivel: FUEL_NAME[f.fuel], tanqueCheio: f.full })),
    consumoRealEntreTanquesCheios: fc.iv.map(x => ({ km: x.km, litros: +x.L.toFixed(2), kmPorLitro: +x.kml.toFixed(2), reaisPorKm: +x.rkm.toFixed(3), combustivel: FUEL_NAME[x.fuel] }))
  };
}];
