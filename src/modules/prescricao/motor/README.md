# Motor de prescrição v2 (`ENGINE_VERSION` 2.0.0)

Núcleo puro e determinístico (sem banco, rede, IA, relógio ou acaso). Documentação completa e tabela de regras: [`docs/MOTOR-PRESCRICAO.md`](../../../../docs/MOTOR-PRESCRICAO.md).

**Estado:** etapa S5. O motor está implementado e testado (`tests/motor-*.test.ts`), e o adaptador dos dados reais (`src/modules/prescricao/automatica/`, só no servidor) monta a entrada a partir da ficha, da avaliação, da biblioteca, da periodização salva, das linhas já prescritas e do histórico (`tests/motor-input.test.ts`, `tests/generation-context.test.ts`). **Ainda não há gravação de proposta, tela nem ligação com a aprovação e a entrega** (etapas S6 a S9).

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
