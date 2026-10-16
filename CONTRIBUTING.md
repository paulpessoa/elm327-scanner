# Como contribuir

Obrigado pelo interesse! Este é um scanner OBD-II que roda no navegador. Contribuições de todo tamanho são bem-vindas: código, perfis de carros, textos explicativos, testes no seu carro, traduções e relatos de bug.

> **English speakers:** contributions are welcome too. The app and its texts are in Brazilian Portuguese, but issues and pull requests can be written in English. Look for issues labeled `good first issue` or `hacktoberfest`.

## Rodar o app em 1 minuto

Não tem build, framework nem dependências: é HTML, CSS e JavaScript puro.

```bash
git clone https://github.com/paulpessoa/elm327-scanner.git
cd elm327-scanner
python3 -m http.server 8000      # ou: npx serve .
```

Abra `http://localhost:8000` no **Chrome** ou no **Edge** e toque em **Modo demonstração**. Ele simula um adaptador ELM327 ligado a um motor virtual, então dá para trabalhar em quase tudo sem carro e sem adaptador.

O Bluetooth só funciona em `localhost` ou HTTPS, e não funciona dentro de iframe.

## Por onde começar

- Issues com **`good first issue`** são pequenas e bem explicadas.
- Issues com **`hacktoberfest`** estão abertas para o Hacktoberfest.
- Comente na issue antes de começar, para ninguém fazer a mesma coisa em dobro. Se ninguém respondeu em 2 dias, pode começar.
- Tem um carro e um adaptador ELM327? Testar no seu carro e contar o que aconteceu (aba **Log** → copiar) já é uma contribuição valiosa: abra uma issue com o modelo "Meu carro".

## Como o código está organizado

Cada arquivo em `js/` cuida de uma parte (a tabela completa está no [README](README.md#arquivos)). Os scripts são carregados em ordem pelo `index.html` e compartilham o escopo global, sem módulos.

Pontos importantes antes de mexer:

- **`js/engine.js`** tem o único laço que conversa com o adaptador. As telas pedem sensores com `need(nome, chaves)` e liberam com `release(nome)`. Não mande comandos ao ELM por fora dele, a não ser em ações do usuário (botões), e sempre por `cmd()`, que coloca os comandos em fila.
- **O ELM327 processa um comando por vez.** Dois fluxos de comandos ao mesmo tempo (por exemplo, duas detecções de protocolo) funcionam no modo demonstração, que responde em ~50 ms, mas quebram no carro, onde a busca do protocolo leva segundos. Se a sua mudança manda comandos, pense no que acontece se o carro demorar.
- **`js/config.js`** valida tudo que vem do armazenamento ou de um backup. Campo novo na configuração precisa ser incluído em `defaultCfg()` e em `sanitizeCfg()`.
- **Segurança:** a página tem CSP com `script-src 'self'`. Nada de script inline, `eval` ou bibliotecas de CDN. Todo texto que vem do usuário passa por `esc()` antes de ir para `innerHTML`.
- **Service worker:** se você adicionar um arquivo novo, inclua na lista `FILES` do `sw.js` e aumente o número em `CACHE`.

## Estilo

- Siga o jeito do código ao redor: funções curtas, nomes curtos, comentários em português explicando o **porquê**.
- Textos da interface em português do Brasil, simples, para quem não é mecânico.
- Sem dependências novas. Se achar que precisa de uma, abra uma issue antes.
- Teste no celular (ou no modo de dispositivo do DevTools): em pé e deitado.

## Enviando um pull request

1. Faça um fork e crie uma branch a partir de `main`.
2. Faça a mudança e teste no modo demonstração. Se puder, teste no carro.
3. Abra o PR explicando **o que** mudou, **por que** e **como testou**. Prints ajudam muito em mudanças visuais.
4. Um PR por assunto. PRs pequenos são revisados mais rápido.

PRs de spam (mudar só espaços, traduzir o README sem pedido, renomear coisas sem motivo) serão fechados e marcados como `invalid`.

## Segurança do carro

O app só **lê** dados pelo OBD-II genérico. A única escrita é apagar códigos de falha (`04`), sempre com confirmação. PRs que adicionem escrita na central, codificação ou qualquer comando específico de montadora não serão aceitos.

## Código de conduta

Ao participar, você concorda com o [Código de Conduta](CODE_OF_CONDUCT.md).
