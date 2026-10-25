import type { ShownTerms } from "./terms";

/** The terms in full, as plain text the person can read before accepting. No state, no script. */
export function TermsBlock({ terms }: { terms: ShownTerms }) {
  const { content } = terms;
  return (
    <div className="terms-block" role="region" aria-label={content.title} tabIndex={0}>
      <h3>{content.title}</h3>
      <p>{content.intro}</p>
      {content.sections.map((section) => (
        <section key={section.heading}>
          <h4>{section.heading}</h4>
          <p>{section.text}</p>
        </section>
      ))}
      {content.photos && (
        <section>
          <h4>{content.photos.heading}</h4>
          <p>{content.photos.text}</p>
        </section>
      )}
      <p className="small muted">Versão {terms.version}</p>
    </div>
  );
}
