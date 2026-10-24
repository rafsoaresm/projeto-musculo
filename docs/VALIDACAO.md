# Evidências de validação — papéis, convite e azul sólido, v0.3

Tudo abaixo foi executado **localmente** em 23/10/2026 (Node 22, SQLite local do Wrangler, Worker workerd via OpenNext, Chromium). Nenhum item comprova deploy, banco, domínio ou envio de e-mail no Webflow. A migration 0001 e a 0002 permanecem inalteradas; a 0003 é aditiva.

## Código e banco

- `npm run check`: ESLint e TypeScript sem erros e **106 testes, nenhum ignorado**: 17 de isolamento D1, 15 de identidade, 26 de periodização, 31 de papéis, 12 de contrato de navegação/fixtures e 5 de caminho de montagem.
- Os 31 testes de `tests/roles.test.ts` usam D1 real (Miniflare) com as três migrations e cobrem:
  - **Gestor:** ativação recusada sem token configurado, com token curto ou errado; exatamente um gestor sob concorrência; token inerte depois; e-mail e papel de proprietário não concedem o papel; revogado ou bloqueado perde o acesso na hora.
  - **Escopo do gestor:** vê organizações e contagens; o resultado serializado não contém nome de aluno; `studentsFor` e a criação de convite não funcionam para ele em nenhuma organização; bloqueio e restabelecimento com auditoria; não bloqueia a si mesmo, outro gestor ou quem não é da organização; a auditoria do gestor lista só ações de plataforma.
  - **Convite:** só o profissional com vínculo técnico ativo cria (dono sem atribuição, outro profissional, papel comercial, outro tenant e cliente são recusados); só o hash é guardado; novo link invalida o pendente; token malformado, desconhecido, expirado, revogado ou reutilizado não vincula; dois aceites simultâneos têm um único vencedor; identidade bloqueada não aceita; um aluno não ganha segundo login ativo; o cliente vê apenas o próprio registro e só na própria organização; revogar encerra o acesso na requisição seguinte; um cliente com duas organizações não as mistura.
  - **Áreas:** combinações de papéis por identidade, revogação de vínculo e distinção entre cliente revogado e login novo.
- Migrations 0001, 0002 e 0003 aplicadas no SQLite local por Wrangler (`db:migrate:local`); a saúde consulta `0003_roles_and_access`.
- `npm run build:cloud` (bundle OpenNext/Workers) concluído sem erro na raiz e em `/treinador`.

## Navegador (Playwright, Worker local)

15 cenários aprovados na raiz **e** 15 em `/treinador` (30 execuções), mais 15 em `/treinador` com a variável de build de caminho vazia (ver abaixo), sem testes ignorados: desktop e celular (Pixel 7) para cada cenário comum, e um cenário do gestor em projeto próprio, porque a ativação é única por banco (o `globalSetup` revoga gestores do **banco local** antes de cada rodada).

| Cenário | O que prova |
|---|---|
| Entrada, navegação e layout | Três áreas apresentadas, sem rolagem horizontal, módulo planejado mostra "Ainda não disponível", 404 em módulo inexistente, sem erro de página |
| Planejador (2 cenários) | Fases independentes, exportação do rascunho, invalidação do resultado, 12 fases — agora atrás de login |
| Conta, organização e aluno | Persistência após sair e entrar; outra organização não abre o aluno por URL; endereços antigos (`/alunos`) redirecionam e exigem sessão; `no-store` |
| Convite e cliente | Link gerado uma vez, cliente cria acesso e aceita, não alcança `/profissional`, `/gestor` nem o registro do profissional; link usado vira "Convite indisponível"; revogação encerra o acesso na requisição seguinte |
| Visitante e profissional comum | Áreas privadas devolvem a tela de entrada; profissional sem papel de gestor não vê o painel do gestor |
| Gestor | Ativação com código errado e certo; segundo gestor recusado; organização listada sem nome de aluno no HTML; bloquear e restabelecer valem na próxima requisição do profissional; ações na auditoria; sem área de profissional |
| Demonstração | Três visões, troca de área, prescrição bloqueada por triagem, revisão entregue sem botão de aprovar, treino do aluno sem persistência após recarregar, áreas reais continuam exigindo login |

O teste de convite encontrou um defeito real antes da entrega: o botão "Revogar acesso" virava botão de envio dentro do mesmo clique e revogava sem confirmação. Foi corrigido separando os elementos e o cenário passou a exigir a confirmação.

O smoke HTTP verifica páginas públicas, assets, o retorno das áreas privadas à tela de entrada, `/alunos` e a saúde, na raiz e em `/treinador`.

## Correção: cadastro falhava em produção (caminho de montagem)

**Sintoma (Webflow, `/app`):** "Não foi possível criar a conta. Confira os dados ou tente entrar." no cadastro profissional, com `AUTH_SECRET`, `AUTH_ORIGIN` e `PLATFORM_SETUP_TOKEN` já configurados.

**Causa:** o navegador montava o endereço da API com `NEXT_PUBLIC_BASE_PATH`, calculado a partir de `BASE_URL` no build deste repositório. No Webflow o builder define o mount path sozinho e `BASE_URL` não existe, então a variável ficou vazia e o formulário chamava `/api/auth/sign-up/email` na raiz do site (que não é o app) em vez de `/app/api/auth/...`. A resposta 404 caía na mensagem genérica. O mesmo valor vazio faria o link de convite sair sem `/app` e o cookie de sessão sair com caminho `/`.

**Reprodução local:** build em `/treinador` com `NEXT_PUBLIC_BASE_PATH` vazio (a condição de produção). O navegador enviou `POST /api/auth/sign-up/email` → **404** e exibiu a mesma mensagem do print.

**Correção:**
- Cadastro, entrada, saída e link de convite descobrem o mount path pela barra de endereço (`useMountPath()` + `mountPathOf`, com testes unitários) e não usam mais a variável de build; um teste impede a volta do padrão.
- O cookie de sessão usa o mount path efetivo do Next. A sondagem local mostrou que o handler recebe a URL sem o prefixo e `nextUrl.basePath` vazio, por isso `request.url`/`nextUrl` não foram usados. Cookie observado: `Path=/treinador`.
- O formulário distingue erro de dados (400/401/422) de falha do serviço de acesso (404, 403, 5xx), que deixa de culpar os dados digitados.

**Evidência local depois da correção:** com a variável de build vazia em `/treinador`, `POST /treinador/api/auth/sign-up/email` → 200, cookie com `Path=/treinador` e os 15 cenários de navegador passam (inclusive convite e saída); com a configuração normal, 15 em `/treinador` e 15 na raiz, mais smoke nos dois. **Não verificado em produção:** só se confirma após novo deploy, criando a conta em `/app/cadastro`.

## Interface

Capturas inspecionadas em desktop (1440px) e celular (390px) das três áreas reais, da entrada, do convite e da demonstração. Conferido: azul sólido sem gradiente em botões, menu, marca e destaques; tabelas viram cartões no celular; barra inferior com **Menu**; faixa de demonstração; ausência de rolagem horizontal. Contrastes calculados em [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md). Não houve auditoria por leitor de tela.

## Fronteiras da evidência

- Não validado: deploy na conta Webflow, DB provisionado, migrations remotas, `AUTH_SECRET`/`AUTH_ORIGIN`/`PLATFORM_SETUP_TOKEN` no ambiente, cookies HTTPS, limite de CPU, sobrescrita de `CF-Connecting-IP` pelo edge, e a leitura de `DEMO_MODE` no runtime remoto.
- O envio de e-mail não existe: o link de convite é copiado pelo profissional.
- O portal usa a mesma origem do painel. Isso é uma etapa intermediária e **não** atende à separação de origem exigida antes de dados reais de alunos.
- A demonstração usa dados fictícios e não é evidência de Avaliações, Prescrição, treino liberado, execução, Meu Site, cobrança ou afiliados: esses módulos continuam planejados.
- O cadastro de credenciais da biblioteca usa operações sequenciais em D1; falhas parciais ainda precisam de homologação antes de abrir o cadastro operacional. Os batches do domínio (inclusive convite e ativação do gestor) são atômicos e testados.
- O harness envia endereços de teste separados no cabeçalho de edge só no Worker local, para não compartilhar limites de tentativa entre execuções. O limitador é testado à parte contra SQLite.
- Continuam pendentes: e-mail verificado, recuperação de senha, convites e gestão de equipe, conceder o papel de gestor pela interface, auditoria de login e leitura, avaliação e prescrição persistidas, aprovação/entrega, Storage privado, jobs/PDF, editor, integrações e pagamentos.
