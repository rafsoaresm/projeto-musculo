# Revisão do repositório contra o Handoff Consolidado V4

Feita em 01/11/2026 sobre a `main` em `77fd001` (0.52.0, no ar com o deploy `207827de`). Fonte: `Trainer_Prescription_Handoff_Consolidado_V4.md` (01/11/2026).

**Método:** cinco revisores leram a V4 por fatias e procuraram evidência no código, cada um seguido de um verificador independente que tentou derrubar os achados e listou o que ficou de fora. Os status abaixo são os do verificador.

**O que esta revisão não é:**
- Nada foi aberto no ar (o ambiente de código não alcança `projeto-musculo.webflow.io`).
- Não houve comparação com o Figma nem com o `designsystems-tokens.zip`, que não estão no repositório.
- Nenhum teste de navegador foi rodado para esta revisão.
- O único achado conferido de novo à mão foi a prévia do Frappe (item 2.1).

Status usados: **atende**, **parcial**, **não atende**, **conflito com decisão** (a V4 contradiz uma decisão registrada nos docs) e **não verificável** (depende do ar, do Figma, do ZIP ou de decisão de produto).

## 1. Decisões que a V4 muda e que precisam de confirmação

A V4 diz que substitui as versões anteriores, mas estes pontos desfazem decisões registradas no projeto. Nenhum foi alterado no código até a confirmação.

**Decidido pelo usuário em 01/11/2026:** D1 adota a V4 (editor fixo por site, sem troca; para mudar de editor, excluir e recomeçar) e D3 adota a V4 (abaixo do alvo vira aviso). D2 espera o `designsystems-tokens.zip`; D4 continua em aberto. **Atualização de 01/11/2026:** D2 resolvida com o ZIP (0.53); **D4 decidida: Sim/Não com resposta obrigatória** em cada pergunta da triagem, sem estado "não avaliado" nas avaliações novas; as antigas ficam como formato anterior (só o "sim" é confiável), sem conversão automática. **Implementado na 0.60** (migration 0031).

| # | V4 | Hoje (decisão registrada) | Efeito de adotar a V4 |
|---|---|---|---|
| D1 | Editor **fixo por site**, escolhido uma vez com aviso e confirmação. Backend recusa edição cruzada. Sem troca. Nomes `Editor Guiado` e `Editor Avançado` (T18, T19B, T19C, seção 9.10, NAV-06, 16.1). | F8: `sites.engine` (`native`/`frappe`, migration 0028) diz qual editor responde em `/s/<endereço>` e **pode ser trocado nos dois sentidos** ("Colocar o site novo no endereço principal" / "Voltar ao editor anterior"). Os dois editores gravam e publicam no mesmo site. PLANO-FRAPPE-BUILDER:24 e :46, ROADMAP:42, migration 0028. | 1. Remover a troca de editor.<br>2. Fazer `engine` valer como dono do formato.<br>3. Recusar no servidor o editor oposto (ações do guiado e adaptador do Frappe).<br>4. Refazer a criação com cards, aviso e confirmação.<br>5. Decidir o que fazer com sites que já têm conteúdo nos dois editores. |
| D2 | Tokens do `designsystems-tokens.zip`: Figtree no corpo, Roboto nos títulos, primária `#0093E0`, botão `#0078B8`, base 16 px, escala `--spacing-N` (seção 6, DS-01/02). | `docs/DESIGN-SYSTEM.md` e `tokens.css`: Inter, azul próprio, base 15 px, item ativo sólido. | Trocar tokens e fontes no app todo. **Precisa do ZIP**, que não está no repositório. |
| D3 | "Abaixo do alvo" é **aviso**, nunca impedimento (A12, contrato 9.6, AC13.9, AC14.5). | O código **bloqueia a aprovação** por quantidade abaixo do alvo. Nenhum doc registra isso como escolha do usuário. | Rebaixar a aviso e dar à lista de pendências tipo, severidade e destino. |
| D4 | Ausente ≠ "não" na triagem (T08, T09). | Os seis itens de triagem são booleanos com padrão 0: "não perguntado" e "não" são o mesmo dado. | Migration aditiva para o estado "não avaliado". Dados antigos ficam ambíguos e não podem ser reclassificados sozinhos. |

## 2. Defeitos no que já está no ar (independem das decisões)

1. **A prévia de página do Frappe não funciona sob o mount.** O editor compilado monta `/api/method/builder.api.get_page_preview_html?...` com caminho fixo na raiz (conferido nos assets em `public/frappe-editor/assets`). Nenhuma rota do app responde a esse método, nem na raiz nem no adaptador `/api/builder-editor`. Isso viola a regra do AGENTS.md de não fixar `/api` no navegador. As miniaturas de modelos seguem o mesmo caminho. Também afeta a AC19.5.
2. **"Fora do ar" pode não ser verdade.** Num site `native` tirado do ar com uma página Frappe publicada, o painel diz "Ninguém vê o site até você publicar", mas `/site/<endereço>` está público. Com `engine='frappe'`, a versão guiada escondida continua contando como publicada e recebendo mensagens pelo endereço direto (AC18.9, AC18.10).
3. **"Tirar do ar" age com um clique**, sem confirmação nem consequências. Num site do Frappe não há despublicar na gestão (T19B "Excluir/despublicar").
4. **O controle de recebimento de mensagens aparece duas vezes** na mesma página quando o site é `native`. O dado é único (`inquiries_open`), mas a V4 pede um controle só, que diga o estado efetivo (AC18.10).
5. **O login perde o destino.** Abrir um link interno sem sessão e entrar não volta ao link (AC01.1, contrato 9.9).
6. **Onboarding marca o convite como "Concluído"** com o convite apenas gerado. O dado para distinguir já existe (A08, AC02.1).
7. **Duas abas editando a mesma revisão de plano:** vence a última gravação. O Meu Site tem conflito por revisão; o plano não (AC13.11).
8. **Duplo envio pode criar dois planos.** O índice é por `plan_id` e não há chave de idempotência. O mesmo vale para o novo aluno, barrado só no cliente (AC12.3, AC04.2).

## 3. Meu Site (a parte que estamos fechando)

**O que atende:**
- Criação atômica, com a organização vinda da sessão.
- Um site por espaço, sem botão de segundo site.
- Excluir é separado e confirmado pelo endereço digitado.
- Abrir gestão ou editor não altera URL nem publicação.
- Nenhuma conversão entre formatos.
- Os dados dos dois editores nunca se cruzam.
- Isolamento por organização no adaptador.
- Política de código externo preservada (0.51.1 e 0.52).
- Sites anteriores à 0028 são todos inequivocamente do editor próprio, e o padrão `native` está correto para eles.

**Conflito com a decisão F8 (resolve-se com D1):** AC18.6, T19B "Abrir edição" e "Usar o outro editor", T19C, regras de editor único, de validação no servidor e de "definido uma vez", AC19.6, NAV-06, Entrega 4.

**Não atende ou parcial, a fazer em qualquer caso:**

| Critério | Hoje | Falta |
|---|---|---|
| AC18.2, microcopy, passo 1 | Rádios "Editor novo (Frappe Builder)" e "Editor anterior", com o Frappe pré-marcado (`create-site.tsx`). | Dois cards de igual peso, sem pré-seleção. Nomes `Editor Guiado` e `Editor Avançado`. "Mais simples para começar" só como texto. |
| AC18.3, confirmação, AC18.4 | Envia direto. | Aviso antes do CTA e na confirmação; diálogo "Criar site com o Editor …?". Só faz sentido com D1. |
| Passo 3 | Depois de criar, volta à gestão. | Abrir o editor atribuído. |
| Passo 4, abas, AC18.7 | Uma página com os painéis dos dois editores e o estado de cada um. | Badge do editor, um "Editar site", abas Páginas / Publicação / Formulários e mensagens / Configurações, status público comum. |
| Fonte única do estado | Cada tela combina plataforma, preferência, publicado e formulário completo por conta própria. | Uma função única para o estado público e o estado efetivo dos formulários (ver defeitos 2 e 4). |
| Estados visuais | Faltam seleção pendente, confirmação, tipo desconhecido, falha ao abrir o editor e status comum. | — |
| 5.1, AC19.1, contexto do Avançado | O Frappe sai do shell sem "Voltar ao Meu Site", sem identificação do site e sem estado de publicação; a saída é o Voltar do navegador. | Barra fina com esses itens, por patch ou pela rota que serve o editor, e registrar a diferença de shell. |
| AC19.4 | Interface do Frappe em inglês. O mecanismo oficial (`__()` com `get_boot_translations`) está desligado com dicionário vazio, e o impedimento não está documentado. | Tradução pt-BR dos fluxos essenciais pelo mecanismo nativo (sem fork). |
| AC19.5 | Guiado: fluxo completo local. Frappe: a prévia não funciona (defeito 1). | Corrigir a prévia; verificar o resto no ar. |
| AC19.7 | O guiado não mente sucesso, mas o rascunho não salvo fica só em memória. O cliente do Frappe em falha de rede não foi verificado. | Cópia local recuperável no guiado; teste no Frappe. |
| AC18.12 | Não há cards nem confirmação para avaliar. | Teste em 390/1280 px com teclado e leitor de tela quando existirem. |
| Proveniência | `builder_docs` é por organização, não por site, e pode existir antes do site. | Correto enquanto houver um site por espaço. Precisa de vínculo explícito se um dia houver mais de um. |

## 4. Navegação e design system (Entrega 0, que a V4 manda fazer primeiro)

| Critério | Hoje | Falta |
|---|---|---|
| NAV-02, seção 5 | Quatro grupos com nomes da V2 (há um CONHECIMENTO) e 11 itens mais "Mapa do produto". Existem "Periodização", "Prescrição" e "Fontes técnicas"; falta "Planos e treinos"; Conta e Configurações em ordem invertida. | Os 10 itens e 3 grupos exatos da V4. |
| NAV-03 e tabela de rotas | O ativo deriva da URL por prefixo, o que é correto como princípio. Mas `/alunos/[id]/planos/**` acende Alunos (a V4 quer Planos e treinos), e `/periodizacao` não tem destino. | Mapa de contexto por rota, com teste unitário. |
| NAV-04 | Periodização é item principal e atalho da barra móvel. | "Simulador de ciclos" como acesso secundário em Planos e treinos; Fontes técnicas fora do menu principal. |
| NAV-07, 5.1 | O painel móvel ocupa a tela; o gatilho fica na barra inferior. Sem overlay, foco contido, devolução do foco nem Fechar dentro. Há uma barra de 4 atalhos que a V4 não prevê. | Drawer com o gatilho no cabeçalho, overlay, Escape, toque fora e foco. |
| NAV-09 | Não há `/profissional/planos`. | Alias e redirects ao renomear Prescrição e Periodização. |
| 5.3 | Não há abas do aluno nem etapas do plano com cabeçalho de contexto; as subrotas existem soltas. | `ContextHeader`, abas, `StepProgress` (também Entregas 2 e 3). |
| DS-01, DS-02 | Conflito D2. | — |
| 6.3, DS-05, DS-08 | Menu e PageHeading são compartilhados; Pill faz o papel de StatusBadge. Botão é classe CSS sem estado de loading; não há componentes Breadcrumb, StepProgress, SaveIndicator, ConfirmDialog nem ValidationSummary compartilhados. | — |
| DS-04, DS-06, NAV-10 | Contraste documentado, sem teste. 1280/1440 px, zoom 200% e leitor de tela não verificados. | — |
| Atende | Sidebar única com mapa central, não espremida no celular; Biblioteca, Serviços, Configurações e Conta acendem certo; regra flex nos botões (sem rótulo absoluto); `prefers-reduced-motion`. | — |

## 5. Demais telas (leitura mais rápida)

**Atende:**
- Avaliação registrada imutável.
- Aprovar ≠ entregar.
- Entregue é snapshot.
- Rascunho invisível ao aluno.
- Sem IA.
- Mensagem, lead e aluno separados, com conversão explícita que não libera portal nem ficha.
- Recuperação de senha existe, desligada até haver credenciais de e-mail.

**Distância para a V4, por prioridade:**
- **P1:**
  - T05 sem abas, resumo nem próxima ação; o convite ocupa o topo em qualquer estado.
  - T13: a copy contraditória "não prescreve exercícios" continua (A01). "Estrutura pronta" congela a revisão inteira sem confirmação nem caminho de correção (A02).
  - T11: nome antigo, sem "Usar em um aluno", e sem teste do caso AC11.4 (31/10/2026, 4+4+4 semanas, frequências 2,3,3 → fim em 22/01/2027, 32 sessões).
  - Autoria no snapshot: o nome de quem entregou é lido na hora, não congelado. É pendência B15, que vai na mesma direção da V4; o código ainda não cumpre.
- **P2:**
  - T02: indicadores não clicáveis e sem fila unificada.
  - T03 sem busca, filtros nem paginação.
  - T06 sem proteção de saída e sem "prefere não informar".
  - T07 sem filtros.
  - T14: o hub não mostra a entrega anterior quando há uma revisão nova; contagem sem escopo.
  - T22 sem "Vincular a lead"; descartar apaga de vez; o lead perde a data da mensagem.
  - A14: textos de regra interna no topo das telas.
  - A13: entrada de datas depende do navegador.
- **P3:** T10 sem filtro de período; T15 sem Limpar filtros; T16 sem o ID de origem na cópia; T21 sem atalho "Cadastrar serviço" com retorno ao lead.

## 5A. Conferência com o Figma (01/11/2026)

Arquivo `RRHeYHC01jSd0hnrRzzBxP`, página única, lido pelo conector do Figma: 21 frames de tela (15 profissionais desktop de 1280 × 850, 3 do aluno e 2 profissionais de 390 × 844, mais o drawer aberto `29:543`), o componente da sidebar `28:342` (10 variantes `Ativo=…`) e os símbolos `29:497` (gatilho do menu) e `29:509` (drawer). Os frames têm dados ilustrativos; nada deles foi copiado para o produto.

| Frame | O que o desenho pede | Estado |
|---|---|---|
| `28:342` Sidebar · `29:543` Drawer | `TRAINER / RX` com subtítulo **ÁREA PROFISSIONAL** (a V4, seção 5, escreve "WORKSPACE PROFISSIONAL"; vale o Figma, pela precedência visual da seção 1), itens **só texto, sem ícones**, linha entre os grupos, rodapé `TRAINER PRESCRIPTION · Área profissional`, ativo com fundo claro e texto azul em negrito, sem barra | **Alinhado na 0.54.** O drawer do Figma fecha com um ícone; o app mantém o rótulo "Fechar" (a V4 pede "opção Fechar" e o rótulo é mais acessível) |
| Todos os frames desktop | Título da página, subtítulo e uma linha; **sem barra superior** | O app mantém a barra superior (nome do espaço, usuário, Sair, troca de área), que o desenho não mostra e o produto precisa; diferença registrada |
| `1:2` Dashboard | Chips de contagem (pendências, alunos novos, revisões), fila **Demandam atenção** com aluno, motivo e CTA, **Atalhos** (Novo aluno, Criar plano), **Resumo da operação** | Entrega 2 (T02). Hoje: 8 indicadores e o checklist de próximos passos (que a 0.54 já corrige: convite gerado ≠ concluído, Continuar plano, Ver entrega) |
| `1:111` Ficha do aluno | Cabeçalho "nome · situação" com **Próxima ação**, abas Resumo / Avaliações / Periodização / Treinos / Evolução, linha do tempo e informações relevantes | Entrega 2 (T05). Hoje: página vertical sem abas |
| `1:261` Editor de prescrição | Contexto "aluno / semana / treino", **Revisar plano**, estrutura semanal, lista compacta com séries, repetições, descanso e carga numa linha, alça de reordenar, "Salvo automaticamente", **Adicionar exercício** | Entrega 3 (T13). O "salvo automaticamente" só entra se houver contrato de autosave (V4, contrato 9.3) |
| `1:298` Revisão e entrega | CTA compacto "Aprovar e entregar" | **Não seguir**: a V4 (16.2) manda manter aprovar e entregar separados, como o app já faz |
| `10:2` Escolha do editor | Passos 1. Escolha / 2. Confirme; dois cards iguais **Editor Guiado** ("Mais simples para começar") e **Editor Avançado** ("Mais liberdade de criação") com três capacidades e botão cada; aviso amarelo "Importante: escolha definitiva para este site" | Entrega 4 (decisão D1 já tomada). Hoje: rádios com o Frappe pré-marcado |
| `10:46` Confirmação · `10:76`/`10:119` Gestão · `11:3`/`11:23` mobile | Confirmação da escolha irreversível; gestão com o editor fixo identificado | Entrega 4 |
| `10:218` Editor Avançado | Título "Editor Avançado", trilha "Frappe Builder / Site profissional / Rascunho", **Voltar ao Meu Site**, a área nativa do Frappe sem redesenho | Entrega 4 (hoje o Frappe abre sem nada disso) |
| `1:396`, `1:412`, `1:433` Aluno | Hoje, registrar série, check-in no celular | Sem auditoria do aluno; fora das entregas atuais |

## 6. Andamento

- **0.53 — Entrega 0** (navegação e tokens): feita localmente. NAV-01 a NAV-05 e NAV-07 cobertos, NAV-03 com teste unitário e de navegador, DS-01/02 com o kit oficial. Faltam o estado "carregando" dos botões (DS-05), o zoom de 200%, o leitor de tela e a comparação com o Figma.

## 7. Ordem sugerida

**Plano combinado com o usuário em 01/11/2026 (substitui a lista abaixo, que fica como histórico):**

- **Decisão sobre o Editor Guiado (01/11/2026):** o Editor Guiado é o editor **simples** do começo (0.34: seções com formulário, rascunho, prévia, publicação), como no quadro `10:162` (lista de seções, prévia da página, formulário da seção com título, descrição, imagem, botão principal e SEO; "Pré-visualizar" e "Salvar rascunho"). O editor complexo é o Frappe (Editor Avançado). O construtor visual que cresceu de 0.35 a 0.49 (árvore livre, estilos, alças, tamanhos de tela, componentes) deixa de ser o Guiado; o destino dos sites já feitos nele é levantado antes de qualquer mudança (nada é convertido sem aviso).

| Fatia | Conteúdo | Quadros |
|---|---|---|
| 0.55 | Visão geral nova (fila "Demandam atenção", contadores, atalhos, resumo) | `1:2` |
| 0.56 | Meu Site: levantamento dos sites com conteúdo nos dois editores e no construtor; criação em dois passos com cartões e confirmação; abrir o editor atribuído; editor fixo por site com recusa no servidor (sai a troca da F8); gestão com etiquetas, cartão "Editor fixo" e abas Páginas / Publicação / Formulários e mensagens / Configurações; regra única do estado público e dos formulários (defeitos 2 e 4); "Tirar do ar" com confirmação, também no Frappe (defeito 3) | `10:2`, `10:46`, `10:76`, `10:119`, `11:3`, `11:23` |
| 0.57 | Editor Avançado: barra com título, trilha e "Voltar ao Meu Site"; prévia do Frappe sob o subcaminho (defeito 1); pt-BR dos fluxos essenciais pelo mecanismo nativo | `10:218` |
| 0.58 | Editor Guiado simples sobre o mesmo documento e a mesma publicação | `10:162` |
| depois | Entrega 2 (ficha `1:111`, listas com busca e filtros), Entrega 3 (editor de prescrição `1:261`, triagem Sim/Não obrigatória da D4, datas A13), Entrega 5 (acesso e configurações) | `1:63`, `1:111`, `1:155`, `1:261` |

**Lista anterior:**

1. **Já, sem depender de decisão:**
   - Defeitos 1 a 4 de Meu Site: prévia do Frappe, status público comum, confirmação de "Tirar do ar", um controle de mensagens só.
   - "Voltar ao Meu Site" e identificação do site no Frappe.
   - Nomes `Editor Guiado` e `Editor Avançado` (sem mudar o comportamento).
2. **Com D1 decidida:** fechar a escolha por site (cards, aviso, confirmação, recusa cruzada no servidor, gestão com abas) ou registrar que F8 continua e a V4 fica com essa exceção.
3. **Entrega 0** (menu de 10 itens, item ativo por contexto, drawer acessível): pode começar sem o ZIP. A troca de tokens e fontes espera D2 e o ZIP.
4. Tradução pt-BR do Frappe pelo mecanismo nativo.
5. Entregas 1 a 3 da V4 nas telas de aluno, avaliação e plano, com D3 e D4 decididas.
