# Pendências

O que está aberto, quem destrava e onde cada coisa está contada em detalhe. **Este é o lugar onde as pendências ficam guardadas**: ao abrir uma, escreva aqui; ao fechar, risque e diga em qual fatia. Os detalhes de cada decisão estão em [`REVISAO-JURIDICA.md`](REVISAO-JURIDICA.md), [`VALIDACAO.md`](VALIDACAO.md) e [`ROADMAP-IMPLEMENTACAO.md`](ROADMAP-IMPLEMENTACAO.md); aqui só o que falta e quem tem de agir.

Quem: **Responsável** (dono do produto: contas, domínios, decisões), **Advogado**, **Técnico** (responsável técnico em educação física: conteúdo clínico), **Código** (o que se constrói sem esperar ninguém).

Estado conhecido em 27/10/2026: a 0.25.0 está no ar, com as migrations até a 0017 aplicadas (conferido no log do deploy). A 0.26.0 (recuperação de senha por e-mail, migration 0018) foi implantada com sucesso e `0018_email_messages.sql ✅` aparece no log; a 0.27.0 (mais de um gestor, migration 0019) também foi implantada com sucesso (commit `e7788ef`) e `0019_platform_admin_invites.sql ✅` aparece no log do deploy. A 0.28.0 ("Baixar meus dados", sem migration) também foi implantada com sucesso (commit `2298dce`; não há linha de migration nova no log, porque não há migration). A 0.29.0 (Configurações do profissional, sem migration) também foi implantada com sucesso (commit `0ff37a0`). A 0.30.0 (rascunho dos termos, migration 0020) também foi implantada com sucesso (commit `c44faac`) e `0020_terms_drafts.sql ✅` aparece no log do deploy. A 0.31.0 (verificação em duas etapas, migration 0021) também foi implantada com sucesso (commit `f5a6dce`) e `0021_two_factor.sql ✅` aparece no log do deploy. **Nada foi lido ao vivo**: o ambiente onde o código é escrito não alcança `projeto-musculo.webflow.io`.

## 1. Depende do Responsável (conta, domínio, decisão)

| # | O que falta | Por que importa | Onde está |
|---|---|---|---|
| R1 | **Configurar a AWS (Amazon SES)** e as variáveis do e-mail no painel do Webflow; depois conferir o primeiro envio real | Sem isso quem perde a senha perde a conta, e nenhum aviso por e-mail existe. A recuperação está construída e desligada | `WEBFLOW-CLOUD.md`, seção "E-mail" |
| R2 | Ao ligar o e-mail, **trocar em `/gestor/termos`** a frase do termo do profissional "Ainda não existe recuperação de senha por e-mail" | Passa a ser falsa; a troca gera versão nova e todos aceitam de novo | `REVISAO-JURIDICA.md` §5.2 e §7 item 6 |
| R3 | **Portal do aluno em origem privada separada** do painel | Documentado como condição antes de dados reais de alunos; hoje compartilham a origem. Exige domínio ou host no Webflow | `AUTENTICACAO.md` ("Limites desta fatia"), `AGENTS.md` |
| R4 | **Escolher o meio de cobrança** e os planos | "Planos e cobrança" e "Afiliados" são "Em breve": hoje ninguém consegue pagar a ferramenta | `ROADMAP-IMPLEMENTACAO.md` (E6), `surfaces.ts` |
| R5 | Confirmar se **`DEMO_MODE=true` em produção** é de propósito | A demonstração com dados fictícios fica pública no mesmo endereço do app | variável do ambiente |
| R6 | Conferir na aba **Storage** do Webflow que o bucket `photos` não tem endereço público | Imagem de saúde; a documentação do Webflow diz que bucket público não existe, mas a conferência é sua | `WEBFLOW-CLOUD.md` |
| R7 | **Publicar o texto citando o check-in**, se o advogado concordar (pergunta 12) | O texto aprovado não cita o check-in nem a recuperação (R2) | `REVISAO-JURIDICA.md` §8 |
| R8 | Escolher o **canal e o responsável pelo titular** (encarregado/DPO) e um plano de resposta a incidentes | Hoje não existem | `REVISAO-JURIDICA.md` §7 item 8 |
| R9 | **Contrato de operação** entre a plataforma e o profissional | Não existe | `REVISAO-JURIDICA.md` §7 item 8 |
| R10 | **O texto aprovado diz uma coisa que deixou de ser verdade**: tanto o do aluno ("Os seus direitos") quanto o do profissional ("Pedidos do aluno") afirmam "Hoje a ferramenta ainda não tem uma tela para esses pedidos". Desde a 0.25 o aluno faz os pedidos em Minha conta e desde a 0.28 baixa uma cópia do que vê | Quem aceita lê uma frase falsa. Trocar o texto exige o aval do advogado e gera versão nova: junte com R2 e R7 numa só publicação para ninguém aceitar três vezes. O editor com rascunho (0.30) serve para preparar o texto antes | `REVISAO-JURIDICA.md` §5.2 e §7 item 6a; `/gestor/termos` |
| R11 | **Decidir se a verificação em duas etapas passa a ser obrigatória** para o gestor da plataforma (e, depois, para o profissional) | Hoje é opcional (0.31): uma conta de gestor com senha fraca ou vazada ainda entra só com a senha, e o gestor vê todas as organizações. Obrigar exige uma regra de transição (quem já é gestor, quem perde o celular) e depende de R1 para a pessoa se recuperar sem outro gestor | `AUTENTICACAO.md`, "Verificação em duas etapas" |

## 2. Depende do Advogado (pacote em `REVISAO-JURIDICA.md`)

| # | Pergunta | Estado |
|---|---|---|
| J1 | Controlador e operador (profissional e plataforma; a AWS e o Webflow como operadores) | Hipótese escrita, sem resposta |
| J2 | **Menores de 18 anos**: caminho mínimo e seguro (responsável legal, fotos) | A ferramenta bloqueia foto e pede confirmação de 18 anos; sem desenho aprovado |
| J3 | **Retenção**: prazo (proposta: ~5 anos; menor para fotos) e o que a lei manda manter para o profissional | Nada apaga ou anonimiza hoje |
| J4 | **Exclusão de registro congelado** (treino entregue, avaliação registrada) | Só as fotos têm exceção construída (0.25); o resto é respondido em palavras |
| J5 | **Fotos já guardadas** quando o aluno retira a autorização: apagar na hora ou manter | O aluno pede "apagar as minhas fotos" e o profissional atende, mas a regra geral não está decidida |
| J6 | **Retirada do aceite** dos termos como um todo: efeito sobre os dados | Só existe como pedido respondido em palavras |
| J7 | Transferência internacional: dados em infraestrutura do Webflow/Cloudflare e e-mail pela AWS, em regiões que não escolhemos | Perguntar ao Webflow onde ficam os dados e as cópias |
| J8 | **Aviso de privacidade** completo, separado dos termos e público antes do cadastro | Hoje é um texto só, mostrado na entrada |
| J9 | Prazo de descarte dos registros técnicos (IP e navegador das sessões, `email_messages`, logs) | Sem prazo |
| J10 | Base legal para dados e imagens de saúde (consentimento específico e destacado, como desenhado) | Proposta aprovada pelo responsável; falta o parecer |

## 3. Depende do Técnico (conteúdo clínico: não será inventado)

| # | O que falta |
|---|---|
| T1 | **Conferir o instrumento de triagem** (os seis itens vieram do documento mestre, não de validação clínica) e definir quais sinais colocam a avaliação em revisão |
| T2 | Confirmar a **escala de esforço** (RIR por exercício e 0 a 10 por sessão) e as janelas (24 horas para corrigir, 14 dias para registrar depois) |
| T3 | Definir **aderência**: tolerância, semana de descanso, viagem ou lesão fora da conta, metas por aluno, porcentagem por treino (A, B, C) |
| T4 | **Faixas de referência e metas** dos indicadores; pressão separada em sistólica e diastólica |
| T5 | O que fazer com um **relato de dor** (hoje só se guarda e se mostra) e se "interrompido por dor" conta como sinal de triagem |
| T6 | **Política de resposta ao check-in** do aluno e a escala de recuperação em palavras (foi escolha do código) |
| T7 | O que entra no **PDF** do plano: objetivo e gênero (ficaram de fora por privacidade), CREF (não há campo), logotipo |

## 4. Conferir em produção (não verificado até aqui)

| # | Conferência |
|---|---|
| C1 | `https://projeto-musculo.webflow.io/app/api/health`: versão `0.31.0`; `"photos": "open"`; `"passwordRecovery": "not_configured"` até R1 |
| C2 | Se `"photos": "closed"`: criar `PHOTOS_ENABLED=true` como variável do ambiente (a documentação do Webflow diz que `vars` do `wrangler.json` são ignoradas) e publicar de novo |
| ~~C3~~ | ~~Após o deploy da 0.26 e da 0.27: `0018_email_messages.sql ✅` e `0019_platform_admin_invites.sql ✅` no log do deploy~~ **Conferido em 26/10/2026** nos dois deploys |
| C4 | Depois de R1: pedir um link para uma conta de teste (no sandbox da AWS, um endereço verificado), abri-lo e entrar com a senha nova; se a AWS recusar, o código fica em `email_messages.error_code` |
| C5 | Primeiro uso real das fotos: subir uma foto de teste de um aluno de teste que autorizou, conferir a leitura só pelo profissional e pedir para apagar |
| C6 | Quem já tinha aceitado os termos vê a tela de aceite de novo (a versão mudou de nome na 0.24) |
| C7 | Com um aluno de teste em produção: abrir Minha conta, tocar em **Baixar meus dados**, abrir o arquivo e conferir que traz só o que ele vê (e nada da ficha nem das avaliações); em `/api/health` a versão `0.28.0` |
| C8 | Em produção, em `/profissional/configuracoes`: corrigir o nome do espaço e o nome de exibição de uma conta de teste e ver o nome novo na área de um aluno de teste; `/api/health` com a versão `0.29.0` |
| C9 | ~~`0020_terms_drafts.sql ✅` no log do deploy~~ **Conferido em 27/10/2026.** Falta, em `/gestor/termos` salvar um rascunho, recarregar e achá-lo; `/api/health` com a versão `0.30.0` (**não publique nada para testar: publicar pede novo aceite a todos**) |
| C10 | ~~`0021_two_factor.sql ✅` no log do deploy~~ **Conferido em 27/10/2026.** Falta `/api/health` com a versão `0.31.0`. Com uma conta de teste (**não** a do gestor real, até a conferência): ligar a etapa em `/profissional/conta` **lendo o QR com um aplicativo autenticador de verdade** (nenhum foi usado até aqui, só um gerador de código da suíte), sair, entrar com o código, entrar com um código de recuperação, e pedir ao gestor que redefina |

## 5. Construir agora (Código; não depende de ninguém)

| # | O que | Observação |
|---|---|---|
| ~~B1~~ | ~~"Baixar meus dados": cópia dos dados do aluno, gerada pela ferramenta~~ **Feito na 0.28, só com o que o aluno já vê** (acesso, aceites, check-ins, treinos registrados, treino entregue, pedidos). O registro técnico do profissional continua respondido à mão: ver B13 | `ROADMAP-IMPLEMENTACAO.md` (0.28) |
| ~~B2~~ | ~~Segundo gestor por convite de uso único~~ **Feito na 0.27.** Resta o caminho no banco para o último gestor perdido (não testado) | `AUTENTICACAO.md`, "Mais de um gestor" |
| ~~B3~~ | ~~O gestor vê pedidos do titular atrasados por organização~~ **Feito na 0.27** (só contagens) | |
| ~~B4~~ | ~~Editor dos termos: rascunho no servidor; prévia do efeito nas pessoas que já aceitaram~~ **Feito na 0.30** (a prévia do efeito, "as N pessoas que aceitaram terão de aceitar de novo", já existia desde a 0.24). Fora do rascunho: voltar/avançar do navegador não pergunta, só recarregar, fechar e os links da página | `ROADMAP-IMPLEMENTACAO.md` (0.30) |
| B5 | **Retirada do aceite dos termos** como ação do aluno | Hoje é só um pedido (depende em parte de J6) |
| B6 | **Documentos** do aluno: PDFs de plano que o profissional compartilhou | O PDF e o armazenamento privado já existem. **Parada em 27/10/2026 por falta de decisão, não por falta de código:** hoje o aluno já baixa o PDF da revisão entregue no próprio treino (uma lista de documentos o repetiria) e mostrar revisões substituídas pede uma decisão do Técnico sobre o que o aluno deve poder reler |
| ~~B7~~ | ~~Configurações do profissional (dados do espaço)~~ **Feito na 0.29** (nome do espaço, nome de exibição e quem tem acesso, só leitura). Equipe, papéis e permissões seguem em D4 | `ROADMAP-IMPLEMENTACAO.md` (0.29) |
| B8 | Check-ins: campos configuráveis pelo profissional; check-in de dias anteriores; o profissional responder ao aluno | Hoje só registra a leitura |
| B9 | Trilha de auditoria de **login e leitura** | Hoje cobre criação, ativação, bloqueio, convite, revogação, pedidos e fotos |
| B10 | Fotos: **anotação sobre a imagem**; geração do PDF com pendências | Constam como critério restante de E2 |
| B11 | ~~MFA~~ **Feito na 0.31** (opcional; ver R11, B16). Resta a **política de senha contra vazamentos** (o plugin `haveIBeenPwned` da biblioteca existe e não está ligado) | Consulta um serviço de terceiros, mesmo enviando só o início do hash da senha: decidir com o Responsável e o advogado antes de ligar |
| B12 | Rotina de **retenção** (depende de J3, mas o mecanismo se constrói antes) | Nada apaga hoje |
| B13 | **Cópia do registro técnico** do profissional (ficha, avaliações, anotações sobre check-ins e treinos) para o titular | Falta o advogado dizer o que se entrega e como (J1, J4). Enquanto isso o aluno pede e o profissional responde à mão |
| B14 | **Formato legível** da cópia (página ou PDF) para quem não lê JSON | Hoje só o JSON; a tela explica que abre em um editor de texto |
| B15 | Guardar **o nome de quem entregou no momento da entrega** e o **histórico de nomes anteriores** do espaço e do profissional | Hoje o nome é lido na hora: renomear muda como as entregas já feitas dizem quem as entregou (o conteúdo não muda). Exige migration aditiva e decide-se com o advogado se o nome da entrega deve ser fixo (J1) |
| B16 | **Último gestor sem celular e sem códigos**: ninguém na ferramenta redefine a etapa dele (o gestor não redefine a si mesmo) | Hoje só mexendo no banco (zerar `auth_user.two_factor_enabled` e apagar a linha em `auth_two_factor` e as sessões da pessoa), e isso **não foi testado**. Juntar com o caminho do último gestor perdido (B2) e com R1 |

## 6. Construir depois de outra pendência

| # | O que | Espera |
|---|---|---|
| D1 | **Verificação do e-mail** no cadastro e **troca de e-mail** | R1 |
| D2 | **Avisos por e-mail**: a verificação em duas etapas ligada, desligada ou redefinida; relato de desconforto, pedido do titular, lembrete de prazo, aviso de que uma cópia dos dados foi gerada | R1 |
| D3 | **Mensagens** do aluno com o profissional | R1 e decisão sobre o canal |
| D4 | **Convites e gestão de equipe**, papéis e revogação pela interface | R1 |
| ~~D5~~ | ~~Gestor concede o papel de gestor pela interface~~ **Feito na 0.27** | |
| D6 | Exclusão controlada de **outros dados** além das fotos | J4 |
| D7 | Fluxo para **menores**, com responsável legal | J2 |

## 7. Épicos planejados, não iniciados

- **E0** viabilidade restante: vários hosts por app, domínios e TLS, job em segundo plano, Puck no Webflow Cloud, homologação remota.
- **E3** Meu Site e Leads: editor de blocos, prévia e publicação, domínios, leads com conversão idempotente em aluno; templates e blocos do gestor.
- **E4** portal: origem privada separada (R3), documentos (B6), mensagens (D3).
- **E5** gestão e marketing: CRM completo, agenda, contratos, recebimentos, conectores.
- **E6** SaaS e afiliados: planos, cobrança, conciliação, recorrência, comissão sobre pagamento SaaS confirmado com idempotência por fato financeiro (R4).
- **E7** evoluções: fontes técnicas (RAG com armazenamento compatível com SQLite e acervo com direitos verificados), progressão assistida, booking, biblioteca técnica do gestor.

## 8. Riscos e limites conhecidos

- **O envio real de e-mail nunca foi feito.** A assinatura da AWS bate com os exemplos publicados por ela, e o resto foi testado com um provedor simulado.
- **`vars` do `wrangler.json` provavelmente é ignorado pelo Webflow.** A chave das fotos é lida do Worker ou de `process.env` (variável do painel) por isso; ver C2.
- **O papel de gestor entrega poder sobre toda a plataforma** (ver organizações, bloquear acessos, publicar os termos): o link do convite deve ir só à pessoa certa, por canal seguro. O e-mail não é verificado e por isso nunca decide quem é gestor.
- **Os logs de execução do Webflow podem conter segredos** e têm retenção que não controlamos. O token de redefinição de senha fica no fragmento do endereço justamente para não aparecer neles.
- **E-mail não é verificado.** A recuperação só troca a senha, nunca o e-mail; convites e vínculos nascem do token, não do e-mail digitado.
- **Convém ter sempre dois gestores.** Com dois, um encerra ou convida por cima do outro; com um só, se ele se perder o caminho é no banco e não foi testado.
- **Sem aviso por e-mail** de nada: o profissional só vê check-ins, relatos de desconforto e pedidos de titular quando abre a ferramenta. A tela diz isso ao aluno.
- **Registros congelados** (treino entregue, avaliação registrada, relato de dor) não se apagam: só as fotos têm exceção.
- **Se o vínculo do aluno é revogado**, ele perde as telas de pedido do titular **e o download dos próprios dados** (a ferramenta só serve a quem tem vínculo ativo). Quem cuida disso fora da ferramenta é o profissional, que responde o pedido; a pergunta de quem entrega a cópia depois que o vínculo termina é do advogado (J1).
- **Os testes de navegador que leem ou escrevem o banco local de fora do Worker** rodam sozinhos, depois dos outros, porque isso pode provocar um erro 500 raro no Worker local.
- ~~Um transbordo horizontal não explicado em `/gestor/gestores`~~ **Explicado e corrigido na 0.28.** Voltou no CI da 0.28 e a checagem nomeou o culpado (`span.sr-only → 1282px of 1280px`): o texto escondido do cabeçalho "Ação", de posição absoluta, fugia do recorte da tabela quando ela passava um pouco da largura do painel (depende do tamanho do e-mail do gestor, por isso aparecia de vez em quando) e esticava a página. O quadro que rola agora é posicionado; reproduzido numa página mínima com o CSS real (antes: documento com 1534px numa janela de 1280px; depois: 1280px), com teste de regra de CSS que falha sem a correção.
- **A versão do texto dos termos** muda quando o gestor publica: todos aceitam de novo no acesso seguinte.
- **A migration aplicada em produção é imutável**; qualquer mudança é uma migration nova e aditiva.
