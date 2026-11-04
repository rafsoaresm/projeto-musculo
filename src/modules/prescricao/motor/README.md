# Gymgital motor de prescrição v1.0.0

Núcleo determinístico TypeScript, sem Node/LLM e sem alterações nas revisões entregues.

API: `generatePrescription(input)`, `replaceExercise(...)`, `proposeProgression(...)`, `fromGymgitalSchedule(...)`, `adaptGymgitalCatalog(...)`, `toGymgitalDraft(...)`.

**Status:** módulo de domínio implementado e testado isoladamente. **Ainda não está conectado à interface, rotas, banco D1 ou fluxo de aprovação/entrega.** Não tratar como funcionalidade publicada.

O módulo aceita qualquer número positivo de fases/semanas, templates livres e objetivos textuais. Retorna `INFEASIBLE` quando catálogo, equipamentos, travas ou tempo não permitem a prescrição, em vez de violar silenciosamente as condições. Dados clínicos e de triagem exigem revisão profissional.

O schema legado em `src/modules/training/contracts.ts` ainda limita fases a 3/6/12, semanas a 3–6, splits A–G e exercícios a 3–8; `src/modules/prescricao/contracts.ts` ainda tem `MAX_PER_WORKOUT=30`. A liberdade do motor não remove esses limites do produto sem migração aditiva e atualização de UI/API.

**Ponto arquitetural crítico:** `src/db/prescription.ts` armazena itens por fase + label, e não por sessão real. Para salvar doses ondulatórias e progressões semanais, criar novas entidades de ocorrências e sets versionados. Não sobrescrever dados manuais nem revisões entregues.

Integração deve ser server-only com `requireWorkspace`, vínculo técnico ativo e filtros tenant por query. Snapshot, idempotência e compare-and-swap devem ser verificados dentro da transação D1. Aplicar proposta e entregar são ações distintas, ambas revisadas pelo profissional.

A pontuação de exercícios, valores padrão e estimativas de duração são heurísticas operacionais editáveis, não protocolos clínicos validados. Cardio, mobilidade e modalidades customizadas são aceitos com política explícita, mas não devem ser tratados como prescrições clínicas validadas.

Testes isolados: pacote entregue separadamente ao usuário; rodar `npm run check` e `npm run build:cloud` no checkout completo antes do merge.
