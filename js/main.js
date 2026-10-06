/* ============ Início ============ */
$('btnBle').onclick = () => connect(connectBLE);
$('btnSerial').onclick = () => connect(connectSerial);
$('btnDemo').onclick = () => connect(async () => connectDemo());
$('btnOff').onclick = disconnect;
addEventListener('resize', draw);

// Exportações novas (as das abas antigas ficam em core.js)
EXPORTS.painel = ['Painel e alertas', () => ({
  pagina: page().name,
  valores: Object.fromEntries(page().w.map(w => { const d = sensorDef(w.k); return [d ? d.name + (d.unit ? ' (' + d.unit + ')' : '') : w.k, fresh(w.k, 15000)]; })),
  viagem: { km: +cfg.trip.km.toFixed(2), litros: +cfg.trip.L.toFixed(3), kmPorLitro: cfg.trip.L > 0.02 ? +(cfg.trip.km / cfg.trip.L).toFixed(1) : null, desde: new Date(cfg.trip.since).toISOString() },
  alertasConfigurados: Object.fromEntries(Object.entries(cfg.alerts).map(([k, a]) => [sensorDef(k)?.name || k, a])),
  alertasDisparados: alertLog.slice(0, 50)
})];
EXPORTS.tudo[1] = (orig => () => ({ ...orig(), sondas: sondasData(), painel: EXPORTS.painel[1]() }))(EXPORTS.tudo[1]);

envCheck();
draw();
bindVehicle(); bindAlertList(); renderAlertList(); bindOutsideSettings(); lamBindCtl(); bindBackup();
renderDash();

if ('serviceWorker' in navigator && isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});
