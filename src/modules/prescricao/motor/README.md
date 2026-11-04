# Motor de prescrição v2 (`ENGINE_VERSION` 2.0.0)

Núcleo puro e determinístico (sem banco, rede, IA, relógio ou acaso). Documentação completa e tabela de regras: [`docs/MOTOR-PRESCRICAO.md`](../../../../docs/MOTOR-PRESCRICAO.md).

**Estado:** etapa S1. O motor está implementado e testado isoladamente (`tests/motor-*.test.ts`), **mas ainda não está ligado ao banco, às telas nem ao fluxo de aprovação e entrega**. O adaptador (`src/modules/prescricao/automatica/`) e as tabelas das propostas vêm nas próximas etapas.

| Arquivo | Papel |
|---|---|
| `types.ts` | Tipos: fatos com base, doses por métrica, entrada, resultado, escopos |
| `rules/` | Regras em JSON (`gymgital-base@2026.11.1`), registro congelado, referências (não verificadas) |
| `generate.ts` | Geração completa, revalidação, unidades de trabalho |
| `regenerate.ts` | Regenerar escopos, substituir, alternativas, rebase |
| `select.ts`, `eligibility.ts` | Seleção gulosa por cobertura e elegibilidade (equipamento, modalidade, exclusões, confiança nos metadados) |
| `dose.ts`, `progress-week.ts` | Doses em camadas, progressão semanal, texto pt-BR |
| `duration.ts`, `volume.ts`, `flags.ts` | Duração × disponibilidade, volume por músculo, alertas |
| `progression.ts` | Sugestão de progressão pelo histórico (nunca valor) |
| `bounds.ts` | Limites técnicos de gravação |
| `hash.ts`, `calendar.ts`, `vocabulary.ts`, `trace.ts`, `validate.ts` | Apoio |

API: `generate`, `regenerate`, `substitute`, `rebase`, `alternativesFor`, `revalidate`, `validateDose`, `toDisplayFields`, `describeStructuredDose`, `proposeProgression`, `canonicalInput`, `canonicalRequest`, `sha256Hex`, `scheduleOccurrences`, `workUnits`.
