# Motor de prescrição v2 (`ENGINE_VERSION` 2.2.0)

Núcleo puro e determinístico (sem banco, rede, IA, relógio ou acaso). Documentação completa e tabela de regras: [`docs/MOTOR-PRESCRICAO.md`](../../../../docs/MOTOR-PRESCRICAO.md).

**Estado:** o motor (2.2.0) e as regras `2026.11.4` não mudaram na versão 0.97.0 (Motor V4, PR 1, não publicada). O planejador por IA e por regras vive ao lado, em [`../planejador/`](../planejador/), e **não é importado por este diretório** (teste estático); a compilação do blueprint no motor é a PR 2. Histórico: versão 0.95.0 (Motor V3, branch `feat/motor-v3-auditoria-microciclo-20261104`, não publicada): fatia A (Flexiteste detalhado, progressão pelas execuções mais recentes) com testes rodando; fatia B (auditoria do plano, regras `2026.11.3`, `AUDIT_VERSION` 1.0.0) e fatia C (seleção por microciclo, alvos sugeridos para aceitar, regras `2026.11.4`) feitas; fatia D não iniciada; fatia E só contratos de IA desligados (`automatica/ai/`). Base: 0.94.0 (etapas S1 a S10, PR #95). O motor, o adaptador dos dados reais (`src/modules/prescricao/automatica/`, só no servidor), as propostas, a aplicação ao rascunho, os leitores por sessão e a interface do profissional estão ligados ao fluxo de aprovação e entrega de sempre. O que o motor faz e não faz, versões, bases, tabela de regras (com teste de divergência), modelos de dose, metadados da biblioteca, limites técnicos medidos, perguntas da geração e dados de saúde: [`docs/MOTOR-PRESCRICAO.md`](../../../../docs/MOTOR-PRESCRICAO.md).

| Arquivo | Papel |
|---|---|
| `types.ts` | Tipos: fatos com base, doses por métrica, entrada, resultado, escopos |
| `rules/` | Regras em JSON (`gymgital-base@2026.11.1`, `@2026.11.2`, `@2026.11.3` e `@2026.11.4`, a usada nas gerações novas), registro congelado, referências (não verificadas) |
| `generate.ts` | Geração completa, revalidação, unidades de trabalho |
| `regenerate.ts` | Regenerar escopos, substituir, alternativas, rebase |
| `select.ts`, `eligibility.ts` | Seleção gulosa por cobertura e elegibilidade (equipamento, modalidade, exclusões, confiança nos metadados) |
| `microcycle.ts`, `occurrence.ts` | Seleção da fase inteira por microciclo (regras 2026.11.4) e ocorrências reais de cada treino por semana |
| `audit.ts`, `targets.ts` | Auditoria pura do plano inteiro (fora de `issues`, só WARNING/INFO) e alvos sugeridos (só valem depois de aceitos) |
| `dose.ts`, `progress-week.ts` | Doses em camadas, progressão semanal, texto pt-BR |
| `duration.ts`, `volume.ts`, `flags.ts` | Duração × disponibilidade, volume por músculo, alertas |
| `progression.ts` | Sugestão de progressão pelo histórico (nunca valor) |
| `bounds.ts` | Limites técnicos de gravação |
| `hash.ts`, `calendar.ts`, `vocabulary.ts`, `trace.ts`, `validate.ts` | Apoio |

API: `generate`, `regenerate`, `substitute`, `rebase`, `alternativesFor`, `revalidate`, `validateDose`, `toDisplayFields`, `describeStructuredDose`, `proposeProgression`, `canonicalInput`, `canonicalRequest`, `sha256Hex`, `scheduleOccurrences`, `workUnits`.
