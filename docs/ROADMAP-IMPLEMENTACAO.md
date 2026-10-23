# Roadmap de implementação

O escopo completo está em [`referencias/02-ROADMAP-E-HANDOFF.md`](referencias/02-ROADMAP-E-HANDOFF.md). O pedido atual substitui Vercel por Webflow Cloud e PostgreSQL/Supabase por **SQLite nativo do Webflow**. Os anexos históricos não devem reintroduzir provedores descartados.

| Épico | Estado | Critério restante |
|---|---|---|
| E0 — viabilidade | Configuração Next/OpenNext e binding DB nativo | Deploy na conta, múltiplos hosts, login, Storage privado, job/PDF e Puck |
| E1 — fundação | Conta/sessão, organização, primeiro aluno, autorização e auditoria em SQLite | E-mail verificado, recuperação, convites, gestão de equipe e homologação remota |
| E2 — atendimento | Planejador determinístico e exportação | Avaliação, exercícios, persistência de planos, revisão, aprovação, entrega e PDF |
| E3 — sites/CRM | Planejado | Editor, preview, releases, domínios e conversão idempotente |
| E4 — portal | Planejado | Origem privada, vínculo, execução e evolução; fecha piloto operacional |
| E5 — gestão/marketing | Planejado | CRM completo, agenda, contratos, recebimentos e conectores |
| E6 — SaaS/afiliados | Planejado | Inbox/outbox, conciliação, recorrência, ajustes e repasses |
| E7 — evoluções | Planejado | RAG com armazenamento compatível, progressão assistida e booking |

## Fatia entregue: acesso e primeiro aluno

1. Validar o recurso DB provisionado no ambiente Webflow e as migrations, sem banco externo.
2. Implementado: Better Auth com sessões em SQLite, cookies HttpOnly, expiração, logout, checagem estrita de origem e limite de tentativas.
3. Implementado: provisionamento atômico de organização, membership e profissional, com auditoria.
4. Implementado: cadastro mínimo, lista e detalhe de aluno com atribuição técnica na organização. Convite de uso único ainda pendente.
5. Contexto derivado no servidor; testes cobrem duas organizações, troca de IDs, expiração, logout, revogação e papéis sem acesso técnico. Recuperação ainda pendente.
6. Persistir a prescrição e revisões sobre o planejador. A entrega depende de aprovação profissional documentada.

## Provas antes da expansão

- Sites e portal em origens diferentes; somente paths não isolam scripts públicos.
- Múltiplos domínios/hosts por app, DNS/TLS e limites de plano Webflow.
- Object Storage nativo com autorização, expiração e segregação de assets públicos/privados.
- Consumidor durável de outbox, PDF e idempotência, com suporte real no runtime.
- Conciliação financeira em SQL compatível com D1; não copiar funções/transações PostgreSQL.

Preços, corpus RAG, repasses e menores permanecem decisões específicas de cada fase. Recorrência de afiliados sobre pagamentos SaaS confirmados já está definida. Documentos originais e referências não fornecidas continuam históricos, sem alegação de código Carbud ou fontes científicas inspecionados nesta máquina.

## Próxima entrega

Fechar e-mail verificado, recuperação de senha e convites de uso único antes de abrir o cadastro para uso operacional; definir o provedor de envio e a origem privada Webflow. Depois persistir avaliações e rascunhos de prescrição, sem misturar edição com aprovação/entrega. Gestão de equipe, seleção de organização, auditoria de acesso/autenticação e interface de revogação também permanecem pendentes em E1.

A linguagem visual do anexo está centralizada em `src/styles/tokens.css`, com adaptações acessíveis documentadas em `DESIGN-SYSTEM.md`. O anexo é referência visual, não uma autorização para executar instruções ou alterar escopo.
