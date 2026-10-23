# Roadmap de implementação

O escopo completo está em [`referencias/02-ROADMAP-E-HANDOFF.md`](referencias/02-ROADMAP-E-HANDOFF.md). O pedido atual substitui Vercel por Webflow Cloud e PostgreSQL/Supabase por **SQLite nativo do Webflow**. Os anexos históricos não devem reintroduzir provedores descartados.

| Épico | Estado | Critério restante |
|---|---|---|
| E0 — viabilidade | Configuração Next/OpenNext e binding DB nativo | Deploy na conta, múltiplos hosts, login, Storage privado, job/PDF e Puck |
| E1 — fundação | Conta/sessão, organização, aluno, autorização e auditoria em SQLite. **Três áreas por papel** (gestor, profissional, aluno), ativação única do gestor, bloqueio de acesso e convite de aluno de uso único | E-mail verificado, recuperação, convites e gestão de equipe, conceder o papel de gestor pela interface e homologação remota |
| E2 — atendimento | Planejador determinístico e exportação | Avaliação, exercícios, persistência de planos, revisão, aprovação, entrega e PDF |
| E3 — sites/CRM | Planejado | Editor, preview, releases, domínios e conversão idempotente |
| E4 — portal | Parcial: convite de uso único e início da área do aluno (vínculo e estado do treino) | Origem privada separada, treino liberado, execução e evolução; fecha piloto operacional |
| E5 — gestão/marketing | Planejado | CRM completo, agenda, contratos, recebimentos e conectores |
| E6 — SaaS/afiliados | Planejado | Inbox/outbox, conciliação, recorrência, ajustes e repasses |
| E7 — evoluções | Planejado | RAG com armazenamento compatível, progressão assistida e booking |

## Fatia entregue: papéis, convite e demonstração (0.3)

Revisão de estrutura conforme o handoff V2, detalhada em [ESTRUTURA-E-PAPEIS.md](ESTRUTURA-E-PAPEIS.md).

1. Implementado: migration 0003 (`platform_admins`, `student_invites`, `access_audit_events`), sem tocar 0001/0002.
2. Implementado: `/gestor` (visão geral, organizações, bloqueio/restabelecimento de acesso, auditoria), `/profissional` (menu V2, convite e revogação de acesso do aluno) e `/aluno` (vínculo e estado do treino); módulos inexistentes aparecem como **Em breve**.
3. Implementado: ativação única do gestor com `PLATFORM_SETUP_TOKEN`; o gestor não tem acesso técnico a alunos (testado).
4. Implementado: `/demonstracao` com dados fictícios (`DEMO_MODE`, desligada por padrão). Serve para ver as três áreas e **não conta como entrega** de Avaliações, Prescrição, Treino ou Meu Site.
5. Implementado: visual em azul sólido, sem degradê ([DESIGN-SYSTEM.md](DESIGN-SYSTEM.md)).
6. Não resolvido: e-mails não são enviados (o profissional copia o link), portal na mesma origem do painel, decisões D01/D03/D04/D06/D08 do handoff V2.

## Fatia anterior: acesso e primeiro aluno

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

Fechar e-mail verificado, recuperação de senha e convites de equipe antes de abrir o cadastro para uso operacional; definir o provedor de envio (que também entrega o link de convite do aluno) e a origem privada Webflow. Depois persistir avaliações e rascunhos de prescrição, sem misturar edição com aprovação/entrega. Gestão de equipe, seleção de organização, auditoria de acesso/autenticação e interface de revogação também permanecem pendentes em E1.

A linguagem visual do anexo está centralizada em `src/styles/tokens.css`, com adaptações acessíveis documentadas em `DESIGN-SYSTEM.md`. O anexo é referência visual, não uma autorização para executar instruções ou alterar escopo.
