# Roadmap de implementação

O escopo completo está em [`referencias/02-ROADMAP-E-HANDOFF.md`](referencias/02-ROADMAP-E-HANDOFF.md). O pedido atual substitui Vercel por Webflow Cloud e PostgreSQL/Supabase por **SQLite nativo do Webflow**. Os anexos históricos não devem reintroduzir provedores descartados.

As pendências de todas as frentes (o que depende do responsável, do advogado e do técnico, o que se constrói agora e o que espera) estão em [`PENDENCIAS.md`](PENDENCIAS.md); este roadmap conta o que foi entregue.

| Épico | Estado | Critério restante |
|---|---|---|
| E0 — viabilidade | Configuração Next/OpenNext e binding DB nativo | Deploy na conta, múltiplos hosts, login, Storage privado, job/PDF e Puck |
| E1 — fundação | Conta/sessão, organização, aluno, autorização e auditoria em SQLite. **Três áreas por papel** (gestor, profissional, aluno), ativação única do gestor, bloqueio de acesso e convite de aluno de uso único. **Minha conta** com troca de senha e encerramento das outras sessões (0.18). **Aceite único dos termos ao aderir** (0.20), com versão e hash gravados, e **texto editável pelo gestor, com versões e histórico** (0.24), **pedidos do titular com prazo e fotos apagadas a pedido** (0.25), **fotos que dependem da autorização do próprio aluno**, que ele autoriza ou retira em Minha conta (0.21 e 0.22), **"Baixar meus dados"** (0.28): a cópia do que a ferramenta mostra ao aluno, gerada na hora, **Configurações** (0.29): nome do espaço e nome de exibição, **rascunho dos termos** (0.30) **verificação em duas etapas**, opcional, com aplicativo autenticador, para profissional e gestor (0.31), e **aparelhos conectados e entradas recentes** em Minha conta (0.32) | Revisão jurídica do texto de aceite, cópia do registro técnico do profissional (hoje respondida à mão), E-mail verificado, **configurar o e-mail para a recuperação de senha** (construída na 0.26), convites e gestão de equipe, homologação remota |
| E2 — atendimento | Planejador determinístico e exportação. **Planos de periodização salvos por aluno**, com revisões e estado Rascunho / Estrutura pronta (0.4). **Biblioteca de exercícios** com o seed de 64 do documento mestre e biblioteca por organização (0.5a). **Prescrição manual** por mesociclo sobre o rascunho (0.6), com painel de pendências e cópia de mesociclo (0.7). **Aprovação e entrega** com imutabilidade no banco (0.8). **Ficha do aluno** (0.9). **Avaliações com triagem e indicadores** (0.10), ligadas à aprovação e à entrega. **PDF do plano entregue** (0.11). **Postura e movimento** nas avaliações (0.12), sem fotos. **Evolução das avaliações** (0.13): séries dos indicadores e comparação. **Fotos de postura** no Object Storage do Webflow (0.14). **Execução do treino pelo aluno** (0.15): o que o aluno fez, com leitura e relato de dor para o profissional. **Registros por semana, percentual dos previstos com registro e carga por exercício** (0.16 e 0.19), só leitura | Anotação sobre a imagem, exclusão de foto a pedido do titular, geração com pendências; conferir o instrumento de triagem com o responsável técnico |
| E3 — sites/CRM | Parcial: **Serviços e Leads** (0.33): funil, linha do tempo, duplicidade e **conversão idempotente em aluno**; **Meu Site** (0.34 e 0.35): blocos tipados, rascunho com revisão, prévia, versões imutáveis, publicar e tirar do ar, página pública em `/s/<endereço>` e, na 0.35, o **editor visual de arrastar e soltar** (colunas, texto direto na página, desfazer, camadas, cor e aparência) | Domínio próprio e TLS (E0), imagens, mapa do site e canônico, salvamento automático, formulário que gera lead (0.36, fechado até J8 e J12) |
| E4 — portal | Parcial: convite de uso único, área do aluno, **treino entregue** (0.8), **registro da execução** (0.15) e **evolução do próprio aluno** (0.17) e **check-in** (0.23) | Origem privada separada, documentos e mensagens; fecha piloto operacional |
| E5 — gestão/marketing | Parcial: o CRM começou em E3 (0.33). Agenda, contratos, recebimentos e conectores não existem | Tarefas e lembretes, mensagens, agenda, contratos, recebimentos (R4) e conectores de anúncios (precisam de origem separada, R3) |
| E6 — SaaS/afiliados | Planejado | Inbox/outbox, conciliação, recorrência, ajustes e repasses |
| E7 — evoluções | Planejado | RAG com armazenamento compatível, progressão assistida e booking |

## Fatia entregue: editor visual do Meu Site (0.35)

1. Implementado (sem migration): o usuário indicou, com um protótipo e um handoff (`docs/referencias/prototipo-editor-drag-drop.html` e `HANDOFF-EDITOR-DRAG-DROP.md`), que esperava o editor **visual, de arrastar e soltar**. Em `/profissional/meu-site`, "Abrir o editor visual" abre uma janela sobre a tela inteira: biblioteca de blocos e camadas à esquerda, **a página de verdade** no meio (o mesmo componente da prévia e da página pública) e as propriedades do que está selecionado à direita. Arrastar da biblioteca para a página, mover pela alça, **duas colunas** que recebem título, parágrafo e botão, escrever no texto com dois cliques, desfazer e refazer, computador e celular, prévia, salvar e publicar.
2. Princípio: **o contrato continua sendo a fonte da verdade.** O documento passou à versão 2 (sobre mim, depoimento com autorização, indicadores, 2 colunas, título, parágrafo, botão, etiqueta, cor e aparência de uma lista fechada) e **a versão 1 continua sendo lida**; nada de HTML, nada de link livre (os botões só levam a WhatsApp, e-mail ou Instagram), nada de imagem. O banco, a publicação e a página pública não mudaram.
3. **Decisão:** o editor é próprio, sem Puck (ver `ESTRUTURA-E-PAPEIS.md`). O handoff recomendava o Puck; a decisão pode ser revista, porque a mudança ficaria só na camada de tela.
4. **Em aberto:** salvamento automático; arrastar com o dedo; auditoria de leitor de tela e teclado; Firefox e Safari; imagens (B20, B21).

## Fatia anterior: Meu Site (0.34)

1. Implementado: migration 0024 (`sites`, `site_drafts`, `site_releases`, `site_published`). Em `/profissional/meu-site` o proprietário ou a gestão monta a página com blocos (destaque, texto, serviços, perguntas frequentes e chamada para contato), salva o rascunho, confere a prévia e **publica**: a versão é imutável e o ponteiro do que está no ar muda no mesmo passo. Qualquer pessoa abre `/s/<endereço>`; dá para tirar do ar, voltar a uma versão e mudar o endereço (com o site fora do ar).
2. Princípio: **publicar é um ato à parte** (não é entregar treino, nem aprovar avaliação, nem confirmar pagamento) e o que está no ar só muda quando se publica de novo. O documento só tem texto e três contatos; os únicos links da página nascem desses contatos. **Sem formulário, imagem, pixel nem GTM**: a página divide a origem com o painel (R3) e por isso não carrega nada de terceiros.
3. **Em aberto:** domínio próprio, TLS e vários hosts (E0); imagens; mapa do site, canônico e dados estruturados; várias páginas e modelos; a regra de publicidade do profissional (J13). O editor de arrastar e soltar veio na 0.35. **Próxima fatia, 0.36:** o formulário público que gera lead, **fechado por padrão** até J8 e J12.

## Fatia anterior: serviços e leads (0.33)

1. Implementado: migration 0023 (`service_offerings`, `leads`, `lead_events`). Em `/profissional/servicos` e `/profissional/leads` o profissional cadastra o que vende e registra os interessados (nome, contato, origem, serviço), move cada um pelo funil (novo, em contato, avaliação ou conversa, proposta, contratado, ou perdido com motivo), anota, corrige e apaga a pedido, e **converte um lead contratado em aluno** sem duplicar quem já é aluno seu.
2. Princípio: um lead **não é** um aluno e não recebe dado de saúde; o proprietário, a gestão e o comercial trabalham os leads, o técnico não. Converter é um ato à parte, idempotente, e congela o lead com a origem. Contratar um lead não libera treino, não aprova avaliação e não calcula comissão.
3. **Próximas fatias de E3 e E5, em ordem, cada uma só quando a anterior estiver no ar:**
   - **0.34, Meu Site (entregue):** documento de blocos tipados (sem HTML nem JavaScript livres, com `schemaVersion` e `revision`), rascunho com trava de revisão, prévia sem cache e com `noindex`, publicação como release imutável com ponteiro trocado de forma atômica, e a página pública sob o endereço do app. **Sem domínio próprio e sem pixels ou GTM** até haver prova no Webflow Cloud de vários hosts e TLS (E0) e a origem privada do portal (R3). Editor por formulário e lista de blocos; arrastar e soltar (Puck) só depois de validar API, licença e versão no ambiente.
   - **0.35, Editor visual do Meu Site (entregue):** o editor de arrastar e soltar sobre o contrato do 0.34 (versão 2 do documento, versão 1 ainda lida), sem migration.
   - **0.36, Formulário público que gera lead:** `leads` com origem "Site" e a página de origem; organização resolvida pelo servidor a partir do site publicado (nunca do corpo); limite por endereço, campo-isca e tamanho; **fechado por padrão** (como as fotos) até o aviso de privacidade público (J8) e o texto do formulário (J12).
   - **E5, depois:** tarefas e lembretes por lead, mensagens, agenda, contratos e recebimentos do profissional (receita do profissional continua separada do SaaS e das comissões), conectores de anúncios com `eventId` compartilhado (exigem origem separada) e rodízio entre profissionais.
4. **Em aberto:** a base legal e o aviso a quem vira lead (J12); preço dos serviços (R4); aviso por e-mail de um lead novo (D2, depende de R1).

## Fatia anterior: aparelhos conectados e entradas recentes (0.32)

1. Implementado: migration 0022 (um gatilho que grava `SIGN_IN` toda vez que uma sessão nasce, e um índice). Em "Minha conta" do profissional, do aluno e do gestor, a pessoa vê onde a conta está aberta (nome curto do navegador, quando entrou, até quando vale), o aparelho atual marcado, **desconecta um aparelho específico** e lê as 10 últimas entradas. Antes só existia "desconectar todos os outros", sem mostrar quais eram.
2. Princípio: nada novo é guardado sobre a pessoa além da data e da hora de cada entrada; o IP e o texto do navegador continuam só na sessão e **nunca chegam à página** (só o nome curto). O token da sessão nunca é lido. Desconectar repete, na mesma instrução, de quem é a sessão, que não é a que pede e que o login não está bloqueado.
3. **Em aberto:** falha de login e leitura dos dados do aluno pelo profissional seguem sem registro (B9); a pergunta ao advogado sobre registros de acesso e prazo (J11, J9); as entradas anteriores à 0.32 não existem.

## Fatia anterior: verificação em duas etapas (0.31)

1. Implementado: migration 0021 (`auth_two_factor` e a marca `auth_user.two_factor_enabled`, mais um gatilho que grava a trilha). Em `/profissional/conta` e na nova `/gestor/conta`, a pessoa liga uma segunda etapa com um aplicativo autenticador (TOTP): QR, chave e 10 códigos de recuperação mostrados uma vez, e só vale depois de digitar um código. Ao entrar, a senha sozinha não cria sessão; a tela pede o código do aplicativo ou um de recuperação. Desligar e gerar novos códigos pedem a senha. O gestor redefine a etapa de quem perdeu o celular e os códigos (a pessoa é desconectada e volta só com a senha), com duas linhas na trilha.
2. Princípio: **opcional**, sem tornar nenhuma conta mais fraca (quem não liga continua como antes) e sem novo canal de recuperação por conta própria: não há código por e-mail nem por SMS; só cinco rotas da biblioteca estão abertas. O segredo e os códigos ficam cifrados. A redefinição depende de o gestor confirmar a pessoa por outro canal, e a tela diz isso.
3. **Em aberto:** obrigar o gestor (R11); o aluno não tem a tela; o último gestor sem celular e sem códigos só se resolve no banco (B16); aviso por e-mail das mudanças (D2, depende de R1); política de senha contra vazamentos (B11); conferência com um aplicativo autenticador de verdade (C10).

## Fatia anterior: rascunho dos termos (0.30)

1. Implementado: migration 0020 (`terms_drafts`). Em `/gestor/termos` o texto em edição pode ser guardado no servidor: um rascunho por público, compartilhado entre gestores, com trava de revisão, que se descarta com confirmação e se apaga sozinho quando o texto é publicado. Antes, fechar a página perdia a edição. O editor avisa quando há alterações não salvas e pergunta antes de recarregar, fechar ou seguir um link da página.
2. Princípio: um rascunho **não é** uma versão: não muda o texto em vigor nem o aceite de ninguém. Com mais de um gestor, salvar um rascunho novo e **publicar** conferem, na mesma instrução, a versão em vigor e o rascunho que o editor carregou; se outro gestor publicou ou salvou algo diferente, nada é gravado e a tela diz por quê.
3. **Em aberto:** voltar/avançar do navegador não pergunta; a troca das frases que deixaram de ser verdadeiras no texto aprovado (R10) e a do e-mail (R2) dependem do advogado e do responsável.

## Fatia anterior: Configurações do profissional (0.29)

1. Implementado, sem migration: em `/profissional/configuracoes` o proprietário corrige o nome do espaço, cada profissional corrige o próprio nome de exibição e uma lista só de leitura mostra quem tem acesso (sem e-mail e sem quem foi revogado ou bloqueado). Antes, um erro de digitação no cadastro não tinha como ser corrigido, e esses nomes aparecem para os alunos (convite, área do aluno, PDF). Cada mudança fica na trilha (quem e quando, nunca os nomes).
2. Princípio: o espaço e a pessoa vêm da sessão; o comando de escrita repete o papel, o vínculo e o login ativo. **Mudar o nome de exibição muda como as entregas já feitas dizem quem as entregou** (o nome é lido na hora); o conteúdo delas não muda, e a tela avisa isso antes de salvar.
3. **Em aberto:** equipe, papéis e permissões pela interface (dependem de e-mail verificado, R1); guardar o nome de quem entregou **no momento da entrega** e o histórico de nomes anteriores (B15); fuso horário e CREF não foram acrescentados (nada os lê hoje; o CREF depende de T7).

## Fatia anterior: "Baixar meus dados" (0.28)

1. Implementado, sem migration: em `/aluno/conta` o aluno baixa um arquivo JSON, gerado na hora, com o que a ferramenta já mostra a ele: dados de acesso, aceites dos termos, check-ins, treinos que registrou, o treino entregue (a versão mais recente de cada plano) e os pedidos que fez. Vale para todos os vínculos do login e só para eles. Cada geração fica na trilha (quando, nunca o conteúdo) e há no máximo 6 por hora e login; a lista que passa de 2.000 entradas é cortada e o arquivo diz que foi cortada.
2. Princípio: **não é a resposta ao pedido de cópia**. A ficha, as avaliações, as fotos e as anotações do profissional sobre cada registro ficam de fora, e o arquivo e a tela dizem isso com todas as letras; para receber também isso o aluno continua fazendo o pedido, que o profissional responde.
3. **Em aberto:** a cópia do registro técnico do profissional, que depende de decisão jurídica sobre o que se entrega ao titular (J1, J4); um formato legível para quem não lê JSON (PDF ou página); o aviso por e-mail de que o arquivo foi gerado.

## Fatia anterior: mais de um gestor, por convite de uso único (0.27)

1. Implementado: migration 0019. Em `/gestor/gestores` um gestor convida outro por um link de uso único de 48 horas (só o hash fica no banco); o papel nasce do link e da conta de quem aceita, nunca do e-mail. Um gestor encerra o acesso de outro, nunca o próprio. O gestor também vê, só em contagens, os **pedidos de titulares em aberto e atrasados** por organização (visão geral, lista e detalhe).
2. Princípio: a plataforma não pode depender de uma só pessoa nem entregar um papel de gestão por um e-mail não verificado.
3. **Em aberto:** se o único gestor se perder o caminho é no banco e não foi testado (`docs/AUTENTICACAO.md`); sem aviso por e-mail dos convites (depende do e-mail configurado).

## Fatia anterior: recuperação de senha por e-mail, desligada até haver credenciais (0.26)

1. Implementado: migration 0018. "Esqueci minha senha" e "Nova senha" com a biblioteca de autenticação, envio pelo Amazon SES (assinatura SigV4 própria, conferida contra os exemplos da AWS), limite por IP, por endereço e por hora, resposta igual para quem tem e quem não tem conta, link de 1 hora e uso único que encerra todas as sessões. **Só liga com as cinco variáveis da AWS completas**; sem elas, nada aparece e os endpoints respondem 404. Passo a passo em `docs/WEBFLOW-CLOUD.md`.
2. Princípio: o que não se pode confirmar não se afirma. **Nunca foi enviado um e-mail de verdade**: falta a conta da AWS. `/api/health` diz `passwordRecovery: not_configured` até lá.
3. **Em aberto:** configurar a AWS (responsável), conferir o primeiro envio real, trocar a frase do termo do profissional que diz que não há recuperação, verificação de e-mail no cadastro, troca de e-mail, avisos (check-in, pedido do titular, prazo).

## Fatia anterior: pedidos do titular e fotos apagadas a pedido (0.25)

1. Implementado: migration 0017. Em "Minha conta" o aluno pede cópia dos dados, correção, apagar as fotos, exclusão ou retirada do aceite, com prazo de 15 dias; o profissional vê a fila na visão geral e na ficha e responde em palavras (atendido, em parte, não atendido, com a explicação que o aluno lê). **A ferramenta executa uma coisa: apagar as fotos**, que remove os arquivos e deixa o registro de que foram apagadas a pedido, sem tocar nas linhas congeladas da avaliação.
2. Princípio: o pedido é do titular e a resposta é do profissional; a ferramenta registra, mostra o prazo e nunca decide nem apaga o que não foi desenhado. **Não envia aviso por e-mail** (depende do provedor).
3. **Em aberto:** gerar a cópia dos dados ("Baixar meus dados"), aviso e lembrete por e-mail, visão de atrasos para o gestor, exceção para excluir outros dados (decisão do advogado), retenção.

## Fatia anterior: fotos abertas em produção (0.24.1)

1. Implementado: sem migration. `wrangler.json` declara `PHOTOS_ENABLED=true` junto do bucket; a cópia `wrangler.photos.json` foi removida (preview, `next dev` e CI usam o arquivo que o Webflow lê); o app aceita a variável vinda do Worker ou de `process.env` (painel). Cada foto continua exigindo a autorização do próprio aluno, que o profissional não substitui.
2. Princípio: abrir é uma decisão do responsável, tomada depois da aprovação do texto, e reversível (tirar a variável fecha). **Estado:** não foi possível ler `/api/health` ao vivo daqui; conferir `"photos": "open"` depois do deploy e, se estiver `"closed"`, criar a variável no painel (passos em `docs/WEBFLOW-CLOUD.md`).
3. **Em aberto:** destino das fotos já guardadas se a autorização for retirada; pedidos do titular; retenção; menores.

## Fatia anterior: termos editáveis pelo gestor (0.24)

1. Implementado: migration 0016. O texto aprovado em 25/10/2026 é a versão inicial (`2026-10-25-base`, sem marca de rascunho); `/gestor/termos` permite editar, ver o que mudou e como a pessoa vai ler, e publicar uma nova versão imutável, com histórico, motivo e auditoria. Quem aceitou outro texto aceita de novo no próximo acesso, e o servidor só grava o aceite do texto que a pessoa realmente leu.
2. Princípio: o texto é do responsável jurídico, não do código; mudar uma palavra é uma versão nova com prova (versão e hash) e nunca reescreve o que alguém aceitou antes.
3. **Em aberto:** rascunho no servidor; mostrar ao gestor o efeito nas pessoas que já aceitaram; citar o check-in no texto (pergunta 12 do pacote do advogado).

## Fatia anterior: check-in do aluno (0.23)

1. Implementado: migration 0015. `/aluno/check-in` (antes "planejado"): um check-in por dia com esforço percebido (0 a 10), recuperação (1 a 5 em palavras), relato de dor ou desconforto e observações. Relato de desconforto e check-in lido ficam congelados; o profissional registra a leitura (quem, quando, anotação) e vê, na visão geral, a fila de não lidos com os relatos de desconforto primeiro.
2. Princípio: o aluno diz, o profissional lê e decide. Nada é pontuado, nenhum aviso sai sozinho e nenhum treino muda por causa de um check-in; a tela diz que não é um canal de urgência.
3. **Em aberto:** campos configuráveis pelo profissional; aviso por e-mail (depende do provedor); política de resposta; a frase do termo do aluno citar o check-in (pergunta 12 do pacote do advogado).

## Fatia anterior: o aluno revê a autorização das fotos (0.22)

1. Implementado: sem migration. Em `/aluno/conta` o aluno autoriza ou retira as fotos; cada mudança é uma nova linha de aceite, da mesma versão. Autorizar abre e retirar fecha o envio na tela do profissional na hora. O texto do aluno passou a `2026-10-25-rascunho-2`.
2. Princípio: a autorização é do titular e ele a muda quando quiser; a ferramenta nunca apaga em silêncio o que já foi guardado nem decide por ele.
3. **Em aberto:** o destino das fotos já guardadas quando a autorização é retirada; retirada do aceite dos termos inteiro; pedidos do titular (acesso, exportação, exclusão).

## Fatia anterior: fotos dependem da autorização do aluno (0.21)

1. Implementado: migration 0014. A foto só é aceita se o login ativo do aluno tem aceite da versão em vigor com a autorização das fotos marcada; o profissional não tem mais caixa para isso. Cada foto guarda o id do aceite que a autorizou; o banco recusa foto sem ele. O aluno vê, em `/aluno/conta`, o que aceitou e se autorizou as fotos.
2. Princípio: a autorização é do titular; a ferramenta mostra e confere, nunca preenche. As fotos estavam fechadas em produção até a revisão jurídica do texto; abertas na 0.24.1.
3. **Em aberto:** o destino das fotos já guardadas se a autorização for retirada (o aluno já retira em Minha conta desde a 0.22); revisão jurídica; menores; pedidos do titular. **Pacote para o advogado:** [`REVISAO-JURIDICA.md`](REVISAO-JURIDICA.md) (0.21.1), com o texto atual, o que existe, o que falta e as perguntas.

## Fatia anterior: aceite único dos termos ao aderir (0.20)

1. Implementado: migration 0013 (`consent_acceptances`, só se acrescenta). O profissional aceita ao criar o espaço e o aluno ao aceitar o convite, uma vez; as fotos são uma escolha à parte, opcional, no mesmo aceite. Fica gravado quem, quando, a versão e o SHA-256 do texto aceito. Versão nova do texto pede novo aceite no acesso seguinte; o profissional vê, na ficha do aluno, quando ele aceitou e se autorizou as fotos.
2. Princípio: um texto provisório não é texto jurídico. **Estado (25/10/2026):** o advogado aprovou o texto (informado pelo responsável); desde a 0.24 ele deixou de ser rascunho. As fotos foram abertas em produção na 0.24.1.
3. **Em aberto:** revisão jurídica, controlador/operador, menores, pedidos do titular (acesso, exportação, exclusão, retirada do aceite), retenção.

## Fatia anterior: percentual dos treinos previstos com registro (0.19)

1. Implementado: sem migration, em cada ciclo, "X% dos treinos previstos com registro", só das semanas encerradas e com cada semana contando no máximo o previsto, para o profissional e para o aluno.
2. Princípio: contar, sem meta, cor ou alerta; "com registro" não é "cumpriu".
3. **Em aberto:** semana de descanso ou lesão fora da conta (marca por semana), metas por aluno, percentual por treino.

## Fatia anterior: Minha conta, senha e sessões (0.18)

1. Implementado: sem migration, `/profissional/conta` e `/aluno/conta` com troca de senha (senha atual conferida no servidor, 12 a 128 caracteres, limite de 5 por minuto) e encerramento das outras sessões; a borda de autenticação aceita só `change-password` e `revoke-other-sessions` além do que já aceitava.
2. Princípio: sem e-mail, não há recuperação; a tela diz isso. A conta não mostra aparelhos nem endereços, que seriam dado pessoal sem decisão tomada.
3. **Em aberto:** recuperação de senha e troca de e-mail (dependem do provedor de envio); exclusão da conta e solicitações do titular (exportação, exclusão, consentimento) dependem de decisão jurídica; política de senha contra vazamentos.

## Fatia anterior: evolução do próprio aluno (0.17)

1. Implementado: sem migration, `/aluno/evolucao` (antes "em breve"): registros por semana, carga por exercício e últimos registros do próprio aluno, com o mesmo cálculo e as mesmas palavras sem julgamento da 0.16; e, no formulário de registro, a referência "seu último registro" por exercício, que nunca preenche campo.
2. Princípio: cada login só lê o que é dele, pelo vínculo de acesso ativo; dado ausente continua ausente e nunca vira zero.
3. **Em aberto:** aderência em porcentagem e metas (definição do responsável técnico); check-in estruturado de recuperação (entregue na 0.23); documentos e mensagens do aluno (dependem de provedor de envio e de decisão sobre canal).

## Fatia anterior: registros por semana e carga por exercício (0.16)

1. Implementado: sem migration, na tela de execução do aluno, os treinos registrados em cada semana ao lado dos previstos pelo ciclo entregue (semanas só do período em que a revisão era a do aluno; a semana em andamento nunca conta como falta) e a maior carga digitada por exercício e dia, com o gráfico das avaliações e a tabela.
2. Princípio: contar e listar, nunca julgar. Sem porcentagem, meta, alerta ou "melhor" e "pior". Registro ausente não prova que o aluno não treinou.
3. **Em aberto (exigem decisão do responsável):** definição de aderência (por treino previsto ou por semana, tolerância, semana de descanso) para só então mostrar porcentagem; metas de carga; volume e estimativa de carga máxima (têm premissas); área de evolução para o próprio aluno.

## Fatia anterior: execução do treino pelo aluno (0.15)

1. Implementado: migration 0012 (`workout_sessions`, `session_exercises`, `session_sets`, `session_acknowledgements`). O aluno registra, por treino e por dia, as séries (repetições e carga em kg), o RIR de cada exercício, o esforço da sessão (0 a 10), dor ou desconforto e observações. O profissional vê o prescrito ao lado do executado, registra a leitura (quem e quando, com anotação opcional) e vê os relatos de dor sem leitura na visão geral.
2. Princípios: execução não é prescrição (o registro aponta para a revisão entregue e não copia nada de volta); nenhum número é preenchido pela ferramenta; "sem registro" não é "não fez"; o relato de dor é guardado como foi dito, sem interpretação, e **nenhuma regra ou IA altera o treino por causa dele**. Relato de dor e registro lido pelo profissional ficam congelados também no banco; sem eles, o aluno corrige ou apaga em até 24 horas.
3. **Em aberto (exigem decisão do responsável):** a escala de esforço (RIR por exercício e 0 a 10 por sessão foram uma escolha minha), a janela de 24 horas, o limite de 14 dias para registrar depois, o que fazer com um relato de dor (a ferramenta só mostra e guarda), aderência em porcentagem (depende da agenda do ciclo), exclusão a pedido do titular de um registro congelado, e base legal para dados de saúde do aluno.

## Fatia anterior: fotos de postura (0.14)

1. Implementado: migration 0011 (`assessment_photos`, só o índice) e o binding `PHOTOS` (R2 do Webflow Cloud, provisionado no deploy). Quatro vistas por avaliação, JPEG sem metadados (redesenhado no navegador e limpo de novo no servidor), até 5 MB, lido só por rota autenticada com vínculo técnico, imutável com a avaliação registrada.
2. Salvaguardas: confirmação de que o aluno autorizou (registrada), bloqueio de menor de 18 pela ficha, nada público, 404 para qualquer outra pessoa, auditoria de envio e remoção.
3. **Em aberto (exigem decisão do responsável):** base legal e texto de consentimento para imagens de saúde, atendimento a menores, exclusão a pedido do titular depois de registrada, retenção. **Estado (0.18.1):** o primeiro deploy com o bucket falhou duas vezes porque `trainer-prescription-photos` + o prefixo de 36 caracteres do Webflow passava de 63; com o nome `photos` o bucket foi criado em produção (confirmado no log). As fotos ficam **fechadas** na tela até o aceite do aluno existir (`PHOTOS_ENABLED`). Ver `docs/WEBFLOW-CLOUD.md`.

## Fatia anterior: evolução das avaliações (0.13)

1. Implementado: `/profissional/alunos/<id>/evolucao`, só leitura, sem migration: séries dos indicadores ao longo do tempo (gráfico quando há duas medições numéricas, tabela sempre), linha do tempo da triagem e comparação entre avaliações seguidas na triagem, na postura e no movimento.
2. Princípio: descreve e não julga. Nenhuma mudança é chamada de melhora, piora ou resolução.
3. **Em aberto:** metas e faixas de referência (dependem do responsável técnico), pressão separada em sistólica e diastólica, comparação de fotos.

## Fatia anterior: postura e movimento (0.12)

1. Implementado: migration 0010 (`assessment_findings`), com os 18 itens posturais das três vistas (seção 8) e os 9 testes de movimento com a escala de cinco níveis (seção 9), dentro da avaliação, congelados com ela.
2. Mantido do documento: só os seis itens da triagem geram revisão obrigatória. Postura e movimento descrevem, não bloqueiam; "interrompido por dor/desconforto" aparece em destaque, sem criar alerta.
3. **Em aberto:** fotos e anotação sobre imagem (precisam de armazenamento privado), comparação entre avaliações, os efeitos da seção 9 em progressões e seleção de exercício (regra futura do documento), e a decisão de contar "interrompido por dor" como sinal de triagem.

## Fatia anterior: PDF do plano entregue (0.11)

1. Implementado: PDF gerado no servidor (pdf-lib, dentro do Worker) só para revisão **entregue**, com versão (revisão e SHA-256 do conteúdo), data de geração, profissional, links de vídeo clicáveis e paginação. Sem migration.
2. Implementado: download pelo profissional (qualquer revisão entregue, também as superadas) e pelo aluno (a entregue mais recente de cada plano dele); cada download fica na auditoria, sem conteúdo.
3. **Em aberto:** objetivo e gênero no PDF (o documento mestre cita; ficaram de fora por privacidade), CREF (não existe campo), logotipo do profissional, fontes embutidas, PDF de rascunho para revisão interna.

## Fatia anterior: avaliações, triagem e indicadores (0.10)

1. Implementado: migration 0009 (`assessments`, `assessment_metrics`, `assessment_reviews`), com o `risk_status` amarrado às marcas por `CHECK`, avaliação registrada imutável por gatilhos e revisão do alerta só de acréscimo.
2. Implementado: os seis itens de triagem da seção 7.1 do documento mestre e os indicadores da 7.2, sem acrescentar item nem interpretar valor. Qualquer marca dá "Revisão obrigatória antes da entrega.".
3. Implementado: a aprovação e a entrega leem a avaliação mais recente do aluno. Alerta sem revisão bloqueia as duas; o aviso de ciência (`NOT_RECORDED`) só vale quando não há avaliação. A checagem final fica dentro do `UPDATE`.
4. **Em aberto:** o responsável técnico confere o instrumento (os itens vieram do documento mestre, não de validação clínica); base legal e consentimento; postura, mobilidade e movimento (seção 8); `REFER_OUT` reservado, não implementado.

## Fatia anterior: ficha do aluno (0.9)

1. Implementado: migration 0008 (`student_profiles`) com os campos das seções 6.1 a 6.4 do documento mestre; tela `/profissional/alunos/<id>/ficha` e resumo no aluno. Só o profissional com vínculo técnico lê e grava; salvar registra quem e quando.
2. Liberado pelo responsável do produto para ambiente de teste. **Em aberto para uso real:** base legal e texto de consentimento, atendimento a menores, exportação e exclusão de dados do titular.

## Fatia anterior: aprovação, entrega e treino do aluno (0.8)

1. Implementado: migration 0007 (colunas de aprovação e entrega e 7 gatilhos que tornam imutável, no banco, a revisão que saiu de rascunho).
2. Implementado: aprovar (sem treino abaixo do alvo e com o aviso de **triagem não registrada** confirmado) e entregar; `/aluno/treino` mostra ao aluno só a revisão entregue.
3. Decisão do responsável do produto: aprovar com o aviso visível enquanto o instrumento de triagem não existe. Não é liberação clínica; fica gravado como `NOT_RECORDED`.
4. Não incluído: execução do treino pelo aluno, PDF, notificações, avaliações e triagem.

## Fatia anterior: painel de Prescrição e cópia de mesociclo (0.7)

1. Implementado: `/profissional/prescricao` com a revisão mais recente de cada plano e as pendências por alvo; "Planos em rascunho" na visão geral.
2. Implementado: copiar um mesociclo inteiro para uma fase sem exercícios, informando os treinos que não existem no destino.
3. Sem migration nova.

## Fatia anterior: prescrição manual sobre o rascunho (0.6)

1. Implementado: migration 0006 (`prescribed_exercises`) com instantâneo de nome e vídeo, texto livre para a dose e origem registrada. Nenhum valor padrão, preset ou carga.
2. Implementado: editor por mesociclo e treino dentro do plano salvo (adicionar da biblioteca ou com nome próprio, editar, reordenar, duplicar, trocar, remover, copiar treino para um treino vazio), com pendências em relação ao alvo e sem preencher lacunas. Revisão pronta congela tudo; a nova revisão copia os exercícios.
3. Não incluído: aprovação e entrega, geração com pendências/diff, presets, copiar mesociclo, arrastar e soltar, e qualquer coisa dependente da triagem.

## Fatia anterior: biblioteca de exercícios (0.5a)

1. Implementado: migration 0005 (`exercises`) com o seed dos 64 exercícios do documento mestre, marcados como **link de busca, não vídeo revisado**.
2. Implementado: `/profissional/biblioteca` (busca, categoria, origem, arquivados), copiar um exercício do sistema, criar, editar, arquivar e restaurar os próprios, com revisão de vídeo deliberada.
3. Não incluído, por falta de fonte: músculos, equipamentos, progressões e vídeos curados. A biblioteca técnica do gestor (curadoria do sistema) segue planejada.

## Fatia anterior: planos de periodização salvos (0.4)

1. Implementado: migration 0004 (`training_plans`, `plan_revisions`, `training_plan_events`), aditiva, com o ciclo de vida completo já previsto no `CHECK` e um índice parcial de um rascunho aberto por plano.
2. Implementado: repositório com autorização técnica em cada consulta, cronograma recalculado no servidor e escrita só em rascunho; `READY` é estrutura validada, **não aprovação**; mudar um `READY` é criar nova revisão.
3. Implementado: tela do aluno com "Planos salvos", novo plano, edição do rascunho, marcar estrutura pronta e criar nova revisão. O aluno não vê nada disso.
4. Não resolvido, e depende de decisão: o instrumento de **triagem** (quais sinais colocam a avaliação em revisão necessária) não existe no repositório e não será inventado; sem ele não há Avaliações nem a trava de aprovação. O provedor de e-mail também segue em aberto.
5. Próximo passo direto desta linha: exercícios por sessão e rascunho de prescrição sobre uma revisão, ainda sem aprovação.

## Fatia anterior: papéis, convite e demonstração (0.3)

Revisão de estrutura conforme o handoff V2, detalhada em [ESTRUTURA-E-PAPEIS.md](ESTRUTURA-E-PAPEIS.md).

1. Implementado: migration 0003 (`platform_admins`, `student_invites`, `access_audit_events`), sem tocar 0001/0002.
2. Implementado: `/gestor` (visão geral, organizações, bloqueio/restabelecimento de acesso, auditoria), `/profissional` (menu V2, convite e revogação de acesso do aluno) e `/aluno` (vínculo e estado do treino); módulos inexistentes aparecem como **Em breve**.
3. Implementado: ativação única do gestor com `PLATFORM_SETUP_TOKEN`; o gestor não tem acesso técnico a alunos (testado).
4. Implementado: `/demonstracao` com dados fictícios (`DEMO_MODE`, desligada por padrão). Serve para ver as três áreas e **não conta como entrega** de Avaliações, Prescrição, Treino ou Meu Site.
5. Implementado: visual em azul sólido, sem degradê ([DESIGN-SYSTEM.md](DESIGN-SYSTEM.md)).
6. Não resolvido: e-mails não são enviados (o profissional copia o link), portal na mesma origem do painel, decisões D01/D03/D04/D06/D08 do handoff V2.

## Fatia anterior: acesso e primeiro aluno

1. Validar o recurso DB provisionado no ambiente Webflow e as migrations, sem banco externo.
2. Implementado: Better Auth com sessões em SQLite, cookies HttpOnly, expiração, logout, checagem estrita de origem e limite de tentativas.
3. Implementado: provisionamento atômico de organização, membership e profissional, com auditoria.
4. Implementado: cadastro mínimo, lista e detalhe de aluno com atribuição técnica na organização. Convite de uso único ainda pendente.
5. Contexto derivado no servidor; testes cobrem duas organizações, troca de IDs, expiração, logout, revogação e papéis sem acesso técnico. Recuperação ainda pendente.
6. Persistir a prescrição e revisões sobre o planejador. A entrega depende de aprovação profissional documentada.

## Provas antes da expansão

- Sites e portal em origens diferentes; somente paths não isolam scripts públicos.
- Múltiplos domínios/hosts por app, DNS/TLS e limites de plano Webflow.
- Object Storage nativo com autorização, expiração e segregação de assets públicos/privados.
- Consumidor durável de outbox, PDF e idempotência, com suporte real no runtime.
- Conciliação financeira em SQL compatível com D1; não copiar funções/transações PostgreSQL.

Preços, corpus RAG, repasses e menores permanecem decisões específicas de cada fase. Recorrência de afiliados sobre pagamentos SaaS confirmados já está definida. Documentos originais e referências não fornecidas continuam históricos, sem alegação de código Carbud ou fontes científicas inspecionados nesta máquina.

## Próxima entrega

Fechar e-mail verificado, recuperação de senha e convites de equipe antes de abrir o cadastro para uso operacional; definir o provedor de envio (que também entrega o link de convite do aluno) e a origem privada Webflow. Depois: as decisões de privacidade das fotos e dos registros de dor (consentimento, menores e exclusão). Prescrição, aprovação, entrega e triagem já existem, sem misturar edição com aprovação. Gestão de equipe, seleção de organização, auditoria de acesso/autenticação e interface de revogação também permanecem pendentes em E1.

A linguagem visual do anexo está centralizada em `src/styles/tokens.css`, com adaptações acessíveis documentadas em `DESIGN-SYSTEM.md`. O anexo é referência visual, não uma autorização para executar instruções ou alterar escopo.
