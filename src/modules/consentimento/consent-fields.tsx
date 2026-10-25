import type { ShownTerms } from "./terms";
import { TermsBlock } from "./terms-block";

/**
 * What a person sees and ticks to join the tool: the terms, the required acknowledgement and, for a
 * student, the optional photos choice. The fields are plain form fields (`accepted`, `photos`) plus the
 * version being read (`termsVersion`), read by the server action of the form that embeds them. Nothing
 * is ticked beforehand.
 */
export function ConsentFields({ terms }: { terms: ShownTerms }) {
  const { content } = terms;
  return (
    <fieldset className="consent-fields">
      <legend>Termos</legend>
      <TermsBlock terms={terms} />
      <input type="hidden" name="termsVersion" value={terms.version} />
      <label className="check-row">
        <input type="checkbox" name="accepted" required />
        {content.confirmation}
      </label>
      {content.photos && (
        <label className="check-row">
          <input type="checkbox" name="photos" />
          {content.photos.label}
        </label>
      )}
    </fieldset>
  );
}
