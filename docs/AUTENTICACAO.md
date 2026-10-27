# Acesso, papéis e convites — versão 0.3

## Fluxo entregue

`/cadastro` → conta profissional → `/organizacao` → espaço e profissional responsável → `/profissional` → `/profissional/alunos` → cadastro e detalhe do primeiro aluno. `/entrar` valida a senha; sair remove a sessão do banco. A lista e o detalhe persistem após novo login. Depois do login, `/acesso` encaminha cada conta para a sua área (gestor, profissional ou aluno).

**Aluno:** o profissional gera um link de uso único em `/profissional/alunos/<id>`; o aluno abre `/convite/<token>`, cria a conta (ou entra) e aceita. O vínculo nasce do token, nunca do e-mail. Detalhes em [ESTRUTURA-E-PAPEIS.md](ESTRUTURA-E-PAPEIS.md).

**Gestor da ferramenta:** conta comum, ativada em `/gestor/ativar` com `PLATFORM_SETUP_TOKEN`, uma única vez enquanto não houver gestor ativo.

Better Auth 1.7.12 gerencia credenciais e sessões. Senhas têm 12–128 caracteres e usam o hash da biblioteca. Sessões duram sete dias, com atualização após um dia; não há cache de sessão em cookie. Cookies são HttpOnly, SameSite=Lax, restritos ao mount path e Secure em HTTPS. Sessões expiradas/removidas são rejeitadas; cada operação de domínio reavalia bloqueio e membership/vínculo.

As rotas de autenticação têm allowlist (`sign-up/email`, `sign-in/email`, `sign-out`, `get-session` e, só para quem já tem sessão, `change-password` e `revoke-other-sessions`), método HTTP específico, checagem exata de Origin em POST e `private, no-store`. Os limites persistem no SQLite (10 tentativas de login, 5 cadastros e 5 trocas de senha por minuto por endereço). O endereço vem exclusivamente de `CF-Connecting-IP`; sua sobrescrita pelo edge deve ser confirmada na homologação Webflow. Sem esse header, usa-se um limite compartilhado. Não se confia em `X-Forwarded-For` enviado livremente.

Server Actions validam novamente sessão e dados. Organização/usuário nunca vêm de campos do formulário. `createStudent` exige profissional com membership técnica ativa, cria a atribuição e registra auditoria no mesmo batch. IDs de outra organização não revelam o aluno.

## Configuração local

Execute `npm run auth:setup:local`. O script cria `.env.local` (Next dev, origem 127.0.0.1:3000) e `.dev.vars` (Worker preview, origem 127.0.0.1:8787), com `AUTH_SECRET` e `PLATFORM_SETUP_TOKEN` aleatórios, `DEMO_MODE=true`, permissão 0600 e sem imprimir valores. Não sobrescreve valores existentes; em arquivos antigos, acrescenta somente as chaves que faltam. Use exatamente essas origens nos testes; `localhost` e `127.0.0.1` são origens diferentes. Para portas alternativas, ajuste os arquivos locais ignorados.

Se `AUTH_ORIGIN` já existir em um arquivo antigo com outro valor, ele é preservado. Não copie esses arquivos para Webflow/Git. O SQLite local de testes de navegador contém apenas os dados fictícios criados pelos testes.

## Webflow Cloud

Configure no ambiente privado do app:

| Variável | Valor |
|---|---|
| `AUTH_SECRET` | Segredo criptograficamente aleatório, independente por ambiente, mínimo 32 caracteres; sem prefixo NEXT_PUBLIC |
| `AUTH_ORIGIN` | Origem HTTPS exata, como `https://painel.example.com`, sem barra final/caminho |
| `BASE_URL` | Somente para simular um subcaminho em build/teste local, por exemplo `/treinador`. **No Webflow não defina**: o builder aplica o mount path (`/app`) sozinho |
| `PLATFORM_SETUP_TOKEN` | Segredo de 32+ caracteres para ativar o primeiro gestor. Remova ou troque depois. Sem ele, `/gestor/ativar` informa que a ativação não está configurada |
| `DEMO_MODE` | `true` liga `/demonstracao` (dados fictícios). Vazio ou ausente mantém desligada; deixe desligada em produção se não quiser a área pública |

O mount path é decidido pelo builder Webflow (basePath/assetPrefix) e **não** depende de variável deste repositório. Por isso o navegador nunca monta endereços de API a partir de `NEXT_PUBLIC_BASE_PATH`: `useMountPath()` (`src/components/use-mount-path.ts`) tira o caminho da própria barra de endereço, comparando-a com o `usePathname()` do Next (que não inclui o mount path). Cadastro, entrada, saída e o link de convite usam esse caminho. No servidor, o cookie de sessão é restrito ao mount path efetivo (`process.env.__NEXT_ROUTER_BASEPATH`, valor que o Next incorpora ao compilar, com `NEXT_PUBLIC_BASE_PATH` como reserva); `request.nextUrl.basePath` não serve porque o OpenNext remove o prefixo antes do handler. `tests/mount-path.test.ts` impede que código de navegador volte a usar a variável de build. O segredo e a origem são lidos de bindings/variáveis do servidor, nunca do host enviado pelo navegador. Sem configuração válida, o endpoint de autenticação responde 503, sem fallback público de segredo.

O DB continua nativo; não há URL de banco externo. Migrations 0001 e 0002 são necessárias. Em homologação, validar cadastro, login, cookies, CSRF, logout e tentativa de acessar um aluno de outra organização na URL real. O domínio do painel deve ser privado, separado de scripts de marketing.

## Limites desta fatia

- E-mails ainda não são verificados. Não autorizar convites, vínculos ou mesclagem de identidades por simples coincidência de e-mail.
- A recuperação de senha existe (0.26), mas só liga com o e-mail configurado. A verificação em duas etapas existe (0.31) e é opcional. Envio de mensagens, convites e gestão de equipe ainda não estão disponíveis; não se simula e-mail enviado.
- Um espaço provisionado por identidade. Não há seletor de organizações nem provisionamento automático após revogação.
- A ferramenta não envia e-mails: o profissional copia o link do convite e o envia por um canal seguro. O token é mostrado uma única vez; só o hash fica no banco.
- O portal do aluno ainda usa a mesma origem do painel. Antes de dados reais de alunos, publique painel e portal em origens privadas separadas e sem scripts de marketing.
- Há um gestor por ativação (código do ambiente) e mais gestores **por convite de uso único** (0.27, abaixo). Recuperar o último gestor perdido continua exigindo mexer no banco (ver "Mais de um gestor").
- Auditoria cobre criação de organização/aluno, ativação do gestor, bloqueios, convites e revogação de acesso, e (0.32) cada entrada, que só a própria pessoa vê. Não registra entradas que falharam nem a leitura dos dados dos alunos.
- Há testes de revogação no banco. O profissional revoga o acesso do aluno e o gestor bloqueia identidades pela interface; revogação de membros de equipe ainda é pendente.
- Drizzle/Better Auth usa operações sequenciais para credenciais porque D1 não aceita transações interativas. Testar recuperação de falhas parciais de cadastro antes de liberar acesso operacional. Batches do domínio são atômicos e têm teste de rollback.
- O planejador segue exportando rascunhos sem associá-los ao aluno. Avaliações, planos salvos, aprovação e entrega usam a mesma regra: só profissional com vínculo técnico ativo, reavaliada em cada consulta.

Esta entrega permite experimentar os três papéis com dados fictícios em homologação; não fecha E1 nem o piloto operacional.

## Aparelhos conectados e entradas recentes (0.32)

Em "Minha conta" do profissional, do aluno e do gestor. Quem vê é sempre a pessoa da sessão verificada; nada vem do corpo da requisição.

- **Aparelhos conectados:** as sessões da pessoa que ainda valem, a mais recente primeiro, com o nome curto do navegador ("Chrome em Windows", "Safari em iPhone"), a data de entrada e a validade, e o aparelho atual marcado. A biblioteca renova a sessão uma vez por dia, então **não há "última atividade"**: a tela só diz quando entrou e que a validade se renova com o uso. O texto do navegador e o IP não aparecem; o token da sessão nunca é lido.
- **Desconectar um aparelho:** apaga aquela sessão, e o aparelho cai na tela de entrada no próximo pedido. A instrução repete de quem é a sessão, que não é a que está pedindo (para sair deste aparelho existe "Sair") e que o login não está bloqueado, e só então grava `DEVICE_DISCONNECTED`. "Desconectar os outros aparelhos" (0.18) continua existindo, e ela não deixa linha na trilha.
- **Entradas recentes:** um gatilho do banco grava `SIGN_IN` toda vez que uma sessão nasce (com a etapa de duas etapas ligada, só depois do código), para quem já tem perfil na ferramenta; o cadastro em si não conta. A linha diz quem e quando, **sem IP e sem navegador**. A pessoa vê as 10 últimas; a auditoria do gestor não lista essa ação. **Só existem as entradas feitas depois da 0.32.**
- **O que não existe:** registro de entradas que falharam, aviso por e-mail de uma entrada nova (depende de R1), prazo de descarte das linhas (J9) e resposta sobre o dever de guardar registros de acesso com IP (J11).

## Verificação em duas etapas (0.31)

Opcional, por pessoa, com aplicativo autenticador (TOTP: 6 dígitos, a cada 30 segundos). Em `/profissional/conta` e `/gestor/conta`.

- **Ligar** pede a senha. A tela mostra o QR (desenhado no navegador), a chave para digitar e 10 códigos de recuperação, **uma única vez**: o servidor guarda tudo cifrado e não consegue mostrar de novo. **Só vale depois de a pessoa digitar um código do aplicativo**; antes disso o cadastro fica "não verificado" e o login não pede nada.
- **Entrar:** com a etapa ligada, a senha certa **não cria sessão**; a resposta manda pedir o código (cookie de desafio por 5 minutos). O código do aplicativo ou um código de recuperação (cada um vale uma vez) cria a sessão. Erros repetidos encerram o desafio; 10 códigos errados bloqueiam a conta por 15 minutos; as rotas de duas etapas aceitam 3 chamadas a cada 10 segundos por endereço.
- **Desligar** pede a senha e uma entrada recente; **gerar novos códigos** pede a senha e aposenta todos os anteriores.
- **Rotas abertas ao navegador:** só `two-factor/enable`, `verify-totp`, `verify-backup-code`, `generate-backup-codes` e `disable`. Não há código por e-mail nem por SMS e o segredo não pode ser relido (404).
- **Trilha:** o banco grava `TWO_FACTOR_ENABLED` e `TWO_FACTOR_DISABLED` (sem o segredo).
- **Perdeu o celular e os códigos:** um **gestor da plataforma** redefine a etapa em `/gestor/organizacoes/<id>` (profissional) ou em `/gestor/gestores` (outro gestor). A ferramenta **não tem como saber** que é a pessoa quem pede: o gestor atesta, por outro canal, e a tela diz isso. A redefinição desliga a etapa, apaga os segredos, **encerra todas as sessões** da pessoa e grava `PLATFORM_TWO_FACTOR_RESET` com quem fez. Um gestor não redefine a própria. **Se o único gestor perde o celular e os códigos, ninguém na ferramenta resolve; só no banco** (B16 em `PENDENCIAS.md`; não testado).
- **O que não existe:** obrigatoriedade (nem para o gestor: R11), a tela para o aluno, aviso por e-mail e a recuperação pelo próprio titular sem depender de um gestor (depende de R1). **Não foi testado com um aplicativo autenticador de verdade**, só com um gerador de código próprio da suíte.

## Minha conta: senha e sessões (0.18)

Quem já está conectado troca a senha em `/profissional/conta` ou `/aluno/conta`. A troca exige a **senha atual** (conferida no servidor, 12 a 128 caracteres para a nova) e a sessão; com a opção marcada, as sessões dos outros aparelhos são encerradas na mesma chamada e o aparelho que trocou continua conectado. "Desconectar os outros aparelhos" faz só o encerramento. A senha atual é conferida a cada troca, então uma sessão roubada não basta para tomar a conta: o limite de 5 tentativas por minuto também vale contra o palpite da senha atual.

**Recuperação de senha por e-mail (0.26).** Existe, mas **só liga quando o e-mail está completamente configurado** (Amazon SES: `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` e `EMAIL_FROM`; passo a passo em [`WEBFLOW-CLOUD.md`](WEBFLOW-CLOUD.md)). Sem isso, tudo se comporta como antes: a tela de entrada não mostra "Esqueci minha senha", `/esqueci-a-senha` e `/redefinir-senha` dizem que a recuperação ainda não está disponível e os dois endpoints respondem 404 como se não existissem. `/api/health` diz `"passwordRecovery": "available"` ou `"not_configured"`, sem dizer nada sobre o provedor.

- **Pedir o link** (`/esqueci-a-senha`): a pessoa informa o e-mail e vê **sempre a mesma resposta** ("Se este e-mail tiver uma conta, enviamos um link"), tenha ela conta ou não, esteja ou não no limite, tenha ou não o provedor falhado. O envio sai **depois da resposta** (`waitUntil`), então o tempo também não diz se o endereço existe. Limite de 3 pedidos por minuto por IP, 3 e-mails por hora por endereço (contado em minúsculas) e 200 por hora no total; o limite é reservado numa única instrução SQL antes do envio, então pedidos simultâneos não o furam.
- **O link** vale 1 hora, uma vez, e aponta para a nossa página `/redefinir-senha#token=…`, não para o endereço de retorno da biblioteca (que nem está acessível). **O token fica no fragmento do endereço (depois do `#`), que o navegador nunca envia**: não chega ao nosso servidor, não entra em log de execução nem em cabeçalho de referência. A página o lê no navegador, tira-o do endereço na hora, não é indexada e o envia no corpo de um POST. Um link colado na mesma aba, que só muda o fragmento, também é lido.
- **Definir a nova senha** exige 12 a 128 caracteres e **encerra todas as sessões da conta**, inclusive a de quem tinha a senha antiga. Limite de 5 tentativas por minuto por IP. Quando a pessoa já terminou de entrar na ferramenta, fica uma linha na trilha (`PASSWORD_RESET_COMPLETED`, sem o token); a de quem se cadastrou e ainda não terminou não grava linha, e a redefinição funciona do mesmo jeito.
- **O que o e-mail contém:** o link e como ignorar a mensagem. Nenhum dado de treino, avaliação, foto ou check-in, em texto simples. A tabela `email_messages` guarda o endereço, o resultado (`SENT`, `FAILED`, `THROTTLED`) e o código do erro do provedor, **nunca o link, o token nem o texto**; o banco recusa um texto para qualquer provedor que não seja a captura local.
- **O que não existe:** verificação do e-mail no cadastro (a conta continua válida sem ela), troca de e-mail e aviso por e-mail de qualquer outra coisa (inclusive de que a verificação em duas etapas foi ligada, desligada ou redefinida). Quem se cadastra com um e-mail que não é seu ainda pode criar uma conta nele; por isso a recuperação nunca muda o e-mail de uma conta, só a senha, e só para quem controla a caixa de entrada.
- **Não foi testado contra a AWS real.** A assinatura (Signature Version 4) foi conferida contra os exemplos publicados pela AWS e o envio contra um provedor simulado; o primeiro envio de verdade depende de credenciais que só o responsável tem. A conferência é o item "e-mail" de `docs/VALIDACAO.md`.

## Mais de um gestor (0.27)

Antes, o único jeito de virar gestor era o código de ativação do ambiente, que só funciona enquanto não há gestor ativo: um gestor só. Agora um gestor convida outro em **Gestor > Gestores** (`/gestor/gestores`).

- **O convite é um link de uso único**, válido por 48 horas, mostrado uma só vez a quem o emitiu; só o SHA-256 dele fica no banco. Quem o abre cria a conta (ou entra) e aceita; o papel nasce **do link e da conta de quem aceitou**, nunca do e-mail (que ainda não é verificado: digitar um e-mail entregaria o papel a quem o cadastrasse primeiro). O lembrete opcional de "para quem é" é só do gestor que emitiu.
- **O que o novo gestor vê:** organizações, profissionais, contagens, a trilha de ações do gestor e os termos; bloqueia acessos e publica os termos. **Não vê alunos, avaliações nem treinos.** A página do convite diz isso antes de aceitar e pede que a pessoa entre com a conta certa.
- **O convite morre** quando vence, é usado, é cancelado ou quando quem o emitiu deixa de ser gestor; quem já é gestor não gasta o link; uma identidade bloqueada não vira gestor. O banco recusa essas situações também, por gatilhos (convite só emitido por gestor ativo, imutável depois de usado ou cancelado, nunca apagado).
- **Encerrar o acesso** de outro gestor vale na requisição seguinte (cada verificação lê `platform_admins` de novo). **Ninguém encerra o próprio**, então sempre sobra ao menos quem está agindo. Pedidos simultâneos de um contra o outro não deixam a plataforma sem gestor.
- **Auditoria:** `PLATFORM_ADMIN_INVITED`, `PLATFORM_ADMIN_INVITE_REVOKED`, `PLATFORM_ADMIN_GRANTED` e `PLATFORM_ADMIN_REVOKED` aparecem na trilha do gestor, sem o link.
- **Se o último gestor se perder** (e não houver outro para encerrar nem convidar), o único caminho é no banco: marcar `platform_admins.revoked_at` de quem restou e usar de novo o código de ativação em `/gestor/ativar`. Isso altera o banco de produção, que só o responsável faz pelo painel do Webflow; **não foi testado**. Por isso convém ter sempre dois gestores.
