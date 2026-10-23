# App Personal — Design Tokens & Especificações Visuais

> **Fonte:** [App_Personal no Figma](https://www.figma.com/design/PQspMKHqG16lg6UpIphV7f/App_Personal?node-id=0-1)  
> **Arquivo Figma:** `PQspMKHqG16lg6UpIphV7f`  
> **Levantamento:** 23/10/2026  
> **Objetivo:** referência de UI para implementação, manutenção e eventual formalização de um design system.

## 1. Como interpretar este documento

Este levantamento foi realizado diretamente no arquivo Figma, consultando **estilos locais**, **componentes** e **propriedades das camadas das telas**.

**Níveis de evidência** usados ao longo do documento:

- **[Figma • estilo]** — valor já registrado como *style* local do arquivo.
- **[Figma • camada]** — valor encontrado em uma ou mais camadas, mas sem necessariamente existir como token nomeado.
- **[Proposto]** — nome semântico ou abstração sugerida para o código; **não** corresponde a uma variável previamente cadastrada.

### Inventário da fonte

| Recurso | Encontrado | Observação |
|---|---:|---|
| Páginas | 2 | `App` e `Assets` |
| Telas principais | 20 | Frames na página `App`; a página também contém setas, legendas e materiais avulsos |
| Variáveis locais | **0** | Não há coleções de Figma Variables cadastradas |
| Estilos locais de cor (*Paint Styles*) | **4** | `grad_1`, `blue_1`, `bg_1`, `Gray_1` |
| Estilos locais de texto | **2** | `title`, `text` |
| Estilos locais de efeito | **1** | `drop_buttons` |
| Componentes da página `Assets` | **3** | `arrow_back`, `Button_1`, `Button_2` |

**Importante:** cores e tipografias também aparecem em camadas com outros nomes, por exemplo `Grey_01`, `Grey_02`, `White`, `Intern Bold Size 18`. Esses nomes podem ser apresentados no contexto da camada, mas **não integram o inventário de styles locais** acima. O projeto atualmente mistura estilos reutilizáveis com propriedades aplicadas diretamente às camadas.

---

## 2. Cores

### 2.1 Paleta principal

| Token semântico sugerido | Valor HEX | Nome ou origem no Figma | Uso identificado | Status |
|---|---|---|---|---|
| `color.primary` | `#009EE2` | `blue_1` | CTAs secundários, títulos de cards, links e elementos de destaque | **[Figma • estilo]** |
| `color.background.default` | `#FAFAFA` | `bg_1` | Superfícies claras e fundos de áreas de conteúdo | **[Figma • estilo]** |
| `color.neutral.300` | `#D7D7D7` | `Gray_1` | Ícones desativados, textos discretos, contornos e sombras | **[Figma • estilo]** |
| `color.text.primary` | `#6F6F6F` | `Grey_01` nas telas | Textos correntes, labels e títulos neutros | **[Figma • camada]** |
| `color.surface.default` | `#FFFFFF` | `White` / `White_01` nas telas | Cards, campos, botões secundários e navegação | **[Figma • camada]** |
| `color.background.dark` | `#1D1D1D` | Camadas de `home_screen` | Área superior escura da tela inicial | **[Figma • camada]** |
| `color.neutral.black` | `#000000` | Algumas camadas | Preto pontual/elementos auxiliares | **[Figma • camada]** |
| `color.accent.cyan` | `#00FFFA` | Primeira parada de `grad_1` | Início do gradiente primário | **[Figma • estilo]** |

Também foi encontrado `#C2C2C2` em traços isolados. Não foi identificado como cor semântica principal.

### 2.2 Gradiente de marca

**`grad_1` [Figma • estilo]**

- Tipo: linear.
- Cor inicial: `#00FFFA`.
- Cor final: `#009EE2`.
- Direção no componente `Button_1`: **esquerda → direita**.
- Opacidade das duas paradas: `100%`.

```css
/* Equivalente visual documentado pelo componente Button_1 */
background: linear-gradient(90deg, #00fffa 0%, #009ee2 100%);
```

O gradiente aparece no botão primário e em elementos selecionados/ativos da navegação e de ações.

### 2.3 Aplicações semânticas sugeridas

| Contexto | Valor recomendado a partir do layout | Evidência |
|---|---|---|
| Texto principal em fundo claro | `#6F6F6F` | [Figma • camada] |
| Texto de destaque / link | `#009EE2` | [Figma • camada] |
| Texto sobre fundo escuro | `#FFFFFF` | [Figma • camada] |
| Texto de menor ênfase | `#D7D7D7` | [Figma • camada] |
| Superfície de formulário e card | `#FFFFFF` | [Figma • camada] |
| Fundo geral claro | `#FAFAFA` | [Figma • estilo] |
| Cabeçalho da home | `#1D1D1D` | [Figma • camada] |
| Ação primária | Gradiente `grad_1` | [Figma • estilo] |

---

## 3. Tipografia

### 3.1 Família e pesos

- **Família predominante:** `Inter`.
- **Pesos utilizados nos componentes principais:** `400 (Regular)` e `700 (Bold)`.
- **Espaçamento entre letras:** `0` nos textos inspecionados.
- Foi encontrado um uso pontual de `Roboto Medium` no arquivo, sem caracterizar a tipografia central do app.

### 3.2 Text styles cadastrados

| Style local | Família | Peso | Tamanho | Altura de linha | Tracking | Evidência |
|---|---|---:|---:|---|---:|---|
| `title` | Inter | 700 | `30px` | `AUTO` | `0` | **[Figma • estilo]** |
| `text` | Inter | 400 | `12px` | `150%` = `18px` | `0` | **[Figma • estilo]** |

### 3.3 Escala tipográfica observada nas telas

Os itens abaixo são padrões **observados nas camadas**, não uma lista adicional de estilos locais cadastrados.

| Token sugerido | Tamanho | Peso | Linha observada / nota | Exemplo de uso | Evidência |
|---|---:|---:|---|---|---|
| `font.display` | `30px` | 700 | `AUTO` | Título “Bem-vindo” | [Figma • estilo `title`] |
| `font.heading.lg` | `28px` | 400 | `AUTO` | Saudação secundária da home | [Figma • camada] |
| `font.heading.md` | `24px` | 700 | `AUTO` | “Login”, “Cadastre-se”, “Complete suas informações” | [Figma • camada] |
| `font.heading.sm` | `18px` | 700 | `20px` | Títulos de cards e texto de botões | [Figma • camada] |
| `font.body.md` | `16px` | 400 | Varia conforme a camada | Textos intermediários de telas/formulários | [Figma • camada] |
| `font.body.sm` | `12px` | 400 | Frequente: `150%` = `18px` | Descrições, campos, metadados | [Figma • estilo `text` / camadas] |
| `font.label.sm` | `12px` | 700 | Frequente: `150%` | Dias/datas e rótulos enfatizados | [Figma • camada] |
| `font.label.compact` | `13px` | 700 em usos identificados | Varia | Textos compactos | [Figma • camada] |

Outros tamanhos pontuais encontrados: `10px`, `32px` e `128px` (incluindo elementos especiais/visuais). **Não** devem ser automaticamente promovidos a tokens globais.

### 3.4 Convenção de implementação [Proposto]

```css
:root {
  --font-family-base: 'Inter', sans-serif;
  --font-weight-regular: 400;
  --font-weight-bold: 700;
  --font-size-xs: 12px;
  --font-size-sm: 13px;
  --font-size-md: 16px;
  --font-size-lg: 18px;
  --font-size-xl: 24px;
  --font-size-2xl: 28px;
  --font-size-3xl: 30px;
  --line-height-body-sm: 1.5;
  --line-height-heading-sm: 20px;
}
```

---

## 4. Bordas, cantos e geometria

### 4.1 Raios encontrados nas camadas

| Token sugerido | Valor | Aplicação real observada | Evidência |
|---|---:|---|---|
| `radius.xs` | `5px` | Elementos pequenos/ícones | [Figma • camada] |
| `radius.card` | `15px` | Cards de exercícios/treinos e imagens dos cards | [Figma • camada] |
| `radius.md` | `20px` | Alguns elementos arredondados | [Figma • camada] |
| `radius.input` | `30px` | Campos de formulário | [Figma • camada] |
| `radius.button` | `50px` | Fundo dos botões primário e secundário | [Figma • camada] |
| `radius.nav-top` | `35px` | Cantos superiores do menu inferior | [Figma • camada] |
| `radius.content-top` | `50px` | Canto superior esquerdo da superfície principal da home | [Figma • camada] |

Foram encontrados raios pequenos `1px` e `2px` em elementos utilitários. Os valores da tabela são abstrações [Proposto] sobre medidas existentes.

### 4.2 Dimensões de referência

| Elemento | Dimensões observadas | Detalhe |
|---|---|---|
| Frame mobile padrão | `375 × 812px` | Base de quase todas as telas principais |
| Tela de anamnese | `375 × 1313px` | Layout mais longo |
| Tela de treino detalhado | `375 × 943px` | Layout mais longo |
| Área útil comum | `315px` de largura | Margens laterais de `30px` em frame de `375px` |
| Botão padrão | `315 × 60px` | Variante primária e secundária |
| Campo de formulário padrão | `315 × 50px` | Abertura/login/cadastro/anamnese |
| Campo dividido da anamnese | `154 × 50px` | Ex.: peso, altura |
| Card de treino | `315 × 120px` | Home e exercícios |
| Imagem de card | `120 × 120px` | Alinhada à direita do card |
| Navegação inferior | aproximadamente `374 × 60px` | Fixada na base da tela de 375px |
| Ícones da navegação | aproximadamente `27–30px` | Variam segundo a forma gráfica |
| Botão flutuante de adição | `60 × 60px` | Ação “Add Schedule” |
| Dias circulares do calendário | `38 × 38px` | Círculos da faixa semanal |
| Ícone voltar | `15 × 15px` | Componente `arrow_back` |

**Responsividade:** o arquivo documenta essencialmente uma base mobile de `375px`; não foram identificadas regras formais de breakpoint, comportamento tablet ou desktop. **Não extrapolar** layouts responsivos como se fossem especificados no Figma.

---

## 5. Sombras e elevação

### 5.1 Efeito cadastrado

**`drop_buttons` [Figma • estilo]**

```css
box-shadow: 5px 5px 10px 0 rgba(2, 88, 125, 0.25);
```

- Cor de origem: `#02587D` com `25%` de opacidade.
- Deslocamento: `5px` horizontal e `5px` vertical.
- Blur: `10px`.
- Spread: `0`.
- Aplicação: botões e elementos de ação em destaque.

### 5.2 Outros padrões recorrentes

| Token sugerido | CSS equivalente | Aplicação | Evidência |
|---|---|---|---|
| `shadow.surface` | `5px 5px 10px 0 rgba(215,215,215,.25)` | Inputs e cards | [Figma • camada] |
| `shadow.calendar` | `5px 5px 6px 0 rgba(215,215,215,.25)` | Círculos/dias no calendário | [Figma • camada] |
| `shadow.navigation` | `5px 2px 10px 0 rgba(215,215,215,.40)` | Menu inferior | [Figma • camada] |
| `shadow.action` | `5px 5px 10px 0 rgba(2,88,125,.25)` | CTA e FAB | [Figma • estilo `drop_buttons` / camada] |
| `shadow.action-small` | `2px 2px 5px 0 rgba(2,88,125,.25)` | Variações menores de ação | [Figma • camada] |

Existe ainda uma sombra `0 4px 4px rgba(0,0,0,.25)` em algumas camadas e efeitos de cor `#FFBE36` pouco frequentes. Não foram classificados como parte do conjunto semântico central sem validação de uso.

---

## 6. Espaçamento e layout

**O arquivo analisado não define variáveis de espaçamento e não apresenta um sistema de Auto Layout nos frames auditados.** Portanto, as medidas abaixo vêm da geometria das telas e devem ser tratadas como padrões visuais **[Figma • camada]**, não como uma escala oficial.

| Valor | Evidência visual | Nome sugerido [Proposto] |
|---:|---|---|
| `10px` | Entre cards consecutivos de `120px` na home (`y=303`, `433`, `563`...) | `spacing.2` |
| `15px` | Espaçamentos internos locais em controles | `spacing.3` |
| `20px` | Entre botões consecutivos na tela de boas-vindas (`636–696` e `716–776`) | `spacing.4` |
| `30px` | Recuo lateral estrutural; também origem do texto dos cards relativamente ao conteúdo | `spacing.6` |
| `70px` | Passo vertical entre campos com altura `50px` no cadastro (`299`, `369`, `439`) | **Padrão de grupo**, equivalente a campo de `50px` + gap de `20px` |

**Layout base:** `375px - 30px - 30px = 315px` de largura útil. Trata-se de uma referência para telas com a mesma largura de projeto, **não** de uma largura máxima obrigatória para toda viewport.

---

## 7. Padrões de componentes extraídos

### 7.1 Botão primário — `Button_1`

**Fonte:** página `Assets`, nó [`1:254`](https://www.figma.com/design/PQspMKHqG16lg6UpIphV7f/App_Personal?node-id=1-254).

| Propriedade | Valor |
|---|---|
| Dimensões | `315 × 60px` |
| Fundo | Gradiente `#00FFFA` → `#009EE2` (esquerda → direita) |
| Raio | `50px` |
| Texto | Inter Bold, `18px`/`20px`, alinhado ao centro |
| Cor do texto | `#FFFFFF` |
| Sombra | `drop_buttons` |

### 7.2 Botão secundário — `Button_2`

**Fonte:** página `Assets`, nó [`1:255`](https://www.figma.com/design/PQspMKHqG16lg6UpIphV7f/App_Personal?node-id=1-255).

| Propriedade | Valor |
|---|---|
| Dimensões | `315 × 60px` |
| Fundo | `#FFFFFF` |
| Raio | `50px` |
| Texto | Inter Bold, `18px`/`20px`, alinhado ao centro |
| Cor do texto | `#009EE2` |
| Sombra | `5px 5px 10px 0 rgba(2,88,125,.25)` |

### 7.3 Input padrão

**Fontes:** telas de login (`1:93`, `1:97`), cadastro (`1:203`) e anamnese (`22:94`).

| Propriedade | Valor |
|---|---|
| Dimensões | `315 × 50px` |
| Fundo | `#FFFFFF` |
| Raio | `30px` |
| Sombra | `5px 5px 10px 0 rgba(215,215,215,.25)` |
| Texto | Inter Regular `12px` |
| Cor do texto | `#6F6F6F` |
| Recuo do texto | Aproximadamente `30px` a partir do início do campo |
| Ícone de complemento | Geralmente à direita, cinza, dimensões variáveis |

No formulário de anamnese existem inputs de meia largura (`154 × 50px`) mantendo tratamento visual equivalente.

### 7.4 Card de treino/exercício

**Fontes:** home (`33:354`) e lista de exercícios (`47:84`).

| Propriedade | Valor |
|---|---|
| Dimensões | `315 × 120px` |
| Superfície | `#FFFFFF` |
| Raio | `15px` |
| Sombra | `5px 5px 10px 0 rgba(215,215,215,.25)` |
| Imagem | `120 × 120px`, canto direito, raio `15px` |
| Título | Inter Bold `18px`, linha `20px`, cor `#009EE2` |
| Metadados | Inter Regular `12px`, cinza `#6F6F6F` |
| Recuo horizontal do título | `30px` dentro do card |
| Intervalo entre cards | `10px` |

### 7.5 Navegação inferior

**Fonte:** home (`33:322`) e agenda (`169:501`).

- Barra de aproximadamente `374 × 60px`, com fundo branco.
- Arredondamento dos cantos superiores: `35px`.
- Sombra: `5px 2px 10px rgba(215,215,215,.40)`.
- Ícones com altura ao redor de `30px`.
- Item selecionado com destaque em gradiente; demais itens em cinza claro.
- Itens encontrados: Início, Agenda/Calendário, Gráficos/Avaliações e Perfil.

### 7.6 Ação flutuante na agenda

**Fonte:** grupo `Add Schedule` (`169:192`).

- Formato circular: `60 × 60px`.
- Fundo: gradiente primário.
- Sombra: `drop_buttons`.
- Ícone de adição: aproximadamente `20 × 20px`, branco.

### 7.7 Seletor semanal do calendário

**Fonte:** `Workout Plan` (`169:153`).

- Indicadores de dias: círculos de `38 × 38px`.
- Círculos não selecionados brancos, sombra cinza `5px 5px 6px rgba(215,215,215,.25)`.
- Distribuição horizontal das opções em uma faixa de largura próxima a `315px`.
- Texto e seleção variam conforme o estado, sem conjunto de tokens de estados registrado.

---

## 8. CSS variables para iniciar a implementação

> **[Proposto]** O snippet consolida valores reais do Figma com **nomes semânticos sugeridos**. Não é exportação de Figma Variables, porque o arquivo **não possui** variáveis cadastradas. Os estilos de texto com altura de linha `AUTO` foram omitidos como valor CSS explícito.

```css
:root {
  /* Cores */
  --color-primary: #009ee2;
  --color-accent-cyan: #00fffa;
  --color-text-primary: #6f6f6f;
  --color-text-muted: #d7d7d7;
  --color-text-on-dark: #ffffff;
  --color-background: #fafafa;
  --color-background-dark: #1d1d1d;
  --color-surface: #ffffff;
  --color-border-subtle: #d7d7d7;

  /* Gradiente */
  --gradient-primary: linear-gradient(90deg, #00fffa 0%, #009ee2 100%);

  /* Tipografia */
  --font-family: 'Inter', sans-serif;
  --font-weight-regular: 400;
  --font-weight-bold: 700;
  --font-size-body: 12px;
  --line-height-body: 1.5;
  --font-size-button: 18px;
  --line-height-button: 20px;
  --font-size-title: 30px;

  /* Raios */
  --radius-card: 15px;
  --radius-input: 30px;
  --radius-button: 50px;
  --radius-navigation-top: 35px;
  --radius-content-top: 50px;

  /* Sombras */
  --shadow-button: 5px 5px 10px 0 rgba(2, 88, 125, 0.25);
  --shadow-surface: 5px 5px 10px 0 rgba(215, 215, 215, 0.25);
  --shadow-calendar: 5px 5px 6px 0 rgba(215, 215, 215, 0.25);
  --shadow-navigation: 5px 2px 10px 0 rgba(215, 215, 215, 0.40);

  /* Espaçamentos baseados em medidas recorrentes */
  --space-card-gap: 10px;
  --space-field-gap: 20px;
  --space-page-inline: 30px;

  /* Dimensões de referência (não são regras de viewport) */
  --size-control-height: 50px;
  --size-button-height: 60px;
  --size-card-height: 120px;
  --size-bottom-nav-height: 60px;
}
```

### Exemplo de aplicação

```css
.button-primary {
  min-height: var(--size-button-height);
  border: 0;
  border-radius: var(--radius-button);
  background: var(--gradient-primary);
  color: var(--color-text-on-dark);
  box-shadow: var(--shadow-button);
  font-family: var(--font-family);
  font-size: var(--font-size-button);
  font-weight: var(--font-weight-bold);
  line-height: var(--line-height-button);
}

.field {
  min-height: var(--size-control-height);
  border: 0;
  border-radius: var(--radius-input);
  background: var(--color-surface);
  box-shadow: var(--shadow-surface);
  color: var(--color-text-primary);
}

.workout-card {
  min-height: var(--size-card-height);
  border-radius: var(--radius-card);
  background: var(--color-surface);
  box-shadow: var(--shadow-surface);
}
```

---

## 9. Iconografia e imagem

- Ícones vistos na UI: voltar, início, agenda/calendário, perfil, gráfico, notificação, relógio, e-mail, olho/ocultar senha, seta, peso e adição.
- Ícones vetoriais são usados extensamente; vários apresentam traço de aproximadamente `3px` na camada original.
- Não há, neste arquivo, uma escala global formalizada para todos os ícones; os componentes têm tamanhos individuais.
- As fotos de treino têm enquadramento de **cobertura** dentro de `120 × 120px` com cantos arredondados de `15px`.
- O nó `arrow_back` da página Assets mede `15 × 15px`.
- Para implementação, exportar ou reutilizar os vetores originais. Não reconstruir os ícones por aproximação quando existirem arquivos fonte.

---

## 10. Pontos de atenção antes de consolidar o design system

1. **As variáveis ainda não existem no Figma.** Este MD extrai valores, mas não converte automaticamente estilos/camadas em Figma Variables. Recomenda-se formalizar coleções de `Colors`, `Typography`, `Radii`, `Spacing` e `Elevation`.
2. **Há duplicidade de nomenclatura.** `Gray_1`, `Grey_01`, `Grey_02`, `White` e `White_01` aparecem em contextos diferentes. Recomenda-se padronizar nomes semânticos e preservá-los no código e no design.
3. **Espaçamentos são medidas observadas, não regras oficiais.** A implementação deve converter posições absolutas de 375px em layouts flexíveis e componentes reutilizáveis.
4. **Não há catálogo completo de estados.** Hover, foco, pressionado, desabilitado, carregando, erro e sucesso não possuem especificação consistente identificada no levantamento. Definir tais estados sem alegar que já estavam presentes no arquivo.
5. **Contraste/acessibilidade requerem revisão.** `#009EE2` sobre branco tem contraste aproximado **3,00:1**, insuficiente para texto normal segundo WCAG AA (4,5:1); `#D7D7D7` sobre branco tem **1,44:1**. O texto `#6F6F6F` sobre branco chega a aproximadamente **5,02:1**. A extremidade ciano `#00FFFA` do gradiente também compromete o contraste de texto branco, especialmente em botões. Revisar estados e cores acessíveis mantendo a identidade visual.
6. **O cabeçalho escuro deve ser contextualizado.** `#1D1D1D` é usado na home, não necessariamente em todas as telas. Evitar generalizar como tema escuro global.
7. **Não há especificação de animação ou breakpoints neste levantamento.** Transições, temporizações e adaptação tablet/desktop ficam fora da evidência extraída.

---

## 11. Referências diretas para validação

| Área | Nó Figma |
|---|---|
| Página `App` | [`0:1`](https://www.figma.com/design/PQspMKHqG16lg6UpIphV7f/App_Personal?node-id=0-1) |
| Página `Assets` | [`1:243`](https://www.figma.com/design/PQspMKHqG16lg6UpIphV7f/App_Personal?node-id=1-243) |
| Welcome | [`1:30`](https://www.figma.com/design/PQspMKHqG16lg6UpIphV7f/App_Personal?node-id=1-30) |
| Login | [`1:69`](https://www.figma.com/design/PQspMKHqG16lg6UpIphV7f/App_Personal?node-id=1-69) |
| Cadastro | [`1:135`](https://www.figma.com/design/PQspMKHqG16lg6UpIphV7f/App_Personal?node-id=1-135) |
| Anamnese | [`20:43`](https://www.figma.com/design/PQspMKHqG16lg6UpIphV7f/App_Personal?node-id=20-43) |
| Home | [`33:177`](https://www.figma.com/design/PQspMKHqG16lg6UpIphV7f/App_Personal?node-id=33-177) |
| Treino | [`47:81`](https://www.figma.com/design/PQspMKHqG16lg6UpIphV7f/App_Personal?node-id=47-81) |
| Agenda | [`169:139`](https://www.figma.com/design/PQspMKHqG16lg6UpIphV7f/App_Personal?node-id=169-139) |
| Botão primário | [`1:254`](https://www.figma.com/design/PQspMKHqG16lg6UpIphV7f/App_Personal?node-id=1-254) |
| Botão secundário | [`1:255`](https://www.figma.com/design/PQspMKHqG16lg6UpIphV7f/App_Personal?node-id=1-255) |

**Resumo de maturidade:** o App Personal já apresenta uma linguagem visual reconhecível e consistente nos padrões principais. Ainda assim, a maior parte das medidas permanece implícita nas camadas, em vez de estar registrada como variáveis e componentes semânticos de um design system completo.
