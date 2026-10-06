# ELM327 Scanner

Scanner OBD-II que roda no navegador (Chrome/Edge) e conversa com adaptadores ELM327 via **Web Bluetooth** (BLE) ou **Web Serial** (Bluetooth clássico/USB). Sem build, sem conta e sem servidor: tudo fica no aparelho.

## O que faz
- **Painel personalizável** (inspirado nos apps de painel de carro): várias páginas, mostradores de **ponteiro, arco, digital, barra, barra vertical e gráfico**, cada um com escala, cor, tamanho, marca de pico, mín/méd/máx e **histórico embutido** (10 s a 15 min). Toque e segure para configurar. Tela cheia deitada para usar no suporte.
- **Alertas por sensor** (mínimo e máximo): o mostrador fica vermelho, toca, vibra e manda notificação do sistema. Tem atraso e histerese para não ficar disparando no limite.
- **Sondas lambda**: osciloscópio da pré e da pós-catalisador com leitura prioritária, trocas por 10 s, frequência, amplitude, tempo no rico, tempo de resposta, **índice do catalisador**, diagnóstico automático (só julga em malha fechada) e **teste de resposta** (acelerar e soltar). Suporta sondas de banda larga.
- **Consumo e viagem** calculados: L/h, km/L instantâneo, média, distância, litros e custo. Usa o MAF ou, sem ele, a pressão do coletor (speed-density). Calibração pelo posto.
- **Fora do app**: manter tela ligada, **janela flutuante** (picture-in-picture, por cima de outros apps), valores no **player da tela bloqueada** do Android e notificação fixa.
- **Tensão** da bateria (`ATRV`) com gráfico e calibração (`ATCV`)
- **Ficha**: versão, teste de clone, protocolo, PIDs suportados, padrão OBD, combustível, VIN e serviços GATT
- **Sensores**: todos os PIDs do modo 01 que a ECU suporta, com gravação em CSV (`;` e vírgula decimal, para o Excel em português)
- **Falhas**: lê (`03`), pendentes (`07`) e apaga (`04`) códigos; monitores de prontidão e congelamento (`02`)
- **Meu C3**: perfil do Citroën C3 2010 1.4 TU3JP, valores de referência e roteiro de teste
- **Exportar e perguntar à IA** em toda tela; **Relatório completo** junta tudo num JSON
- **Backup**: exporta e importa painéis, alertas, viagem e ajustes para levar a outro aparelho
- **Modo demonstração**: um ELM327 simulado com motor virtual (CAN), para testar sem carro
- Funciona **offline** e pode ser instalado como app (PWA)

## Como a leitura funciona
Um único laço (`js/engine.js`) atende todas as telas. Cada tela pede os sensores que quer; as sondas lambda entram como "rápidas" e são lidas em toda volta. Em carros CAN, até 6 PIDs vão num só pedido, o que leva o simulador a ~50 leituras/s (adaptadores reais BLE costumam fazer 10–25 em CAN e 3–8 em K-line).

## Arquivos
| Arquivo | Conteúdo |
|---|---|
| `index.html`, `app.css` | Página e estilos |
| `js/core.js` | Transporte BLE/Serial, protocolo ELM327, PIDs, ficha, falhas, exportação |
| `js/config.js` | Configuração local e validação de tudo que é importado |
| `js/engine.js` | Laço de leitura, multi-PID, histórico, sensores calculados |
| `js/gauges.js`, `js/dash.js` | Mostradores e painel |
| `js/alerts.js`, `js/lambda.js`, `js/outside.js` | Alertas, osciloscópio das sondas, exibição fora do app |
| `js/settings.js`, `js/demo.js`, `js/main.js` | Ajustes/backup, simulador, inicialização |
| `sw.js`, `manifest.webmanifest` | Offline, notificações e instalação |

## Segurança e privacidade
- Nenhum dado sai do aparelho (a não ser quando o usuário escolhe exportar ou perguntar a uma IA).
- `Content-Security-Policy` com `script-src 'self'`: nenhum script inline ou de outro domínio roda.
- Backups importados são reconstruídos campo a campo (chaves conhecidas, números com limites, textos curtos); textos são sempre escapados ao aparecer na tela.

## Rodar localmente
```bash
python3 -m http.server 8000
# abrir http://localhost:8000 no Chrome
```
O Bluetooth exige HTTPS ou `localhost`, e não funciona se a página estiver dentro de um iframe.

## Compatibilidade
| | BLE | Bluetooth clássico (SPP) | Janela flutuante | Tela bloqueada |
|---|---|---|---|---|
| Chrome Android | ✅ | depende da versão | ✅ | ✅ (player de mídia) |
| Chrome Windows/Mac | ✅ | ✅ (117+) | ✅ | controle de mídia |
| iPhone | só pelo app Bluefy | ❌ | ❌ | ❌ |
