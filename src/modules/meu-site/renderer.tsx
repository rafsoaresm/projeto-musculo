import { Fragment, type HTMLAttributes, type ReactNode } from "react";
import {
  channelUrl,
  emailUrl,
  instagramUrl,
  whatsappUrl,
  type Block,
  type Channel,
  type ColumnItem,
  type SiteContent,
} from "./contracts";
import { columnKey, type ContainerKey, type Side } from "./editor-model";
import { themeAttributes } from "./site-theme";
import { DELIVERY_LABEL } from "@/modules/leads/contracts";

/**
 * The public page, from a document. The editor's canvas, its preview and the published page use this same
 * component, so what is seen before publishing is what is published. Everything it prints is text that React
 * escapes; the only links are made from the contact fields by `channelUrl` and friends, which accept nothing
 * but a phone number, an e-mail address and a handle. No script, no third-party resource, no form, no image.
 *
 * Without `edit` (the public page and the preview) it prints the page and nothing else. With `edit` (the
 * canvas of the editor) the same markup is wrapped by the editor: each text becomes a field that can be
 * typed over, each block is framed with its tools, and the places where a block can be dropped appear.
 */
export interface FieldSpec {
  blockId: string;
  /** Where in the block: "heading", "items.2.question"... */
  path: string;
  value: string;
  placeholder: string;
  max: number;
  multiline?: boolean;
}
export interface Place {
  container: ContainerKey;
  index: number;
  count: number;
}
/** How an image of the library is drawn here: where it is served from and its size, or null when it is not there. */
export interface ResolvedImage {
  src: string;
  width: number;
  height: number;
}
export type ImageResolver = (assetId: string) => ResolvedImage | null;

export interface EditHooks {
  /** A text of a block, as a field that can be typed over. */
  text: (field: FieldSpec) => ReactNode;
  /** A block with its frame, tools and the lines that show where a dragged block would land. */
  frame: (entry: Block | ColumnItem, view: ReactNode, place: Place) => ReactNode;
  /** What stands where a container has no block at all (the page, or one column). */
  empty: (container: ContainerKey) => ReactNode;
  /** The drag handlers of one column, so a block can be dropped at the end of it. */
  columnProps: (columnsId: string, side: Side) => HTMLAttributes<HTMLDivElement>;
  /** What closes one column: the buttons that add an element to it without dragging. */
  columnTools: (columnsId: string, side: Side, count: number) => ReactNode;
}

interface Ctx {
  content: SiteContent;
  edit?: EditHooks;
  images?: ImageResolver;
}

/** A text of the document: printed as it is, or, in the editor, a field. Empty texts print nothing on the public page. */
function T({ ctx, id, path, value, placeholder, max, multiline }: { ctx: Ctx; id: string; path: string; value: string; placeholder: string; max: number; multiline?: boolean }) {
  return ctx.edit ? <>{ctx.edit.text({ blockId: id, path, value, placeholder, max, multiline })}</> : <>{value}</>;
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

/** Whether an element has anything to show on the public page: a text, or a button with a label and a contact. */
function visible(item: ColumnItem, ctx: Ctx): boolean {
  if (ctx.edit) return true;
  if (item.type === "image") return Boolean(item.assetId && ctx.images?.(item.assetId));
  return item.type === "button" ? Boolean(item.label && channelUrl(ctx.content.contact, item.channel)) : item.text !== "";
}

function ElementView({ item, ctx }: { item: ColumnItem; ctx: Ctx }) {
  if (!visible(item, ctx)) return null;
  if (item.type === "heading") {
    return (
      <h2 className="site-heading">
        <T ctx={ctx} id={item.id} path="text" value={item.text} placeholder="Escreva o título" max={120} />
      </h2>
    );
  }
  if (item.type === "image") {
    const image = item.assetId ? ctx.images?.(item.assetId) ?? null : null;
    return (
      <figure className="site-image" data-size={item.size}>
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
      <p className="site-text">
        <T ctx={ctx} id={item.id} path="text" value={item.text} placeholder="Escreva o texto" max={2000} multiline />
      </p>
    );
  }
  return (
    <div className="site-actions">
      <Action ctx={ctx} id={item.id} labelPath="label" label={item.label} channel={item.channel} />
    </div>
  );
}

/** The elements of a list (the page, or one column), each framed in the editor. */
function List({ items, container, ctx, render }: { items: readonly (Block | ColumnItem)[]; container: ContainerKey; ctx: Ctx; render: (entry: Block | ColumnItem, index: number) => ReactNode }) {
  const { edit } = ctx;
  if (!edit) return <>{items.map((entry, index) => <Fragment key={entry.id}>{render(entry, index)}</Fragment>)}</>;
  if (items.length === 0) return <>{edit.empty(container)}</>;
  return (
    <>
      {items.map((entry, index) => (
        <Fragment key={entry.id}>{edit.frame(entry, render(entry, index), { container, index, count: items.length })}</Fragment>
      ))}
    </>
  );
}

function BlockView({ block, ctx, heroHeading }: { block: Block; ctx: Ctx; heroHeading: boolean }) {
  const { edit } = ctx;
  const id = block.id;
  switch (block.type) {
    case "hero": {
      const Heading = heroHeading ? "h1" : "h2";
      return (
        <section className="site-section site-hero" aria-label={block.heading || "Destaque"}>
          <Eyebrow ctx={ctx} id={id} value={block.eyebrow} />
          {shown(ctx, block.heading) && (
            <Heading>
              <T ctx={ctx} id={id} path="heading" value={block.heading} placeholder="Título do destaque" max={120} />
            </Heading>
          )}
          {shown(ctx, block.subheading) && (
            <p className="site-lead">
              <T ctx={ctx} id={id} path="subheading" value={block.subheading} placeholder="Subtítulo" max={300} multiline />
            </p>
          )}
          <div className="site-actions">
            <Action ctx={ctx} id={id} labelPath="buttonLabel" label={block.buttonLabel} channel={block.buttonChannel} />
          </div>
        </section>
      );
    }
    case "text":
      return (
        <section className="site-section">
          <Eyebrow ctx={ctx} id={id} value={block.eyebrow} />
          {shown(ctx, block.heading) && (
            <h2>
              <T ctx={ctx} id={id} path="heading" value={block.heading} placeholder="Título (opcional)" max={120} />
            </h2>
          )}
          {shown(ctx, block.text) && (
            <p className="site-text">
              <T ctx={ctx} id={id} path="text" value={block.text} placeholder="Escreva o texto" max={2000} multiline />
            </p>
          )}
        </section>
      );
    case "services":
      return (
        <section className="site-section">
          <Eyebrow ctx={ctx} id={id} value={block.eyebrow} />
          {shown(ctx, block.heading) && (
            <h2>
              <T ctx={ctx} id={id} path="heading" value={block.heading} placeholder="Título da seção" max={120} />
            </h2>
          )}
          {shown(ctx, block.intro) && (
            <p className="site-text">
              <T ctx={ctx} id={id} path="intro" value={block.intro} placeholder="Introdução (opcional)" max={300} multiline />
            </p>
          )}
          <ul className="site-services">
            {(block.items ?? []).map((item, index) => (
              <li key={`${item.name}-${index}`}>
                <h3>{item.name}</h3>
                <p className="site-delivery">{DELIVERY_LABEL[item.delivery]}</p>
                {item.description && <p className="site-text">{item.description}</p>}
              </li>
            ))}
          </ul>
          {edit && (block.items ?? []).length === 0 && (
            <p className="site-hint">Escolha os serviços deste bloco no painel à direita. Eles vêm da lista de Serviços.</p>
          )}
        </section>
      );
    case "about":
      return (
        <section className="site-section site-about">
          <div className="site-about-grid">
            <div className="site-about-copy">
              <Eyebrow ctx={ctx} id={id} value={block.eyebrow} />
              {shown(ctx, block.heading) && (
                <h2>
                  <T ctx={ctx} id={id} path="heading" value={block.heading} placeholder="Título" max={120} />
                </h2>
              )}
              {shown(ctx, block.text) && (
                <p className="site-text">
                  <T ctx={ctx} id={id} path="text" value={block.text} placeholder="Conte sobre o seu trabalho" max={2000} multiline />
                </p>
              )}
            </div>
            {(block.stat !== "" || edit) && (
              <div className="site-stat">
                <strong>
                  <T ctx={ctx} id={id} path="stat" value={block.stat} placeholder="Número" max={16} />
                </strong>
                <span>
                  <T ctx={ctx} id={id} path="statLabel" value={block.statLabel} placeholder="Legenda" max={80} />
                </span>
              </div>
            )}
          </div>
        </section>
      );
    case "quote":
      return (
        <section className="site-section site-quote">
          <Eyebrow ctx={ctx} id={id} value={block.eyebrow} />
          <figure>
            {shown(ctx, block.quote) && (
              <blockquote>
                “<T ctx={ctx} id={id} path="quote" value={block.quote} placeholder="Escreva o depoimento" max={600} multiline />”
              </blockquote>
            )}
            {shown(ctx, block.author) && (
              <figcaption>
                <T ctx={ctx} id={id} path="author" value={block.author} placeholder="Quem deu o depoimento" max={80} />
              </figcaption>
            )}
          </figure>
        </section>
      );
    case "stats": {
      const items = edit ? block.items : block.items.filter((item) => item.value && item.label);
      return (
        <section className="site-section">
          <Eyebrow ctx={ctx} id={id} value={block.eyebrow} />
          {shown(ctx, block.heading) && (
            <h2>
              <T ctx={ctx} id={id} path="heading" value={block.heading} placeholder="Título da seção" max={120} />
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
      const items = block.items.filter((item) => item.question && item.answer);
      return (
        <section className="site-section site-faq">
          <Eyebrow ctx={ctx} id={id} value={block.eyebrow} />
          {shown(ctx, block.heading) && (
            <h2>
              <T ctx={ctx} id={id} path="heading" value={block.heading} placeholder="Título da seção" max={120} />
            </h2>
          )}
          {edit
            ? block.items.map((item, index) => (
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
        <section className="site-section site-cta">
          <Eyebrow ctx={ctx} id={id} value={block.eyebrow} />
          {shown(ctx, block.heading) && (
            <h2>
              <T ctx={ctx} id={id} path="heading" value={block.heading} placeholder="Título da chamada" max={120} />
            </h2>
          )}
          {shown(ctx, block.text) && (
            <p className="site-text">
              <T ctx={ctx} id={id} path="text" value={block.text} placeholder="Texto (opcional)" max={300} multiline />
            </p>
          )}
          <div className="site-actions">
            <Action ctx={ctx} id={id} labelPath="buttonLabel" label={block.buttonLabel} channel={block.buttonChannel} />
          </div>
        </section>
      );
    case "columns": {
      const sides = (["left", "right"] as const).filter((side) => edit || block[side].length > 0);
      if (sides.length === 0) return null;
      return (
        <section className="site-section site-columns-section">
          <div className={`site-columns site-columns-${block.ratio}`} data-single={sides.length === 1 ? "" : undefined}>
            {sides.map((side) => (
              <div className="site-column" key={side} data-side={side} {...edit?.columnProps(id, side)}>
                <List
                  items={block[side]}
                  container={columnKey(id, side)}
                  ctx={ctx}
                  render={(entry) => <ElementView item={entry as ColumnItem} ctx={ctx} />}
                />
                {edit?.columnTools(id, side, block[side].length)}
              </div>
            ))}
          </div>
        </section>
      );
    }
    case "heading":
    case "paragraph":
    case "button":
    case "image": {
      return visible(block, ctx) ? (
        <section className="site-section site-basic">
          <ElementView item={block} ctx={ctx} />
        </section>
      ) : null;
    }
  }
}

/** The logo is decoration next to the name, which is text: its description would only repeat it. */
function SiteLogo({ logo }: { logo: ResolvedImage }) {
  // eslint-disable-next-line @next/next/no-img-element -- served by this app from a private bucket
  return <img className="site-logo" src={logo.src} width={logo.width} height={logo.height} alt="" decoding="async" />;
}

export function SiteRenderer({ content, edit, images }: { content: SiteContent; edit?: EditHooks; images?: ImageResolver }) {
  const ctx: Ctx = { content, edit, images };
  const logo = content.logoAssetId ? images?.(content.logoAssetId) ?? null : null;
  const firstHero = content.blocks.findIndex((block) => block.type === "hero");
  const contacts = [
    { label: "WhatsApp", href: whatsappUrl(content.contact.whatsapp), external: true },
    { label: "E-mail", href: emailUrl(content.contact.email), external: false },
    { label: "Instagram", href: instagramUrl(content.contact.instagram), external: true },
  ].filter((entry): entry is { label: string; href: string; external: boolean } => Boolean(entry.href));
  return (
    <div className="site" {...themeAttributes(content.theme)}>
      <header className="site-header">
        {firstHero === -1 ? (
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
      </header>
      <main className="site-main">
        <List
          items={content.blocks}
          container="root"
          ctx={ctx}
          render={(entry, index) => <BlockView block={entry as Block} ctx={ctx} heroHeading={index === firstHero} />}
        />
      </main>
      {contacts.length > 0 && (
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
