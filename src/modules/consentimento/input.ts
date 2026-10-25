/**
 * What the embedded consent fields sent: the required acknowledgement, the optional photos choice and
 * the version of the text the person was reading (the server checks it is still the one in force).
 */
export function readConsent(form: FormData) {
  return {
    accepted: form.get("accepted") === "on",
    photos: form.get("photos") === "on",
    shownVersion: String(form.get("termsVersion") ?? ""),
  };
}

export const CONSENT_REQUIRED = "Para continuar, leia os termos e marque que você aceita.";
export const TERMS_OUTDATED =
  "O texto dos termos mudou enquanto você lia. Atualize a página, leia a nova versão e aceite de novo.";
export const CONSENT_FAILED = "Não foi possível registrar o aceite. Atualize a página e tente novamente.";
