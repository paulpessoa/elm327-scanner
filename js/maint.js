/* ============ Manutenção: quilometragem do carro e trocas ============ */
// Os intervalos começam vazios de propósito: mudam de carro para carro e com o tipo de uso,
// então quem preenche é o dono, olhando o manual ou o plano de revisão.
const MAINT_ITEMS = ['Óleo do motor e filtro de óleo', 'Filtro de ar do motor', 'Filtro de combustível', 'Filtro de cabine (ar-condicionado)',
  'Velas de ignição', 'Correia dentada', 'Fluido de freio', 'Líquido de arrefecimento', 'Pastilhas de freio', 'Alinhamento e balanceamento'];

function maintOf(car = cfg.vehicle.car){
  if (!cfg.maint[car]){
    const items = MAINT_ITEMS.map(name => ({ id: uid(), name, every: null, last: null, lastT: 0 }));
    // Direção hidráulica (Mobi) tem fluido próprio
    if (/^mobi/.test(car)) items.push({ id: uid(), name: 'Fluido da direção hidráulica', every: null, last: null, lastT: 0 });
    cfg.maint[car] = { odo: null, items };
  }
  return cfg.maint[car];
}
// Quilometragem de agora: o último número informado (aqui ou num abastecimento) + o que o app rodou depois
function odoNow(car = cfg.vehicle.car){
  let base = maintOf(car).odo;
  const fl = cfg.fills.filter(f => f.car === car).sort((a, b) => a.t - b.t).at(-1);
  if (fl && (!base || fl.t > base.t)) base = { km: fl.odo, t: fl.t, fill: true };
  if (!base) return null;
  const extra = cfg.runs.filter(r => r.car === car && r.t0 > base.t).reduce((a, r) => a + r.km, 0);
  return { km: Math.round(base.km + extra), extra, base };
}
// Situação de um item: [nível, texto]
function itemStatus(i, now){
  if (!i.every) return ['na', 'Defina o intervalo'];
  if (i.last == null) return ['na', 'Informe a última troca'];
  if (now == null) return ['na', 'Informe a quilometragem do carro'];
  const left = i.last + i.every - now;
  if (left < 0) return ['bad', 'Vencida há ' + fmtKm(-left)];
  if (left <= Math.max(500, i.every * 0.1)) return ['warn', 'Faltam ' + fmtKm(left)];
  return ['ok', 'Faltam ' + fmtKm(left)];
}
const fmtKm = n => Math.round(n).toLocaleString('pt-BR') + ' km';
// Itens vencidos ou perto, para o modo simples
function maintDue(){
  const o = odoNow(); if (!o) return [];
  return maintOf().items.map(i => [i, itemStatus(i, o.km)]).filter(([, s]) => s[0] === 'bad' || s[0] === 'warn');
}

function renderMaint(){
  if (!$('mList')) return;
  const m = maintOf(), o = odoNow();
  $('mCar').textContent = 'Carro: ' + (CARS[cfg.vehicle.car]?.nome || 'personalizado') + ' (troque o carro nas abas C3, Mobi ou Duster).';
  $('mOdo').placeholder = o ? String(o.km) : 'ex.: 85400';
  $('mOdoInfo').innerHTML = !o ? 'Informe o km do painel para o app acompanhar as trocas.'
    : 'Agora: <b>' + fmtKm(o.km) + '</b> · ' + (o.base.fill ? 'do abastecimento' : 'informado') + ' em ' + new Date(o.base.t).toLocaleDateString() +
      (o.extra >= 0.5 ? ' + ' + fmtKm(o.extra) + ' rodados com o app depois' : '') + '.';
  $('mList').innerHTML = m.items.map(i => {
    const [lvl, txt] = itemStatus(i, o?.km);
    return '<div class="mitem" data-id="' + esc(i.id) + '"><div class="mhead"><b>' + esc(i.name) + '</b><span class="lvl lvl-' + lvl + '">' + txt + '</span></div>' +
      '<div class="mrow"><label>A cada<input type="number" inputmode="numeric" min="0" step="500" data-f="every" value="' + (i.every ?? '') + '" placeholder="km do manual"></label>' +
      '<label>Última troca no km<input type="number" inputmode="numeric" min="0" step="1" data-f="last" value="' + (i.last ?? '') + '" placeholder="ex.: 80000"></label></div>' +
      '<div class="row"><button class="mini" data-done>✓ Troquei hoje</button>' + (i.lastT ? '<span class="small muted hint">em ' + new Date(i.lastT).toLocaleDateString() + '</span>' : '') +
      '<button class="mini danger" data-del aria-label="Remover ' + esc(i.name) + '">✕</button></div></div>';
  }).join('');
}
function bindMaint(){
  $('btnOdo').onclick = () => {
    const km = Math.round(parseFloat(String($('mOdo').value).replace(/\./g, '').replace(',', '.')));
    if (!(km > 0) || km > 2e6){ alert('Digite o km que aparece no painel do carro.'); return; }
    maintOf().odo = { km, t: Date.now() }; $('mOdo').value = ''; saveCfg(); renderMaint();
  };
  $('mList').onchange = e => {
    const inp = e.target.closest('[data-f]'), it = maintOf().items.find(i => i.id === e.target.closest('.mitem')?.dataset.id);
    if (!inp || !it) return;
    const n = Math.round(parseFloat(String(inp.value).replace(/\./g, '').replace(',', '.')));
    it[inp.dataset.f] = n > 0 ? Math.min(n, inp.dataset.f === 'every' ? 500000 : 2e6) : null;
    if (inp.dataset.f === 'last') it.lastT = it.last == null ? 0 : Date.now();
    saveCfg(); renderMaint();
  };
  $('mList').onclick = e => {
    const it = maintOf().items.find(i => i.id === e.target.closest('.mitem')?.dataset.id); if (!it) return;
    if (e.target.closest('[data-done]')){
      const o = odoNow();
      if (!o){ alert('Informe antes a quilometragem atual do carro.'); return; }
      it.last = o.km; it.lastT = Date.now(); saveCfg(); renderMaint();
    } else if (e.target.closest('[data-del]') && confirm('Remover “' + it.name + '” da lista?')){
      maintOf().items = maintOf().items.filter(i => i !== it); saveCfg(); renderMaint();
    }
  };
  $('btnMNew').onclick = () => {
    const name = str($('mNewName').value.trim(), 40); if (!name) return;
    const m = maintOf(); if (m.items.length >= 30) return;
    m.items.push({ id: uid(), name, every: null, last: null, lastT: 0 }); $('mNewName').value = ''; saveCfg(); renderMaint();
  };
  renderMaint();
}
addEventListener('tab', e => { if (e.detail === 'viagens') renderMaint(); });

const maintData = () => {
  const o = odoNow();
  return { kmAtual: o?.km ?? null, itens: maintOf().items.map(i => ({ item: i.name, intervaloKm: i.every, ultimaTrocaKm: i.last, situacao: itemStatus(i, o?.km)[1] })) };
};
