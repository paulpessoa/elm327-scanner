# ELM327 Scanner

Scanner OBD-II que roda no navegador (Chrome/Edge) e conversa com adaptadores ELM327 via **Web Bluetooth** (BLE) ou **Web Serial** (Bluetooth clássico/USB). Arquivo único, sem build.

## O que faz
- **Tensão** da bateria (`ATRV`) com gráfico, mín/méd/máx e calibração (`ATCV`)
- **Ficha**: versão, descrição, teste de clone, protocolo do carro, PIDs suportados, luz de injeção, padrão OBD, combustível, chassi (VIN) e serviços GATT. Pode ser exportada em JSON ou texto.
- **Sensores**: todos os PIDs do modo 01 (SAE J1979) que a ECU suporta, com referências e gravação em CSV (`;` e vírgula decimal, compatível com o Excel em português)
- **Falhas**: lê (`03`), mostra pendentes (`07`) e apaga (`04`) os códigos de falha. Também traz os monitores de prontidão e o congelamento da falha (`02`)
- **Meu C3**: perfil do Citroën C3 2010 1.4 TU3JP, com valores de referência e roteiro de teste
- Detecção de protocolo com reserva: se o automático falhar, testa um protocolo por vez (comum em clones)
- **Referência**: pinagem J1962, protocolos, comandos AT e fórmulas
- **Log** e envio de comando manual
- **Exportar e perguntar à IA**: toda tela tem *Copiar JSON*, *Baixar JSON* e *Perguntar à IA*. No celular abre a folha de compartilhar (ChatGPT, Gemini, Claude); no computador copia a pergunta e abre o ChatGPT ou o Claude já preenchidos. A aba *Meu C3* tem o **Relatório completo** (ficha + falhas + sensores + tensão num JSON só)

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
