# Evidências de validação — fundação com SQLite nativo

Esta revisão substitui a configuração PostgreSQL/Supabase da proposta inicial. Não há migrations Supabase nem dependência PGlite na base atual. Os documentos históricos em `referencias/` foram preservados.

## Validações concluídas

- Instalação com dependências fixadas no lockfile.
- `npm run check`: ESLint, TypeScript e **43 testes** aprovados, nenhum skipped.
- 26 casos de calendário/contratos: fases, intervalos, rotação, datas reais, ano bissexto e rejeição de entradas inválidas.
- 17 casos no binding D1 real do Miniflare: queries isoladas por organização, papel/vínculo técnico, identidade em duas organizações, IDs manipulados, revogação de membership/atribuição/vínculo, usuário bloqueado, foreign keys compostas e rollback de batch.
- Migration `0001_foundation.sql` aplicada no SQLite local por Wrangler. Segunda execução confirmou **nenhuma migration pendente**, sem recriar ou apagar dados.
- `db:check:local` confirmou a versão `0001_foundation` no banco persistido em `.wrangler/state`.
- Build Next.js e bundle OpenNext para Workers concluídos com o binding DB nativo configurado.
- Smoke HTTP no Worker atual: páginas e assets responderam; health confirmou SQLite e migration disponíveis; 404 validado.
- Seis cenários Playwright desktop/celular aprovados novamente no app com DB nativo (navegação, planejamento, exportação e invalidação do rascunho).

## Fronteiras de evidência

O banco dos testes D1 é isolado e descartável. Os testes não usam PostgreSQL nem implementações falsas das queries; executam SQL no binding real. A identidade de usuário é fornecida pelo harness, portanto não comprovam login, cookies ou sessões reais.

O health check consulta o controle de versão do schema no banco. Ele informa 503 se o binding/migration estiver indisponível e nunca expõe conteúdo de alunos. Não é um indicador de que o cadastro/autenticação/prescrição persistida já esteja completo.

Os seis cenários desktop/celular do planejador foram validados na fundação inicial, incluindo montagem em `/treinador`. A CI mantém a matriz raiz/subcaminho e agora aplica migrations antes de iniciar o Worker. Execução remota da CI e deploy Webflow têm resultados próprios e não são inferidos de um build local.

## Ainda pendente no produto

Deploy e Storage na conta Webflow, domínio/TLS, autenticação, convites, cadastro autorizado, Storage privado, jobs, PDF, editor, integrações e pagamentos. O planejador ainda exporta rascunhos sem gravá-los no banco.

A documentação oficial Webflow foi acessada nesta revisão e confirma provisionamento do SQLite e migrations automáticas por deploy. O ID em `wrangler.json` é local; a identidade do recurso remoto será atribuída pelo Webflow e deve ser conferida na aba Storage.
