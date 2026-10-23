# Trainer Prescription — rastreabilidade e decisões

## 1. Fontes e nível de evidência

| Código | Fonte | O que comprova |
|---|---|---|
| U1 | Pedido atual do usuário nesta conversa | Escopo de trainers, paridade de marketing/gestão sem automóveis, sites, afiliados e área do aluno |
| U2 | Confirmação anterior nesta conversa | Código de afiliado na contratação/assinatura; percentual recorrente sobre pagamentos confirmados |
| T1 | [Documento mestre anexado](referencias/TRAINER_PRESCRIPTION_DOCUMENTO_MESTRE.md) | Requisitos e descrição do protótipo; não comprova código executável disponível neste ambiente |
| T2 | [Handoff do editor anexado](referencias/TRAINER_PRESCRIPTION_HANDOFF_EDITOR_DRAG_DROP.md) | Direção de produto do editor, Puck recomendado e fluxo draft/publicação |
| C1 | Carbud, commit `1eb591f454919329be8dc8782c8d7d200f8c02d3` | Implementação inspecionada localmente; sem validação externa de produção nesta tarefa |
| C2 | [Guia de sites Carbud](referencias/CARBUD-SITES-VERCEL.md) | Análise anterior do código e recomendações, não configuração atual da conta Vercel |
| C3 | [Plano de afiliados Carbud](referencias/CARBUD-AFILIADOS.md) | Especificação anterior; não módulo já implementado |
| P | Arquitetura consolidada deste pacote | Proposta técnica/operacional para o projeto novo, sujeita às decisões identificadas |

Não houve acesso ao outro chat, aos protótipos `prescricao_profissional_v1_1_ajustada.html` e `trainer_prescription_drag_drop_editor.html`, aos livros completos, ao repositório do Trainer Prescription ou às contas Vercel/Supabase/gateway. Não presumir que arquivos citados nos anexos existem neste pacote.

## 2. Requisitos por origem e destino

| Requisito | Origem | Destino no plano | Evidência de aceite |
|---|---|---|---|
| Organização, equipe e unidades | U1/C1 | Fundação e gestão | Isolamento e permissões entre membros |
| Aluno com contexto individual | T1 §§6–9 | Atendimento | Cadastro, avaliação e reavaliação persistidos |
| Periodização por fases | T1 §§10–14 | Motor e revisão | Macro/meso/micro, rotação e fases independentes |
| Campos e edição de prescrição | T1 §§15–20, 37–40 | Prescrição | Alvos, vídeo, esforço e preservação humana |
| PDF histórico | T1 §§26–28 | Documentos privados | PDF corresponde à revisão entregue |
| RAG e evidências | T1 §§21–23, 43–47 | Conhecimento/IA | Citações reais recuperadas e escopo correto |
| Área do aluno | U1, expansão de T1 §53 | Portal e acompanhamento | Login, treino, execução e evolução ponta a ponta |
| Biblioteca de exercícios | T1 §§18–19, 50–51 | Conhecimento | Global/privada, curadoria e snapshot |
| Site visual estruturado | T2 | Editor/site-kit | Blocos, colunas, autosave, preview e publicação |
| Vercel compartilhada | C1/C2/T2 | Sites e domínios | Dois tenants sem build/projeto por cliente |
| Landing pages, SEO e marca | U1/C1/T2 | Marketing/site | Conteúdo publicado, canonical e captação |
| CRM e distribuição | U1/C1 | Comercial | Lead → atendimento → aluno sem perda de origem |
| WhatsApp, e-mail e templates | U1/C1 | Comunicação | Escopo, preferências, envio/recebimento e falha visível |
| Pixels e mensuração servidor | U1/C1 | Marketing público | Eventos corretos, sem saúde e sem dupla conversão |
| API e webhooks | U1/C1 | Integrações | Escopos, assinatura, retry e auditoria |
| Planos SaaS, limites e cobrança | U1/C1 | Financeiro SaaS | Cobrança distinta do contrato do aluno |
| Afiliado e comissão recorrente | U1/U2/C3 | Receita SaaS | Um crédito por pagamento confirmado |
| Portal do afiliado | Discussão anterior/C3 | Comercial da plataforma | Somente seus resultados |
| Agenda e financeiro do aluno | P | Operação de serviços | Compromisso/contrato/recebimento separados do treino |
| Origem privada para portal | P, decorrente de U1 + marketing C1 | Domínio/autenticação | Scripts do site não leem APIs privadas |

## 3. Mapa de código Carbud para consulta futura

Os caminhos desta seção pertencem ao repositório Carbud, não a uma implementação já existente do Trainer Prescription. O objetivo é localizar padrões úteis, não transportar arquivos sem revisar dependências e escopo.

| Assunto | Referências do checkout Carbud | Orientação |
|---|---|---|
| Navegação por contexto | `src/app/admin/layout.tsx`, `src/app/super-admin/layout.tsx`, `src/components/layout/shell.tsx` | Reutilizar agrupamento por tarefa; remover navegação automotiva |
| Roles e guards | `src/lib/auth/rbac.ts`, `guards.ts`, `session.ts`, `src/middleware.ts` | Novo produto precisa de memberships e responsabilidades, além do perfil global |
| Modelo tenant/equipe | `src/db/schema/tenants.ts`, `users.ts`, `stores.ts` | Reprojetar organização/profissional/aluno sem igualdade entre tenant e pessoa |
| Planos e recursos | `src/db/schema/plans.ts`, `src/lib/plans/catalog.ts`, `entitlements.ts` | Preservar estados de prontidão e limites de servidor |
| Contratação SaaS | `src/lib/gateway/subscribe.ts`, `src/app/api/super-admin/tenants/[id]/subscription/route.ts` | Adaptar entrada do afiliado e identidade financeira |
| Gateway/webhook | `src/lib/gateway/asaas.ts`, `event-map.ts`, `src/app/api/webhooks/asaas/route.ts` | Reconciliar por pagamento; não copiar falha de marcação prematura |
| CRM | `src/db/schema/leads.ts`, `crm.ts`, `src/lib/services/crm.ts`, `src/app/admin/funil/` | Remover vehicleId/label; preservar etapas, eventos, responsabilidade e origem |
| Distribuição e unidades | `lead_routing` em `src/db/schema/crm.ts`, `src/db/schema/stores.ts` | Responsabilidade comercial não concede acesso técnico |
| Mensagens e notificações | `src/lib/services/notifications.ts`, `src/lib/integrations/whatsapp-client.ts`, `whatsapp-rules.ts`, `src/app/admin/mensagens/` | Separar atendimento privado e campanha; considerar limites do fornecedor |
| APIs próprias | `src/lib/services/api-access.ts`, `src/app/admin/integracoes/` | Escopos e dados sensíveis explícitos; preservar revogação/auditoria |
| Tracking | `src/lib/tracking/`, `packages/site-kit/src/templates/shared/tracking.tsx` | Adaptar evento comercial; excluir saúde e sinais de treino |
| Conteúdo público | `src/lib/services/public-api.ts`, `site.ts`, `src/app/api/public/` | DTO publicado separado; não reutilizar para dados autenticados |
| Resolver/render | `sites/src/lib/site.ts`, `panel.ts`, `sites/src/middleware.ts` | Host exato + status de publicação; isolamento do portal |
| Domínios Vercel | `src/lib/integrations/vercel.ts`, `domains.ts`, `src/lib/services/domains.ts` | Melhorar TLS, idempotência e reconciliação |
| Templates compartilhados | `packages/site-kit/`, `sites/next.config.ts` | Reprojetar como blocos/renderer versionados, sem lógica de veículo |
| Auditoria e convites | `src/lib/audit.ts`, `src/lib/services/invites.ts`, `src/app/api/auth/` | Aproveitar conceitos, mantendo escopos e identidade do novo sistema |

### O que não reaproveitar por simples renomeação

`vehicles`, `vehicle_photos`, `vehicle_publications`, `appraisals` automotivos, `financings` automotivos, feeds/classificados e FIPE. Avaliação física, plano de treino, execução e progresso têm regras próprias. Também não transportar texto jurídico, segredos, IDs de recursos de produção ou dados de clientes Carbud.

## 4. Decisões de arquitetura registradas

| ID | Decisão proposta | Razão | Validação necessária |
|---|---|---|---|
| ADR-01 | PostgreSQL/Supabase + serviços de domínio TypeScript | Alinhamento com anexos, relações/versionamento, RLS e pgvector | Compatibilidade com checkout real e operação disponível |
| ADR-02 | Tenant é organização, não profissional nem aluno | Suporta solo/equipe e evita compartilhar atendimento por identidade global | UX solo e regras comerciais da equipe |
| ADR-03 | Apps compartilhados distintos para site e portal | Preserva marketing e separa origem com dados privados | Prova de cookies/login/callback/domínios |
| ADR-04 | Portal dentro da marca e domínio do profissional via subdomínio | Acesso integrado sem mesma origem de scripts de marketing | Preferência de URL do produto |
| ADR-05 | Puck + documentos JSON versionados | Modelo de blocos e render público compatíveis com handoff | API/licença/versão e migração de componentes |
| ADR-06 | Snapshot imutável para conteúdo publicado e plano entregue | Preserva histórico e permite rollback/reprodução | Regras de aprovação e concorrência |
| ADR-07 | Execução separada de prescrição | Permite comparar previsto/realizado sem alterar meta histórica | UX de séries, unidades e correções |
| ADR-08 | Outbox + jobs duráveis | Efeitos externos não pertencem à transação HTTP/local | Infraestrutura de filas/worker e retries |
| ADR-09 | Afiliado atribui organização SaaS | Preserva o significado combinado no Carbud | Base detalhada e termos de repasse |
| ADR-10 | Registro manual inicial para receita dos profissionais | Fecha gestão sem misturar recebedores | Conta/gateway e operação financeira para automatizar |
| ADR-11 | RAG após núcleo determinístico | Evidência não substitui regras ou revisão | Corpus disponível, direitos e recuperação real |
| ADR-12 | Continuidade de leitura/exportação separada da cobrança | Não copiar bloqueio automotivo para histórico de atendimento | Política comercial, de retenção e privacidade |

## 5. Contradições resolvidas e limites mantidos

- **Portal:** a exclusão antiga de login do aluno foi superada pelo pedido atual. A capacidade de executar e acompanhar treino faz parte da primeira jornada completa.
- **Monetização:** o documento inicial postergava cobrança; o produto consolidado deve contemplar gestão SaaS/afiliados e separação financeira. Implementar em ordem não significa omitir.
- **Calendário:** preset de meses/fases e semanas variáveis permanece decisão pendente explícita; não inventar consistência matemática.
- **Conteúdo:** no Carbud, editar dados do site reflete conforme cache. No novo editor, publicar é ação explícita e draft não pode vazar.
- **Acesso:** copiar guard “sem tenant = super-admin” não atende aluno/afiliado e é inadequado ao modelo proposto.
- **Segurança:** o status de domínio ativo e a flag de risco não são certificações de TLS ou aptidão clínica; cada coisa requer sua verificação própria.
- **Marketing:** mensuração não significa gerenciador de anúncios; manter conectores reais, sem alegar capacidades não identificadas.
- **Evidências:** referências bibliográficas do anexo são inventário a validar, não corpus já indexado ou páginas conferidas.
- **Afiliados:** percentual recorrente e confirmação foram decididos; perguntar novamente essas escolhas não é uma dependência. Base/encargos/repasse ainda precisam de definição operacional.

## 6. Status deste pacote

Concluído: leitura dos dois anexos, inspeção dos módulos relevantes do Carbud, consolidação de escopo, arquitetura proposta, desenho da área do aluno, adaptação de afiliados e roadmap com critérios de aceite.

Não realizado: implementação, criação de banco/contas/domínios, escolha de preços, testes funcionais, acesso a outro chat, verificação de provedores ou validação das referências científicas. Os documentos são insumos para decisões e desenvolvimento futuro, não evidência de sistema pronto.
