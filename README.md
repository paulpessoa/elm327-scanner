# ELM327 Scanner

Scanner OBD-II que roda no navegador (Chrome/Edge) e conversa com adaptadores ELM327 via **Web Bluetooth** (BLE) ou **Web Serial** (Bluetooth clássico/USB). Arquivo único, sem build.

## O que faz
- **Tensão** da bateria (`ATRV`) com gráfico, mín/méd/máx e calibração (`ATCV`)
- **Ficha**: versão, descrição, teste de clone, protocolo do carro, PIDs suportados, luz de injeção, padrão OBD, combustível, chassi (VIN) e serviços GATT. Pode ser exportada em JSON ou texto.
- **Ao vivo**: RPM, velocidade, temperaturas, carga, borboleta, MAP, combustível, etanol e tensão da ECU
- **Falhas**: lê (`03`), mostra pendentes (`07`) e apaga (`04`) os códigos de falha
- **Referência**: pinagem J1962, protocolos, comandos AT e fórmulas
- **Log** e envio de comando manual

## Rodar localmente
```bash
python3 -m http.server 8000
# abrir http://localhost:8000 no Chrome
```
O Bluetooth exige HTTPS ou `localhost`, e não funciona se a página estiver dentro de um iframe.

## Compatibilidade
| | BLE | Bluetooth clássico (SPP) |
|---|---|---|
| Chrome Android | ✅ | depende da versão |
| Chrome Windows/Mac | ✅ | ✅ (117+) |
| iPhone | só pelo app Bluefy | ❌ |
