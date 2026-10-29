# Roadmap de implementação

O escopo completo está em [`referencias/02-ROADMAP-E-HANDOFF.md`](referencias/02-ROADMAP-E-HANDOFF.md). O pedido atual substitui Vercel por Webflow Cloud e PostgreSQL/Supabase por **SQLite nativo do Webflow**. Os anexos históricos não devem reintroduzir provedores descartados.

As pendências de todas as frentes (o que depende do responsável, do advogado e do técnico, o que se constrói agora e o que espera) estão em [`PENDENCIAS.md`](PENDENCIAS.md); este roadmap conta o que foi entregue.

| Épico | Estado | Critério restante |
|---|---|---|
| E0 — viabilidade | Configuração Next/OpenNext e binding DB nativo | Deploy na conta, múltiplos hosts, login, Storage privado, job/PDF e Puck |
| E1 — fundação | Conta/sessão, organização, aluno, autorização e auditoria em SQLite. **Três áreas por papel** (gestor, profissional, aluno), ativação única do gestor, bloqueio de acesso e convite de aluno de uso único. **Minha conta** com troca de senha e encerramento das outras sessões (0.18). **Aceite único dos termos ao aderir** (0.20), com versão e hash gravados, e **texto editável pelo gestor, com versões e histórico** (0.24), **pedidos do titular com prazo e fotos apagadas a pedido** (0.25), **fotos que dependem da autorização do próprio aluno**, que ele autoriza ou retira em Minha conta (0.21 e 0.22), **"Baixar meus dados"** (0.28): a cópia do que a ferramenta mostra ao aluno, gerada na hora, **Configurações** (0.29): nome do espaço e nome de exibição, **rascunho dos termos** (0.30) **verificação em duas etapas**, opcional, com aplicativo autenticador, para profissional e gestor (0.31), e **aparelhos conectados e entradas recentes** em Minha conta (0.32) | Revisão jurídica do texto de aceite, cópia do registro técnico do profissional (hoje respondida à mão), E-mail verificado, **configurar o e-mail para a recuperação de senha** (construída na 0.26), convites e gestão de equipe, homologação remota |
| E2 — atendimento | Planejador determinístico e exportação. **Planos de periodização salvos por aluno**, com revisões e estado Rascunho / Estrutura pronta (0.4). **Biblioteca de exercícios** com o seed de 64 do documento mestre e biblioteca por organização (0.5a). **Prescrição manual** por mesociclo sobre o rascunho (0.6), com painel de pendências e cópia de mesociclo (0.7). **Aprovação e entrega** com imutabilidade no banco (0.8). **Ficha do aluno** (0.9). **Avaliações com triagem e indicadores** (0.10), ligadas à aprovação e à entrega. **PDF do plano entregue** (0.11). **Postura e movimento** nas avaliações (0.12), sem fotos. **Evolução das avaliações** (0.13): séries dos indicadores e comparação. **Fotos de postura** no Object Storage do Webflow (0.14). **Execução do treino pelo aluno** (0.15): o que o aluno fez, com leitura e relato de dor para o profissional. **Registros por semana, percentual dos previstos com registro e carga por exercício** (0.16 e 0.19), só leitura | Anotação sobre a imagem, exclusão de foto a pedido do titular, geração com pendências; conferir o instrumento de triagem com o responsável técnico |
| E3 — sites/CRM | Parcial: **Serviços e Leads** (0.33): funil, linha do tempo, duplicidade e **conversão idempotente em aluno**; **Meu Site** (0.34 a 0.44): blocos tipados, rascunho com revisão, prévia, versões imutáveis, publicar e tirar do ar, página pública em `/s/<endereço>`, na 0.35 o **editor visual de arrastar e soltar** (colunas, texto direto na página, desfazer, camadas, cor e aparência) na 0.36, **imagens** (biblioteca, bloco Imagem e logotipo, em bucket privado servido pela rota do app) na 0.37, a **árvore livre de blocos** (contêineres dentro de contêineres, estilo tipado em cada bloco, camadas em árvore e painel de estilo) na 0.38, os **tamanhos de tela** (quadros do computador, do tablet e do celular lado a lado numa tela com zoom e movimento, estilo por tamanho em cascata e ocultar por tamanho), na 0.39 a **manipulação direta na tela** (alças, seleção de vários blocos, copiar e colar, menu de contexto e atalhos) na 0.40, os **modelos de seção** (barra de navegação, rodapé, 3 destaques, imagem e texto, planos e depoimentos, montados de contêineres e elementos e adaptados aos três tamanhos) e, na 0.41, os **componentes reutilizáveis** (um bloco guardado uma vez e usado em vários lugares, com o texto, o botão e a imagem que cada uso pode mudar; editar o componente muda todos os usos) e, na 0.42, o **tema e a busca** (claro, escuro ou automático pelo aparelho de quem visita, uma fonte do sistema para a página toda, a **cor da marca** que o sistema ajusta para o texto ficar legível, e pedir aos buscadores que não listem a página) e, na 0.43, as **várias páginas** (cada uma com endereço, título e descrição para buscadores, menu no cabeçalho e botões que levam a outra página; a página aberta se edita com as mesmas ferramentas, e a prévia navega entre elas) e, na 0.44, o **histórico visual de versões** (ver cada versão publicada como foi publicada, compará-la com outra ou com o rascunho, com a lista do que mudou e os blocos marcados na página), na 0.45, os **modelos de página e de site** (cinco páginas prontas e o site completo, só com a estrutura e os nomes) na 0.46, o **salvamento automático** do rascunho na 0.47, o **formulário de contato** da página pública (construído e **fechado** até J8, J12 e J15) e, na 0.48, a **revisão do responsivo** (o menu que dobra em botão, os modelos alinhados) | Domínio próprio e TLS (E0), mapa do site e canônico, abrir o formulário que gera lead (construído na 0.47; fechado até J8, J12 e J15); o resto do construtor (o que a 0.44, a 0.45, a 0.46 e a 0.47 deixaram de fora, B33 a B36) |
| E4 — portal | Parcial: convite de uso único, área do aluno, **treino entregue** (0.8), **registro da execução** (0.15) e **evolução do próprio aluno** (0.17) e **check-in** (0.23) | Origem privada separada, documentos e mensagens; fecha piloto operacional |
| E5 — gestão/marketing | Parcial: o CRM começou em E3 (0.33). Agenda, contratos, recebimentos e conectores não existem | Tarefas e lembretes, mensagens, agenda, contratos, recebimentos (R4) e conectores de anúncios (precisam de origem separada, R3) |
| E6 — SaaS/afiliados | Planejado | Inbox/outbox, conciliação, recorrência, ajustes e repasses |
| E7 — evoluções | Planejado | RAG com armazenamento compatível, progressão assistida e booking |

## Iniciativa: o construtor do Meu Site no nível do Frappe Builder (0.36 em diante)

**Pedido (28/10/2026):** ajustar o construtor de sites para algo **próximo ou igual ao Frappe Builder** (clonado, só leitura, em `rafsoaresm/builder`). O Frappe Builder é uma **árvore livre de blocos** (seção, contêiner, linha, coluna, grade, texto, título, botão, link, imagem, vídeo, formulário, HTML) com **um painel de estilo por bloco** (layout flex e grade, espaçamento, tamanho, posição, tipografia, fundo, borda, sombra, transição), **três tamanhos de tela** (computador, tablet, celular) com sobreposição de estilo por tamanho, **componentes reutilizáveis**, camadas arrastáveis, alças de arrastar e redimensionar na própria tela, guias de alinhamento, seleção múltipla, copiar e colar, variáveis, modo escuro, várias páginas, histórico de versões, e também **HTML, CSS e scripts livres** e dados dinâmicos do Frappe.

**Decisões do usuário (28/10/2026):**
1. **Mesma experiência, estilos controlados.** Tudo o que o editor do Frappe faz de visual e de organização entra; **HTML, CSS e JavaScript livres não entram**. Cada propriedade de estilo tem um conjunto de valores válidos, conferido no servidor, e a página pública continua sem script do profissional, sem HTML livre e sem `style` embutido (o CSS da página é gerado a partir dos valores válidos). Motivo: a página pública divide a origem com o painel (R3) e as regras de AGENTS.md. **Rever** só depois de a página pública ter origem própria.
2. **Imagens: provar o armazenamento agora, antes de tudo.** O Webflow Cloud **não tem bucket público** (ver `WEBFLOW-CLOUD.md`); "público" aqui é: **um segundo bucket privado (`SITE_MEDIA`), servido pela rota do próprio app, só para imagens que estão numa versão publicada**.

**Fatias, em ordem (cada uma só depois de a anterior estar no ar):**
- **0.36 Imagens do Meu Site (entregue; deploy `1eb4a675` com o bucket `site-media` criado; falta a prova de uma imagem saindo em produção, PENDENCIAS C15):** bucket `SITE_MEDIA`, migration 0025 (`site_assets`, `site_release_assets`), envio pelo editor (JPEG ou PNG, reencodado no navegador e conferido no servidor, sem metadados), biblioteca de imagens do site, bloco **Imagem** e **logotipo**, rota pública `/s/<endereço>/m/<imagem>` que só serve imagem de versão publicada. Prova local feita. O deploy criou o bucket `site-media` e a migration 0025 foi aplicada (log do deploy); a prova real que resta é uma imagem sair pela rota em produção.
- **0.37 Árvore livre de blocos (entregue; deploy `9a91c3d1`, commit `9c79ca6`, sem migration; falta a conferência em produção, PENDENCIAS C16):** documento versão 3 (nós de contêiner, linha, coluna, grade, texto, título, botão, link, imagem e os blocos de dados como Serviços), com leitura da versão 2; CSS da página gerado dos estilos válidos; camadas em árvore arrastável; painel de estilo (layout, espaçamento, tamanho, tipografia, cor, fundo, borda, sombra).
- **0.38 Tamanhos de tela (pronta localmente; falta o deploy, PENDENCIAS C17):** quadros do computador (1400 px), do tablet (800) e do celular (420) lado a lado numa tela com zoom e movimento, como no Frappe Builder; estilo por tamanho em cascata (o celular herda o tablet, que herda o computador); ocultar por tamanho; a página publicada responde à largura da janela.
- **0.38.1 Imagens da página publicada e avisos que não impedem (correção; deploy `329ae5f4`, commit `ba8c2d3`, sem migration; falta a conferência em produção, PENDENCIAS C18):** a página pública, a folha de estilo e a prévia passam a escrever endereços **relativos** (o mount path do Webflow Cloud não vem de variável do repositório; as imagens da página publicada davam 404 ali); os problemas da publicação são **avisos** (com "Publicar mesmo assim") e só impedem o site sem título, a página sem bloco e o depoimento sem autorização.
- **0.39 Manipulação direta na tela (entregue; deploy `84d2fb01`, commit `36726ca`, sem migration; falta a conferência em produção, PENDENCIAS C19):** alças de tamanho (com guias de encaixe), de margem interna, de espaço entre blocos e de arredondamento; seleção de vários blocos (Ctrl, Shift, laço com Shift); copiar, recortar e colar blocos e estilo com validação; menu de contexto; atalhos e setas pela árvore; nome das camadas; o painel de estilo muda todos os escolhidos.
- **0.40 Modelos de seção (pronta localmente; falta o deploy, PENDENCIAS C20):** grupo **Modelos** na biblioteca com seis seções prontas, feitas dos mesmos contêineres e elementos da árvore (barra de navegação, rodapé, 3 destaques, imagem e texto, planos e depoimentos); grades de 3 → 2 → 1 colunas escritas no próprio nó para os três tamanhos; **nenhum texto inventado** (só os nomes dos links e dos botões de contato); entram na página em um passo do histórico.
- **0.41 Componentes reutilizáveis (pronta localmente; falta o deploy, PENDENCIAS C21):** criar um componente da seleção (um bloco, ou vários no mesmo lugar), usá-lo de novo pela biblioteca (clique ou arraste), mudar num uso só o texto, o botão e a imagem que o componente deixa abertos, **editar o componente** (muda todos os usos), desvincular um uso (vira blocos comuns), acrescentar uma **cópia** (blocos comuns, que não seguem o componente: o modelo próprio), renomear e excluir (os usos viram blocos comuns).
- **0.42 Tema e busca (pronta localmente; falta o deploy, PENDENCIAS C22):** modo **automático** (claro, e escuro para quem tem o aparelho no escuro), **fonte** do site (as do próprio aparelho, nada é baixado), **cor da marca** (uma cor da pessoa vira a paleta da página, movida só até passar nas mesmas conferências de contraste das cores prontas) e **aparecer nos buscadores** (sim ou não).
- **0.43 Páginas (entregue; deploy `6f1489cb`, commit `8d7ed89`, sem migration; falta a conferência em produção, PENDENCIAS C23):** mais de uma página (cada uma com o seu endereço abaixo do site, título e descrição para buscadores), **menu** no cabeçalho de todas, botão ou link que leva a outra página, aba **Páginas** no editor (criar, titular, endereço, no menu ou fora dele, subir, descer, duplicar, excluir), a prévia navega entre elas e a publicação confere cada página. Sem migration.
- **0.44 Histórico visual de versões (entregue; deploy `f1fa739a`, commit `6f216e0`, sem migration; falta a conferência em produção, PENDENCIAS C24):** ver cada versão publicada como foi publicada (com as suas páginas), **comparar** duas versões ou uma versão e o rascunho (lista do que mudou: o site, cada página, os blocos acrescentados, removidos, mudados e movidos, os componentes; e os blocos novos e mudados **marcados na página**) e voltar a uma como rascunho (já existia). Sem migration.
- **0.45 Modelos de página e de site (entregue; deploy `3d950137`, commit `d668b1f`, sem migration; falta a conferência em produção, PENDENCIAS C25):** cinco **páginas prontas** (Sobre mim, Serviços e planos, Perguntas frequentes, Depoimentos e Contato) na aba Páginas do editor e a opção **"Site completo"** ao criar o site (início e quatro páginas, com menu). Os modelos trazem os blocos e os nomes, **nunca o texto**; o de depoimentos vem com a autorização desmarcada. Sem migration.
- **0.46 Salvamento automático (entregue; deploy `6676bba8`, commit `e8db965`, sem migration; falta a conferência em produção, PENDENCIAS C26):** o editor salva o rascunho sozinho depois de 3 segundos sem alterações (a caixa "Salvar sozinho" desliga); um conflito com outra aba o para e avisa; a falta de conexão é dita e o mesmo conteúdo não é reenviado. Sem migration.
- **0.47 Formulário de contato (entregue; deploy `f859f0b8`, commit `80c652e`, migration 0026 aplicada; falta a conferência em produção, PENDENCIAS C27):** o bloco "Formulário de contato", a rota pública de envio (limite por remetente e por site, campo-isca, tamanho), a **caixa de entrada** em Leads (virar lead com origem "Site", ou apagar) e as chaves de abertura. **Fechado por padrão:** só abre com `PUBLIC_FORMS_ENABLED` e `PRIVACY_NOTICE_URL` no ambiente **e** o recebimento ligado no site; nada disso existe em produção, e abrir depende de J8, J12 e J15 (PENDENCIAS C28).
- **0.48 Menu e blocos responsivos (pronta localmente; falta o deploy, PENDENCIAS C29; sem migration):** pedido do usuário de rever o menu e todos os componentes. O menu das páginas vira um botão "Menu" com painel quando a **página** é estreita (sem script; vale nos quadros do editor), os modelos de seção deixam de dobrar a margem lateral, a barra inferior do app mostra "Periodização" inteira a 360 px, e há um e2e que vigora a largura das telas do app. Sem migration.
- **Próxima, 0.49 Modelos de layout de site:** os dois exemplos anexados pelo usuário (um com título grande em maiúsculas e foto ao lado, faixa de números e chamada final; outro com foto à esquerda, faixa colorida de links e três cartões coloridos) viram seções e **modelos de site completos** na biblioteca e na criação do site, sem texto nem imagem inventados.
- **Depois:** vídeo e embeds de lista fixa (mudam o texto de privacidade), domínio próprio (E0), analytics da página, e **abrir o formulário** quando o aviso público e o parecer sobre leads existirem.

## Fatia entregue: menu e blocos do site responsivos (0.48)

1. Implementado (sem migration; só renderizador e CSS): o menu das páginas, que a 360 px quebrava em três linhas sob o nome, passa a ser **um botão "Menu" à direita do nome, com um painel que abre sob o cabeçalho**, quando a **página** é estreita (container query de 640 px: o quadro do celular do editor se comporta como o celular de verdade). Sem script: uma caixa de seleção escondida e o seu rótulo, com teclado e anel de foco; cada link com 44 px de altura; a página atual em destaque; os links no HTML uma vez só.
2. **Revisão de todos os blocos:** um site com todos os blocos e modelos capturado a 360, 768 e 1280 px e dez telas do app a 360 e 768 px. Só três coisas estavam ruins: o menu, a margem lateral dobrada dos modelos de seção (agora alinhados com a página) e o rótulo "Periodização" cortado na barra inferior do app.
3. **HyperUI:** usado como referência visual, não instalado (o construtor não aceita classe nem CSS livre, e o app tem CSS e tokens próprios). Serve também de inspiração para os modelos da 0.49.
4. **Em aberto:** ver B37 (o que a 0.48 deixa de fora de propósito) e C29 (conferir em produção). Próxima: **0.49, modelos de layout de site** a partir dos dois exemplos anexados pelo usuário.

## Fatia entregue: formulário de contato da página pública (0.47)

1. Implementado (migration 0026, aditiva): `sites.inquiries_open` (a chave do site, desligada ao nascer) e `site_inquiries` (o que um visitante escreveu, esperando o profissional). As regras ficam fora das rotas e das telas (`inquiries.ts`: quando o formulário abre, o que se pode enviar, os limites; `inquiry-pages.ts`: as páginas de resposta), e os dois repositórios ficam separados em `site-inquiries.ts`: a **porta pública** (sem sessão; a organização vem do site que o endereço nomeia) e a **porta da organização** (quem trabalha os leads).
2. **Fechado por padrão, em três chaves:** a **plataforma** (`PUBLIC_FORMS_ENABLED="true"` e um `PRIVACY_NOTICE_URL` em https, como as fotos têm a sua), o **site** (o proprietário ou a gestão liga o recebimento) e o **bloco** "Formulário de contato" na página. Com qualquer uma desligada o formulário não existe na página pública e um `POST` responde 404. No editor e na prévia o bloco é uma amostra que não envia nada.
3. **O envio:** formulário HTML comum, sem script nem serviço de terceiros, para `/s/<endereço>/m/contato` por endereço relativo (o mount path não está no código); campo-isca, aceite do aviso de privacidade, 5 por hora por remetente (hash com chave do endereço, esvaziado em uma hora), 60 por hora por site, 500 esperando, corpo de até 8 KB. A resposta é uma página simples; quem preenche o campo-isca é agradecido e nada é guardado.
4. **A caixa de entrada** (Leads › Mensagens do site): a mensagem **não é um lead**. O proprietário, a gestão e o comercial a transformam em lead (origem "Site", com o que a pessoa escreveu como primeira anotação; idempotente) ou a apagam; nos dois casos a linha some e a trilha guarda só o fato. Um lead do site pode ser editado sem perder a origem.
5. **Em aberto:** ver B36 (o que a 0.47 deixa de fora de propósito), C27 (conferir em produção que **continua fechado**) e C28 (a lista do que fazer para **abrir**, depois de J8, J12 e J15). Próximas: vídeo e embeds, domínio próprio (B26) e analytics.

## Fatia entregue: salvamento automático do rascunho do Meu Site (0.46)

1. Implementado (sem migration; só cliente: o servidor continua com o mesmo `saveSiteDraft` e a mesma conferência de revisão): a regra fica em `autosave.ts`, fora dos componentes, e o `SiteWorkspace` a liga a um temporizador.
2. **Quando salva:** 3 segundos depois da última alteração, se estiver ligado, a pessoa puder editar, houver alteração e nenhum outro salvamento estiver em andamento. O temporizador recomeça a cada alteração.
3. **O que o para:** um **conflito** (outra aba ou outra pessoa salvou antes) para o salvamento automático até a página ser atualizada, e a mensagem diz isso; **qualquer outra recusa** não é reenviada com o mesmo conteúdo. A falta de conexão, que antes não era tratada, agora é dita, e o texto continua na tela.
4. **Escolha da pessoa:** a caixa "Salvar sozinho" no cabeçalho do editor liga e desliga; a escolha fica no navegador. Vem ligada. O que está no ar só muda em "Publicar".
5. **Em aberto:** ver B35 (o que a 0.46 deixa de fora de propósito) e C26 (conferir em produção). Próxima: **formulário público que gera lead (B18)**, depois vídeo e embeds, domínio próprio (B26) e analytics.

## Fatia entregue: modelos de página e de site do Meu Site (0.45)

1. Implementado (sem migration: o site criado com um modelo guarda um rascunho como qualquer outro): `page-models.ts` com cinco **páginas prontas** e dois **modelos de site**; as regras ficam em `page-model.ts` (`addPageFrom`, `pageFromModel`, `starterOf`), fora dos componentes.
2. **Páginas prontas:** na aba **Páginas** do editor, "Páginas prontas" acrescenta, no fim do menu, uma página com o título do modelo, o endereço que ele faz (`sobre-mim`, `sobre-mim-2`…) e os blocos do modelo; a página nova abre no editor. Recusa o site que já tem as 10 páginas ou que não tem lugar para os blocos.
3. **Site completo:** ao criar o site, "Começar com" oferece **uma página só** (o padrão, como sempre foi) ou **site completo** (a página inicial e as páginas Sobre mim, Serviços, Perguntas frequentes e Contato, com menu). `sitesFor().create` valida o modelo no servidor: um valor fora da lista é recusado, não adivinhado.
4. **Sem texto inventado:** os modelos trazem a estrutura e os nomes (os títulos e o texto dos botões que levam aos contatos); o que a pessoa lê, ela escreve. O modelo de **depoimentos** vem com a autorização desmarcada (a publicação fica impedida até ser confirmada), e o site completo **não leva depoimentos**, para que um site novo possa ser publicado com os avisos ("Publicar mesmo assim").
5. **Em aberto:** ver B34 (o que a 0.45 deixa de fora de propósito) e C25 (conferir em produção). Próxima: **formulário público que gera lead (B18)**, depois vídeo e embeds, domínio próprio (B26) e analytics.

## Fatia entregue: histórico visual de versões do Meu Site (0.44)

1. Implementado (sem migration: cada publicação já guardava o documento inteiro e imutável, e o banco não muda): `sitesFor().release(número)` lê uma versão como foi publicada, com a mesma regra de acesso do site (quem lê o site lê as versões; qualquer outro papel, outra organização, um número que não existe ou uma versão guardada que não é um documento recebem nada).
2. **Ver uma versão:** `/profissional/meu-site/previa?versao=<n>` mostra a versão como foi publicada, com as **suas páginas** (o menu da versão navega entre elas), sem nada que veio depois. Um valor que não é número, ou uma versão que o site não tem, volta para a prévia do rascunho.
3. **Comparar:** `?desde=<m>` (ou `rascunho`) diz **o que mudou** desde outra versão e marca a página: o site (título, descrição, contatos, aparência, logotipo, buscadores), cada página (acrescentada, removida, título, endereço, descrição, no menu, ordem), cada bloco (acrescentado, removido, mudado com o nome dos campos, de outro lugar, de outra página, com outra ordem) e os componentes. A comparação é por identificador (`release-diff.ts`, função pura): um contêiner acrescentado ou removido é dito uma vez; os serviços que a publicação escreveu na página não entram (o rascunho não os leva), compara-se a escolha. Os blocos acrescentados (verde) e os que mudaram (laranja) são **contornados por fora na página da versão mais nova**, sem mudar o layout; o que foi removido só aparece na lista.
4. **Na lista de versões:** "Ver", "O que mudou" (desde a anterior) e, para a que está no ar, "Mudanças do rascunho" (o que o rascunho tem de diferente do que está no ar); na tela de uma versão, a barra "O que mudou desde:" escolhe qualquer outra versão ou o rascunho. Voltar a uma versão continua sendo "Usar como rascunho" (substitui o rascunho, e o que está no ar não muda).
5. **Em aberto:** ver B33 (o que a 0.44 deixa de fora de propósito) e C24 (conferir em produção). Próxima: **formulário público que gera lead (B18)**, depois vídeo e embeds, domínio próprio (B26) e analytics.

## Fatia entregue: várias páginas do Meu Site (0.43)

1. Implementado (sem migration; o documento continua na **versão 3** e `pages` é opcional, então as páginas já guardadas ou publicadas abrem iguais): o site pode ter até **10 páginas além da inicial**, cada uma com `slug` (o endereço dela, abaixo do endereço do site), título (o nome no menu e na aba), descrição para buscadores, "no menu" ou fora dele, e blocos. Os limites de uma página (40 blocos, 200 nós, 8 níveis, 600 nós com os componentes desenhados) valem por página; o site tem um limite próprio de **800 nós somando as páginas**. O contrato recusa endereço repetido, endereço `m` (reservado: é onde ficam as imagens), identificador de página repetido ou `home`, e identificador de bloco repetido entre páginas.
2. **Página pública:** a inicial em `/s/<site>` e as outras em `/s/<site>/<página>` (rota dinâmica abaixo das fixas `m/` e `estilo.css`), cada uma com o seu `<title>` ("Sobre mim — Nome do site") e a sua descrição; o pedido "não aparecer nos buscadores" vale para o site todo. O **menu** (Início e as páginas que estão no menu e têm título) aparece no cabeçalho de todas, com a atual marcada, e quebra para baixo do nome no celular. Os endereços que o servidor escreve continuam **relativos**, agora dependendo do nível da página (a inicial e as outras não estão à mesma profundidade): imagens, folha de estilo e links entre páginas, conferidos contra o endereço de cada uma com e sem o mount `/app`.
3. **Botão e link para outra página:** o destino "Outra página do site" (ao lado de "Um contato" e "Outro bloco desta página"), exclusivo com os outros dois. Um botão para uma página que deixou de existir é um aviso na publicação e fica de fora da página.
4. **Editor:** aba **Páginas** na biblioteca (lista, nova página, e, na página aberta, subir, descer, duplicar e excluir), **configurações da página** (título, endereço com a mensagem de por que não foi aceito, descrição, no menu), menu desenhado no cabeçalho do quadro, prévia que navega entre as páginas. A página aberta é mostrada trocando os blocos dela com os da inicial (`swapPage`): todas as ferramentas que já existiam funcionam nela, e o que olha o site todo (limite de nós, imagens, componentes) ainda enxerga todas as páginas. Excluir uma página tira dos botões o destino que levava a ela e **um desfazer** traz tudo de volta. O primeiro título de uma página também faz o endereço dela, enquanto a pessoa não o escolheu.
5. **Componentes entre páginas:** são do site; excluir, renomear ou mudar um componente alcança os usos de todas as páginas (ou não muda nada, se uma página não tem lugar). Os usos são contados no site todo.
6. **Publicação:** a conferência olha cada página e diz de qual ("Página “Planos”: Bloco 2 …"), e o editor tem "Ir ao bloco" (abre a página e escolhe o bloco) e "Ir à página". Página sem título ou sem bloco é aviso (não impede); só impedem, como antes, o site sem título, a página inicial sem bloco e o depoimento sem autorização (em qualquer página). As imagens de qualquer página contam como usadas pelo site (não se removem da biblioteca; entram na versão publicada).
7. **Em aberto:** ver B32 (o que a 0.43 deixa de fora de propósito) e C23 (conferir em produção). Próxima: **0.44, histórico visual de versões**.

## Fatia entregue: tema e busca do Meu Site (0.42)

1. Implementado (sem migration; o documento continua na **versão 3** e os campos novos são opcionais, então as páginas já guardadas ou publicadas abrem iguais): o tema ganha o modo **automático**, a **fonte** da página (sem serifa, com serifa ou monoespaçada, do próprio aparelho de quem visita: nada é baixado) e a **cor da marca**; o documento ganha **`indexable`** (aparecer nos buscadores; ausente é sim).
2. **Cor da marca (`brand-color.ts`):** a pessoa escolhe uma cor; o sistema faz a paleta da página a partir dela e a move **só o quanto for preciso** até passar nas mesmas conferências das cores prontas (texto do botão no botão 4,5:1, botão contra a página 3:1, a cor como texto na página e no bloco destacado 4,5:1, e o texto da página no bloco destacado 7:1 e 4,5:1). Uma cor que já passa não muda. A conta é aritmética pura, no servidor (para escrever a folha) e no editor (para mostrar o resultado); a paleta vai na **folha de estilo da página** (a página não ganha `style`), com a cor e os números derivados já validados como `#rrggbb`.
3. **Modo automático (CSS):** as regras do claro e do escuro se repetem para o automático, o escuro dentro de `@media (prefers-color-scheme: dark)`; o teste de contraste lê as três e as mantém iguais às duas de origem.
4. **Buscadores:** desmarcado, a página sai com `robots: noindex, nofollow`. É um **pedido** aos buscadores, não uma proteção: a página continua aberta a quem tem o endereço (a tela diz isso).
5. **Em aberto:** ver B31 (o que a 0.42 deixa de fora de propósito) e C22 (conferir em produção). Próxima: **0.43, páginas**.

## Fatia entregue: componentes reutilizáveis do Meu Site (0.41)

1. Implementado (sem migration; o documento continua na **versão 3** e a lista `components` é opcional, de modo que as páginas já guardadas ou publicadas abrem iguais): um **componente** é um nó (e o que ele guarda) mantido **uma vez** na lista do documento; um **uso** é um nó `component` que aponta para ele. O servidor confere tudo no mesmo esquema do documento: até 20 componentes de até 40 blocos, nenhum dentro de outro (não há ciclo a seguir), identificadores distintos entre a página e as definições, e a página **desenhada** (cada uso contado com o que o componente tem) em até 600 blocos.
2. O uso é uma **caixa própria** em volta do componente: tem estilo, tamanho, lugar e "ocultar por tamanho" como qualquer bloco, e **muda só o que o componente deixa aberto**: o texto de títulos e parágrafos, o texto e o contato de botões e links, a imagem (com descrição e legenda). O resto (layout, cores, espaços) é do componente. Na página o texto do uso se escreve direto, com dois cliques, como em qualquer bloco; o que não é do uso aparece mas não se digita ali.
3. **Editar o componente** abre os blocos dele como se fossem a página (sem o cabeçalho e o rodapé do site), com uma faixa que diz que a mudança vale para todos os usos; **Concluir edição** volta ao uso de onde se veio. Tudo continua no mesmo histórico (desfazer, refazer) e no mesmo rascunho.
4. **Criar componente** (menu do botão direito, ou o botão da aba Conteúdo): um bloco vira o componente; vários blocos do mesmo lugar são postos num contêiner que vira o componente. O que o bloco tinha de lugar no seu contêiner (crescer, encolher, base, alinhamento, em cada tamanho) passa para o uso, para a página ficar como estava. **Desvincular** devolve blocos comuns (com o que o uso mudou); **Excluir o componente** desvincula todos os usos antes, então nada some da página; **Acrescentar uma cópia** põe blocos comuns, sem seguir o componente.
5. **Copiar e colar** leva a definição junto: onde o componente existe, o uso continua um uso; onde não existe (outro site, ou dentro de um componente), vira blocos comuns, e o que só valia no lugar de origem (imagens de outra biblioteca, autorização de depoimento) cai, como em qualquer colagem.
6. **Publicação:** o que falta dentro de um componente é aviso sobre o **bloco da página** (com o nome do componente), e o depoimento sem autorização continua impedindo; as imagens de um componente, e as que um uso escolhe, entram na versão publicada e saem pela rota do site. A folha de estilo escreve os blocos do componente **uma vez**, quantos usos houver.
7. **Em aberto:** ver B30 (o que a 0.41 deixa de fora de propósito) e C21 (conferir em produção). Próxima: **0.42, tema, páginas e versões**.

## Fatia entregue: modelos de seção do Meu Site (0.40)

1. Implementado (sem migration; o documento continua na **versão 3**): grupo **Modelos** na biblioteca do editor, com seis seções prontas que **não são um tipo novo de bloco**: cada uma é uma árvore de contêineres e elementos que já existem (`presets.ts`), então depois de entrar na página é editada, movida, copiada e excluída como qualquer outra, e passa pelas mesmas conferências do servidor. Barra de navegação (`header` com o nome e um `nav` de três links), rodapé (`footer` com texto e links de Instagram, WhatsApp e e-mail), 3 destaques (grade de três colunas com título e texto), imagem e texto (linha que quebra sozinha quando falta largura), planos (três cartões `article` com título, texto e botão) e depoimentos (grade de três blocos Depoimento).
2. **Os três tamanhos estão no próprio modelo:** as grades têm 3 colunas no computador, 2 no tablet e 1 no celular (`styleTablet` e `styleMobile` do nó, não regra à parte), e a linha de imagem e texto usa `wrap` e base de 280 px. A folha de estilo da página publicada leva as três regras.
3. **Nada é inventado:** títulos, textos, imagens e depoimentos entram **vazios** (o editor mostra o que vai em cada lugar); as únicas palavras escritas são nomes de estrutura ("Serviços", "Sobre mim", "Contato", "Instagram", "WhatsApp", "E-mail") e o texto dos botões de contato ("Quero este plano", "Falar comigo"). Na página pública o que está vazio **não aparece** (texto vazio, link sem destino e link para um contato não preenchido ficam de fora). O modelo de depoimentos traz a autorização **desmarcada**: continua impedindo a publicação até a pessoa confirmar.
4. Cada modelo entra **em um passo do histórico** (desfazer tira o modelo inteiro).
5. **Em aberto:** ver B29 (o que a 0.40 deixa de fora de propósito) e C20 (conferir em produção). Próxima: **0.41, componentes reutilizáveis**.

## Fatia entregue: manipulação direta na tela do Meu Site (0.39)

1. Implementado (sem migration; o documento continua na **versão 3**): as **alças** sobre o bloco escolhido escrevem **estilos tipados** no tamanho da tela em edição, na faixa que o esquema aceita (largura e altura com encaixe nas linhas do contêiner e dos blocos anteriores e guias; margem interna por lado, pelos dois lados ou pelos quatro; espaço entre blocos na direção da linha ou da coluna; arredondamento). Um arrasto é **um passo** do histórico e Escape desiste.
2. **Seleção de vários blocos** (lista; o último é o principal): Ctrl ou Cmd junta, Shift nas camadas pega o intervalo, **Shift e arrastar** desenha um laço que escolhe o que toca no contêiner que o contém. Agrupar, duplicar e excluir agem em todos; o painel de estilo muda todos.
3. **Copiar, recortar e colar** blocos e estilo (JSON com marca de formato, lido como um documento, com identificadores novos, sem imagens de outra biblioteca, sem serviços que não estão na oferta, **com a autorização do depoimento zerada**, tudo ou nada). **Menu de contexto**, **atalhos** (Delete, Ctrl+D, Ctrl+G, Ctrl+Shift+G, Escape, F2, setas pela árvore) e **nome das camadas** no lugar.
4. **Em aberto:** ver B28 (o que a 0.39 deixa de fora de propósito) e C19 (conferir em produção, com o dedo e em outros navegadores). Próxima: **0.40, modelos de seção** (e depois, 0.41, componentes reutilizáveis).

## Correção entregue: imagens da página publicada e avisos que não impedem (0.38.1)

1. **Imagens quebradas na publicação (relato do usuário):** o servidor montava os endereços das imagens com `NEXT_PUBLIC_BASE_PATH`, vazio no Webflow Cloud; agora a página, a folha de estilo e a prévia usam endereços **relativos ao próprio endereço** (`./<endereço>/m/<id>`, `./m/<id>`, `./imagens/<id>`) e o mount path vem junto. O editor, no navegador, segue lendo o mount path da barra de endereço. Teste de regressão: cada endereço é resolvido contra quatro montagens diferentes; chave local `SIMULATE_PLATFORM_MOUNT=1` reproduz "`basePath` aplicado, variável vazia" no build de nuvem.
2. **Avisos que não impedem (pedido do usuário):** `publishIssues` marca `blocking` (site sem título, página sem bloco, depoimento sem autorização) ou `warning` (o resto). Só avisos: a tela mostra a lista e **"Publicar mesmo assim"**; o servidor confere de novo e nada é publicado sem a escolha. Decisão a confirmar: a autorização do depoimento continua impedindo (REVISAO-JURIDICA 10b).
3. **Em aberto:** C18 (conferir em produção), B26 (o domínio próprio terá de rever os endereços relativos) e B27 (a auditoria não registra "publicado com avisos").

## Fatia entregue: tamanhos de tela do Meu Site (0.38)

1. Implementado (sem migration; o documento continua na **versão 3**, com duas chaves opcionais por nó): cada nó guarda o estilo do computador em `style` e **só o que muda** no tablet em `styleTablet` e no celular em `styleMobile`, com o mesmo esquema tipado e a mesma conferência do servidor. A **cascata é a do Frappe Builder**: o celular tem o estilo do computador, mais o que o tablet muda, mais o que é dele. Quadros de 1400, 800 e 420 px; a página publicada muda de tamanho em 1023 px (tablet) e 576 px (celular), os mesmos números do Frappe.
2. **Ocultar por tamanho** (`hidden`): vale no tamanho e **desce** para os menores até um deles dizer o contrário. Vira `display:none` em faixas de largura, escritas no fim da folha para vencer qualquer `display` de cima. O **olho de cada camada** age no tamanho em edição, e a caixa "Ocultar no tablet" do painel faz o mesmo. Ocultar só esconde na tela (o texto continua no código da página; a tela avisa).
3. **O CSS** (`buildSiteCss`): primeiro todas as regras do computador, depois as do tablet, depois as do celular e por último as de ocultar. Cada tamanho escreve só o que difere do de baixo, **comparando as declarações como elas são de verdade** em cada tamanho, então uma propriedade que depende de outra (o tamanho da imagem de fundo, a cor da borda) acompanha a principal. "Sem imagem" num tamanho termina a imagem de fundo do tamanho de baixo. Na página publicada são `@media`; no editor são `@container site-frame` (cada quadro é um contêiner com a largura do seu tamanho), e `vw` vira a largura do quadro (`cqw`).
4. **Editor, o mais parecido possível com o do Frappe:** os quadros lado a lado, cada um com a largura do seu tamanho e o nome em cima; botões no canto de cima para mostrar cada quadro (com Ctrl ou Cmd, só um); **zoom** (Ctrl ou Cmd + roda, os botões, Ctrl ou Cmd com `+`, `-` e `0`; com Shift, ajusta à tela), **mover** (a roda, as setas quando nada está selecionado, espaço + arrastar, o botão do meio ou arrastar o fundo) e a caixa do zoom em baixo. Clicar num quadro seleciona ali e passa a editar **aquele tamanho**; o painel de estilo mostra o que o bloco tem naquele tamanho (o que vem de cima, em cinza), marca com um ponto o tamanho que tem mudanças e tem "Voltar ao que vem do tamanho de cima". Em janela estreita (até 900 px) a tela é um quadro por vez, sem zoom, numa área que rola.
5. **Em aberto:** ver B25 (o que a 0.38 deixa de fora de propósito) e C17 (conferir em produção e em aparelhos reais). Próxima: **0.39, manipulação direta na tela** (alças de redimensionar e de espaçamento, guias, seleção múltipla, copiar e colar, menu de contexto).

## Fatia entregue: árvore livre de blocos do Meu Site (0.37)

1. Implementado (sem migration; o documento passa à **versão 3**): a página deixa de ser uma lista de blocos com um bloco especial de colunas e passa a ser uma **árvore**. Um **contêiner** guarda outros blocos (inclusive outros contêineres, até 8 níveis, 200 blocos no total); seção pronta, título, parágrafo, botão, link e imagem entram em qualquer lugar. A biblioteca ganha **Estrutura** (seção, contêiner, linha, coluna, grade, 2 colunas, pilha), cada uma já com um estilo inicial **visível no painel de estilo**.
2. **Estilo tipado em cada bloco** (`style.ts`): layout (flex ou grade, direção, quebra, alinhamento, espaço entre os blocos, colunas), posição no contêiner (crescer, encolher, tamanho base), espaçamento (margem interna e externa por lado), tamanho (largura, altura, mínimos e máximos), tipografia (três famílias do sistema, tamanho, peso, altura da linha, espaço entre letras, alinhamento, caixa, decoração, cor), fundo (cor, imagem da biblioteca, tamanho, posição, repetir), borda, arredondamento, sombra, opacidade e o que fazer com o excesso. Cada propriedade aceita **uma lista fechada, um número numa faixa, um comprimento (`16px`, `50%`...) ou uma cor** (nome do tema, que segue claro e escuro, ou `#rrggbb`): **sem CSS, HTML ou JavaScript livres**. O servidor confere tudo de novo ao salvar.
3. **O CSS da página vem só desses valores.** `buildSiteCss` escreve uma regra por bloco com estilo (`.site .s-<id>`, o identificador do próprio bloco), a página pública **liga a folha de `/s/<endereço>/estilo.css`** (do próprio endereço, sem `style` nem `<style>` na página) e o editor e a prévia a escrevem na própria tela. Um teste joga valores hostis em cada propriedade e confere que nada fora de um alfabeto fechado sai.
4. **Editor.** O canvas é a página **exatamente como é publicada** (um contêiner guarda seus filhos direto, sem moldura em volta); a seleção, a passagem do mouse e a **linha de soltar** são uma camada por cima, **medida do que o navegador desenhou**. Arrastar da biblioteca, pela alça ou pelas **camadas (agora uma árvore, arrastável)**: entre dois blocos, dentro de um contêiner, em qualquer profundidade; um contêiner não entra nele mesmo. Sem arrastar: clicar na biblioteca coloca dentro do contêiner selecionado (ou depois do bloco selecionado), e há subir, descer, **sair do contêiner**, **entrar no de cima**, **agrupar**, **desagrupar** e duplicar. Painel à direita com **Conteúdo** e **Estilo**, trilha dos contêineres acima do bloco e um destino para botão e link (um contato ou outro bloco da página, por âncora).
5. **A versão 1 e a 2 continuam sendo lidas**: uma página publicada na 0.34 a 0.36 (inclusive com "2 colunas") continua sendo servida (lida como versão 3 em memória: as colunas viram uma linha de dois contêineres, com a mesma proporção e o mesmo empilhar quando estreita; o que está guardado não é tocado), e um rascunho antigo abre como versão 3 e é salvo como tal. Uma nova **largura da página** (estreita, larga, total) permite seções de ponta a ponta.
6. **Em aberto:** ver B24 (o que a 0.37 deixa de fora de propósito: posição absoluta, estados, outras fontes, contraste das cores livres) e C16 (conferir em produção). Próxima: **0.38, tamanhos de tela** (computador, tablet e celular com estilo por tamanho e "ocultar neste tamanho").

## Fatia entregue: imagens do Meu Site (0.36)

1. Implementado (migration 0025): no editor, **Enviar imagem** (o navegador redesenha, sem metadados, até 2000 px, JPEG ou PNG; o servidor confere a estrutura de novo e reescreve só o que desenha), uma **biblioteca** do site (até 60 imagens), o bloco **Imagem** (descrição obrigatória para quem não vê a imagem, legenda e tamanho) e o **logotipo** ao lado do nome. O mesmo renderizador serve o editor, a prévia e a página pública; muda só de onde vem a imagem.
2. Princípio: **uma imagem só é pública se a versão no ar a usa.** A página aponta para uma rota do próprio app, nunca para o bucket (o Webflow Cloud não tem bucket público), e a mesma origem continua sem nada de terceiros. Imagem só da biblioteca, de um rascunho ou de página tirada do ar responde 404, igual a endereço inexistente. Publicar confere que as imagens do rascunho ainda estão na biblioteca; uma imagem de versão publicada **não pode ser apagada**.
3. **Em aberto:** a prova real (o deploy criar `site-media` e uma imagem sair em produção: C15); retirar uma imagem já publicada (B23); autorização de uso de imagem de pessoas (J14); WebP e AVIF; recorte e foco; favicon.

## Fatia entregue: editor visual do Meu Site (0.35)

1. Implementado (sem migration): o usuário indicou, com um protótipo e um handoff (`docs/referencias/prototipo-editor-drag-drop.html` e `HANDOFF-EDITOR-DRAG-DROP.md`), que esperava o editor **visual, de arrastar e soltar**. Em `/profissional/meu-site`, "Abrir o editor visual" abre uma janela sobre a tela inteira: biblioteca de blocos e camadas à esquerda, **a página de verdade** no meio (o mesmo componente da prévia e da página pública) e as propriedades do que está selecionado à direita. Arrastar da biblioteca para a página, mover pela alça, **duas colunas** que recebem título, parágrafo e botão, escrever no texto com dois cliques, desfazer e refazer, computador e celular, prévia, salvar e publicar.
2. Princípio: **o contrato continua sendo a fonte da verdade.** O documento passou à versão 2 (sobre mim, depoimento com autorização, indicadores, 2 colunas, título, parágrafo, botão, etiqueta, cor e aparência de uma lista fechada) e **a versão 1 continua sendo lida**; nada de HTML, nada de link livre (os botões só levam a WhatsApp, e-mail ou Instagram); a imagem veio na 0.36. O banco, a publicação e a página pública não mudaram.
3. **Decisão:** o editor é próprio, sem Puck (ver `ESTRUTURA-E-PAPEIS.md`). O handoff recomendava o Puck; a decisão pode ser revista, porque a mudança ficaria só na camada de tela.
4. **Em aberto:** salvamento automático; arrastar com o dedo; auditoria de leitor de tela e teclado; Firefox e Safari; imagens (B20, B21).

## Fatia anterior: Meu Site (0.34)

1. Implementado: migration 0024 (`sites`, `site_drafts`, `site_releases`, `site_published`). Em `/profissional/meu-site` o proprietário ou a gestão monta a página com blocos (destaque, texto, serviços, perguntas frequentes e chamada para contato), salva o rascunho, confere a prévia e **publica**: a versão é imutável e o ponteiro do que está no ar muda no mesmo passo. Qualquer pessoa abre `/s/<endereço>`; dá para tirar do ar, voltar a uma versão e mudar o endereço (com o site fora do ar).
2. Princípio: **publicar é um ato à parte** (não é entregar treino, nem aprovar avaliação, nem confirmar pagamento) e o que está no ar só muda quando se publica de novo. O documento só tem texto e três contatos; os únicos links da página nascem desses contatos. **Sem formulário, imagem, pixel nem GTM**: a página divide a origem com o painel (R3) e por isso não carrega nada de terceiros.
3. **Em aberto:** domínio próprio, TLS e vários hosts (E0); imagens; mapa do site, canônico e dados estruturados; várias páginas e modelos; a regra de publicidade do profissional (J13). O editor de arrastar e soltar veio na 0.35. **Próxima fatia:** o formulário público que gera lead (era a 0.36), **fechado por padrão** até J8 e J12; depois das fatias do construtor (0.37 a 0.41).

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
