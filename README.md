# projeto-musculo — Trainer Prescription

Fundação de uma plataforma para personal trainers, construída para **Webflow Cloud Apps com banco SQLite nativo do próprio ambiente**. A decisão atual substitui a proposta Supabase dos documentos históricos; não existe dependência de Supabase na aplicação.

## Executar

Node.js 22.13+ (abaixo de 25), npm e o lockfile:

```sh
npm ci
npm run auth:setup:local
npm run db:migrate:local
npm run dev
```

`auth:setup:local` também cria o código de ativação do gestor (`PLATFORM_SETUP_TOKEN`, em `.dev.vars`/`.env.local`) e liga `DEMO_MODE`. Para ver a ferramenta pelos três papéis: abra `/demonstracao`, ou crie um profissional em `/cadastro`, convide um aluno e ative o gestor em `/gestor/ativar`.

O binding `DB` em `wrangler.json` fornece o banco. Não é necessário criar conta externa, token ou URL de banco. No desenvolvimento, os dados ficam em `.wrangler/state`; na publicação, o Webflow cria o recurso por ambiente e aplica as migrations. O identificador `local-trainer-prescription` é apenas local; o Webflow atribui o ID real no deploy.

## O que existe

- **Três áreas por papel**: gestor da ferramenta (`/gestor`), profissional de educação física (`/profissional`) e cliente/aluno (`/aluno`), cada uma com menu e autorização próprios. Menu do handoff V2; módulos ainda inexistentes aparecem como "Em breve". Veja [estrutura e papéis](docs/ESTRUTURA-E-PAPEIS.md).
- **Demonstração** (`/demonstracao`, `DEMO_MODE=true`): as três áreas com dados fictícios, sem criar conta.
- Identidade visual em **azul sólido**, sem degradê: Inter local, componentes arredondados, navegação móvel e contraste AA ([design system](docs/DESIGN-SYSTEM.md)).
- Cadastro profissional, login, logout e sessões persistidas via Better Auth + SQLite nativo.
- Provisionamento de organização e profissional; cadastro/lista/detalhe de alunos com atribuição técnica e auditoria atômicas.
- Convite de aluno de uso único (hash no banco, expiração, revogação) e área do aluno inicial.
- Ativação única do gestor com `PLATFORM_SETUP_TOKEN`; o gestor lista organizações, bloqueia/restabelece acessos e consulta a auditoria, sem ver dados de alunos.
- Interface responsiva com visão geral, mapa de produto e planejador de periodização.
- Planejador de 3/6/12 fases, 3–6 semanas, 1–7 sessões por semana, splits e duração real. Exportação JSON versionada como `DRAFT`.
- **Fotos de postura** (0.14): quatro vistas por avaliação, no Object Storage do Webflow, só visíveis ao profissional com vínculo técnico, sem metadados do aparelho e imutáveis depois do registro. Exigem a confirmação de que o aluno autorizou e não aceitam menor de 18. A base legal e o consentimento seguem em aberto.
- **Evolução das avaliações** (0.13): em `/profissional/alunos/<id>/evolucao`, cada indicador ao longo do tempo (gráfico acessível e tabela) e o que mudou entre avaliações na triagem, na postura e no movimento. Descreve, não julga.
- **Postura e movimento** (0.12): dentro da avaliação, os achados posturais das três vistas e os nove testes de movimento com a escala do documento mestre. Registro, não diagnóstico; não altera a triagem. Sem fotos por enquanto.
- **PDF do plano entregue** (0.11): gerado no servidor para a revisão entregue, com versão, data, profissional e links de vídeo clicáveis. O profissional e o aluno baixam o mesmo arquivo; cada download é auditado.
- **Avaliações e triagem** (0.10): registros datados com os seis itens de triagem do documento mestre e indicadores de base (FC de repouso, pressão como registrada, cintura, % de gordura e medidas livres). Qualquer item marcado dá "Revisão obrigatória antes da entrega.": bloqueia aprovar e entregar até o profissional registrar a revisão, com a base escrita por ele. Avaliação registrada é imutável também no banco; "nenhum sinal marcado" não é liberação clínica. Conteúdo do instrumento a conferir com o responsável técnico.
- **Ficha do aluno** (0.9): identificação, contexto de treino, histórico e preferências, com os campos do documento mestre. Só o profissional com vínculo técnico vê; menores são sinalizados; base legal e consentimento seguem em aberto.
- **Aprovação e entrega** (0.8): o profissional aprova (com o aviso de triagem não registrada) e entrega; o aluno vê só a revisão entregue em `/aluno/treino`. Revisão fechada é imutável também no banco, por gatilhos.
- **Painel de Prescrição** (0.7): lista a revisão mais recente de cada plano com as pendências por alvo, e permite copiar um mesociclo inteiro para uma fase sem exercícios.
- **Prescrição manual** (0.6): dentro do plano salvo de cada aluno, o profissional monta os exercícios por mesociclo e treino, digitando cada valor. Nada é sugerido nem preenchido; abaixo do alvo é pendência. Revisão pronta congela, e a nova revisão leva os exercícios.
- **Biblioteca de exercícios** (0.5a): 64 exercícios do documento mestre como biblioteca do sistema (os vídeos são links de busca, não vídeos revisados) e biblioteca própria da organização, com revisão de vídeo deliberada.
- **Planos salvos por aluno** (0.4): o planejador grava a estrutura do ciclo no cadastro do aluno, em revisões (Rascunho → Estrutura pronta). "Pronta" valida o calendário; **não** é aprovação nem libera nada ao aluno. Mudar uma revisão pronta cria uma nova.
- Tabelas nativas: `users`, `organizations`, `memberships`, `professionals`, `students`, `care_assignments`, `student_access`, `platform_admins`, `student_invites`, `access_audit_events` e controle de versão do schema.
- Repositories de leitura com organização, vínculo técnico/aluno, revogação e bloqueio de identidade em cada consulta.
- `/api/health` consulta de verdade a versão do schema no binding `DB`; retorna 503 se o banco/migration não estiver disponível.
- Configuração Next/OpenNext, testes e CI para raiz/subcaminho.

O planejador ainda não grava prescrições no banco. Verificação de e-mail, recuperação de senha, envio de e-mails, postura e movimento, execução do treino pelo aluno, sites, financeiro e integrações continuam no roadmap. Cada página e ação exige sessão validada e papel derivado no servidor.

## Validar

```sh
npm run check
npm run db:check:local
npm run build:cloud
npm run preview:cloud
```

Com o Worker ativo, em outro terminal:

```sh
SMOKE_ORIGIN=http://127.0.0.1:8787 npm run smoke
npm run test:e2e
```

Para o navegador, execute `npx playwright install chromium` ou use `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium` se já instalado. Os testes de banco usam D1 real em um runtime Miniflare isolado; não há PostgreSQL/PGlite. Há testes de identidade controlada e também de login/sessões reais; Playwright cobre o fluxo completo em duas organizações.

## Estrutura

```text
src/app/                 rotas por área: (publico), gestor, profissional, aluno, demonstracao, api
src/components/          moldura por papel, componentes de interface
src/modules/             auth, plataforma (navegação por papel), gestor, convites, portal, demo, planejador
src/db/                  binding do servidor e repositories autorizados
migrations/              migrations SQLite aplicadas pelo Webflow
cloudflare-env.d.ts       tipos do binding DB
wrangler.json            configuração dos recursos nativos
scripts/                 smoke tests HTTP
tests/                  testes de domínio, D1 e navegador
docs/referencias/        documentos originais e referência visual preservados
```

## Documentação

- [Estrutura por papéis e conciliação com o handoff V2](docs/ESTRUTURA-E-PAPEIS.md)
- [Arquitetura atual](docs/ARQUITETURA-WEBFLOW-CLOUD.md)
- [Design system](docs/DESIGN-SYSTEM.md)
- [Banco e publicação no Webflow](docs/WEBFLOW-CLOUD.md)
- [Roadmap](docs/ROADMAP-IMPLEMENTACAO.md)
- [Evidências de validação](docs/VALIDACAO.md)

**Próxima fatia:** verificação de e-mail, recuperação de senha e envio de e-mails (aguardam o provedor de envio); depois a execução do treino pelo aluno. A etapa atual não fecha o piloto operacional.

No Webflow, configure `AUTH_SECRET` (aleatória, ao menos 32 caracteres), `AUTH_ORIGIN` (origem HTTPS privada, sem caminho) e `PLATFORM_SETUP_TOKEN` (32+ caracteres, para ativar o primeiro gestor). `DEMO_MODE=true` é opcional. Em subcaminho, configure `BASE_URL` no build. Veja [configuração de acesso](docs/AUTENTICACAO.md) e [decisões visuais](docs/DESIGN-SYSTEM.md).
