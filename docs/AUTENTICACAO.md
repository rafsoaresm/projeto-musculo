# Acesso e primeiro aluno — versão 0.2

## Fluxo entregue

`/cadastro` → conta profissional → `/organizacao` → espaço e profissional responsável → `/alunos` → cadastro e detalhe do primeiro aluno. `/entrar` valida a senha; sair remove a sessão do banco. A lista e o detalhe persistem após novo login.

Better Auth 1.7.12 gerencia credenciais e sessões. Senhas têm 12–128 caracteres e usam o hash da biblioteca. Sessões duram sete dias, com atualização após um dia; não há cache de sessão em cookie. Cookies são HttpOnly, SameSite=Lax, restritos ao mount path e Secure em HTTPS. Sessões expiradas/removidas são rejeitadas; cada operação de domínio reavalia bloqueio e membership/vínculo.

As rotas públicas de autenticação têm allowlist, método HTTP específico, checagem exata de Origin em POST e `private, no-store`. Os limites persistem no SQLite (10 tentativas de login e 5 cadastros por minuto por endereço). O endereço vem exclusivamente de `CF-Connecting-IP`; sua sobrescrita pelo edge deve ser confirmada na homologação Webflow. Sem esse header, usa-se um limite compartilhado. Não se confia em `X-Forwarded-For` enviado livremente.

Server Actions validam novamente sessão e dados. Organização/usuário nunca vêm de campos do formulário. `createStudent` exige profissional com membership técnica ativa, cria a atribuição e registra auditoria no mesmo batch. IDs de outra organização não revelam o aluno.

## Configuração local

Execute `npm run auth:setup:local`. O script cria `.env.local` (Next dev, origem 127.0.0.1:3000) e `.dev.vars` (Worker preview, origem 127.0.0.1:8787), com segredo aleatório, permissão 0600 e sem imprimir o valor. Não sobrescreve arquivos existentes. Use exatamente essas origens nos testes; `localhost` e `127.0.0.1` são origens diferentes. Para portas alternativas, ajuste os arquivos locais ignorados.

O setup não repara variáveis faltantes em arquivos já existentes: complete `AUTH_SECRET` e `AUTH_ORIGIN` nesses arquivos se já forem usados por outra configuração. Não copie esses arquivos para Webflow/Git. O SQLite local de testes de navegador contém apenas os dados fictícios criados pelos testes.

## Webflow Cloud

Configure no ambiente privado do app:

| Variável | Valor |
|---|---|
| `AUTH_SECRET` | Segredo criptograficamente aleatório, independente por ambiente, mínimo 32 caracteres; sem prefixo NEXT_PUBLIC |
| `AUTH_ORIGIN` | Origem HTTPS exata, como `https://painel.example.com`, sem barra final/caminho |
| `BASE_URL` | Mount path no build, por exemplo `/treinador`; vazio na raiz |

O mount path precisa corresponder ao configurado no Webflow. `NEXT_PUBLIC_BASE_PATH` é derivado no build somente para URLs; não contém segredo. O builder Webflow também configura basePath/assetPrefix; conferir se ambos apontam para o mesmo caminho no deploy. O segredo e a origem são lidos de bindings/variáveis do servidor, nunca do host enviado pelo navegador. Sem configuração válida, o endpoint de autenticação responde 503, sem fallback público de segredo.

O DB continua nativo; não há URL de banco externo. Migrations 0001 e 0002 são necessárias. Em homologação, validar cadastro, login, cookies, CSRF, logout e tentativa de acessar um aluno de outra organização na URL real. O domínio do painel deve ser privado, separado de scripts de marketing.

## Limites desta fatia

- E-mails ainda não são verificados. Não autorizar convites, vínculos ou mesclagem de identidades por simples coincidência de e-mail.
- Recuperação de senha, envio de mensagens, MFA, convites e gestão de equipe ainda não estão disponíveis. O provedor de envio precisa ser selecionado antes dessas jornadas; não se simula e-mail enviado.
- Um espaço provisionado por identidade. Não há seletor de organizações nem provisionamento automático após revogação.
- Auditoria cobre criação de organização/aluno. Não é ainda uma trilha completa de login, leitura, alterações e revogações.
- Há testes de revogação no banco; interface administrativa de revogação ainda pendente.
- Drizzle/Better Auth usa operações sequenciais para credenciais porque D1 não aceita transações interativas. Testar recuperação de falhas parciais de cadastro antes de liberar acesso operacional. Batches do domínio são atômicos e têm teste de rollback.
- O planejador segue exportando rascunhos sem associá-los ao aluno. Avaliação, revisão, aprovação e entrega são a próxima fatia de atendimento.

Esta entrega permite experimentar o fluxo com dados fictícios em homologação; não fecha E1 nem o piloto operacional.
