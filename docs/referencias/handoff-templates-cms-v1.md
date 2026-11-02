# Trainer Prescription — Website Builder
## Handoff V1 • 4 templates Figma + CMS simplificado

**Arquivo Figma:** https://www.figma.com/design/IUhGcaIs9nsNghcLFYLg1n  
**Estado:** protótipos visuais editáveis de referência + contrato de dados e regras para implementação; **não** se trata de código publicado ou CMS já implementado.  
**Base visual:** Trainix (energetic), FitNova (wellness), Sisphus (premium), RACE (sports performance). Estas são denominações internas de presets, não marcas a publicar sem autorização.

## 1. Entregáveis e inventário de Figma

| Página | Frame desktop (1440 px) | Frame mobile (390 px) | Hero desktop | Hero mobile | Imagem de apoio |
|---|---|---|---|---|---|
| 01 Trainix — Energy | `3:2` | `3:216` | `1:2` | `3:220` | `1:6` |
| 02 FitNova — Wellness | `3:415` | `3:632` | `1:3` | `3:636` | `1:7` |
| 03 Sisphus — Premium | `3:834` | `3:1028` | `1:4` | `3:1032` | `1:8` |
| 04 RACE — Performance | `3:1208` | `3:1408` | `1:5` | `3:1412` | `1:9` |

Retratos adicionais do preset RACE: `10:2` (Alex), `10:3` (Marina) e `10:4` (Daniel), todos demonstrativos.

Outras páginas: `00 · Assets fotográficos`, `05 · Mapeamento CMS e regras`, `06 · Componentes + tokens`. Cada seção do site está identificada com prefixo `SECTION /`; campos de conteúdo e peças substituíveis, com `CMS /`. Textos, botões, cartões e fotografias são camadas distintas.

> **Atenção:** valores, quantidade de alunos, taxas de satisfação, biografias, nomes, preços e depoimentos dos exemplos são ilustrativos. Não publicar como informações reais do profissional sem confirmação. Imagens de profissionais são material demonstrativo e precisam ser substituídas ou licenciadas conforme uso.

## 2. Objetivo e escopo

A aplicação oferece **quatro presets comerciais de sites** para personal trainers, com editor simplificado de campos e imagens. O cliente escolhe um modelo, personaliza a marca e conteúdo, vê preview responsivo e publica no domínio definido. Os modelos devem compartilhar **uma única engine de renderização** e um contrato de dados comum; a diferença entre presets é estilo, composição, regras de quantidade e visibilidade de seções.

Não implementar quatro front-ends duplicados nem transformar páginas de Figma em imagens de fundo. Todos os textos e CTAs devem estar no DOM sem rasterização. Banner/fotografias devem ser `<img>` / `picture` / background image com `alt` quando apropriado.

## 3. Modos de edição — decisão de produto

- **Editor Simplificado**: cards de CMS para marca, conteúdo, cores, fotos, SEO e contato; ajustes disponíveis apenas dentro dos componentes e opções do template; preview e publicação. Deve ser a opção padrão.
- **Editor Avançado**: integração com **Frappe Builder**, de uso técnico, com edição livre do layout e estruturas do site.
- **Restrição crítica**: no momento em que o profissional inicia um site em um dos modos, mostrar disclaimer e gravar `editorMode`. A partir daí o mesmo site **não pode ser editado pelo outro modo**. É possível criar novo site/projeto a partir de um outro modo, mediante ação consciente, sem prometer compatibilidade de layout ou migração automática.
- **Versionamento**: um rascunho editável não altera a versão publicada até `Publish`. Permitir `Preview`, `Publish`, `Rollback` e auditoria básica.

## 4. Modelo de dados

```ts
type TemplateKey = 'trainix' | 'fitnova' | 'sisphus' | 'race';
type EditorMode = 'simple' | 'advanced';
type SiteStatus = 'draft' | 'published' | 'unpublished';
type CTAType = 'whatsapp' | 'contact_form' | 'anchor' | 'internal_link' | 'external_url';

type Asset = {
  assetId: string;
  url: string;
  alt: string;
  focalPoint?: { x: number; y: number }; // 0-100%
  width: number; height: number;
};

type CTA = {
  label: string;
  type: CTAType;
  target: string;
  openNewTab?: boolean;
  trackingEvent?: string;
  /** Sobrescreve a preferência geral de captura antes do WhatsApp. */
  requireLeadForm?: boolean;
};

type WhatsAppConfig = {
  businessNumber: string; // E.164: 55 + DDD + número (sem '+', espaços ou pontuação)
  prefilledMessage: string;
  requireLeadForm: boolean; // true por padrão; administrador pode desativar
  leadForm: {
    enabledFields: { goal: boolean }; // nome e telefone sempre obrigatórios
    privacyPolicyUrl: string;
    consentText: string;
  };
};

type Section<T> = {
  enabled: boolean;
  order: number; // apenas se a seção puder ser reordenada nesse preset
  content: T;
};

type Site = {
  id: string;
  tenantId: string;
  professionalId: string;
  templateKey: TemplateKey;
  editorMode: EditorMode;
  status: SiteStatus;
  customDomain?: string;
  theme: {
    primary: string; background: string; surface: string;
    ink: string; muted: string; dark: string;
    fontFamily: string; radiusScale: 'compact' | 'default' | 'rounded';
  };
  identity: {
    siteName: string;
    logo?: Asset; favicon?: Asset;
    professionalName: string; professionLabel: string;
    cref?: string; instagram?: string; whatsapp?: string;
    email?: string; location?: string;
  };
  seo: { title: string; description: string; ogImage?: Asset; noindex: boolean };
  whatsapp: WhatsAppConfig;
  sections: Record<string, Section<unknown>>;
  draftRevisionId?: string;
  publishedRevisionId?: string;
};
```

As seções devem ser **tipadas por discriminador** (`section.type`) em JSON serializado. Não persistir HTML arbitrário nos campos do modo simples. Sanitizar URLs e texto; armazenar assets em CDN/storage com vínculo a `tenantId`.

## 5. Dicionário de CMS — campos globais

| Namespace | Campo | Tipo | Validação / comportamento |
|---|---|---|---|
| `identity` | `siteName` | text | 2 a 80 caracteres; fallback no header se logo ausente |
| `identity` | `logo` | asset SVG/PNG | preservar proporção; versões para fundo claro/escuro opcionais |
| `identity` | `favicon` | asset PNG/SVG | ícone quadrado |
| `identity` | `professionalName` | text | 2 a 100 caracteres |
| `identity` | `professionLabel`, `cref` | text | CREF opcional condicionado à necessidade de apresentação |
| `identity` | `instagram`, `whatsapp`, `email` | URL/tel/email | checar formato, protocolar `wa.me` quando aplicável |
| `theme` | `primary`, `background`, `surface`, `ink`, `muted`, `dark` | hex | converter em CSS custom properties; validar contraste WCAG |
| `theme` | `fontFamily`, `radiusScale` | enum | usar opções pré-aprovadas; não alterar livremente métricas críticas |
| `seo` | `title`, `description` | text | recomendação 60 e 160 caracteres respectivamente |
| `seo` | `ogImage`, `noindex` | asset/boolean | OG com fallback do banner; noindex em staging |
| `navigation` | `links[]`, `cta` | collection/CTA | CTA comercial usa WhatsApp e herda configuração de captura |
| `whatsapp` | `businessNumber`, `prefilledMessage`, `requireLeadForm`, `leadForm` | phone/text/boolean/object | número E.164, formulário opcional e consentimento se captura for ativada |

## 6. Dicionário de CMS — seções

Todos os módulos têm `enabled`; `order` só quando permitido pela configuração do template; são campos independentes, nunca parte da fotografia.

| Section key | Campos editáveis | Regras |
|---|---|---|
| `hero` | `eyebrow`, `title`, `subtitle`, `backgroundDesktop`, `backgroundMobile`, `primaryCta`, `secondaryCta?`, `trustBadges[]?` | título até 95 caracteres; CTA 12–32; overlay ajustável por preset |
| `intro` | `eyebrow`, `title`, `description`, `benefits[]` | benefícios de 2–4 itens |
| `mediaFeature` | `image`, `eyebrow`, `title`, `description`, `cta?` | texto e mídia independentes; crop por viewport |
| `goals` | `title`, `description`, `cards[]` | cartões repetíveis 2–6 |
| `services` | `title`, `description`, `items[]` | item: `id`, `title`, `description`, `iconKey`, `sortOrder` |
| `process` | `title`, `steps[]` | 3–5 etapas; sem campos de numeração livres na interface |
| `professional` | `photo`, `name`, `title`, `bio`, `credentials[]`, `stats[]`, `cta` | dados próprios; foto autorizada |
| `stats` | `items[]` | `label`, `value`, `source?`; ocultar valores não confirmados |
| `pricing` | `title`, `plans[]`, `featuredPlanId?`, `disclaimer?` | preço BRL numérico; periodicidade; benefícios; ação por plano |
| `testimonials` | `entries[]` | `name`, `quote`, `photo?`, `consentRecorded`, `approved`; só publicar autorizados |
| `faq` | `items[]` | pergunta 10–140 caracteres; resposta até 1500 |
| `articles` | `posts[]` | `title`, `slug`, `excerpt`, `cover`, `status`, `publishedAt` |
| `contact` | `title`, `description`, `fields[]`, `cta`, `consentText`, `recipient` | LGPD, honeypot/antispam, CSRF/rate limit |
| `footer` | `logo`, `description`, `links[]`, `social[]`, `legalLinks[]` | não ocultar links essenciais de política e contato |

## 7. Matriz de templates

| Módulo | Trainix | FitNova | Sisphus | RACE |
|---|---|---|---|---|
| Identidade | Vermelho/laranja, calor humano | Branco/cinza, laranja editorial | Preto, laranja premium | Azul, atlético |
| Hero | CTA direto / coach | Fitness lifestyle + badges | Portrait editorial escuro | Sprint de ação + indicadores |
| Intro / benefícios | Sim | Sim | Sim | Sim |
| Media feature | Alongamento / método | Progresso e cuidado | Coach personalizado | Filosofia e técnica |
| Cards de especialidades | Metas | Serviços | Coaching premium em fundo escuro | Programas de velocidade |
| Processo | Sim | Sim | Sim | Sim |
| Profissional | Bio com métricas | Bio | Credenciais / consultoria | Especialistas |
| Resultados | Depoimento | Progresso | Depoimento | Indicadores |
| Planos | 3 opções | 3 opções | 3 opções | 3 opções |
| FAQ | Sim | Sim | Sim | Sim |
| Conteúdo/blog | Sim | Sim | opcional | opcional |
| Conversão WhatsApp | CTA + modal opcional | CTA + modal opcional | CTA + modal opcional | CTA + modal opcional |

Os textos são exemplos de preenchimento, não copy obrigatório. O profissional poderá alterar cor primária e identidade sem descaracterizar completamente o preset. Preservar contraste, alinhamento, hierarquia e mobile.

## 8. Imagens e conteúdo multimídia

A biblioteca Figma contém 11 imagens de apresentação (4 heroes desktop, 4 fotografias auxiliares e 3 retratos demonstrativos de coaches). Foram gerados também 4 heroes mobile específicos, aplicados diretamente nas camadas de foto das versões 390px. **Total: 15 imagens geradas e incluídas no Figma.**

**Contrato de mídia recomendado:**
- `hero.desktop`: 16:9, recomendado 1600×900 ou superior, JPG/WebP/AVIF.
- `hero.mobile`: vertical 2:3 ou 4:5, recomendado 1024×1536, permitido fallback/crop do desktop.
- `section.image`: 16:9, recomendado >=1200 px.
- `professional.photo`: retrato 4:5, crop com foco ajustável.
- `logo`: SVG preferencial; raster transparente fallback.
- Ao fazer upload: conferir tamanho do arquivo, tipo MIME, resolução, orientação, privacidade e direito de uso; comprimir; gerar variantes responsivas; `alt` obrigatória para imagem informativa.
- Nunca embutir headings ou CTAs no asset; o texto renderizado é sempre editável e responsivo.

## 9. Fluxo e regras de publicação

1. **Selecionar modelo** — mostrar 4 cards preview desktop/mobile com descrição.
2. **Definir modo** — Simple ou Advanced, com disclaimer de incompatibilidade entre editores.
3. **Identidade** — logotipo, paleta, nome profissional, links e dados de contato.
4. **Editar seções** — navegação lateral ou lista por seção, preview em tempo real e autosave.
5. **Verificar** — visualização desktop/mobile, URLs, campos obrigatórios, contraste e imagens.
6. **Publicar** — snapshot imutável da revisão publicada, HTTPS, sitemap/robots e domínio configurado.
7. **Manutenção** — edição do draft sem impacto no site online até novo publish; rollback e histórico.

Os **CTAs comerciais dos quatro templates** utilizam `whatsapp` (botão verde com logotipo SVG branco); links de navegação, leia mais e outras ações não comerciais podem manter `contact_form`, `anchor`, `internal_link`, `external_url`. No WhatsApp: normalizar DDI/DDD e permitir texto predefinido com encoding correto. Em links externos, `rel="noopener noreferrer"`. No evento de submissão, registrar `site_id`, `section_key`, `cta_id`, `tenant_id` e `revision_id` sem expor PII no analytics.

## 10. Critérios de aceite

- [ ] Quatro templates renderizados a partir do mesmo contrato de dados (sem HTML injetado pelo usuário).
- [ ] Visualizações desktop e mobile correspondem aos frames do Figma; nenhum overflow horizontal em 390px.
- [ ] Troca de texto, logo, cores, hero desktop/mobile, foto do profissional, cartões, planos e FAQs sem alterar código.
- [ ] Os CTAs comerciais exibem logo WhatsApp SVG branco à esquerda, label 'Falar no WhatsApp', verde de marca com contraste adequado e estados hover/focus.
- [ ] Com `requireLeadForm=true`, o CTA abre modal obrigatório, só redirecionando após validação, privacidade e persistência confirmada.
- [ ] Com `requireLeadForm=false`, o CTA abre WhatsApp diretamente, sem formulário e sem criar lead fictício.
- [ ] Dados de demonstração não são publicados automaticamente como fatos.
- [ ] Formulário com consentimento LGPD, segurança, antispam e tratamento de erros.
- [ ] CMS salva rascunho e publica revisão; rollback preserva histórico.
- [ ] `tenant_id` obrigatório em leituras/escritas e no storage de assets.
- [ ] Imagens responsivas otimizadas com prioridade no LCP do hero e lazy loading abaixo da dobra.
- [ ] SEO customizável e sem indexação de preview.
- [ ] Editor simple e advanced são modos mutuamente exclusivos **por site**; não oferecer edição cruzada.

## 11. Estrutura técnica sugerida

```text
packages/
  site-schema/           # TS types + zod schemas + migrations
  site-templates/        # theme tokens + section definitions
  site-renderer/         # React components / CSS variables
apps/
  builder/               # formulário CMS + preview
  website-runtime/       # render read-only publicado
services/
  assets/                # storage, image optimization, focal point
  publish/               # snapshots, deployment, domains
```

Sugerir `TemplateManifest` com `key`, `version`, `defaultTheme`, `sections`, `editableFields`, `fieldRules`, `sectionRules`, `responsiveAssets`. A implementação do CMS deve ser **schema-driven** (componentes de formulário derivados das definições de campo). Migrar revisões de template explicitamente, sem sobrescrever conteúdo publicado.

**Nota de handoff:** os layouts do Figma são o contrato visual inicial e exigem a etapa normal de implementação/QA cross-browser; não são o produto final publicado.


## 12. Ajuste V1.1 — CTA WhatsApp e formulário condicional (02/11/2026)

**Referência Figma:** [CTA, modal desktop/mobile e painel do CMS](https://www.figma.com/design/IUhGcaIs9nsNghcLFYLg1n?node-id=19-2) — página `07 · WhatsApp — CTA, formulário e fluxos`. Componente mestre `2:2` (`CMS/Button/WhatsApp CTA`) com ícone de WhatsApp **SVG editável**, preenchimento verde independente dos quatro temas e label branco. Foram atualizadas as instâncias de CTA comercial nos oito frames (15 Trainix, 13 FitNova, 13 Sisphus, 13 RACE; **54 instâncias**).

### 12.1 Configurações do administrador

| Campo CMS | Tipo | Padrão / regra |
|---|---|---|
| `whatsapp.businessNumber` | telefone obrigatório | E.164 em dígitos; ex.: `5531999999999`; sem `+`, espaços ou traços no URL |
| `whatsapp.prefilledMessage` | string editável | `Olá! Gostaria de conhecer seus treinos.`; montar `?text=` com `encodeURIComponent` |
| `whatsapp.requireLeadForm` | boolean | `true` ao criar o site; administrador pode desligar |
| `cta.requireLeadForm` | boolean ou ausente | *Override* opcional por CTA; se ausente, herda a configuração global |
| `cta.label` | string | Padrão `Falar no WhatsApp`; preservar ícone SVG sempre que o destino for WhatsApp |
| `whatsapp.leadForm.enabledFields.goal` | boolean | `true` no exemplo, mas campo **opcional** para o visitante |
| `whatsapp.leadForm.privacyPolicyUrl` | URL | Obrigatória quando o formulário estiver ativo; link claramente disponível |
| `whatsapp.leadForm.consentText` | string | Informação clara e específica sobre finalidade do contato, sem pré-marcação |

**Escopo visual:** mudar a cor primária do tema não muda a cor de marca do botão WhatsApp. Em caso de customização avançada, garantir contraste WCAG AA no label.

### 12.2 Fluxo A — formulário exigido

1. No clique do CTA, abrir um **modal acessível** (desktop) ou **modal responsivo** (mobile), sem redirecionar ainda. Registrar evento `whatsapp_cta_click` e `whatsapp_lead_form_opened`, ambos **sem dados pessoais**.
2. Pedir `name` (obrigatório, 2–100 caracteres) e `phone` (obrigatório, celular com DDD; aceitar máscara de entrada e normalizar a dígitos com DDI). `goal` é opcional, limitado a 160 caracteres. Evitar campos sensíveis de saúde; não pedir informações clínicas.
3. Exibir um aceite claro de privacidade, inicialmente **desmarcado**, e link válido para a Política de Privacidade. Sem aceite ou com dados inválidos, exibir erros inline e manter o modal aberto.
4. Enviar ao backend por `POST /public/sites/:slug/leads/whatsapp` (rota sugerida; adaptar ao stack), contendo dados validados, `ctaId`, `sectionKey`, `templateKey` e parâmetros de atribuição permitidos; o servidor resolve `tenantId` e `siteId`, aplica rate limit/antispam e grava o lead com status `captured`. Não confiar no ID de tenant enviado pelo navegador. Registrar data e versão do aviso de privacidade.
5. **Somente após confirmação de persistência**, construir `https://wa.me/{businessNumber}?text={encodeURIComponent(message)}` e navegar pelo mesmo separador para evitar bloqueio de pop-ups. Mensagem pode conter nome ou objetivo apenas quando o visitante foi informado dessa finalidade. Em caso de erro de gravação, preservar dados, mostrar erro e permitir tentar novamente; não abrir o WhatsApp automaticamente.
6. Registrar `whatsapp_redirect_attempt` quando houver navegação. **Não** interpretar o clique nem o redirecionamento como mensagem realmente enviada ou conversa iniciada.

### 12.3 Fluxo B — formulário desativado

No clique, validar a configuração e abrir `https://wa.me/{businessNumber}?text={encodeURIComponent(prefilledMessage)}` **sem modal e sem request de lead**. O evento de clique é permitido sem PII. Não criar lead presumido. A decisão é feita pela configuração efetiva:

```ts
const requireLeadForm = cta.requireLeadForm ?? site.whatsapp.requireLeadForm;

function onWhatsAppCtaClick() {
  track('whatsapp_cta_click', { ctaId, sectionKey }); // nenhuma PII
  if (requireLeadForm) {
    setLeadModalOpen(true);
    return;
  }
  window.location.assign(makeWhatsAppUrl(site.whatsapp.businessNumber, site.whatsapp.prefilledMessage));
}

async function submitLeadGate(form: {name: string; phone: string; goal?: string; privacyAcknowledged: boolean}) {
  const payload = validateAndNormalize(form); // validação frontend + backend
  const result = await createWhatsAppLead(payload); // aguardar confirmação persistida
  if (!result.ok) { showPersistError(); return; }
  window.location.assign(makeWhatsAppUrl(site.whatsapp.businessNumber, buildMessage(payload)));
}
```

`makeWhatsAppUrl` deve usar somente dígitos para o número **da empresa/profissional**, e `encodeURIComponent` para toda a mensagem. Nunca concatenar PII em rotas internas ou eventos de analytics. O número deve ser validado antes de permitir a publicação do site; para WhatsApp brasileiro, exigir DDI `55`, DDD e número válido.

### 12.4 Estados e critérios de aceite

- [ ] Desktop e mobile usam o CTA verde com logo SVG branco editável, sem rasterizar o botão.
- [ ] Todos os CTAs de conversão (header, hero, programas, planos e contato) seguem uma configuração global, com sobrescrita opcional por CTA.
- [ ] Form ativo abre modal, com foco preso ao modal, botão de fechar, `Escape` e feedback de erros; não permite redirecionamento com campos inválidos.
- [ ] Form inativo abre o WhatsApp imediatamente, sem criar qualquer lead fictício.
- [ ] Persistência, autenticação do tenant por contexto servidor, antispam e aceite de privacidade são verificáveis.
- [ ] Telefone do profissional inválido bloqueia publicação, não cria links quebrados.
- [ ] Distinguir no analytics `cta_click`, `lead_saved`, `redirect_attempt`, não atribuir mensagem enviada sem integração que a confirme.
- [ ] Se o site exibir um formulário de contato **inline** por configuração independente, a submissão desse formulário não deve abrir **outro** formulário em modal: reutilizar o mesmo contrato de persistência e, após sucesso, redirecionar ao WhatsApp. Quando a opção global de exigir formulário estiver desativada, mostrar CTA direto em vez do formulário inline, se ele estiver destinado à conversão WhatsApp.

**Estado de implementação:** o Figma define composição e estados visuais. A lógica funcional de modal, persistência e navegação deve ser implementada no runtime pelo coding agent; o Figma sozinho não substitui essas APIs.
