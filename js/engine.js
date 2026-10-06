/* ============ Motor de leitura ============ */
// Um único laço conversa com o ELM e atende todas as telas. Cada tela pede sensores com
// need(nome, chaves, chavesRápidas) e libera com release(nome).
// As chaves rápidas (sondas lambda) são lidas em toda volta; as demais revezam entre si.
// Em CAN, até 6 PIDs vão num pedido só (SAE J1979), o que multiplica a taxa de amostragem.

// Bytes de dados de cada PID do modo 01, para separar uma resposta com vários PIDs
const LEN = {};
(() => {
  const set = (n, list) => list.forEach(p => LEN[p] = n);
  set(4, [0x00, 0x20, 0x40, 0x60, 0x80, 0xA0, 0x01, 0x41, 0x4F, 0x50]);
  set(2, [0x02, 0x03, 0x0C, 0x10, 0x1F, 0x21, 0x22, 0x23, 0x31, 0x32, 0x3C, 0x3D, 0x3E, 0x3F, 0x42, 0x43, 0x44, 0x4D, 0x4E,
    0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5D, 0x5E]);
  set(1, [0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0x0D, 0x0E, 0x0F, 0x11, 0x12, 0x13, 0x1C, 0x1D, 0x1E,
    0x2C, 0x2D, 0x2E, 0x2F, 0x30, 0x33, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4A, 0x4B, 0x4C, 0x51, 0x52, 0x5A, 0x5B, 0x5C, 0x5F]);
  for (let p = 0x14; p <= 0x1B; p++) LEN[p] = 2;
  for (let p = 0x24; p <= 0x2B; p++) LEN[p] = 4;
  for (let p = 0x34; p <= 0x3B; p++) LEN[p] = 4;
})();

/* ---- Catálogo de sensores para o painel: faixa da escala (r), faixa ideal (ok) e casas decimais (d) ---- */
const META = {
  0x04:{ r:[0,100], ok:[15,35], d:0 }, 0x05:{ r:[-40,130], ok:[85,105], d:0 },
  0x0A:{ r:[0,765], d:0 }, 0x0B:{ r:[0,110], ok:[25,45], d:0 }, 0x0C:{ r:[0,7000], ok:[750,950], d:0 },
  0x0D:{ r:[0,200], d:0 }, 0x0E:{ r:[-20,50], ok:[5,20], d:1 }, 0x0F:{ r:[-20,80], d:0 }, 0x10:{ r:[0,150], d:1 },
  0x11:{ r:[0,100], d:0 }, 0x1F:{ r:[0,3600], d:0 }, 0x21:{ r:[0,1000], d:0 }, 0x2F:{ r:[0,100], d:0 },
  0x33:{ r:[60,110], d:0 }, 0x42:{ r:[10,16], ok:[13.5,14.8], d:2 }, 0x43:{ r:[0,100], d:0 }, 0x44:{ r:[0.7,1.3], ok:[0.97,1.03], d:3 },
  0x46:{ r:[-10,50], d:0 }, 0x52:{ r:[0,100], d:0 }, 0x5C:{ r:[-40,150], ok:[80,110], d:0 }, 0x5E:{ r:[0,30], d:1 }
};
[0x06, 0x07, 0x08, 0x09, 0x55, 0x56, 0x57, 0x58].forEach(p => META[p] = { r:[-25,25], ok:[-10,10], d:1 });
[0x3C, 0x3D, 0x3E, 0x3F].forEach(p => META[p] = { r:[0,1000], ok:[350,800], d:0 });
for (let p = 0x14; p <= 0x1B; p++) META[p] = { r:[0,1], ok: p % 4 === 1 ? [0.5,0.8] : [0.1,0.9], d:3 };
for (let p = 0x24; p <= 0x2B; p++) META[p] = { r:[0.7,1.3], ok:[0.97,1.03], d:3 };
for (let p = 0x34; p <= 0x3B; p++) META[p] = { r:[0.7,1.3], ok:[0.97,1.03], d:3 };

const CALC = {
  'c:kml':  { name:'Consumo instantâneo', unit:'km/L', r:[0,30], ok:[10,30], d:1 },
  'c:avg':  { name:'Média da viagem', unit:'km/L', r:[0,25], d:1 },
  'c:lph':  { name:'Consumo por hora', unit:'L/h', r:[0,20], d:2 },
  'c:km':   { name:'Distância da viagem', unit:'km', r:[0,500], d:1 },
  'c:fuel': { name:'Combustível gasto', unit:'L', r:[0,60], d:2 },
  'c:cost': { name:'Custo da viagem', unit:'R$', r:[0,500], d:2 },
  'c:maf':  { name:'Fluxo de ar (calculado)', unit:'g/s', r:[0,60], d:1 }
};
const UNIT_R = { '%':[0,100], '°C':[-40,130], 'kPa':[0,110], 'V':[0,16], 'λ':[0.7,1.3], 'rpm':[0,7000], 'km/h':[0,200], '°':[-20,50] };

function sensorDef(k){
  if (k === 'atrv') return { key:k, name:'Bateria (ATRV)', unit:'V', r:[10,16], ok:[12.4,14.8], d:1 };
  if (CALC[k]) return { key:k, ...CALC[k], calc:true };
  if (!/^p[0-9A-F]{2}$/.test(k)) return null;
  const p = parseInt(k.slice(1), 16), d = PIDS[p];
  if (!d || !(d.f || d.t)) return null;
  const m = META[p] || {};
  return { key:k, pid:p, name:d.name, unit:d.unit || '', text: !!d.t, r: m.r || UNIT_R[d.unit] || [0, 100], ok: m.ok || null, d: m.d ?? 1 };
}
// Lista para os seletores: calculados, bateria e todos os PIDs que fazem sentido num painel
function sensorList(){
  const skip = new Set([0x01, 0x13, 0x1C, 0x51]);
  const pids = Object.keys(PIDS).map(Number).filter(p => !skip.has(p) && (PIDS[p].f || PIDS[p].t)).sort((a, b) => a - b);
  return [...Object.keys(CALC), 'atrv', ...pids.map(p => 'p' + hex2(p))].map(sensorDef).filter(Boolean);
}
const supported = k => {
  if (!k.startsWith('p') || !state.pids?.size) return true;
  return state.pids.has(parseInt(k.slice(1), 16));
};

/* ---- Armazém de leituras com histórico ---- */
const HIST_MS = 15 * 60 * 1000, HIST_MAX = 20000;
const store = {
  m: new Map(),
  get(k){ return this.m.get(k); },
  set(k, v, t = Date.now()){
    let e = this.m.get(k);
    if (!e){ e = { v:null, t:0, ht:[], hv:[] }; this.m.set(k, e); }
    e.v = v; e.t = t;
    if (typeof v === 'number'){
      e.ht.push(t); e.hv.push(v);
      if (e.ht.length > HIST_MAX || t - e.ht[0] > HIST_MS + 60000){
        let i = 0; while (i < e.ht.length && (t - e.ht[i] > HIST_MS || e.ht.length - i > HIST_MAX * 0.75)) i++;
        e.ht.splice(0, i); e.hv.splice(0, i);
      }
    }
    emit('value', k, v, t);
  },
  // Pontos dos últimos ms milissegundos
  since(k, ms, now = Date.now()){
    const e = this.m.get(k); if (!e || !e.ht.length) return { t:[], v:[] };
    let lo = 0, hi = e.ht.length;
    while (lo < hi){ const mid = (lo + hi) >> 1; if (e.ht[mid] < now - ms) lo = mid + 1; else hi = mid; }
    return { t: e.ht.slice(lo), v: e.hv.slice(lo) };
  }
};
const fresh = (k, ms = 5000) => { const e = store.get(k); return e && Date.now() - e.t < ms && e.v != null ? e.v : null; };

/* ---- Eventos ---- */
const listeners = { value: [], cycle: [], status: [] };
const engineOn = (ev, fn) => listeners[ev].push(fn);
function emit(ev, ...a){ for (const f of listeners[ev]) { try { f(...a); } catch (e) { console.error(e); } } }

/* ---- Pedidos das telas ---- */
const engine = { consumers: new Map(), running: false, dead: new Map(), multi: null, slowPos: 0, cycleT: 0, cycleReads: 0, rate: 0 };
function need(name, keys, fastKeys = []){
  engine.consumers.set(name, { keys: [...new Set(keys)], fast: [...new Set(fastKeys)] });
  engineStart();
}
function release(name){ engine.consumers.delete(name); }

// Que PIDs cada chave exige (os calculados dependem de outros)
function deps(k){
  const has = p => state.pids?.has(p);
  const known = !!state.pids?.size;
  const maf = has(0x10) ? ['p10'] : known ? ['p0B', 'p0C', 'p0F'] : ['p10', 'p0B', 'p0C', 'p0F'];
  const lph = has(0x5E) ? ['p5E'] : [...maf, 'p0C', 'p0B', 'p03'];
  switch (k){
    case 'c:maf': return maf;
    case 'c:lph': return lph;
    case 'c:km': return ['p0D'];
    case 'c:kml': case 'c:avg': case 'c:fuel': case 'c:cost': return [...lph, 'p0D'];
  }
  return [k];
}
function plan(){
  const fast = new Set(), slow = new Set(); let atrv = false;
  const add = (k, set) => {
    if (k === 'atrv') atrv = true;
    else if (CALC[k]) deps(k).forEach(d => add(d, set));
    else if (/^p[0-9A-F]{2}$/.test(k)) set.add(parseInt(k.slice(1), 16));
  };
  for (const c of engine.consumers.values()){ c.fast.forEach(k => add(k, fast)); c.keys.forEach(k => add(k, slow)); }
  const ok = p => (engine.dead.get(p) || 0) < 3 && (!state.pids?.size || state.pids.has(p)) && LEN[p] != null;
  return { fast: [...fast].filter(ok), slow: [...slow].filter(p => ok(p) && !fast.has(p)).sort((a, b) => a - b), atrv };
}
const isCan = () => /^[6-9]$/.test(String(state.proto || ''));

async function engineStart(){
  if (engine.running || !link || !engine.consumers.size) return;
  engine.running = true;
  try {
    if (!state.pids){
      state.pids = await supportedPids(s => emit('status', s)).catch(() => null);
      emit('status', '');
    }
    let it = 0, lastAtrv = 0, rateT = performance.now(), rateN = 0;
    engine.cycleT = performance.now();
    while (link && engine.consumers.size){
      const { fast, slow, atrv } = plan();
      if (!fast.length && !slow.length && !atrv){ await sleep(300); continue; }
      const groups = [];
      const takeSlow = n => {
        const out = [];
        for (let i = 0; i < Math.min(n, slow.length); i++){
          out.push(slow[engine.slowPos % slow.length]);
          if (++engine.slowPos >= slow.length){ engine.slowPos = 0; endCycle(); }
        }
        return out;
      };
      if (engine.multi !== false && isCan()){
        // CAN: os rápidos e até 2 lentos num pedido; sem rápidos, 6 lentos por pedido
        const s = takeSlow(fast.length ? Math.min(2, 6 - fast.length) : 6);
        const all = [...fast, ...s];
        for (let i = 0; i < all.length; i += 6) groups.push(all.slice(i, i + 6));
      } else {
        fast.forEach(p => groups.push([p]));
        // Com sondas em leitura rápida, um sensor lento a cada 3 voltas para não derrubar a taxa
        if (!fast.length || it % 3 === 0) takeSlow(1).forEach(p => groups.push([p]));
      }
      it++;
      for (const g of groups){ if (!link) break; rateN += await readGroup(g); }
      if (atrv && link && Date.now() - lastAtrv > 2000){
        lastAtrv = Date.now();
        try {
          const line = clean(await cmd('ATRV', 2000, true)).find(l => /^\d+([.,]\d+)?\s*V?$/i.test(l));
          if (line) store.set('atrv', parseFloat(line.replace(',', '.')));
        } catch {}
      }
      calcUpdate();
      const now = performance.now();
      if (now - rateT > 1000){ engine.rate = rateN * 1000 / (now - rateT); rateT = now; rateN = 0; }
      if (!slow.length && !fast.length) await sleep(500);
      else await sleep(document.hidden ? 0 : 5);
    }
  } catch (e) { log('⚠ Leitura: ' + e.message); }
  finally { engine.running = false; }
}
function endCycle(){
  const now = performance.now();
  emit('cycle', { seconds: (now - engine.cycleT) / 1000, rate: engine.rate });
  engine.cycleT = now;
}

// Lê um grupo de PIDs; devolve quantos valores chegaram
async function readGroup(ps){
  if (ps.length > 1 && engine.multi !== false && isCan()){
    try {
      const got = parseMulti(await cmd('01' + ps.map(hex2).join(''), 2500, true));
      if (got.size){
        engine.multi = true;
        for (const p of ps){
          if (got.has(p)) setPid(p, got.get(p));
          else markDead(p);
        }
        return got.size;
      }
      if (engine.multi == null){ engine.multi = false; log('Este carro não aceita vários PIDs por pedido. Lendo um por vez.'); }
    } catch (e) { if (engine.multi == null) engine.multi = false; }
  }
  let n = 0;
  for (const p of ps){
    if (!link) break;
    try {
      const b = await pid(hex2(p), 3000, true);
      if (b){ setPid(p, b); n++; } else markDead(p);
    } catch { markDead(p); }
  }
  return n;
}
function markDead(p){
  const c = (engine.dead.get(p) || 0) + 1;
  engine.dead.set(p, c);
  if (c === 3){ store.set('p' + hex2(p), null); log('Sensor ' + hex2(p) + ' (' + (PIDS[p]?.name || '?') + ') não respondeu 3 vezes. Deixei de ler.'); }
}
function setPid(p, b){
  engine.dead.delete(p);
  const v = fmtPid(p, b);
  store.set('p' + hex2(p), v == null ? null : num(v));
  // Sondas O2 de banda estreita: o byte B é o ajuste curto ligado àquela sonda (FF = não usado)
  if (p >= 0x14 && p <= 0x1B && b.length > 1 && b[1] !== 0xFF) store.set('o' + hex2(p), +((b[1] - 128) * 100 / 128).toFixed(1));
}

// Separa uma resposta "41 0C aa bb 0D cc 05 dd" (um ou vários quadros CAN) em PID → bytes
function parseMulti(lines){
  const msgs = [];
  let expect = 0;
  for (const raw of clean(lines)){
    const l = raw.replace(/\s/g, '').toUpperCase();
    const m = l.match(/^([0-9A-F]):([0-9A-F]+)$/);
    if (m){
      if (m[1] === '0' || !msgs.length) msgs.push({ h: m[2], len: expect });
      else msgs[msgs.length - 1].h += m[2];
      continue;
    }
    if (/^[0-9A-F]{3}$/.test(l)){ expect = parseInt(l, 16); continue; }
    if (/^[0-9A-F]+$/.test(l) && l.length % 2 === 0) msgs.push({ h: l, len: 0 });
  }
  const out = new Map();
  for (const { h, len } of msgs){
    let b = bytesOf(h);
    if (len) b = b.slice(0, len);   // corta o preenchimento do último quadro
    if (b[0] !== 0x41) continue;
    for (let i = 1; i < b.length;){
      const p = b[i], n = LEN[p];
      if (n == null || i + 1 + n > b.length) break;
      if (!out.has(p)) out.set(p, b.slice(i + 1, i + 1 + n));
      i += 1 + n;
    }
  }
  return out;
}

/* ---- Sensores calculados: consumo e viagem ---- */
// Combustível: AFR estequiométrico e densidade (g/L). Gasolina comum brasileira tem 27% de etanol anidro.
function fuelProps(){
  const v = cfg.vehicle;
  const GAS = { afr: 13.2, dens: 754 }, ETH = { afr: 8.4, dens: 809 };
  if (v.fuel === 'gas') return GAS;
  if (v.fuel === 'eth') return ETH;
  if (v.fuel === 'diesel') return { afr: 14.5, dens: 835 };
  const x = v.ethanol / 100;
  return { afr: GAS.afr + (ETH.afr - GAS.afr) * x, dens: GAS.dens + (ETH.dens - GAS.dens) * x };
}
let calcT = 0, tripSaveT = 0;
function calcUpdate(){
  const now = Date.now(), v = cfg.vehicle;
  let maf = fresh('p10');
  const map = fresh('p0B'), rpm = fresh('p0C');
  if (maf == null && map != null && rpm != null){
    // Densidade do ar no coletor (MAP + temperatura de admissão) × cilindrada × eficiência volumétrica
    const iat = fresh('p0F') ?? 30;
    maf = map * 1000 * (v.disp / 1000) * (v.ve / 100) / (287.05 * (iat + 273.15)) * rpm / 120 * 1000;
  }
  if (maf != null) store.set('c:maf', +maf.toFixed(2), now);
  let lph = fresh('p5E');
  if (lph == null && maf != null){
    const f = fuelProps();
    lph = maf / f.afr / f.dens * 3600 * v.corr / 100;
    // Corte de combustível na desaceleração: malha aberta, coletor em vácuo alto e giro acima da lenta
    const fs = fresh('p03');
    if (typeof fs === 'string' && /desacelera/.test(fs) && map != null && map < 30 && rpm > 1200) lph = 0;
    if (rpm === 0) lph = 0;
  }
  if (lph != null) store.set('c:lph', +lph.toFixed(2), now);
  const spd = fresh('p0D');
  if (spd != null && lph != null) store.set('c:kml', spd < 3 ? null : +Math.min(99.9, spd / Math.max(lph, 0.05)).toFixed(1), now);
  if (spd != null){
    const dt = (now - calcT) / 1000;
    if (calcT && dt > 0 && dt < 5){
      cfg.trip.km += spd * dt / 3600;
      if (lph != null) cfg.trip.L += lph * dt / 3600;
    }
    calcT = now;
    const t = cfg.trip;
    store.set('c:km', +t.km.toFixed(2), now);
    store.set('c:fuel', +t.L.toFixed(3), now);
    store.set('c:avg', t.L > 0.02 ? +(t.km / t.L).toFixed(1) : null, now);
    store.set('c:cost', +(t.L * v.price).toFixed(2), now);
    if (now - tripSaveT > 15000){ tripSaveT = now; saveCfg(); }
  }
}
function resetTrip(){
  cfg.trip = { km: 0, L: 0, since: Date.now() }; calcT = 0; saveCfg();
  ['c:km', 'c:fuel', 'c:cost'].forEach(k => store.set(k, 0)); store.set('c:avg', null);
}

addEventListener('disconnected', () => { engine.consumers.clear(); engine.dead.clear(); engine.multi = null; calcT = 0; saveCfg(); });
addEventListener('connected', () => { engine.dead.clear(); engine.multi = null; });
