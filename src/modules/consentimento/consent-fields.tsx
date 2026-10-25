import { TERMS, type Audience } from "./terms";
import { TermsBlock } from "./terms-block";

/**
 * What a person sees and ticks to join the tool: the terms, the required acknowledgement and, for a
 * student, the optional photos choice. The fields are plain form fields (`accepted`, `photos`), read
 * by the server action of the form that embeds them. Nothing is ticked beforehand.
 */
export function ConsentFields({ audience }: { audience: Audience }) {
  const terms = TERMS[audience];
  return (
    <fieldset className="consent-fields">
      <legend>Termos</legend>
      <TermsBlock audience={audience} />
      <label className="check-row">
        <input type="checkbox" name="accepted" required />
        {terms.confirmation}
      </label>
      {terms.photos && (
        <label className="check-row">
          <input type="checkbox" name="photos" />
          {terms.photos.label}
        </label>
      )}
    </fieldset>
  );
}
