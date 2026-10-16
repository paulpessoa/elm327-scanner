# Visão: arquitetura, ideias e produto

Documento de estudo. Primeiro, os conceitos que o app já usa (com o nome que eles têm na literatura, para você pesquisar). Depois, as ideias novas vistas a partir do que já existe e outros usos. No fim, o que já foi feito e como.

---

## 1. O que o app já é, por dentro

O app é um **pipeline de telemetria local-first**. Os dados atravessam cinco camadas:

```
Adaptador ELM327
   │  bytes (BLE / Serial / Demo)
   ▼
[1] Transporte      core.js: link.send(), onData()        → Adapter pattern
   ▼
[2] Protocolo       core.js: cmd(), rawCmd(), settle()    → fila serial, enquadramento pelo '>'
   ▼
[3] Agendador       engine.js: need()/release(), plan()   → polling por demanda, prioridade, lotes
   ▼
[4] Armazém         engine.js: store, emit('value')       → série temporal em memória + pub/sub
   ▼
[5] Consumidores    dash, alerts, lambda, trips, health…  → cada tela só escuta e pede
```

### Padrões que valem estudar

| No código | Nome do conceito | Por que existe |
|---|---|---|
| `link` com `send()` igual para BLE, Serial e Demo | **Adapter / Port & Adapters (arquitetura hexagonal)** | O resto do app não sabe de onde vêm os bytes. Por isso o modo demonstração funciona de verdade. |
| `cmd()` encadeando promessas em `queue` | **Fila serial / mutex com Promise** | O ELM é *half-duplex*: um comando por vez. Duas telas pedindo juntas embaralhariam as respostas. |
| `onData()` cortando no `>` | **Enquadramento (framing) por delimitador** | O fluxo de bytes não tem "mensagens"; o prompt `>` marca o fim de cada resposta. |
| `settle()` esperando o `>` atrasado | **Ressincronização de protocolo** | Sem isso, uma resposta atrasada vira a resposta do próximo comando para sempre. Bug clássico de serial. |
| `need(nome, chaves)` / `release(nome)` | **Assinatura com contagem de referência / polling dirigido por demanda** | Só se lê o que alguém está mostrando. Menos PIDs, mais leituras por segundo. |
| `plan()` com rápidos e lentos | **Escalonamento por prioridade com round-robin** | As sondas precisam de taxa alta; a temperatura não. |
| até 6 PIDs num pedido em CAN | **Batching** | Cada ida e volta Bluetooth custa caro (latência). Um pedido com 6 rende 6 leituras. |
| `engine.dead` (3 falhas, desiste do PID) | **Circuit breaker** simplificado | Um PID que não responde não pode travar o laço todo. |
| `store` com `ht`/`hv` e busca binária em `since()` | **Série temporal em memória, janela deslizante** | Histórico de 15 min para os gráficos sem crescer sem limite. |
| `emit` / `engineOn` | **Observer / pub-sub** | Alertas, viagens e painel reagem ao mesmo valor sem se conhecerem. |
| `CALC` + `deps()` | **Sinais derivados com grafo de dependência** | "km/L" não é um PID; depende de MAF ou MAP+RPM+IAT, e o agendador lê o que faltar. |
| alertas com atraso e histerese | **Debounce e histerese** (processamento de sinal) | Um valor oscilando no limite não pode tocar 10 vezes por segundo. |
| `sanitizeCfg` | **Validação na fronteira de confiança** | Backup importado é entrada externa. Reconstruir campo a campo é o jeito seguro. |
| `demo.js`, um ELM falso no nível do transporte | **Test double / simulação de hardware** | Permite desenvolver sem carro. Para um produto, isso vale ouro. |
| `sw.js`, rede primeiro e cache depois | **PWA offline / network-first** | Abre na garagem sem sinal. |

### Limites atuais (o que um produto pediria)

- **Escopo global e ordem dos `<script>`**: tudo se enxerga e a ordem em `index.html` importa. Funciona até umas 5 mil linhas. O passo natural é **ES modules** (`<script type="module">`, `import/export`), ainda sem build.
- **`localStorage` (~5 MB, síncrono)** serve para configuração e não para gravação de viagem. Gravar em amostras pede **IndexedDB**.
- **Sem testes automatizados.** O simulador já existe, então os testes podem rodar contra ele.
- **Só modo 01 (genérico).** Dados de fabricante (modo 22/UDS: ABS, airbag, câmbio, bateria de elétrico) exigem trocar o cabeçalho (`ATSH`) e uma lista de PIDs por modelo.
- **Web Bluetooth não existe no iPhone.** Para ter metade do mercado, um dia isso vira app nativo (Capacitor, React Native, Flutter) reaproveitando o núcleo.

---

## 2. As ideias, vistas a partir do código

A ordem sugerida no texto colado está boa. O ajuste é que **gravar a viagem é a fundação das outras três**:

- o score é uma análise da gravação;
- o "VAR" de velocidade é outra análise da gravação;
- a telemetria ao vivo é a gravação enviada enquanto acontece;
- os eventos de atenção são mais uma trilha da gravação.

Então a decisão de arquitetura mais importante é **um formato único de amostra**, definido antes de qualquer tela.

### 2.1 Gravação e reprodução (fazer primeiro)

O que já existe: o `store` guarda 15 min em memória, e `trips.js` resume cada viagem (contadores) no `cfg.runs`. Falta guardar **as amostras**, não só o resumo.

Proposta:

```
Amostra = { t, k, v }               // tempo, chave (p0D, c:kml, gps:lat…), valor
Viagem  = { id, carro, t0, t1, resumo }  →  IndexedDB: 'viagens' e 'amostras' (índice [viagem, t])
```

- Um **gravador** se inscreve em `engineOn('value')` e grava em lotes (a cada 1–2 s, não a cada valor). É o padrão **append-only log / event log**.
- Grave em formato "longo" (`t, k, v`) e não numa tabela com colunas fixas: cada carro suporta PIDs diferentes.
- **Reprodução reaproveitando o app inteiro:** um "transporte de reprodução" (irmão do `demo.js`) ou um player que chama `store.set(k, v, t)` com os valores gravados. Assim **todos os mostradores, alertas e gráficos funcionam no replay sem código novo**. É o mesmo truque do modo demonstração.
- Segundo nível, opcional e muito útil para contribuidores: gravar os **bytes crus** do ELM (`→ 010C` / `← 41 0C 1A F8`). Com isso, o problema do carro de alguém vira um arquivo que você reproduz em casa (**record/replay de hardware**).
- Mapa: MapLibre GL ou Leaflet com o traçado colorido por métrica e um cursor de tempo ligado aos gráficos.

### 2.2 Score de condução (sem câmera)

Metade já existe: `trips.js` conta acelerações e frenagens fortes (`ST.acc`, `ST.brk`), giro alto, tempo acima de 110 e dá o estilo (pé leve, moderado, pesado). Falta:

- **DeviceMotion** para o g lateral (curvas), que o OBD não mede. O celular precisa estar preso no suporte, e a orientação dele tem que ser calibrada (vetor da gravidade com o carro parado).
- Calcular o score **a partir da gravação** (2.1), para poder recalcular quando os critérios mudarem.
- Manter os critérios visíveis, como já é feito hoje. Isso é diferencial de confiança.

### 2.3 Telemetria ao vivo (rali, equipe de apoio)

É o primeiro recurso que tira dados do aparelho, e isso muda a natureza do projeto:

- Passa a ter **servidor, conta, custo mensal e LGPD**. Supabase Realtime ou um WebSocket simples (Cloudflare Durable Objects, por exemplo) resolvem.
- Padrão **outbox**: a amostra vai primeiro para o IndexedDB (2.1) e um enviador sobe o que falta quando houver sinal. A gravação local é a mesma; o envio é só um consumidor a mais.
- O link da sessão precisa ter um token, expirar e ser compartilhado de propósito pelo usuário.

### 2.4 Atenção do motorista (câmera)

É a ideia de maior risco, e não por causa da técnica:

- **Conflito físico:** o celular no suporte aponta para a estrada ou para o motorista, não para os dois.
- **CPU e bateria:** o MediaPipe disputa o processador com o laço do Bluetooth, e o app já sofre com o navegador pausando JS em segundo plano.
- **Responsabilidade:** se for vendido como "detecta sono" e falhar, o problema é sério. Se fizer, apresente como **registro**, nunca como dispositivo de segurança.
- Deixe para o fim, como módulo separado e opcional, gravando só eventos na mesma trilha (2.1).

---

## 3. Onde mais isso serve

### Com carro (o mesmo app, outro público)

| Público | O que já resolve | O que falta |
|---|---|---|
| **Quem vai comprar carro usado** | Prontidão dos monitores e "distância desde a limpeza" (PID 31) mostram **códigos apagados pouco antes da venda** | Um "laudo de vistoria" de 2 minutos, em PDF |
| **Motorista de app (Uber/99)** | Custo por km, etanol x gasolina, manutenção | Relatório mensal e várias viagens por turno |
| **Frotas pequenas** | Tudo do motorista de app | Painel web com vários carros. Aí entra servidor (2.3). |
| **Oficinas** | Relatório completo em JSON | Relatório bonito para o cliente final e histórico por placa |
| **Autoescolas e seguradoras (seguro por uso, UBI)** | Score de condução | Gravação confiável e à prova de adulteração |
| **Track day e rali** | Painel e alertas | Gravação, setores e volta fantasma |

### Sem carro (o mesmo padrão em outro hardware)

O núcleo (transporte, fila serial, agendador por demanda, série temporal, alertas com histerese, simulador) não é específico de carro. Qualquer aparelho que "responde a perguntas por serial ou BLE" encaixa:

- **Caminhões e máquinas agrícolas:** J1939 sobre CAN, com adaptador diferente.
- **Baterias com BMS Bluetooth** (solar, carrinho elétrico, motorhome): tensão das células, temperatura, ciclos.
- **Inversores solares e medidores de energia:** Modbus RTU via USB-serial.
- **Impressoras 3D e CNC:** G-code por serial, com o mesmo problema de "um comando por vez, espera o `ok`".
- **Sensores BLE de saúde e esporte** (cinta cardíaca, potência na bike, balança): GATT padrão, sem nem precisar de fila.

Se um dia virar produto, a parte valiosa e reutilizável é esse núcleo. Vale isolá-lo em módulos com uma fronteira clara: transporte → protocolo → agendador → armazém.

---

## 4. O que já foi feito e como

Os quatro itens do grupo "agora" estão no branch `claude/visao-produto`. Cada um usa um padrão que vale reconhecer:

| Recurso | Onde | Como funciona | Padrão |
|---|---|---|---|
| **Vistoria de usado** | `js/inspect.js`, Ferramentas | Roteiro fixo de leituras (luz, monitores, códigos 03/07/0A, contadores "desde a limpeza" 30/31/4E, chassi e 20 s de motor ligado) e um conjunto de regras que dá nível a cada achado. Imprime só o laudo (`@media print`). | **Motor de regras** simples: dados primeiro, julgamento depois (`inspJudge` não faz I/O, então dá para testar com dados inventados) |
| **Gravação da viagem** | `js/rec.js` | Escuta `engineOn('value')`, o GPS (`gpsfix`) e os eventos de direção (`drive`) e grava `[tempo, chave, valor]` no IndexedDB em pedaços de 5 s. Guarda as 30 viagens mais recentes. | **Append-only log**, **observer** por eventos (`runstart`, `runend`, `drive`): `trips.js` não sabe que a gravação existe |
| **Rever a viagem** | `js/rec.js`, tela Rever viagem | A gravação vira uma "fonte" com a mesma interface do `store` (`get`, `since`), parada no momento escolhido. `gaugeState(w, agora, fonte)` e `renderGauge` desenham o painel do usuário sem código novo. Linha do tempo e trajeto do GPS em canvas, sem mapa externo. | **Injeção de dependência**: o mostrador recebe de onde ler em vez de ler sempre do `store` |
| **Curvas no estilo** | `js/motion.js`, `js/trips.js` | O acelerômetro dá a aceleração no plano do chão; a velocidade do OBD dá a parte de frente/trás. Lateral = √(horizontal² − longitudinal²), sem calibrar a posição do celular. Vira o sensor `c:glat` e `trips.js` conta as curvas fortes. | **Fusão de sensores** simplificada e **sinal derivado** no mesmo `store` |

O simulador (`demo.js`) ganhou os contadores "desde a limpeza" e a resposta ao modo 0A, e uma viagem pode ser começada à mão no modo demonstração. Assim tudo isso dá para testar sem carro.

## 5. Próximos passos sugeridos

1. **Testar no carro:** vistoria com motor frio e quente; uma viagem com o sensor de movimento ligado, para calibrar o limite de 0,35 g.
2. **Mapa com fundo** (MapLibre ou Leaflet) por cima do trajeto que já é gravado. É a primeira dependência externa: exige liberar o domínio dos mapas na CSP.
3. **Migrar para ES modules**: `rec.js`, `motion.js` e `inspect.js` já são quase independentes e são os candidatos naturais a começar.
4. **Testes automatizados** contra o simulador, como os que foram usados para validar estes recursos (Chrome sem janela abrindo o modo demonstração).
5. Depois: telemetria ao vivo e câmera, nessa ordem.
