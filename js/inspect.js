/* ============ Vistoria de carro usado ============ */
// Um roteiro fixo de leituras, para quem vai comprar: falhas (inclusive as permanentes, que o scanner
// não apaga), sinais de que os códigos foram apagados há pouco, bateria, temperatura e mistura.
// O truque mais comum é apagar a luz de injeção antes de mostrar o carro. Apagar zera os contadores
// "desde a limpeza" (PIDs 30, 31, 4E) e deixa os monitores de prontidão incompletos por alguns dias:
// é isso que o app procura. Tudo é indício, não prova: trocar a bateria tem o mesmo efeito.
const INSP_S = 20;   // segundos medindo o motor funcionando
const INSP_KEYS = ['p0C', 'p05', 'p06', 'p07', 'p08', 'p09', 'atrv', 'p0D'];
const INSP_RECENT = { km: 200, warm: 10 };   // abaixo disso, os códigos foram apagados há pouco
const insp = { data: null, items: [], busy: false };

async function inspRun(){
  if (insp.busy || !link) return;
  insp.busy = true; $('btnInsp').disabled = true; $('inspActs').hidden = true;
  const step = s => $('inspStep').textContent = s;
  try {
    step('Detectando o protocolo do carro…');
    const pids = await loadPids(step).catch(() => null);
    if (!pids?.size){ step('O carro não respondeu. Confira se a chave está em ON (de preferência com o motor ligado) e tente de novo.'); return; }
    const d = { feitaEm: new Date().toISOString(), veiculo: profName(), adaptador: ficha.adaptador['Versão (ATI)'] || null,
      protocolo: PROTO[state.proto] || state.proto || null };
    const has = p => pids.has(p);
    const read = async p => has(p) ? num(fmtPid(p, await pid(hex2(p), 4000).catch(() => null))) : undefined;

    step('Luz de injeção e monitores de prontidão…');
    const b = await pid('01', 4000).catch(() => null);
    d.luzInjecao = b ? !!(b[0] & 0x80) : null;
    d.monitores = b?.length >= 4 ? Object.fromEntries(readiness(b)) : null;

    step('Códigos de falha…');
    d.armazenados = await fetchDTC('03').catch(() => null);
    d.pendentes = await fetchDTC('07').catch(() => null);
    // Muitos carros (K-line, mais antigos) não respondem ao modo 0A: fica null = "não informa"
    d.permanentes = await fetchDTC('0A').catch(() => null);

    step('Desde quando os códigos não são apagados…');
    d.kmDesdeLimpeza = await read(0x31);
    d.aquecimentosDesdeLimpeza = await read(0x30);
    d.minutosDesdeLimpeza = await read(0x4E);
    d.kmComLuzAcesa = await read(0x21);
    d.minutosComLuzAcesa = await read(0x4D);
    d.hodometro = await read(0xA6);

    step('Chassi (VIN)…');
    d.chassi = decodeVIN(await cmd('0902', 8000).catch(() => [])) || null;

    need('vistoria', INSP_KEYS);
    for (let i = INSP_S; i > 0 && link; i--){ step('Medindo o motor funcionando: ' + i + ' s (deixe em marcha lenta, sem acelerar)…'); await sleep(1000); }
    release('vistoria');
    d.motor = {};
    for (const k of INSP_KEYS){
      const v = store.since(k, INSP_S * 1000).v;
      if (v.length) d.motor[k] = { min: Math.min(...v), media: +(v.reduce((a, x) => a + x, 0) / v.length).toFixed(2), max: Math.max(...v), leituras: v.length };
    }
    insp.data = d; insp.items = inspJudge(d);
    step('Vistoria feita em ' + new Date(d.feitaEm).toLocaleString() + '.');
    inspRender();
  } catch (e) { step('A vistoria parou: ' + e.message); log('⚠ Vistoria: ' + e.message); }
  finally { release('vistoria'); insp.busy = false; $('btnInsp').disabled = !link; }
}

/* ---- Avaliação: [nível, título, explicação] ---- */
const brN = n => Math.round(n).toLocaleString('pt-BR');
function inspJudge(d){
  const out = [], add = (lvl, title, txt) => out.push([lvl, title, txt]);
  const m = d.motor, avg = k => m[k]?.media;
  const running = (avg('p0C') ?? 0) > 400;

  if (d.luzInjecao) add('bad', 'Luz de injeção acesa', 'A central do motor está avisando de uma falha agora.');
  else if (d.luzInjecao === false) add('ok', 'Luz de injeção apagada', '');

  for (const c of d.armazenados || []){ const p = dtcPlain(c); add(p?.[1] === 'bad' ? 'bad' : 'warn', 'Falha registrada ' + c, (p ? p[0] + ' ' : '') + (p?.[2] || 'Mostre este código ao mecânico.')); }
  for (const c of d.pendentes || []){ const p = dtcPlain(c); add('warn', 'Falha em observação ' + c, (p ? p[0] + ' ' : '') + 'A central viu o problema pelo menos uma vez e está confirmando.'); }
  for (const c of d.permanentes || []){ const p = dtcPlain(c); add('bad', 'Falha permanente ' + c, (p ? p[0] + ' ' : '') + 'Este tipo de código não sai com scanner: a central só apaga depois de confirmar, rodando, que o defeito foi resolvido.'); }
  if (d.armazenados && !d.armazenados.length && !d.pendentes?.length && !d.permanentes?.length) add('ok', 'Nenhum código de falha', d.permanentes ? 'Nem armazenado, nem em observação, nem permanente.' : 'Nem armazenado, nem em observação.');
  if (d.permanentes?.length && !d.armazenados?.length)
    add('bad', 'Códigos apagados com o defeito ainda presente', 'Há falha permanente, mas nenhuma armazenada: alguém apagou os códigos sem consertar. Pergunte o que foi feito.');

  // Códigos apagados há pouco
  const incomplete = d.monitores ? Object.entries(d.monitores).filter(([, s]) => s !== 'pronto').map(([n]) => n) : [];
  const km = d.kmDesdeLimpeza, warm = d.aquecimentosDesdeLimpeza;
  const recent = (km != null && km < INSP_RECENT.km) || (warm != null && warm < INSP_RECENT.warm);
  const since = [km != null ? (km >= 65535 ? 'mais de 65 mil km' : brN(km) + ' km') : null, warm != null ? (warm >= 255 ? 'mais de 255 partidas a frio' : warm + ' partidas a frio') : null].filter(Boolean).join(' e ');
  const why = 'Isso acontece ao apagar a luz de injeção com um scanner, mas também ao trocar ou desligar a bateria. Pergunte o que foi feito e, se puder, veja o carro de novo depois de alguns dias rodando.';
  if (recent && incomplete.length >= 2) add('bad', 'Sinais fortes de códigos apagados há pouco', 'Só ' + since + ' desde a última limpeza, e ' + incomplete.length + ' monitores ainda não terminaram os testes. ' + why);
  else if (recent) add('warn', 'Códigos apagados há pouco', 'Só ' + since + ' desde a última limpeza. ' + why);
  else if (since) add('ok', 'Códigos não foram apagados recentemente', since[0].toUpperCase() + since.slice(1) + ' desde a última limpeza.');
  if (incomplete.length && !recent)
    add(incomplete.length >= 2 ? 'warn' : 'info', 'Monitores incompletos: ' + incomplete.join(', '), 'É o que se vê logo depois de apagar os códigos ou desligar a bateria. Em alguns carros, um ou outro (como o EVAP) demora mesmo para ficar pronto.');
  if (d.kmComLuzAcesa > 0) add('warn', 'Rodou ' + brN(d.kmComLuzAcesa) + ' km com a luz acesa', 'Desde a última limpeza dos códigos, o carro andou com a luz de injeção acesa.');

  // Motor funcionando
  if (!running){ out.partial = true; add('info', 'Motor desligado durante a medição', 'Bateria, temperatura e mistura só são avaliadas com o motor ligado. Ligue o motor e refaça a vistoria.'); }
  else {
    if ((m.p0D?.max ?? 0) > 3) add('info', 'O carro andou durante a medição', 'Os valores de marcha lenta valem mais com o carro parado.');
    const v = avg('atrv');
    if (v != null){
      if (v < 13.2) add('warn', 'Bateria carregando pouco: ' + v.toFixed(1).replace('.', ',') + ' V', 'Com o motor ligado, o normal é entre 13,5 e 14,8 V. Abaixo disso: alternador, correia ou bateria. Clones do ELM costumam marcar até 0,5 V a menos.');
      else if (v > 14.9) add('warn', 'Tensão alta: ' + v.toFixed(1).replace('.', ',') + ' V', 'Acima de 14,8 V o regulador do alternador pode estar com defeito, o que estraga a bateria.');
      else add('ok', 'Alternador carregando: ' + v.toFixed(1).replace('.', ',') + ' V', '');
    }
    const tmax = m.p05?.max, tavg = avg('p05');
    if (tmax != null){
      if (tmax > 108) add('bad', 'Motor quente demais: ' + Math.round(tmax) + ' °C', 'Parado em marcha lenta não deveria passar de uns 105 °C. Pode ser ventoinha, válvula termostática, radiador ou junta. Não compre sem um mecânico olhar.');
      else if (tavg < 70){ out.partial = true; add('info', 'Motor ainda frio: ' + Math.round(tavg) + ' °C', 'A mistura e a marcha lenta só valem com o motor quente (acima de 80 °C). Espere esquentar e refaça.'); }
      else add('ok', 'Temperatura do motor: ' + Math.round(tavg) + ' °C', '');
    }
    if ((tavg ?? 0) >= 70){
      for (const [st, lt, bank] of [['p06', 'p07', 'B1'], ['p08', 'p09', 'B2']]){
        const l = avg(lt); if (l == null) continue;
        const tot = l + (avg(st) ?? 0), side = tot > 0 ? 'pobre (falta combustível ou sobra ar: entrada falsa de ar, bomba ou bico fraco)' : 'rica (sobra combustível: bico pingando, sonda lenta)';
        const txt = 'Ajuste longo ' + (l > 0 ? '+' : '') + l.toFixed(1).replace('.', ',') + '%, total ' + (tot > 0 ? '+' : '') + tot.toFixed(1).replace('.', ',') + '%. ';
        if (Math.abs(l) > 20 || Math.abs(tot) > 25) add('bad', 'Mistura muito ' + side.split(' ')[0] + ' (' + bank + ')', txt + 'A central está corrigindo muito: mistura ' + side + '.');
        else if (Math.abs(l) > 10 || Math.abs(tot) > 15) add('warn', 'Mistura ' + side.split(' ')[0] + ' (' + bank + ')', txt + 'Acima de 10% vale investigar: mistura ' + side + '. No flex, logo depois de trocar de combustível, a central ainda está reaprendendo.');
        else add('ok', 'Mistura ar/combustível em ordem (' + bank + ')', txt);
      }
      const r = m.p0C;
      if (r && (m.p0D?.max ?? 0) <= 3){
        if (r.max - r.min > 250) add('warn', 'Marcha lenta oscilando: ' + brN(r.min) + '–' + brN(r.max) + ' rpm', 'Parado e sem acelerar, o giro deveria ficar quase fixo. Comum: corpo de borboleta sujo, entrada falsa de ar, vela ou bobina.');
        else if (r.media > 1100) add('warn', 'Marcha lenta alta: ' + brN(r.media) + ' rpm', 'Com o motor quente, o normal é entre 700 e 1.000 rpm (o ar-condicionado ligado aumenta um pouco).');
        else add('ok', 'Marcha lenta estável: ' + brN(r.media) + ' rpm', '');
      }
    }
  }

  // Para conferir com os documentos
  if (d.hodometro != null) add('info', 'A central informa ' + brN(d.hodometro) + ' km rodados', 'Compare com o hodômetro do painel. Diferença grande é sinal de quilometragem adulterada.');
  add('info', d.chassi ? 'Chassi informado pela central: ' + d.chassi : 'A central não informou o chassi',
    d.chassi ? 'Confira se é o mesmo do documento (CRLV) e das gravações nos vidros e na carroceria. Diferente: central trocada ou documento errado.' : 'É comum em carros mais antigos. Confira o chassi no documento e na carroceria.');
  return out;
}

/* ---- Tela ---- */
const INSP_LV = { bad: 0, warn: 1, ok: 2, info: 3 };
function inspVerdict(items){
  if (items.some(i => i[0] === 'bad')) return ['bad', 'Encontramos sinais de alerta', 'Leve o carro a um mecânico de confiança antes de fechar negócio e mostre este laudo.'];
  const rest = items.partial ? ' Falta repetir com o motor ligado e quente para avaliar a mistura e a marcha lenta.' : '';
  if (items.some(i => i[0] === 'warn')) return ['warn', 'Pontos para conferir', 'Nada grave apareceu, mas vale perguntar ao vendedor e pedir a opinião de um mecânico.' + rest];
  return ['ok', 'Nenhum sinal de alerta no motor' + (items.partial ? ' até agora' : ''), (items.partial ? 'Falhas e códigos apagados: em ordem.' : 'Pelo que a central do motor mostra, está tudo em ordem.') + rest + ' Isso não substitui a vistoria completa.'];
}
function inspRender(){
  const d = insp.data; if (!d) return;
  const [lvl, title, sub] = inspVerdict(insp.items), icon = { ok: '✓', warn: '!', bad: '✕' }[lvl];
  const items = insp.items.slice().sort((a, b) => INSP_LV[a[0]] - INSP_LV[b[0]]);
  const kv = rows => '<dl class="kv">' + rows.filter(([, v]) => v != null && v !== '').map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('') + '</dl>';
  const nf = (v, u) => v == null ? null : brN(v) + (u ? ' ' + u : '');
  const motor = Object.entries(d.motor).map(([k, s]) => { const def = sensorDef(k), dd = def?.d ?? 1, f = x => x.toFixed(dd).replace('.', ',');
    return '<tr><td>' + esc(def?.name || k) + '</td><td>' + f(s.min) + '</td><td>' + f(s.media) + '</td><td>' + f(s.max) + '</td><td>' + esc(def?.unit || '') + '</td></tr>'; }).join('');
  $('inspOut').innerHTML =
    '<div class="sstatus s-' + lvl + '"><div class="sicon" aria-hidden="true">' + icon + '</div><div><b>' + title + '</b><p>' + sub + '</p></div></div>' +
    items.map(([l, t, x]) => '<div class="dg ' + l + '"><b>' + esc(t) + '</b>' + (x ? '<br>' + esc(x) : '') + '</div>').join('') +
    '<h3>Dados lidos</h3>' + kv([
      ['Feita em', new Date(d.feitaEm).toLocaleString()], ['Veículo (no app)', d.veiculo], ['Chassi (VIN)', d.chassi || 'não informado'],
      ['Protocolo', d.protocolo], ['Adaptador', d.adaptador],
      ['Luz de injeção', d.luzInjecao == null ? 'não informada' : d.luzInjecao ? 'acesa' : 'apagada'],
      ['Códigos armazenados', d.armazenados ? d.armazenados.join(', ') || 'nenhum' : 'sem resposta'],
      ['Códigos pendentes', d.pendentes ? d.pendentes.join(', ') || 'nenhum' : 'sem resposta'],
      ['Códigos permanentes', d.permanentes ? d.permanentes.join(', ') || 'nenhum' : 'o carro não informa'],
      ['Distância desde a limpeza', nf(d.kmDesdeLimpeza, 'km') || 'o carro não informa'],
      ['Partidas a frio desde a limpeza', nf(d.aquecimentosDesdeLimpeza) || 'o carro não informa'],
      ['Tempo desde a limpeza', d.minutosDesdeLimpeza == null ? null : brN(d.minutosDesdeLimpeza / 60) + ' h de motor ligado'],
      ['Distância com a luz acesa', nf(d.kmComLuzAcesa, 'km')], ['Hodômetro da central', nf(d.hodometro, 'km')]
    ]) +
    (d.monitores ? '<h3>Monitores de prontidão</h3>' + Object.entries(d.monitores).map(([n, s]) =>
      '<div class="mon"><span>' + esc(n) + '</span><b class="' + (s === 'pronto' ? 'ok' : 'warn') + '">' + s + '</b></div>').join('') : '') +
    (motor ? '<h3>Motor funcionando (' + INSP_S + ' s)</h3><div class="tw"><table><tr><th>Sensor</th><th>mín.</th><th>média</th><th>máx.</th><th></th></tr>' + motor + '</table></div>' : '') +
    '<p class="small muted">Laudo gerado pelo ELM327 Scanner com o OBD-II genérico. Ele só enxerga a central do motor: não vê batida, enchente, chassi remarcado, câmbio, freios, suspensão, airbag ou ABS. Use junto com a vistoria cautelar e um mecânico de confiança.</p>';
  $('inspActs').hidden = false;
}
$('btnInsp').onclick = inspRun;
$('btnInspPrint').onclick = () => print();
$('btnInspShare').onclick = () => $('btnShare').click();
addEventListener('disconnected', () => { $('btnInsp').disabled = true; });

EXPORTS.vistoria = ['Vistoria de carro usado', () => insp.data ? {
  ...insp.data, motor: Object.fromEntries(Object.entries(insp.data.motor).map(([k, s]) => [sensorDef(k)?.name || k, s])),
  resultado: inspVerdict(insp.items)[1], avaliacao: insp.items.map(([nivel, titulo, explicacao]) => ({ nivel, titulo, explicacao }))
} : { aviso: 'A vistoria ainda não foi feita.' }];
