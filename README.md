# projeto-musculo — Trainer Prescription

Fundação de uma plataforma para personal trainers, construída para **Webflow Cloud Apps com banco SQLite nativo do próprio ambiente**. A decisão atual substitui a proposta Supabase dos documentos históricos; não existe dependência de Supabase na aplicação.

## Executar

Node.js 22.13+ (abaixo de 25), npm e o lockfile:

```sh
npm ci
npm run auth:setup:local
npm run db:migrate:local
npm run dev
```

`auth:setup:local` também cria o código de ativação do gestor (`PLATFORM_SETUP_TOKEN`, em `.dev.vars`/`.env.local`) e liga `DEMO_MODE`. Para ver a ferramenta pelos três papéis: abra `/demonstracao`, ou crie um profissional em `/cadastro`, convide um aluno e ative o gestor em `/gestor/ativar`.

O binding `DB` em `wrangler.json` fornece o banco. Não é necessário criar conta externa, token ou URL de banco. No desenvolvimento, os dados ficam em `.wrangler/state`; na publicação, o Webflow cria o recurso por ambiente e aplica as migrations. O identificador `local-trainer-prescription` é apenas local; o Webflow atribui o ID real no deploy.

## O que existe

- **Três áreas por papel**: gestor da ferramenta (`/gestor`), profissional de educação física (`/profissional`) e cliente/aluno (`/aluno`), cada uma com menu e autorização próprios. Menu do handoff V2; módulos ainda inexistentes aparecem como "Em breve". Veja [estrutura e papéis](docs/ESTRUTURA-E-PAPEIS.md).
- **Demonstração** (`/demonstracao`, `DEMO_MODE=true`): as três áreas com dados fictícios, sem criar conta.
- Identidade visual em **azul sólido**, sem degradê: Inter local, componentes arredondados, navegação móvel e contraste AA ([design system](docs/DESIGN-SYSTEM.md)).
- Cadastro profissional, login, logout e sessões persistidas via Better Auth + SQLite nativo.
- Provisionamento de organização e profissional; cadastro/lista/detalhe de alunos com atribuição técnica e auditoria atômicas.
- Convite de aluno de uso único (hash no banco, expiração, revogação) e área do aluno inicial.
- Ativação única do gestor com `PLATFORM_SETUP_TOKEN`; o gestor lista organizações, bloqueia/restabelece acessos e consulta a auditoria, sem ver dados de alunos.
- Interface responsiva com visão geral, mapa de produto e planejador de periodização.
- Planejador de 3/6/12 fases, 3–6 semanas, 1–7 sessões por semana, splits e duração real. Exportação JSON versionada como `DRAFT`.
- **Termos editáveis pelo gestor** (0.24): em `/gestor/termos`, o gestor muda o texto que alunos e profissionais aceitam, vê o que mudou e como será lido, e publica uma nova versão (imutável, com histórico, motivo e auditoria). Todos aceitam de novo no próximo acesso, e o aceite grava a versão e o hash do texto que a pessoa leu. O texto inicial é o aprovado pelo advogado em 25/10/2026.
- **Check-in do aluno** (0.23): em `/aluno/check-in`, um por dia, com esforço percebido, recuperação, relato de dor ou desconforto e observações. O profissional lê e registra a leitura, e vê na visão geral os não lidos com os relatos de desconforto primeiro. Nada é pontuado nem muda o treino, e a tela diz que não é um canal de urgência.
- **Aceite único dos termos** (0.20): o profissional aceita ao criar o espaço e o aluno ao aceitar o convite, uma vez, com as fotos como escolha à parte. Fica gravada a versão e o SHA-256 do texto. O texto foi **aprovado pelo advogado em 25/10/2026** (registro e perguntas em [`docs/REVISAO-JURIDICA.md`](docs/REVISAO-JURIDICA.md)) e, desde a 0.24, é editado pelo gestor.
- **Execução do treino pelo aluno** (0.15): em cada treino entregue o aluno registra o que fez (repetições e carga por série, RIR, esforço, dor ou desconforto, observações); o profissional vê o prescrito ao lado do executado e registra a leitura. Um relato de dor é guardado como foi dito e fica congelado; nada altera o plano automaticamente.
- **Minha conta** (0.18): troca de senha com a senha atual e encerramento das outras sessões, para profissional e aluno. A recuperação de senha por e-mail existe desde a 0.26 mas só liga com o e-mail configurado.
- **Registros por semana e carga por exercício** (0.16): o profissional vê, na execução do aluno, os treinos registrados em cada semana ao lado dos previstos e a maior carga digitada por exercício e dia. Só números e listas: sem porcentagem, meta nem julgamento, e semana sem registro não é falta.
- **Meu Site** (0.34 a 0.47): em `/profissional/meu-site` o proprietário ou a gestão monta a página pública num **editor visual de arrastar e soltar**, como uma **árvore de blocos** (desde a 0.37): arrasta seções prontas (destaque, texto, serviços, sobre mim, depoimento, indicadores, perguntas frequentes e chamada para contato), **contêineres** (seção, linha, coluna, grade) e elementos (título, parágrafo, botão, link e imagem) para qualquer lugar da página, inclusive para dentro de outros contêineres; vê a estrutura em **Camadas** e muda o **estilo** de cada bloco (organização, espaçamento, tamanho, tipografia, cor, fundo, borda e sombra) por campos com limites, sem escrever código; escreve direto no texto com dois cliques, escolhe a cor e a aparência (claro ou escuro), desfaz e refaz, vê a página **em três tamanhos de tela ao mesmo tempo** (computador, tablet e celular, lado a lado numa tela com zoom e movimento, como no Frappe Builder), muda o estilo de cada bloco **por tamanho** (o celular herda o tablet, que herda o computador), oculta um bloco num tamanho, e publica; a página publicada responde à largura da janela. Cada publicação é uma versão que não muda; dá para tirar do ar e voltar a uma versão. Desde a 0.36 há **imagens**: você envia JPEG ou PNG (limpas de metadados), usa num bloco Imagem ou como logotipo, e elas só ficam públicas se a versão no ar as usa (ficam num bucket privado e saem pela rota do próprio app, nunca de terceiro). A página fica em `/s/<endereço>`, aberta a qualquer pessoa, sem formulário nem rastreador: os botões levam só ao WhatsApp, e-mail ou Instagram que você informar. Na tela do editor há **alças** sobre o bloco escolhido (tamanho com guias de encaixe, margem interna, espaço entre blocos e arredondamento), **seleção de vários blocos** (Ctrl, Shift e um laço com Shift), copiar, recortar e colar blocos e estilo, menu de contexto e atalhos, e o nome das camadas. Na biblioteca há ainda o grupo **Modelos**, com seis seções prontas (barra de navegação, rodapé, 3 destaques, imagem e texto, planos e depoimentos): são contêineres e elementos comuns, que você edita como qualquer outro bloco, já ajustados aos três tamanhos de tela e **sem texto inventado** (você escreve o seu). Você pode guardar um bloco como **componente** (menu do botão direito, “Criar componente”) e usá-lo em vários lugares: cada uso muda só o texto, o botão e a imagem que o componente deixa abertos, e **editar o componente** muda todos os usos de uma vez (“Concluir edição” volta à página). A aparência da página tem a cor de destaque (da lista, ou **a cor da sua marca**, que o sistema ajusta só o quanto for preciso para o texto ficar legível), o modo claro, escuro ou **automático** (segue o aparelho de quem visita), a fonte e a largura; e você pode pedir aos buscadores que **não listem** a página (ela continua aberta a quem tem o endereço). Desde a 0.43 o site pode ter **várias páginas** (aba **Páginas** da biblioteca): cada uma com o seu endereço (`/s/<endereço>/<página>`), título e descrição para buscadores, no **menu** do cabeçalho ou fora dele, e um botão ou link pode levar a outra página; a página aberta se edita com as mesmas ferramentas, e a prévia navega entre elas. Desde a 0.44 cada **versão publicada** pode ser vista como foi publicada (com as suas páginas) e **comparada** com outra versão ou com o rascunho: a tela lista o que mudou (o site, cada página, os blocos acrescentados, removidos, mudados ou movidos, os componentes) e marca na página, em verde e em laranja, o que é novo e o que mudou; voltar a uma versão continua sendo "Usar como rascunho". Desde a 0.45 dá para **começar com um site completo** (início, sobre mim, serviços, perguntas frequentes e contato, com menu) e, no editor, acrescentar **páginas prontas** (sobre mim, serviços e planos, perguntas frequentes, depoimentos e contato): os modelos trazem os blocos e os nomes, **nunca o texto**, que a pessoa escreve. O editor **salva o rascunho sozinho** depois de uma pausa (a caixa "Salvar sozinho" desliga; um conflito com outra aba o para e avisa). Desde a 0.47 há o bloco **"Formulário de contato"**, **fechado por padrão** (só aparece na página publicada se a plataforma abrir os formulários públicos, com o aviso de privacidade público configurado, **e** o site ligar o recebimento): as mensagens esperam em **Leads › Mensagens do site** até o profissional virar lead (origem "Site") ou apagar. Ao publicar, o que está incompleto aparece como **aviso** (e você pode **publicar mesmo assim**); só impedem o site sem título, a página sem bloco e o depoimento sem a autorização da pessoa.
- **Serviços e Leads** (0.33): em `/profissional/servicos` o profissional cadastra o que vende; em `/profissional/leads` registra os interessados (nome, contato, origem, serviço), os move pelo funil (novo, em contato, avaliação ou conversa, proposta, contratado, ou perdido com motivo) e converte um lead contratado em aluno sem duplicar. Um lead não guarda dado de saúde. O formulário de contato da página pública (0.47) está construído e **fechado por padrão**; as mensagens dele esperam em `/profissional/leads/mensagens` até o profissional virar lead ou apagar.
- **Aparelhos conectados e entradas recentes** (0.32): em Minha conta (profissional, aluno e gestor), a pessoa vê onde a conta está aberta, desconecta um aparelho específico e lê as últimas entradas (só data e hora). O IP e o texto do navegador não aparecem.
- **Verificação em duas etapas** (0.31): opcional, para profissional e gestor, em Minha conta (`/profissional/conta` e `/gestor/conta`). Com um aplicativo autenticador (QR ou chave digitada) e 10 códigos de recuperação mostrados uma vez; só vale depois de digitar um código. Ao entrar, a senha sozinha não abre a sessão. Quem perdeu o celular e os códigos pede ao gestor da plataforma, que redefine a etapa depois de confirmar a pessoa por outro canal. Não há código por e-mail nem por SMS.
- **Rascunho dos termos** (0.30): o gestor guarda o texto em edição no servidor (um rascunho por público, compartilhado entre gestores), continua depois e descarta se quiser. Salvar não publica nada nem muda o que ninguém aceitou. Publicar e salvar por cima só valem se ninguém publicou ou salvou nada diferente desde que a página abriu.
- **Configurações** (0.29): em `/profissional/configuracoes` o proprietário corrige o nome do espaço e cada profissional o próprio nome de exibição (o aluno vê os dois no convite e na área dele), e uma lista só de leitura mostra quem tem acesso. Convidar equipe e dar papéis ainda não existe: depende do e-mail verificado.
- **Baixar meus dados** (0.28): em `/aluno/conta` o aluno baixa, na hora, um arquivo JSON com o que a ferramenta mostra a ele (acesso, aceites, check-ins, treinos registrados, treino entregue e pedidos). Não inclui a ficha, as avaliações, as fotos nem as anotações do profissional, e o arquivo diz isso. Cada download fica na trilha (nunca o conteúdo), com limite de 6 por hora.
- **Mais de um gestor** (0.27): em `/gestor/gestores` um gestor convida outro por link de uso único (48 horas; o papel vem do link e da conta, nunca do e-mail) e pode encerrar o acesso de outro, nunca o próprio. O gestor vê também, só em contagens, os pedidos de titulares em aberto e atrasados por organização.
- **Recuperação de senha por e-mail** (0.26; **desligada até a AWS estar configurada**): "Esqueci minha senha" com link de 1 hora e uso único que encerra todas as sessões, enviado pelo Amazon SES, igual para quem tem e quem não tem conta, com limites. Sem as cinco variáveis da AWS nada aparece e os endpoints respondem 404; o passo a passo está em `docs/WEBFLOW-CLOUD.md`. Nunca foi enviado e-mail de verdade.
- **Pedidos do titular** (0.25): em "Minha conta" o aluno pede cópia dos dados, correção, apagar as fotos, exclusão ou retirada do aceite, com prazo de 15 dias; o profissional vê a fila e responde, e a ferramenta apaga as fotos quando ele confirma (o arquivo some, a avaliação registrada diz que a foto foi apagada a pedido). Não avisa por e-mail. A cópia do que o aluno vê é baixada na hora (0.28); a do registro técnico do profissional ainda é respondida à mão.
- **Fotos de postura** (0.14; **abertas em produção desde a 0.24.1**, com o texto aprovado: cada foto exige a autorização do próprio aluno; conferir `/api/health` = `"photos": "open"` depois do deploy): quatro vistas por avaliação, no Object Storage do Webflow, só visíveis ao profissional com vínculo técnico, sem metadados do aparelho e imutáveis depois do registro. Desde a 0.21 exigem a **autorização do próprio aluno**, dada ao aceitar os termos e que ele autoriza ou retira quando quiser em Minha conta (0.22); o profissional não a substitui. Não aceitam menor de 18. A base legal e o texto seguem em aberto.
- **Evolução das avaliações** (0.13): em `/profissional/alunos/<id>/evolucao`, cada indicador ao longo do tempo (gráfico acessível e tabela) e o que mudou entre avaliações na triagem, na postura e no movimento. Descreve, não julga.
- **Postura e movimento** (0.12): dentro da avaliação, os achados posturais das três vistas e os nove testes de movimento com a escala do documento mestre. Registro, não diagnóstico; não altera a triagem. Sem fotos por enquanto.
- **PDF do plano entregue** (0.11): gerado no servidor para a revisão entregue, com versão, data, profissional e links de vídeo clicáveis. O profissional e o aluno baixam o mesmo arquivo; cada download é auditado.
- **Avaliações e triagem** (0.10): registros datados com os seis itens de triagem do documento mestre e indicadores de base (FC de repouso, pressão como registrada, cintura, % de gordura e medidas livres). Qualquer item marcado dá "Revisão obrigatória antes da entrega.": bloqueia aprovar e entregar até o profissional registrar a revisão, com a base escrita por ele. Avaliação registrada é imutável também no banco; "nenhum sinal marcado" não é liberação clínica. Conteúdo do instrumento a conferir com o responsável técnico.
- **Ficha do aluno** (0.9): identificação, contexto de treino, histórico e preferências, com os campos do documento mestre. Só o profissional com vínculo técnico vê; menores são sinalizados; base legal e consentimento seguem em aberto.
- **Aprovação e entrega** (0.8): o profissional aprova (com o aviso de triagem não registrada) e entrega; o aluno vê só a revisão entregue em `/aluno/treino`. Revisão fechada é imutável também no banco, por gatilhos.
- **Painel de Prescrição** (0.7): lista a revisão mais recente de cada plano com as pendências por alvo, e permite copiar um mesociclo inteiro para uma fase sem exercícios.
- **Prescrição manual** (0.6): dentro do plano salvo de cada aluno, o profissional monta os exercícios por mesociclo e treino, digitando cada valor. Nada é sugerido nem preenchido; abaixo do alvo é pendência. Revisão pronta congela, e a nova revisão leva os exercícios.
- **Biblioteca de exercícios** (0.5a): 64 exercícios do documento mestre como biblioteca do sistema (os vídeos são links de busca, não vídeos revisados) e biblioteca própria da organização, com revisão de vídeo deliberada.
- **Planos salvos por aluno** (0.4): o planejador grava a estrutura do ciclo no cadastro do aluno, em revisões (Rascunho → Estrutura pronta). "Pronta" valida o calendário; **não** é aprovação nem libera nada ao aluno. Mudar uma revisão pronta cria uma nova.
- Tabelas nativas: `users`, `organizations`, `memberships`, `professionals`, `students`, `care_assignments`, `student_access`, `platform_admins`, `student_invites`, `access_audit_events` e controle de versão do schema.
- Repositories de leitura com organização, vínculo técnico/aluno, revogação e bloqueio de identidade em cada consulta.
- `/api/health` consulta de verdade a versão do schema no binding `DB`; retorna 503 se o banco/migration não estiver disponível.
- Configuração Next/OpenNext, testes e CI para raiz/subcaminho.

O planejador ainda não grava prescrições no banco. Verificação de e-mail, recuperação de senha, envio de e-mails, postura e movimento, execução do treino pelo aluno, sites, financeiro e integrações continuam no roadmap. Cada página e ação exige sessão validada e papel derivado no servidor.

## Validar

```sh
npm run check
npm run db:check:local
npm run build:cloud
npm run preview:cloud
```

Com o Worker ativo, em outro terminal:

```sh
SMOKE_ORIGIN=http://127.0.0.1:8787 npm run smoke
npm run test:e2e
```

Para o navegador, execute `npx playwright install chromium` ou use `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium` se já instalado. Os testes de banco usam D1 real em um runtime Miniflare isolado; não há PostgreSQL/PGlite. Há testes de identidade controlada e também de login/sessões reais; Playwright cobre o fluxo completo em duas organizações.

## Estrutura

```text
src/app/                 rotas por área: (publico), gestor, profissional, aluno, demonstracao, api
src/components/          moldura por papel, componentes de interface
src/modules/             auth, plataforma (navegação por papel), gestor, convites, portal, demo, planejador
src/db/                  binding do servidor e repositories autorizados
migrations/              migrations SQLite aplicadas pelo Webflow
cloudflare-env.d.ts       tipos do binding DB
wrangler.json            configuração dos recursos nativos
scripts/                 smoke tests HTTP
tests/                  testes de domínio, D1 e navegador
docs/referencias/        documentos originais e referência visual preservados
```

## Documentação

- [Estrutura por papéis e conciliação com o handoff V2](docs/ESTRUTURA-E-PAPEIS.md)
- [Arquitetura atual](docs/ARQUITETURA-WEBFLOW-CLOUD.md)
- [Design system](docs/DESIGN-SYSTEM.md)
- [Banco e publicação no Webflow](docs/WEBFLOW-CLOUD.md)
- [Roadmap](docs/ROADMAP-IMPLEMENTACAO.md)
- [Pendências: o que está aberto e quem destrava](docs/PENDENCIAS.md)
- [Evidências de validação](docs/VALIDACAO.md)

**Próxima fatia:** verificação de e-mail, recuperação de senha e envio de e-mails (aguardam o provedor de envio); depois a execução do treino pelo aluno. A etapa atual não fecha o piloto operacional.

No Webflow, configure `AUTH_SECRET` (aleatória, ao menos 32 caracteres), `AUTH_ORIGIN` (origem HTTPS privada, sem caminho) e `PLATFORM_SETUP_TOKEN` (32+ caracteres, para ativar o primeiro gestor). `DEMO_MODE=true` é opcional. Em subcaminho, configure `BASE_URL` no build. Veja [configuração de acesso](docs/AUTENTICACAO.md) e [decisões visuais](docs/DESIGN-SYSTEM.md).
