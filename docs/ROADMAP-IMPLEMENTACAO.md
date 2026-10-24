# Roadmap de implementação

O escopo completo está em [`referencias/02-ROADMAP-E-HANDOFF.md`](referencias/02-ROADMAP-E-HANDOFF.md). O pedido atual substitui Vercel por Webflow Cloud e PostgreSQL/Supabase por **SQLite nativo do Webflow**. Os anexos históricos não devem reintroduzir provedores descartados.

| Épico | Estado | Critério restante |
|---|---|---|
| E0 — viabilidade | Configuração Next/OpenNext e binding DB nativo | Deploy na conta, múltiplos hosts, login, Storage privado, job/PDF e Puck |
| E1 — fundação | Conta/sessão, organização, aluno, autorização e auditoria em SQLite. **Três áreas por papel** (gestor, profissional, aluno), ativação única do gestor, bloqueio de acesso e convite de aluno de uso único | E-mail verificado, recuperação, convites e gestão de equipe, conceder o papel de gestor pela interface e homologação remota |
| E2 — atendimento | Planejador determinístico e exportação. **Planos de periodização salvos por aluno**, com revisões e estado Rascunho / Estrutura pronta (0.4). **Biblioteca de exercícios** com o seed de 64 do documento mestre e biblioteca por organização (0.5a). **Prescrição manual** por mesociclo sobre o rascunho (0.6), com painel de pendências e cópia de mesociclo (0.7). **Aprovação e entrega** com imutabilidade no banco (0.8). **Ficha do aluno** (0.9). **Avaliações com triagem e indicadores** (0.10), ligadas à aprovação e à entrega. **PDF do plano entregue** (0.11). **Postura e movimento** nas avaliações (0.12), sem fotos | Fotos de postura (dependem de armazenamento privado), geração com pendências; conferir o instrumento de triagem com o responsável técnico |
| E3 — sites/CRM | Planejado | Editor, preview, releases, domínios e conversão idempotente |
| E4 — portal | Parcial: convite de uso único, área do aluno e **treino entregue** (0.8) | Origem privada separada, execução e evolução; fecha piloto operacional |
| E5 — gestão/marketing | Planejado | CRM completo, agenda, contratos, recebimentos e conectores |
| E6 — SaaS/afiliados | Planejado | Inbox/outbox, conciliação, recorrência, ajustes e repasses |
| E7 — evoluções | Planejado | RAG com armazenamento compatível, progressão assistida e booking |

## Fatia entregue: postura e movimento (0.12)

1. Implementado: migration 0010 (`assessment_findings`), com os 18 itens posturais das três vistas (seção 8) e os 9 testes de movimento com a escala de cinco níveis (seção 9), dentro da avaliação, congelados com ela.
2. Mantido do documento: só os seis itens da triagem geram revisão obrigatória. Postura e movimento descrevem, não bloqueiam; "interrompido por dor/desconforto" aparece em destaque, sem criar alerta.
3. **Em aberto:** fotos e anotação sobre imagem (precisam de armazenamento privado), comparação entre avaliações, os efeitos da seção 9 em progressões e seleção de exercício (regra futura do documento), e a decisão de contar "interrompido por dor" como sinal de triagem.

## Fatia anterior: PDF do plano entregue (0.11)

1. Implementado: PDF gerado no servidor (pdf-lib, dentro do Worker) só para revisão **entregue**, com versão (revisão e SHA-256 do conteúdo), data de geração, profissional, links de vídeo clicáveis e paginação. Sem migration.
2. Implementado: download pelo profissional (qualquer revisão entregue, também as superadas) e pelo aluno (a entregue mais recente de cada plano dele); cada download fica na auditoria, sem conteúdo.
3. **Em aberto:** objetivo e gênero no PDF (o documento mestre cita; ficaram de fora por privacidade), CREF (não existe campo), logotipo do profissional, fontes embutidas, PDF de rascunho para revisão interna.

## Fatia anterior: avaliações, triagem e indicadores (0.10)

1. Implementado: migration 0009 (`assessments`, `assessment_metrics`, `assessment_reviews`), com o `risk_status` amarrado às marcas por `CHECK`, avaliação registrada imutável por gatilhos e revisão do alerta só de acréscimo.
2. Implementado: os seis itens de triagem da seção 7.1 do documento mestre e os indicadores da 7.2, sem acrescentar item nem interpretar valor. Qualquer marca dá "Revisão obrigatória antes da entrega.".
3. Implementado: a aprovação e a entrega leem a avaliação mais recente do aluno. Alerta sem revisão bloqueia as duas; o aviso de ciência (`NOT_RECORDED`) só vale quando não há avaliação. A checagem final fica dentro do `UPDATE`.
4. **Em aberto:** o responsável técnico confere o instrumento (os itens vieram do documento mestre, não de validação clínica); base legal e consentimento; postura, mobilidade e movimento (seção 8); `REFER_OUT` reservado, não implementado.

## Fatia anterior: ficha do aluno (0.9)

1. Implementado: migration 0008 (`student_profiles`) com os campos das seções 6.1 a 6.4 do documento mestre; tela `/profissional/alunos/<id>/ficha` e resumo no aluno. Só o profissional com vínculo técnico lê e grava; salvar registra quem e quando.
2. Liberado pelo responsável do produto para ambiente de teste. **Em aberto para uso real:** base legal e texto de consentimento, atendimento a menores, exportação e exclusão de dados do titular.

## Fatia anterior: aprovação, entrega e treino do aluno (0.8)

1. Implementado: migration 0007 (colunas de aprovação e entrega e 7 gatilhos que tornam imutável, no banco, a revisão que saiu de rascunho).
2. Implementado: aprovar (sem treino abaixo do alvo e com o aviso de **triagem não registrada** confirmado) e entregar; `/aluno/treino` mostra ao aluno só a revisão entregue.
3. Decisão do responsável do produto: aprovar com o aviso visível enquanto o instrumento de triagem não existe. Não é liberação clínica; fica gravado como `NOT_RECORDED`.
4. Não incluído: execução do treino pelo aluno, PDF, notificações, avaliações e triagem.

## Fatia anterior: painel de Prescrição e cópia de mesociclo (0.7)

1. Implementado: `/profissional/prescricao` com a revisão mais recente de cada plano e as pendências por alvo; "Planos em rascunho" na visão geral.
2. Implementado: copiar um mesociclo inteiro para uma fase sem exercícios, informando os treinos que não existem no destino.
3. Sem migration nova.

## Fatia anterior: prescrição manual sobre o rascunho (0.6)

1. Implementado: migration 0006 (`prescribed_exercises`) com instantâneo de nome e vídeo, texto livre para a dose e origem registrada. Nenhum valor padrão, preset ou carga.
2. Implementado: editor por mesociclo e treino dentro do plano salvo (adicionar da biblioteca ou com nome próprio, editar, reordenar, duplicar, trocar, remover, copiar treino para um treino vazio), com pendências em relação ao alvo e sem preencher lacunas. Revisão pronta congela tudo; a nova revisão copia os exercícios.
3. Não incluído: aprovação e entrega, geração com pendências/diff, presets, copiar mesociclo, arrastar e soltar, e qualquer coisa dependente da triagem.

## Fatia anterior: biblioteca de exercícios (0.5a)

1. Implementado: migration 0005 (`exercises`) com o seed dos 64 exercícios do documento mestre, marcados como **link de busca, não vídeo revisado**.
2. Implementado: `/profissional/biblioteca` (busca, categoria, origem, arquivados), copiar um exercício do sistema, criar, editar, arquivar e restaurar os próprios, com revisão de vídeo deliberada.
3. Não incluído, por falta de fonte: músculos, equipamentos, progressões e vídeos curados. A biblioteca técnica do gestor (curadoria do sistema) segue planejada.

## Fatia anterior: planos de periodização salvos (0.4)

1. Implementado: migration 0004 (`training_plans`, `plan_revisions`, `training_plan_events`), aditiva, com o ciclo de vida completo já previsto no `CHECK` e um índice parcial de um rascunho aberto por plano.
2. Implementado: repositório com autorização técnica em cada consulta, cronograma recalculado no servidor e escrita só em rascunho; `READY` é estrutura validada, **não aprovação**; mudar um `READY` é criar nova revisão.
3. Implementado: tela do aluno com "Planos salvos", novo plano, edição do rascunho, marcar estrutura pronta e criar nova revisão. O aluno não vê nada disso.
4. Não resolvido, e depende de decisão: o instrumento de **triagem** (quais sinais colocam a avaliação em revisão necessária) não existe no repositório e não será inventado; sem ele não há Avaliações nem a trava de aprovação. O provedor de e-mail também segue em aberto.
5. Próximo passo direto desta linha: exercícios por sessão e rascunho de prescrição sobre uma revisão, ainda sem aprovação.

## Fatia anterior: papéis, convite e demonstração (0.3)

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

Fechar e-mail verificado, recuperação de senha e convites de equipe antes de abrir o cadastro para uso operacional; definir o provedor de envio (que também entrega o link de convite do aluno) e a origem privada Webflow. Depois: execução do treino pelo aluno (fases 4 e 5 do documento mestre) e, quando houver armazenamento privado, as fotos de postura. Prescrição, aprovação, entrega e triagem já existem, sem misturar edição com aprovação. Gestão de equipe, seleção de organização, auditoria de acesso/autenticação e interface de revogação também permanecem pendentes em E1.

A linguagem visual do anexo está centralizada em `src/styles/tokens.css`, com adaptações acessíveis documentadas em `DESIGN-SYSTEM.md`. O anexo é referência visual, não uma autorização para executar instruções ou alterar escopo.
