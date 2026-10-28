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

Para as fotos de postura (0.14) e as imagens do Meu Site (0.36), o app usa o armazenamento de objetos nativo (R2) pelos bindings `PHOTOS` e `SITE_MEDIA`, declarados em `wrangler.json`:

```json
{
  "r2_buckets": [
    { "binding": "PHOTOS", "bucket_name": "photos" },
    { "binding": "SITE_MEDIA", "bucket_name": "site-media" }
  ]
}
```

**Por que o nome é `photos` e não `trainer-prescription-photos` (0.18.1).** Os dois primeiros deploys com o bucket (0.14) falharam logo depois de "Processing 1 R2 bucket(s)...", sem mensagem (deploys `75f914e9` e `827639fe`, commit `c86adfe`). Em 0.18.1 achamos a causa provável **no nosso arquivo, não na conta nem no plano**: o Webflow dá ao recurso real o nome `<id do ambiente>-<nome declarado>`, como mostra o log de um deploy bom, em que o banco aparece como `f26f7686-f290-4ed2-a487-fefb0d58aa2c-trainer-prescription`. O id tem 36 caracteres; com `trainer-prescription-photos` (27) o nome do bucket teria 36 + 1 + 27 = **64 caracteres, e um bucket R2 aceita no máximo 63**. A hipótese anterior, de que o Object Storage não estaria ativo ou fora do plano, **não se sustenta**: segundo a documentação do Webflow, o Object Storage existe em todos os planos do Webflow Cloud, sem ativação separada, e liga com o `r2_buckets` e um deploy (a capacidade total é que muda com o plano). `tests/wrangler-config.test.ts` passou a exigir que o nome declarado caiba depois do prefixo, para os dois arquivos. **Confirmado em 25/10/2026:** o log do deploy `3f1e0696` mostra `R2 Bucket: photos -> f26f7686-f290-4ed2-a487-fefb0d58aa2c-photos` e a criação do bucket, e o ambiente passou a listar o binding `PHOTOS` (r2).

**Bucket provisionado não é foto liberada.** O app só aceita, mostra e serve fotos quando o bucket existe **e** `PHOTOS_ENABLED` é exatamente `"true"` (e, desde a 0.21, só com a autorização do próprio aluno, registrada no aceite, para cada foto). Desde a **0.24.1** o `wrangler.json` declara o bucket **e** `"vars": { "PHOTOS_ENABLED": "true" }`: o texto do aceite foi aprovado e as fotos estão abertas. O mesmo arquivo serve ao preview local, ao `next dev` e ao CI (que simulam o R2 em `.wrangler/state`); não há mais um segundo arquivo de configuração.

**A variável pode chegar por dois caminhos.** A documentação do Webflow Cloud só descreve a leitura dos bindings do `wrangler.json` (`d1_databases`, `kv_namespaces`, `r2_buckets`) e diz que os outros campos passam e são ignorados; as variáveis de ambiente oficiais são as do painel, que chegam por `process.env`. Por isso o app (`photosSwitch`) aceita `PHOTOS_ENABLED` do Worker **ou** de `process.env`, como `DEMO_MODE` e `AUTH_ORIGIN`. **Depois do deploy, conferir `https://<domínio>/app/api/health`: `"photos": "open"`.** Se disser `"closed"`, criar `PHOTOS_ENABLED=true` como variável de ambiente no painel (Webflow Cloud > o app > Environments > o ambiente > Variables > Add variable) e publicar de novo.

**Apagar fotos a pedido do aluno (0.25)** usa o binding `PHOTOS` e não a chave `PHOTOS_ENABLED`: continua funcionando com as fotos fechadas, para que um pedido do aluno seja sempre atendido.

**Para fechar as fotos de novo:** tirar `vars` do `wrangler.json` e a variável do painel (se existir), publicar e conferir `"photos": "closed"`; a tela volta a mostrar "Fotos indisponíveis neste ambiente" e a rota responde 503. Fotos já guardadas não são apagadas.

**Conferência do bucket.** Na aba **Storage** (Webflow Cloud > o app > Environments > o ambiente > Storage), o bucket existe e **não tem endereço público**: pela documentação do Webflow, buckets públicos não são suportados no Webflow Cloud e não há opção de tornar o bucket público nem de dar-lhe `r2.dev` ou domínio próprio, então a aba só deve listar o binding (nome, tipo e data de criação); as fotos só saem pela rota autenticada do app. Limites informados pelo Webflow: 100 MB e 20 s por requisição; o app limita cada foto a 5 MB. `cloudflare-env.d.ts` declara `PHOTOS` e `PHOTOS_ENABLED` como opcionais e `src/db/binding.ts` os confere por requisição.

**Segundo bucket: as imagens do Meu Site (0.36).** O `wrangler.json` passou a declarar dois buckets: `{ "binding": "PHOTOS", "bucket_name": "photos" }` e `{ "binding": "SITE_MEDIA", "bucket_name": "site-media" }`. Os dois **não se misturam**: as fotos de postura são dado de saúde do aluno, atrás de autorização e de sessão; as imagens do site são do que o profissional **escolheu mostrar**, e só saem se a **versão publicada** as usa. O nome `site-media` (10) cabe depois do prefixo do ambiente (36 + 1 + 10 = 47 ≤ 63), e `tests/wrangler-config.test.ts` confere o limite para todos os buckets declarados e a lista exata de bindings e nomes (dois buckets, dois nomes).

**"Armazenamento público" no Webflow Cloud é uma rota do app, não um bucket público.** Como o Webflow Cloud não aceita bucket público nem `r2.dev` (acima), a página pública **não** aponta para o bucket: aponta para `/s/<endereço>/m/<imagem>`, uma rota **do próprio app**, sem sessão, que só responde se a imagem estiver na versão que o ponteiro do site publica (`site_release_assets`); imagem só da biblioteca, só de rascunho, de página tirada do ar, de outro site, identificador malformado e endereço inexistente respondem igual, 404. A resposta leva `Content-Type` do tipo guardado, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `ETag` (o SHA-256 do arquivo) com `Cache-Control: public, no-cache` (o navegador revalida e recebe 304; a imagem de uma página tirada do ar não fica servida por cache intermediário sem perguntar) e o objeto se chama `sites/<organização>/<site>/<uuid>.<ext>`, sem nome do arquivo enviado. **Confirmado em 28/10/2026** (deploy `1eb4a675`, commit `e475e87`): o log mostra `R2 Bucket: site-media -> f26f7686-f290-4ed2-a487-fefb0d58aa2c-site-media` e `Did not find existing R2 bucket, creating…`, `0025_site_media.sql ✅`, e o ambiente passou a listar o binding `SITE_MEDIA` (r2) ao lado de `PHOTOS`. O que **não** foi verificado com o Webflow de verdade: `/api/health` com `0.36.0` e o envio de uma imagem em produção (o ambiente de desenvolvimento não alcança o site publicado). Se o deploy falhar logo depois de "Processing 2 R2 bucket(s)...", suspeitar do nome (ver o caso das fotos acima) antes de qualquer outra coisa.

**Se `SITE_MEDIA` não existir** (por exemplo, um ambiente sem o binding), o app não quebra: o editor diz "Imagens indisponíveis neste ambiente", o envio responde 503 e a página pública publicada com imagem não as mostra (a rota responde 404) em vez de falhar. `cloudflare-env.d.ts` declara `SITE_MEDIA` como opcional e `getSiteMediaBucket()` em `src/db/binding.ts` o confere por requisição.

`database_id` acima é um identificador local, não uma conexão de produção. Conforme a [documentação Webflow](https://developers.webflow.com/webflow-cloud/storing-data/sqlite), o Webflow atribui o identificador real e provisiona o recurso no deploy. Depois da publicação, conferir o recurso atribuído na aba **Storage**. Não criar um banco avulso na conta Cloudflare nem configurar Supabase para este app.

`src/db/binding.ts` acessa `getCloudflareContext({ async: true })` dentro da requisição. A configuração Next inicializa o adapter no desenvolvimento, compartilhando `.wrangler/state` com as migrations locais. `cloudflare-env.d.ts` declara o tipo `DB`.

## E-mail (recuperação de senha, Amazon SES)

A recuperação de senha por e-mail (0.26) só existe quando as cinco variáveis abaixo estão completas e bem formadas; com qualquer uma faltando ou estranha, ela continua desligada e nada quebra. Passo a passo para ligar:

1. **Identidade de envio no Amazon SES.** No console da AWS, em *Amazon SES > Configuration > Identities > Create identity*, crie um **domínio** (melhor) ou um endereço. Para domínio, publique no DNS os três registros CNAME do *Easy DKIM* que o console mostra e espere o status ficar *Verified*. Publique também SPF e DMARC do domínio. O remetente (`EMAIL_FROM`) precisa pertencer a essa identidade.
2. **Sair do modo de teste (sandbox).** Conta nova do SES só envia para endereços verificados. Em *Account dashboard > Request production access*, peça a saída do sandbox descrevendo o uso: e-mail transacional de redefinição de senha, volume baixo. Enquanto isso, só dá para testar enviando para um endereço que você verificou como identidade.
3. **Usuário IAM só de envio.** Em *IAM > Users*, crie um usuário sem acesso ao console, com a política abaixo (troque a região, o número da conta e o domínio), e crie uma chave de acesso para ele.
   ```json
   { "Version": "2012-10-17", "Statement": [ { "Effect": "Allow", "Action": ["ses:SendEmail"],
     "Resource": "arn:aws:ses:sa-east-1:<número-da-conta>:identity/<seu-domínio>" } ] }
   ```
4. **Variáveis do ambiente no Webflow** (Webflow Cloud > o app > Environments > o ambiente > Variables > Add variable). Os valores nunca vão para o repositório nem para o navegador:

   | Variável | Valor | Secreta? |
   |---|---|---|
   | `AWS_REGION` | a região da identidade, por exemplo `sa-east-1` | não |
   | `AWS_ACCESS_KEY_ID` | o id da chave do passo 3 | não |
   | `AWS_SECRET_ACCESS_KEY` | a chave secreta do passo 3 | **sim** |
   | `EMAIL_FROM` | `Nome <nao-responda@seu-dominio>` ou só o endereço | não |

   Depois, publique de novo (qualquer commit na `main`, ou *Redeploy*).
5. **Conferir.** `https://<domínio>/app/api/health` deve mostrar `"passwordRecovery": "available"`. Depois, na tela de entrada deve aparecer "Esqueci minha senha"; peça o link para uma conta de teste (no sandbox, um endereço verificado) e confira que o e-mail chega, o link abre `/redefinir-senha` e a senha nova funciona.
6. **Desligar.** Apague qualquer uma das variáveis e publique de novo: a recuperação some da tela e os endpoints voltam a responder 404.

`EMAIL_TRANSPORT=capture` existe só para os testes de navegador (guarda o texto do e-mail no banco local) e só é aceito quando `AUTH_ORIGIN` é `localhost` ou `127.0.0.1`: numa variável de produção ele não liga nada. **Atenção a um texto aprovado:** o termo do profissional diz "Ainda não existe recuperação de senha por e-mail". Ao ligar o e-mail essa frase passa a ser falsa; troque-a em `/gestor/termos` (isso gera uma nova versão e todos aceitam de novo).

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

Para verificar subcaminho, passe `BASE_URL=/treinador` no build, preview, smoke e testes. Não faça builds simultâneos sobre `.next`/`.open-next` nem troque o bundle de um processo antigo. `BASE_URL` é só uma simulação local: no Webflow o builder aplica o mount path e o código do navegador o descobre pela barra de endereço (ver `AUTENTICACAO.md`). **O servidor também não pode depender de `NEXT_PUBLIC_BASE_PATH`** (vazio no Webflow): os endereços que ele escreve em HTML e CSS são relativos (0.38.1, `image-urls.ts`). Para reproduzir localmente o build do Webflow (mount path aplicado, variável vazia), compile e rode o preview com `BASE_URL=/treinador SIMULATE_PLATFORM_MOUNT=1` (**só no build de nuvem e no `preview:cloud`: com `next dev` a página recarrega em laço, causa não investigada**).

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
