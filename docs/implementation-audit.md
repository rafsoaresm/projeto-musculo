# Inventário da implementação — handoff unificado Figma (04/11/2026)

Exigido pelo handoff `GYMGITAL_HANDOFF_UNIFICADO_FIGMA_2026-11-04` (seção 0). Registra o que **já existe** no código, o que esta fatia (0.96.0) mudou e o que **não** foi feito. Nomes do handoff são conceituais; os reais estão abaixo. Do Figma só o frame AP-01 foi visto (captura inline); ver "Não verificado".

## 1. O que já existia (fonte de verdade: o código)

| Conceito do handoff | Real no repositório |
|---|---|
| Aluno, avaliação, plano, revisão | `students`, `assessments*`, `training_plans`, `plan_revisions` (estado `DRAFT → READY → APPROVED → DELIVERED`, forçado por trigger no D1: `PLAN_REVISION_STATE_INVALID`, `PLAN_REVISION_FROZEN`); repositório `src/db/plans.ts` |
| Rota da revisão | `src/app/profissional/alunos/[id]/planos/[planId]/[revisionId]/page.tsx` (+ `/automatica`, `/pdf`) |
| "Marcar estrutura pronta" | `plans.markReady` (também encerra como `SUPERSEDED` a proposta automática aberta) |
| "Aprovar revisão" | `plans.approve` (triagem lida no servidor; alerta sem revisão bloqueia; reconhecimento obrigatório sem avaliação) |
| "Entregar ao aluno" | `plans.deliver` (bloqueia alerta sem revisão registrado depois da aprovação) |
| "Criar nova revisão" | `plans.newRevisionFrom` (cópia com `copied_from_id`; no máximo um rascunho aberto por plano) |
| PDF da revisão | `src/modules/pdf` + rota `/pdf` (só revisão entregue; registra o download sem conteúdo) |
| Auditoria | `training_plan_events` (`MARKED_READY`, `APPROVED`, `DELIVERED`…), escrita no mesmo lote da mudança |
| Acesso do aluno | `student-access` (`ACTIVE`/`INVITED`/`NONE`), independente da entrega |
| Geração automática (GEN) | `src/modules/prescricao/automatica/generation-form.tsx` + motor em `motor/` |
| Revisão da proposta (RX) | `automatica/proposal-view.tsx`, `audit-panel.tsx`, `substitute-dialog.tsx`, `apply-panel.tsx` |
| Avaliação física (AV) | `src/modules/avaliacoes/v2` + `formulas/` (Faulkner 4, Guedes 3, JP3, JP7 com versão), testes `tests/assessment-*.test.ts` |
| Notificação ao aluno na entrega | **não existe** (o único e-mail do produto é a recuperação de senha, `modules/email`) |
| Fila/outbox | **não existe** |

## 2. O que a 0.96.0 mudou

### AP — aprovação e entrega (AP-01..10): feito

- **Operação única** `plans.approveAndDeliver` (`src/db/plans.ts`): `READY → APPROVED → DELIVERED` em **um** `db.batch` (uma transação do D1), com as mesmas guardas de `approve` e `deliver` (triagem, `revisionGate`, trigger). Repetida (clique duplo, retry, outra aba) responde `already_delivered` sem tocar na linha. A partir de `APPROVED` (exceção) só entrega, sem segunda aprovação.
- **Ações** (`src/modules/planos/actions.ts`): `approveAndDeliverRevision` (fecha o rascunho como passo interno + aprova + entrega), `approveRevisionOnly` (exceção "Aprovar sem entregar"), `deliverRevision` e `approveRevision` mantidas.
- **Interface** (`approval-panel.tsx`, novo `src/components/sheet.tsx`, CSS ao fim de `globals.css`): uma faixa compacta com estado, linha de contexto e o botão principal; **uma** confirmação (modal no computador, bottom sheet até 640 px, `<dialog>` nativo: foco preso, `Esc` fecha, foco volta ao botão); **Mais ações** com "Aprovar sem entregar" (explicado) e "Criar nova revisão"/"Ver premissas"; revisão entregue com "Criar nova revisão" (primário) e "Baixar PDF" (secundário), somente leitura. O rascunho usa a mesma faixa (substitui o painel "Concluir o rascunho"); ela espera enquanto há mudança de estrutura não salva.
- O aviso de "treinos abaixo do alvo" continua **aviso**, nunca bloqueio.
- A confirmação diz o que **não** acontece: não cria nem ativa o acesso do aluno e **não envia aviso** (não há infraestrutura). Por isso **não há** caixa "notificar o aluno" (o handoff a pede só "conforme infraestrutura existente").

### GEN — geração (GEN-01..08): parcial

- Formulário em **três etapas** (Diretrizes · Políticas de dose · Progressão) com todas as etapas montadas (escolhas não se perdem ao voltar), contagem de pendências na etapa 1, rodapé fixo no celular, política de dose **fechada por padrão** (os padrões da versão do motor valem sem abrir nada). Nenhuma capacidade foi removida.
- **Não feito:** painel lateral/tela própria de edição de uma política por vez (GEN-02/07), seleção de equipamentos em tela própria no celular (GEN-05), lista de pendências com link direto ao campo (GEN-03/08).

### RX — revisão da proposta (RX-01..11): parcial

- Rodapé fixo "Aplicar ao rascunho" com as contagens reais e **prévia + confirmação em modal/bottom sheet** (RX-03/RX-11); a aplicação continua idempotente (`idempotencyKey`) e preserva treinos manuais por padrão.
- **Não feito:** o workbench horizontal (abas Sessões | Alertas | Premissas | Regras com contagens, navegação fase→semana→sessão sem recarregar, painel contextual, telas móveis RX-04..10). A proposta continua em páginas verticais (`proposal-view.tsx`, 724 linhas, fortemente acoplada a âncoras e links que o e2e cobre). Precisa de fatia própria.

### AV — avaliação física (AV-01..06): não tocada

O módulo AV V2 já existe e cobre o Apêndice A (4 protocolos, versões de fórmula, PAR-Q, Flexiteste de 15, Cooper). Os frames AV-01..06 **não** foram comparados com a tela atual nem refeitos nesta fatia.

## 3. Migração e reversão

Sem migration. `approveAndDeliver` só usa colunas e triggers existentes. Reverter = voltar o commit; as revisões já gravadas não mudam (o fluxo antigo de duas chamadas continua válido na camada de dados e ainda é usado pela exceção).

## 4. Não verificado

- Do Figma só o AP-01 foi visto (estrutura conferida: estado, aviso de alvo, "Mais ações" e botão principal na mesma faixa, depois a prescrição). AP-02..10, GEN, RX e AV **não** foram vistos; o restante foi derivado do texto do handoff. Nenhuma comparação de captura da implementação com os frames.
- Nada foi testado no Webflow Cloud nem em D1 remoto.
- Envio real de notificação ao aluno: não existe; nada foi enviado.
