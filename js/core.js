const $ = id => document.getElementById(id);
const enc = new TextEncoder(), dec = new TextDecoder();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const hex2 = n => n.toString(16).toUpperCase().padStart(2, '0');

/* ============ Ambiente ============ */
const env = { ble: false, serial: false };
function envCheck(){
  const pp = document.permissionsPolicy || document.featurePolicy;
  const allowed = f => { try { return pp ? pp.allowsFeature(f) : true; } catch { return true; } };
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  env.ble = !!navigator.bluetooth && allowed('bluetooth');
  env.serial = !!navigator.serial && allowed('serial');
  const msg = [];
  if (!isSecureContext) msg.push('A página precisa abrir em HTTPS (ou localhost) para acessar o Bluetooth.');
  if (ios && !navigator.bluetooth) msg.push('O Safari do iPhone e do iPad não tem Bluetooth na web. Use o navegador <b>Bluefy</b> (só com adaptador BLE), um Android ou um computador com Chrome.');
  else if (!navigator.bluetooth && !navigator.serial) msg.push('Este navegador não suporta Bluetooth na web. Use o <b>Chrome</b> ou o <b>Edge</b>.');
  else if (navigator.bluetooth && !allowed('bluetooth')) msg.push('O Bluetooth está bloqueado porque esta página está embutida em outra (iframe). Abra o link direto no Chrome, por exemplo pelo GitHub Pages.');
  $('banner').innerHTML = msg.map(m => '<p>' + m + '</p>').join('');
  setConnected(false);
}

/* ============ Transporte ============ */
const BLE_SERVICES = [0xffe0, 0xfff0, 0x18f0, 0xae30, 'e7810a71-73ae-499d-8c15-faa9aef0c3f2'];
const SPP = '00001101-0000-1000-8000-00805f9b34fb';

async function connectBLE(){
  const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES });
  log('Dispositivo escolhido: ' + (device.name || '(sem nome)'));
  const server = await device.gatt.connect();
  let services;
  try { services = await server.getPrimaryServices(); }
  catch { device.gatt.disconnect(); throw new Error('O dispositivo não expõe nenhum serviço serial conhecido (FFE0/FFF0/18F0). Pode ser Bluetooth clássico: tente “Serial”.'); }
  const gatt = []; let pick = null;
  for (const s of services){
    const chars = await s.getCharacteristics().catch(() => []);
    gatt.push({ servico: s.uuid, caracteristicas: chars.map(c => ({ uuid: c.uuid,
      props: ['read','write','writeWithoutResponse','notify','indicate'].filter(p => c.properties[p]).join(', ') })) });
    const n = chars.find(c => c.properties.notify || c.properties.indicate);
    const w = chars.find(c => c.properties.write || c.properties.writeWithoutResponse);
    if (!pick && n && w) pick = { n, w, s };
  }
  if (!pick){ device.gatt.disconnect(); throw new Error('Não encontrei uma característica de escrita e uma de notificação no mesmo serviço.'); }
  let cb = () => {};
  pick.n.addEventListener('characteristicvaluechanged', e => cb(dec.decode(e.target.value)));
  await pick.n.startNotifications();
  device.addEventListener('gattserverdisconnected', onLost);
  return {
    kind: 'BLE', name: device.name || '(sem nome)',
    meta: { 'ID no navegador': device.id, 'Serviço': pick.s.uuid, 'Característica de escrita': pick.w.uuid, 'Característica de notificação': pick.n.uuid },
    gatt,
    onData: f => cb = f,
    async send(str){
      const data = enc.encode(str);
      for (let i = 0; i < data.length; i += 20){
        const chunk = data.slice(i, i + 20);
        if (pick.w.properties.writeWithoutResponse) await pick.w.writeValueWithoutResponse(chunk);
        else await pick.w.writeValue(chunk);
      }
    },
    close(){ device.removeEventListener('gattserverdisconnected', onLost); if (device.gatt.connected) device.gatt.disconnect(); }
  };
}

async function connectSerial(){
  const port = await navigator.serial.requestPort({ allowedBluetoothServiceClassIds: [SPP] });
  await port.open({ baudRate: 38400 });
  const info = port.getInfo();
  const writer = port.writable.getWriter();
  const reader = port.readable.getReader();
  let cb = () => {}, alive = true;
  (async () => {
    try { while (alive){ const { value, done } = await reader.read(); if (done) break; cb(dec.decode(value)); } }
    catch {}
    if (alive) onLost();
  })();
  const meta = {};
  if (info.bluetoothServiceClassId) meta['Serviço Bluetooth'] = info.bluetoothServiceClassId;
  if (info.usbVendorId) meta['USB VID:PID'] = info.usbVendorId.toString(16).padStart(4,'0') + ':' + (info.usbProductId||0).toString(16).padStart(4,'0');
  meta['Baud rate'] = '38400 (ignorado no Bluetooth)';
  return {
    kind: 'Serial', name: info.bluetoothServiceClassId ? 'Bluetooth SPP' : 'Porta serial',
    meta, gatt: null,
    onData: f => cb = f,
    send: str => writer.write(enc.encode(str)),
    async close(){ alive = false; try { await reader.cancel(); } catch {} reader.releaseLock(); writer.releaseLock(); await port.close(); }
  };
}

/* ============ Protocolo ELM327 ============ */
let link = null, buf = '', pending = null, queue = Promise.resolve();
const state = { proto: null, pids: null };

function onData(chunk){
  buf += chunk;
  const i = buf.indexOf('>');
  if (i < 0 || !pending) return;
  const lines = buf.slice(0, i).split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
  buf = '';
  const p = pending; pending = null; p(lines);
}

// quiet: leituras contínuas do painel não vão para o log (seriam dezenas por segundo)
function rawCmd(c, timeout = 3000, quiet = false){
  return new Promise((resolve, reject) => {
    if (!link) return reject(new Error('Não conectado'));
    const t = setTimeout(() => { pending = null; reject(new Error('Sem resposta para ' + c)); }, timeout);
    const loud = !quiet || logPoll;
    pending = lines => {
      clearTimeout(t);
      lines = lines.filter(l => l.replace(/\s/g, '').toUpperCase() !== c.replace(/\s/g, '').toUpperCase());
      if (loud) log('← ' + (lines.join(' | ') || '(vazio)'));
      resolve(lines);
    };
    buf = '';
    if (loud) log('→ ' + c);
    link.send(c + '\r').catch(e => { clearTimeout(t); pending = null; reject(e); });
  });
}
// Serializa comandos: o ELM só processa um por vez
function cmd(c, timeout, quiet){ const p = queue.then(() => rawCmd(c, timeout, quiet)); queue = p.catch(() => {}); return p; }

const NOISE = /^(SEARCHING|BUS INIT)/i;
const ERR = /NO DATA|UNABLE TO CONNECT|CAN ERROR|BUS ERROR|BUS BUSY|FB ERROR|DATA ERROR|STOPPED|ERROR|^\?$/i;
const clean = lines => lines.filter(l => !NOISE.test(l));
const first = lines => clean(lines).filter(l => l !== 'OK')[0] || '—';
// Linhas de dados em hex; remove o índice "0:" de respostas CAN com vários quadros
const hexLines = lines => clean(lines).map(l => l.replace(/\s/g, '').toUpperCase().replace(/^[0-9A-F]:/, ''))
  .filter(l => /^[0-9A-F]+$/.test(l) && l.length % 2 === 0);
const bytesOf = h => (h.match(/../g) || []).map(x => parseInt(x, 16));

async function pidAll(p, timeout = 4000, quiet){
  const r = await cmd('01' + p, timeout, quiet);
  return hexLines(r).filter(h => h.startsWith('41' + p)).map(h => bytesOf(h.slice(4)));
}
async function pid(p, timeout, quiet){ return (await pidAll(p, timeout, quiet))[0] || null; }

async function initELM(){
  try { await cmd('ATZ', 5000); } catch (e) { log('⚠ ATZ sem resposta, seguindo mesmo assim'); }
  for (const c of ['ATE0', 'ATL0', 'ATS0', 'ATH0', 'ATSP0']) await cmd(c);
  const id = clean(await cmd('ATI')).find(l => /ELM|STN|OBD/i.test(l)) || '?';
  ficha.adaptador['Versão (ATI)'] = id;
  setStatus('on', link.name + ' · ' + id);
}

/* ============ UI geral ============ */
const logLines = []; let logPoll = false, logDirty = false;
function log(s){
  logLines.push(new Date().toLocaleTimeString() + '  ' + s);
  if (logLines.length > 3000) logLines.splice(0, 1000);
  // Agrupa as escritas no DOM: com leitura rápida chegam dezenas de linhas por segundo
  if (!logDirty){ logDirty = true; requestAnimationFrame(() => {
    logDirty = false; const el = $('logOut');
    el.textContent = logLines.slice(-600).join('\n') + '\n'; el.scrollTop = el.scrollHeight;
  }); }
}
function setStatus(kind, txt){ $('dot').className = 'dot ' + kind; $('statusTxt').textContent = txt; }
function setConnected(on){
  document.querySelectorAll('[data-conn]').forEach(b => b.disabled = !on);
  $('btnBle').disabled = on || !env.ble;
  $('btnSerial').disabled = on || !env.serial;
  $('btnDemo').disabled = on;
}
function download(name, text, type = 'text/plain'){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', x === b));
  document.querySelectorAll('section.tab').forEach(s => s.classList.toggle('on', s.id === b.dataset.tab));
  if (b.dataset.tab === 'tensao') draw();
  dispatchEvent(new CustomEvent('tab', { detail: b.dataset.tab }));
});
const tabOpen = id => $(id).classList.contains('on');

async function connect(fn){
  try {
    setStatus('busy', 'Conectando…');
    link = await fn(); link.onData(onData);
    ficha.conexao = { 'Transporte': link.kind, 'Nome': link.name, ...link.meta };
    ficha.gatt = link.gatt;
    log('Conectado: ' + link.kind + ' · ' + link.name);
    setConnected(true);
    await initELM();
    renderFicha();
    await doRead();
    dispatchEvent(new Event('connected'));
  } catch (e) {
    log('⚠ ' + e.message);
    if (!link) setStatus('', 'Desconectado');
    $('verdict').className = 'verdict bad'; $('verdict').textContent = e.message;
  }
}

async function disconnect(){
  stopLoops();
  const l = link; link = null;
  try { await l?.close(); } catch {}
  pending = null; buf = ''; queue = Promise.resolve();
  setConnected(false); setStatus('', 'Desconectado'); log('Desconectado');
  dispatchEvent(new Event('disconnected'));
}
function onLost(){ if (!link) return; log('⚠ Conexão perdida'); disconnect(); }
function stopLoops(){
  voltOn = false; $('btnLoop').textContent = 'Monitorar (1 s)';
  liveOn = false; $('btnLive').textContent = 'Iniciar leitura'; $('liveMode').disabled = false;
  rec = false; $('btnRec').textContent = 'Gravar CSV';
}

/* ============ Tensão ============ */
const samples = [], sampleTimes = []; let voltOn = false;

function classify(v){
  if (v < 11.8) return ['bad', 'Bateria descarregada ou leitura com falha'];
  if (v < 12.4) return ['warn', 'Motor desligado · bateria fraca'];
  if (v < 13.0) return ['ok', 'Motor desligado · bateria OK'];
  if (v < 13.5) return ['warn', 'Carga baixa ou bateria recém-carregada'];
  if (v <= 14.8) return ['ok', 'Motor ligado · alternador carregando OK'];
  return ['bad', 'Sobrecarga · verificar o regulador'];
}
async function readVoltage(){
  const line = clean(await cmd('ATRV')).find(l => /^\d+([.,]\d+)?\s*V?$/i.test(l));
  const v = line ? parseFloat(line.replace(',', '.')) : NaN;
  if (isNaN(v)) throw new Error('Resposta inesperada ao ATRV');
  return v;
}
function show(v){
  samples.push(v); sampleTimes.push(new Date().toLocaleTimeString());
  if (samples.length > 120){ samples.shift(); sampleTimes.shift(); }
  $('v').textContent = v.toFixed(1);
  const [cls, txt] = classify(v); $('verdict').className = 'verdict ' + cls; $('verdict').textContent = txt;
  const min = Math.min(...samples), max = Math.max(...samples), avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  $('min').textContent = min.toFixed(2); $('max').textContent = max.toFixed(2); $('avg').textContent = avg.toFixed(2);
  draw();
}
function draw(){
  const c = $('chart'); if (!c.clientWidth) return;
  const dpr = devicePixelRatio || 1;
  c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr;
  const g = c.getContext('2d'), W = c.width, H = c.height, lo = 10, hi = 16;
  const y = v => H - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo) * H;
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(76,195,138,.12)'; g.fillRect(0, y(14.8), W, y(13.5) - y(14.8));
  g.fillStyle = 'rgba(76,195,138,.06)'; g.fillRect(0, y(12.9), W, y(12.4) - y(12.9));
  if (samples.length < 2) return;
  g.strokeStyle = '#ffb000'; g.lineWidth = 2 * dpr; g.beginPath();
  samples.forEach((v, i) => { const x = i / (samples.length - 1) * W; i ? g.lineTo(x, y(v)) : g.moveTo(x, y(v)); });
  g.stroke();
}
async function doRead(){ try { show(await readVoltage()); } catch (e) { log('⚠ ' + e.message); } }
async function voltLoop(){ while (voltOn && link){ await doRead(); await sleep(1000); } }

$('btnRead').onclick = doRead;
$('btnLoop').onclick = () => {
  voltOn = !voltOn;
  $('btnLoop').textContent = voltOn ? 'Parar monitoramento' : 'Monitorar (1 s)';
  if (voltOn) voltLoop();
};
$('btnCal').onclick = async () => {
  const v = parseFloat($('calVal').value);
  if (!(v >= 5 && v <= 20)) { alert('Digite a tensão medida, entre 5 e 20 V (ex.: 12.62).'); return; }
  const r = first(await cmd('ATCV ' + String(Math.round(v * 100)).padStart(4, '0')).catch(e => [e.message]));
  alert(r === '?' ? 'Este adaptador não aceita ATCV (comum em clones).' : 'Resposta: ' + r);
  doRead();
};
$('btnCalReset').onclick = async () => { await cmd('ATCV 0000').catch(() => {}); doRead(); };

/* ============ Ficha ============ */
const ficha = { conexao: {}, adaptador: {}, veiculo: {}, monitores: {}, gatt: null };

const OBD_STD = {1:'OBD-II (CARB, EUA)',2:'OBD (EPA, EUA)',3:'OBD e OBD-II',4:'OBD-I',5:'Não é compatível com OBD',
  6:'EOBD (Europa)',7:'EOBD e OBD-II',8:'EOBD e OBD',9:'EOBD, OBD e OBD-II',10:'JOBD (Japão)',11:'JOBD e OBD-II',12:'JOBD e EOBD',13:'JOBD, EOBD e OBD-II',
  17:'EMD (diagnóstico do fabricante)',21:'WWH-OBD',28:'OBDBr-1 (Brasil, fase 1)',29:'OBDBr-2 (Brasil, fase 2)',30:'KOBD (Coreia)',31:'IOBD I (Índia)',32:'IOBD II (Índia)'};
const PROTO = {1:'SAE J1850 PWM',2:'SAE J1850 VPW',3:'ISO 9141-2',4:'ISO 14230-4 KWP (5 baud)',5:'ISO 14230-4 KWP (rápido)',
  6:'ISO 15765-4 CAN 11 bit 500k',7:'ISO 15765-4 CAN 29 bit 500k',8:'ISO 15765-4 CAN 11 bit 250k',9:'ISO 15765-4 CAN 29 bit 250k',A:'SAE J1939'};
const FUEL_SYS = {1:'Malha aberta (motor frio)',2:'Malha fechada (sonda ativa)',4:'Malha aberta (carga ou desaceleração)',8:'Malha aberta (falha)',16:'Malha fechada com falha na sonda'};
const FUEL_TYPE = {1:'Gasolina',2:'Metanol',3:'Etanol',4:'Diesel',5:'GLP',6:'GNV',8:'Elétrico',9:'Bicombustível (gasolina)',11:'Bicombustível (etanol)',16:'Híbrido gasolina',17:'Híbrido etanol',18:'Híbrido diesel',19:'Híbrido elétrico'};

/* Decodificação SAE J1979, modo 01. b = bytes A, B, C, D da resposta. */
const w16 = b => b[0] * 256 + b[1];
const s16 = b => { const v = w16(b); return v > 32767 ? v - 65536 : v; };
const pct = b => Math.round(b[0] * 100 / 255);
const trim = b => ((b[0] - 128) * 100 / 128).toFixed(1);
const lambda = b => (w16(b) * 2 / 65536).toFixed(3);
const temp = b => b[0] - 40;
const PIDS = {
  0x01:{ name:'Status do monitor / luz de injeção' },
  0x03:{ name:'Sistema de combustível', t:b => FUEL_SYS[b[0]] || 'código ' + b[0] },
  0x04:{ name:'Carga do motor', unit:'%', f:pct, ref:'15–35' },
  0x05:{ name:'Temperatura do motor', unit:'°C', f:temp, ref:'85–105' },
  0x06:{ name:'Ajuste curto B1', unit:'%', f:trim, ref:'−10 a +10' },
  0x07:{ name:'Ajuste longo B1', unit:'%', f:trim, ref:'−10 a +10' },
  0x08:{ name:'Ajuste curto B2', unit:'%', f:trim },
  0x09:{ name:'Ajuste longo B2', unit:'%', f:trim },
  0x0A:{ name:'Pressão de combustível', unit:'kPa', f:b => b[0] * 3 },
  0x0B:{ name:'Pressão do coletor (MAP)', unit:'kPa', f:b => b[0], ref:'25–45' },
  0x0C:{ name:'RPM', unit:'rpm', n:2, f:b => Math.round(w16(b) / 4), ref:'750–950' },
  0x0D:{ name:'Velocidade', unit:'km/h', f:b => b[0] },
  0x0E:{ name:'Avanço de ignição', unit:'°', f:b => (b[0] / 2 - 64).toFixed(1), ref:'5–20' },
  0x0F:{ name:'Temp. ar de admissão', unit:'°C', f:temp },
  0x10:{ name:'Fluxo de ar (MAF)', unit:'g/s', n:2, f:b => (w16(b) / 100).toFixed(2) },
  0x11:{ name:'Posição da borboleta', unit:'%', f:pct },
  0x13:{ name:'Sondas O2 instaladas', t:b => { const s = []; for (let i = 0; i < 8; i++) if (b[0] & (1 << i)) s.push('B' + (i < 4 ? 1 : 2) + 'S' + (i % 4 + 1)); return s.join(', ') || 'nenhuma'; } },
  0x1C:{ name:'Padrão OBD', t:b => OBD_STD[b[0]] || 'código ' + b[0] },
  0x1F:{ name:'Tempo desde a partida', unit:'s', n:2, f:w16 },
  0x21:{ name:'Distância com luz acesa', unit:'km', n:2, f:w16 },
  0x22:{ name:'Pressão do rail (rel. vácuo)', unit:'kPa', n:2, f:b => (w16(b) * 0.079).toFixed(1) },
  0x23:{ name:'Pressão do rail', unit:'kPa', n:2, f:b => w16(b) * 10 },
  0x2C:{ name:'EGR comandada', unit:'%', f:pct },
  0x2D:{ name:'Erro da EGR', unit:'%', f:trim },
  0x2E:{ name:'Purga do cânister', unit:'%', f:pct },
  0x2F:{ name:'Nível de combustível', unit:'%', f:pct },
  0x30:{ name:'Aquecimentos desde a limpeza', unit:'', f:b => b[0] },
  0x31:{ name:'Distância desde a limpeza', unit:'km', n:2, f:w16 },
  0x32:{ name:'Pressão do EVAP', unit:'Pa', n:2, f:b => (s16(b) / 4).toFixed(0) },
  0x33:{ name:'Pressão barométrica', unit:'kPa', f:b => b[0] },
  0x3C:{ name:'Temp. catalisador B1S1', unit:'°C', n:2, f:b => Math.round(w16(b) / 10 - 40) },
  0x3D:{ name:'Temp. catalisador B2S1', unit:'°C', n:2, f:b => Math.round(w16(b) / 10 - 40) },
  0x3E:{ name:'Temp. catalisador B1S2', unit:'°C', n:2, f:b => Math.round(w16(b) / 10 - 40) },
  0x3F:{ name:'Temp. catalisador B2S2', unit:'°C', n:2, f:b => Math.round(w16(b) / 10 - 40) },
  0x42:{ name:'Tensão da ECU', unit:'V', n:2, f:b => (w16(b) / 1000).toFixed(2), ref:'13,5–14,8' },
  0x43:{ name:'Carga absoluta', unit:'%', n:2, f:b => Math.round(w16(b) * 100 / 255) },
  0x44:{ name:'Lambda comandado', unit:'λ', n:2, f:lambda },
  0x45:{ name:'Borboleta relativa', unit:'%', f:pct },
  0x46:{ name:'Temperatura ambiente', unit:'°C', f:temp },
  0x47:{ name:'Borboleta absoluta B', unit:'%', f:pct },
  0x48:{ name:'Borboleta absoluta C', unit:'%', f:pct },
  0x49:{ name:'Pedal do acelerador D', unit:'%', f:pct },
  0x4A:{ name:'Pedal do acelerador E', unit:'%', f:pct },
  0x4B:{ name:'Pedal do acelerador F', unit:'%', f:pct },
  0x4C:{ name:'Borboleta comandada', unit:'%', f:pct },
  0x4D:{ name:'Tempo com luz acesa', unit:'min', n:2, f:w16 },
  0x4E:{ name:'Tempo desde a limpeza', unit:'min', n:2, f:w16 },
  0x51:{ name:'Tipo de combustível', t:b => FUEL_TYPE[b[0]] || 'código ' + b[0] },
  0x52:{ name:'Etanol no tanque', unit:'%', f:pct },
  0x53:{ name:'Pressão absoluta do EVAP', unit:'kPa', n:2, f:b => (w16(b) / 200).toFixed(2) },
  0x54:{ name:'Pressão do EVAP (ampla)', unit:'Pa', n:2, f:s16 },
  0x55:{ name:'Ajuste curto sonda 2 · B1', unit:'%', f:trim },
  0x56:{ name:'Ajuste longo sonda 2 · B1', unit:'%', f:trim },
  0x57:{ name:'Ajuste curto sonda 2 · B2', unit:'%', f:trim },
  0x58:{ name:'Ajuste longo sonda 2 · B2', unit:'%', f:trim },
  0x59:{ name:'Pressão absoluta do rail', unit:'kPa', n:2, f:b => w16(b) * 10 },
  0x5A:{ name:'Pedal relativo', unit:'%', f:pct },
  0x5B:{ name:'Bateria híbrida', unit:'%', f:pct },
  0x5C:{ name:'Temperatura do óleo', unit:'°C', f:temp },
  0x5D:{ name:'Ponto de injeção', unit:'°', n:2, f:b => (w16(b) / 128 - 210).toFixed(1) },
  0x5E:{ name:'Consumo', unit:'L/h', n:2, f:b => (w16(b) / 20).toFixed(1) },
};
['B1S1','B1S2','B1S3','B1S4','B2S1','B2S2','B2S3','B2S4'].forEach((s, i) => {
  PIDS[0x14 + i] = { name:'Sonda O2 ' + s, unit:'V', f:b => (b[0] / 200).toFixed(3), ref: i === 0 ? 'oscila 0,1–0,9' : i === 1 ? '0,5–0,8 estável' : undefined };
  PIDS[0x24 + i] = { name:'Sonda larga ' + s, unit:'λ', n:2, f:lambda };
  PIDS[0x34 + i] = { name:'Sonda larga ' + s + ' (corrente)', unit:'λ', n:2, f:lambda };
});
function fmtPid(p, b){
  const d = PIDS[p];
  if (!d || !b || b.length < (d.n || 1)) return null;
  return d.t ? d.t(b) : d.f ? d.f(b) : null;
}

// Tenta o automático; se o clone não achar, testa protocolo por protocolo
async function detectProtocol(info = () => {}){
  const ok = async t => {
    if (!(await pidAll('00', t).catch(() => [])).length) return false;
    state.proto = first(await cmd('ATDPN')).replace(/^A/i, '');
    return true;
  };
  await cmd('ATSP0');
  info('Detectando protocolo (automático)…');
  if (await ok(15000)) return true;
  for (const p of ['6', '5', '4', '3', '7', '8', '9']){
    info('Automático falhou. Tentando protocolo ' + p + '…');
    await cmd('ATSP' + p);
    if (await ok(8000)) return true;
  }
  await cmd('ATSP0');
  return false;
}

async function supportedPids(info){
  const set = new Set();
  if (!(await detectProtocol(info))) return set;
  for (let base = 0; base <= 0xA0; base += 0x20){
    const all = await pidAll(hex2(base), 4000).catch(() => []);
    if (!all.length) break;
    for (const b of all) for (let i = 0; i < 32; i++) if (b[i >> 3] & (0x80 >> (i & 7))) set.add(base + i + 1);
    if (!set.has(base + 0x20)) break;
  }
  return set;
}

function readiness(b){
  const [, B, C, D] = b, rows = [];
  const add = (name, avail, incomplete) => { if (avail) rows.push([name, incomplete ? 'incompleto' : 'pronto']); };
  add('Falha de combustão', B & 1, B & 0x10);
  add('Sistema de combustível', B & 2, B & 0x20);
  add('Componentes', B & 4, B & 0x40);
  if (!(B & 0x08)){
    ['Catalisador','Catalisador aquecido','Sistema evaporativo (EVAP)','Ar secundário','Ar-condicionado','Sonda lambda','Aquecimento da sonda','EGR']
      .forEach((n, i) => add(n, C & (1 << i), D & (1 << i)));
  }
  return rows;
}

function ascii09(lines, mid){
  const out = [];
  for (let h of hexLines(lines)){
    if (h.startsWith('49' + mid)) h = h.slice(6);
    for (const x of bytesOf(h)) if (x >= 0x20 && x < 0x7F) out.push(String.fromCharCode(x));
  }
  return out.join('').trim() || null;
}

function decodeVIN(lines){
  const b = bytesOf(hexLines(lines).join(''));
  const out = [];
  for (let k = 0; k < b.length; k++){
    // 0x49 ('I') nunca aparece num VIN, então marca o início de "49 02 nn"
    if (b[k] === 0x49 && b[k + 1] === 0x02){ k += 2; continue; }
    const ch = String.fromCharCode(b[k]);
    if (/[A-HJ-NPR-Z0-9]/.test(ch)) out.push(ch);
  }
  return out.length >= 17 ? out.slice(-17).join('') : null;
}

async function gerarFicha(){
  const btn = $('btnFicha'); btn.disabled = true;
  const A = ficha.adaptador, V = ficha.veiculo;
  const step = async (label, fn) => {
    $('fichaStep').textContent = label + '…';
    try { await fn(); } catch (e) { log('⚠ ' + label + ': ' + e.message); }
    renderFicha();
  };
  await step('Versão', async () => { A['Versão (ATI)'] = first(await cmd('ATI')); });
  await step('Descrição', async () => { A['Descrição (AT@1)'] = first(await cmd('AT@1')); });
  await step('Identificador', async () => { const r = first(await cmd('AT@2')); A['Identificador (AT@2)'] = r === '?' ? 'não suportado' : r; });
  await step('Chip STN', async () => { const r = first(await cmd('STI')); A['Chip STN (STI)'] = r === '?' ? 'não (ELM327 ou clone)' : r; });
  await step('Tensão', async () => { A['Tensão no pino 16 (ATRV)'] = first(await cmd('ATRV')); });
  let pbOk = null;
  await step('Teste de firmware', async () => { pbOk = first(await cmd('ATPB C0 01')) === 'OK'; });
  {
    const ver = (A['Versão (ATI)'] || '').match(/v(\d+\.\d+)/i)?.[1];
    let verdict = 'Indeterminado';
    if (ver === '1.5') verdict = 'Provável clone: a Elm Electronics nunca lançou a versão 1.5';
    else if (pbOk === false && ver && parseFloat(ver) >= 1.4) verdict = 'Provável clone: diz ser v' + ver + ', mas recusa ATPB (comando da v1.4)';
    else if (pbOk) verdict = 'Aceita os comandos da v1.4 · firmware coerente com a versão';
    A['Original ou clone?'] = verdict;
  }
  await step('Detectando protocolo do carro (pode levar até 15 s)', async () => {
    state.pids = await supportedPids(s => $('fichaStep').textContent = s);
    state.proto = first(await cmd('ATDPN')).replace(/^A/i, '');
    const dp = first(await cmd('ATDP')).replace(/^AUTO,?\s*/i, '');
    V['Protocolo'] = dp && dp !== '—' ? dp : PROTO[state.proto] || '?';
    V['Protocolo (nº ELM)'] = state.proto;
    V['PIDs suportados'] = state.pids.size ? state.pids.size + ' (lista abaixo)' : 'nenhum: chave em ON?';
  });
  if (state.pids?.size){
    await step('Luz de injeção', async () => {
      const b = await pid('01'); if (!b) return;
      V['Luz de injeção (MIL)'] = (b[0] & 0x80) ? 'ACESA' : 'apagada';
      V['Códigos armazenados'] = b[0] & 0x7F;
      diag.luzInjecao = V['Luz de injeção (MIL)']; diag.qtdCodigos = b[0] & 0x7F;
      if (b.length >= 4) ficha.monitores = Object.fromEntries(readiness(b));
    });
    for (const [p, label] of [[0x1C, 'Padrão OBD'], [0x51, 'Combustível'], [0x03, 'Sistema de combustível'], [0x13, 'Sondas O2 instaladas']])
      if (state.pids.has(p)) await step(label, async () => { const v = fmtPid(p, await pid(hex2(p))); if (v != null) V[label] = v; });
    await step('Calibração da ECU', async () => { const s = ascii09(await cmd('0904', 8000), '04'); if (s) V['Calibração (0904)'] = s; });
    await step('Nome da ECU', async () => { const s = ascii09(await cmd('090A', 8000), '0A'); if (s) V['Nome da ECU (090A)'] = s; });
    await step('Chassi (VIN)', async () => { const r = await cmd('0902', 8000); V['Chassi (VIN)'] = decodeVIN(r) || 'não informado pelo carro'; });
  }
  $('fichaStep').textContent = 'Ficha pronta · ' + new Date().toLocaleString();
  btn.disabled = !link;
}

function renderFicha(){
  const sec = (t, o) => o && Object.keys(o).length
    ? '<h3>' + t + '</h3><dl class="kv">' + Object.entries(o).map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('') + '</dl>' : '';
  let html = sec('Conexão', ficha.conexao) + sec('Adaptador', ficha.adaptador) + sec('Veículo', ficha.veiculo) + sec('Monitores de prontidão', ficha.monitores);
  if (state.pids?.size){
    html += '<h3>PIDs suportados pelo carro</h3><div class="tw"><table>' +
      [...state.pids].filter(p => p % 0x20).sort((a, b) => a - b)
        .map(p => '<tr><td><code>01' + hex2(p) + '</code></td><td>' + esc(PIDS[p]?.name || '—') + '</td></tr>').join('') + '</table></div>';
  }
  if (ficha.gatt?.length){
    html += '<h3>Serviços Bluetooth (GATT)</h3><pre>' + esc(ficha.gatt.map(s =>
      s.servico + '\n' + s.caracteristicas.map(c => '  └ ' + c.uuid + '  [' + c.props + ']').join('\n')).join('\n\n')) + '</pre>';
  }
  $('fichaOut').innerHTML = html || '<div class="empty">Conecte e toque em “Gerar ficha completa”.</div>';
}
$('btnFicha').onclick = gerarFicha;

/* ============ Ao vivo ============ */
// A leitura em si fica no motor (engine.js); esta aba só registra o que quer ler e desenha os blocos.
const MAIN = [0x0C, 0x0D, 0x05, 0x04, 0x0B, 0x0E, 0x11, 0x0F, 0x06, 0x07, 0x14, 0x15, 0x03, 0x42, 0x2F, 0x52];
function liveList(){
  const known = state.pids?.size ? state.pids : null;
  const base = $('liveMode').value === 'all' && known ? [...known] : MAIN;
  return base.filter(p => p !== 0x01 && PIDS[p] && (PIDS[p].f || PIDS[p].t) && (!known || known.has(p))).sort((a, b) => a - b);
}
function buildTiles(list){
  $('tiles').innerHTML = list.map(p => { const d = PIDS[p];
    return '<div class="tile" id="t' + hex2(p) + '"><span>' + esc(d.name) + '</span><b>--</b><span>' + (d.unit || '') + '</span>' +
      (d.ref ? '<small>ref.: ' + d.ref + '</small>' : '') +
      (d.f ? '<button class="tadd" data-add="' + hex2(p) + '" aria-label="Adicionar ' + esc(d.name) + ' ao painel" title="Adicionar ao painel">＋</button>' : '') + '</div>'; }).join('');
}
function setTile(p, val, na){
  const t = $('t' + hex2(p)); if (!t) return;
  t.classList.toggle('na', !!na);
  t.classList.toggle('txt', !na && PIDS[p].t != null);
  t.querySelector('b').textContent = val;
}
$('tiles').onclick = e => {
  const b = e.target.closest('[data-add]'); if (!b) return;
  dashAddSensor('p' + b.dataset.add);
  b.textContent = '✓'; setTimeout(() => b.textContent = '＋', 1200);
};

let liveOn = false, rec = false, lastAt = null, cycleSum = 0, cycleN = 0;
const lastVals = {};
const csv = { cols: [], rows: [] };
function csvLabel(){ $('btnCsv').textContent = 'Baixar CSV (' + csv.rows.length + ' linhas)'; $('btnCsv').disabled = !csv.rows.length; }

async function liveStart(){
  const info = s => $('liveInfo').textContent = s;
  $('liveMode').disabled = true;
  if (!state.pids) state.pids = await supportedPids(info).catch(() => null);
  if (!liveOn) return;
  const list = liveList();
  if (list.join() !== csv.cols.join()){ csv.cols = list; csv.rows = []; csvLabel(); }
  buildTiles(list);
  list.forEach(p => { const s = store.get('p' + hex2(p)); if (s) setTile(p, s.v ?? 'n/s', s.v == null); });
  info(state.pids?.size ? list.length + ' sensores' : 'O carro não respondeu à lista de PIDs. Tentando os principais mesmo assim.');
  need('sensores', list.map(p => 'p' + hex2(p)));
}
engineOn('value', (k, v) => {
  if (k[0] !== 'p' || k.length !== 3) return;
  const p = parseInt(k.slice(1), 16);
  lastVals[p] = v;
  if (liveOn) setTile(p, v ?? 'n/s', v == null);
});
engineOn('cycle', s => {
  if (!liveOn) return;
  lastAt = new Date().toLocaleTimeString(); cycleSum += s.seconds; cycleN++;
  if (rec){ csv.rows.push([lastAt, ...csv.cols.map(p => lastVals[p] ?? '')]); csvLabel(); }
  $('liveInfo').textContent = csv.cols.length + ' sensores · ciclo de ' + s.seconds.toFixed(1) + ' s · ' + s.rate.toFixed(1) + ' leituras/s' + (rec ? ' · gravando' : '');
});
$('btnLive').onclick = () => {
  liveOn = !liveOn;
  $('btnLive').textContent = liveOn ? 'Parar leitura' : 'Iniciar leitura';
  if (liveOn) liveStart(); else { release('sensores'); $('liveMode').disabled = false; }
};
$('btnRec').onclick = () => {
  rec = !rec;
  $('btnRec').textContent = rec ? 'Parar gravação' : 'Gravar CSV';
  if (rec && !liveOn) $('btnLive').click();
};
$('btnCsv').onclick = () => {
  // ; e vírgula decimal para abrir direto no Excel em português
  const head = ['Hora', ...csv.cols.map(p => PIDS[p].name + (PIDS[p].unit ? ' (' + PIDS[p].unit + ')' : ''))];
  const q = v => /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  const body = csv.rows.map(r => r.map(v => q(String(v).replace(/^(-?\d+)\.(\d+)$/, '$1,$2'))).join(';'));
  download('sensores-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.csv', '﻿' + [head.map(q).join(';'), ...body].join('\n'), 'text/csv');
};

/* ============ Falhas (DTC) ============ */
const diag = { luzInjecao: null, qtdCodigos: null, armazenados: null, pendentes: null, monitores: null, congelamento: null };
function decodeDTC(hi, lo){
  const n = (hi << 8) | lo; if (!n) return null;
  return 'PCBU'[n >> 14] + ((n >> 12) & 3) + (n & 0xFFF).toString(16).toUpperCase().padStart(3, '0');
}
function dtcInfo(code){
  const sys = { P:'Motor e câmbio', C:'Chassi', B:'Carroceria', U:'Rede de comunicação' }[code[0]];
  const kind = code[1] === '0' ? 'genérico' : code[1] === '1' ? 'da montadora' : 'misto';
  const sub = code[0] === 'P' && '01'.includes(code[1]) ? ({1:'ar/combustível',2:'ar/combustível (injetores)',3:'ignição / falha de combustão',4:'emissões',5:'velocidade / marcha lenta',6:'ECU / saídas',7:'câmbio',8:'câmbio',9:'câmbio'})[code[2]] : '';
  return [sys, kind, sub].filter(Boolean).join(' · ');
}
async function readDTC(mode){
  const resp = (parseInt(mode, 16) + 0x40).toString(16).toUpperCase();
  await ensurePids();
  const r = await cmd(mode, 10000);
  const isCan = /^[6-9A-C]$/i.test(state.proto || '') || hexLines(r).some(h => h.startsWith(resp) && h.length % 4 === 0);
  // Agrupa em mensagens: uma linha começando com 43/47 abre uma nova (uma por ECU)
  const msgs = [];
  for (const h of hexLines(r)){ if (h.startsWith(resp)) msgs.push(h); else if (msgs.length) msgs[msgs.length - 1] += h; }
  const codes = new Set();
  for (const m of msgs){
    const b = bytesOf(m);
    const start = isCan ? 2 : 1, count = isCan ? b[1] : Infinity;
    for (let i = start, k = 0; i + 1 < b.length && k < count; i += 2, k++){ const c = decodeDTC(b[i], b[i + 1]); if (c) codes.add(c); }
  }
  diag[mode === '03' ? 'armazenados' : 'pendentes'] = [...codes].map(c => ({ codigo: c, tipo: dtcInfo(c) }));
  const title = mode === '03' ? 'Códigos armazenados' : 'Códigos pendentes';
  $('dtcOut').innerHTML = '<h3>' + title + '</h3>' + (codes.size
    ? [...codes].map(c => '<div class="dtc"><b>' + c + '</b><span class="small">' + esc(dtcInfo(c)) + '</span>' +
        '<a href="https://www.google.com/search?q=' + c + '+OBD2" target="_blank" rel="noopener">pesquisar</a></div>').join('')
    : '<div class="empty">Nenhum código ' + (mode === '03' ? 'armazenado' : 'pendente') + '. 👍</div>');
}
$('btnDtc').onclick = () => readDTC('03').catch(e => log('⚠ ' + e.message));
$('btnDtcPend').onclick = () => readDTC('07').catch(e => log('⚠ ' + e.message));
$('btnDtcClear').onclick = async () => {
  if (!confirm('Apagar os códigos de falha?\n\nIsso apaga a luz de injeção e zera os monitores de prontidão. O defeito continua lá: se não for resolvido, a luz volta a acender.\n\nFaça com a chave em ON e o motor DESLIGADO.')) return;
  const r = first(await cmd('04', 10000).catch(e => [e.message]));
  alert(ERR.test(r) ? 'O carro recusou: ' + r : 'Códigos apagados.');
  $('dtcOut').innerHTML = '<div class="empty">Códigos apagados. Leia de novo para conferir.</div>';
};

async function ensurePids(){
  if (!state.pids) state.pids = await supportedPids(s => $('dtcOut').innerHTML = '<div class="empty">' + esc(s) + '</div>');
  return state.pids;
}
async function readMonitors(){
  await ensurePids();
  const b = await pid('01');
  if (!b || b.length < 4){ $('dtcOut').innerHTML = '<div class="empty">O carro não informou os monitores.</div>'; return; }
  const rows = readiness(b);
  ficha.monitores = diag.monitores = Object.fromEntries(rows);
  diag.luzInjecao = b[0] & 0x80 ? 'ACESA' : 'apagada'; diag.qtdCodigos = b[0] & 0x7F;
  $('dtcOut').innerHTML = '<h3>Monitores de prontidão</h3>' +
    '<div class="mon"><span>Luz de injeção</span><b class="' + (b[0] & 0x80 ? 'warn">ACESA' : 'ok">apagada') + '</b></div>' +
    rows.map(([n, s]) => '<div class="mon"><span>' + n + '</span><b class="' + (s === 'pronto' ? 'ok' : 'warn') + '">' + s + '</b></div>').join('') +
    '<p class="small muted">“Incompleto” é normal logo depois de apagar códigos ou desligar a bateria. A ECU termina os testes depois de alguns dias rodando.</p>';
}
const FREEZE = [0x03, 0x04, 0x05, 0x06, 0x07, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F, 0x11, 0x42];
async function readFreeze(){
  const pids = await ensurePids();
  const get = async p => {
    const key = '42' + hex2(p);
    const h = hexLines(await cmd('02' + hex2(p) + '00', 5000)).find(x => x.startsWith(key));
    return h ? bytesOf(h.slice(6)) : null;
  };
  const d = await get(0x02);
  const dtc = d && d.length >= 2 ? decodeDTC(d[0], d[1]) : null;
  diag.congelamento = dtc ? { codigo: dtc } : 'nenhum';
  if (!dtc){ $('dtcOut').innerHTML = '<div class="empty">Nenhum congelamento salvo (não há falha registrada).</div>'; return; }
  const rows = [];
  for (const p of FREEZE){
    if (pids?.size && !pids.has(p)) continue;
    const v = fmtPid(p, await get(p).catch(() => null));
    if (v != null) rows.push([PIDS[p].name, v + (PIDS[p].unit ? ' ' + PIDS[p].unit : '')]);
  }
  diag.congelamento.sensores = Object.fromEntries(rows);
  $('dtcOut').innerHTML = '<h3>Congelamento da falha ' + dtc + '</h3>' +
    '<p class="small muted">Retrato dos sensores no instante em que a falha foi registrada.</p>' +
    '<dl class="kv">' + rows.map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('') + '</dl>';
}
$('btnMon').onclick = () => readMonitors().catch(e => log('⚠ ' + e.message));
$('btnFreeze').onclick = () => readFreeze().catch(e => log('⚠ ' + e.message));

/* ============ Referência: pinagem ============ */
const PINS = {
  1:['oem','Livre para a montadora'], 2:['j1850','SAE J1850 Bus +'], 3:['oem','Livre para a montadora'],
  4:['gnd','Terra do chassi'], 5:['gnd','Terra de sinal'], 6:['can','CAN High (ISO 15765-4)'],
  7:['kl','Linha K (ISO 9141-2 / KWP2000)'], 8:['oem','Livre para a montadora'], 9:['oem','Livre para a montadora'],
  10:['j1850','SAE J1850 Bus −'], 11:['oem','Livre para a montadora'], 12:['oem','Livre para a montadora'],
  13:['oem','Livre para a montadora'], 14:['can','CAN Low (ISO 15765-4)'], 15:['kl','Linha L (ISO 9141-2 / KWP2000)'],
  16:['pwr','+12 V da bateria (sempre ligado) · é o que o ATRV mede']
};
const PIN_COLOR = { pwr:'var(--bad)', gnd:'var(--gray)', can:'var(--lcd)', kl:'var(--ok)', j1850:'var(--blue)', oem:'var(--panel)' };
$('pins').innerHTML = Object.entries(PINS).map(([n, [t, d]]) => {
  n = +n; const x = 50 + ((n - 1) % 8) * 40, y = n <= 8 ? 55 : 112;
  return '<g><title>Pino ' + n + ': ' + d + '</title><circle cx="' + x + '" cy="' + y + '" r="15" fill="' + PIN_COLOR[t] +
    '" stroke="var(--line)" stroke-width="2"/><text x="' + x + '" y="' + y + '"' + (t === 'oem' ? ' class="oem"' : '') + '>' + n + '</text></g>';
}).join('');
$('pinTable').innerHTML = '<tr><th>Pino</th><th>Função</th></tr>' + Object.entries(PINS).filter(([, [t]]) => t !== 'oem')
  .map(([n, [t, d]]) => '<tr><td><b style="color:' + PIN_COLOR[t] + '">' + n + '</b></td><td>' + d + '</td></tr>').join('') +
  '<tr><td class="muted">1, 3, 8, 9, 11–13</td><td class="muted">Livres para a montadora (diagnóstico próprio da marca)</td></tr>';

/* ============ Log / manual ============ */
$('btnLogClr').onclick = () => { logLines.length = 0; $('logOut').textContent = ''; };
$('logPoll').onchange = e => logPoll = e.target.checked;
async function sendManual(){
  const c = $('manCmd').value.trim().toUpperCase(); if (!c) return;
  await cmd(c, 10000).catch(e => log('⚠ ' + e.message));
  $('manCmd').select();
}
$('btnMan').onclick = sendManual;
$('manCmd').addEventListener('keydown', e => { if (e.key === 'Enter' && link) sendManual(); });

/* ============ Exportar JSON / Perguntar à IA ============ */
const num = v => typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
const label = p => PIDS[p].name + (PIDS[p].unit ? ' (' + PIDS[p].unit + ')' : '');
function stats(arr){
  const n = arr.filter(x => typeof x === 'number');
  if (!n.length) return null;
  return { min: Math.min(...n), media: +(n.reduce((a, b) => a + b, 0) / n.length).toFixed(3), max: Math.max(...n), amostras: n.length };
}
const fichaData = () => ({
  ...ficha,
  pidsSuportados: state.pids ? [...state.pids].filter(p => p % 0x20).sort((a, b) => a - b).map(p => ({ pid: '01' + hex2(p), nome: PIDS[p]?.name || null })) : null
});
function sensoresData(){
  const rows = csv.rows.map(r => r.map(v => v === '' ? null : num(v)));
  const last = Object.entries(lastVals);
  return {
    cicloMedio_s: cycleN ? +(cycleSum / cycleN).toFixed(1) : null,
    ultimaLeitura: last.length ? { hora: lastAt, valores: Object.fromEntries(last.map(([p, v]) => [label(p), v == null ? 'não suportado' : num(v)])) } : null,
    gravacao: rows.length ? {
      referencias: Object.fromEntries(csv.cols.filter(p => PIDS[p].ref).map(p => [label(p), PIDS[p].ref])),
      colunas: ['Hora', ...csv.cols.map(label)],
      resumo: Object.fromEntries(csv.cols.map((p, i) => [label(p), stats(rows.map(r => r[i + 1]))]).filter(([, s]) => s)),
      linhas: rows
    } : null
  };
}
const tensaoData = () => ({
  unidade: 'V', resumo: stats(samples),
  colunas: ['Hora', 'Tensão (V)'], linhas: samples.map((v, i) => [sampleTimes[i], v])
});
const EXPORTS = {
  tensao: ['Tensão da bateria (ATRV)', tensaoData],
  ficha: ['Ficha do adaptador e do veículo', fichaData],
  sensores: ['Sensores ao vivo (OBD-II modo 01)', sensoresData],
  falhas: ['Códigos de falha, monitores e congelamento', () => diag],
  log: ['Log de comunicação com o ELM327', () => ({ linhas: logLines })],
  tudo: ['Relatório completo', () => ({ ficha: fichaData(), falhas: diag, sensores: sensoresData(), tensao: tensaoData() })]
};
function pack(k){
  const [titulo, fn] = EXPORTS[k];
  return {
    app: 'ELM327 Scanner', conteudo: titulo, geradoEm: new Date().toISOString(),
    veiculo: $('carName').value.trim() || null,
    adaptador: ficha.adaptador['Versão (ATI)'] || null,
    protocolo: ficha.veiculo['Protocolo'] || PROTO[state.proto] || null,
    dados: fn()
  };
}
function aiPrompt(k){
  const p = pack(k);
  return 'Você é um mecânico especialista em injeção eletrônica e diagnóstico OBD-II. ' +
    'Analise os dados abaixo, lidos com um adaptador ELM327 pelo OBD-II genérico' + (p.veiculo ? ' de um ' + p.veiculo : '') + '.\n\n' +
    'Responda em português, de forma objetiva:\n' +
    '1. O que está normal\n2. O que está fora do esperado, citando os valores\n' +
    '3. Causas prováveis, da mais para a menos provável\n4. Que teste fazer para confirmar antes de trocar peças\n\n' +
    'Cuidados: o OBD genérico só enxerga a central do motor. Os sensores são lidos um por vez (veja cicloMedio_s), ' +
    'então não tire conclusões sobre a velocidade de resposta de um sensor mais rápido que esse intervalo. ' +
    'Se faltar algum dado para concluir, diga qual leitura devo fazer.\n\n' +
    'Dados (JSON):\n' + JSON.stringify(p);
}
async function copyText(t){ try { await navigator.clipboard.writeText(t); return true; } catch { return false; } }
const AIS = [['ChatGPT', 'https://chatgpt.com/?q=', true], ['Claude', 'https://claude.ai/new?q=', true], ['Gemini', 'https://gemini.google.com/app', false]];
async function exportAction(k, action, out){
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  if (action === 'dl'){ download('elm327-' + k + '-' + stamp + '.json', JSON.stringify(pack(k), null, 2), 'application/json'); return; }
  if (action === 'copy'){
    out.textContent = await copyText(JSON.stringify(pack(k))) ? 'JSON copiado.' : 'Não consegui copiar. Use “Baixar JSON”.';
    return;
  }
  const text = aiPrompt(k);
  // No celular, a folha de compartilhar abre direto o app do ChatGPT, Gemini ou Claude
  if (navigator.share && matchMedia('(pointer: coarse)').matches){
    try { await navigator.share({ text }); out.textContent = ''; return; }
    catch (e){ if (e.name === 'AbortError') return; }
  }
  const copied = await copyText(text);
  const fits = encodeURIComponent(text).length <= 8000;
  if (!copied && !fits) download('pergunta-ia-' + stamp + '.txt', text);
  out.innerHTML = (copied ? 'Pergunta e dados copiados. ' : !fits ? 'Baixei a pergunta em .txt. ' : '') +
    'Abra uma IA' + (fits ? '' : ' e cole o texto') + ': ' +
    AIS.map(([n, u, q]) => '<a target="_blank" rel="noopener" href="' + esc(u + (q && fits ? encodeURIComponent(text) : '')) + '">' + n + '</a>' +
      (fits && !q ? ' (cole o texto)' : '')).join(' · ');
}
document.querySelectorAll('[data-export]').forEach(el => {
  const k = el.dataset.export, out = document.createElement('p');
  out.className = 'xout'; out.setAttribute('aria-live', 'polite');
  el.after(out);
  el.innerHTML = '<button data-a="copy">Copiar JSON</button><button data-a="dl">Baixar JSON</button><button data-a="ai" class="ai">Perguntar à IA</button>';
  el.onclick = e => { const a = e.target.closest('button')?.dataset.a; if (a) exportAction(k, a, out); };
});
try { const saved = localStorage.getItem('carName'); if (saved) $('carName').value = saved; } catch {}
$('carName').addEventListener('change', () => { try { localStorage.setItem('carName', $('carName').value); } catch {} });

