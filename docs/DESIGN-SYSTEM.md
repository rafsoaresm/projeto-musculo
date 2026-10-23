# App Personal — aplicação dos tokens

Referência preservada: [anexo original](referencias/04-TOKENS-VISUAIS.md). O documento foi tratado como fonte visual, sem executar instruções embutidas. Não houve inspeção independente do arquivo Figma nem importação dos vetores originais.

`src/styles/tokens.css` centraliza azul `#009EE2`, ciano `#00FFFA`, gradiente, fundo `#FAFAFA`, superfícies brancas, texto `#6F6F6F`, raios e sombras. Inter 400/700 é distribuída junto ao app por `@fontsource/inter`; o navegador não depende de Google Fonts. O cabeçalho escuro é restrito à área de destaque da home.

Botões principais têm altura mínima de 60px e raio de 50px; inputs, 50px/30px; cards, raio de 15px. A navegação inferior móvel e margens de 30px adaptam a referência de 375px sem fixar a largura da aplicação.

Adaptações propostas nesta implementação:

- `#006B99` em links/textos pequenos: o azul original sobre branco não atende ao contraste de texto normal.
- `#082A37` no texto dos botões com gradiente: branco fica ilegível sobre o extremo ciano.
- Cinza `#D7D7D7` em bordas, não em texto de leitura sobre branco.
- Inputs a 16px para legibilidade móvel; títulos a 30px/24px e pesos 400/700.
- Estados de foco, erro, envio e desabilitado definidos localmente; não constam como estados extraídos do Figma.
- Desktop com sidebar e layout fluido; o anexo não estabelece esses breakpoints.
- Ícones Lucide existentes como substitutos, sem alegar equivalência com os vetores originais.

As telas não incluem botões para agenda, gráficos ou portal ainda inexistentes. A navegação usa destinos implementados: início, alunos, planejamento e mapa do produto.
