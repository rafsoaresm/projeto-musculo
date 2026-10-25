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

Para as fotos de postura (0.14), o app usa o armazenamento de objetos nativo (R2) pelo binding `PHOTOS`, declarado em `wrangler.json`:

```json
{
  "r2_buckets": [{ "binding": "PHOTOS", "bucket_name": "photos" }]
}
```

**Por que o nome é `photos` e não `trainer-prescription-photos` (0.18.1).** Os dois primeiros deploys com o bucket (0.14) falharam logo depois de "Processing 1 R2 bucket(s)...", sem mensagem (deploys `75f914e9` e `827639fe`, commit `c86adfe`). Em 0.18.1 achamos a causa provável **no nosso arquivo, não na conta nem no plano**: o Webflow dá ao recurso real o nome `<id do ambiente>-<nome declarado>`, como mostra o log de um deploy bom, em que o banco aparece como `f26f7686-f290-4ed2-a487-fefb0d58aa2c-trainer-prescription`. O id tem 36 caracteres; com `trainer-prescription-photos` (27) o nome do bucket teria 36 + 1 + 27 = **64 caracteres, e um bucket R2 aceita no máximo 63**. A hipótese anterior, de que o Object Storage não estaria ativo ou fora do plano, **não se sustenta**: segundo a documentação do Webflow, o Object Storage existe em todos os planos do Webflow Cloud, sem ativação separada, e liga com o `r2_buckets` e um deploy (a capacidade total é que muda com o plano). `tests/wrangler-config.test.ts` passou a exigir que o nome declarado caiba depois do prefixo, para os dois arquivos. **Confirmado em 25/10/2026:** o log do deploy `3f1e0696` mostra `R2 Bucket: photos -> f26f7686-f290-4ed2-a487-fefb0d58aa2c-photos` e a criação do bucket, e o ambiente passou a listar o binding `PHOTOS` (r2).

**Bucket provisionado não é foto liberada.** O app só aceita, mostra e serve fotos quando o bucket existe **e** `PHOTOS_ENABLED` é `"true"`. Em produção, `wrangler.json` declara o bucket e **não** declara essa variável, então a tela mostra "Fotos indisponíveis neste ambiente" e a rota de fotos responde 503: o bucket pode ser criado e conferido sem abrir a captura de imagens de saúde antes do aceite do aluno. `wrangler.photos.json` (preview local, `next dev` e CI, que simulam o R2 em `.wrangler/state`) declara o mesmo bucket e liga `PHOTOS_ENABLED`, porque os testes de navegador precisam das fotos abertas.

**Para abrir as fotos em produção:** depois do aceite do aluno existir, acrescentar `"vars": { "PHOTOS_ENABLED": "true" }` ao `wrangler.json` e publicar (se o builder do Webflow não repassar `vars`, definir `PHOTOS_ENABLED` como variável de ambiente no painel). Depois do deploy, conferir na aba **Storage** que o bucket existe e **não tem endereço público** (as fotos só devem sair pela rota autenticada do app) e subir uma foto de teste. Limites informados pelo Webflow: 100 MB e 20 s por requisição; o app limita cada foto a 5 MB. `cloudflare-env.d.ts` declara `PHOTOS` e `PHOTOS_ENABLED` como opcionais e `src/db/binding.ts` os confere por requisição.

`database_id` acima é um identificador local, não uma conexão de produção. Conforme a [documentação Webflow](https://developers.webflow.com/webflow-cloud/storing-data/sqlite), o Webflow atribui o identificador real e provisiona o recurso no deploy. Depois da publicação, conferir o recurso atribuído na aba **Storage**. Não criar um banco avulso na conta Cloudflare nem configurar Supabase para este app.

`src/db/binding.ts` acessa `getCloudflareContext({ async: true })` dentro da requisição. A configuração Next inicializa o adapter no desenvolvimento, compartilhando `.wrangler/state` com as migrations locais. `cloudflare-env.d.ts` declara o tipo `DB`.

## Desenvolvimento

```sh
npm ci
npm run auth:setup:local
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

Para verificar subcaminho, passe `BASE_URL=/treinador` no build, preview, smoke e testes. Não faça builds simultâneos sobre `.next`/`.open-next` nem troque o bundle de um processo antigo. `BASE_URL` é só uma simulação local: no Webflow o builder aplica o mount path e o código do navegador o descobre pela barra de endereço (ver `AUTENTICACAO.md`).

## Publicar e ver as tabelas

1. Conectar `rafsoaresm/projeto-musculo`, branch `main`, à aplicação Webflow Cloud; usar a raiz do repositório e Next.js.
2. Configurar `AUTH_SECRET` e `AUTH_ORIGIN` no ambiente Webflow (origem exata, sem `/app`; não defina `BASE_URL`). Defina também `PLATFORM_SETUP_TOKEN` (ativação do gestor) e, se quiser a demonstração, `DEMO_MODE=true`. Consultar `AUTENTICACAO.md`. Disparar o deploy do commit atualizado pelo Webflow. Se a integração já estiver ativa, um push no branch conectado pode disparar o deploy automaticamente.
3. O Webflow provisiona `DB` e aplica as migrations pendentes de `migrations/` (0001 a 0004 nesta versão) no ambiente de destino. O diretório `.wrangler` local não é o banco de produção e não será enviado ao Git.
4. Na aplicação Webflow, abrir o ambiente → **Storage** → **DB**. Conferir as tabelas e o registro `0004_training_plans` em `app_schema_versions`.
5. Verificar `api/health` no caminho real do app: HTTP 200, `storage: webflow_sqlite` e `persistence: available`. Se houver 503, consultar os logs internos de binding/migration sem expor detalhes em resposta pública.

O comando de build do app continua `npm run build`; `build:cloud` serve para validar o bundle OpenNext localmente. Não usar `wrangler deploy` como substituto de publicação no Webflow.

## Operação

Não há senha, URL ou token de banco a inserir. Bindings são por ambiente; preservar nomes/IDs existentes ao evoluir o projeto. Após um deploy, migrations são imutáveis; alterações futuras devem ser aditivas. Não usar scripts `--remote` de uma conta Cloudflare independente para manipular recursos gerenciados pelo Webflow.

Cadastro, login e logout foram implementados com Better Auth no SQLite nativo. O health informa `authentication: configured` quando a configuração básica existe; isso não comprova login remoto ou prontidão operacional. A migração e os fluxos precisam ser testados na origem privada Webflow. Object Storage para fotos/PDFs e políticas de acesso serão adicionados quando suas jornadas forem construídas.

Snapshot/publicação do ambiente Codex, push no GitHub e deploy no Webflow são operações diferentes. Processos de desenvolvimento precisam reiniciar após restaurar uma máquina.
