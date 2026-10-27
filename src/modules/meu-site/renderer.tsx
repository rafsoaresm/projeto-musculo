import type { Block, Channel, SiteContent } from "./contracts";
import { channelUrl, emailUrl, instagramUrl, whatsappUrl } from "./contracts";
import { DELIVERY_LABEL } from "@/modules/leads/contracts";

/**
 * The public page, from a document. The editor's preview and the published page use this same component, so
 * what is seen before publishing is what is published. Everything it prints is text that React escapes; the
 * only links are made from the contact fields by `channelUrl` and friends, which accept nothing but a phone
 * number, an e-mail address and a handle. No script, no third-party resource, no form.
 */
function Action({ content, channel, label, variant }: { content: SiteContent; channel: Channel | undefined; label: string; variant: "primary" | "secondary" }) {
  const href = channelUrl(content.contact, channel);
  if (!href || !label) return null;
  const external = href.startsWith("https://");
  return (
    <a className={`button ${variant}`} href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      {label}
    </a>
  );
}

function BlockView({ block, content, heroHeading }: { block: Block; content: SiteContent; heroHeading: boolean }) {
  if (block.type === "hero") {
    const Heading = heroHeading ? "h1" : "h2";
    return (
      <section className="site-section site-hero" aria-label={block.heading || "Destaque"}>
        {block.heading && <Heading>{block.heading}</Heading>}
        {block.subheading && <p className="site-lead">{block.subheading}</p>}
        <div className="site-actions">
          <Action content={content} channel={block.buttonChannel} label={block.buttonLabel} variant="primary" />
        </div>
      </section>
    );
  }
  if (block.type === "text") {
    return (
      <section className="site-section">
        {block.heading && <h2>{block.heading}</h2>}
        {block.text && <p className="site-text">{block.text}</p>}
      </section>
    );
  }
  if (block.type === "services") {
    return (
      <section className="site-section">
        {block.heading && <h2>{block.heading}</h2>}
        {block.intro && <p className="site-text">{block.intro}</p>}
        <ul className="site-services">
          {(block.items ?? []).map((item, index) => (
            <li key={`${item.name}-${index}`}>
              <h3>{item.name}</h3>
              <p className="site-delivery">{DELIVERY_LABEL[item.delivery]}</p>
              {item.description && <p className="site-text">{item.description}</p>}
            </li>
          ))}
        </ul>
      </section>
    );
  }
  if (block.type === "faq") {
    const items = block.items.filter((item) => item.question && item.answer);
    return (
      <section className="site-section site-faq">
        {block.heading && <h2>{block.heading}</h2>}
        {items.map((item, index) => (
          <details key={`${item.question}-${index}`}>
            <summary>{item.question}</summary>
            <p className="site-text">{item.answer}</p>
          </details>
        ))}
      </section>
    );
  }
  return (
    <section className="site-section site-cta">
      {block.heading && <h2>{block.heading}</h2>}
      {block.text && <p className="site-text">{block.text}</p>}
      <div className="site-actions">
        <Action content={content} channel={block.buttonChannel} label={block.buttonLabel} variant="primary" />
      </div>
    </section>
  );
}

export function SiteRenderer({ content }: { content: SiteContent }) {
  const firstHero = content.blocks.findIndex((block) => block.type === "hero");
  const contacts = [
    { label: "WhatsApp", href: whatsappUrl(content.contact.whatsapp), external: true },
    { label: "E-mail", href: emailUrl(content.contact.email), external: false },
    { label: "Instagram", href: instagramUrl(content.contact.instagram), external: true },
  ].filter((entry): entry is { label: string; href: string; external: boolean } => Boolean(entry.href));
  return (
    <div className="site">
      <header className="site-header">
        {firstHero === -1 ? <h1 className="site-brand">{content.title}</h1> : <p className="site-brand">{content.title}</p>}
      </header>
      <main className="site-main">
        {content.blocks.map((block, index) => (
          <BlockView key={block.id} block={block} content={content} heroHeading={index === firstHero} />
        ))}
      </main>
      {contacts.length > 0 && (
        <footer className="site-footer">
          <p>Contato:</p>
          <ul>
            {contacts.map((entry) => (
              <li key={entry.label}>
                <a href={entry.href} {...(entry.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                  {entry.label}
                </a>
              </li>
            ))}
          </ul>
        </footer>
      )}
    </div>
  );
}
