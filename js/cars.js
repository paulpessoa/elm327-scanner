/* ============ Veículos (perfis) e linha de base ============ */
// O catálogo tem só dados de fábrica (motor e cilindrada); nada de "valor ideal" inventado: a referência
// de verdade é a linha de base, gravada no próprio carro, com motor quente em marcha lenta.
// Cada veículo do usuário aponta para um modelo do catálogo (ou nenhum) e tem um guia na tela Veículos.
const CARS = {
  c3:       { short: 'Citroën C3 1.4 8V', tab: 'c3', label: 'C3 1.4 8V TU3JP', nome: 'Citroën C3 2010 1.4 8V TU3JP flex', disp: 1.36, motor: 'TU3JP 1.4 8V · 1.360 cm³ · 4 cilindros' },
  mobifire: { short: 'Fiat Mobi 1.0 Fire Evo', tab: 'mobi', label: 'Fire Evo 1.0 8V (4 cilindros)', nome: 'Fiat Mobi 1.0 8V Fire Evo flex, câmbio manual, direção hidráulica', disp: 0.999, motor: 'Fire Evo 1.0 8V · 999 cm³ · 4 cilindros' },
  mobiffly: { short: 'Fiat Mobi 1.0 Firefly', tab: 'mobi', label: 'Firefly 1.0 6V (3 cilindros)', nome: 'Fiat Mobi 1.0 6V Firefly flex, câmbio manual, direção hidráulica', disp: 0.999, motor: 'Firefly 1.0 6V · 999 cm³ · 3 cilindros' },
  duster16: { short: 'Renault Duster 1.6 SCe', tab: 'duster', label: '1.6 16V SCe (H4M)', nome: 'Renault Duster 2018 1.6 16V SCe flex, câmbio manual, 4x2', disp: 1.598, motor: 'H4M 1.6 16V SCe · 1.598 cm³ · 4 cilindros' },
  duster20: { short: 'Renault Duster 2.0', tab: 'duster', label: '2.0 16V (F4R)', nome: 'Renault Duster 2018 2.0 16V flex, câmbio manual, 4x2', disp: 1.998, motor: 'F4R 2.0 16V · 1.998 cm³ · 4 cilindros' }
};
const BASE_KEYS = ['p0C', 'p05', 'p04', 'p0B', 'p10', 'p0E', 'p06', 'p07', 'p0F', 'p11', 'p14', 'p15', 'p42', 'atrv', 'c:lph'];
const BASE_S = 120;
let baseRec = null;

const profOf = (id = cfg.vehicle.car) => cfg.profiles.find(p => p.id === id) || null;
const carModel = (id = cfg.vehicle.car) => CARS[profOf(id)?.model] || null;
const profName = (id = cfg.vehicle.car) => { const p = profOf(id); return p?.name || CARS[p?.model]?.short || 'Meu carro'; };
const isMobi = (id = cfg.vehicle.car) => /^mobi/.test(profOf(id)?.model || '');
// Dados que mudam de carro para carro e acompanham o veículo em uso
function newProfileData(model){
  const c = CARS[model];
  return { vehicle: { ...cfg.vehicle, disp: c ? c.disp : cfg.vehicle.disp, ve: 80, corr: 100 }, alerts: defaultCfg().alerts, trip: newTrip() };
}
function useProfile(id){
  const next = profOf(id); if (!next || id === cfg.vehicle.car) return;
  if (baseRec) baseStop(false);
  const cur = profOf();
  if (cur) cur.data = { vehicle: { ...cfg.vehicle }, alerts: cfg.alerts, trip: cfg.trip };
  const d = next.data || newProfileData(next.model);
  cfg.vehicle = { ...d.vehicle, car: id }; cfg.alerts = d.alerts; cfg.trip = d.trip; next.data = null;
  calcT = 0; fuelT = 0;   // a integração do consumo recomeça no hodômetro do outro carro
  saveCfg(); tripUpdate(); refreshAll();
  $('fPrice').value = cfg.vehicle.price;
}
function addProfile(model, name){
  if (cfg.profiles.length >= 12){ alert('Limite de 12 veículos.'); return; }
  let id; do id = 'v' + uid().slice(0, 7); while (profOf(id));
  cfg.profiles.push({ id, model: CARS[model] ? model : '', name: str(name.trim(), 40), data: newProfileData(model) });
  useProfile(id);
}
function delProfile(){
  const p = profOf(), other = cfg.profiles.find(x => x !== p);
  if (!other){ alert('Este é o único veículo. Adicione outro antes de apagar este.'); return; }
  if (!confirm('Apagar “' + profName() + '” e todo o histórico dele (viagens, abastecimentos, manutenção e linha de base)?')) return;
  const id = p.id;
  useProfile(other.id);
  cfg.profiles = cfg.profiles.filter(x => x.id !== id);
  delete cfg.base[id]; delete cfg.maint[id];
  cfg.fills = cfg.fills.filter(f => f.car !== id); cfg.runs = cfg.runs.filter(r => r.car !== id);
  saveCfg(); renderCars(); renderRuns(); renderMaint();
}
const modelOptions = sel => '<option value="">Outro (preencha a cilindrada)</option>' +
  Object.entries(CARS).map(([k, c]) => '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' + esc(c.short) + '</option>').join('');

function renderCars(){
  const p = profOf(), c = carModel();
  $('carChipTxt').textContent = profName();
  $('profList').innerHTML = cfg.profiles.map(x => {
    const on = x.id === cfg.vehicle.car, m = CARS[x.model];
    return '<button class="pitem' + (on ? ' on' : '') + '" role="radio" aria-checked="' + on + '" data-prof="' + x.id + '"><b>' + esc(profName(x.id)) + '</b>' +
      '<span>' + esc(m ? (x.name ? m.short : m.motor) : 'Modelo não listado') + (on ? ' · em uso' : '') + '</span></button>';
  }).join('');
  $('pName').value = p?.name || ''; $('pName').placeholder = c?.short || 'Meu carro';
  $('pModel').innerHTML = modelOptions(p?.model);
  $('pMotor').textContent = c ? c.motor + '.' : 'Modelo fora do catálogo: confira a cilindrada abaixo.';
  // Guia do modelo: C3, Mobi ou Duster
  let any = false;
  document.querySelectorAll('[data-guide]').forEach(g => { g.hidden = g.dataset.guide !== c?.tab; any ||= !g.hidden; });
  $('guide').hidden = !any;
  renderBase();
}
function renderBase(){
  const id = cfg.vehicle.car, b = cfg.base[id];
  $('baseBox').innerHTML =
    '<p class="small">Grava ' + BASE_S / 60 + ' min de marcha lenta com o motor quente (acima de 85 °C), parado, sem ar-condicionado. ' +
      'Vira a referência <b>deste</b> carro: depois, compare para ver o que mudou.</p>' +
    '<div class="row"><button data-base="' + id + '" data-conn' + (link ? '' : ' disabled') + '>' + (baseRec ? '■ Parar gravação' : '● Gravar linha de base') + '</button></div>' +
    '<p class="small muted base-msg" aria-live="polite">' + (baseRec ? 'Gravando…' : b ? 'Gravada em ' + new Date(b.t).toLocaleString() + ' (' + b.s + ' s).' : 'Ainda não gravada.') + '</p>' +
    '<div class="tw"><table class="base-tb">' + baseRows(b) + '</table></div>';
}

function baseRows(b){
  const keys = b ? Object.keys(b.v) : [];
  if (!keys.length) return '<tr><td class="muted">Sem dados ainda.</td></tr>';
  return '<tr><th>Sensor</th><th>mín</th><th>média</th><th>máx</th><th>agora</th></tr>' + keys.map(k => {
    const d = sensorDef(k) || { name: k, unit: '', d: 1 }, [mn, av, mx] = b.v[k], now = fresh(k, 5000);
    const out = typeof now === 'number' && (now < mn - Math.abs(mx - mn) * 0.5 || now > mx + Math.abs(mx - mn) * 0.5);
    return '<tr><td>' + esc(d.name) + (d.unit ? ' <span class="muted">(' + esc(d.unit) + ')</span>' : '') + '</td><td>' + fmtV(mn, d.d) + '</td><td>' + fmtV(av, d.d) +
      '</td><td>' + fmtV(mx, d.d) + '</td><td' + (out ? ' class="c-bad"' : '') + '>' + fmtV(typeof now === 'number' ? now : null, d.d) + '</td></tr>';
  }).join('');
}

function baseStart(car){
  if (baseRec){ baseStop(false); return; }
  if (!link) return;
  const temp = fresh('p05');
  if (temp != null && temp < 80 && !confirm('O motor está a ' + temp.toFixed(0) + ' °C. A linha de base vale para motor quente (acima de 85 °C). Gravar mesmo assim?')) return;
  need('base', BASE_KEYS);
  baseRec = { car, t0: Date.now(), timer: setInterval(baseTick, 1000) };
  renderBase();
}
function baseTick(){
  if (!baseRec) return;
  const s = (Date.now() - baseRec.t0) / 1000;
  document.querySelectorAll('.base-msg').forEach(el => el.textContent = 'Gravando… ' + Math.floor(s) + ' de ' + BASE_S + ' s. Não acelere.');
  if (!link) baseStop(false);
  else if (s >= BASE_S) baseStop(true);
}
function baseStop(save){
  const r = baseRec; if (!r) return;
  clearInterval(r.timer); baseRec = null; release('base');
  if (save){
    const ms = Date.now() - r.t0, v = {};
    for (const k of BASE_KEYS){
      const h = store.since(k, ms).v;
      if (h.length < 3) continue;   // o carro não informa ou quase não leu: fica de fora
      let mn = Infinity, mx = -Infinity, sum = 0;
      for (const x of h){ if (x < mn) mn = x; if (x > mx) mx = x; sum += x; }
      v[k] = [mn, sum / h.length, mx, h.length];
    }
    cfg.base[r.car] = { t: Date.now(), s: Math.round(ms / 1000), v }; saveCfg();
  }
  renderBase();
}

function bindCars(){
  $('baseBox').onclick = e => { const t = e.target.closest('[data-base]'); if (t) baseStart(t.dataset.base); };
  $('profList').onclick = e => { const t = e.target.closest('[data-prof]'); if (t) useProfile(t.dataset.prof); };
  $('pName').onchange = e => { profOf().name = str(e.target.value.trim(), 40); saveCfg(); renderCars(); };
  $('pModel').onchange = e => {
    const c = CARS[e.target.value]; profOf().model = c ? e.target.value : '';
    if (c){ cfg.vehicle.disp = c.disp; bindVehicle(); }
    saveCfg(); renderCars();
  };
  $('pNewModel').innerHTML = modelOptions('');
  $('btnPNew').onclick = () => { addProfile($('pNewModel').value, $('pNewName').value); $('pNewName').value = ''; $('profNew').open = false; };
  $('btnPDel').onclick = delProfile;
  renderCars();
}
// Coluna "agora" acompanha o valor ao vivo enquanto a tela Veículos está aberta
setInterval(() => {
  if (baseRec || !tabOpen('perfis')) return;
  const tb = document.querySelector('#baseBox .base-tb'); if (tb) tb.innerHTML = baseRows(cfg.base[cfg.vehicle.car]);
}, 1000);
addEventListener('connected', renderBase);
addEventListener('disconnected', () => { baseStop(false); renderBase(); });

const carData = () => {
  const id = cfg.vehicle.car;
  return { veiculo: profName(id), modelo: carModel(id)?.nome || null, cilindrada_L: cfg.vehicle.disp,
    linhaDeBase: cfg.base[id] ? { gravadaEm: new Date(cfg.base[id].t).toISOString(), segundos: cfg.base[id].s,
      colunas: ['mín', 'média', 'máx', 'leituras'],
      valores: Object.fromEntries(Object.entries(cfg.base[id].v).map(([k, a]) => [(sensorDef(k)?.name || k), a.map(x => +x.toFixed(3))])) } : null };
};
