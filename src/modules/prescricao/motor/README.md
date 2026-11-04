# Motor de prescrição v2 (`ENGINE_VERSION` 2.0.0)

Núcleo puro e determinístico (sem banco, rede, IA, relógio ou acaso). Documentação completa e tabela de regras: [`docs/MOTOR-PRESCRICAO.md`](../../../../docs/MOTOR-PRESCRICAO.md).

**Estado:** versão 0.94.0 (etapas S1 a S10 feitas, PR #95, não publicada). O motor, o adaptador dos dados reais (`src/modules/prescricao/automatica/`, só no servidor), as propostas, a aplicação ao rascunho, os leitores por sessão e a interface do profissional estão ligados ao fluxo de aprovação e entrega de sempre. O que o motor faz e não faz, versões, bases, tabela de regras (com teste de divergência), modelos de dose, metadados da biblioteca, limites técnicos medidos, perguntas da geração e dados de saúde: [`docs/MOTOR-PRESCRICAO.md`](../../../../docs/MOTOR-PRESCRICAO.md).

| Arquivo | Papel |
|---|---|
| `types.ts` | Tipos: fatos com base, doses por métrica, entrada, resultado, escopos |
| `rules/` | Regras em JSON (`gymgital-base@2026.11.1` e `@2026.11.2`, a usada nas gerações novas), registro congelado, referências (não verificadas) |
| `generate.ts` | Geração completa, revalidação, unidades de trabalho |
| `regenerate.ts` | Regenerar escopos, substituir, alternativas, rebase |
| `select.ts`, `eligibility.ts` | Seleção gulosa por cobertura e elegibilidade (equipamento, modalidade, exclusões, confiança nos metadados) |
| `dose.ts`, `progress-week.ts` | Doses em camadas, progressão semanal, texto pt-BR |
| `duration.ts`, `volume.ts`, `flags.ts` | Duração × disponibilidade, volume por músculo, alertas |
| `progression.ts` | Sugestão de progressão pelo histórico (nunca valor) |
| `bounds.ts` | Limites técnicos de gravação |
| `hash.ts`, `calendar.ts`, `vocabulary.ts`, `trace.ts`, `validate.ts` | Apoio |

API: `generate`, `regenerate`, `substitute`, `rebase`, `alternativesFor`, `revalidate`, `validateDose`, `toDisplayFields`, `describeStructuredDose`, `proposeProgression`, `canonicalInput`, `canonicalRequest`, `sha256Hex`, `scheduleOccurrences`, `workUnits`.
