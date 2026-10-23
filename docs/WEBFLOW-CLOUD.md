# Banco nativo e publicação no Webflow Cloud

## Configuração

`webflow.json` declara Next.js. `wrangler.json` declara o Worker, assets e:

```json
{
  "d1_databases": [{
    "binding": "DB",
    "database_name": "trainer-prescription",
    "database_id": "local-trainer-prescription",
    "migrations_dir": "migrations"
  }]
}
```

`database_id` acima é um identificador local, não uma conexão de produção. Conforme a [documentação Webflow](https://developers.webflow.com/webflow-cloud/storing-data/sqlite), o Webflow atribui o identificador real e provisiona o recurso no deploy. Depois da publicação, conferir o recurso atribuído na aba **Storage**. Não criar um banco avulso na conta Cloudflare nem configurar Supabase para este app.

`src/db/binding.ts` acessa `getCloudflareContext({ async: true })` dentro da requisição. A configuração Next inicializa o adapter no desenvolvimento, compartilhando `.wrangler/state` com as migrations locais. `cloudflare-env.d.ts` declara o tipo `DB`.

## Desenvolvimento

```sh
npm ci
npm run db:migrate:local
npm run db:check:local
npm run dev
```

As tabelas locais ficam em `.wrangler/state`, ignorado pelo Git. Rodar `db:migrate:local` de novo aplica apenas migrations pendentes e preserva dados. Não executar SQL de bootstrap ou inserir usuários fictícios no banco que será publicado.

Nesta máquina Codex, use cache/configuração graváveis:

```sh
export npm_config_cache=/workspace/.npm-cache
export XDG_CONFIG_HOME=/workspace/.config
export WRANGLER_LOG_PATH=/workspace/projeto-musculo/.wrangler/logs
export WRANGLER_SEND_METRICS=false
export NEXT_TELEMETRY_DISABLED=1
```

## Prova do runtime

```sh
npm run check
npm run build:cloud
npm run preview:cloud
```

Em outro terminal:

```sh
SMOKE_ORIGIN=http://127.0.0.1:8787 npm run smoke
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:e2e
```

Para verificar subcaminho, passe `BASE_URL=/treinador` no build, preview, smoke e testes. Não faça builds simultâneos sobre `.next`/`.open-next` nem troque o bundle de um processo antigo. As variáveis de montagem são de build.

## Publicar e ver as tabelas

1. Conectar `rafsoaresm/projeto-musculo`, branch `main`, à aplicação Webflow Cloud; usar a raiz do repositório e Next.js.
2. Disparar o deploy do commit atualizado pelo Webflow. Se a integração já estiver ativa, um push no branch conectado pode disparar o deploy automaticamente.
3. O Webflow provisiona `DB` e aplica `migrations/0001_foundation.sql` no ambiente de destino. O diretório `.wrangler` local não é o banco de produção e não será enviado ao Git.
4. Na aplicação Webflow, abrir o ambiente → **Storage** → **DB**. Conferir as tabelas e o registro `0001_foundation` em `app_schema_versions`.
5. Verificar `api/health` no caminho real do app: HTTP 200, `storage: webflow_sqlite` e `persistence: available`. Se houver 503, consultar os logs internos de binding/migration sem expor detalhes em resposta pública.

O comando de build do app continua `npm run build`; `build:cloud` serve para validar o bundle OpenNext localmente. Não usar `wrangler deploy` como substituto de publicação no Webflow.

## Operação

Não há senha, URL ou token de banco a inserir. Bindings são por ambiente; preservar nomes/IDs existentes ao evoluir o projeto. Após um deploy, migrations são imutáveis; alterações futuras devem ser aditivas. Não usar scripts `--remote` de uma conta Cloudflare independente para manipular recursos gerenciados pelo Webflow.

A autenticação de usuários finais ainda será implementada. O health check confirma a migration, não login, privacidade ponta a ponta ou prescrição persistida. Object Storage para fotos/PDFs e políticas de acesso serão adicionados quando suas jornadas forem construídas.

Snapshot/publicação do ambiente Codex, push no GitHub e deploy no Webflow são operações diferentes. Processos de desenvolvimento precisam reiniciar após restaurar uma máquina.
