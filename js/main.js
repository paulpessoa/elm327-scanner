/* ============ Início ============ */
addEventListener('resize', draw);

// Exportações novas (as das abas antigas ficam em core.js)
EXPORTS.painel = ['Painel e alertas', () => ({
  pagina: page().name,
  valores: Object.fromEntries(page().w.map(w => { const d = sensorDef(w.k); return [d ? d.name + (d.unit ? ' (' + d.unit + ')' : '') : w.k, fresh(w.k, 15000)]; })),
  viagem: viagemData(),
  alertasConfigurados: Object.fromEntries(Object.entries(cfg.alerts).map(([k, a]) => [sensorDef(k)?.name || k, a])),
  alertasDisparados: alertLog.slice(0, 50)
})];
EXPORTS.tudo[1] = (orig => () => ({ ...orig(), carro: carData(), manutencao: maintData(), viagens: EXPORTS.viagens[1](), sondas: sondasData(), painel: EXPORTS.painel[1](),
  vistoria: insp.data ? EXPORTS.vistoria[1]() : null }))(EXPORTS.tudo[1]);
function viagemData(){
  const t = cfg.trip, km = tripKm();
  return {
    fonteDaDistancia: cfg.vehicle.dist === 'gps' ? 'GPS do celular' : 'velocidade do OBD (PID 0D)',
    origemDosLitros: fuelSrc ? FUEL_SRC[fuelSrc] : null, fatorDeCorrecao_pct: cfg.vehicle.corr,
    km: +km.toFixed(2), kmPeloOBD: +t.kmObd.toFixed(2), kmPeloGPS: +t.kmGps.toFixed(2), litros: +t.L.toFixed(3),
    kmPorLitro: t.L > 0.02 && km >= 0.1 ? +(km / t.L).toFixed(1) : null, litrosPor100km: t.L > 0 && km >= 0.5 ? +(t.L / km * 100).toFixed(1) : null,
    desde: new Date(t.since).toISOString(),
    porKm: { colunas: ['km', 'litros', 'km/L', 'fonte'], linhas: t.segs.map(g => [g.km, g.L, g.L > 0.001 ? +(g.d / g.L).toFixed(1) : null, g.src]) }
  };
}

envCheck();
draw();
bindVehicle(); bindAlertList(); renderAlertList(); bindOutsideSettings(); lamBindCtl(); bindBackup(); bindGps(); bindCars(); bindRuns(); bindMaint(); setMode(cfg.simple);
if (cfg.vehicle.dist === 'gps') gpsStart();
renderDash();
showTab(location.hash.slice(1));

if ('serviceWorker' in navigator && isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});
