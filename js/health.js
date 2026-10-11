/* ============ Saúde do carro: falhas ao conectar e modo simples ============ */

/* ---- Códigos genéricos mais comuns, em português simples (definições SAE J2012) ---- */
// [faixa inicial, faixa final, texto, nível, conselho]
const MISFIRE = 'Motor falhando. Evite acelerar forte e procure um mecânico logo: a falha de combustão pode estragar o catalisador.';
const DTC_PLAIN = [
  ['P0100', 'P0104', 'Problema no sensor de fluxo de ar (MAF).', 'warn'],
  ['P0105', 'P0109', 'Problema no sensor de pressão do coletor (MAP).', 'warn'],
  ['P0110', 'P0114', 'Problema no sensor de temperatura do ar de admissão.', 'warn'],
  ['P0115', 'P0119', 'Problema no sensor de temperatura da água. O marcador e a ventoinha podem não funcionar direito: fique de olho na temperatura.', 'warn'],
  ['P0120', 'P0124', 'Problema no sensor de posição da borboleta (acelerador).', 'warn'],
  ['P0125', 'P0125', 'O motor demora para esquentar o suficiente.', 'warn'],
  ['P0128', 'P0128', 'Motor abaixo da temperatura de trabalho: normalmente é a válvula termostática. Aumenta o consumo.', 'warn'],
  ['P0130', 'P0135', 'Problema na sonda lambda antes do catalisador (ou no aquecimento dela).', 'warn'],
  ['P0136', 'P0141', 'Problema na sonda lambda depois do catalisador (ou no aquecimento dela).', 'warn'],
  ['P0171', 'P0171', 'Mistura pobre: está faltando combustível ou sobrando ar. Comum: entrada falsa de ar, bomba ou bico fraco.', 'warn'],
  ['P0172', 'P0172', 'Mistura rica: está sobrando combustível. Comum: bico pingando, sonda lenta.', 'warn'],
  ['P0201', 'P0204', 'Problema no circuito de um bico injetor.', 'bad', MISFIRE],
  ['P0230', 'P0230', 'Problema no circuito da bomba de combustível.', 'bad'],
  ['P0300', 'P0300', 'Falha de combustão em cilindros variados.', 'bad', MISFIRE],
  ['P0301', 'P0304', 'Falha de combustão no cilindro ', 'bad', MISFIRE],
  ['P0325', 'P0334', 'Problema no sensor de detonação (batida de pino).', 'warn'],
  ['P0335', 'P0339', 'Problema no sensor de rotação do motor. Pode fazer o carro morrer ou não pegar.', 'bad'],
  ['P0340', 'P0344', 'Problema no sensor de fase (comando de válvulas).', 'warn'],
  ['P0351', 'P0354', 'Problema na bobina de ignição de um cilindro.', 'bad', MISFIRE],
  ['P0420', 'P0420', 'Catalisador com eficiência baixa. Não costuma deixar o carro na mão, mas aumenta a poluição e pode reprovar em vistoria.', 'warn'],
  ['P0440', 'P0449', 'Problema no sistema do cânister (vapores de combustível). Às vezes é só a tampa do tanque mal fechada.', 'warn'],
  ['P0480', 'P0481', 'Problema no comando da ventoinha do radiador. Fique de olho na temperatura da água.', 'bad'],
  ['P0500', 'P0503', 'Problema no sensor de velocidade.', 'warn'],
  ['P0505', 'P0509', 'Problema no controle da marcha lenta.', 'warn'],
  ['P0560', 'P0563', 'Tensão elétrica fora do normal (bateria ou alternador).', 'warn'],
  ['P0600', 'P0606', 'Problema interno ou de comunicação da central do motor.', 'bad'],
  ['P0650', 'P0650', 'Problema no circuito da luz de injeção do painel.', 'warn'],
  ['U0100', 'U0100', 'Um módulo perdeu a comunicação com a central do motor.', 'bad']
];
function dtcPlain(code){
  for (const [a, b, txt, lvl, tip] of DTC_PLAIN)
    if (code >= a && code <= b) return [a === 'P0301' ? txt + code.slice(4) + '.' : txt, lvl, tip || 'Mostre este código ao mecânico.'];
  return null;
}

/* ---- Verificação ao conectar ---- */
const health = { checked: false, mil: null, stored: [], pending: [], fresh: [] };
async function healthCheck(){
  if (!link) return;
  try {
    const b = await pid('01', 4000, true).catch(() => null);
    health.mil = b ? !!(b[0] & 0x80) : null;
    health.stored = await fetchDTC('03');
    health.pending = await fetchDTC('07');
    health.checked = true;
    const all = [...new Set([...health.stored, ...health.pending])];
    // "Nova" = não estava na última verificação. Código apagado sai da lista e, se voltar, avisa de novo.
    health.fresh = all.filter(c => !cfg.dtcKnown.includes(c));
    cfg.dtcKnown = all.slice(0, 50); saveCfg();
    if (health.stored.length) renderDTC('03', health.stored);
    log('Verificação de falhas: ' + (all.length ? all.join(', ') : 'nenhuma') + (health.mil ? ' · luz de injeção acesa' : ''));
  } catch (e) { log('⚠ Verificação de falhas: ' + e.message); }
  healthBar(); simpleRender();
}
addEventListener('connected', () => setTimeout(healthCheck, 800));
addEventListener('disconnected', () => { Object.assign(health, { checked: false, mil: null, stored: [], pending: [], fresh: [] }); healthBar(); simpleRender(); });

function healthBar(){
  const el = $('healthBar'), all = [...health.stored, ...health.pending];
  if (!health.checked || (!all.length && !health.mil)){ el.hidden = true; return; }
  const first = health.fresh[0] || all[0], p = first ? dtcPlain(first) : null;
  el.hidden = false;
  el.className = 'healthbar ' + (health.stored.length || health.mil ? 'bad' : 'warn');
  el.innerHTML = '<span>' + (health.fresh.length ? '⚠ <b>Falha nova</b> registrada pelo carro: ' : health.stored.length ? '⚠ O carro tem falha registrada: ' : health.mil ? '⚠ Luz de injeção acesa' : '⚠ Falha em observação: ') +
    (first ? '<b>' + first + '</b>' + (p ? ' · ' + esc(p[0]) : '') + (all.length > 1 ? ' (+' + (all.length - 1) + ')' : '') : '') + '</span>' +
    '<button class="mini" data-go="falhas">Ver</button><button class="mini" data-x aria-label="Fechar">✕</button>';
}
$('healthBar').onclick = e => {
  if (e.target.closest('[data-x]')) $('healthBar').hidden = true;
  if (e.target.closest('[data-go]')){ document.querySelector('.tabs [data-tab="falhas"]').click(); renderDTC('03', health.stored); }
};

/* ---- Modo simples: quatro cartões grandes e um "tudo certo?" ---- */
const SIMPLE = [['p05', 'Água'], ['atrv', 'Bateria'], ['c:kml', 'Consumo agora'], ['c:avg', 'Média da viagem']];
const SIMPLE_READ = ['p05', 'atrv', 'c:kml', 'c:avg', 'p0C', 'p0D', 'p03', 'p1F'];
const simpleOn = () => cfg.simple && tabOpen('painel');
function simpleNeed(){ if (cfg.simple && link) need('simples', SIMPLE_READ); else release('simples'); }
function setMode(simple){
  cfg.simple = simple; saveCfg();
  $('simpleView').hidden = !simple; $('dashWrap').hidden = simple; $('dashHint').hidden = simple;
  document.querySelectorAll('#modeChips [data-mode]').forEach(b => b.setAttribute('aria-selected', (b.dataset.mode === 'simple') === simple));
  if (link) setDash(!simple);
  simpleNeed(); simpleRender();
  if (!simple) layoutDash();
}
function simpleStatus(){
  if (!link) return ['na', 'Conecte o adaptador', 'Coloque o adaptador na tomada do carro, ligue a chave e toque em “Conectar”.', []];
  const why = [];
  let worst = 'ok';
  const up = l => { const o = { na: 0, info: 0, ok: 0, warn: 1, bad: 2 }; if (o[l] > o[worst]) worst = l; };
  for (const k of ['p05', 'atrv']){
    const x = explain(k);
    if (x.lvl === 'warn' || x.lvl === 'bad'){ up(x.lvl); why.push(SIMPLE.find(s => s[0] === k)[1] + ': ' + x.msg); }
  }
  for (const c of health.stored){ up('bad'); const p = dtcPlain(c); why.push('Falha ' + c + (p ? ': ' + p[0] + ' ' + p[2] : '. Mostre este código ao mecânico.')); }
  for (const c of health.pending){ up('warn'); const p = dtcPlain(c); why.push('Falha em observação ' + c + (p ? ': ' + p[0].replace(/\.$/, '') : '') + '. A central ainda está confirmando.'); }
  for (const [i, s] of maintDue()){ up('warn'); why.push(i.name + ': ' + (s[0] === 'bad' ? 'troca ' + s[1].toLowerCase() : s[1].toLowerCase() + ' para a troca') + '.'); }
  if (health.mil && !health.stored.length){ up('bad'); why.push('A luz de injeção está acesa.'); }
  if (fresh('p05') == null && fresh('atrv') == null) return ['na', 'Lendo o carro…', 'Aguarde alguns segundos.', why];
  if (worst === 'bad') return ['bad', 'Procure um mecânico', /Superaquecendo/.test(why.join()) ? 'Pare em lugar seguro e desligue o motor.' : 'Veja abaixo o que o carro está dizendo.', why];
  if (worst === 'warn') return ['warn', 'Atenção', 'Nada urgente, mas vale ficar de olho.', why];
  const cold = (fresh('p05') ?? 99) < 80;
  return ['ok', 'Tudo certo', (health.checked ? 'Nenhuma falha registrada. ' : '') + (cold ? 'O motor ainda está esquentando.' : 'Bateria e temperatura normais.'), why];
}
function simpleRender(){
  if (!$('simpleView') || $('simpleView').hidden) return;
  const [lvl, title, sub, why] = simpleStatus();
  const icon = { ok: '✓', warn: '!', bad: '✕', na: '…' }[lvl];
  $('sStatus').className = 'sstatus s-' + lvl;
  $('sStatus').innerHTML = '<div class="sicon" aria-hidden="true">' + icon + '</div><div><b>' + title + '</b><p>' + sub + '</p>' +
    (why.length ? '<ul>' + why.map(w => '<li>' + w + '</li>').join('') + '</ul>' : '') + '</div>';
  $('sCards').innerHTML = SIMPLE.map(([k, label]) => {
    const x = explain(k), [cls, txt] = LVL[x.lvl];
    return '<button class="scard" data-k="' + k + '" aria-label="' + label + ': o que significa"><span class="sl">' + label + '</span>' +
      '<b>' + esc(String(x.v)) + '<small> ' + esc(x.unit || '') + '</small></b><span class="lvl lvl-' + cls + '">' + txt + '</span>' +
      '<span class="sm">' + (x.lvl === 'na' ? (link ? 'Aguardando leitura' : '') : x.msg.replace(/<[^>]+>/g, '').split('. ')[0] + '.') + '</span><i class="sinfo" aria-hidden="true">i</i></button>';
  }).join('');
}
$('sCards').onclick = e => { const b = e.target.closest('[data-k]'); if (b) openInfo(b.dataset.k); };
$('modeChips').onclick = e => { const b = e.target.closest('[data-mode]'); if (b) setMode(b.dataset.mode === 'simple'); };
setInterval(() => simpleOn() && !document.hidden && simpleRender(), 1000);
addEventListener('connected', simpleNeed);
addEventListener('tab', e => { if (e.detail === 'painel' && !cfg.simple) layoutDash(); });
