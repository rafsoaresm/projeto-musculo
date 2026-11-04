# Motor de prescrição automática

Documento do motor de prescrição (pedido do usuário de 04/11/2026, PR #95). **Estado: só o motor (etapa S1).** O motor é código puro em `src/modules/prescricao/motor/`, testado isoladamente (`tests/motor-*.test.ts`). **Ainda não está ligado ao banco, às telas nem ao fluxo de aprovação e entrega**: isso vem nas etapas seguintes (estrutura v2, migrations 0041–0045, adaptador, propostas, aplicação, leitores e interface). As seções marcadas "a completar" são preenchidas na etapa final (S10).

## O que o motor faz

- Recebe fatos já autorizados (aluno, triagem, avaliação, periodização inteira, biblioteca visível, histórico, linhas atuais da revisão) e devolve uma **proposta para revisão profissional** (`requiresProfessionalReview: true`). Nunca aprova nem entrega.
- Gera **todas as sessões** de todas as fases e semanas (qualquer quantidade de fases, semanas e sessões por semana, dentro dos limites técnicos abaixo), com uma seleção de exercícios por treino da fase e uma dose por sessão.
- Doses em **modelos por métrica**: repetições (séries, faixa, RIR/PSE/%1RM, descanso, cadência, método), tempo, distância, intervalado (blocos, repetições, estímulo, recuperação ativa/passiva) e contínuo. Força não é forçada em séries × repetições quando não cabe. **O motor nunca propõe quilos, zonas ou ritmos**: esses vêm do profissional.
- Progressão semanal: rampa linear, degraus, sequência ondulatória (por semana ou dentro da semana), blocos, ajustes por semana e descarga; combináveis.
- Histórico: continuidade pesa na seleção, dor relatada vira alerta e sugestão de exclusão; a progressão por histórico é **só sugestão** (nunca vira valor).
- Revisão: regenerar item, sessão, semana, treino (a partir de uma semana), fase ou desta fase em diante; substituir em uma sessão, a partir de uma semana ou na fase; alternativas; trazer linhas novas da revisão (rebase). Linhas existentes são preservadas; itens travados ficam.
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

A tabela abaixo é gerada de `src/modules/prescricao/motor/rules/gymgital-base.json` por `renderRulesTable`; um teste (`tests/motor-rules.test.ts`) falha se ela divergir. Para mudar um número, publique uma versão nova do conjunto (as gravadas continuam reproduzíveis).

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

Em `motor/bounds.ts` (`TECHNICAL_LIMITS`), cada um com o motivo: 12 fases (CHECK 1..12 das tabelas 0006/0012; refazer não é aditivo), 14 sessões por semana, 30 exercícios por treino (`MAX_PER_WORKOUT` e `MAX_EXERCISES` da execução, até medição), tamanhos das colunas de traço (8000), alternativas (4000), chave do item (300) e textos de exibição (séries 20, repetições 40, carga 120, cadência 40, descanso 40, texto da dose 300). Acima do tamanho, o motor resume e avisa (`TRACE_TRUNCATED`, `DISPLAY_TRUNCATED`, `ISSUES_AGGREGATED`). O teto de sessões totais e de unidades de trabalho por pedido será medido na S6 (`workerd` local).

## A completar (S10)

Metadados da biblioteca, perguntas feitas e por quê, onde ficam os dados de saúde e como a exclusão afeta a reprodução, números medidos.
