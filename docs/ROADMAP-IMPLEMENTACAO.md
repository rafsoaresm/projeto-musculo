# Roadmap de implementação

O escopo completo está em [`referencias/02-ROADMAP-E-HANDOFF.md`](referencias/02-ROADMAP-E-HANDOFF.md). O pedido atual substitui Vercel por Webflow Cloud e PostgreSQL/Supabase por **SQLite nativo do Webflow**. Os anexos históricos não devem reintroduzir provedores descartados.

| Épico | Estado | Critério restante |
|---|---|---|
| E0 — viabilidade | Configuração Next/OpenNext e binding DB nativo | Deploy na conta, múltiplos hosts, login, Storage privado, job/PDF e Puck |
| E1 — fundação | Tabelas SQLite, queries autorizadas e testes D1 | Sessão real, convites, provisionamento, revogação ponta a ponta e auditoria |
| E2 — atendimento | Planejador determinístico e exportação | Avaliação, exercícios, persistência de planos, revisão, aprovação, entrega e PDF |
| E3 — sites/CRM | Planejado | Editor, preview, releases, domínios e conversão idempotente |
| E4 — portal | Planejado | Origem privada, vínculo, execução e evolução; fecha piloto operacional |
| E5 — gestão/marketing | Planejado | CRM completo, agenda, contratos, recebimentos e conectores |
| E6 — SaaS/afiliados | Planejado | Inbox/outbox, conciliação, recorrência, ajustes e repasses |
| E7 — evoluções | Planejado | RAG com armazenamento compatível, progressão assistida e booking |

## Próxima fatia: acesso e primeiro aluno

1. Validar o recurso DB provisionado no ambiente Webflow e as migrations, sem banco externo.
2. Implementar autenticação/sessões compatível com Workers e SQLite. Não confundir o acesso do servidor ao binding com identidade de usuário.
3. Criar provisionamento autorizado de organização, membership e profissional, com auditoria.
4. Adicionar convite de uso único, cadastro do aluno e atribuição técnica na mesma organização.
5. Derivar contexto pelo servidor; testar duas organizações, troca de IDs, expiração, revogação, recuperação e papéis sem acesso técnico.
6. Persistir a prescrição e revisões sobre o planejador. A entrega depende de aprovação profissional documentada.

## Provas antes da expansão

- Sites e portal em origens diferentes; somente paths não isolam scripts públicos.
- Múltiplos domínios/hosts por app, DNS/TLS e limites de plano Webflow.
- Object Storage nativo com autorização, expiração e segregação de assets públicos/privados.
- Consumidor durável de outbox, PDF e idempotência, com suporte real no runtime.
- Conciliação financeira em SQL compatível com D1; não copiar funções/transações PostgreSQL.

Preços, corpus RAG, repasses e menores permanecem decisões específicas de cada fase. Recorrência de afiliados sobre pagamentos SaaS confirmados já está definida. Documentos originais e referências não fornecidas continuam históricos, sem alegação de código Carbud ou fontes científicas inspecionados nesta máquina.
