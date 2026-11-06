# Gymgital — Handoff V4: Motor de prescrição híbrido (IA planejadora + motor determinístico)

Status: ESPECIFICAÇÃO DE PRODUTO E DESIGN (05/11/2026). **Em implementação: a PR 1 (0.97.0, branch `feat/motor-v4-pr1-planejador-ia-20261105`, não publicada) cobre F1 e F2 em parte; ver a seção "Status de implementação" no fim.** O restante continua não implementado. Wireframes V4 criados no mesmo Figma em 05/11/2026. Aprovação técnica, integração do provedor e validação em ambiente real ainda pendentes.

## 0. Decisão arquitetural

Evoluir o Gymgital de gerador determinístico de exercícios para planejador assistido que compreende a **intenção de cada treino** antes da seleção dos exercícios.

A IA é **planejadora e colaboradora da montagem**, não apenas revisora posterior. Um plano estruturado ("Training Blueprint") organiza divisão, alvos dominantes, papéis das sessões, estratégias de dose e progressão por fase. O motor atual é **compilador e validador**: resolve exercícios elegíveis, calcula volume, tempo e doses, audita, persiste a proposta e mantém o fluxo de revisão. Somente o profissional decide aceitar, aplicar, aprovar e entregar.

O modo "Por regras" permanece disponível **sem custo de inferência e sem dependência de fornecedor**. A modalidade com IA é uma opção explícita na geração; se não houver provedor, credencial e habilitação jurídica/organizacional válidos, o modo IA não executa silenciosamente.

**Não implementar outra stack de periodização, outro cadastro de exercícios, outro approval workflow ou outro subsistema independente de propostas.** Consumir as estruturas da solução atual.

## 1. Base real do repositório — 05/11/2026

Repositório rafsoaresm/projeto-musculo, branch main, package.json 0.96.0. PR #98 de auditoria e microciclo já incorporado. PR #95 construiu o motor; #97 corrigiu Flexiteste/progressão; #98 implementou B e C. O código existente inclui:

- src/modules/prescricao/motor/generate.ts, microcycle.ts, select.ts: seleção de exercícios por treino e microciclo, com rastreabilidade.
- src/modules/prescricao/motor/audit.ts, targets.ts, volume.ts: auditoria de semanas reais, volume e metas.
- src/modules/prescricao/motor/dose.ts, progress-week.ts, progression.ts: dosagem e programação por semana, progressão por histórico.
- src/modules/prescricao/motor/types.ts, rules/: fatos tipados e regras imutáveis, atualmente gymgital-base@2026.11.4.
- src/modules/prescricao/automatica/facts.ts, build-input.ts, context.ts: dados reais da triagem, avaliação, ficha, periodização e histórico.
- src/modules/prescricao/automatica/actions.ts, service.ts, contracts.ts, generation-form.tsx, proposal-view.tsx, audit-panel.tsx: fluxo de geração, revisão e aplicação já existente.
- src/modules/prescricao/automatica/ai/config.ts, contracts.ts, summary.ts, reviewer.ts: contratos de **REVISÃO** por IA, desligados. O reviewer é NO-OP por padrão. O summary desse módulo é pós-proposta: não é uma entrada suficiente para planejar antes da proposta.

A versão 2026.11.4 usa MICROCYCLE_SELECTION com weeklyPatternNew 30, weeklyPatternRedundancy -8 e targetAffinity 12; os alvos de hipertrofia propostos para a fase têm padrões amplos, que podem produzir full body em A e B se o treino não possuir foco. O novo sistema não deve tentar resolver sozinho isso apenas com pesos.

## 2. Novo ciclo funcional

1. Carregar contexto autorizado: aluno, ficha, triagem, avaliação atual, periodização salva, biblioteca elegível, histórico, preservados e travados.
2. Resumir contexto em formato estruturado mínimo; distinguir ausente, desconhecido, declarado pelo aluno, observado em avaliação e decisão do profissional. Não inventar dados. Alertas de PAR-Q e restrições exigem tratamento humano segundo o fluxo atual.
3. Oferecer modo de montagem: **Assistida por IA** / **Por regras**. O modo com IA efetua uma chamada de planejamento para o ciclo, não uma por exercício ou por sessão.
4. Retornar 2–3 estratégias alternativas e justificar trade-offs quando cabível (ex.: full body, superior/inferior, personalizado). Não obrigar o modelo a sempre oferecer 3 quando há poucos padrões plausíveis.
5. Profissional escolhe ou personaliza uma estratégia e confirma as divisões/focos **por fase**. A IA NÃO altera a estrutura de periodização salva sem aceite explícito se a sugestão mudar labels, rotação, frequência ou dias.
6. Construir um Training Blueprint por fase, refletindo cada treino/label e suas ocorrências reais, incluindo metas/ênfases e intenções de slots. Exibir a prévia do microciclo ANTES de montar exercícios.
7. Validar o blueprint, compilar com o motor existente, calcular doses/volume/tempo, auditar consistência e rastrear proveniência por decisão.
8. Apresentar revisão numa tela, permitindo editar, substituir, pedir à IA uma modificação contextual e comparar impactos antes de aceitar.
9. Aplicar à revisão em rascunho apenas por ação profissional. O sistema segue os estados existentes de aprovação, entrega, leitura do aluno e execução. Uma revisão entregue nunca é reescrita.

## 3. Contratos novos, com versionamento explícito

### 3.1 TrainingPlanningContext (servidor)

- contextVersion; planRevisionId e tenantId ficam SOMENTE no servidor, nunca vão ao modelo.
- student: experience enum|null, goalCodes[], availableMinutes|null, availableDaysPerWeek|null, equipmentCodes[], preferencesCodes[].
- screening: high-level decision codes, source refs e dados estritamente necessários, sem notas clínicas livres por padrão.
- assessments: indicadores estruturados pertinentes, método/limitações, medições de movimento por código e nível; achado isolado não é diagnóstico, contraindicação ou patologia inferida.
- periodization: phases [{index, weeks, sessionsPerWeek, rotation, availableDates, existingWorkoutLabels, existingFocus, existingProgression}], estrutura imutável na montagem até aceite.
- history: estatísticas de aderência, RIR observado, volume e tendência por exercício/semana, sem identificadores pessoais.
- constraints: locked/preserved/substituted, prohibited patterns/exercises explicitamente registrados pelo profissional, orçamento de tempo, modalidades permitidas, catálogos disponíveis, objetivos aceitos.
- eligibleCandidatePool: shortlist compacta de IDs substituídos por alias X1, X2..., metadados revisados, padrões, músculos, equipamento, dificuldade, métrica, variantes. Não exportar nomes livres/IDs reais sem necessidade e sem revisão de privacidade.

A coleta deve ser feita no caminho autorizado de automatica/context.ts. Nunca passar direto do client payload a uma chamada à IA. Compactar o contexto e registrar quais campos foram omitidos.

### 3.2 TrainingBlueprint v1 (resposta estruturada da IA)

Campos propostos:
- blueprintVersion, promptVersion, modelId (metadados registrados no servidor).
- globalStrategy: goalCode, rationale, confidence/uncertainty, keyTradeoffs, planningAssumptions.
- strategies[]: strategyId, displayName, splitFamily (FULL_BODY, UPPER_LOWER, PUSH_PULL_LEGS, BODY_PART, CUSTOM), explanation, requiresScheduleChange, supportedByContext. Lista para escolha; alternativas não aprovadas não viram plano.
- selectedStrategyRef: somente após aceite explícito do profissional.
- phases[]: phaseIndex, splitType, source (AI_SUGGESTED|PROFESSIONAL|STRUCTURE), rotationProposal opcional, workouts[].
- workouts[]: label real da periodização ou alias verificado, role, dominantMuscles[], supportingMuscles[], targetPatterns[], allowedSpilloverPatterns[], desiredFrequency, plannedSessionsInCycle.
- slotIntents[]: priority, requiredPattern, targetMuscles, compoundPreference?, optionalCandidateAliases[], substitutionAllowed?, doseProfileCode?.
- dosingIntent: perfil de estímulo por classe de exercício ou slot, faixas propostas e racional, sem quilos inventados; o motor aplica dose validada segundo regras versionadas.
- progressionIntent: evolução de volume/intensidade por fases e condições de adaptação; deload não automático sem política validada.
- sourceRefs: referências do contexto permitido; sem artigos fabricados; basis AI_SUGGESTED distinto de EVIDENCE, STUDENT_DATA ou PROFESSIONAL.
- questionsForProfessional[]: somente lacunas realmente necessárias; considerar default explícito quando permitido.

**O schema Zod deve ser estrito e limitado.** Verificar fase/label/rotação, enums permitidos, quantidade de slots e candidatos, disponibilidade de equipamentos, natureza da modalidade, itens bloqueados, orçamento de processamento e limites do motor atual. O modelo não pode fornecer um novo ID de exercício ou alterar implicitamente um item preservado.

### 3.3 Compilação

Implementar convertBlueprintToGenerationAnswers() ou adaptador equivalente, de modo a **reusar** GenerationAnswers e EngineInput no servidor, preservando suas versões, hashes e checagens. Foco por workout é dominante; alvo semanal de fase é global e nunca deve obrigar todo treino a cobrir todos os músculos.

Distinguir:
- A/B como rótulos + função superior/inferior (não mudar a estrutura ABAB).
- Proposta de mudar para ABCD ou PPL: requer editar a estrutura com aceite antes da geração, não trocar somente rótulos no blueprint.
- FULL_BODY solicitado: válido, mesmo com sobreposição alta.
- CUSTOM: alvos livres por treino, sem proibição arbitrária de trabalho acessório.
- Ausência de IA: fallback a geração atual com foco escolhido manualmente, não simular recomendações de IA.

## 4. Qualidade e doses

### 4.1 Auditoria de estratégia

A auditoria atual já compara volumes, regiões e padrões. Adicionar verificação de **aderência ao foco declarado** e à divisão aceita:
- Aderência por treino/semana: predominância dos alvos principais e conformidade de padrões.
- Sobreposição entre treinos como **diagnóstico**, não objetivo universal de minimização; full body intencional tende a sobrepor.
- Disponibilidade real e frequência do calendário; ABC com 2 dias/semana não pressupõe 3 exposições.
- Evidenciar quando um item vem de decisão humana, heurística da regra, IA ou dado do aluno.
- Avisos pós-geração devem permitir voltar a decisões estratégicas sem apagar edição manual.

### 4.2 Fatia D incluída na arquitetura

Doses não podem permanecer 8–12 reps, RIR 1–3 e 90 s indistintamente. Evoluir dose.ts e policies em rules/ **sem alterar regras publicadas**:
- perfil por estímulo, objetivo, composto/isolado, padrão, exercício, unilateralidade, duração, histórico e tempo;
- precedência: profissional e prescrições preservadas > doseOverride explícito > perfil específico versionado > padrão genérico;
- progressões condicionais baseadas em reps/RIR/carga e execução, sem assumir incrementos de equipamento;
- comparar proposta inicial, volume semanal, histórico e fadiga; ajuste pelo profissional, não edição de treino entregue.
- catálogo incompleto não justifica inventar biomecânica ou dose; registrar incerteza.

O planejador pode sugerir parâmetros e perfis, mas **motor e política versionada** validam/calculam. Rejeitar valores fora do contrato, explicar conflitos e permitir ajuste manual.

## 5. IA: fornecedor, custo e privacidade

Arquivos existentes em automatica/ai/ são contratos de REVISÃO desativados. Criar módulos próprios planner.ts, planner-contracts.ts, planning-summary.ts, provider.ts e orchestration.ts ou nomes equivalentes, sem sobrecarregar reviewer.ts.

- Uma consulta de planejamento por hash de contexto + revisão + decisões + versão de prompt/modelo. IA em etapas somente se o contrato exigir seleção de estratégia seguida do blueprint; reaproveitar o primeiro resultado sempre que possível.
- Não consultar para cada uma das 48 ocorrências do Xintus. Sessões repetidas são compiladas deterministicamente.
- Modelos econômicos avaliados com casos fictícios; seleção por qualidade e custo total, não por preço nominal isolado.
- Salvar contagem real de tokens e custo calculado conforme tabela de preços vigente do provedor; limites mensais por organização, idempotência, cache, circuit breaker, timeout e retry limitado.
- Orçamento 0 e provedor ausente: nenhum gasto e nenhuma chamada. Sem fallback silencioso para um modelo mais caro.
- Cache deve ser segregado por tenant, invalidação por contexto/versão, TTL e direito à exclusão. Não armazenar prompts com dados sensíveis em logs.
- Antes de habilitar dados reais: revisar base legal LGPD, transferência ao provedor, retenção, contratos, redaction, consentimentos quando aplicáveis e controles de acesso. Substituir nomes por aliases NÃO é anonimização garantida.
- Nenhuma IA aprova, entrega, prescreve medicamentos, diagnostica ou impõe proibição sem base registrada.
- Saída de IA é dado não confiável; validar no servidor, proibir injection via texto livre, exigir binding de referências e aceitar somente IDs/ações permitidos.
- Manter funcionalidade do Gymgital íntegra se provedor cair ou demorar.

## 6. UX — Figma V4 (criado e editável)

Arquivo de referência: https://www.figma.com/design/RRHeYHC01jSd0hnrRzzBxP/Trainer-Prescription-UX-Redesign-Wireframes-V1

Os wireframes V4 foram adicionados **sem apagar as 35 telas AV, GEN, RX e AP existentes**. Consistem em 6 desktop (1440×900) e 2 mobile (390×844), construídos com textos editáveis, auto-layout e tokens locais do design system. São wireframes de proposta de UX, não fluxos navegáveis nem código de produção.

### Mapeamento de screens

- [GEN-01 Contexto e modo](https://www.figma.com/design/RRHeYHC01jSd0hnrRzzBxP/Trainer-Prescription-UX-Redesign-Wireframes-V1?node-id=111-1097) — mostra dados de origem e alternância Assistida por IA / Por regras. Não duplicar o onboarding do aluno; dados já vêm da ficha e avaliação.
- [GEN-02 Escolher estratégia](https://www.figma.com/design/RRHeYHC01jSd0hnrRzzBxP/Trainer-Prescription-UX-Redesign-Wireframes-V1?node-id=111-1295) — três modelos ilustrativos; estratégia marcada mas sem aplicação automática; breve razão e impacto na divisão.
- [GEN-03 Focos por fase](https://www.figma.com/design/RRHeYHC01jSd0hnrRzzBxP/Trainer-Prescription-UX-Redesign-Wireframes-V1?node-id=111-1493) — identidade de A e B por fase; foco dominante e padrões; mudanças na periodização exigem aceite.
- [GEN-04 Preview do blueprint](https://www.figma.com/design/RRHeYHC01jSd0hnrRzzBxP/Trainer-Prescription-UX-Redesign-Wireframes-V1?node-id=112-1196) — microciclo ABAB exemplar, dados, premissas e ação "Gerar proposta".
- [RX-01 Revisão por foco e doses](https://www.figma.com/design/RRHeYHC01jSd0hnrRzzBxP/Trainer-Prescription-UX-Redesign-Wireframes-V1?node-id=112-1330) — sessão com justificativas por foco, doses a revisar, auditoria e origem.
- [RX-02 Ajustes assistidos](https://www.figma.com/design/RRHeYHC01jSd0hnrRzzBxP/Trainer-Prescription-UX-Redesign-Wireframes-V1?node-id=112-1563) — ajuste contextual em chat, prévia do impacto e aplicação somente à proposta.
- [M-01 Estratégia mobile](https://www.figma.com/design/RRHeYHC01jSd0hnrRzzBxP/Trainer-Prescription-UX-Redesign-Wireframes-V1?node-id=115-1295) — seleção compacta no fluxo móvel do profissional.
- [M-02 Revisão mobile](https://www.figma.com/design/RRHeYHC01jSd0hnrRzzBxP/Trainer-Prescription-UX-Redesign-Wireframes-V1?node-id=115-1359) — foco, doses e ajuste com IA, com ação fixa e sem aprovação automática.

Os textos e exercícios dessas telas são EXEMPLOS VISUAIS baseados no cenário fictício Xintus; não representam uma prescrição executada ou clinicamente homologada.

### Contrato de interação

- Não criar wizard longo: processo percebido é conferir contexto → aceitar estratégia → revisar proposta. Política detalhada fica acessível sob demanda.
- Mostrar origem da estratégia: "Sugestão da IA", "Padrão por regras", "Decisão do profissional". Nunca rotular como evidência científica só por ter saído da IA.
- Visualizar foco por treino ANTES da lista de exercícios; a tela de revisão explica "Por quê?" com reflexo em volume e calendário.
- Aceitar/editar estratégia sem abrir múltiplas aprovações intermediárias.
- Ação principal após geração: Salvar revisão/Aplicar ao rascunho conforme estado atual; o fluxo aprovado permanece. Na UI de chat, "Aplicar ajuste à proposta" não é aprovar nem entregar.
- Qualquer pedido contextual deve receber contexto da versão escolhida, sugestões validadas, diff do plano, volume/duração recalculados e possibilidade de rejeitar.
- Indicar claramente "Gerando estratégia", "Montando prescrição", "Auditoria", "Pronta para revisão", "Falha da IA — continuar por regras", "Limite de uso" sem ocultar erros.
- Desktop: duas colunas (decisão e contexto) e rodapé de ação fixo, sem inflar botões e caixas. Mobile: cards compactos e CTA inferior.
- O usuário pode voltar à estratégia sem perder substituições/edições; oferecer confirmação antes de replanejamento destrutivo.
- Antes da implementação visual, revisar as 8 telas V4 junto aos frames anteriores AV, GEN, RX e AP. O front deverá usar componentes existentes de navegação/DS.

## 7. Entregas técnicas por fatia

F0 — Benchmark e instrumentos de medição (não bloquear o trabalho posterior): matriz de 2–6 dias/semana, modalidades distintas, aluno iniciante/intermediário/avançado, ABAB, ABC, PPL, full body, personalizados, calendário irregular, equipamento parcial, triagem em aberto, histórico ausente/contraditório. Métricas: aderência ao foco, equilíbrio de volume, elegibilidade, tempo, estabilidade, número de correções, custo por proposta e aprovação do técnico. Sobreposição é contextual, não critério único.

F1 — Contexto e contratos: PlanningContext, Blueprint Zod estrito, provenance, hash e conversor para geração existente. Testes em ambiente puro, sem API externa.

F2 — IA planejadora real: provider server-only, prompt versionado, modelo pequeno configurável, saída estruturada, custo/cotas/cache, proteção de dados, status de falha, comparação de 2–3 estratégias; feature flag desligada até revisão jurídica e validação do responsável.

F3 — Compilador do blueprint: adaptar build-input e microcycle para foco dominante por treino/fase; manter decisões antigas soberanas, regeneração e escopo. Regras novas em arquivo imutável, nunca editar gymgital-base@2026.11.4.

F4 — Doses adaptativas: política por classe de exercício, progressão por fase e histórico, auditoria de saltos e diferenciação de pausa/reps/RIR. Validação técnica do profissional de Educação Física.

F5 — UX e orquestração: telas V4 no produto, revisão única, histórico/explicações, diff e pedido de ajuste com IA contextual, versão da proposta persistida.

F6 — Observabilidade e rollout: registro de latência/custos e qualidade por organização; flags, limites, testes e2e mobile/desktop, Workers/D1 real após autorização. Comparar taxa de aceitação versus baseline determinística.

## 8. Critérios de aceite completos

1. Xintus: 4×/semana, 60 minutos, 12 semanas, ABAB. Ao aceitar superior/inferior, A e B exibem papéis diferentes, seleção respeita os alvos e auditoria reconhece distribuição real. O resultado não pode ser inteiramente full body por falta de foco; FULL_BODY escolhido explicitamente deve continuar válido.
2. As três fases podem ter divisões e focos distintos, coerentes com o calendário e objetivos. Uma IA que sugira ABCD para uma estrutura ABAB só pode alterar a rotação após aprovação explícita.
3. Nenhum exercício não elegível entra, nenhuma carga é inventada, nenhum achado de avaliação isolado elimina exercício e nenhum item profissional é sobrescrito.
4. RIR, reps e pausas variam segundo políticas justificadas quando apropriado, sem exigir variação decorativa. Valores continuam editáveis.
5. Repetir a geração com os mesmos dados, estratégias aceitas, versão de regras e seed/contrato do provedor retorna plano determinístico após blueprint aprovado; resposta da IA e seu hash ficam registrados para reprodução. Não alegar que modelo probabilístico tem saída idêntica sem cache.
6. Auditoria e sugestões são recalculadas após alteração; nenhuma aprovação automática, nenhuma mudança em revisão entregue.
7. Com IA desligada, o modo por regras funciona integralmente e apresenta focos manuais claramente.
8. Erro da API, timeout ou JSON inválido não perde dados nem avança a aprovação; há fallback por regras e reexecução idempotente.
9. Testar idempotência e corrida de versões, isolamento de organização, cotas, retenção e exclusão de dados, payload/escopo, taxa de erro e budget.
10. Validar lint/TS/vitest, build cloud, e2e raiz e mount /treinador, benchmark de CPU/memória; documentar explicitamente o que NÃO foi validado em Webflow Cloud/D1 remoto.
11. Testar interface a 390px e 1440px, rotação entre cards, estados loading/erro/sem provedor e CTA fixo sem sobreposição.
12. Nenhuma comparação supostamente científica ou prescrição é apresentada como homologada sem validação do Técnico.

## 9. Como iniciar no Claude Code

1. Abrir este arquivo, docs/MOTOR-PRESCRICAO.md e AGENTS.md; comparar cuidadosamente com main atual.
2. Abrir os 8 frames V4 e os frames anteriores; não reimaginar o visual nem aumentar as etapas de revisão.
3. Implementar F1 e F2 em branch separada, com provider configurável e desabilitado até habilitação explícita; preparar testes sem gasto real.
4. Depois implementar F3 e F4, com comparação de casos fictícios, sem apagar exercícios existentes e sem modificar regras antigas.
5. Só então adaptar telas do front conforme Figma V4 (F5), mantendo a aprovação/entrega do usuário.
6. Abrir PRs incrementais, documentar contratos, decisões, trade-offs e resultados; não fazer merge/deploy sem autorização.

**Nota:** esta entrega consiste somente em documentação e wireframes. Nenhuma rota, integração de modelo de IA, alteração no runtime do motor, migração, teste executado ou deploy foram realizados por este handoff V4.

## Status de implementação (atualizado em 05/11/2026, PR 1, versão 0.97.0, não publicada)

Legenda: FEITO = código, testes locais e documentação; PARCIAL = existe mas falta parte; NÃO FEITO. Nada abaixo foi verificado com provedor real, no D1 remoto nem num Worker real (ver `VALIDACAO.md`, seções do Motor V4, PR 1, "O que NÃO foi verificado").

**Decisões do usuário de 05/11/2026 que ampliaram a PR 1:** três provedores reais (OpenAI, Anthropic, Google) atrás da porta `PlannerProvider`, painel do gestor "Inteligência artificial" (chaves cifradas, modelos por tarefa, planos de IA, organizações, uso), envio real **autorizado só com dado anonimizado**, limite de tokens por plano de IA, "Por regras" também gera estratégias.

| Fatia | Estado | O que existe | O que falta |
|---|---|---|---|
| F0 Benchmark | NÃO FEITO | — | PR 5 |
| F1 Contexto e contratos | FEITO nos contratos | `TrainingPlanningContext` v1 anonimizado, `TrainingBlueprint` v1 (zod estrito), validador vinculante, hashes, vista segura | o conversor para a geração existente é a PR 2 |
| F2 IA planejadora real | PARCIAL | porta + `mock` e 3 adaptadores (só com `fetch` simulado), prompt versionado, saída estruturada, portões, cota por plano, reserva e livro, cache, idempotência, voo único, disjuntor, falhas com "continuar por regras", painel do gestor | primeira chamada real a cada provedor (pendência do Responsável); tela do profissional (PR 4); relatórios (PR 5) |
| F3 Compilador do blueprint | NÃO FEITO | o modo por regras já produz o blueprint | aceite, compilação, regras `2026.11.5` (PR 2) |
| F4 Doses adaptativas | NÃO FEITO | `doseIntent` existe só no contrato | PR 3 |
| F5 UX e orquestração | NÃO FEITO | ações de servidor `getPlanningAvailability`, `planStrategies`, `getPlanningState`, `getLatestStrategies` (sem botão) | telas GEN/RX/M e ajustes por linguagem natural (PR 4) |
| F6 Observabilidade | NÃO FEITO | uso por organização e mês no painel | PR 5 |

**Critérios de aceite (seção 8) após a PR 1:**
1. Xintus com A e B diferentes: PARCIAL. O blueprint (IA simulada e por regras) já dá papéis diferentes para A e B em todas as fases e o teste confirma; a seleção de exercícios ainda não usa o blueprint (PR 2).
2. Fases com divisões distintas, e ABCD sobre ABAB só informa: PARCIAL (validador e cartão `requiresScheduleChange` prontos; aceite e edição da periodização na PR 2).
3. Nenhum exercício inelegível, nenhuma carga inventada: PARCIAL (candidatos só do pool elegível; a compilação é da PR 2).
4. Doses variando por política: NÃO FEITO (PR 3).
5. Reprodução determinística após blueprint aceito: PARCIAL (resposta validada e hashes ficam gravados; "aceito" e "compilado" são da PR 2).
6. Auditoria recalculada, nenhuma aprovação automática: ATENDIDO no que existe (nada aqui aprova, libera, aplica nem escreve em plano; teste estático).
7. IA desligada, modo por regras integral: ATENDIDO para planejar estratégias; a geração por regras de sempre não mudou.
8. Erro, timeout ou JSON inválido sem perder dado, com fallback e reexecução idempotente: ATENDIDO nos testes locais (provedor simulado e `fetch` simulado).
9. Idempotência, corrida, isolamento, cotas, retenção, exclusão, payload, orçamento: ATENDIDO nos testes locais (Miniflare); taxa de erro real e corrida real no D1 remoto não foram medidas.
10. Lint, TS, vitest, build cloud, e2e nos dois mounts: ver `VALIDACAO.md`; benchmark de CPU e memória e Worker/D1 remoto: NÃO FEITO.
11. Interface a 390 e 1440 px: só o painel do gestor; as telas V4 do profissional são da PR 4.
12. Nada apresentado como homologado: ATENDIDO (rótulo "Heurística operacional (editável)"; validação do Técnico aberta em `PENDENCIAS.md`).

### Atualização da PR 2 (06/11/2026, versão 0.98.0, branch `feat/motor-v4-pr2-blueprint-motor-20261105`, não publicada)

- **F3 Compilador do blueprint: FEITO no servidor e nos testes, sem tela.** Regras `gymgital-base@2026.11.5` (sem estratégia dá o resultado da `2026.11.4`), compilador, seleção por microciclo guiada pelo foco do treino, aceite idempotente e geração a partir dele (`planejador/accept.ts`), "voltar à estratégia", aderência à estratégia na auditoria `1.1.0`, vínculo gravado (migration 0048) e origem de cada item em facetas.
- **Critérios após a PR 2:** 1 (A e B diferentes, Xintus pelo servidor, IA simulada e regras) e o respeito ao corpo inteiro explícito: ATENDIDOS no servidor e nos testes; 2 (fases com divisões distintas): ATENDIDO no servidor; 5 (reprodução determinística de um blueprint aceito): ATENDIDO nos testes locais; 3 e 4 (doses): PR 3; 7 (telas): PR 4. Nenhuma ação do navegador chama o aceite nem a geração ainda.
- **Não verificado:** Workers (CPU, memória), D1 remoto, provedor real, Figma. Ver `VALIDACAO.md`.
