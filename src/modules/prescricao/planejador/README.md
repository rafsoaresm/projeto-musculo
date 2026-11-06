# Planejador híbrido V4 (PR 1 a 5, versão 0.101.0, não publicada)

**PR 5:** `src/db/ai-reports.ts` e `src/modules/gestor/ai-report-view.ts` (relatórios de uso, 5.1) e a matriz de regressão fora deste diretório (`tests/helpers/benchmark-matrix.ts`, `scripts/benchmark-motor-v4.mjs`, 5.2); nenhum arquivo daqui mudou na 5.2.

**PR 4:** acrescentou `adjust.ts`, `adjust-context.ts`, `adjust-diff.ts`, `adjust-service.ts` e `adjust-actions.ts` (ajustes assistidos de um ponto: a IA só escolhe entre alternativas que o motor ofereceu; o motor valida e recalcula; aplicar é decisão do profissional; migration 0049) e a resposta `ADJUSTMENTS` do provedor simulado. As telas ficam em `../automatica/` (fluxo, revisão e `adjust-panel.tsx`).


Camada que, antes de qualquer exercício ser escolhido, produz **estratégias sugeridas** (divisão por fase e foco por treino) como um `TrainingBlueprint` v1, **com IA ou por regras**. Não aprova, não libera, não aplica e não escreve em plano, revisão ou proposta; o motor determinístico (`../motor/`, 2.3.0) não importa este diretório. `compile.ts` transforma o aceite do profissional no bloco `answers.blueprint` que o motor lê (regras 2026.11.5+); nunca edita a periodização. Documentação: [`docs/MOTOR-PRESCRICAO.md`](../../../../docs/MOTOR-PRESCRICAO.md) (seções "Planejador híbrido V4") e [`docs/HANDOFF-MOTOR-PRESCRICAO-HIBRIDO-V4.md`](../../../../docs/HANDOFF-MOTOR-PRESCRICAO-HIBRIDO-V4.md).

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
| `accept.ts`, `blueprint-actions.ts`, `compile.ts` | Aceitar a estratégia (linha só de acréscimo), gerar a partir do aceite e voltar à estratégia (`blueprintService`), ações de servidor, e o compilador puro do aceite |
| `rules-mode/` | Produtor por regras: `ruleset-templates.ts` lê os modelos e a tabela de papéis das regras `2026.11.5` (heurística operacional a validar pelo Técnico); `templates.ts` guarda as constantes `interim-1`, que um teste mantém iguais às regras |

Persistência: `src/db/ai-planning.ts` e `src/db/ai-platform.ts` (migrations 0046 e 0047). Painel: `src/modules/gestor/ai-*` e `src/app/gestor/(painel)/inteligencia-artificial/`.
