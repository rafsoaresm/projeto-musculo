# Trainer Prescription — Handoff: editor visual drag-and-drop

## Decisão de produto

Substituir o editor orientado exclusivamente a formulários por um **page builder visual e estruturado**, embutido no módulo **Meu Site** do Trainer Prescription.

O usuário deve poder arrastar blocos para a página, reorganizá-los, criar layouts com colunas, selecionar qualquer bloco e editar seus parâmetros em um painel, além de editar textos diretamente na prévia. Os layouts devem continuar responsivos: **não** implementar posicionamento absoluto irrestrito do tipo “arrastar um texto para qualquer coordenada X/Y”.

### Protótipo de referência

`trainer_prescription_drag_drop_editor.html`: protótipo estático interativo, sem backend, com:

- Biblioteca de blocos arrastáveis, dividida em seções, layouts e elementos básicos;
- Área central com inserção por zonas entre blocos;
- Reorganização de seções existentes mediante alça de arraste;
- Bloco de duas colunas com áreas de inserção internas para título, texto, botão e imagem;
- Seleção de blocos, painel de propriedades e edição de texto por duplo clique;
- Duplicação, exclusão, deslocamento manual, visualização desktop/mobile e prévia sem controles;
- Desfazer/refazer durante a sessão e salvamento local no navegador;
- Botão “Publicar” explicitamente demonstrativo, sem conexão com a Vercel.

## Recomendação de implementação

Adotar **Puck (`@puckeditor/core`)**, editor modular MIT para React/Next.js, como base do page builder. Seus componentes `Puck`, `Puck.Components`, `Puck.Fields`, `Puck.Preview`, `Puck.Outline`, `Render` e zonas aninhadas permitem implementar a experiência sem desenvolver o mecanismo de drag-and-drop do zero. Consultar documentação da versão escolhida em https://puckeditor.com/docs e fixar versão no lockfile.

Craft.js é alternativa quando for necessário controle mais profundo de cada interação/elemento. GrapesJS é alternativa para um editor HTML/CSS mais genérico, porém o modelo JSON + componentes React do Puck se encaixa melhor na arquitetura multi-tenant/template-driven do produto.

**Importante:** o protótipo HTML é uma referência visual/funcional. Não copiar seu código DOM manualmente para dentro do React; implementar com componentes e mecanismos de persistência do framework escolhido.

## UX proposta

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Trainer Prescription / Meu Site     Desfazer  Refazer  Prévia  Publicar │
├─────────────────┬────────────────────────────────────┬───────────────────┤
│ BLOCOS/CAMADAS  │              CANVAS                │ PROPRIEDADES       │
│                 │                                    │                   │
│ Capa            │   [+ inserir bloco aqui]           │ Tipo: Serviços    │
│ Serviços        │   [Hero / imagem / CTA]            │ Título            │
│ Depoimentos     │   [+ inserir bloco aqui]           │ Descrição         │
│ Contato         │   [Cards de serviços]              │ Cards configuráveis│
│ 2 colunas       │   [+ inserir bloco aqui]           │ Espaçamento       │
│ Título          │                                    │ Cor / background  │
│ Texto           │     Desktop / Mobile / Prévia      │ Duplicar / Excluir│
│ Imagem          │                                    │                   │
└─────────────────┴────────────────────────────────────┴───────────────────┘
```

### Blocos iniciais

1. Hero (título, descrição, imagem, CTA);
2. Serviços (cards configuráveis);
3. Sobre o profissional;
4. Depoimentos com autorização;
5. Indicadores/metodologia;
6. FAQ;
7. CTA e formulário de interesse;
8. Contêiner de duas colunas;
9. Título, texto, imagem e botão como blocos menores;
10. Futuro: agenda/booking, planos, casos de sucesso e integração com campanhas.

Cada bloco deve ter schema tipado, defaults, validação, configuração de edição e renderização pública. Não aceitar JavaScript/HTML arbitrário enviado por usuários como componente de página na V1.

## Estrutura de dados e publicação

Persistir por **workspace/organização e profissional**. Separar:

- `sites`: owner/tenant, slug, templateId, theme, status, domainPrimary;
- `site_pages`: slug/caminho, SEO, metadados, `draftDocumentJson`, `publishedDocumentJson`, datas e revisões;
- `site_revisions`: snapshots imutáveis da página, autor, origem (salvo/publicado), timestamps;
- `site_domains`: domínio único, tenant, status, verificações DNS e vínculo Vercel;
- `site_leads`: conteúdo público do formulário, fonte, estado de conversão e profissional proprietário;
- `site_assets`: mídias do tenant com permissões e metadados.

Usar o contrato de conteúdo do Puck (JSON estruturado) como **fonte de verdade da composição**, com versionamento de schema e rotinas de migração se componentes ou props forem renomeados. Não persistir apenas HTML gerado.

### Fluxo

1. Abrir editor: carregar versão **draft** autorizada.
2. Editar: atualizar o documento em memória; autosave com debounce + indicador de estado, histórico de desfazer/refazer local.
3. Visualizar: renderizar a mesma árvore de componentes sem overlays de editor e oferecer viewport desktop/mobile.
4. Publicar: validar componentes, assets, URLs e formulário, criar snapshot imutável e copiar documento validado para `publishedDocumentJson`.
5. Render público: o app compartilhado na Vercel resolve domínio/host no backend do Trainer Prescription e carrega **somente dados publicados**.
6. Atualizar conteúdo: revalidar cache por site/página; **não** criar um novo deployment por cliente ou edição.
7. Atualizar código de um componente: publicar nova versão do aplicativo compartilhado e aplicar estratégias de migração/compatibilidade.

## Segurança, qualidade e limites

- Separar dados públicos do site de avaliação física, saúde, prescrição e histórico privado do aluno.
- Validar tenant/ownership no servidor; jamais confiar em `tenantId` ou `professionalId` enviados no corpo das requisições.
- Sanear conteúdo rico, validar URLs, aplicar proteção contra XSS e CSP; restringir uploads a mídias permitidas.
- Resolver todos os domínios por host validado; 404 para não cadastrados e checagem explícita de status de publicação.
- Garantir links canônicos, sitemap, metatags, responsividade e contraste visual.
- Leads são sempre atribuídos ao tenant resolvido pelo **host**, não somente ao hidden input no formulário.
- Regras de conteúdo, moderação, privacidade e consentimento adequadas a depoimentos, resultados e imagens de terceiros.
- Em telas móveis, usar alternativa acessível ao arraste (Adicionar, Mover acima/abaixo, Duplicar, Excluir).
- Evitar permissão para drag-and-drop de um container dentro de si mesmo ou de blocos não permitidos nas zonas aninhadas.

## Critérios de aceite

- Arrastar um bloco da biblioteca e soltá-lo entre quaisquer duas seções gera a seção no local escolhido.
- Arrastar um bloco já existente altera apenas sua posição e preserva suas propriedades.
- Bloco de colunas aceita título/texto/imagem/botão em cada coluna; componentes incompatíveis são recusados.
- Clique seleciona; duplo clique permite editar texto; painel atualiza a prévia em tempo real.
- Excluir, duplicar, desfazer/refazer e mover por botão funcionam sem corromper a árvore JSON.
- Alterações não publicadas não aparecem no site público.
- Publicação cria revisão imutável; é possível voltar a uma versão anterior.
- Sites de profissionais distintos não compartilham conteúdo, mídias privadas, domínios ou leads.
- Desktop e mobile renderizam de forma responsiva, sem coordenadas absolutas dependentes da tela.
- Atualizar texto ou imagem não dispara novo build do aplicativo multi-tenant na Vercel.

## Fases sugeridas

**D&D V1:** Puck + blocos base + temas + editor/painel + persistência draft + preview responsivo + publicação de snapshot.

**D&D V1.1:** containers aninhados, camadas, undo/redo persistido onde necessário, imagens com upload, presets visuais e versionamento/restore.

**D&D V1.2:** páginas múltiplas, SEO completo, domínios próprios e verificação DNS/HTTPS, leads no CRM e métricas.

**D&D V2:** assistente de IA para composição de páginas e variações visuais geradas a partir de componentes aprovados, sempre preservando a edição humana e a árvore estruturada.
