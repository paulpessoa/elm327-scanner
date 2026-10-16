/* ============ "O que é isto?": explicação de cada sensor ============ */
// Cada entrada tem: what (o que o valor significa, em linguagem simples), judge(v, c) → [nível, texto]
// para o valor de agora, e causes (o que costuma levar o valor para fora).
// Níveis: ok, warn (atenção), bad (fora do normal), info (sem julgamento).
// As faixas são gerais para motor a gasolina/flex em bom estado, não dados de fábrica: quando há
// linha de base gravada no carro, ela aparece junto, e é a melhor referência.

function ctxNow(){
  const temp = fresh('p05', 15000), rpm = fresh('p0C', 15000), fs = fresh('p03', 15000);
  const spd = fresh('p0D', 15000) ?? fresh('c:gspd', 15000);
  const run = fresh('p1F', 15000);
  return {
    temp, rpm, spd, run, car: cfg.vehicle.car,
    on: rpm != null && rpm > 300, off: rpm === 0,
    warm: temp != null && temp >= 80,
    idle: rpm != null && rpm > 300 && rpm < 1300 && (spd == null || spd < 3),
    closed: typeof fs === 'string' ? /fechada/i.test(fs) && !/falha/i.test(fs) : null,
    cut: typeof fs === 'string' && /desacelera/i.test(fs)
  };
}
const mobi = c => /^mobi/.test(c.car);
const SHIFT_TIP = 'No câmbio manual, trocar de marcha antes de uns 2.500–3.000 rpm costuma economizar no dia a dia.';
// Conta quantas vezes o sinal cruzou um nível nos últimos ms (para julgar as sondas lambda)
function crossings(k, ms, lvl){
  const v = store.since(k, ms).v; let n = 0;
  for (let i = 1; i < v.length; i++) if ((v[i - 1] - lvl) * (v[i] - lvl) < 0) n++;
  return { n, len: v.length };
}

const TRIM_S = {
  what: 'Correção <b>rápida</b> que a central faz na injeção, olhando a sonda lambda, para manter a mistura ar/combustível certa. Positivo = está pondo mais combustível (a mistura estava pobre). Negativo = está tirando.',
  judge: (v, c) => c.closed === false ? ['info', 'Malha aberta agora: a central não está usando a sonda, então este ajuste fica parado. É normal com motor frio, pé no fundo ou desacelerando.']
    : Math.abs(v) <= 10 ? ['ok', 'Normal. Ficar oscilando em torno de zero é o esperado.'] : ['warn', 'Correção grande. Um valor só não diz muito: veja se o ajuste longo também está fora.'],
  causes: ['Olhe o ajuste longo: é ele que mostra se o problema é constante.']
};
const TRIM_L = {
  what: 'Correção <b>aprendida</b> pela central ao longo dos dias. Mostra se o motor precisa sempre de mais (positivo) ou menos (negativo) combustível do que o previsto.',
  judge: (v, c) => {
    const flex = ' No flex, depois de trocar de combustível esse valor muda por alguns km enquanto a central reaprende.';
    if (Math.abs(v) <= 10) return ['ok', 'Normal (entre −10 e +10 %).'];
    if (Math.abs(v) <= 20) return ['warn', (v > 0 ? 'A central está sempre pondo combustível a mais: mistura tendendo a pobre.' : 'A central está sempre tirando combustível: mistura tendendo a rica.') + flex];
    return ['bad', (v > 0 ? 'Correção alta para mais: mistura pobre.' : 'Correção alta para menos: mistura rica.') + flex];
  },
  causes: ['Positivo (pobre): entrada falsa de ar (mangueira, junta do coletor), bomba ou filtro de combustível fraco, bico sujo, sensor de ar lendo errado.',
    'Negativo (rico): bico pingando, pressão de combustível alta, sonda lambda lenta, válvula do cânister presa.']
};
const VOLT = () => (v, c) => {
  // Sem o giro, deduz pelo próprio valor: acima de ~13,2 V só com o alternador carregando
  const on = c.rpm != null ? c.on : v >= 13.2;
  if (!on){
    if (v >= 12.4) return ['ok', 'Motor desligado: bateria carregada.'];
    if (v >= 12.0) return ['warn', 'Motor desligado: bateria um pouco fraca. Se o carro demora a pegar, vale testar a bateria.'];
    return ['bad', 'Motor desligado: bateria descarregada (ou leitura errada do adaptador).'];
  }
  if (v > 14.8) return ['bad', 'Tensão alta com o motor ligado: o regulador do alternador pode estar com defeito e isso estraga a bateria.'];
  if (v >= 13.5) return ['ok', 'Motor ligado: o alternador está carregando normalmente.'];
  if (v >= 13.0) return ['warn', 'Carregando pouco. Pode ser bateria já cheia com pouca carga elétrica, ou o alternador fraco.'];
  return ['bad', 'Motor ligado e a tensão não sobe: o alternador não está carregando (correia, alternador ou cabos).'];
};

const EXPLAIN = {
  p05: {
    what: 'Temperatura do líquido de arrefecimento, a “água” do radiador. O motor foi feito para trabalhar quente: frio ele gasta mais e desgasta mais.',
    judge: (v, c) => {
      if (v > 110) return ['bad', 'Superaquecendo! Pare em lugar seguro e desligue o motor. Não abra o reservatório com o motor quente: a água sai fervendo.'];
      if (v > 105) return ['warn', 'Quente. Parado no trânsito pode subir um pouco até a ventoinha ligar e baixar. Se não baixar, confira o nível da água com o motor frio.'];
      if (v >= 80) return ['ok', 'Temperatura normal de trabalho.'];
      if (c.run != null && c.run > 900 && v < 75) return ['warn', 'Mais de 15 min ligado e ainda abaixo de 75 °C: a válvula termostática pode estar presa aberta. O carro gasta mais assim.'];
      if (v < 40) return ['info', 'Motor frio, normal logo depois de ligar. Evite giro alto até esquentar.'];
      return ['info', 'Esquentando. Rodando, deve passar de 80 °C em uns 10 minutos.'];
    },
    causes: ['Esquentando demais: falta de água, ventoinha que não liga, bomba d’água, válvula termostática fechada, radiador sujo.', 'Não esquenta: válvula termostática aberta ou sensor de temperatura.']
  },
  atrv: { what: 'Tensão elétrica medida na tomada do OBD. Com o motor desligado mostra a carga da bateria; ligado, mostra se o alternador está carregando.', judge: VOLT(),
    causes: ['Adaptadores baratos podem errar de 0,2 a 0,5 V. Para ter certeza, meça na bateria com um multímetro (aba Tensão).'] },
  p42: { what: 'Tensão que chega na central do motor. Deve acompanhar a da bateria.', judge: VOLT() },
  p0C: {
    what: 'Giro do motor: quantas voltas por minuto ele está dando.',
    judge: (v, c) => {
      const steer = mobi(c) ? ' No Mobi, virar o volante parado faz a lenta oscilar um pouco: é a bomba da direção hidráulica pedindo força.' : '';
      if (v === 0) return ['info', 'Motor desligado.'];
      if (c.idle){
        if (!c.warm) return ['info', 'Marcha lenta com motor frio: é normal o giro ficar mais alto até esquentar.' + steer];
        if (v >= 750 && v <= 950) return ['ok', 'Marcha lenta normal.' + steer];
        return ['warn', 'Marcha lenta fora da faixa geral (750–950 rpm). Ar-condicionado ligado sobe a lenta, isso é normal.' + steer];
      }
      if (v > 3500) return ['info', 'Giro alto: gasta mais combustível. ' + SHIFT_TIP];
      return ['info', 'Rodando. ' + SHIFT_TIP];
    },
    causes: ['Lenta oscilando ou baixa demais: corpo de borboleta sujo, entrada falsa de ar, vela ou cabo de vela.']
  },
  p04: {
    what: 'Quanto do esforço máximo o motor está fazendo agora, calculado pela central. Parado em lenta é baixo; pé no fundo vai perto de 100 %.',
    judge: (v, c) => c.idle && c.warm ? (v <= 35 ? ['ok', 'Normal para marcha lenta.'] : ['warn', 'Carga alta parado. Ar-condicionado, faróis, volante virado ou bateria carregando aumentam a carga.'])
      : v > 80 ? ['info', 'Pé quase no fundo: é quando mais se gasta combustível.'] : ['info', 'Varia com o acelerador, a subida e a marcha.']
  },
  p0B: {
    what: 'Pressão dentro do coletor de admissão. Baixa = muito vácuo (pouco ar entrando, motor aliviado). Perto da pressão do ar de fora (90–100 kPa) = acelerador no fundo.',
    judge: (v, c) => c.idle && c.warm ? (v >= 25 && v <= 45 ? ['ok', 'Normal para marcha lenta.'] : v > 45 ? ['warn', 'Vácuo fraco na lenta.'] : ['info', 'Vácuo bem alto na lenta.'])
      : c.cut ? ['ok', 'Desacelerando: vácuo alto, a injeção pode estar cortada.'] : ['info', 'Sobe quando você acelera.'],
    causes: ['Vácuo fraco na lenta: entrada falsa de ar, mangueira de vácuo solta, compressão baixa. Em cidades altas o valor é naturalmente um pouco menor.']
  },
  p06: TRIM_S, p08: TRIM_S, p07: TRIM_L, p09: TRIM_L,
  p0E: {
    what: 'Avanço de ignição: quantos graus antes do pistão chegar no topo a vela solta a faísca. A central ajusta o tempo todo.',
    judge: (v, c) => c.idle && c.warm ? (v >= 5 && v <= 20 ? ['ok', 'Normal para marcha lenta.'] : ['warn', 'Fora da faixa geral para lenta (5–20°).'])
      : v < 0 && (fresh('p04') ?? 0) > 50 ? ['warn', 'Negativo com carga alta: a central pode estar atrasando a faísca por detonação (batida de pino). Combustível ruim é causa comum.'] : ['info', 'Varia muito com giro e carga.']
  },
  p0F: { what: 'Temperatura do ar que entra no motor.', judge: v => ['info', 'Costuma ficar alguns graus acima da temperatura de fora. Parado no trânsito sobe, pelo calor do motor. Ar mais quente dá um pouco menos de potência.'] },
  p11: { what: 'Quanto a borboleta (a “porta” do ar) está aberta. Pé solto: baixa. Pé no fundo: perto do máximo, que nem sempre é 100 %.', judge: () => ['info', 'Acompanha o pedal do acelerador.'] },
  p0D: { what: 'Velocidade que o carro informa, vinda do sensor do câmbio ou das rodas.', judge: () => ['info', 'O velocímetro costuma marcar um pouco mais que o real. Em Ajustes, ligue o GPS para comparar.'] },
  p14: {
    what: 'Sonda lambda <b>antes</b> do catalisador: mede o oxigênio no escape. É por ela que a central acerta a mistura. Com motor quente deve subir e descer entre ~0,1 e ~0,9 V várias vezes por segundo.',
    judge: (v, c) => {
      if (c.closed === false) return ['info', 'Malha aberta agora: com motor frio, pé no fundo ou desacelerando, a sonda fica parada, e é normal.'];
      const x = crossings('p14', 10000, 0.45);
      if (x.len < 10) return ['info', 'Poucas leituras para julgar. Abra a aba Sondas, que lê esta sonda com prioridade.'];
      return x.n >= 4 ? ['ok', 'Está oscilando (' + x.n + ' trocas em 10 s). Sinal de sonda viva.'] : ['warn', 'Quase parada (' + x.n + ' trocas em 10 s). Confirme na aba Sondas com o motor quente em lenta.'];
    },
    causes: ['Parada perto de 0,45 V: sonda morta ou fiação. Sempre baixa: mistura pobre ou entrada de ar. Sempre alta: mistura rica.']
  },
  p15: {
    what: 'Sonda lambda <b>depois</b> do catalisador: confere se o catalisador está trabalhando. Deve ficar quase parada, entre 0,5 e 0,8 V.',
    judge: (v, c) => {
      const x = crossings('p15', 10000, 0.45);
      if (x.len >= 10 && x.n >= 4) return ['warn', 'Está oscilando como a sonda de antes: o catalisador pode estar gasto (código P0420).'];
      return v >= 0.5 && v <= 0.85 ? ['ok', 'Estável na faixa esperada: catalisador trabalhando.'] : ['info', 'Fora de 0,5–0,8 V agora. Com motor frio ou desacelerando, é normal.'];
    }
  },
  p03: { what: 'Mostra se a central está corrigindo a mistura pela sonda lambda (malha fechada) ou usando valores fixos (malha aberta).',
    judge: (v, c) => /fechada/i.test(v) && !/falha/i.test(v) ? ['ok', 'Malha fechada: funcionamento normal com motor quente.']
      : /desacelera|carga/i.test(v) ? ['info', 'Malha aberta por aceleração forte ou desaceleração. Normal.']
      : /frio/i.test(v) ? ['info', 'Malha aberta porque o motor está frio. Normal até esquentar.'] : ['warn', 'Malha aberta por falha: leia os códigos na aba Falhas.'] },
  p2F: { what: 'Nível do tanque, pela boia. Nem todo carro informa.', judge: v => v < 15 ? ['warn', 'Na reserva. Rodar sempre na reserva pode puxar sujeira do fundo do tanque.'] : ['ok', 'Ok.'] },
  p5C: { what: 'Temperatura do óleo do motor.', judge: v => v > 130 ? ['bad', 'Óleo muito quente. Pare e confira nível de óleo e água.'] : ['info', 'Sobe mais devagar que a água. Evite exigir do motor com o óleo frio.'] },
  p1F: { what: 'Tempo desde que o motor foi ligado.', judge: () => ['info', 'Útil para saber se o motor já teve tempo de esquentar.'] },
  p21: { what: 'Quantos km foram rodados com a luz de injeção acesa.', judge: v => v > 0 ? ['warn', 'Já rodou ' + v + ' km com a luz de injeção acesa. Leia os códigos na aba Falhas.'] : ['ok', 'Nenhum km com a luz acesa.'] },
  p31: { what: 'Km rodados desde que os códigos de falha foram apagados (ou a bateria foi desligada).', judge: v => v < 50 ? ['info', 'Poucos km: os testes internos da central (monitores) podem não ter terminado. Isso importa em vistoria.'] : ['info', 'Ok.'] },
  p33: { what: 'Pressão do ar de fora.', judge: () => ['info', 'Cai com a altitude: ao nível do mar fica perto de 101 kPa.'] },
  p44: { what: 'Mistura que a central está pedindo. 1,00 = mistura ideal; abaixo de 1 = mais combustível (rica); acima = menos (pobre).', judge: v => ['info', v < 0.97 ? 'Pedindo mistura rica: normal acelerando forte ou com motor frio.' : 'Mistura ideal ou perto.'] },
  p46: { what: 'Temperatura do ar de fora.', judge: () => ['info', 'Informação.'] },
  p52: { what: 'Porcentagem de etanol que a central calcula no tanque.', judge: () => ['info', 'A maioria dos flex nacionais não informa isso pelo OBD.'] },
  p10: { what: 'Massa de ar que entra no motor por segundo. É a base do cálculo de consumo.', judge: () => ['info', 'Sobe com o acelerador. Compare com a linha de base do seu carro em lenta.'] },

  'c:kml': { what: 'Quantos km o carro faria com 1 litro <b>se continuasse exatamente como agora</b>. Muda o tempo todo: arrancada e subida derrubam; descida e velocidade constante sobem. Parado não existe km/L (mostra --).',
    judge: (v, c) => c.cut ? ['ok', 'Corte de combustível: marcha engatada e pé fora do acelerador, a injeção desliga e o consumo vai a zero.'] : ['info', 'Para saber quanto o carro faz de verdade, olhe a média da viagem ou do último km.'] },
  'c:avg': { what: 'Média da viagem: km rodados ÷ litros gastos desde que você zerou a viagem (em Ajustes).', judge: () => ['info', calibNote()] },
  'c:kml1': { what: 'Média do último quilômetro completo: 1 km ÷ litros gastos nele.', judge: () => ['info', 'Bom para ver o efeito de um trecho: subida, trânsito, estrada. ' + calibNote()] },
  'c:l100': { what: 'Litros a cada 100 km na viagem (o jeito europeu). Quanto <b>menor</b>, melhor.', judge: () => ['info', calibNote()] },
  'c:lph': { what: 'Litros por hora que o motor está gastando agora. Parado em marcha lenta, mostra quanto custa ficar com o carro ligado.', judge: (v, c) => c.idle ? ['info', 'Parado: em paradas longas, desligar o motor economiza esse valor.'] : ['info', calibNote()] },
  'c:km': { what: 'Distância da viagem, pela fonte escolhida em Ajustes (OBD ou GPS).', judge: () => ['info', 'Zera em Ajustes → Zerar viagem.'] },
  'c:kmo': { what: 'Distância somando a velocidade que o carro informa.', judge: () => ['info', 'Costuma marcar um pouco a mais que o real, como o velocímetro.'] },
  'c:kmg': { what: 'Distância medida pelo GPS do celular.', judge: () => ['info', 'Só conta com sinal bom (até ±25 m) e com o carro andando.'] },
  'c:fuel': { what: 'Litros gastos desde que você zerou a viagem.', judge: () => ['info', calibNote()] },
  'c:cost': { what: 'Custo da viagem: litros × preço por litro (Ajustes).', judge: () => ['info', 'Preço atual: R$ ' + cfg.vehicle.price.toFixed(2) + '/L. Mudar o preço recalcula a viagem inteira.'] },
  'c:maf': { what: 'Massa de ar calculada (ou lida do sensor MAF). É a base do cálculo de consumo.', judge: () => ['info', 'Informação.'] },
  'c:gspd': { what: 'Velocidade medida pelo GPS do celular.', judge: () => ['info', 'Costuma ser mais fiel que a do velocímetro em velocidade constante.'] },
  'c:gacc': { what: 'Margem de erro da posição do GPS, em metros.', judge: v => v <= 10 ? ['ok', 'Sinal ótimo.'] : v <= 25 ? ['ok', 'Sinal bom.'] : ['warn', 'Sinal fraco: a distância pelo GPS fica pausada até melhorar.'] }
};
function calibNote(){
  return cfg.vehicle.corr === 100 ? 'Os litros são calculados, não medidos. Ainda não calibrado pelo posto: calibre em Ajustes para o número ficar confiável.'
    : 'Os litros são calculados e já foram calibrados pelo posto (fator ' + cfg.vehicle.corr.toFixed(0) + ' %).';
}

const LVL = { ok: ['ok', 'Normal'], warn: ['warn', 'Atenção'], bad: ['bad', 'Fora do normal'], info: ['info', 'Informação'], na: ['na', 'Sem leitura'] };
function explain(k){
  const d = sensorDef(k) || { name: k, unit: '', d: 1 }, e = EXPLAIN[k], c = ctxNow(), v = fresh(k, 15000);
  const p = d.pid != null ? PIDS[d.pid] : null;
  let lvl = 'na', msg = link ? 'Sem leitura agora. Toque em “Ler painel” ou o carro pode não informar este dado.' : 'Conecte o adaptador para ver a leitura.';
  if (v != null){
    const r = e?.judge?.(v, c);
    if (r){ [lvl, msg] = r; }
    else { lvl = 'info'; msg = p?.ref ? 'Faixa geral com motor quente em lenta: ' + p.ref + ' ' + (d.unit || '') + '.' : 'Valor lido da central do motor.'; }
  }
  // Linha de base do próprio carro, quando existe e a condição é comparável (lenta, motor quente)
  let base = '';
  const b = cfg.base[c.car]?.v[k];
  if (b){
    base = 'No <b>seu carro</b> (linha de base, lenta e motor quente): ' + fmtV(b[0], d.d) + ' a ' + fmtV(b[2], d.d) + ', média ' + fmtV(b[1], d.d) + ' ' + esc(d.unit) + '.';
    if (typeof v === 'number' && c.idle && c.warm){
      const pad = Math.max(Math.abs(b[2] - b[0]) * 0.5, Math.abs(b[1]) * 0.05);
      base += v < b[0] - pad || v > b[2] + pad ? ' <b class="c-bad">Agora está diferente do que foi medido.</b>' : ' Agora está parecido.';
    }
  }
  return { name: d.name, unit: d.unit, v: typeof v === 'number' ? fmtV(v, d.d) : v ?? '--', lvl, msg,
    what: e?.what || (p ? 'Dado “' + esc(d.name) + '” lido da central do motor pelo OBD-II.' : ''), causes: e?.causes || [], base };
}

let infoK = null, infoT = null;
function openInfo(k){
  infoK = k; renderInfo();
  if (!$('infoDlg').open) $('infoDlg').showModal();
  clearInterval(infoT); infoT = setInterval(() => $('infoDlg').open ? renderInfo() : clearInterval(infoT), 1000);
}
function renderInfo(){
  const x = explain(infoK), [cls, label] = LVL[x.lvl];
  $('infoBody').innerHTML =
    '<h2 id="infoTitle">' + esc(x.name) + '</h2>' +
    '<div class="ival"><b>' + esc(String(x.v)) + '</b> <span>' + esc(x.unit || '') + '</span> <span class="lvl lvl-' + cls + '">' + label + '</span></div>' +
    '<p class="imsg">' + x.msg + '</p>' +
    (x.what ? '<h3>O que é</h3><p>' + x.what + '</p>' : '') +
    (x.base ? '<h3>Comparando com o seu carro</h3><p>' + x.base + '</p>' : '') +
    (x.causes.length ? '<h3>Se estiver fora do normal</h3><ul>' + x.causes.map(t => '<li>' + t + '</li>').join('') + '</ul>' : '') +
    '<p class="small muted">Faixas gerais para motor a gasolina ou flex em bom estado, não são dados de fábrica. Na aba do seu carro, grave a linha de base para ter a referência dele.</p>';
}
$('infoClose').onclick = () => $('infoDlg').close();
$('infoDlg').addEventListener('click', e => { if (e.target === $('infoDlg')) $('infoDlg').close(); });
