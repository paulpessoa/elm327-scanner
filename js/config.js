/* ============ Configuração (fica só neste aparelho) ============ */
// Tudo que o usuário personaliza mora em cfg e vai para o localStorage.
// O que vem do armazenamento ou de um backup importado passa SEMPRE por sanitizeCfg:
// só entram chaves conhecidas, números finitos dentro de limites e textos curtos.
// Nenhum texto do usuário vai para innerHTML sem esc(); a CSP do index.html bloqueia scripts de fora.

const CFG_KEY = 'elm327.cfg.v1';
const KEY_RE = /^(p[0-9A-F]{2}|atrv|c:[a-z]{2,6})$/;
const WTYPES = ['dial', 'arc', 'digital', 'hbar', 'vbar', 'graph'];
const ACCENTS = { amber:'#ffb000', green:'#4cc38a', blue:'#5aa9e6', cyan:'#3dd6d0', purple:'#b48cf2', red:'#ef5350', white:'#e9e6de' };
const FUELS = ['gas', 'eth', 'mix', 'diesel'];

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
    vehicle: { disp: 1.36, ve: 80, fuel: 'mix', ethanol: 50, price: 6.0, corr: 100 },
    pages, page: 0,
    alerts: { p05: { on: true, min: null, max: 110 }, atrv: { on: true, min: 11.8, max: 15.0 }, p42: { on: false, min: 12.5, max: 15.0 } },
    alertOpt: { sound: true, vibrate: true, notify: true, delay: 2 },
    outside: { keys: ['p05', 'c:avg', 'p0C', 'atrv'] },
    lambda: { pre: 'p14', post: 'p15', win: 20, focus: 'both', layout: 'overlay' },
    trip: { km: 0, L: 0, since: Date.now() }
  };
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
    price: numIn(v.price, 0, 100, d.vehicle.price), corr: numIn(v.corr, 50, 200, d.vehicle.corr)
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
  if (isObj(o.lambda)){
    const l = o.lambda;
    d.lambda = {
      pre: KEY_RE.test(l.pre) ? l.pre : 'p14', post: KEY_RE.test(l.post) ? l.post : 'p15',
      win: oneOf(l.win, [10, 20, 30, 60], 20), focus: oneOf(l.focus, ['both', 'pre'], 'both'), layout: oneOf(l.layout, ['overlay', 'split'], 'overlay')
    };
  }
  if (isObj(o.trip)) d.trip = { km: numIn(o.trip.km, 0, 1e6, 0), L: numIn(o.trip.L, 0, 1e5, 0), since: numIn(o.trip.since, 0, 9e15, Date.now()) };
  return d;
}

let cfg;
try { cfg = sanitizeCfg(JSON.parse(localStorage.getItem(CFG_KEY) || 'null')); } catch { cfg = defaultCfg(); }
let saveT = null;
function saveCfg(){
  clearTimeout(saveT);
  saveT = setTimeout(() => { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch {} }, 300);
}
