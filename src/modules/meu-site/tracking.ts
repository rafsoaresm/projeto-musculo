/**
 * The tagging of the public pages (Meu Site 0.71): what the owner types in the panel "Rastreamento e conversões", read into public identifiers of
 * Google Analytics 4, Google Ads and the Meta Pixel, what counts as a conversion, the value of a contact and the site's privacy notice. Pure: the
 * server action and the tests use it; the repository (db/site-tracking.ts) keeps what it returns and the database checks the formats again.
 *
 * Google Tag Manager is not accepted (decision of 02/11/2026): the public pages share the origin of the app, and a container runs any code.
 */

export const TRACKING_FIELDS = ["ga4", "adsId", "adsLabelLead", "adsLabelContact", "meta", "leadValue", "privacyUrl"] as const;
export type TrackingField = (typeof TRACKING_FIELDS)[number];

export const CONTACT_METHODS = ["whatsapp", "form", "email", "instagram"] as const;
export type ContactMethod = (typeof CONTACT_METHODS)[number];

export interface TrackingSettings {
  ga4Id: string | null;
  adsId: string | null;
  adsLabelLead: string | null;
  adsLabelContact: string | null;
  metaPixelId: string | null;
  /** What one contact is worth, in cents of BRL; null when the owner left it empty. */
  leadValueCents: number | null;
  /** Which contacts count as conversions for Google Ads and Meta. */
  count: Record<ContactMethod, boolean>;
  /** The site's own privacy notice (https), optional; kept with the settings. */
  privacyUrl: string | null;
}

export const EMPTY_TRACKING: TrackingSettings = {
  ga4Id: null,
  adsId: null,
  adsLabelLead: null,
  adsLabelContact: null,
  metaPixelId: null,
  leadValueCents: null,
  count: { whatsapp: true, form: true, email: false, instagram: false },
  privacyUrl: null,
};

export const GA4_ID = /^G-[A-Z0-9]{6,12}$/;
export const ADS_ID = /^AW-[0-9]{8,12}$/;
export const ADS_LABEL = /^[A-Za-z0-9_-]{6,40}$/;
/** Meta publishes no length: the IDs seen are 15 or 16 digits; 10 to 20 are accepted with a warning. */
export const META_ID = /^[0-9]{10,20}$/;
const META_USUAL = /^[0-9]{15,16}$/;
export const LEAD_VALUE_MAX_CENTS = 100_000_000;
export const PRIVACY_URL_MAX = 500;

type Read = { value: string | null } | { error: string };

/** What the person typed, without the spaces around and inside it (an ID never has spaces; a pasted one often does). */
const compact = (raw: unknown) => (typeof raw === "string" ? raw.replace(/\s+/g, "") : "");
/** A pasted snippet or address, rather than a bare ID. */
const looksPasted = (text: string) => /[<>()'"=/?&;:]/.test(text) || text.length > 40;

const WRONG = {
  ua: "Esse é um ID do Universal Analytics (UA-…), que o Google desligou. Use o ID de medição do GA4, que começa com G-.",
  gtm: "Esse é um ID do Google Tag Manager (GTM-…). O GTM ainda não está disponível neste site; veja o aviso no campo dele.",
  gt: "Esse é um ID de tag do Google (GT-…). Use o ID de medição do GA4, que começa com G- (no GA4: Administrador › Fluxos de dados).",
  aw: "Esse é um ID do Google Ads (AW-…): coloque-o no campo do Google Ads.",
  g: "Esse é um ID do Google Analytics 4 (G-…): coloque-o no campo do Google Analytics.",
};

/** The message for an ID of another tool typed in this field (`own` is the prefix this field takes), or null. */
function wrongField(upper: string, own: "G" | "AW" | "META"): string | null {
  if (upper.startsWith("UA-")) return WRONG.ua;
  if (upper.startsWith("GTM-")) return WRONG.gtm;
  if (upper.startsWith("GT-")) return WRONG.gt;
  if (own !== "AW" && upper.startsWith("AW-")) return WRONG.aw;
  if (own !== "G" && upper.startsWith("G-")) return WRONG.g;
  return null;
}

export function readGa4(raw: unknown): Read {
  const text = compact(raw);
  if (!text) return { value: null };
  const upper = text.toUpperCase();
  if (looksPasted(text)) {
    const found = /(?:^|[^A-Z0-9-])(G-[A-Z0-9]{6,12})(?![A-Z0-9])/.exec(upper);
    if (found) return { value: found[1]! };
  }
  if (GA4_ID.test(upper)) return { value: upper };
  return { error: wrongField(upper, "G") ?? "O ID de medição do GA4 começa com G- seguido de letras e números, por exemplo G-AB12CD34EF." };
}

/** The Google Ads ID; a pasted "AW-123456789/AbCdEf" gives the label too, and bare digits get their prefix. */
export function readAds(raw: unknown): { value: string | null; label?: string } | { error: string } {
  const text = compact(raw);
  if (!text) return { value: null };
  // Typed ("AW-123456789", "aw-123456789/AbCd12") or found in a pasted snippet; bare digits get their prefix.
  const typed = /^AW-([0-9]{8,12})(?:\/([A-Za-z0-9_-]{6,40}))?$/i.exec(text);
  const found = typed ?? (looksPasted(text) ? /AW-([0-9]{8,12})(?:\/([A-Za-z0-9_-]{6,40}))?(?![A-Za-z0-9_-])/i.exec(text) : null);
  if (found) return found[2] ? { value: `AW-${found[1]!}`, label: found[2] } : { value: `AW-${found[1]!}` };
  if (/^[0-9]{8,12}$/.test(text)) return { value: `AW-${text}` };
  return { error: wrongField(text.toUpperCase(), "AW") ?? "O ID do Google Ads começa com AW- seguido de 8 a 12 números, por exemplo AW-123456789." };
}

/** A label of a conversion (case-sensitive: never upper-cased); a pasted "AW-123456789/AbCdEf" gives its label and its ID. */
export function readAdsLabel(raw: unknown): { value: string | null; id?: string } | { error: string } {
  const text = compact(raw);
  if (!text) return { value: null };
  const pasted = /AW-([0-9]{8,12})\/([A-Za-z0-9_-]{6,40})(?![A-Za-z0-9_-])/i.exec(text);
  if (pasted) return { value: pasted[2]!, id: `AW-${pasted[1]!}` };
  if (ADS_LABEL.test(text)) return { value: text };
  return { error: "O rótulo da conversão tem de 6 a 40 letras, números, - ou _ (no Google Ads: Metas › Conversões › a ação › Configurar tag › send_to, depois da barra)." };
}

export function readMeta(raw: unknown): { value: string | null; warning?: string } | { error: string } {
  const text = compact(raw);
  if (!text) return { value: null };
  let digits = text;
  if (!/^[0-9]+$/.test(text)) {
    const init = /init['"]?,['"]?([0-9]{10,20})/.exec(text) ?? (looksPasted(text) ? /(?:^|[^0-9])([0-9]{10,20})(?![0-9])/.exec(text) : null);
    if (!init) return { error: wrongField(text.toUpperCase(), "META") ?? "O ID do Meta Pixel tem só números (em geral 15 ou 16), por exemplo 123456789012345." };
    digits = init[1]!;
  }
  if (!META_ID.test(digits)) return { error: "O ID do Meta Pixel tem só números (em geral 15 ou 16), por exemplo 123456789012345." };
  return META_USUAL.test(digits)
    ? { value: digits }
    : { value: digits, warning: "Os IDs do Meta Pixel costumam ter 15 ou 16 números. Confira no Gerenciador de Eventos se este está completo." };
}

/** "150", "150,00", "1.500,50", "R$ 80" or "80.5": cents of BRL. Empty is null (no value sent). */
export function readLeadValue(raw: unknown): { value: number | null } | { error: string } {
  let text = (typeof raw === "string" ? raw : "").replace(/\s+/g, "").replace(/^R\$/i, "");
  if (!text) return { value: null };
  if (text.includes(",")) text = text.replace(/\./g, "").replace(",", ".");
  else if (/^[0-9]{1,3}(\.[0-9]{3})+$/.test(text)) text = text.replace(/\./g, "");
  if (!/^[0-9]{1,9}(\.[0-9]{1,2})?$/.test(text)) return { error: "Escreva o valor em reais, só com números, por exemplo 150 ou 150,00." };
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (cents > LEAD_VALUE_MAX_CENTS) return { error: "O valor passa do que um contato costuma valer (até R$ 1.000.000)." };
  return { value: cents };
}

export function readPrivacyUrl(raw: unknown): { value: string | null } | { error: string } {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { value: null };
  const problem = "Use o endereço completo do aviso de privacidade do seu site, começando com https://.";
  if (text.length > PRIVACY_URL_MAX || /[\s<>"]/.test(text)) return { error: problem };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { error: problem };
  }
  if (url.protocol !== "https:" || !url.hostname.includes(".") || url.username || url.password) return { error: problem };
  return { value: url.href };
}

export type TrackingInput = Partial<Record<TrackingField, unknown>> & Partial<Record<`count_${ContactMethod}`, unknown>>;
export type TrackingRead =
  | { ok: true; value: TrackingSettings; warnings: Partial<Record<TrackingField, string>> }
  | { ok: false; errors: Partial<Record<TrackingField, string>> };

const checked = (value: unknown) => value === true || value === "on" || value === "1" || value === "true";

/** Everything the panel sends, read as a whole: each field says its own problem, next to it. */
export function readTracking(input: TrackingInput): TrackingRead {
  const errors: Partial<Record<TrackingField, string>> = {};
  const warnings: Partial<Record<TrackingField, string>> = {};
  const ga4 = readGa4(input.ga4);
  const ads = readAds(input.adsId);
  const lead = readAdsLabel(input.adsLabelLead);
  const contact = readAdsLabel(input.adsLabelContact);
  const meta = readMeta(input.meta);
  const value = readLeadValue(input.leadValue);
  const privacy = readPrivacyUrl(input.privacyUrl);
  if ("error" in ga4) errors.ga4 = ga4.error;
  if ("error" in ads) errors.adsId = ads.error;
  if ("error" in lead) errors.adsLabelLead = lead.error;
  if ("error" in contact) errors.adsLabelContact = contact.error;
  if ("error" in meta) errors.meta = meta.error;
  else if (meta.warning) warnings.meta = meta.warning;
  if ("error" in value) errors.leadValue = value.error;
  if ("error" in privacy) errors.privacyUrl = privacy.error;

  // The ID may come from a pasted "AW-…/label" in any of the three fields; the labels may come with the ID.
  let adsId = "value" in ads ? ads.value : null;
  let leadLabel = "value" in lead ? lead.value : null;
  const contactLabel = "value" in contact ? contact.value : null;
  if ("label" in ads && ads.label && !leadLabel && !("error" in lead)) leadLabel = ads.label;
  for (const label of [lead, contact]) {
    if ("id" in label && label.id) {
      if (!adsId && !("error" in ads)) adsId = label.id;
      else if (adsId && adsId !== label.id) errors.adsId ??= "O ID colado no rótulo é de outra conta do Google Ads. Confira os dois campos.";
    }
  }
  if (!adsId && !errors.adsId && (leadLabel || contactLabel)) errors.adsId = "Para usar os rótulos, escreva também o ID do Google Ads (AW-…).";
  if (adsId && !leadLabel && !contactLabel && !errors.adsLabelLead && !errors.adsLabelContact)
    errors.adsLabelLead = "Escreva o rótulo de pelo menos uma conversão: sem ele o Google Ads não conta nada.";
  if (leadLabel && contactLabel && leadLabel === contactLabel)
    errors.adsLabelContact = "Use uma ação de conversão diferente para os cliques de contato, ou deixe este campo vazio.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    warnings,
    value: {
      ga4Id: "value" in ga4 ? ga4.value : null,
      adsId,
      adsLabelLead: leadLabel,
      adsLabelContact: contactLabel,
      metaPixelId: "value" in meta ? meta.value : null,
      leadValueCents: "value" in value ? value.value : null,
      count: {
        whatsapp: checked(input.count_whatsapp),
        form: checked(input.count_form),
        email: checked(input.count_email),
        instagram: checked(input.count_instagram),
      },
      privacyUrl: "value" in privacy ? privacy.value : null,
    },
  };
}

/** The tools a site has on, by name, in the order the panel names them. */
export function activeTools(settings: Pick<TrackingSettings, "ga4Id" | "adsId" | "metaPixelId">): string[] {
  const tools: string[] = [];
  if (settings.ga4Id) tools.push("GA4");
  if (settings.adsId) tools.push("Google Ads");
  if (settings.metaPixelId) tools.push("Meta Pixel");
  return tools;
}
export const hasTracking = (settings: Pick<TrackingSettings, "ga4Id" | "adsId" | "metaPixelId"> | null): boolean =>
  Boolean(settings && (settings.ga4Id || settings.adsId || settings.metaPixelId));

/**
 * What the script of a site is given: only the identifiers and the choices, never anything of the organization. `value` is in reais (the unit
 * the tools take), `count` says which contacts are conversions for Google Ads and Meta.
 */
export interface ScriptConfig {
  v: 1;
  site: string;
  ga4: string | null;
  ads: { id: string; lead: string | null; contact: string | null } | null;
  meta: string | null;
  value: number | null;
  count: Record<ContactMethod, boolean>;
  privacy: string | null;
}

export function scriptConfig(slug: string, settings: TrackingSettings): ScriptConfig {
  return {
    v: 1,
    site: slug,
    ga4: settings.ga4Id,
    ads: settings.adsId ? { id: settings.adsId, lead: settings.adsLabelLead, contact: settings.adsLabelContact } : null,
    meta: settings.metaPixelId,
    value: settings.leadValueCents === null ? null : settings.leadValueCents / 100,
    count: { ...settings.count },
    privacy: settings.privacyUrl,
  };
}

/** One line of the table "Evento no site → GA4 / Meta / Google Ads" of the panel: what each tool receives (null: nothing). */
export interface EventRow {
  event: string;
  ga4: string | null;
  meta: string | null;
  ads: string | null;
}

export function trackingEvents(settings: TrackingSettings): EventRow[] {
  const ga4 = Boolean(settings.ga4Id);
  const meta = Boolean(settings.metaPixelId);
  const ads = Boolean(settings.adsId);
  const contactAds = (method: ContactMethod) => (ads && settings.count[method] && settings.adsLabelContact ? "conversão de contato" : null);
  const contactMeta = (method: ContactMethod) => (meta && settings.count[method] ? "Contact" : null);
  return [
    { event: "Abrir uma página", ga4: ga4 ? "page_view" : null, meta: meta ? "PageView" : null, ads: ads ? "visita (tag do Google)" : null },
    {
      event: "Mensagem enviada pelo formulário",
      ga4: ga4 ? "generate_lead" : null,
      meta: meta && settings.count.form ? "Lead" : null,
      ads: ads && settings.count.form && settings.adsLabelLead ? "conversão do formulário" : null,
    },
    { event: "Clique no WhatsApp", ga4: ga4 ? "contact (whatsapp)" : null, meta: contactMeta("whatsapp"), ads: contactAds("whatsapp") },
    { event: "Formulário antes do WhatsApp", ga4: ga4 ? "generate_lead + contact" : null, meta: contactMeta("whatsapp"), ads: contactAds("whatsapp") },
    { event: "Clique no e-mail", ga4: ga4 ? "contact (email)" : null, meta: contactMeta("email"), ads: contactAds("email") },
    { event: "Clique no Instagram", ga4: ga4 ? "contact (instagram)" : null, meta: contactMeta("instagram"), ads: contactAds("instagram") },
  ];
}
