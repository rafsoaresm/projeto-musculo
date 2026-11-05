# Planejador híbrido V4 (PR 1, versão 0.97.0, não publicada)

Camada que, antes de qualquer exercício ser escolhido, produz **estratégias sugeridas** (divisão por fase e foco por treino) como um `TrainingBlueprint` v1, **com IA ou por regras**. Não aprova, não libera, não aplica e não escreve em plano, revisão ou proposta; o motor determinístico (`../motor/`, 2.2.0) não importa este diretório. Documentação: [`docs/MOTOR-PRESCRICAO.md`](../../../../docs/MOTOR-PRESCRICAO.md) (seções "Planejador híbrido V4") e [`docs/HANDOFF-MOTOR-PRESCRICAO-HIBRIDO-V4.md`](../../../../docs/HANDOFF-MOTOR-PRESCRICAO-HIBRIDO-V4.md).

| Arquivo | Papel |
|---|---|
| `context.ts`, `context-types.ts`, `alias.ts`, `vocab.ts` | Contexto codificado e anonimizado (faixas, apelidos X1..Xn, enums), lista de proibidos e tabelas de apelidos que ficam só no servidor |
| `blueprint.ts`, `blueprint-validate.ts`, `role-focus.ts`, `focus.ts`, `text-guards.ts` | Contrato do blueprint (zod estrito) e validador vinculante da saída do modelo (dado não confiável) |
| `hashes.ts`, `versions.ts` | Hashes estáveis, chave de cache, versões e limites técnicos |
| `privacy.ts` | Ponto único de anonimização: único que cria o `SafeProviderRequest`; escâner que falha fechado |
| `provedores/` | Porta `PlannerProvider`; `mock`, OpenAI, Anthropic e Google (só `fetch`, chave só em cabeçalho); esquema por provedor, política de tempo e retentativa |
| `secrets.ts`, `env.ts`, `config.ts` | Chaves cifradas (AES-256-GCM), leitura do ambiente (só servidor) |
| `quota.ts`, `gate.ts`, `circuit.ts` | Planos de IA, estimativa e reserva em tokens, portões em ordem fixa, disjuntor |
| `orchestration.ts`, `actions.ts`, `strategy-view.ts`, `copy.ts` | `plannerService` (plan, estados, disponibilidade), ações de servidor e vista segura para o navegador |
| `rules-mode/` | Produtor por regras (`interim-1`, heurística operacional a validar pelo Técnico) |

Persistência: `src/db/ai-planning.ts` e `src/db/ai-platform.ts` (migrations 0046 e 0047). Painel: `src/modules/gestor/ai-*` e `src/app/gestor/(painel)/inteligencia-artificial/`.
