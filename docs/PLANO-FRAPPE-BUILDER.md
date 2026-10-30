# Plano: o Frappe Builder de verdade dentro do Meu Site

Pedido do usuário (30/10/2026): o editor do Meu Site estava "muito rígido" (cabeçalho automático, sem logotipo à mão, cores travadas, formulário fixo, sem excluir nem recomeçar o projeto) e **não conversava com o Frappe Builder que ele conectou para ser usado**. Decisões dele, por pergunta direta:

1. **Caminho:** embutir o **Frappe Builder de verdade** (o editor Vue dele), com um adaptador nosso no lugar do backend Frappe.
2. **Código livre:** CSS, cores e estilos **totalmente livres**; HTML e JavaScript livres **só dentro de um bloco isolado** (`iframe` com `sandbox`, sem acesso ao painel nem às sessões).

O editor próprio (React, estilos tipados, 0.35 a 0.49) **fica no ar como reserva** até o novo cobrir o mesmo; nenhum site existente é tocado até o profissional pedir.

## O que foi verificado (viabilidade, 30/10/2026)

- **Licença:** MIT (`LICENSE` do `rafsoaresm/builder`, Frappe Technologies). Podemos copiar, alterar e distribuir, mantendo o aviso. Não há copyleft.
- **Código:** o clone está em `/home/user/rafsoaresm/builder` (commit `4338888`, `develop`). O frontend é um app **Vue 3 + Vite + Pinia + frappe-ui**, com cerca de **49 mil linhas**. O pacote `@framework/ui`, que o clone não traz, vem de `frappe/frappe` (pasta `ui`, commit `5a8bfd7`), buscado por checkout parcial. `yarn install` precisa de `CYPRESS_INSTALL_BINARY=0` (o proxy bloqueia o binário).
- **Compila:** `npx vite build` termina em poucos segundos e gera **8,6 MB** (cerca de 2,5 MB comprimidos) em `builder/public/frontend`.
- **O backend é pequeno e plugável.** O editor fala com o servidor por uma única função (`setConfig("resourceFetcher", …)`), e o próprio projeto já traz um backend de demonstração em memória (`utils/editorDemoBackend.ts`, 76 linhas). As chamadas do caminho principal: `frappe.client.get`, `get_list`, `insert`, `set_value`, `delete`, `rename_doc`, `has_permission`, `run_doc_method` (métodos da página), mais `builder.api.*` (upload de ativos, componentes, modelos, versões, scripts do cliente, duplicar, pastas). O resto é opcional e será desligado: IA (`builder.ai.*`), plugins (`builder.plugins.*`), analytics, convites de usuário, `socket.io`, domínios.
- **Prova:** com um servidor de mentira (`scripts/frappe-editor-spike/stub-server.mjs`), o editor abriu no Chromium: o painel de páginas, o "Novo", **uma página criada do zero, a árvore de camadas, um contêiner desenhado na tela e o painel de propriedades completo** (layout em pilha ou grade, tipografia, fundo com cor em hexadecimal, cor do texto, borda, sombra e raio). Nada disso existe no nosso editor atual.
- **O que o stub precisou além do óbvio** (vira requisito do adaptador): `page_name` e `route` gerados na criação da página; `blocks` e `draft_blocks` guardados como **texto JSON**; singletons (`Builder Settings`, `Website Settings`) respondendo sem erro; respostas fixas para as consultas de IA, plugins e modelos.

## Arquitetura

- **Onde fica:** uma rota do Next, `/profissional/meu-site/editor/**` (só proprietário e gestão, sessão verificada no servidor), devolve o HTML do editor (o `_builder.html` do Frappe, sem Jinja) e os arquivos estáticos ficam em `public/frappe-editor/`. O app Vue é dono do documento inteiro.
- **Caminhos:** nada de `/api` nem `/assets` fixos no navegador. O editor lê `window.builder_path` (base do roteador) e usaremos uma base de API e de ativos injetadas pela rota, para funcionar sob `/app` e `/treinador`. Ajustes no código do Frappe entram como **patches** em `vendor/frappe-builder/patches/`, aplicados por um script reproduzível (`scripts/build-frappe-editor.sh`, com os commits fixados do `builder` e do `frappe`); o resultado compilado é versionado (a compilação não pode rodar no build do Webflow Cloud, que só clona este repositório).
- **Adaptador no servidor:** rotas do Next que implementam o subconjunto acima sobre **D1** e **R2** (`SITE_MEDIA`), com a organização e o papel **sempre da sessão**, nunca do que o editor mandar. Os documentos do Frappe (`Builder Page`, `Builder Component`, `Builder Variable`, `User Font`, `Block Template`, `Builder Settings`…) ficam num armazenamento genérico por organização (`doctype`, `name`, JSON), com lista fechada de tipos, tamanho máximo por documento e filtros limitados. Migrations só aditivas.
- **Publicar:** o botão "Publish" copia o rascunho para a versão publicada e **gera o HTML e o CSS no servidor** (porte para TypeScript do renderizador `builder/utils.py`, sem a parte de dados em Python, que não roda em Workers). Resultado guardado e servido em `/s/<slug>/…`, com a política de conteúdo atual.
- **Segurança do conteúdo livre:** o CSS é gerado a partir dos estilos estruturados do bloco, com propriedades e valores conferidos (sem `@import`, sem `url()` de fora, sem `expression`); imagens e fontes só da biblioteca do site (nada de terceiros: as Google Fonts do Frappe ficam desligadas); **HTML e JavaScript livres só no bloco "Código" dentro de `iframe sandbox` sem `allow-same-origin`**, e os "scripts do cliente" da página rodam só ali. O texto de privacidade (J8) não muda.
- **Formulário (o ponto 1 do pedido):** um bloco "Formulário" com **campos escolhidos pela pessoa** (texto, e-mail, telefone, mensagem, lista, caixa de marcar; obrigatório ou não), que envia para a caixa de entrada de Leads já existente (0.47), com campo-isca, limite por remetente e consentimento. Continua **fechado por padrão** até J8, J12 e J15.
- **Excluir e recomeçar (o ponto 2):** na tela Meu Site, "Excluir o site" e "Recomeçar do zero", com confirmação digitada, registro de auditoria e limpeza dos ativos do R2.
- **Navbar e logotipo (o ponto 3):** deixam de ser coisa do sistema e viram **blocos** como qualquer outro; entram como **modelos prontos** (barra de navegação com logotipo, rodapé, os layouts da 0.49 convertidos para blocos do Frappe).
- **Cores (o ponto 4):** o seletor de cor do Frappe (roda e hexadecimal) vale em todo bloco e nas variáveis da página; **sem ajuste automático do que a pessoa escolheu** (contraste vira aviso, nunca bloqueio).

## Fatias

| Fatia | O quê | Fica pronta quando |
| --- | --- | --- |
| F1 | Compilação reproduzível (script, patches, versão fixada), editor servido pela rota do Next, caminhos de qualquer mount | abre em `/profissional/meu-site/editor` nos dois mounts, sem chamada fixa a `/api` |
| F2 | Adaptador D1 do subconjunto principal: páginas (criar, abrir, salvar, renomear, duplicar, excluir), pastas, configurações, variáveis; permissões por organização | criar e reabrir uma página com blocos, com testes de isolamento entre organizações |
| F3 | Ativos no R2 (upload, imagens, fontes enviadas, conversão para WebP) | imagem enviada aparece no editor e na página publicada |
| F4 | Publicar: renderizador em TypeScript, CSS gerado, saneamento, rota pública | página publicada igual à do editor, sem nada de terceiros, com teste de saneamento |
| F5 | Componentes, modelos de bloco e de página (inclui navbar com logotipo, rodapé e os layouts da 0.49) | modelos na criação de página |
| F6 | Formulário com campos configuráveis ligado à caixa de entrada de Leads | envio gerando mensagem com os campos, ainda fechado por padrão |
| F7 | Bloco "Código" isolado (`iframe sandbox`) e scripts do cliente isolados | teste de que o código não alcança cookies nem a página |
| F8 | Excluir e recomeçar o projeto; escolha do editor por site; convivência com o editor atual | site novo no editor novo, antigo intacto até o profissional trocar |
| F9 | Conversão opcional de um site do editor atual (documento v3) para blocos do Frappe | só se o usuário pedir |

## Não verificado até aqui

Tudo o que não seja "o editor abre e funciona contra um stub": salvar e reabrir de verdade, ativos, publicação, mount path, isolamento entre organizações, desempenho do editor no celular, e o comportamento do editor sob a política de conteúdo (CSP) do app. A compilação aqui é feita com versões fixadas do `builder` e do `frappe`; atualizar o Frappe no futuro significa refazer os patches.
