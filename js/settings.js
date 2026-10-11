/* ============ Ajustes ============ */
function bindVehicle(){
  const v = cfg.vehicle;
  const fields = [['vDisp', 'disp', 0.5, 8], ['vVe', 've', 40, 120], ['vEth', 'ethanol', 0, 100], ['vPrice', 'price', 0, 100], ['vCorr', 'corr', 50, 200]];
  for (const [id, key, lo, hi] of fields){
    $(id).value = v[key];
    $(id).onchange = e => { v[key] = numIn(parseFloat(String(e.target.value).replace(',', '.')), lo, hi, v[key]); e.target.value = v[key]; saveCfg(); tripShow(); };
  }
  $('vFuel').value = v.fuel;
  $('vEthRow').hidden = v.fuel !== 'mix';
  $('vFuel').onchange = e => { v.fuel = oneOf(e.target.value, FUELS, 'mix'); $('vEthRow').hidden = v.fuel !== 'mix'; saveCfg(); };
  $('vDist').value = v.dist;
  $('vDist').onchange = e => {
    v.dist = oneOf(e.target.value, DISTS, 'obd');
    // Novo hodômetro: o km em andamento recomeça para não misturar as duas fontes
    cfg.trip.segKm = tripKm(); cfg.trip.segL = cfg.trip.L;
    if (v.dist === 'gps') gpsStart();
    saveCfg(); tripUpdate(); tripShow(); dashNeed();
  };
  $('btnTripReset').onclick = () => { if (confirm('Zerar a distância, o combustível e o custo da viagem?')){ resetTrip(); tripShow(); } };
  // Calibração pelo posto: encha o tanque, zere a viagem, rode, encha de novo e informe os litros
  $('btnCalib').onclick = () => {
    const real = parseFloat(String($('vReal').value).replace(',', '.'));
    if (!(real > 0) || cfg.trip.L < 0.5){ alert('Rode pelo menos meio litro estimado e informe quantos litros entraram no posto.'); return; }
    const nc = numIn(v.corr * real / cfg.trip.L, 50, 200, v.corr);
    if (!confirm('O app estimou ' + cfg.trip.L.toFixed(2) + ' L e o posto marcou ' + real.toFixed(2) + ' L.\nAjustar o fator de ' + v.corr.toFixed(0) + '% para ' + nc.toFixed(0) + '%?')) return;
    v.corr = +nc.toFixed(1); $('vCorr').value = v.corr; saveCfg();
  };
  tripShow();
}
setInterval(() => tabOpen('ajustes') && tripShow(), 3000);
addEventListener('tab', e => { if (e.detail === 'ajustes') tripShow(); });
const FUEL_SRC = { ecu: 'taxa de combustível informada pela ECU (PID 5E)', maf: 'sensor de fluxo de ar (MAF) + mistura estequiométrica',
  map: 'estimativa pela pressão do coletor, giro, temperatura do ar, cilindrada e eficiência volumétrica (speed-density)' };
function tripShow(){
  const t = cfg.trip, km = tripKm(), dist = cfg.vehicle.dist === 'gps' ? 'GPS' : 'OBD';
  const cell = (v, u) => '<div><b>' + v + '</b><span>' + u + '</span></div>';
  $('tripOut').innerHTML =
    cell(km.toFixed(1), 'km (' + dist + ')') + cell(t.L.toFixed(2), 'litros') +
    cell(t.L > 0.02 && km >= 0.1 ? (km / t.L).toFixed(1) : '--', 'km/L') + cell((t.L * cfg.vehicle.price).toFixed(2), 'R$');
  const diff = t.kmObd > 1 && t.kmGps > 1 ? ' · OBD marcou ' + ((t.kmObd / t.kmGps - 1) * 100).toFixed(1).replace('-0.0', '0.0') + '% em relação ao GPS' : '';
  $('tripSince').textContent = 'Desde ' + new Date(t.since).toLocaleString() + ' · OBD ' + t.kmObd.toFixed(2) + ' km · GPS ' + t.kmGps.toFixed(2) + ' km' + diff;
  $('fuelSrc').textContent = fuelSrc ? 'Litros calculados por: ' + FUEL_SRC[fuelSrc] + (fuelSrc === 'ecu' ? '.' : '. É uma estimativa até você calibrar pelo posto.') : 'Litros: aguardando leitura do motor.';
  // Um trecho por km percorrido, do mais recente para o mais antigo
  const segs = t.segs.slice(-60).reverse();
  $('segOut').innerHTML = segs.length ? '<tr><th>km</th><th>litros</th><th>km/L</th><th>fonte</th><th>hora</th></tr>' + segs.map(g =>
    '<tr><td>' + g.km.toFixed(1) + '</td><td>' + g.L.toFixed(3) + '</td><td>' + (g.L > 0.001 ? (g.d / g.L).toFixed(1) : '--') + '</td><td>' + g.src.toUpperCase() +
    '</td><td>' + new Date(g.t).toLocaleTimeString() + '</td></tr>').join('') : '<tr><td class="muted">Nenhum km completo ainda.</td></tr>';
}

/* ---- Backup: levar tudo para outro aparelho ---- */
const backupData = () => ({ app: 'ELM327 Scanner', tipo: 'backup', versao: 1, geradoEm: new Date().toISOString(), carro: $('carName').value, config: cfg });
function importBackup(txt){
  let o;
  try { o = JSON.parse(txt); } catch { alert('Arquivo inválido: não é um JSON.'); return; }
  if (!isObj(o) || o.app !== 'ELM327 Scanner' || o.tipo !== 'backup' || !isObj(o.config)){ alert('Este arquivo não é um backup do ELM327 Scanner.'); return; }
  const c = sanitizeCfg(o.config);
  const nw = c.pages.reduce((a, p) => a + p.w.length, 0);
  if (!confirm('Substituir as configurações deste aparelho pelas do backup?\n\n' + c.pages.length + ' páginas, ' + nw + ' mostradores, ' +
    Object.keys(c.alerts).length + ' alertas e a viagem (' + (c.vehicle.dist === 'gps' ? c.trip.kmGps : c.trip.kmObd).toFixed(1) + ' km).')) return;
  cfg = c;
  const name = str(o.carro, 80);
  if (name){ $('carName').value = name; try { localStorage.setItem('carName', name); } catch {} }
  saveCfg(); refreshAll();
  alert('Backup importado.');
}
function bindBackup(){
  const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  $('btnBkDl').onclick = () => download('elm327-backup-' + stamp() + '.json', JSON.stringify(backupData(), null, 2), 'application/json');
  $('btnBkCopy').onclick = async () => { $('bkMsg').textContent = await copyText(JSON.stringify(backupData())) ? 'Backup copiado. Cole no outro aparelho em “Colar backup”.' : 'Não consegui copiar.'; };
  $('bkFile').onchange = async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (f.size > 2e6){ alert('Arquivo grande demais para ser um backup (máx. 2 MB).'); return; }
    importBackup(await f.text());
  };
  $('btnBkPaste').onclick = () => { const t = $('bkText').value.trim(); if (t.length > 2e6){ alert('Texto grande demais.'); return; } if (t) importBackup(t); };
  $('btnBkReset').onclick = () => {
    if (!confirm('Apagar painéis, alertas, viagem e preferências deste aparelho e voltar ao padrão?')) return;
    try { localStorage.removeItem(CFG_KEY); } catch {}
    cfg = defaultCfg(); saveCfg(); refreshAll();
  };
}
function refreshAll(){
  alertState.clear(); renderAlertBar();
  bindVehicle(); renderAlertList(); syncAlertOpts(); bindOutsideSettings(); lamSync(); renderCars(); renderRuns(); setMode(cfg.simple);
  renderDash(); dashNeed(); outsideNeed();
}

/* ---- Instalar como app ---- */
let installEvt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('btnInstall').hidden = false; });
$('btnInstall').onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice.catch(() => {}); installEvt = null; $('btnInstall').hidden = true; };
