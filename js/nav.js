/* ============ Navegação, conexão e compartilhar ============ */
// Barra de baixo com as 5 telas principais; Ferramentas abre as telas de diagnóstico, que ganham um
// "‹ Ferramentas" no topo. Qualquer elemento com data-go="tela" navega (data-at rola até um título).

document.addEventListener('click', e => {
  const b = e.target.closest('[data-go]'); if (!b) return;
  e.preventDefault(); go(b.dataset.go);
  if (b.dataset.at) requestAnimationFrame(() => $(b.dataset.at)?.scrollIntoView({ block: 'start' }));
});
document.querySelectorAll('section.tab[data-parent]').forEach(s => s.insertAdjacentHTML('afterbegin',
  '<div class="subhead"><button class="back" data-go="' + s.dataset.parent + '" aria-label="Voltar">‹</button><h2>' + esc(s.dataset.title) + '</h2></div>'));

/* ---- Conectar: um botão no topo; a forma de conexão fica numa folha que lembra a última usada ---- */
const CONN = { ble: connectBLE, serial: connectSerial, demo: async () => connectDemo() };
let lastConn = 'ble';
try { lastConn = localStorage.getItem('connLast') || 'ble'; } catch {}
$('btnConn').onclick = () => {
  if (link){ disconnect(); return; }
  document.querySelectorAll('#connDlg [data-m]').forEach(b => b.classList.toggle('primary', b.dataset.m === lastConn && !b.disabled));
  $('connDlg').showModal();
};
$('connDlg').addEventListener('click', e => {
  if (e.target === $('connDlg')){ $('connDlg').close(); return; }
  const b = e.target.closest('[data-m]'); if (!b || b.disabled) return;
  lastConn = b.dataset.m;
  try { localStorage.setItem('connLast', lastConn); } catch {}
  $('connDlg').close();
  connect(CONN[lastConn]);   // ainda dentro do toque: o Chrome exige isso para abrir a lista de Bluetooth
});
$('connClose').onclick = () => $('connDlg').close();

/* ---- Compartilhar: o JSON da tela atual ou o relatório completo, e "Perguntar à IA" ---- */
const SHARE = { painel: 'painel', viagens: 'viagens', falhas: 'falhas', sondas: 'sondas', vivo: 'sensores', tensao: 'tensao', ficha: 'ficha', log: 'log' };
let shareKey = 'tudo';
function shareScope(screenKey){
  const opts = (screenKey ? [[screenKey, 'Esta tela: ' + EXPORTS[screenKey][0]]] : []).concat([['tudo', 'Relatório completo']]);
  if (!opts.some(([k]) => k === shareKey)) shareKey = opts[0][0];
  $('shareScope').innerHTML = opts.map(([k, t]) => '<button class="chip" data-k="' + k + '" aria-pressed="' + (k === shareKey) + '">' + esc(t) + '</button>').join('');
}
$('btnShare').onclick = () => {
  const id = document.querySelector('section.tab.on')?.id;
  shareKey = SHARE[id] || 'tudo';
  shareScope(SHARE[id] && EXPORTS[SHARE[id]] ? SHARE[id] : null);
  $('shareOut').textContent = '';
  $('shareDlg').showModal();
};
$('shareScope').onclick = e => {
  const b = e.target.closest('[data-k]'); if (!b) return;
  shareKey = b.dataset.k;
  $('shareScope').querySelectorAll('[data-k]').forEach(x => x.setAttribute('aria-pressed', x === b));
};
$('shareBtns').onclick = e => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) exportAction(shareKey, a, $('shareOut')); };
$('shareClose').onclick = () => $('shareDlg').close();
$('shareDlg').addEventListener('click', e => { if (e.target === $('shareDlg')) $('shareDlg').close(); });

