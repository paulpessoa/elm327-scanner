/* ============ Configuração (fica só neste aparelho) ============ */
// Tudo que o usuário personaliza mora em cfg e vai para o localStorage.
// O que vem do armazenamento ou de um backup importado passa SEMPRE por sanitizeCfg:
// só entram chaves conhecidas, números finitos dentro de limites e textos curtos.
// Nenhum texto do usuário vai para innerHTML sem esc(); a CSP do index.html bloqueia scripts de fora.

const CFG_KEY = 'elm327.cfg.v1';
const KEY_RE = /^(p[0-9A-F]{2}|atrv|c:[a-z0-9]{2,6})$/;
const WTYPES = ['dial', 'arc', 'digital', 'hbar', 'vbar', 'graph'];
const ACCENTS = { amber:'#ffb000', green:'#4cc38a', blue:'#5aa9e6', cyan:'#3dd6d0', purple:'#b48cf2', red:'#ef5350', white:'#e9e6de' };
const FUELS = ['gas', 'eth', 'mix', 'diesel'];
const DISTS = ['obd', 'gps'];
// Fora do app: água, bateria, consumo instantâneo e média da viagem
const OUT_DEFAULT = ['p05', 'atrv', 'c:kml', 'c:avg'];

const uid = () => Math.random().toString(36).slice(2, 10);
const str = (v, max, def = '') => typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').slice(0, max) : def;
const numIn = (v, lo, hi, def) => typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;
const optNum = v => typeof v === 'number' && isFinite(v) && Math.abs(v) < 1e7 ? v : null;
const oneOf = (v, list, def) => list.includes(v) ? v : def;
const isObj = o => o && typeof o === 'object' && !Array.isArray(o);

const mkW = (k, type, w, h, extra = {}) => ({ id: uid(), k, type, w, h, ...extra });
function defaultPages(){
  return [
    { name: 'Principal', w: [
      mkW('p0C', 'dial', 1, 2), mkW('p0D', 'arc', 1, 2), mkW('p05', 'arc', 1, 2, { hist: true, win: 300 }),
      mkW('c:kml', 'digital', 1, 2, { stats: true, hist: true }), mkW('p0B', 'hbar', 2, 1),
      mkW('p14', 'graph', 2, 2, { win: 30, color: 'amber' }), mkW('atrv', 'digital', 1, 1, { color: 'green' }), mkW('p04', 'hbar', 1, 1, { color: 'blue' })
    ] },
    { name: 'Consumo', w: [
      mkW('c:kml', 'dial', 1, 2, { color: 'green' }), mkW('c:avg', 'digital', 1, 2, { stats: true, color: 'green' }),
      mkW('c:lph', 'graph', 2, 2, { win: 300, color: 'cyan' }), mkW('c:km', 'digital', 1, 1), mkW('c:fuel', 'digital', 1, 1), mkW('p2F', 'vbar', 1, 2, { color: 'green' }), mkW('p11', 'vbar', 1, 2, { color: 'purple' }),
      mkW('c:cost', 'digital', 2, 1, { color: 'white' }), mkW('p0D', 'hbar', 2, 1, { color: 'blue' })
    ] },
    { name: 'Mistura', w: [
      mkW('p06', 'graph', 2, 2, { win: 60, color: 'cyan' }), mkW('p07', 'hbar', 2, 1, { color: 'purple' }),
      mkW('p14', 'graph', 2, 2, { win: 30 }), mkW('p15', 'graph', 2, 2, { win: 30, color: 'blue' }), mkW('p03', 'digital', 2, 1)
    ] }
  ];
}
function defaultCfg(){
  const pages = defaultPages().map(p => ({ name: p.name, w: p.w.map(cleanWidget) }));
  return {
    v: 1,
    vehicle: { disp: 1.36, ve: 80, fuel: 'mix', ethanol: 50, price: 6.0, corr: 100, dist: 'obd', car: 'c3' },
    pages, page: 0,
    alerts: { p05: { on: true, min: null, max: 110 }, atrv: { on: true, min: 11.8, max: 15.0 }, p42: { on: false, min: 12.5, max: 15.0 } },
    alertOpt: { sound: true, vibrate: true, notify: true, delay: 2 },
    outside: { keys: OUT_DEFAULT.slice() },
    lambda: { pre: 'p14', post: 'p15', win: 20, focus: 'both', layout: 'overlay' },
    trip: newTrip(),
    base: {},
    runs: [], runCur: null, runOpt: { auto: true },
    fills: [],
    simple: true, dtcKnown: [], maint: {}
  };
}

// kmObd/kmGps: os dois hodômetros correm juntos; segKm/segL marcam o início do km atual; segs: um item por km
function newTrip(){ return { kmObd: 0, kmGps: 0, L: 0, since: Date.now(), segKm: 0, segL: 0, segs: [] }; }
function cleanTrip(o){
  const t = newTrip();
  if (!isObj(o)) return t;
  t.kmObd = numIn(o.kmObd ?? o.km, 0, 1e6, 0);   // backups antigos só tinham "km" (pela velocidade do OBD)
  t.kmGps = numIn(o.kmGps, 0, 1e6, 0);
  t.L = numIn(o.L, 0, 1e5, 0); t.since = numIn(o.since, 0, 9e15, Date.now());
  t.segKm = numIn(o.segKm, 0, 1e6, 0); t.segL = numIn(o.segL, 0, 1e5, 0);
  if (Array.isArray(o.segs)) t.segs = o.segs.slice(-500).filter(isObj).map(g => ({
    km: numIn(g.km, 0, 1e6, 0), d: numIn(g.d, 0, 100, 1), L: numIn(g.L, 0, 100, 0), t: numIn(g.t, 0, 9e15, 0), src: oneOf(g.src, DISTS, 'obd')
  }));
  return t;
}
// Histórico de viagens (uma por conexão). Só números conhecidos, com limites, e poucos textos fixos.
const RUN_NUM = { t0: 9e15, t1: 9e15, km: 1e5, L: 1e4, price: 100, corr: 200, eth: 100, idle_s: 1e6, move_s: 1e6, hirpm_s: 1e6, fast_s: 1e6,
  vmax: 300, acc: 1e5, arr: 1e5, brk: 1e5, idleL: 1e4, temp0: 200 };
function cleanRun(o){
  if (!isObj(o)) return null;
  const r = {};
  for (const [k, hi] of Object.entries(RUN_NUM)) r[k] = k === 'temp0' ? (optNum(o[k]) == null ? null : numIn(o[k], -40, hi, null)) : numIn(o[k], 0, hi, 0);
  r.fuel = oneOf(o.fuel, FUELS, 'mix'); r.src = oneOf(o.src, DISTS, 'obd');
  r.car = typeof o.car === 'string' && /^[a-z0-9]{2,12}$/.test(o.car) ? o.car : '';
  return r.t0 ? r : null;
}
// Abastecimentos informados pelo usuário: hodômetro do painel, litros, preço e combustível
function cleanFill(o){
  if (!isObj(o)) return null;
  const f = { t: numIn(o.t, 0, 9e15, 0), odo: numIn(o.odo, 0, 2e6, 0), L: numIn(o.L, 0, 200, 0), price: numIn(o.price, 0, 100, 0),
    fuel: oneOf(o.fuel, ['gas', 'eth', 'mix', 'diesel'], 'gas'), full: o.full !== false,
    car: typeof o.car === 'string' && /^[a-z0-9]{2,12}$/.test(o.car) ? o.car : '' };
  return f.t && f.odo && f.L ? f : null;
}

// Manutenção por carro: hodômetro informado e itens (intervalo e última troca em km)
function cleanMaint(o){
  const out = {};
  if (!isObj(o)) return out;
  for (const [car, m] of Object.entries(o).slice(0, 10)){
    if (!/^[a-z0-9]{2,12}$/.test(car) || !isObj(m)) continue;
    const odo = isObj(m.odo) && optNum(m.odo.km) != null ? { km: numIn(m.odo.km, 0, 2e6, 0), t: numIn(m.odo.t, 0, 9e15, 0) } : null;
    const items = (Array.isArray(m.items) ? m.items : []).slice(0, 30).filter(isObj).map(i => ({
      id: str(i.id, 12) || uid(), name: str(i.name, 40) || 'Item',
      every: optNum(i.every) == null ? null : Math.round(numIn(i.every, 0, 500000, 0)) || null,
      last: optNum(i.last) == null ? null : Math.round(numIn(i.last, 0, 2e6, 0)), lastT: numIn(i.lastT, 0, 9e15, 0)
    }));
    out[car] = { odo, items };
  }
  return out;
}

// Linha de base: valores medidos no próprio carro (mín, média no tempo, máx, nº de leituras)
function cleanBase(o){
  const out = {};
  if (!isObj(o)) return out;
  for (const [car, b] of Object.entries(o).slice(0, 10)){
    if (!/^[a-z0-9]{2,12}$/.test(car) || !isObj(b) || !isObj(b.v)) continue;
    const v = {};
    for (const [k, a] of Object.entries(b.v).slice(0, 80))
      if (KEY_RE.test(k) && Array.isArray(a) && a.length === 4 && a.every(x => optNum(x) != null)) v[k] = a.map(Number);
    out[car] = { t: numIn(b.t, 0, 9e15, 0), s: numIn(b.s, 0, 3600, 0), v };
  }
  return out;
}

function cleanWidget(w){
  if (!isObj(w) || typeof w.k !== 'string' || !KEY_RE.test(w.k)) return null;
  return {
    id: str(w.id, 12) || uid(), k: w.k, type: oneOf(w.type, WTYPES, 'digital'),
    w: Math.round(numIn(w.w, 1, 4, 1)), h: Math.round(numIn(w.h, 1, 4, 2)),
    title: str(w.title, 40), lo: optNum(w.lo), hi: optNum(w.hi), dec: w.dec == null ? null : Math.round(numIn(w.dec, 0, 4, 1)),
    color: oneOf(w.color, Object.keys(ACCENTS), 'amber'), hist: !!w.hist, stats: !!w.stats, peak: w.peak !== false, auto: !!w.auto,
    win: Math.round(numIn(w.win, 10, 1800, 60))
  };
}
function cleanAlert(a){
  if (!isObj(a)) return null;
  const min = optNum(a.min), max = optNum(a.max);
  if (min == null && max == null) return null;
  return { on: !!a.on, min, max };
}
function sanitizeCfg(o){
  const d = defaultCfg();
  if (!isObj(o)) return d;
  const v = isObj(o.vehicle) ? o.vehicle : {};
  d.vehicle = {
    disp: numIn(v.disp, 0.5, 8, d.vehicle.disp), ve: numIn(v.ve, 40, 120, d.vehicle.ve),
    fuel: oneOf(v.fuel, FUELS, d.vehicle.fuel), ethanol: numIn(v.ethanol, 0, 100, d.vehicle.ethanol),
    price: numIn(v.price, 0, 100, d.vehicle.price), corr: numIn(v.corr, 50, 200, d.vehicle.corr),
    dist: oneOf(v.dist, DISTS, 'obd'), car: typeof v.car === 'string' && /^[a-z0-9]{2,12}$/.test(v.car) ? v.car : d.vehicle.car
  };
  if (Array.isArray(o.pages)){
    const pages = o.pages.slice(0, 12).filter(isObj).map(p => ({
      name: str(p.name, 30) || 'Painel', w: (Array.isArray(p.w) ? p.w : []).slice(0, 40).map(cleanWidget).filter(Boolean)
    }));
    if (pages.length) d.pages = pages;
  }
  d.page = Math.round(numIn(o.page, 0, d.pages.length - 1, 0));
  if (isObj(o.alerts)){
    d.alerts = {};
    for (const [k, a] of Object.entries(o.alerts).slice(0, 200)) if (KEY_RE.test(k)){ const c = cleanAlert(a); if (c) d.alerts[k] = c; }
  }
  if (isObj(o.alertOpt)) d.alertOpt = {
    sound: o.alertOpt.sound !== false, vibrate: o.alertOpt.vibrate !== false, notify: o.alertOpt.notify !== false,
    delay: numIn(o.alertOpt.delay, 0, 30, 2)
  };
  if (isObj(o.outside) && Array.isArray(o.outside.keys)) d.outside.keys = o.outside.keys.filter(k => typeof k === 'string' && KEY_RE.test(k)).slice(0, 4);
  // Quem nunca mexeu (ainda está no padrão antigo) passa para o novo padrão
  if (d.outside.keys.join() === 'p05,c:avg,p0C,atrv') d.outside.keys = OUT_DEFAULT.slice();
  if (isObj(o.lambda)){
    const l = o.lambda;
    d.lambda = {
      pre: KEY_RE.test(l.pre) ? l.pre : 'p14', post: KEY_RE.test(l.post) ? l.post : 'p15',
      win: oneOf(l.win, [10, 20, 30, 60], 20), focus: oneOf(l.focus, ['both', 'pre'], 'both'), layout: oneOf(l.layout, ['overlay', 'split'], 'overlay')
    };
  }
  d.trip = cleanTrip(o.trip);
  d.base = cleanBase(o.base);
  if (Array.isArray(o.runs)) d.runs = o.runs.slice(-300).map(cleanRun).filter(Boolean);
  d.runCur = cleanRun(o.runCur);
  d.simple = o.simple === true;   // configuração salva antes do modo simples continua no painel completo
  if (Array.isArray(o.dtcKnown)) d.dtcKnown = o.dtcKnown.filter(c => typeof c === 'string' && /^[PCBU][0-9A-F]{4}$/.test(c)).slice(0, 50);
  if (isObj(o.runOpt)) d.runOpt = { auto: o.runOpt.auto !== false };
  // Abastecimentos antigos (sem carro) ficam com o carro em uso
  if (Array.isArray(o.fills)) d.fills = o.fills.slice(-300).map(cleanFill).filter(Boolean).map(f => ({ ...f, car: f.car || d.vehicle.car })).sort((a, b) => a.odo - b.odo);
  d.maint = cleanMaint(o.maint);
  return d;
}

let cfg;
try { cfg = sanitizeCfg(JSON.parse(localStorage.getItem(CFG_KEY) || 'null')); } catch { cfg = defaultCfg(); }
let saveT = null;
function saveCfg(){
  clearTimeout(saveT);
  saveT = setTimeout(() => { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch {} }, 300);
}
