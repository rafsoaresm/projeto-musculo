import { TERMS, TERMS_ARE_DRAFT, TERMS_VERSION, type Audience } from "./terms";

/** The terms in full, as plain text the person can read before accepting. No state, no script. */
export function TermsBlock({ audience }: { audience: Audience }) {
  const terms = TERMS[audience];
  return (
    <div className="terms-block" role="region" aria-label={terms.title} tabIndex={0}>
      <h3>{terms.title}</h3>
      {TERMS_ARE_DRAFT && (
        <p className="small">
          <strong>Texto provisório.</strong> Este texto ainda está em revisão jurídica e pode mudar; se mudar, será
          pedido um novo aceite.
        </p>
      )}
      <p>{terms.intro}</p>
      {terms.sections.map((section) => (
        <section key={section.heading}>
          <h4>{section.heading}</h4>
          <p>{section.text}</p>
        </section>
      ))}
      {terms.photos && (
        <section>
          <h4>{terms.photos.heading}</h4>
          <p>{terms.photos.text}</p>
        </section>
      )}
      <p className="small muted">Versão {TERMS_VERSION}</p>
    </div>
  );
}
