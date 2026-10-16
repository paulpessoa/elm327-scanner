/* ============ Perfis dos carros e linha de base ============ */
// Cada aba de carro tem um <div class="carbox" data-car="aba">. Aqui ficam só dados de catálogo
// (motor e cilindrada); nada de "valor ideal" inventado: a referência de verdade é a linha de base,
// gravada no próprio carro, com motor quente em marcha lenta, para comparar depois.
const CARS = {
  c3:       { tab: 'c3', label: 'C3 1.4 8V TU3JP', nome: 'Citroën C3 2010 1.4 8V TU3JP flex', disp: 1.36, motor: 'TU3JP 1.4 8V · 1.360 cm³ · 4 cilindros' },
  mobifire: { tab: 'mobi', label: 'Fire Evo 1.0 8V (4 cilindros)', nome: 'Fiat Mobi 1.0 8V Fire Evo flex, câmbio manual, direção hidráulica', disp: 0.999, motor: 'Fire Evo 1.0 8V · 999 cm³ · 4 cilindros' },
  mobiffly: { tab: 'mobi', label: 'Firefly 1.0 6V (3 cilindros)', nome: 'Fiat Mobi 1.0 6V Firefly flex, câmbio manual, direção hidráulica', disp: 0.999, motor: 'Firefly 1.0 6V · 999 cm³ · 3 cilindros' },
  duster16: { tab: 'duster', label: '1.6 16V SCe (H4M)', nome: 'Renault Duster 2018 1.6 16V SCe flex, câmbio manual, 4x2', disp: 1.598, motor: 'H4M 1.6 16V SCe · 1.598 cm³ · 4 cilindros' },
  duster20: { tab: 'duster', label: '2.0 16V (F4R)', nome: 'Renault Duster 2018 2.0 16V flex, câmbio manual, 4x2', disp: 1.998, motor: 'F4R 2.0 16V · 1.998 cm³ · 4 cilindros' }
};
const BASE_KEYS = ['p0C', 'p05', 'p04', 'p0B', 'p10', 'p0E', 'p06', 'p07', 'p0F', 'p11', 'p14', 'p15', 'p42', 'atrv', 'c:lph'];
const BASE_S = 120;
let baseRec = null;

function useCar(id){
  const c = CARS[id]; if (!c) return;
  cfg.vehicle.car = id; cfg.vehicle.disp = c.disp;
  $('carName').value = c.nome; try { localStorage.setItem('carName', c.nome); } catch {}
  saveCfg(); bindVehicle(); renderCars(); renderRuns(); renderMaint();
}

function renderCars(){
  document.querySelectorAll('.carbox').forEach(box => {
    const tab = box.dataset.car;
    const ids = Object.keys(CARS).filter(id => CARS[id].tab === tab);
    const sel = ids.includes(box.dataset.pick) ? box.dataset.pick : ids.includes(cfg.vehicle.car) ? cfg.vehicle.car : ids[0];
    box.dataset.pick = sel;
    const c = CARS[sel], inUse = cfg.vehicle.car === sel;
    const b = cfg.base[sel];
    box.innerHTML =
      (ids.length > 1 ? '<div class="chips" role="radiogroup" aria-label="Motor">' + ids.map(id =>
        '<button class="chip' + (id === sel ? ' on' : '') + '" role="radio" aria-selected="' + (id === sel) + '" aria-checked="' + (id === sel) + '" data-pick="' + id + '">' + esc(CARS[id].label) + '</button>').join('') + '</div>' : '') +
      '<dl class="kv"><dt>Motor</dt><dd>' + esc(c.motor) + '</dd></dl>' +
      '<div class="row"><button data-use="' + sel + '"' + (inUse ? ' class="on" disabled' : ' class="primary"') + '>' +
        (inUse ? '✓ Este é o carro em uso' : 'Usar este carro') + '</button></div>' +
      '<p class="small muted">“Usar este carro” preenche a cilindrada (para o consumo estimado) e o nome enviado nos relatórios.</p>' +
      '<h3>Linha de base do seu carro</h3>' +
      '<p class="small">Grava ' + BASE_S / 60 + ' min de marcha lenta com o motor quente (acima de 85 °C), parado, sem ar-condicionado. ' +
        'Vira a referência <b>deste</b> carro: depois, compare para ver o que mudou.</p>' +
      '<div class="row"><button data-base="' + sel + '" data-conn' + (link ? '' : ' disabled') + '>' + (baseRec ? '■ Parar gravação' : '● Gravar linha de base') + '</button></div>' +
      '<p class="small muted base-msg" aria-live="polite">' + (baseRec ? 'Gravando…' : b ? 'Gravada em ' + new Date(b.t).toLocaleString() + ' (' + b.s + ' s).' : 'Ainda não gravada.') + '</p>' +
      '<div class="tw"><table class="base-tb">' + baseRows(b) + '</table></div>';
  });
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
  renderCars();
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
  renderCars();
}

function bindCars(){
  document.querySelectorAll('.carbox').forEach(box => box.onclick = e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.pick){ box.dataset.pick = t.dataset.pick; renderCars(); }
    else if (t.dataset.use) useCar(t.dataset.use);
    else if (t.dataset.base) baseStart(t.dataset.base);
  });
  renderCars();
}
// Coluna "agora" acompanha o valor ao vivo enquanto a aba do carro está aberta
setInterval(() => {
  if (baseRec) return;
  document.querySelectorAll('.carbox').forEach(box => { if (box.closest('section').classList.contains('on')){
    const tb = box.querySelector('.base-tb'); if (tb) tb.innerHTML = baseRows(cfg.base[box.dataset.pick]);
  } });
}, 1000);
addEventListener('connected', renderCars);
addEventListener('disconnected', () => { baseStop(false); renderCars(); });

const carData = () => {
  const id = cfg.vehicle.car;
  return { perfil: CARS[id]?.nome || null, cilindrada_L: cfg.vehicle.disp,
    linhaDeBase: cfg.base[id] ? { gravadaEm: new Date(cfg.base[id].t).toISOString(), segundos: cfg.base[id].s,
      colunas: ['mín', 'média', 'máx', 'leituras'],
      valores: Object.fromEntries(Object.entries(cfg.base[id].v).map(([k, a]) => [(sensorDef(k)?.name || k), a.map(x => +x.toFixed(3))])) } : null };
};
