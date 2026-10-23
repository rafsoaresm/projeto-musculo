# Evidências de validação — identidade visual e acesso, v0.2

A aplicação usa SQLite nativo do Webflow via binding DB. A referência visual original foi preservada byte a byte em `referencias/04-TOKENS-VISUAIS.md`; instruções no anexo não foram tratadas como pedidos de execução. A migration 0001 permanece inalterada.

## Código e banco

- Instalação com versões fixadas e lockfile atualizado; Better Auth 1.7.12, adapter Drizzle e Inter local.
- `npm run check`: ESLint, TypeScript e 58 testes, sem skipped.
- 26 casos de calendário/contratos e 17 de isolamento D1 da fundação preservados.
- 15 novos casos de autenticação/onboarding: hash de senha, cookie Secure/HttpOnly/SameSite/path, sessão válida/expirada, cookie forjado, senha incorreta, logout com replay, origem inválida/ausente, allowlist/método, limite de corpo, limite de tentativas persistido, montagem, provisionamento único/concorrente, isolamento de escrita, papéis comercial/financeiro, revogação/bloqueio e rollback quando a auditoria falha. Alguns casos exercitam mais de uma propriedade.
- Migrations 0001 e 0002 aplicadas no SQLite local por Wrangler. Nova execução confirmou nenhuma migration pendente; ambas as versões foram consultadas em `app_schema_versions`.
- Nenhum segredo local de autenticação encontrado nos assets públicos gerados.

## Interface e runtime Workers

O build Next/OpenNext usa o runtime alvo workerd e o binding D1 local. O teste de navegador revelou duas diferenças importantes em relação a Node: objetos Request de construtores distintos e remoção do mount path pelo Next. O handler reconstrói a requisição por URL, corpo limitado e endpoint validado; isso evita depender de `instanceof Request` ou do caminho externo intacto.

Foram aprovados oito cenários na raiz e oito em `/treinador` (16 no total), além de builds e smoke em ambas as montagens. A matriz de navegador contempla oito cenários por montagem (desktop e celular): navegação, planejador/exportação/invalidação, validação das fases e fluxo de conta → organização → aluno → logout → novo login. O fluxo também abre uma segunda organização e tenta acessar a URL do aluno da primeira. Dados e persistência são reais no SQLite local, usando apenas contas fictícias.

O harness usa endereços de teste separados no header de edge somente no Worker local, para não compartilhar os limites de tentativa entre execuções concorrentes. O rate limiter é testado separadamente contra SQLite. Essa configuração não é uma prova da proteção de headers pelo edge remoto.

Smoke HTTP verifica páginas, assets, schema disponível, ausência de cache na saúde e 404. As páginas privadas retornam `no-store`, conferido no navegador. Capturas da home desktop e cadastro a 375px foram inspecionadas; Inter é a fonte computada e não houve overflow horizontal. A navegação inferior deixa espaço de rolagem para os formulários.

## Fronteiras da evidência

São testes locais, não comprovação de deploy/CI remota ou homologação na conta Webflow. Confirmar no ambiente privado: DB provisionado, migrations, AUTH_SECRET, AUTH_ORIGIN, mount path, cookies HTTPS, limite de CPU do plano e sobrescrita de CF-Connecting-IP pelo edge.

O health consulta a versão do schema e informa se a configuração básica de autenticação existe. Não valida envio de e-mail, recuperação, convites, prescrição persistida nem prontidão operacional.

Continuam pendentes e-mail verificado, recuperação de senha, convites, gestão de equipe/revogação pela interface, auditoria de acesso completa, avaliação e prescrição persistida, aprovação/entrega, portal separado, Storage privado, jobs/PDF, editor, integrações e pagamentos. O cadastro de credenciais da biblioteca usa operações sequenciais em D1; falhas parciais precisam de homologação antes de abrir o cadastro operacional. Os batches de domínio são atômicos.
