import { type ReactNode } from "react";
import {
  allNodes,
  applyOverrides,
  channelUrl,
  componentById,
  emailUrl,
  instagramUrl,
  whatsappUrl,
  type BoxNode,
  type Channel,
  type ComponentNode,
  type ContactFormNode,
  type ElementNode,
  type SiteContent,
  type SiteNode,
} from "./contracts";
import { FIELD } from "./inquiries";
import { anchorDomId, nodeClass } from "./site-css";
import { themeAttributes } from "./site-theme";
import { hasAnyStyle } from "./screens";
import type { SiteNav } from "./site-nav";
import { DELIVERY_LABEL } from "@/modules/leads/contracts";

/**
 * The public page, from a document. The editor's canvas, its preview and the published page use this same
 * component, so what is seen before publishing is what is published. Everything it prints is text that React
 * escapes; the only links are made from the contact fields by `channelUrl` and friends, which accept nothing
 * but a phone number, an e-mail address and a handle, or point at another node of the same page. No script and no
 * third-party resource; the only form is the contact form (a block with fixed fields, sent to this same app), and it is
 * on the page only when `forms` says it is open. Images are only those of the site's library, from the page's own address.
 *
 * A node with a style carries the class of its own identifier (`s-<id>`), which the stylesheet made by `buildSiteCss`
 * is keyed by; the page itself has no `style` attribute. Without `edit` (the public page and the preview) it prints
 * the page and nothing else. With `edit` (the canvas of the editor) the same markup gets, on each node, the
 * identifier the canvas finds it by, and each text becomes a field that can be typed over: the frames, the tools and
 * the lines that show where a block would land are drawn by the editor over the page, not inside it, so the
 * layout in the editor is the layout of the published page.
 */
export interface FieldSpec {
  blockId: string;
  /** Where in the node: "heading", "items.2.question"... */
  path: string;
  value: string;
  placeholder: string;
  max: number;
  multiline?: boolean;
}
/** How an image of the library is drawn here: where it is served from and its size, or null when it is not there. */
export interface ResolvedImage {
  src: string;
  width: number;
  height: number;
}
export type ImageResolver = (assetId: string) => ResolvedImage | null;

/**
 * Where the contact form of a published page is sent and which privacy notice it points to. It is given to the renderer only when the form is open
 * (see inquiries.ts: the environment and the site both said yes). `null` is a published page whose form is closed: the block is not there. Absent
 * (the editor's canvas and the preview) it is drawn as a sample that sends nothing.
 */
export interface PublicForm {
  /** The address the form is sent to, relative to the page. */
  action: string;
  /** The page the form is on, as its address ("" for the home page): it comes back with the message. */
  page: string;
  noticeUrl: string;
}

export interface EditHooks {
  /** A text of a node, as a field that can be typed over. */
  text: (field: FieldSpec) => ReactNode;
}

interface Ctx {
  content: SiteContent;
  edit?: EditHooks;
  images?: ImageResolver;
  /** The nodes that a button or a link of the page goes to: they get a DOM id. */
  anchors: ReadonlySet<string>;
  /** The first highlight of the page, which holds its only first-level heading. */
  firstHero: string | null;
  /** In front of the DOM id of an anchor, so a page drawn more than once in one window (the frames of the editor) does not repeat an id. */
  scope: string;
  /** The pages of the site: where a button or a link that goes to a page leads. Absent where there is no site around the page (a page drawn alone). */
  nav?: SiteNav;
  /** Blocks to mark as added or changed (the page of a version being compared with another): they get `data-diff`, which the stylesheet outlines. */
  marks?: ReadonlyMap<string, "added" | "changed">;
  /** The contact form: where it is sent, `null` when it is closed on a published page, absent where it is only a sample. */
  forms?: PublicForm | null;
  /**
   * Set while the nodes of a component are drawn as one instance has them. In the editor they are not blocks of the page (only the instance
   * is): they carry no identifier for the canvas, and a text is a field only when the instance can change it (`overridable`, the nodes of
   * the definition that have a text or a label); the instance's own field is the one that is typed over.
   */
  instance?: { id: string; overridable: ReadonlySet<string> };
}

/** The attributes every node's element carries: its classes (the page's own and the node's), its anchor id, and in the editor the id the canvas finds it by. */
function attrsOf(node: SiteNode, ctx: Ctx, classes: string) {
  const own = hasAnyStyle(node) ? ` ${nodeClass(node.id)}` : "";
  return {
    className: `${classes}${own}`,
    // The canvas finds a node by its data attribute; its links are stand-ins that go nowhere, so it needs no anchor id (the frames repeat the page).
    id: !ctx.edit && ctx.anchors.has(node.id) ? `${ctx.scope}${anchorDomId(node.id)}` : undefined,
    "data-block-id": ctx.edit && !ctx.instance ? node.id : undefined,
    "data-type": ctx.edit && !ctx.instance ? node.type : undefined,
    "data-empty": ctx.edit && !ctx.instance && node.type === "box" && node.children.length === 0 ? "" : undefined,
    "data-diff": ctx.marks?.get(node.id),
  };
}

/** A text of the document: printed as it is, or, in the editor, a field. Empty texts print nothing on the public page. */
function T({ ctx, id, path, value, placeholder, max, multiline }: { ctx: Ctx; id: string; path: string; value: string; placeholder: string; max: number; multiline?: boolean }) {
  if (!ctx.edit) return <>{value}</>;
  const inside = ctx.instance;
  if (!inside) return <>{ctx.edit.text({ blockId: id, path, value, placeholder, max, multiline })}</>;
  // In a component, a text the instance can change is a field of the instance (its `overrides`); the others are the component's, edited there.
  if (inside.overridable.has(id) && (path === "text" || path === "label"))
    return <>{ctx.edit.text({ blockId: inside.id, path: `overrides.${id}.${path}`, value, placeholder, max, multiline })}</>;
  return (
    <span className="site-editable site-inert" data-placeholder={placeholder}>
      {value}
    </span>
  );
}
const shown = (ctx: Ctx, value: string) => ctx.edit !== undefined || value !== "";

function Eyebrow({ ctx, id, value }: { ctx: Ctx; id: string; value: string }) {
  if (!shown(ctx, value)) return null;
  return (
    <p className="site-eyebrow">
      <T ctx={ctx} id={id} path="eyebrow" value={value} placeholder="Etiqueta (opcional)" max={60} />
    </p>
  );
}

/** A button: on the public page a link made from a contact; in the editor a stand-in that does not navigate. */
function Action({ ctx, id, labelPath, label, channel }: { ctx: Ctx; id: string; labelPath: string; label: string; channel: Channel | undefined }) {
  if (ctx.edit) {
    return (
      <span className="button primary site-button-stand-in">
        <T ctx={ctx} id={id} path={labelPath} value={label} placeholder="Texto do botão" max={40} />
      </span>
    );
  }
  const href = channelUrl(ctx.content.contact, channel);
  if (!href || !label) return null;
  const external = href.startsWith("https://");
  return (
    <a className="button primary" href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      {label}
    </a>
  );
}

/** Where a button or a link goes: a contact (its own address), another node of this page (an anchor), or another page of the site. Null when it goes nowhere. */
function destinationOf(item: { channel?: Channel; anchor?: string; page?: string }, ctx: Ctx): { href: string; external: boolean; visit?: string } | null {
  if (item.channel) {
    const href = channelUrl(ctx.content.contact, item.channel);
    return href ? { href, external: href.startsWith("https://") } : null;
  }
  if (item.anchor && ctx.anchors.has(item.anchor)) return { href: `#${ctx.scope}${anchorDomId(item.anchor)}`, external: false };
  if (item.page) {
    const href = ctx.nav?.href(item.page);
    return href ? { href, external: false, visit: item.page } : null;
  }
  return null;
}
/** The click on a link to a page, where the page is shown in place (the editor's preview): it does not follow the address. */
const visiting = (ctx: Ctx, where: { visit?: string }) =>
  where.visit !== undefined && ctx.nav?.onVisit
    ? {
        onClick: (event: { preventDefault: () => void }) => {
          event.preventDefault();
          ctx.nav?.onVisit?.(where.visit!);
        },
      }
    : null;

/** Whether an element has anything to show on the public page: a text, a button or a link with a label and a place to go, an image of the library. */
function visible(item: ElementNode, ctx: Ctx): boolean {
  if (ctx.edit) return true;
  if (item.type === "image") return Boolean(item.assetId && ctx.images?.(item.assetId));
  if (item.type === "button" || item.type === "link") return Boolean(item.label && destinationOf(item, ctx));
  return item.text !== "";
}

const HEADINGS = { 2: "h2", 3: "h3", 4: "h4", 5: "h5", 6: "h6" } as const;

function ElementView({ item, ctx }: { item: ElementNode; ctx: Ctx }) {
  if (!visible(item, ctx)) return null;
  if (item.type === "heading") {
    const Heading = HEADINGS[item.level as keyof typeof HEADINGS] ?? "h2";
    return (
      <Heading {...attrsOf(item, ctx, "site-heading site-leaf")}>
        <T ctx={ctx} id={item.id} path="text" value={item.text} placeholder="Escreva o título" max={120} />
      </Heading>
    );
  }
  if (item.type === "image") {
    const image = item.assetId ? ctx.images?.(item.assetId) ?? null : null;
    return (
      <figure {...attrsOf(item, ctx, "site-image site-leaf")} data-size={item.size}>
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element -- served by this app from a private bucket; the size is known
          <img src={image.src} width={image.width} height={image.height} alt={item.alt} loading="lazy" decoding="async" />
        ) : (
          <div className="site-image-empty">Escolha a imagem no painel à direita.</div>
        )}
        {shown(ctx, item.caption) && (
          <figcaption>
            <T ctx={ctx} id={item.id} path="caption" value={item.caption} placeholder="Legenda (opcional)" max={200} />
          </figcaption>
        )}
      </figure>
    );
  }
  if (item.type === "paragraph") {
    return (
      <p {...attrsOf(item, ctx, "site-text site-leaf")}>
        <T ctx={ctx} id={item.id} path="text" value={item.text} placeholder="Escreva o texto" max={2000} multiline />
      </p>
    );
  }
  // A button or a link: in the editor a stand-in that does not navigate, on the page an anchor made from the destination.
  const link = item.type === "link";
  const classes = link ? "site-link site-leaf" : "button primary site-leaf";
  if (ctx.edit) {
    return (
      <span {...attrsOf(item, ctx, `${classes}${link ? "" : " site-button-stand-in"}`)}>
        <T ctx={ctx} id={item.id} path="label" value={item.label} placeholder={link ? "Texto do link" : "Texto do botão"} max={40} />
      </span>
    );
  }
  const where = destinationOf(item, ctx)!;
  return (
    <a {...attrsOf(item, ctx, classes)} href={where.href} {...(where.external ? { target: "_blank", rel: "noopener noreferrer" } : {})} {...visiting(ctx, where)}>
      {item.label}
    </a>
  );
}

function BoxView({ node, ctx }: { node: BoxNode; ctx: Ctx }) {
  const Tag = node.tag;
  return (
    <Tag {...attrsOf(node, ctx, "site-box")}>
      {node.children.map((child) => (
        <NodeView key={child.id} node={child} ctx={ctx} />
      ))}
    </Tag>
  );
}

/**
 * An instance of a component: a box of its own (it has the style of the instance: where it sits, its size, whether it shows) around the
 * nodes of the component, drawn with the instance's texts, labels, contacts and images. A component that is not there draws nothing on
 * the public page, and a stand-in in the editor.
 */
function ComponentView({ node, ctx }: { node: ComponentNode; ctx: Ctx }) {
  const definition = componentById(ctx.content, node.componentId);
  if (!definition) {
    return ctx.edit ? (
      <div {...attrsOf(node, ctx, "site-component site-component-missing")}>O componente deste bloco não existe mais. Desvincule o bloco ou exclua-o.</div>
    ) : null;
  }
  const overridable = new Set(allNodes([definition.root]).filter((entry) => entry.type === "heading" || entry.type === "paragraph" || entry.type === "button" || entry.type === "link").map((entry) => entry.id));
  const inside: Ctx = { ...ctx, instance: ctx.edit ? { id: node.id, overridable } : undefined };
  return (
    <div {...attrsOf(node, ctx, "site-component")}>
      <NodeView node={applyOverrides(definition.root, node.overrides)} ctx={inside} />
    </div>
  );
}

function NodeView({ node, ctx }: { node: SiteNode; ctx: Ctx }) {
  const { edit } = ctx;
  const id = node.id;
  switch (node.type) {
    case "hero": {
      const Heading = node.id === ctx.firstHero ? "h1" : "h2";
      return (
        <section {...attrsOf(node, ctx, "site-section site-hero")} aria-label={node.heading || "Destaque"}>
          <Eyebrow ctx={ctx} id={id} value={node.eyebrow} />
          {shown(ctx, node.heading) && (
            <Heading>
              <T ctx={ctx} id={id} path="heading" value={node.heading} placeholder="Título do destaque" max={120} />
            </Heading>
          )}
          {shown(ctx, node.subheading) && (
            <p className="site-lead">
              <T ctx={ctx} id={id} path="subheading" value={node.subheading} placeholder="Subtítulo" max={300} multiline />
            </p>
          )}
          <div className="site-actions">
            <Action ctx={ctx} id={id} labelPath="buttonLabel" label={node.buttonLabel} channel={node.buttonChannel} />
          </div>
        </section>
      );
    }
    case "text":
      return (
        <section {...attrsOf(node, ctx, "site-section")}>
          <Eyebrow ctx={ctx} id={id} value={node.eyebrow} />
          {shown(ctx, node.heading) && (
            <h2>
              <T ctx={ctx} id={id} path="heading" value={node.heading} placeholder="Título (opcional)" max={120} />
            </h2>
          )}
          {shown(ctx, node.text) && (
            <p className="site-text">
              <T ctx={ctx} id={id} path="text" value={node.text} placeholder="Escreva o texto" max={2000} multiline />
            </p>
          )}
        </section>
      );
    case "services":
      return (
        <section {...attrsOf(node, ctx, "site-section")}>
          <Eyebrow ctx={ctx} id={id} value={node.eyebrow} />
          {shown(ctx, node.heading) && (
            <h2>
              <T ctx={ctx} id={id} path="heading" value={node.heading} placeholder="Título da seção" max={120} />
            </h2>
          )}
          {shown(ctx, node.intro) && (
            <p className="site-text">
              <T ctx={ctx} id={id} path="intro" value={node.intro} placeholder="Introdução (opcional)" max={300} multiline />
            </p>
          )}
          <ul className="site-services">
            {(node.items ?? []).map((item, index) => (
              <li key={`${item.name}-${index}`}>
                <h3>{item.name}</h3>
                <p className="site-delivery">{DELIVERY_LABEL[item.delivery]}</p>
                {item.description && <p className="site-text">{item.description}</p>}
              </li>
            ))}
          </ul>
          {edit && (node.items ?? []).length === 0 && (
            <p className="site-hint">Escolha os serviços deste bloco no painel à direita. Eles vêm da lista de Serviços.</p>
          )}
        </section>
      );
    case "about":
      return (
        <section {...attrsOf(node, ctx, "site-section site-about")}>
          <div className="site-about-grid">
            <div className="site-about-copy">
              <Eyebrow ctx={ctx} id={id} value={node.eyebrow} />
              {shown(ctx, node.heading) && (
                <h2>
                  <T ctx={ctx} id={id} path="heading" value={node.heading} placeholder="Título" max={120} />
                </h2>
              )}
              {shown(ctx, node.text) && (
                <p className="site-text">
                  <T ctx={ctx} id={id} path="text" value={node.text} placeholder="Conte sobre o seu trabalho" max={2000} multiline />
                </p>
              )}
            </div>
            {(node.stat !== "" || edit) && (
              <div className="site-stat">
                <strong>
                  <T ctx={ctx} id={id} path="stat" value={node.stat} placeholder="Número" max={16} />
                </strong>
                <span>
                  <T ctx={ctx} id={id} path="statLabel" value={node.statLabel} placeholder="Legenda" max={80} />
                </span>
              </div>
            )}
          </div>
        </section>
      );
    case "quote":
      return (
        <section {...attrsOf(node, ctx, "site-section site-quote")}>
          <Eyebrow ctx={ctx} id={id} value={node.eyebrow} />
          <figure>
            {shown(ctx, node.quote) && (
              <blockquote>
                “<T ctx={ctx} id={id} path="quote" value={node.quote} placeholder="Escreva o depoimento" max={600} multiline />”
              </blockquote>
            )}
            {shown(ctx, node.author) && (
              <figcaption>
                <T ctx={ctx} id={id} path="author" value={node.author} placeholder="Quem deu o depoimento" max={80} />
              </figcaption>
            )}
          </figure>
        </section>
      );
    case "stats": {
      const items = edit ? node.items : node.items.filter((item) => item.value && item.label);
      return (
        <section {...attrsOf(node, ctx, "site-section")}>
          <Eyebrow ctx={ctx} id={id} value={node.eyebrow} />
          {shown(ctx, node.heading) && (
            <h2>
              <T ctx={ctx} id={id} path="heading" value={node.heading} placeholder="Título da seção" max={120} />
            </h2>
          )}
          <ul className="site-stats">
            {items.map((item, index) => (
              <li key={index}>
                <strong>
                  <T ctx={ctx} id={id} path={`items.${index}.value`} value={item.value} placeholder="Número" max={16} />
                </strong>
                <span>
                  <T ctx={ctx} id={id} path={`items.${index}.label`} value={item.label} placeholder="Legenda" max={80} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      );
    }
    case "faq": {
      const items = node.items.filter((item) => item.question && item.answer);
      return (
        <section {...attrsOf(node, ctx, "site-section site-faq")}>
          <Eyebrow ctx={ctx} id={id} value={node.eyebrow} />
          {shown(ctx, node.heading) && (
            <h2>
              <T ctx={ctx} id={id} path="heading" value={node.heading} placeholder="Título da seção" max={120} />
            </h2>
          )}
          {edit
            ? node.items.map((item, index) => (
                <div className="site-faq-open" key={index}>
                  <p className="site-faq-question">
                    <T ctx={ctx} id={id} path={`items.${index}.question`} value={item.question} placeholder="Pergunta" max={160} />
                  </p>
                  <p className="site-text">
                    <T ctx={ctx} id={id} path={`items.${index}.answer`} value={item.answer} placeholder="Resposta" max={800} multiline />
                  </p>
                </div>
              ))
            : items.map((item, index) => (
                <details key={`${item.question}-${index}`}>
                  <summary>{item.question}</summary>
                  <p className="site-text">{item.answer}</p>
                </details>
              ))}
        </section>
      );
    }
    case "cta":
      return (
        <section {...attrsOf(node, ctx, "site-section site-cta")}>
          <Eyebrow ctx={ctx} id={id} value={node.eyebrow} />
          {shown(ctx, node.heading) && (
            <h2>
              <T ctx={ctx} id={id} path="heading" value={node.heading} placeholder="Título da chamada" max={120} />
            </h2>
          )}
          {shown(ctx, node.text) && (
            <p className="site-text">
              <T ctx={ctx} id={id} path="text" value={node.text} placeholder="Texto (opcional)" max={300} multiline />
            </p>
          )}
          <div className="site-actions">
            <Action ctx={ctx} id={id} labelPath="buttonLabel" label={node.buttonLabel} channel={node.buttonChannel} />
          </div>
        </section>
      );
    case "contactForm":
      return <ContactFormView node={node} ctx={ctx} />;
    case "box":
      return <BoxView node={node} ctx={ctx} />;
    case "component":
      return <ComponentView node={node} ctx={ctx} />;
    case "heading":
    case "paragraph":
    case "button":
    case "link":
    case "image":
      return <ElementView item={node} ctx={ctx} />;
  }
}

/**
 * The contact form. On a published page it is a plain HTML form sent to this app (no script): a name, an e-mail or a phone, a message, a box that says
 * the privacy notice was read, and a field a person never sees (a program fills it, and is told it worked). Closed, it is not there. In the editor
 * and in the preview it is a sample with the fields turned off: the title, the line above and the text of the button are the page's own.
 */
function ContactFormView({ node, ctx }: { node: ContactFormNode; ctx: Ctx }) {
  const id = node.id;
  const live = ctx.forms ?? null;
  if (ctx.forms === null) return null;
  const field = (name: string) => `${ctx.scope}${id}-${name}`;
  return (
    <section {...attrsOf(node, ctx, "site-section site-contact-form")}>
      <Eyebrow ctx={ctx} id={id} value={node.eyebrow} />
      {shown(ctx, node.heading) && (
        <h2>
          <T ctx={ctx} id={id} path="heading" value={node.heading} placeholder="Título do formulário" max={120} />
        </h2>
      )}
      {shown(ctx, node.text) && (
        <p className="site-text">
          <T ctx={ctx} id={id} path="text" value={node.text} placeholder="Texto (opcional)" max={300} multiline />
        </p>
      )}
      <form className="site-form" method="post" action={live?.action} {...(live ? {} : { "aria-label": "Amostra do formulário" })}>
        <fieldset className="site-form-fields" disabled={!live}>
          {live && <input type="hidden" name={FIELD.page} value={live.page} />}
          <label htmlFor={field("nome")}>
            Nome
            <input id={field("nome")} name={FIELD.name} required minLength={2} maxLength={160} autoComplete="name" />
          </label>
          <label htmlFor={field("contato")}>
            E-mail ou telefone com DDD
            <input id={field("contato")} name={FIELD.contact} required maxLength={254} autoComplete="email" />
          </label>
          <label htmlFor={field("mensagem")}>
            Mensagem (opcional)
            <textarea id={field("mensagem")} name={FIELD.message} rows={4} maxLength={1000} />
          </label>
          {live && (
            <div className="site-form-bait" aria-hidden="true">
              <label>
                Não preencha este campo
                <input name={FIELD.bait} tabIndex={-1} autoComplete="off" />
              </label>
            </div>
          )}
          <label className="site-form-consent">
            <input type="checkbox" name={FIELD.consent} required />
            <span>
              Li o{" "}
              {live ? (
                <a href={live.noticeUrl} target="_blank" rel="noopener noreferrer">
                  aviso de privacidade
                </a>
              ) : (
                "aviso de privacidade"
              )}{" "}
              e concordo em ser contatado(a) por este profissional.
            </span>
          </label>
        </fieldset>
        {ctx.edit ? (
          <span className="button primary site-button-stand-in">
            <T ctx={ctx} id={id} path="buttonLabel" value={node.buttonLabel} placeholder="Texto do botão" max={40} />
          </span>
        ) : (
          node.buttonLabel !== "" && (
            <button type="submit" className="button primary" disabled={!live}>
              {node.buttonLabel}
            </button>
          )
        )}
      </form>
      {!live && (
        <p className="site-hint">
          Amostra: o formulário só funciona na página publicada, depois que os formulários públicos estiverem abertos pela plataforma e o recebimento de mensagens estiver ligado no Meu Site. Enquanto isso ele não aparece para quem visita.
        </p>
      )}
    </section>
  );
}

/** The logo is decoration next to the name, which is text: its description would only repeat it. */
function SiteLogo({ logo }: { logo: ResolvedImage }) {
  // eslint-disable-next-line @next/next/no-img-element -- served by this app from a private bucket
  return <img className="site-logo" src={logo.src} width={logo.width} height={logo.height} alt="" decoding="async" />;
}

/**
 * The menu of the pages in the header: links on the page, stand-ins in the editor's canvas (a click there selects, it does not go anywhere).
 * On a wide page it is a row of links; on a narrow one (the stylesheet decides by the width of the page itself, so the editor's phone frame
 * does the same) it folds into a "Menu" button that opens the list under the header. The button is a hidden checkbox and its label, so it
 * works with no script and with the keyboard (Space), and the links are in the page once.
 */
function SiteMenu({ nav, edit, scope }: { nav: SiteNav; edit: boolean; scope: string }) {
  if (nav.items.length < 2) return null;
  const toggle = `${scope}site-menu-toggle`;
  return (
    <nav className="site-menu" aria-label="Páginas do site">
      <input type="checkbox" id={toggle} className="site-menu-state" aria-controls={`${toggle}-list`} />
      <label htmlFor={toggle} className="site-menu-toggle">
        <span className="site-menu-icon" aria-hidden="true" />
        Menu
      </label>
      <ul id={`${toggle}-list`}>
        {nav.items.map((item) => (
          <li key={item.id}>
            {edit ? (
              <span className="site-menu-link" aria-current={item.current ? "page" : undefined}>
                {item.label}
              </span>
            ) : (
              <a
                className="site-menu-link"
                href={item.href}
                aria-current={item.current ? "page" : undefined}
                {...(nav.onVisit
                  ? {
                      onClick: (event: { preventDefault: () => void; currentTarget: Element }) => {
                        event.preventDefault();
                        // The preview shows the page in place: the folded menu closes, as a link that goes to another page would have closed it.
                        const state = event.currentTarget.closest("nav")?.querySelector<HTMLInputElement>(".site-menu-state");
                        if (state) state.checked = false;
                        nav.onVisit?.(item.id);
                      },
                    }
                  : null)}
              >
                {item.label}
              </a>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function SiteRenderer({
  content,
  edit,
  images,
  scope = "",
  bare = false,
  nav,
  marks,
  forms,
}: {
  content: SiteContent;
  edit?: EditHooks;
  images?: ImageResolver;
  scope?: string;
  /** The pages of the site: the menu in the header, and where the links to a page lead. */
  nav?: SiteNav;
  /** Blocks to mark as added or changed, for a version being compared with another. */
  marks?: ReadonlyMap<string, "added" | "changed">;
  /** The contact form: where it is sent, `null` when it is closed on a published page; absent in the editor and in the preview (a sample). */
  forms?: PublicForm | null;
  /** Only the blocks, without the header with the name of the site and the footer with the contacts (the editor draws a component alone). */
  bare?: boolean;
}) {
  const nodes = allNodes(content.blocks);
  const existing = new Set(nodes.map((entry) => entry.id));
  const anchors = new Set(
    nodes.flatMap((entry): string[] => ((entry.type === "button" || entry.type === "link") && entry.anchor && existing.has(entry.anchor) ? [entry.anchor] : [])),
  );
  const firstHero = nodes.find((entry) => entry.type === "hero")?.id ?? null;
  const ctx: Ctx = { content, edit, images, anchors, firstHero, scope, nav, marks, forms };
  const logo = content.logoAssetId ? images?.(content.logoAssetId) ?? null : null;
  const contacts = [
    { label: "WhatsApp", href: whatsappUrl(content.contact.whatsapp), external: true },
    { label: "E-mail", href: emailUrl(content.contact.email), external: false },
    { label: "Instagram", href: instagramUrl(content.contact.instagram), external: true },
  ].filter((entry): entry is { label: string; href: string; external: boolean } => Boolean(entry.href));
  return (
    <div className="site" {...themeAttributes(content.theme)}>
      {!bare && (
        <header className="site-header">
          {firstHero === null ? (
            <h1 className="site-brand">
              {logo && <SiteLogo logo={logo} />}
              {content.title}
            </h1>
          ) : (
            <p className="site-brand">
              {logo && <SiteLogo logo={logo} />}
              {content.title}
            </p>
          )}
          {nav && <SiteMenu nav={nav} edit={edit !== undefined} scope={scope} />}
        </header>
      )}
      <main className="site-main" data-page-root={edit ? "" : undefined}>
        {content.blocks.map((entry) => (
          <NodeView key={entry.id} node={entry} ctx={ctx} />
        ))}
        {edit && content.blocks.length === 0 && (
          <p className="site-hint">A página está sem blocos. Arraste um bloco da biblioteca para cá, ou clique em um deles para acrescentar.</p>
        )}
      </main>
      {!bare && contacts.length > 0 && (
        <footer className="site-footer">
          <p>Contato:</p>
          <ul>
            {contacts.map((entry) => (
              <li key={entry.label}>
                {edit ? (
                  <span className="site-footer-link">{entry.label}</span>
                ) : (
                  <a href={entry.href} {...(entry.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                    {entry.label}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </footer>
      )}
    </div>
  );
}
