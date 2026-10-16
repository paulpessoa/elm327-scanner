/* ============ Sensor de movimento do celular: força lateral nas curvas ============ */
// O OBD sabe de aceleração e frenagem (pela variação da velocidade), mas não sabe de curva.
// Com o celular preso no suporte, o acelerômetro mede a aceleração no plano do chão; tirando dela
// a parte de frente/trás (que a velocidade do OBD já dá), sobra a lateral:
//   lateral = √(horizontal² − longitudinal²)
// Assim não é preciso saber em que posição o celular está preso, só que ele não se mexa.
// O resultado vai para o store como 'c:glat' (em g); trips.js conta as curvas fortes.
const MOT_LP = 0.6;        // s: suavização da aceleração (tira a vibração do suporte)
const MOT_SPD_MS = 1500;   // janela da velocidade para a aceleração longitudinal
const mot = { on: false, h: null, g: null, lastT: 0, pubT: 0, got: false, msg: '' };

function motionHandler(e){
  const now = performance.now(), dt = mot.lastT ? Math.min(0.2, (now - mot.lastT) / 1000) : 0;
  mot.lastT = now;
  const ig = e.accelerationIncludingGravity, a = e.acceleration;
  if (!ig || ig.x == null) return;
  mot.got = true;
  const vig = [ig.x, ig.y, ig.z];
  let lin, grav;
  if (a && a.x != null){
    // O sistema já separa a gravidade (com o giroscópio): mais preciso
    lin = [a.x, a.y, a.z]; grav = vig.map((v, i) => v - lin[i]);
  } else {
    // Sem giroscópio: a gravidade é a média lenta da aceleração total
    mot.g ||= vig.slice();
    const k = Math.min(1, dt / 5);
    mot.g = mot.g.map((v, i) => v + (vig[i] - v) * k);
    grav = mot.g; lin = vig.map((v, i) => v - grav[i]);
  }
  const gn = Math.hypot(...grav); if (gn < 5) return;   // celular em queda livre ou leitura ruim
  const u = grav.map(v => v / gn), dot = lin[0] * u[0] + lin[1] * u[1] + lin[2] * u[2];
  const hor = lin.map((v, i) => v - dot * u[i]);   // parte da aceleração no plano do chão
  // Suaviza o vetor (não o tamanho): a vibração se anula em vez de somar
  mot.h ||= hor.slice();
  const k = Math.min(1, dt / MOT_LP);
  mot.h = mot.h.map((v, i) => v + (hor[i] - v) * k);
  if (now - mot.pubT < 100) return;   // 10 valores por segundo bastam
  mot.pubT = now;
  const along = longAccel();
  const t = Date.now();
  if (along == null){ store.set('c:glat', null, t); return; }
  const h2 = mot.h[0] ** 2 + mot.h[1] ** 2 + mot.h[2] ** 2;
  store.set('c:glat', +(Math.sqrt(Math.max(0, h2 - along * along)) / 9.81).toFixed(2), t);
}
// Aceleração para frente/trás (m/s²) pela velocidade do carro: inclinação da reta nos últimos 1,5 s
function longAccel(){
  const key = fresh('p0D', 3000) != null ? 'p0D' : fresh('c:gspd', 3000) != null ? 'c:gspd' : null;
  if (!key) return null;
  const { t, v } = store.since(key, MOT_SPD_MS);
  if (t.length < 2) return 0;
  let st = 0, sv = 0, stt = 0, stv = 0; const n = t.length, t0 = t[0];
  for (let i = 0; i < n; i++){ const x = (t[i] - t0) / 1000, y = v[i] / 3.6; st += x; sv += y; stt += x * x; stv += x * y; }
  const den = n * stt - st * st;
  return den > 1e-6 ? (n * stv - st * sv) / den : 0;
}

function motionStart(){
  if (mot.on) return;
  if (!('DeviceMotionEvent' in window)){ motionMsg('Este navegador não tem sensor de movimento.'); return; }
  mot.on = true; mot.h = null; mot.g = null; mot.lastT = 0; mot.got = false;
  addEventListener('devicemotion', motionHandler);
  motionMsg('Medindo curvas. Deixe o celular firme no suporte.');
  setTimeout(() => { if (mot.on && !mot.got) motionMsg('Este aparelho não enviou dados de movimento (computador ou sensor bloqueado).'); }, 4000);
}
function motionStop(){
  if (!mot.on) return;
  mot.on = false;
  removeEventListener('devicemotion', motionHandler);
  store.set('c:glat', null);
  motionMsg('');
}
function motionMsg(s){ mot.msg = s; const el = $('motMsg'); if (el) el.textContent = s; }
// Liga e desliga pela opção de Viagens. O iPhone só libera o sensor depois de perguntar, dentro de um toque.
async function motionToggle(on){
  if (on && typeof window.DeviceMotionEvent?.requestPermission === 'function'){
    try { if (await DeviceMotionEvent.requestPermission() !== 'granted'){ on = false; motionMsg('Permissão do sensor de movimento negada.'); } }
    catch { on = false; }
  }
  cfg.runOpt.motion = on; saveCfg();
  $('runMotion').checked = on;
  if (on && link) motionStart(); else motionStop();
}
addEventListener('connected', () => { if (cfg.runOpt.motion) motionStart(); });
addEventListener('disconnected', motionStop);
