import type { ShownTerms } from "./terms";
import { TermsBlock } from "./terms-block";

/**
 * The terms in force, folded, for whoever wants to read them where a person joins the tool. Nothing to tick: joining does not depend on them.
 */
export function TermsReading({ terms }: { terms: ShownTerms }) {
  return (
    <details className="consent-fields">
      <summary>Ler os termos (versão {terms.version})</summary>
      <TermsBlock terms={terms} />
    </details>
  );
}
