# projeto-musculo — Trainer Prescription

Fundação de uma plataforma para personal trainers, construída para **Webflow Cloud Apps com banco SQLite nativo do próprio ambiente**. A decisão atual substitui a proposta Supabase dos documentos históricos; não existe dependência de Supabase na aplicação.

## Executar

Node.js 22.13+ (abaixo de 25), npm e o lockfile:

```sh
npm ci
npm run db:migrate:local
npm run dev
```

O binding `DB` em `wrangler.json` fornece o banco. Não é necessário criar conta externa, token ou URL de banco. No desenvolvimento, os dados ficam em `.wrangler/state`; na publicação, o Webflow cria o recurso por ambiente e aplica as migrations. O identificador `local-trainer-prescription` é apenas local; o Webflow atribui o ID real no deploy.

## O que existe

- Interface responsiva com visão geral, mapa de produto e planejador.
- Planejador de 3/6/12 fases, 3–6 semanas, 1–7 sessões por semana, splits e duração real. Exportação JSON versionada como `DRAFT`.
- Tabelas nativas iniciais: `users`, `organizations`, `memberships`, `professionals`, `students`, `care_assignments`, `student_access` e controle de versão do schema.
- Repositories de leitura com organização, vínculo técnico/aluno, revogação e bloqueio de identidade em cada consulta.
- `/api/health` consulta de verdade a versão do schema no binding `DB`; retorna 503 se o banco/migration não estiver disponível.
- Configuração Next/OpenNext, testes e CI para raiz/subcaminho.

O planejador ainda não grava prescrições no banco. Login, convites, avaliação, aprovação/entrega, portal, sites, financeiro e integrações continuam no roadmap. Não há endpoints públicos de cadastro/leitura de alunos enquanto a autenticação não estiver implementada.

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

Para o navegador, execute `npx playwright install chromium` ou use `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium` se já instalado. Os testes de banco usam D1 real em um runtime Miniflare isolado; não há PostgreSQL/PGlite. A identidade nos testes é controlada, não um login real.

## Estrutura

```text
src/app/                 páginas, handlers e health check
src/modules/             domínio e interface do planejador
src/db/                  binding do servidor e repositories autorizados
migrations/              migrations SQLite aplicadas pelo Webflow
cloudflare-env.d.ts       tipos do binding DB
wrangler.json            configuração dos recursos nativos
scripts/                 smoke tests HTTP
tests/                  testes de domínio, D1 e navegador
docs/referencias/        três documentos originais preservados
```

## Documentação

- [Arquitetura atual](docs/ARQUITETURA-WEBFLOW-CLOUD.md)
- [Banco e publicação no Webflow](docs/WEBFLOW-CLOUD.md)
- [Roadmap](docs/ROADMAP-IMPLEMENTACAO.md)
- [Evidências de validação](docs/VALIDACAO.md)

**Próxima fatia:** autenticação, convites e provisionamento autorizado sobre as tabelas nativas, seguido da prescrição persistida. Ter o binding do banco não autentica os usuários finais do app.
