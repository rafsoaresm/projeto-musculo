# Estrutura por papéis — revisão conforme o handoff V2

Versão 0.3 · 23/10/2026. Esta revisão aplica o `TRAINER_PRESCRIPTION_HANDOFF_COMPLETO_V2` à base existente **sem trocar as decisões do projeto** (Webflow Cloud, SQLite nativo, Better Auth, `src/modules`). Onde o handoff e o `AGENTS.md` divergem, vale o `AGENTS.md`; a tabela da seção 6 registra cada caso.

## 1. O que mudou

- A ferramenta passou a ter **três áreas separadas**, cada uma com seu menu, seu acesso e sua autorização no servidor: gestor da ferramenta, profissional de educação física e cliente (aluno).
- O menu do profissional segue a seção 3 do handoff V2. Módulos que ainda não existem aparecem no lugar certo, marcados como **Em breve**, com o que farão e o que falta. Nenhum finge funcionar.
- O aluno entra por **convite de uso único** criado pelo profissional. E-mail não vincula ninguém.
- Há uma **demonstração** com dados fictícios para ver as três áreas sem criar conta (`DEMO_MODE`, desligada por padrão).
- Visual: azul sólido único, sem degradê (ver [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md)).

## 2. As três áreas

| | Gestor da ferramenta | Profissional de educação física | Cliente (aluno) |
|---|---|---|---|
| Rota | `/gestor` | `/profissional` | `/aluno` |
| Quem é | Equipe que opera a plataforma e gere quem a contratou | Personal ou consultoria que contratou a ferramenta | Pessoa atendida por um profissional |
| Como entra | Conta comum + ativação única com `PLATFORM_SETUP_TOKEN` em `/gestor/ativar` | Cadastro em `/cadastro` e criação do espaço | Link de convite `/convite/<token>` criado pelo profissional |
| Papel no banco | `platform_admins` | `memberships` ativa + `professionals` | `student_access` ativo |
| Vê | Organizações, profissionais, contagens, auditoria de acessos | Os alunos com quem tem vínculo técnico, periodização, convites | Somente o próprio vínculo e o que for liberado |
| Nunca vê | Nomes, avaliações, treinos e fotos de alunos | Alunos de outros profissionais ou organizações | Qualquer outro aluno, profissional ou organização |
| Ações reais hoje | Listar organizações, bloquear/restabelecer um acesso, auditar | Cadastrar aluno, convidar/revogar acesso, planejar ciclos | Aceitar convite, ver o próprio acompanhamento |

Uma mesma conta pode ter mais de uma área (por exemplo, gestor e profissional). `/acesso` encaminha quem tem uma só e oferece a escolha a quem tem várias; a barra superior troca de área.

## 3. Mapa de rotas

```text
/                         entrada pública: as três áreas, entrar, criar conta
/entrar  /cadastro        conta (a mesma identidade serve a todas as áreas)
/acesso                   encaminha cada conta para a sua área
/organizacao              primeiro espaço do profissional
/convite/[token]          aceite do convite pelo aluno
/projeto                  mapa do produto e do roadmap

/gestor                   visão geral            /gestor/organizacoes[/id]
/gestor/auditoria         /gestor/ativar (primeiro acesso)
/gestor/[módulo]          planejados: planos-saas, afiliados, templates, biblioteca-global, integracoes

/profissional             visão geral            /profissional/alunos[/novo|/id]
/profissional/biblioteca[/novo|/id]
/profissional/periodizacao        /profissional/alunos/[id]/planos/novo
                          /profissional/alunos/[id]/planos/[planId]/[revisionId]
/profissional/[módulo]    planejados: avaliacoes, prescricao, fontes, meu-site, leads, configuracoes

/aluno                    início                 /aluno/[módulo]   planejados: treino, evolucao, check-in, documentos, mensagens, conta

/demonstracao[/gestor|/profissional|/aluno ...]   somente com DEMO_MODE=true
/api/health  /api/auth/*
```

Endereços anteriores (`/alunos`, `/alunos/...`, `/planejamento`) redirecionam para os novos. Links internos usam `next/link`; o mount path é aplicado pelo builder da plataforma e o código do navegador o descobre pela barra de endereço (ver `AUTENTICACAO.md`).

## 4. Autorização

- **Sessão, papel e organização vêm do servidor.** Nenhum identificador de usuário, organização ou papel é aceito de formulário, cabeçalho ou URL.
- Cada página e ação chama `requirePlatformAdmin`, `requireWorkspace` ou `requireStudent` (`src/modules/auth/server.ts`). Os *layouts* só desenham a moldura: no App Router eles não reexecutam a cada navegação, então não são fronteira de segurança.
- Os repositories (`src/db/*`) repetem a autorização em **cada consulta** (organização, vínculo, revogação, bloqueio), porque o D1 não tem RLS.
- **O gestor não tem vínculo técnico.** `platform_admins` não cria `memberships` nem `care_assignments`; por isso `studentsFor` nunca devolve aluno a ele. Os testes cobrem isso (`tests/roles.test.ts`).
- Bloquear uma pessoa usa `users.disabled_at` (já aplicado em toda requisição), registra auditoria e vale para a identidade em toda a plataforma. O gestor não bloqueia a si mesmo nem outro gestor.
- Convite: só o hash SHA-256 é guardado; o token aparece uma vez para o profissional. Aceite é atômico (`DB.batch`) e de uso único; novo convite invalida o pendente; só um login ativo por aluno.

Correspondência com os papéis do handoff V2:

| V2 | Neste projeto |
|---|---|
| `PLATFORM_ADMIN` | `platform_admins` (nova, migration 0003) |
| `ORG_OWNER` / `ORG_ADMIN` | `memberships.role` = `OWNER` / `MANAGER` |
| `PROFESSIONAL` | `memberships` técnica + `professionals` + `care_assignments` |
| `STUDENT` | `student_access` (vínculo criado por convite) |

## 5. Menu do handoff V2 (seção 3) e estado de cada item

| Item | Rota | Estado | Épico |
|---|---|---|---|
| Dashboard | `/profissional` | Disponível: contagens e próximos passos reais | E1 |
| Alunos (lista, detalhe) | `/profissional/alunos` | Disponível: cadastro, vínculo técnico, convite | E1 |
| Avaliações | `/profissional/avaliacoes` | Planejado | E2 |
| Periodização | `/profissional/periodizacao` | Disponível: planejador avulso (sem salvar) e **planos salvos por aluno** em `/profissional/alunos/<id>/planos/...`, com revisões e estado Rascunho / Estrutura pronta. Só a estrutura do ciclo; sem exercícios nem aprovação | E2 |
| Prescrição | `/profissional/prescricao` | Tela de entrada planejada (**prévia** na demonstração). A **prescrição manual já existe** dentro de cada plano salvo do aluno, com exercícios por mesociclo e treino, sem sugestões nem aprovação | E2 |
| Biblioteca de exercícios | `/profissional/biblioteca` | Disponível: 64 exercícios do sistema (somente leitura, vídeos são links de busca) e exercícios próprios da organização | E2 |
| Fontes técnicas | `/profissional/fontes` | Planejado | E7 |
| Meu Site (editor, páginas, domínios, SEO, publicações) | `/profissional/meu-site` | Planejado, um único item por ora | E3 |
| Leads | `/profissional/leads` | Planejado | E3 |
| Configurações | `/profissional/configuracoes` | Planejado | E1 |
| Gestor: organizações, auditoria | `/gestor/...` | Disponível | E1 |
| Gestor: planos e cobrança, afiliados, templates, biblioteca, integrações | `/gestor/...` | Planejado | E3, E5, E6, E7 |
| Aluno: início | `/aluno` | Disponível: vínculo e estado do treino | E4 |
| Aluno: treino, evolução, check-in, documentos, mensagens, conta | `/aluno/...` | Planejado (**prévia** do treino na demonstração) | E4 |

A fonte única desse menu é `src/modules/platform/surfaces.ts`, com teste de contrato (`tests/navigation.test.ts`): todo módulo planejado precisa ter épico, resumo e o que falta.

## 6. Conciliação com o handoff V2

| Tema | O handoff V2 propõe | Este projeto | Motivo |
|---|---|---|---|
| Hospedagem dos sites públicos | App `sites/` compartilhado na Vercel, API de domínios da Vercel | Webflow Cloud. Sites e portal em origens separadas **ainda dependem de prova** | `AGENTS.md`: a escolha atual é Webflow Cloud, não Vercel |
| Banco | PostgreSQL/Supabase, RLS | SQLite nativo (D1), migrations aditivas, repositories com filtro | `AGENTS.md` |
| Autenticação | Supabase Auth | Better Auth sobre SQLite | `AGENTS.md` |
| Busca semântica | `pgvector` | Não pressuposto; desenho futuro compatível com SQLite | `ARQUITETURA-WEBFLOW-CLOUD.md` |
| Estrutura | Monorepo `apps/` + `packages/` | App único, módulos em `src/modules` | `AGENTS.md` |
| Next.js | 15+ | 16.4 (APIs lidas na documentação embarcada) | Versão instalada |
| UI | Tailwind, shadcn, React Hook Form, TanStack Query | CSS próprio com tokens; sem essas dependências por ora | Menos superfície; revisitar quando houver formulários complexos |
| Editor de sites | Puck, `site-kit` | Não implementado; item "Meu Site" planejado | Aguarda prova no Webflow Cloud (E0/E3) |
| Estilo do painel | Escuro (tokens `#0b0f14`…) | Claro, azul sólido, referência App Personal | Referência visual escolhida antes; o escuro é decisão em aberto |
| Modo demonstração | `DEMO_MODE=true` sem autenticação (Anexo A §41) | `/demonstracao` com dados fictícios, **desligada por padrão** | Evita dados fictícios em produção |
| Login do aluno | Anexo A: "não haverá login do aluno na primeira fase". V2 §3: portal futuro e separado | Área do aluno por convite, na mesma origem como etapa intermediária | Pedido atual do usuário; a separação de origem continua obrigatória antes de uso real |
| Um site por profissional (D01) | Proposto, exige aceite | Não decidido; sem tabelas de site | Fora desta fatia |

## 7. Demonstração

Ligue com `DEMO_MODE=true` no ambiente (o `npm run auth:setup:local` já faz isso no ambiente local). Sem a variável, todas as rotas `/demonstracao` respondem 404 e a entrada pública não mostra o atalho.

- Usa as **mesmas telas** da área real para gestor (visão geral, organizações, auditoria), lista de alunos, periodização e início do aluno.
- **Prévias** (marcadas assim no menu): *Prescrição*, com abas por mesociclo, origem de cada campo, bloqueio de aprovação por triagem e revisão entregue imutável; e *Treino atual* do aluno, com registro de séries só na memória da página.
- Dados fictícios em `src/modules/demo/fixtures.ts`: nomes inventados, e-mails `@exemplo.test`, exercícios e parâmetros do documento mestre (semente de 64 exercícios e tabela de presets). Sem carga em quilos, sem referência científica, sem receita.
- Nada é lido ou gravado no banco, nenhuma conta é usada, e o código de demonstração não é importado por páginas reais. A área não conta como entrega de épico.

## 8. Primeiro acesso do gestor

1. No ambiente privado, defina `PLATFORM_SETUP_TOKEN` (32+ caracteres aleatórios, por exemplo `openssl rand -base64 48`).
2. Crie uma conta em `/cadastro?area=gestor` (ou entre em `/entrar?area=gestor`) e informe o código em `/gestor/ativar`.
3. O código só funciona **enquanto não houver gestor ativo**; depois fica inerte. Remova ou troque o valor depois da ativação. E-mail nunca concede o papel.
4. Perdeu o único gestor? Ainda não há recuperação pela interface: a correção é atualizar `platform_admins.revoked_at` diretamente no banco do ambiente, o que reabre a ativação. Conceder o papel a outros gestores pela interface também é pendente.

## 9. Convite do aluno

`/profissional/alunos/<id>` → **Gerar link de convite** → enviar o link por canal seguro → o aluno cria o acesso e aceita em `/convite/<token>`. O link vale 7 dias e uso único. **A ferramenta ainda não envia e-mails**: o profissional copia e envia o link. Revogar acesso e cancelar convite pendente estão na mesma tela.

## 10. Pendências e decisões em aberto

- Origem privada separada para o portal e para o painel, múltiplos hosts e Object Storage privado (provas no Webflow Cloud).
- E-mail verificado, recuperação de senha, convites de equipe, seleção entre organizações, conceder o papel de gestor pela interface.
- Auditoria de login e de leitura. Hoje se grava ativação do gestor, bloqueios, criação/aceite de convite e revogação de acesso; só ativação e bloqueios têm tela (a do gestor).
- Persistência de avaliações, prescrições, revisão, aprovação, entrega e PDF (E2); portal com treino liberado, execução e evolução (E4).
- Decisões do handoff V2 ainda não tomadas: D01 (um site por profissional), D03 (mês civil × semanas), D04 (`REFER_OUT`), D06 (acesso de administradores a dados sensíveis), D08 (modelo comercial dos templates). O estilo escuro do painel também está em aberto.
