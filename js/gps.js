/* ============ GPS do celular: distância e velocidade ============ */
// A velocidade do OBD (PID 0D) vem do sensor do câmbio e costuma marcar alguns % a mais
// (o velocímetro é calibrado para nunca marcar menos). O GPS mede o caminho de verdade,
// então dá a distância — e as médias de consumo por km — mais próximas do real.
// Para não somar o "passeio" do ponto GPS com o carro parado, só conta deslocamento quando:
//  · a precisão do ponto é boa (≤ GPS_ACC m), e
//  · o próprio GPS diz que está andando (speed ≥ 1 m/s) ou o ponto se afastou mais que a precisão.
const GPS_ACC = 25;
const gps = { on: false, id: null, anchor: null, fix: null, msg: 'GPS desligado' };

function haversine(a, b){
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function gpsFix(p){
  const c = p.coords, now = Date.now();
  const pt = { lat: c.latitude, lon: c.longitude, acc: c.accuracy, t: p.timestamp || now };
  gps.fix = pt;
  store.set('c:gacc', Math.round(c.accuracy), now);
  if (c.accuracy > GPS_ACC){ gps.msg = 'Sinal fraco (±' + Math.round(c.accuracy) + ' m): distância pausada'; gpsUi(); return; }
  gps.msg = 'GPS ok (±' + Math.round(c.accuracy) + ' m)';
  const a = gps.anchor;
  if (!a){ gps.anchor = pt; gpsUi(); return; }
  const d = haversine(a, pt), dt = (pt.t - a.t) / 1000;
  if (dt <= 0){ gpsUi(); return; }
  const v = c.speed != null && !isNaN(c.speed) ? c.speed : d / dt;   // m/s
  store.set('c:gspd', v < 0.5 ? 0 : +(v * 3.6).toFixed(1), now);
  if (d / dt > 70){ gps.anchor = pt; gps.msg = 'Salto do GPS ignorado'; gpsUi(); return; }   // > 250 km/h: ponto errado
  const moving = (c.speed != null && c.speed >= 1) || d > Math.max(pt.acc, a.acc);
  if (moving){
    cfg.trip.kmGps += d / 1000;
    gps.anchor = pt;
    tripUpdate(now);
  } else if (dt > 30) gps.anchor = { ...a, t: pt.t };   // parado: mantém o ponto, só atualiza a hora
  gpsUi();
}
function gpsErr(e){
  gps.msg = e.code === 1 ? 'Permissão de localização negada. Libere em Configurações → Apps → Chrome → Permissões → Localização (precisa ser “precisa”).'
    : e.code === 2 ? 'Sem sinal de GPS. Ligue a Localização do celular.' : 'GPS demorou para responder, tentando de novo…';
  if (e.code === 1) gpsStop();
  gpsUi();
}
function gpsStart(){
  if (gps.on) return;
  if (!navigator.geolocation){ gps.msg = 'Este navegador não tem GPS.'; gpsUi(); return; }
  gps.on = true; gps.anchor = null; gps.msg = 'Procurando satélites…';
  gps.id = navigator.geolocation.watchPosition(gpsFix, gpsErr, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  gpsUi();
}
function gpsStop(){
  if (gps.id != null) navigator.geolocation.clearWatch(gps.id);
  gps.on = false; gps.id = null; gps.anchor = null;
  if (!/Permissão/.test(gps.msg)) gps.msg = 'GPS desligado';
  store.set('c:gspd', null); gpsUi();
}
function gpsUi(){
  for (const id of ['btnGps2']){
    const b = $(id); if (!b) continue;
    b.textContent = gps.on ? '📍 GPS: ligado' : '📍 Ligar GPS';
    b.classList.toggle('on', gps.on); b.setAttribute('aria-pressed', gps.on);
  }
  const m = $('gpsMsg'); if (m) m.textContent = gps.msg;
}
function bindGps(){
  const toggle = () => gps.on ? gpsStop() : gpsStart();
  $('btnGps2').onclick = toggle;
  gpsUi();
}
