# Design system — azul sólido

Revisado em 23/10/2026. A versão anterior aplicava o gradiente ciano→azul da referência App Personal em botões, navegação ativa e marca. Ele foi **removido por completo**: a interface usa um único azul chapado. A referência original continua preservada em [`referencias/04-TOKENS-VISUAIS.md`](referencias/04-TOKENS-VISUAIS.md); as instruções do anexo não foram tratadas como pedidos de execução.

Tudo está em `src/styles/tokens.css` (tokens) e `src/app/globals.css` (componentes). Para trocar o azul da marca, altere apenas `--color-primary`, `--color-primary-strong` e `--color-primary-soft`.

## Cores

| Token | Valor | Uso |
|---|---|---|
| `--color-primary` | `#0077B6` | Botões principais, item de menu ativo, marca, hero |
| `--color-primary-strong` | `#005F92` | Hover, links, textos pequenos sobre fundo claro, foco |
| `--color-primary-soft` | `#E8F3FA` | Avisos, ícones, fundos de destaque |
| `--color-ink` | `#1F2933` | Títulos e valores |
| `--color-text` / `--color-muted` | `#4A5560` / `#5A6470` | Texto corrido e secundário |
| `--color-background` / `--color-surface` | `#F5F7F9` / `#FFFFFF` | Fundo da página e dos cartões |
| `--color-line` | `#D7DDE3` | Bordas (nunca como texto) |
| `--color-success`, `-warning`, `-error` | `#1B6E3C`, `#8A5A00`, `#A52434` | Situações, sobre fundos `-soft` |

Mudanças em relação à referência: o ciano `#00FFFA` e o gradiente saíram; o azul `#009EE2` foi substituído por `#0077B6` porque o original dá 3,00:1 com texto branco (abaixo dos 4,5:1 da WCAG AA para texto normal) e obrigava a usar texto escuro no botão. Com `#0077B6` o texto branco tem 4,87:1.

Contrastes verificados (relação de luminância WCAG):

| Par | Razão |
|---|---|
| Branco sobre `#0077B6` | 4,87:1 |
| Branco sobre `#005F92` | 6,88:1 |
| `#005F92` sobre branco / sobre `#F5F7F9` | 6,88:1 / 6,41:1 |
| `#4A5560` sobre branco | 7,61:1 |
| `#5A6470` sobre branco / `#E8F3FA` | 6,01:1 / 5,34:1 |
| `#1B6E3C` sobre `#E6F4EA` | 5,53:1 |
| `#8A5A00` sobre `#FFF4D6` | 5,41:1 |
| `#A52434` sobre `#FFF2F3` | 6,63:1 |

## Forma e superfícies

- Plano: sem gradiente, sem brilho colorido, sem sombra em botões. Cartões usam borda e uma sombra mínima.
- Mantidos da referência: Inter 400/700 distribuída com o app (`@fontsource/inter`), botões com raio de 50px, campos de 30px, cartões de 15px.
- Botões principais com no mínimo 52px de altura; os pequenos, 40px. Foco visível de 3px em `#005F92`.
- Estados semânticos usam texto e fundo suaves da mesma família, nunca só cor: sempre há rótulo.

## Estrutura da interface

- **Áreas com sidebar** (gestor, profissional, aluno): menu agrupado, cartão com o papel e o contexto, barra superior com troca de área e saída. O item ativo é azul sólido; módulos ainda inexistentes mostram a etiqueta **Em breve**.
- **Celular** (até 860px): barra inferior com os atalhos principais e **Menu** com a navegação completa; tabelas viram cartões rotulados; sem rolagem horizontal da página.
- **Demonstração**: faixa escura fixa no topo (neutra, não é cor de papel) avisando que os dados são fictícios.
- Ícones: Lucide, como substitutos; não há equivalência declarada com os vetores do Figma.

## Acessibilidade

Link de pular para o conteúdo, landmarks por área, `aria-current` na navegação, abas com `role="tablist"` e setas, formulários com rótulo, mensagens de erro em `role="alert"`, `prefers-reduced-motion` respeitado. Os testes de navegador conferem ausência de rolagem horizontal nas telas principais, em desktop e celular.
