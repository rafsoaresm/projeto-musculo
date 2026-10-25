/** What the embedded consent fields sent: the required acknowledgement and the optional photos choice. */
export function readConsent(form: FormData) {
  return { accepted: form.get("accepted") === "on", photos: form.get("photos") === "on" };
}

export const CONSENT_REQUIRED = "Para continuar, leia os termos e marque que você aceita.";
