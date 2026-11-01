# Design system — kit DesignSystems.one (handoff V4)

Revisado em 01/11/2026 (0.53, Entrega 0 do handoff V4). Os valores vêm do kit exportado do DesignSystems.one (`designsystems-tokens.zip`, kit `p=0077b6`, Figtree/Roboto, razão 1,2, densidade compacta), copiado **sem edição** em `src/styles/designsystems-tokens.css`. `src/styles/tokens.css` só dá aos nomes que o CSS do app usa um valor do kit; nenhuma cor, tamanho ou raio é escolhido ali. Para mudar a identidade, exportar o kit de novo e substituir o arquivo. A versão anterior (Inter, `#0077B6`, base 15 px) foi substituída por decisão do handoff V4 (seção 6).

## Cores

| Uso | Token do app | Valor do kit |
|---|---|---|
| Botão principal, marca, preenchimento de destaque | `--color-primary` | `primary-700` `#0078B8` (**exceção nomeada**: o `--color-brand` do kit é `primary-600` `#0093E0`, que dá só 3,36:1 com texto branco; o handoff V4 faz a mesma escolha para o Button/Primary) |
| Hover, links, texto pequeno sobre claro | `--color-primary-strong` | `primary-800` `#065C89` |
| Fundo de destaque, item ativo do menu | `--color-primary-soft` / `--color-brand-subtle` | `primary-50` `#F1F9FD` |
| Fundo da página / cartões | `--color-background` / `--color-surface` | `neutral-50` `#F7F8F8` / `#FFFFFF` |
| Títulos e valores / texto / secundário | `--color-ink` / `--color-text` / `--color-muted` | `neutral-900` `#2E3438` / `neutral-800` `#41494E` / `neutral-600` `#66737A` |
| Bordas | `--color-line` / `--color-line-strong` | `neutral-200` / `neutral-300` (nunca como texto) |
| Situações (texto sobre o fundo suave) | `--color-success-text`, `--color-warning-text`, `--color-error` | degrau `-800` de cada escala sobre o `-50` (**exceção nomeada**: `--color-success`, `--color-warning` e `--color-danger` do kit são os degraus vivos `-600`, para preenchimento, não para texto) |

O item ativo do menu usa fundo `--color-brand-subtle`, texto `primary-800` e uma barra lateral, para não depender só da cor. O modo escuro existe no kit e **não está ligado** (V4, DS-07).

Contrastes medidos (WCAG, relação de luminância):

| Par | Razão |
|---|---|
| Branco sobre `#0078B8` (botão) | 4,80:1 |
| Branco sobre `#065C89` | 7,24:1 |
| `#065C89` sobre `#F1F9FD` (item ativo) | 6,80:1 |
| `#0078B8` sobre branco / sobre `#F7F8F8` | 4,80:1 / 4,51:1 |
| `#2E3438` sobre `#F7F8F8` | 11,86:1 |
| `#41494E` sobre branco | 9,18:1 |
| `#66737A` sobre branco / `#F7F8F8` / `#F1F9FD` | 4,89:1 / 4,59:1 / 4,59:1 |
| `#15793F` sobre `#F3FCF7` | 5,23:1 |
| `#7B5514` sobre `#FCF9F3` | 6,34:1 |
| `#791515` sobre `#FCF3F3` | 9,97:1 |

## Tipografia

Figtree (400, 700) no corpo e Roboto (500, 700) nos títulos, servidas pelo próprio app (`@fontsource`, sem Google). Base de 16 px e a escala do kit (`--font-size-xs` a `--font-size-6xl`, razão 1,2). O CSS da aplicação usa só degraus da escala; a página pública dos sites e o editor visual têm tipografia própria, escolhida pelo profissional, e não foram tocados.

## Forma e superfícies

- Plano: sem gradiente, sem brilho colorido, sem sombra em botões. Cartões usam borda e uma sombra mínima.
- Raios do kit: botões `--radius-full`, campos `--radius-xl` (30 px), cartões `--radius-md` (12 px), painéis `--radius-lg` (18 px). Sombras do kit (`--shadow-sm` nos cartões), espaçamento pela escala compacta (`--spacing-N`).
- Botões principais com no mínimo 52px de altura; os pequenos, 40px. Foco visível de 3px em `primary-700` (`#0078B8`).
- Estados semânticos usam texto e fundo suaves da mesma família, nunca só cor: sempre há rótulo.

## Estrutura da interface

- **Profissional** (handoff V4, seção 5): sidebar com `TRAINER / RX · WORKSPACE PROFISSIONAL` e os 10 destinos em três grupos (PRINCIPAL, COMERCIAL, CONTA E EQUIPE); o nome do espaço fica na barra superior. O item ativo vem do mapa de rotas (`activeSlug` em `src/modules/platform/surfaces.ts`): o plano de um aluno acende Planos e treinos, o resto do aluno acende Alunos (avaliação aberta dentro do aluno também fica em Alunos), o Simulador de ciclos acende Planos e treinos.
- **Gestor e aluno**: menu agrupado, cartão com o papel e o contexto, barra superior com troca de área e saída. Módulos ainda inexistentes mostram a etiqueta **Em breve**.
- **Celular** (até 860px): o profissional abre o menu pelo botão **Menu** da barra superior, numa gaveta lateral com fundo escurecido, **Fechar**, foco preso dentro dela, Escape e toque fora para fechar e o foco devolvido ao botão; gestor e aluno mantêm a barra inferior de atalhos com a mesma gaveta. Tabelas viram cartões rotulados; sem rolagem horizontal da página.
- **Demonstração**: faixa escura fixa no topo (neutra, não é cor de papel) avisando que os dados são fictícios.
- Ícones: Lucide, como substitutos; não há equivalência declarada com os vetores do Figma.

## Acessibilidade

Link de pular para o conteúdo, landmarks por área, `aria-current` na navegação, abas com `role="tablist"` e setas, formulários com rótulo, mensagens de erro em `role="alert"`, `prefers-reduced-motion` respeitado. Os testes de navegador conferem ausência de rolagem horizontal nas telas principais, em desktop e celular.
