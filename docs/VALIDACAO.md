# Evidências de validação — v0.8 (aprovação e entrega) sobre a base 0.3

Tudo abaixo foi executado **localmente** em 23/10/2026 (Node 22, SQLite local do Wrangler, Worker workerd via OpenNext, Chromium). Nenhum item comprova deploy, banco, domínio ou envio de e-mail no Webflow. As migrations 0001 a 0003 permanecem inalteradas; as 0004 a 0007 são aditivas.

## Fatia 0.8: aprovação, entrega e treino na área do aluno

Fecha o ciclo do piloto no que existe hoje: o profissional aprova, entrega, e o aluno vê **exatamente** a revisão entregue. Continua sem execução do treino pelo aluno, sem triagem e sem PDF.

- **Estados:** Rascunho, Estrutura pronta, Aprovada e Entregue, sempre para a frente e um passo por vez. Aprovar e entregar são atos do profissional com vínculo técnico ativo; nada é automático e nenhuma regra ou IA aprova ou libera.
- **Aprovação:** exige revisão pronta, **nenhum treino abaixo do alvo** (a pendência nunca é preenchida: o caminho é uma nova revisão que complete os exercícios ou ajuste o alvo) e a confirmação do **aviso de triagem**. Sem instrumento de triagem, o aviso diz "triagem não registrada" e que isso não significa ausência de riscos; a confirmação fica gravada como `approval_screening = NOT_RECORDED`, que é o que se sabia na hora e **não é liberação clínica**. Quando a triagem existir, o histórico continua legível.
- **Imutabilidade no banco (migration 0007):** gatilhos recusam qualquer alteração de conteúdo de uma revisão que saiu de rascunho, qualquer estado que não seja o passo seguinte, reescrever os fatos de aprovação e entrega e apagar revisão, além de inserir, alterar ou remover exercícios de revisão fechada. Valem para escrita direta no SQL, não só para o código. O `wrangler` que o Webflow usa no deploy aplicou a migration com os 7 gatilhos localmente.
- **Área do aluno (`/aluno/treino`, `/aluno`):** só revisões entregues, só do aluno com vínculo ativo do próprio login (os alunos vêm dos vínculos verificados, nunca do endereço), a mais recente de cada plano. Mostra fases (a atual em destaque), treinos e exercícios com a dose digitada. Rascunho, pronta e aprovada não aparecem; nota da biblioteca, autoria e dados internos não fazem parte do que é lido.
- **Testes de D1 (`tests/approval.test.ts`, 7):** gatilhos contra escrita direta; aprovação recusada abaixo do alvo, sem o aviso e fora do estado certo; quatro identidades de profissional sem vínculo, dono, comercial, aluno, gestor e outra organização recusadas; nova revisão a partir de uma entregue sem tocar a original; o aluno vê só entregues, não vê nada de outro aluno, de profissional, de gestor ou de estranho, perde o acesso ao revogar o vínculo ou bloquear a identidade, e a nova entrega substitui a anterior. Mutações deliberadas (aprovar abaixo do alvo, ler revisões não entregues, ignorar a revogação) fizeram os testes falharem.
- **Navegador (`tests/e2e/delivery.spec.ts`):** profissional monta o plano, aluno aceita o convite e não vê nada, aprovação exige o aviso, aprovada ainda não aparece, entregue aparece com a dose, nova revisão em rascunho não aparece, revogar fecha o treino. Desktop e celular, na raiz e em `/treinador`.
- **Limites:** não validado no Webflow. Sem execução pelo aluno, sem PDF, sem notificação ao aluno (nem e-mail: aguarda a AWS), sem desfazer entrega (uma entrega só é superada por outra), sem triagem. A mesma origem serve painel e portal, o que continua não atendendo à separação exigida antes de dados reais.

## Fatia 0.7: painel de Prescrição e cópia de mesociclo

Sem migration nova: usa as tabelas da 0004 a 0006.

- **Painel (`/profissional/prescricao`):** a revisão mais recente de cada plano dos alunos que o profissional alcança por vínculo técnico ativo, com rascunhos abertos primeiro. Mostra aluno, plano, revisão e estado, período, total de exercícios e **pendências**: quantos treinos estão abaixo do alvo. Não aprova nem libera nada. A visão geral ganhou "Planos em rascunho", e o passo "planejar o ciclo" passa a contar como concluído quando existe plano.
- **Pendência sem preencher:** abaixo do alvo continua sendo só uma contagem. O painel nunca completa exercícios.
- **Cópia de mesociclo:** copia os exercícios de uma fase para outra fase **sem nenhum exercício**, treino a treino sob a mesma letra, com novos IDs. Letras que a fase de destino não tem (por exemplo, C numa fase AB) não são forçadas em outro treino: a tela informa quais ficaram de fora. Destino com exercícios, origem vazia, fase igual ou inexistente, e revisão fechada são recusados.
- **Testes de D1:** 5 novos em `tests/prescription.test.ts` (21 no arquivo): o painel lista só a revisão mais nova, ordena rascunhos primeiro, conta exercícios e pendências, não mostra nada a quem não tem vínculo (oito identidades) e some quando o vínculo é revogado; a cópia de mesociclo cobre cópia com novos IDs, divisões diferentes, recusas e acesso.
- **Navegador:** o cenário de prescrição agora também copia um mesociclo inteiro, confere o painel e a visão geral. Desktop e celular, na raiz e em `/treinador`.
- **Limites:** não validado no Webflow. O painel mostra no máximo os 200 planos mais recentes. Sem arrastar e soltar, sem regeneração com diff, sem presets, sem aprovação ou entrega.

## Fatia 0.6: prescrição manual sobre o rascunho

O profissional escolhe cada exercício e digita cada valor, por mesociclo e por treino (as letras da divisão), dentro de uma revisão em rascunho. **Nada é sugerido, preenchido ou calculado**: sem presets, sem carga, sem geração, sem aprovação, sem entrega. O alvo de exercícios por treino é referência: abaixo do alvo aparece como pendência e nunca é completado.

- **Banco:** migration 0006 (`prescribed_exercises`), aditiva. Cada linha guarda um **instantâneo** do nome e do vídeo da biblioteca: editar ou arquivar um exercício da biblioteca não muda prescrição já feita, e o vídeo da prescrição pode ser trocado sem tocar a biblioteca (um link trocado fica "não revisado"). Séries, repetições, carga, cadência e descanso são texto livre curto (faixas e estratégias cabem); RIR mínimo e máximo são inteiros de 0 a 10 e o mínimo não passa o máximo; origem registrada (`PROFESSIONAL`; `SYSTEM` e `AI` ficam reservadas ao motor, que ainda não existe).
- **Repositório (`src/db/prescription.ts`):** toda operação exige uma revisão **em rascunho** de um plano cujo aluno o usuário alcança por vínculo técnico ativo, e o treino precisa existir na estrutura salva (letra da divisão, fase válida). Adicionar da biblioteca ou com nome próprio, editar (só os campos enviados mudam; `null` limpa), remover, reordenar (conjunto exato de IDs do treino), duplicar, trocar o exercício mantendo o que foi digitado e copiar um treino inteiro **só para um treino vazio**. Máximo de 30 por treino.
- **Estrutura × prescrição:** salvar a estrutura é **recusado** se removeria um treino que já tem exercícios (menos fases ou divisão sem aquela letra), com mensagem que manda remover antes; a checagem também está no SQL. Alterar só o alvo é permitido.
- **Revisões:** marcar como pronta congela estrutura e exercícios. A nova revisão leva os exercícios com **novos IDs**; editar a cópia não altera a original (testado).
- **Testes de D1 (`tests/prescription.test.ts`, 16):** recusa e nenhuma escrita para quem não tem vínculo (sete identidades, em todas as operações); revogação e bloqueio cortam na hora; instantâneo da biblioteca; exercício arquivado ou de outra organização não entra; treinos inexistentes; validação de todos os campos; teto por treino; edição parcial; reordenação inválida; remoção com lacuna; duplicar e trocar; copiar só para treino vazio; revisão fechada intocável; cópia independente; trava da estrutura; pendências por alvo; trilha de eventos sem conteúdo. Mutações deliberadas (aceitar edição fora do rascunho e remover a checagem de acesso) fizeram os testes falharem. O teste achou um defeito real na própria API (omitir o vídeo apagava o vídeo), corrigido com edição parcial.
- **Navegador (`tests/e2e/prescription.spec.ts`):** fluxo completo em desktop e celular, incluindo vídeo recusado, reordenar, duplicar, remover com confirmação, copiar treino, estrutura recusada com mensagem, revisão fechada sem nenhum controle de edição, nova revisão com os exercícios e original intacta.
- **Limites:** não validado no Webflow. Sem arrastar e soltar (sobe e desce por botão). Sem copiar mesociclo inteiro, sem regeneração com diff, sem presets: continuam planejados. Sem aprovação nem entrega, e a triagem segue sem instrumento. A condição de corrida entre checar a revisão e gravar é coberta no SQL, mas só verificada pelo caminho sequencial.

## Fatia 0.5a: biblioteca de exercícios

Biblioteca do sistema com os **64 exercícios do documento mestre** (seção 50: nome, categoria, nível e o link inicial de vídeo) e biblioteca própria de cada organização. Nada além disso foi acrescentado: não há músculos, equipamentos, progressões nem vídeos curados, porque o documento não os fornece.

- **Banco:** migration 0005 (`exercises`), aditiva. Linhas do sistema têm `organization_id` nulo e IDs estáveis `sys-001` a `sys-064`. A chave `name_key` (minúsculas, acentos mantidos, espaços colapsados) é calculada no código porque o `lower()` do SQLite ignora acentos; ela decide duplicidade e busca. Índice único parcial: dois exercícios ativos não repetem o nome na mesma biblioteca; uma cópia de exercício do sistema pode manter o nome.
- **Vídeo:** os links do documento são buscas do YouTube e ficam marcados como **link de busca, não vídeo revisado**. Só YouTube e Vimeo, https, sem usuário/senha/porta, até 500 caracteres; outros provedores dependem de política definida. "Vídeo revisado" é decisão do profissional: nunca no cadastro, só ao salvar de novo com o mesmo link e a caixa marcada; trocar o link desfaz a revisão; link de busca nunca é revisado.
- **Acesso (`src/db/exercises.ts`):** só membros técnicos ativos (dono, gerente, técnico) leem a biblioteca; sistema é somente leitura; editar, arquivar e restaurar valem só para exercícios da própria organização. Membro comercial ou financeiro, login de aluno, gestor da plataforma, identidade bloqueada e vínculo revogado não veem nada. Editar um exercício não reescreve prescrição: a prescrição guarda o próprio nome e vídeo.
- **Testes de D1 (`tests/exercises.test.ts`, 9):** seed íntegro (64, categorias 5/16/14/8/9/8/4, todos como link de busca); acesso por papel; revogação e bloqueio cortam na hora; validação recusa categoria inventada, `http`, `javascript:`, host fora da lista, usuário/senha, porta, link e notas enormes e campo extra; duplicidade ignora caixa e acento; estados do vídeo; arquivar/restaurar; cópia do sistema; busca com `%` e `_` como texto. Mutações deliberadas (liberar o papel comercial; remover a visibilidade por organização) fizeram os testes falharem. O filtro de organização no `UPDATE` é defesa em profundidade: o `find` anterior já barra outra organização, então nenhuma mutação externa o alcança.
- **Navegador (`tests/e2e/library.spec.ts`):** 64 exercícios, filtros, cópia, edição, link recusado, criação, revisão de vídeo em duas gravações, duplicidade, outra organização sem acesso nem por endereço, arquivar e restaurar. Desktop e celular.
- **Defeito encontrado e corrigido nesta fatia:** o React 19 reinicia um formulário depois da ação. Isso apagava o texto digitado quando o servidor recusava, e devolvia o seletor de categoria à primeira opção depois de salvar. Os formulários passaram a enviar por `onSubmit` (inclusive os de espaço e de aluno, que tinham a perda de texto em erro); o teste de navegador confere a categoria depois de salvar.
- **Limites:** não validado no Webflow. A biblioteca do sistema não tem tela de gestão: corrigir ou ampliar o seed exige nova migration (a biblioteca técnica do gestor continua planejada). Os vídeos continuam sem curadoria.

## Fatia 0.4: planos de periodização salvos

Cobre **só a estrutura do ciclo** (fases, semanas, sessões, divisão e calendário), salva por aluno em revisões. Não há exercícios, prescrição, aprovação, entrega nem PDF.

- **Banco:** migration 0004 (`training_plans`, `plan_revisions`, `training_plan_events`). O ciclo de vida completo (`DRAFT`, `REVIEW_REQUIRED`, `READY`, `APPROVED`, `DELIVERED`, `ARCHIVED`) já consta no `CHECK`, mas só `DRAFT` e `READY` são alcançáveis hoje. Um índice parcial garante no máximo **um rascunho aberto por plano**.
- **Repositório (`src/db/plans.ts`):** cada consulta exige vínculo técnico ativo com o aluno (organização, atribuição, membership técnico, revogação e bloqueio). O cronograma é **recalculado no servidor** a partir da entrada validada; o cliente nunca envia um cronograma. Conteúdo só muda enquanto `DRAFT` (todo `UPDATE` filtra o estado). `READY` não é aprovação: copia-se para uma nova revisão com novo ID, sem reescrever a anterior.
- **Testes de D1 (`tests/plans.test.ts`, 9):** recusa e nenhuma escrita para profissional sem atribuição, dono sem atribuição, membro comercial, login do próprio aluno, gestor da plataforma, profissional de outra organização, ID de aluno de outra organização e identidade desconhecida (criar, listar, abrir, salvar, marcar pronto, copiar); entrada e título inválidos não gravam nada; edição só em rascunho; cópia preserva o original; dois pedidos de nova revisão em paralelo geram um único rascunho; trilha de eventos sem conteúdo do plano; revogar atribuição, membership ou identidade corta leitura e escrita na hora. Duas mutações deliberadas (remover a checagem de acesso e o filtro de estado) fizeram os testes falharem.
- **Navegador (`tests/e2e/plans.spec.ts`):** nome e data obrigatórios; salvar; reabrir com os valores; alterar para 6 fases com aviso de alterações não salvas e "pronta" bloqueado até salvar; marcar estrutura pronta fecha a edição e diz que não é aprovação; nova revisão abre em rascunho; a lista do aluno mostra as duas; a revisão 1 continua validada; outra organização recebe "Página não encontrada." pelo endereço do plano. Executado em desktop e celular, na raiz e em `/treinador`.
- **Interface:** capturas conferidas em desktop e celular (lista no aluno, novo plano, rascunho, revisão fechada). Datas do plano são dias de calendário e aparecem em UTC, sem deslocar para o dia anterior.
- **Limites:** nada foi validado no Webflow. A migration 0004 só chega ao banco remoto no próximo deploy; até lá a saúde (`/api/health`) responderia 503, porque exige o registro da última migration. O índice parcial e as chaves compostas rodaram no SQLite local/Miniflare, não no D1 remoto. Não há gatilho no banco que congele revisões `APPROVED`/`DELIVERED`: isso deve entrar com a migration que criar a aprovação, junto da transição que a faz.

## Código e banco

- `npm run check`: ESLint e TypeScript sem erros e **152 testes, nenhum ignorado**: 17 de isolamento D1, 15 de identidade, 26 de periodização, 31 de papéis, 12 de contrato de navegação/fixtures, 5 de caminho de montagem, 9 de planos salvos, 9 de biblioteca, 21 de prescrição e 7 de aprovação e entrega.
- Os 31 testes de `tests/roles.test.ts` usam D1 real (Miniflare) com as três migrations e cobrem:
  - **Gestor:** ativação recusada sem token configurado, com token curto ou errado; exatamente um gestor sob concorrência; token inerte depois; e-mail e papel de proprietário não concedem o papel; revogado ou bloqueado perde o acesso na hora.
  - **Escopo do gestor:** vê organizações e contagens; o resultado serializado não contém nome de aluno; `studentsFor` e a criação de convite não funcionam para ele em nenhuma organização; bloqueio e restabelecimento com auditoria; não bloqueia a si mesmo, outro gestor ou quem não é da organização; a auditoria do gestor lista só ações de plataforma.
  - **Convite:** só o profissional com vínculo técnico ativo cria (dono sem atribuição, outro profissional, papel comercial, outro tenant e cliente são recusados); só o hash é guardado; novo link invalida o pendente; token malformado, desconhecido, expirado, revogado ou reutilizado não vincula; dois aceites simultâneos têm um único vencedor; identidade bloqueada não aceita; um aluno não ganha segundo login ativo; o cliente vê apenas o próprio registro e só na própria organização; revogar encerra o acesso na requisição seguinte; um cliente com duas organizações não as mistura.
  - **Áreas:** combinações de papéis por identidade, revogação de vínculo e distinção entre cliente revogado e login novo.
- Migrations 0001 a 0007 aplicadas no SQLite local por Wrangler (`db:migrate:local`); a saúde consulta `0007_approval_and_delivery`.
- `npm run build:cloud` (bundle OpenNext/Workers) concluído sem erro na raiz e em `/treinador`.

## Navegador (Playwright, Worker local)

23 execuções aprovadas na raiz **e** 23 em `/treinador` (46), sem testes ignorados (a correção do cadastro, abaixo, foi validada antes com 15 execuções e a variável de build de caminho vazia): desktop e celular (Pixel 7) para cada cenário comum, e um cenário do gestor em projeto próprio, porque a ativação é única por banco (o `globalSetup` revoga gestores do **banco local** antes de cada rodada).

| Cenário | O que prova |
|---|---|
| Entrada, navegação e layout | Três áreas apresentadas, sem rolagem horizontal, módulo planejado mostra "Ainda não disponível", 404 em módulo inexistente, sem erro de página |
| Planejador (2 cenários) | Fases independentes, exportação do rascunho, invalidação do resultado, 12 fases — agora atrás de login |
| Biblioteca de exercícios | 64 do sistema, filtros, cópia, criação, revisão de vídeo em duas gravações, isolamento entre organizações (seção da fatia 0.5a) |
| Aprovação, entrega e treino do aluno | Aviso de triagem obrigatório, aprovar, entregar, o aluno só vê o entregue, nova revisão em rascunho invisível, revogação fecha (seção da fatia 0.8) |
| Prescrição manual | Adicionar, editar, reordenar, duplicar, remover, copiar treino, estrutura recusada, revisão fechada, nova revisão com os exercícios (seção da fatia 0.6) |
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
- Continuam pendentes: e-mail verificado, recuperação de senha, convites e gestão de equipe, conceder o papel de gestor pela interface, auditoria de login e leitura, avaliação e triagem, execução do treino pelo aluno, Storage privado, jobs/PDF, editor, integrações e pagamentos.
