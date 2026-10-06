/* ============ Alertas por sensor ============ */
// Dispara quando o valor fica fora do limite por "delay" segundos seguidos e só volta ao normal
// depois de entrar de novo na faixa com uma folga (histerese), para não ficar piscando no limite.
const alertState = new Map();   // chave → { kind: 'low'|'high'|null, since, fired, acked }
const alertLog = [];
let audioCtx = null, beepT = null;

const alertActive = k => !!alertState.get(k)?.fired;

engineOn('value', (k, v) => {
  const a = cfg.alerts[k];
  if (!a?.on || typeof v !== 'number') return;
  const d = sensorDef(k); if (!d) return;
  const hyst = (d.r[1] - d.r[0]) * 0.015;
  let s = alertState.get(k);
  if (!s){ s = { kind: null, since: 0, fired: false, acked: false }; alertState.set(k, s); }
  const kind = a.min != null && v < a.min ? 'low' : a.max != null && v > a.max ? 'high' : null;
  const now = Date.now();
  if (kind){
    if (s.kind !== kind){ s.kind = kind; s.since = now; }
    if (!s.fired && now - s.since >= cfg.alertOpt.delay * 1000){ s.fired = true; s.acked = false; fireAlert(k, d, a, kind, v); }
    if (s.fired) s.last = v;
  } else if (s.kind){
    const back = s.kind === 'low' ? v >= a.min + hyst : v <= a.max - hyst;
    if (back || !s.fired){
      if (s.fired) logAlert(d.name + ' voltou ao normal: ' + fmtV(v, d.d) + ' ' + d.unit);
      s.kind = null; s.fired = false;
      renderAlertBar();
    }
  }
});

function alertText(d, a, kind, v){
  return d.name + (kind === 'low' ? ' baixa' : ' alta') + ': ' + fmtV(v, d.d) + ' ' + d.unit +
    ' (limite ' + (kind === 'low' ? 'mín. ' + a.min : 'máx. ' + a.max) + ')';
}
function fireAlert(k, d, a, kind, v){
  const txt = alertText(d, a, kind, v);
  logAlert('⚠ ' + txt);
  renderAlertBar();
  if (cfg.alertOpt.vibrate) navigator.vibrate?.([250, 120, 250, 120, 400]);
  if (cfg.alertOpt.sound) beep();
  if (cfg.alertOpt.notify) notify('Alerta: ' + d.name, txt, 'alert-' + k, true);
  scheduleBeep();
}
function logAlert(t){
  alertLog.unshift({ hora: new Date().toLocaleString(), texto: t });
  if (alertLog.length > 200) alertLog.length = 200;
  log(t);
  if ($('alertLogOut')) renderAlertLog();
}

// Repete o bipe a cada 8 s enquanto houver alerta não silenciado
function scheduleBeep(){
  clearInterval(beepT);
  beepT = setInterval(() => {
    const live = [...alertState.values()].some(s => s.fired && !s.acked);
    if (!live){ clearInterval(beepT); return; }
    if (cfg.alertOpt.sound) beep();
    if (cfg.alertOpt.vibrate) navigator.vibrate?.([200, 100, 200]);
  }, 8000);
}

function renderAlertBar(){
  const fired = [...alertState.entries()].filter(([, s]) => s.fired);
  const bar = $('alertBar');
  if (!fired.length){ bar.hidden = true; bar.innerHTML = ''; return; }
  bar.hidden = false;
  bar.innerHTML = '<div class="alist">' + fired.map(([k, s]) => {
    const d = sensorDef(k), a = cfg.alerts[k];
    return '<div>⚠ ' + esc(alertText(d, a, s.kind, s.last ?? fresh(k) ?? 0)) + '</div>';
  }).join('') + '</div><button id="btnAck">Silenciar</button>';
  $('btnAck').onclick = () => { fired.forEach(([, s]) => s.acked = true); clearInterval(beepT); bar.classList.add('acked'); };
  bar.classList.toggle('acked', fired.every(([, s]) => s.acked));
}

/* ---- Som (Web Audio: dois tons, sem arquivo) ---- */
function unlockAudio(){
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch {}
}
addEventListener('pointerdown', unlockAudio, { once: true });
function beep(){
  unlockAudio(); if (!audioCtx) return;
  const t = audioCtx.currentTime;
  [[880, 0], [660, 0.18], [880, 0.36]].forEach(([f, at]) => {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = 'square'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t + at); g.gain.exponentialRampToValueAtTime(0.25, t + at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.16);
    o.connect(g).connect(audioCtx.destination); o.start(t + at); o.stop(t + at + 0.17);
  });
}

/* ---- Notificação do sistema (aparece na tela bloqueada no Android) ---- */
async function notify(title, body, tag, loud){
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  const opt = { body, tag, icon: 'icon.svg', badge: 'icon.svg', silent: !loud, renotify: !!loud,
    requireInteraction: !!loud, vibrate: loud ? [250, 120, 250] : undefined, data: { url: location.href } };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg){ await reg.showNotification(title, opt); return true; }
    new Notification(title, opt); return true;
  } catch { return false; }
}

/* ---- Lista de alertas (aba Ajustes) ---- */
function renderAlertList(){
  const el = $('alertList'); if (!el) return;
  const rows = Object.entries(cfg.alerts).filter(([k]) => sensorDef(k));
  el.innerHTML = rows.length ? '<div class="tw"><table><tr><th>Ativo</th><th>Sensor</th><th>Mín.</th><th>Máx.</th><th></th></tr>' + rows.map(([k, a]) => {
    const d = sensorDef(k);
    return '<tr data-k="' + k + '"><td><input type="checkbox" data-f="on"' + (a.on ? ' checked' : '') + ' aria-label="Alerta ativo"></td>' +
      '<td>' + esc(d.name) + (d.unit ? ' <span class="muted">(' + esc(d.unit) + ')</span>' : '') + '</td>' +
      '<td><input type="number" step="any" class="num" data-f="min" value="' + (a.min ?? '') + '" aria-label="Mínimo"></td>' +
      '<td><input type="number" step="any" class="num" data-f="max" value="' + (a.max ?? '') + '" aria-label="Máximo"></td>' +
      '<td><button class="mini" data-f="del" aria-label="Remover alerta">✕</button></td></tr>';
  }).join('') + '</table></div>' : '<div class="empty">Nenhum alerta configurado.</div>';
}
function bindAlertList(){
  $('alertList').addEventListener('change', e => {
    const tr = e.target.closest('tr[data-k]'); if (!tr) return;
    const k = tr.dataset.k, a = cfg.alerts[k], f = e.target.dataset.f;
    if (f === 'on') a.on = e.target.checked;
    if (f === 'min' || f === 'max') a[f] = optInput(e.target);
    if (a.min == null && a.max == null) delete cfg.alerts[k];
    alertState.delete(k); renderAlertBar(); saveCfg(); dashNeed();
  });
  $('alertList').addEventListener('click', e => {
    const b = e.target.closest('[data-f="del"]'); if (!b) return;
    const k = b.closest('tr').dataset.k; delete cfg.alerts[k]; alertState.delete(k);
    saveCfg(); renderAlertList(); renderAlertBar(); dashNeed();
  });
  $('aNewSensor').innerHTML = sensorList().filter(d => !d.text).map(d => '<option value="' + d.key + '">' + esc(d.name + (d.unit ? ' (' + d.unit + ')' : '')) + '</option>').join('');
  $('btnANew').onclick = () => {
    const k = $('aNewSensor').value, min = optInput($('aNewMin')), max = optInput($('aNewMax'));
    if (!KEY_RE.test(k) || (min == null && max == null)){ alert('Informe o mínimo, o máximo ou os dois.'); return; }
    cfg.alerts[k] = { on: true, min, max }; alertState.delete(k);
    $('aNewMin').value = $('aNewMax').value = '';
    saveCfg(); renderAlertList(); dashNeed();
  };
  for (const f of ['sound', 'vibrate', 'notify']) $('ao_' + f).onchange = e => { cfg.alertOpt[f] = e.target.checked; saveCfg(); };
  syncAlertOpts();
  $('ao_delay').onchange = e => { cfg.alertOpt.delay = numIn(parseFloat(e.target.value), 0, 30, 2); e.target.value = cfg.alertOpt.delay; saveCfg(); };
  $('btnNotifPerm').onclick = async () => {
    if (!('Notification' in window)){ alert('Este navegador não tem notificações.'); return; }
    const r = await Notification.requestPermission();
    notifPermLabel();
    if (r === 'granted') notify('ELM327 Scanner', 'Notificações ativadas. Os alertas vão aparecer aqui, inclusive com a tela bloqueada.', 'test', false);
  };
  $('btnATest').onclick = () => { unlockAudio(); beep(); navigator.vibrate?.([250, 120, 250]); notify('Teste de alerta', 'Assim o alerta aparece no celular.', 'test', true); };
  $('btnALogClr').onclick = () => { alertLog.length = 0; renderAlertLog(); };
  notifPermLabel(); renderAlertLog();
}
function syncAlertOpts(){
  for (const f of ['sound', 'vibrate', 'notify']) $('ao_' + f).checked = cfg.alertOpt[f];
  $('ao_delay').value = cfg.alertOpt.delay;
}
function notifPermLabel(){
  const p = 'Notification' in window ? Notification.permission : 'unsupported';
  $('notifPerm').textContent = { granted: 'permitidas', denied: 'bloqueadas (libere nas configurações do site)', default: 'ainda não permitidas', unsupported: 'não suportadas neste navegador' }[p];
  $('btnNotifPerm').hidden = p !== 'default';
}
function renderAlertLog(){
  $('alertLogOut').innerHTML = alertLog.length ? alertLog.slice(0, 50).map(a => '<div class="mon"><span>' + esc(a.texto) + '</span><b class="small muted">' + esc(a.hora) + '</b></div>').join('')
    : '<div class="empty">Nenhum alerta disparado nesta sessão.</div>';
}
