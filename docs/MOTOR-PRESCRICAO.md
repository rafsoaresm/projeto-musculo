# Motor de prescrição automática

Documento do motor de prescrição (pedido do usuário de 04/11/2026, PR #95). **Estado: só o motor (etapa S1).** O motor é código puro em `src/modules/prescricao/motor/`, testado isoladamente (`tests/motor-*.test.ts`). **Ainda não está ligado ao banco, às telas nem ao fluxo de aprovação e entrega**: isso vem nas etapas seguintes (estrutura v2, migrations 0041–0045, adaptador, propostas, aplicação, leitores e interface). As seções marcadas "a completar" são preenchidas na etapa final (S10).

## O que o motor faz

- Recebe fatos já autorizados (aluno, triagem, avaliação, periodização inteira, biblioteca visível, histórico, linhas atuais da revisão) e devolve uma **proposta para revisão profissional** (`requiresProfessionalReview: true`). Nunca aprova nem entrega.
- Gera **todas as sessões** de todas as fases e semanas (qualquer quantidade de fases, semanas e sessões por semana, dentro dos limites técnicos abaixo), com uma seleção de exercícios por treino da fase e uma dose por sessão.
- Doses em **modelos por métrica**: repetições (séries, faixa, RIR/PSE/%1RM, descanso, cadência, método), tempo, distância, intervalado (blocos, repetições, estímulo, recuperação ativa/passiva) e contínuo. Força não é forçada em séries × repetições quando não cabe. **O motor nunca propõe quilos, zonas ou ritmos**: esses vêm do profissional.
- Progressão semanal: rampa linear, degraus, sequência ondulatória (por semana ou dentro da semana), blocos, ajustes por semana e descarga; combináveis.
- Histórico: continuidade pesa na seleção; dor relatada vira alerta e sugestão de exclusão (que só vale depois do clique do profissional) e **também baixa a pontuação** do exercício na seleção (`SELECTION_WEIGHTS.historyPain`, heurística editável, registrada no "Por quê?" com base `STUDENT_DATA`); nunca exclui sozinha. A progressão por histórico é **só sugestão** (nunca vira valor).
- Revisão: regenerar item, sessão, semana, treino (a partir de uma semana), fase ou desta fase em diante; substituir em uma sessão, a partir de uma semana ou na fase; alternativas; trazer linhas novas da revisão (rebase). Regras da revisão:
  - linhas que já estavam na revisão (preservadas) e itens travados nunca são trocados pelo motor: regenerar um deles devolve `TARGET_PRESERVED` / `TARGET_LOCKED`, e substituir um travado devolve `TARGET_LOCKED` (destravar antes). Substituir uma linha preservada é decisão do profissional e gera `EXISTING_ROW_REPLACED` (aplicar exige confirmação), mesmo numa troca de uma troca;
  - trocas do profissional (`SUBSTITUTED`) dentro do escopo regenerado são mantidas, com a dose recalculada; se o exercício deixou de ser elegível ou o item original sumiu do treino, a troca cai com `SUBSTITUTION_DROPPED`, nunca calada;
  - uma trava sobre um item que só existe em parte das sessões (trocado numa sessão e travado) vale só nessas sessões; `generate` trata travas como valendo para o treino inteiro da fase;
  - o rebase recalcula `EXISTING_EXCEEDS_TARGET` quando linhas novas da revisão passam da quantidade (nada é removido).
- Duração estimada por sessão (máximo das faixas) comparada com o tempo disponível (treino → geração → perfil): `SOFT` avisa, `HARD` torna a proposta INFEASIBLE. Exercícios nunca são trocados para caber.
- Problemas viram avisos com código (lista em `motor/vocabulary.ts`, `ISSUE_LABELS`); qualquer ERROR torna a proposta `INFEASIBLE`, e o rascunho inteiro é devolvido mesmo assim.
- Determinístico: mesma entrada → mesmos bytes (catálogo em qualquer ordem); sem acaso, relógio, rede, banco ou IA.

## O que o motor não faz

- Não inventa dados: falta de estímulo, quantidade, equipamento, métrica ou regra de dose vira pergunta ou aviso, nunca número. Vazio nunca é 0.
- Não trata observações isoladas da avaliação (postura, flexibilidade) como contraindicação; alertas só sugerem decisões, que valem depois do clique do profissional.
- Não lê check-ins (decisão Q6).

## Bases de cada valor

Todo número da proposta diz de onde veio: `EVIDENCE` (só com referência verificada; hoje **nenhuma**), `HEURISTIC` ("Heurística operacional (editável)": valor padrão das regras), `HEURISTIC_ACCEPTED` (sugestão que o profissional aceitou, com a regra), `PROFESSIONAL` (digitado ou escolhido pelo profissional, ou estrutura feita por ele), `STUDENT_DATA` (dado do aluno). Os valores padrão desta ferramenta não são recomendação universal.

## Regras

A tabela abaixo é gerada de `src/modules/prescricao/motor/rules/gymgital-base.json` por `renderRulesTable`; um teste (`tests/motor-rules.test.ts`) falha se ela divergir. Para mudar um número, publique uma versão nova do conjunto (as gravadas continuam reproduzíveis). O SHA-256 de cada conjunto publicado está fixado no teste: editar o JSON sob a mesma versão faz o teste falhar, e a correção é uma versão nova, não um hash novo.

<!-- regras:inicio -->
Conjunto `gymgital-base` versão `2026.11.1`.

| Regra | Base | O que faz | Valor |
|---|---|---|---|
| DOSE_DEFAULTS | Heurística operacional (editável) | Dose inicial por estímulo, modalidade e métrica. stimulus "*" vale para qualquer estímulo da modalidade. Intensidade de cardio (zona, ritmo) nunca é preenchida: fica com o profissional. | ver tabela de doses |
| LOAD_INSTRUCTION_DEFAULT | Heurística operacional (editável) | Texto de carga para exercícios por repetições: o motor nunca propõe quilos. | `Escolher a carga na execução para o esforço indicado; registrar a base (total, por mão ou por lado).` |
| LOAD_BASIS_DEFAULT | Heurística operacional (editável) | Base de carga sugerida para exercícios por repetições quando a regra de dose não diz outra; o profissional ajusta (total, por mão, por lado, máquina, peso do corpo). | `TOTAL` |
| MODALITY_FOR_STIMULUS | Heurística operacional (editável) | Modalidades elegíveis quando o treino não diz quais. Sem preenchimento entre modalidades. | `{"HYPERTROPHY":["RESISTANCE"],"STRENGTH":["RESISTANCE"],"POWER":["RESISTANCE"],"MUSCULAR_ENDURANCE":["RESISTANCE"],"GENERAL_FITNESS":["RESISTANCE"],"AEROBIC_ENDURANCE":["CARDIO"],"INTERVALS":["CARDIO"],"MOBILITY":["MOBILITY"],"BALANCE":["BALANCE"],"RECOVERY":["MOBILITY","CARDIO"]}` |
| GOAL_STIMULUS_HINTS | Heurística operacional (editável) | Palavras do objetivo do aluno que sugerem um estímulo. Só produzem sugestões; nada é pré-selecionado. | `[{"keywords":["hipertrof","massa","muscul","definic"],"stimulus":"HYPERTROPHY"},{"keywords":["forca","forte"],"stimulus":"STRENGTH"},{"keywords":["potenc","explos","salto"],"stimulus":"POWER"},{"keywords":["resistencia muscular"],"stimulus":"MUSCULAR_ENDURANCE"},{"keywords":["corrida","aerob","cardio","condicion","emagrec","maratona"],"stimulus":"AEROBIC_ENDURANCE"},{"keywords":["mobilidade","flexibilidade","alongamento"],"stimulus":"MOBILITY"},{"keywords":["equilibrio","queda"],"stimulus":"BALANCE"},{"keywords":["saude","qualidade de vida","bem-estar","condicionamento geral"],"stimulus":"GENERAL_FITNESS"}]` |
| DEFAULT_COVERAGE | Heurística operacional (editável) | Padrões sugeridos (botões) quando o treino não tem alvo. Aceitar registra HEURISTIC_ACCEPTED. | `{"RESISTANCE":["SQUAT","HINGE","HORIZONTAL_PUSH","HORIZONTAL_PULL","VERTICAL_PUSH","VERTICAL_PULL","ANTI_EXTENSION"],"CARDIO":["CYCLICAL"],"MOBILITY":["MOBILITY"],"BALANCE":["BALANCE"]}` |
| EXPERIENCE_MAP | Heurística operacional (editável) | Texto do nível no perfil do aluno para a experiência usada na seleção. | `{"iniciante":"BEGINNER","intermediario":"INTERMEDIATE","avancado":"ADVANCED"}` |
| SELECTION_WEIGHTS | Heurística operacional (editável) | Pesos da pontuação de seleção (gulosa por cobertura marginal). Empates pelo id, por ponto de código. | `{"primaryTarget":60,"primaryRepeatDivisor":2,"secondaryTarget":10,"patternNew":30,"patternRepeat":5,"noTargets":10,"compound":8,"preferred":20,"historyContinuity":6,"historyPain":-40,"usedInOtherWorkoutOfPhase":-15,"usedInPreviousPhase":-5,"beginnerDifficulty":-6,"otherDifficulty":-0.5,"inferredMetadata":-3,"avoidCurrent":-1000}` |
| COMPOUND_PRIORITY_STIMULI | Heurística operacional (editável) | Estímulos em que exercícios multiarticulares recebem bônus de seleção. | `["HYPERTROPHY","STRENGTH","POWER","GENERAL_FITNESS"]` |
| ALTERNATIVES_LIMIT | Heurística operacional (editável) | Quantas alternativas o motor lista por item. | `4` |
| ALTERNATIVE_WEIGHTS | Heurística operacional (editável) | Pontuação das alternativas de um item: substituição curada na biblioteca, músculo principal em comum, padrão em comum, mesma métrica. Sem nada em comum, o exercício não é listado como alternativa. | `{"curated":100,"sharedPrimary":10,"sharedPattern":8,"sameMetric":3}` |
| DURATION | Heurística operacional (editável) | Estimativa de duração: aquecimento, transição por exercício, segundos por repetição quando o exercício não informa, fator unilateral. Usa o máximo das faixas (estimativa conservadora). | `{"warmupSeconds":300,"transitionSecondsPerExercise":60,"defaultSecondsPerRep":4,"unilateralFactor":2}` |
| COUNT_FROM_TIME | Heurística operacional (editável) | Quantidade de exercícios pelo tempo: adiciona exercícios enquanto a estimativa cabe no tempo disponível, com este mínimo. | `{"minimum":1}` |
| LINEAR_ROUNDING | Heurística operacional (editável) | Arredondamento dos valores interpolados da progressão linear (inteiro mais próximo). | `{"decimals":0}` |
| DELOAD_ROUNDING | Heurística operacional (editável) | Séries da semana de descarga: arredondar séries × multiplicador, mínimo 0. | `{"floor":0}` |
| INDIRECT_VOLUME_FACTOR | Heurística operacional (editável) | Peso das séries de músculos secundários no volume ponderado. Heurística até a referência ser conferida. | `0.5` |
| VOLUME_MODALITIES | Heurística operacional (editável) | Modalidades contadas no volume semanal por músculo. | `["RESISTANCE"]` |
| EXPOSURE_WINDOW_DAYS | Heurística operacional (editável) | Janela de histórico de execução lida pelo adaptador. | `180` |
| PROGRESSION_HISTORY | Heurística operacional (editável) | Sugestão de progressão pelo histórico: exposições completas e comparáveis seguidas e aumento máximo relativo. Só sugestão; nunca gravada como valor. | `{"consecutiveSuccesses":2,"maximumIncrementFraction":0.1}` |
| MOVEMENT_FINDING_PATTERN_MAP | Heurística operacional (editável) | Teste de movimento da avaliação → padrões que podem ser excluídos com um clique do profissional. Nunca é contraindicação automática. | `{"SQUAT":["SQUAT"],"HIP_HINGE":["HINGE"],"LUNGE":["LUNGE"],"PUSH":["HORIZONTAL_PUSH","VERTICAL_PUSH"],"PULL":["HORIZONTAL_PULL","VERTICAL_PULL"]}` |
| MOVEMENT_FINDING_GRADES | Heurística operacional (editável) | Graus do teste de movimento que geram sugestão de decisão. | `["MODERATE","STOPPED_BY_PAIN"]` |

Doses padrão (`DOSE_DEFAULTS`):

| Estímulo | Modalidade | Métrica | Valores |
|---|---|---|---|
| HYPERTROPHY | RESISTANCE | REPS | `{"sets":3,"repsMin":8,"repsMax":12,"rirMin":1,"rirMax":3,"restSeconds":90}` |
| STRENGTH | RESISTANCE | REPS | `{"sets":4,"repsMin":3,"repsMax":6,"rirMin":2,"rirMax":3,"restSeconds":180}` |
| POWER | RESISTANCE | REPS | `{"sets":3,"repsMin":2,"repsMax":5,"rirMin":3,"rirMax":5,"restSeconds":180}` "Priorizar velocidade de execução; encerrar a série ao perder velocidade técnica." |
| MUSCULAR_ENDURANCE | RESISTANCE | REPS | `{"sets":2,"repsMin":12,"repsMax":20,"rirMin":2,"rirMax":4,"restSeconds":60}` |
| GENERAL_FITNESS | RESISTANCE | REPS | `{"sets":2,"repsMin":8,"repsMax":12,"rirMin":2,"rirMax":4,"restSeconds":90}` |
| RECOVERY | RESISTANCE | REPS | `{"sets":1,"repsMin":8,"repsMax":12,"rirMin":4,"rirMax":6,"restSeconds":90}` |
| * | RESISTANCE | TIME | `{"sets":3,"durationMin":20,"durationMax":40,"restSeconds":60}` |
| * | RESISTANCE | DISTANCE | `{"sets":3,"distanceMin":20,"distanceMax":40,"restSeconds":90}` |
| AEROBIC_ENDURANCE | CARDIO | CONTINUOUS | `{"durationMin":1200,"durationMax":1800}` |
| INTERVALS | CARDIO | INTERVALS | `{"blocks":1,"repeats":6,"workDurationMin":30,"workDurationMax":60,"recoveryMin":60,"recoveryMax":90,"restBetweenBlocks":0}` recoveryMode=ACTIVE |
| * | CARDIO | CONTINUOUS | `{"durationMin":600,"durationMax":1200}` |
| * | CARDIO | TIME | `{"sets":1,"durationMin":600,"durationMax":1200,"restSeconds":0}` |
| * | MOBILITY | TIME | `{"sets":2,"durationMin":30,"durationMax":45,"restSeconds":15}` |
| * | MOBILITY | REPS | `{"sets":2,"repsMin":8,"repsMax":10,"restSeconds":30}` loadBasis=BODYWEIGHT |
| * | BALANCE | TIME | `{"sets":2,"durationMin":20,"durationMax":30,"restSeconds":30}` |
| * | SKILL | TIME | `{"sets":3,"durationMin":30,"durationMax":45,"restSeconds":90}` |

Referências:

| Id | Citação | Estado |
|---|---|---|
| CURRIER_2026 | Currier et al. (2026), posicionamento ACSM sobre treinamento resistido | NÃO VERIFICADA (não aparece para usuários) |
| PELLAND_2026 | Pelland et al. (2026), volume direto e indireto | NÃO VERIFICADA (não aparece para usuários) |
<!-- regras:fim -->

Referências não verificadas não aparecem em traços nem na interface, e nenhuma regra que as cite pode ter base `EVIDENCE` (teste em `tests/motor-rules.test.ts`). A conferência das duas é do Técnico (ver `PENDENCIAS.md`).

## Limites técnicos

Em `motor/bounds.ts` (`TECHNICAL_LIMITS`), cada um com o motivo: 12 fases (CHECK 1..12 das tabelas 0006/0012; refazer não é aditivo), 14 sessões por semana, 30 exercícios por treino (`MAX_PER_WORKOUT` e `MAX_EXERCISES` da execução, até medição), tamanhos das colunas de traço (8000), alternativas (4000), chave do item (300) e textos de exibição (séries 20, repetições 40, carga 120, cadência 40, descanso 40, texto da dose 300). Acima do tamanho, o motor resume e avisa (`TRACE_TRUNCATED`, `DISPLAY_TRUNCATED`, `ISSUES_AGGREGATED`). Avisos: até 300 um a um (erros primeiro); o resto, inclusive erros, agrupado por severidade, código e fase com contagem (um erro agrupado continua ERROR). Teste: 12 fases × 4 semanas × 6 sessões com uma dose inválida em todos os itens dá resumo (sem as sessões) abaixo de 500000 caracteres. O teto de sessões totais e de unidades de trabalho por pedido será medido na S6 (`workerd` local).

### Estrutura da periodização v2 (etapa S2)

Em `src/modules/training/contracts.ts` (`STRUCTURE_LIMITS`), todos técnicos e não recomendação de treino:

| Limite | Valor | Por quê |
|---|---|---|
| Fases | 1 a 12 | CHECK 1..12 de `prescribed_exercises.phase_index` (0006) e `workout_sessions.phase_index` (0012); refazer não é aditivo (Q4) |
| Semanas por fase | a partir de 1 | sem teto próprio; o total de sessões e o fim do calendário (2100) limitam |
| Sessões por semana | 1 a 14 | duas por dia em todos os dias |
| Sessões no ciclo (Σ semanas × sessões) | até 504 | **provisório**: o maior total que a v1 já permitia (12 × 6 × 7). A S6 mede a aplicação no pior caso sob `workerd` e pode subir; nunca baixar, senão estruturas salvas deixam de ser lidas |
| Rótulo do treino | 1 a 20 caracteres, sem `\|`, `/`, `\`, caracteres de controle, de formatação nem separadores de linha; pelo menos uma letra, número ou símbolo visível; não só pontos | CHECK de `workout_label` (0006/0012); `\|` separava "fase\|rótulo" no editor; `/` e `\` vão no endereço de registro do aluno, onde `.` e `..` são removidos pelo navegador; um rótulo só de caracteres invisíveis aparece vazio na tela |
| Alvo por treino | 1 a 20 ou "sem alvo" | 20 é a decisão do usuário na 0.93; 1 porque uma sessão de outra modalidade pode ter um só exercício |
| Rotação | 1 a 504 posições, só rótulos da fase | posições além das sessões não são usadas; o teto só limita o que é gravado |
| Dias de treino | um por sessão, 0 a 6, em ordem | dia 0 = primeiro dia de cada semana da fase; sem dias, a data prevista fica vazia (nunca presumida) |
| Mesmo treino no mesmo dia | recusado: com dias, o mesmo rótulo duas vezes numa data prevista; sem dias, o mesmo rótulo mais de 7 vezes numa semana | o registro do aluno guarda um treino por dia (UNIQUE de `workout_sessions`, 0012; Q5); a rotação continua entre as semanas, e cada semana é conferida |
| Nome da fase / do treino / foco | 60 / 60 / 160 caracteres; minutos 1 a 600 | textos de exibição; o foco é anotação do profissional, nunca interpretado nem entregue ao aluno |

A v1 (divisão por letras, 3–6 semanas, 3/6/12 fases, alvo 3–20) continua sendo lida e gravada como antes. A conversão v1 → v2 (`convertV1ToV2`) não move sessão, rótulo nem alvo; a volta (`convertV2ToV1`) só existe quando a estrutura cabe na v1.

## Metadados da biblioteca (etapa S4)

Cada campo de um exercício é guardado à parte, com a sua procedência (migration 0044, tabela `exercise_attributes`):

| Procedência | O que quer dizer | Como aparece |
|---|---|---|
| REVIEWED | uma pessoa conferiu o valor (o profissional, para a organização; o gestor da plataforma, para a biblioteca do sistema) | "Revisado pela sua organização" / "Revisado (biblioteca do sistema)" |
| INFERRED | uma regra determinística pelo nome produziu o valor; guarda a regra e a versão das regras | "Inferido (não revisado)", com "Regra X (versão)" ao abrir o campo |
| PENDING | precisa de curadoria; o valor não é usado | "Pendente de curadoria" |

Campos: modalidade, medida da dose, músculos principais e secundários, padrões de movimento, equipamento, equipamento alternativo (até 3 conjuntos), dificuldade (1 a 5), lateralidade, multiarticular, segundos por repetição e marcadores de cuidado. Os códigos são os do motor; a biblioteca só grava os códigos da lista em `src/modules/biblioteca/metadata/vocabulary.ts` (validados no código, sem CHECK, para crescer sem reconstruir tabela). Alternativas curadas ficam em `exercise_relations`, por organização; a remoção é uma data, nunca um apagamento. Toda mudança fica em `exercise_attribute_events`, só de acréscimo.

**Precedência para uma organização** (`src/modules/biblioteca/metadata/status.ts` e a consulta de `src/db/exercise-metadata.ts`, mantidas iguais por teste): revisado pela organização > pendente pela organização > revisado no sistema > inferido pela organização > pendente no sistema > inferido no sistema. Valor revisado sempre vence o inferido; a inferência nunca sobrescreve o que uma pessoa decidiu (o banco recusa com `EXERCISE_ATTRIBUTE_REVIEW_WINS`). **Desvio do desenho (§4.3), a confirmar** (`docs/PENDENCIAS.md`, linha das decisões de 04/11/2026): o desenho não previa "pendente"; aqui o "Marcar como pendente" de uma pessoa da organização vence o revisado do sistema (só para ela), senão o botão não teria efeito num campo que o sistema revisou. Para discordar com um valor, a organização salva o seu revisado, que já vence o do sistema.

**Valores vazios:** numa lista, salvar sem nada marcado é recusado ("sem valor"); "nenhum" é uma opção própria ("Sem equipamento", "Nenhum marcador de cuidado"…), então nunca se grava "sem equipamento" ou "nenhum cuidado" por engano. Padrões de movimento não têm "nenhum": a lista vazia não é valor válido.

**Resumo por exercício:** "Pendente de curadoria" quando falta (ou está pendente) um dos campos de que o motor precisa (modalidade, medida, músculos principais, padrões, equipamento); "Inferido (não revisado)" quando todos existem e algum campo em uso é inferido; "Metadados revisados" quando todos os campos em uso foram revisados. Um campo opcional pendente só deixa de ser usado. O motor não escolhe automaticamente exercício pendente (S1); usa inferidos quando a confiança escolhida é "revisados e inferidos" (Q3).

**Inferência** (`src/modules/biblioteca/metadata/inference-rules.json`, `gymgital-library-inference@2026.11.2`, base "Heurística operacional (editável)"; código em `inference-core.ts`):
- o nome é normalizado (minúsculas, sem acento, o que não é letra nem número vira espaço) e dividido em palavras; uma palavra-chave casa quando as suas palavras aparecem em sequência no nome, cada palavra do nome começando pela da chave ("halter" casa "halteres");
- os campos são inferidos na ordem `fieldOrder`; em cada campo vale a primeira regra que casa, na ordem do arquivo (as específicas vêm antes); uma regra com valor nulo decide "não inferir" (uma pessoa preenche); uma regra pode olhar campos inferidos antes (`when`);
- só a modalidade tem recurso pela categoria (`MOD_BY_CATEGORY`), usado quando nenhuma regra casou; as regras que derivam outros campos da modalidade exigem um padrão de movimento reconhecido no nome, então a categoria sozinha nunca produz mais que a modalidade;
- uma regra pode exigir uma categoria (`categoryAny`), só para segurar um campo para uma pessoa quando categoria e nome discordam (valor nulo), nunca para produzir valor pela categoria; `noneWord` compara palavras inteiras (preposições como "com", "no");
- equipamento: "Sem equipamento" (`EQ_BODYWEIGHT`) só quando o nome é de um exercício de peso corporal **e** não tem preposição ("com", "no", "na", "em", "sobre"…), porque o que vem depois pode ser um implemento; implementos fora do vocabulário ("Smith", "anilha", "caneleira", "TRX", "bola", "mochila"…) deixam o campo pendente (`EQ_UNLISTED_IMPLEMENT`); "elástico"/"band" é `RESISTANCE_BAND`;
- lateralidade: "Unilateral" por palavras de um lado ("unilateral", "alternado", "serrote", "concentrada", "unipodal", "uma perna", "um braço", "single arm"…); **"Bilateral" é um padrão pela ausência** dessas palavras num exercício resistido reconhecido (`LAT_RESISTANCE_BILATERAL`), por isso aparece como inferido e deve ser revisado; quando a categoria é "Unilateral" e o nome não diz o lado, o campo fica pendente (`LAT_CATEGORY_UNILATERAL`: na biblioteca do sistema essa categoria agrupa também panturrilha e abdução, que não são de um lado só);
- dificuldade, segundos por repetição e marcadores de cuidado nunca são inferidos;
- sem acaso, relógio nem idioma do servidor: mesmo nome e mesma versão dão os mesmos bytes.

**Onde roda:** a semente da biblioteca do sistema (migration 0045, gerada por `node --experimental-strip-types scripts/enrich-system-library.mjs`; um teste compara o arquivo com o gerador byte a byte) e o botão "Inferir metadados das minhas fichas" (só os exercícios próprios da organização, não arquivados; atualiza inferências antigas, devolve a pendente o que a regra deixou de produzir, nunca toca o que uma pessoa revisou ou marcou). Na semente, 12 dos 64 exercícios ficam pendentes porque o nome não diz o equipamento (ex.: "Elevação lateral") ou a medida ("Farmer walk"). A semente também grava um evento INFERRED por linha, sem pessoa (o histórico do exercício mostra "semente da biblioteca do sistema").

**Renomear:** salvar um exercício próprio com outro nome ou categoria atualiza, na mesma gravação (mesmo lote do D1), os valores inferidos dele: refaz os que a regra ainda produz e devolve a pendente os que ela deixou de produzir; o que uma pessoa revisou ou marcou fica como está. Só vale para exercício em que a inferência já rodou (sem linhas inferidas, renomear não grava metadado). Cada instrução da inferência só se aplica se o exercício tem exatamente aquele nome e aquela categoria, então um salvamento recusado por concorrência não muda metadado.

**Histórico:** evento da inferência é creditado à regra (com a versão), e a pessoa aparece só como quem iniciou a execução ("execução iniciada por Maria"); a página mostra as 20 alterações mais recentes e avisa quando há mais (todas ficam guardadas).

**Alternativas nos dois escopos:** a organização não pode acrescentar uma alternativa que a biblioteca do sistema já curou ("duplicada"); se o par já existia nos dois escopos (a organização acrescentou antes da curadoria do sistema), a leitura lista o alvo uma vez só, com a relação da organização (a que ela pode remover).

**Limites técnicos** (nenhum é regra de treino; nenhum foi medido; mudar qualquer um é só código, sem migration):
- até 12 alternativas curadas por exercício e escopo (`MAX_ALTERNATIVES`): verificado no próprio INSERT e limita as linhas que um lote de `resolve()` devolve (200 exercícios × 12 × 2 escopos); o motor também acha substituições por músculo e padrão, então uma lista curada maior acrescenta pouco;
- até 3 conjuntos de equipamento alternativo (`MAX_EQUIPMENT_ALTERNATIVES`): o editor mostra um grupo de caixas por conjunto, e o valor guardado tem o limite de 2000 caracteres da 0044 (16 códigos × 3 conjuntos cabe com folga);
- leituras e a inferência em lotes de 200 itens por instrução (`json_each`, a lista vai como UM valor ligado, nunca no texto do SQL): poucas dezenas de KB por instrução; não medido sob workerd (S6);
- o histórico na página mostra as 20 alterações mais recentes (`HISTORY_LIMIT`), por legibilidade no celular; não é retenção.

## Adaptador dos dados reais do aluno (etapa S5)

`src/modules/prescricao/automatica/` liga o motor aos dados reais, só no servidor (`input.ts` com `server-only`). Ainda não há tela nem gravação de proposta (S6 e S9).

- **Leitura** (`context.ts`, `loadGenerationContext`): o plano e a revisão por `plansFor(...).findRevision` (só DRAFT; READY, APPROVED e DELIVERED respondem `not_open`), a ficha (`profilesFor`), a avaliação registrada mais recente (`assessmentsFor`: `standing`, `get`, `sections` da Avaliação Física), a biblioteca visível e não arquivada (`exercisesFor(...).list`) com os metadados resolvidos (`exerciseMetadataFor(...).resolve`), as linhas já prescritas do rascunho (`prescriptionFor(...).listWithDose`) e o histórico de execução (`executionFor(...).exposures`). Organização e usuário vêm da sessão verificada; cada consulta filtra organização, usuário ativo, vínculo técnico ativo e revogação. Qualquer falta de acesso responde `not_found`, igual para todos os casos.
- **Mapeamento** (`facts.ts`, puro):
  - ficha: nível, objetivo e minutos por sessão como dados do aluno; os textos livres (equipamentos, preferências, lesões, observações) são mostrados ao profissional e nunca interpretados;
  - triagem: PAR-Q da Avaliação Física (todas "Não" → liberada; algum "Sim" → alerta, com a decisão do profissional: "Liberado", "Precisa de liberação médica" ou "Outra decisão"; resposta faltando → não feita); no formato anterior, o risco da coluna, e uma revisão registrada conta como decisão (`REVIEWED`), nunca como "liberado"; sem avaliação → não feita. "Precisa de liberação médica" não bloqueia (R13, fechada pelo usuário em 03/11/2026);
  - achados: anamnese com "Sim" (só o rótulo do catálogo, nunca os detalhes), postura (só achados que não são o neutro), Flexiteste (quantos movimentos), testes de repetição e os resultados com método, "estimativa" e as limitações da fórmula. Todos viram alertas de informação: **observação isolada da avaliação não é contraindicação automática**. Só o teste de movimento do formato anterior com grau "limitação moderada" ou "interrompido por dor" gera uma sugestão de exclusão de padrão, que só vale quando o profissional aceita;
  - biblioteca: os campos resolvidos pela precedência da S4; campo ausente ou pendente fica vazio, nunca adivinhado; o resumo vira `metadataStatus` (pendente de curadoria nunca é escolhido);
  - estrutura: as sessões vêm do próprio calendário salvo (as mesmas semanas, posições e datas que o aluno vê); sem dias de treino, sem data;
  - linhas já prescritas: todas preservadas, com o texto como foi digitado; dose estruturada só quando a guardada é válida;
  - histórico (`src/modules/execucao/exposures.ts`): por exercício e sessão, as séries como digitadas (repetições, carga, RIR da série, duração, base da carga), o esforço da sessão e a dor; o RIR do exercício nunca é copiado para as séries; exercício digitado pelo nome (fora da biblioteca) e exercício marcado como não feito (sem dor) ficam de fora, contados à parte.
- **Respostas da geração** (`contracts.ts`, `GenerationAnswers`, estrito): estímulo por fase, modalidades por treino, equipamentos (ou "sem equipamento"), minutos, tempo como referência ou limite, quantidade de exercícios por treino, preferidos e excluídos, padrões e marcadores excluídos, cobertura, progressão semanal, ajustes da política de doses, métrica por exercício, confiança nos metadados e decisões de alertas. Todo id de exercício precisa estar na biblioteca visível e todo alvo (fase, treino) na estrutura salva; senão a resposta é recusada.
- **Perguntas** (`build-input.ts`): o que falta vira pergunta, nunca número. Obrigatórias (bloqueiam a geração): estímulo da fase (com sugestões do objetivo em botões, nada pré-selecionado), equipamentos, quantidade de um treino "sem alvo", modalidades quando o estímulo não tem modalidade padrão. Informativas: tempo por sessão, ficha ausente, nível, objetivo, avaliação ausente, "Sim" sem decisão.
- **Premissas** (além das do motor): padrões usados (dose pela política, metadados revisados e inferidos, tempo como referência), avaliação usada, janela do histórico (`EXPOSURE_WINDOW_DAYS`) e corte técnico, registros fora da biblioteca, exercícios pendentes de curadoria, marcadores de cuidado não revisados, estrutura no formato anterior, linhas preservadas, textos livres não interpretados, check-ins fora da geração (Q6).
- **Referências para a trilha** (`GenerationFactRefs`): só ids, datas e contagens (plano, revisão e `content_version`, data da ficha, avaliação, tamanho do catálogo por procedência, janela do histórico, linhas existentes). Nenhum texto de saúde.

**Limite técnico:** o histórico lê no máximo as 200 sessões mais recentes da janela (`EXPOSURE_MAX_SESSIONS`): numa janela de 180 dias isso cobre cerca de uma sessão por dia e mantém o pior caso (30 exercícios × 20 séries) uma leitura limitada; quando corta, a premissa `HISTORY_TRUNCATED` avisa. Não medido sob workerd. Cada lista das respostas aceita até 500 itens (`MAX_ANSWER_LIST`), só para limitar o corpo de uma ação.

## A completar (S10)

Perguntas feitas e por quê, onde ficam os dados de saúde e como a exclusão afeta a reprodução, números medidos.
