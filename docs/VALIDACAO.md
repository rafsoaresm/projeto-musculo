# Evidências de validação — v0.4 (planos salvos) sobre a base 0.3

Tudo abaixo foi executado **localmente** em 23/10/2026 (Node 22, SQLite local do Wrangler, Worker workerd via OpenNext, Chromium). Nenhum item comprova deploy, banco, domínio ou envio de e-mail no Webflow. As migrations 0001, 0002 e 0003 permanecem inalteradas; a 0004 é aditiva.

## Fatia 0.4: planos de periodização salvos

Cobre **só a estrutura do ciclo** (fases, semanas, sessões, divisão e calendário), salva por aluno em revisões. Não há exercícios, prescrição, aprovação, entrega nem PDF.

- **Banco:** migration 0004 (`training_plans`, `plan_revisions`, `training_plan_events`). O ciclo de vida completo (`DRAFT`, `REVIEW_REQUIRED`, `READY`, `APPROVED`, `DELIVERED`, `ARCHIVED`) já consta no `CHECK`, mas só `DRAFT` e `READY` são alcançáveis hoje. Um índice parcial garante no máximo **um rascunho aberto por plano**.
- **Repositório (`src/db/plans.ts`):** cada consulta exige vínculo técnico ativo com o aluno (organização, atribuição, membership técnico, revogação e bloqueio). O cronograma é **recalculado no servidor** a partir da entrada validada; o cliente nunca envia um cronograma. Conteúdo só muda enquanto `DRAFT` (todo `UPDATE` filtra o estado). `READY` não é aprovação: copia-se para uma nova revisão com novo ID, sem reescrever a anterior.
- **Testes de D1 (`tests/plans.test.ts`, 9):** recusa e nenhuma escrita para profissional sem atribuição, dono sem atribuição, membro comercial, login do próprio aluno, gestor da plataforma, profissional de outra organização, ID de aluno de outra organização e identidade desconhecida (criar, listar, abrir, salvar, marcar pronto, copiar); entrada e título inválidos não gravam nada; edição só em rascunho; cópia preserva o original; dois pedidos de nova revisão em paralelo geram um único rascunho; trilha de eventos sem conteúdo do plano; revogar atribuição, membership ou identidade corta leitura e escrita na hora. Duas mutações deliberadas (remover a checagem de acesso e o filtro de estado) fizeram os testes falharem.
- **Navegador (`tests/e2e/plans.spec.ts`):** nome e data obrigatórios; salvar; reabrir com os valores; alterar para 6 fases com aviso de alterações não salvas e "pronta" bloqueado até salvar; marcar estrutura pronta fecha a edição e diz que não é aprovação; nova revisão abre em rascunho; a lista do aluno mostra as duas; a revisão 1 continua validada; outra organização recebe "Página não encontrada." pelo endereço do plano. Executado em desktop e celular, na raiz e em `/treinador`.
- **Interface:** capturas conferidas em desktop e celular (lista no aluno, novo plano, rascunho, revisão fechada). Datas do plano são dias de calendário e aparecem em UTC, sem deslocar para o dia anterior.
- **Limites:** nada foi validado no Webflow. A migration 0004 só chega ao banco remoto no próximo deploy; até lá a saúde (`/api/health`, agora 0.4.0) responderia 503, porque exige o registro `0004_training_plans`. O índice parcial e as chaves compostas rodaram no SQLite local/Miniflare, não no D1 remoto. Não há gatilho no banco que congele revisões `APPROVED`/`DELIVERED`: isso deve entrar com a migration que criar a aprovação, junto da transição que a faz.

## Código e banco

- `npm run check`: ESLint e TypeScript sem erros e **115 testes, nenhum ignorado**: 17 de isolamento D1, 15 de identidade, 26 de periodização, 31 de papéis, 12 de contrato de navegação/fixtures, 5 de caminho de montagem e 9 de planos salvos.
- Os 31 testes de `tests/roles.test.ts` usam D1 real (Miniflare) com as três migrations e cobrem:
  - **Gestor:** ativação recusada sem token configurado, com token curto ou errado; exatamente um gestor sob concorrência; token inerte depois; e-mail e papel de proprietário não concedem o papel; revogado ou bloqueado perde o acesso na hora.
  - **Escopo do gestor:** vê organizações e contagens; o resultado serializado não contém nome de aluno; `studentsFor` e a criação de convite não funcionam para ele em nenhuma organização; bloqueio e restabelecimento com auditoria; não bloqueia a si mesmo, outro gestor ou quem não é da organização; a auditoria do gestor lista só ações de plataforma.
  - **Convite:** só o profissional com vínculo técnico ativo cria (dono sem atribuição, outro profissional, papel comercial, outro tenant e cliente são recusados); só o hash é guardado; novo link invalida o pendente; token malformado, desconhecido, expirado, revogado ou reutilizado não vincula; dois aceites simultâneos têm um único vencedor; identidade bloqueada não aceita; um aluno não ganha segundo login ativo; o cliente vê apenas o próprio registro e só na própria organização; revogar encerra o acesso na requisição seguinte; um cliente com duas organizações não as mistura.
  - **Áreas:** combinações de papéis por identidade, revogação de vínculo e distinção entre cliente revogado e login novo.
- Migrations 0001 a 0004 aplicadas no SQLite local por Wrangler (`db:migrate:local`); a saúde consulta `0004_training_plans`.
- `npm run build:cloud` (bundle OpenNext/Workers) concluído sem erro na raiz e em `/treinador`.

## Navegador (Playwright, Worker local)

17 execuções aprovadas na raiz **e** 17 em `/treinador` (34), sem testes ignorados (a correção do cadastro, abaixo, foi validada antes com 15 execuções e a variável de build de caminho vazia): desktop e celular (Pixel 7) para cada cenário comum, e um cenário do gestor em projeto próprio, porque a ativação é única por banco (o `globalSetup` revoga gestores do **banco local** antes de cada rodada).

| Cenário | O que prova |
|---|---|
| Entrada, navegação e layout | Três áreas apresentadas, sem rolagem horizontal, módulo planejado mostra "Ainda não disponível", 404 em módulo inexistente, sem erro de página |
| Planejador (2 cenários) | Fases independentes, exportação do rascunho, invalidação do resultado, 12 fases — agora atrás de login |
| Planos salvos | Salvar, reabrir, marcar pronto, nova revisão e isolamento entre organizações (detalhes na seção da fatia 0.4) |
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
- Continuam pendentes: e-mail verificado, recuperação de senha, convites e gestão de equipe, conceder o papel de gestor pela interface, auditoria de login e leitura, avaliação e prescrição persistidas (só a estrutura do ciclo é salva), aprovação/entrega, Storage privado, jobs/PDF, editor, integrações e pagamentos.
