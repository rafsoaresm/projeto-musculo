# Acesso, papéis e convites — versão 0.3

## Fluxo entregue

`/cadastro` → conta profissional → `/organizacao` → espaço e profissional responsável → `/profissional` → `/profissional/alunos` → cadastro e detalhe do primeiro aluno. `/entrar` valida a senha; sair remove a sessão do banco. A lista e o detalhe persistem após novo login. Depois do login, `/acesso` encaminha cada conta para a sua área (gestor, profissional ou aluno).

**Aluno:** o profissional gera um link de uso único em `/profissional/alunos/<id>`; o aluno abre `/convite/<token>`, cria a conta (ou entra) e aceita. O vínculo nasce do token, nunca do e-mail. Detalhes em [ESTRUTURA-E-PAPEIS.md](ESTRUTURA-E-PAPEIS.md).

**Gestor da ferramenta:** conta comum, ativada em `/gestor/ativar` com `PLATFORM_SETUP_TOKEN`, uma única vez enquanto não houver gestor ativo.

Better Auth 1.7.12 gerencia credenciais e sessões. Senhas têm 12–128 caracteres e usam o hash da biblioteca. Sessões duram sete dias, com atualização após um dia; não há cache de sessão em cookie. Cookies são HttpOnly, SameSite=Lax, restritos ao mount path e Secure em HTTPS. Sessões expiradas/removidas são rejeitadas; cada operação de domínio reavalia bloqueio e membership/vínculo.

As rotas públicas de autenticação têm allowlist, método HTTP específico, checagem exata de Origin em POST e `private, no-store`. Os limites persistem no SQLite (10 tentativas de login e 5 cadastros por minuto por endereço). O endereço vem exclusivamente de `CF-Connecting-IP`; sua sobrescrita pelo edge deve ser confirmada na homologação Webflow. Sem esse header, usa-se um limite compartilhado. Não se confia em `X-Forwarded-For` enviado livremente.

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
- Recuperação de senha, envio de mensagens, MFA, convites e gestão de equipe ainda não estão disponíveis. O provedor de envio precisa ser selecionado antes dessas jornadas; não se simula e-mail enviado.
- Um espaço provisionado por identidade. Não há seletor de organizações nem provisionamento automático após revogação.
- A ferramenta não envia e-mails: o profissional copia o link do convite e o envia por um canal seguro. O token é mostrado uma única vez; só o hash fica no banco.
- O portal do aluno ainda usa a mesma origem do painel. Antes de dados reais de alunos, publique painel e portal em origens privadas separadas e sem scripts de marketing.
- Só há um gestor ativo por ativação; conceder o papel a outros gestores pela interface e recuperar o único gestor perdido são pendências.
- Auditoria cobre criação de organização/aluno, ativação do gestor, bloqueios, convites e revogação de acesso. Não é ainda uma trilha de login, leitura e alterações.
- Há testes de revogação no banco. O profissional revoga o acesso do aluno e o gestor bloqueia identidades pela interface; revogação de membros de equipe ainda é pendente.
- Drizzle/Better Auth usa operações sequenciais para credenciais porque D1 não aceita transações interativas. Testar recuperação de falhas parciais de cadastro antes de liberar acesso operacional. Batches do domínio são atômicos e têm teste de rollback.
- O planejador segue exportando rascunhos sem associá-los ao aluno. Avaliação, revisão, aprovação e entrega são a próxima fatia de atendimento.

Esta entrega permite experimentar os três papéis com dados fictícios em homologação; não fecha E1 nem o piloto operacional.
