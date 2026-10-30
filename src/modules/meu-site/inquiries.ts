import { emailKey, phoneKey } from "@/modules/leads/contracts";
import { pageSlug } from "./contracts";

/**
 * The contact form of the public page. What is in this file is the rule, outside the routes and the screens: when the form is open at all
 * (it is closed until the environment opens it on purpose), what a visitor may send, and how much. Nothing here reads a database or a request.
 */

/** The environment's own switch (`PUBLIC_FORMS_ENABLED`, exactly "true") and the address of the public privacy notice (`PRIVACY_NOTICE_URL`). */
export interface FormsEnv {
  PUBLIC_FORMS_ENABLED?: string;
  PRIVACY_NOTICE_URL?: string;
}

/** The notice is a page the visitor can open: https, or http on this very machine (the browser tests), and short enough for the column that keeps it. */
export function noticeAddress(raw: string | undefined): string | null {
  const text = raw?.trim() ?? "";
  if (text.length < 8 || text.length > 300) return null;
  try {
    const url = new URL(text);
    const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    if (url.protocol === "https:" || (url.protocol === "http:" && local)) return url.toString();
  } catch {
    // Not an address.
  }
  return null;
}

export type FormsGate = { open: true; noticeUrl: string } | { open: false; why: "off" | "no-notice" };

/**
 * The forms of the public pages are open only when the environment says so on purpose AND there is a privacy notice to point to. A variable declared
 * on the Worker wins; one created in the Webflow dashboard reaches `process.env` instead (the same two roads as the photos).
 */
export function formsGate(env: FormsEnv, processEnv: Record<string, string | undefined>): FormsGate {
  const switchValue = env.PUBLIC_FORMS_ENABLED || processEnv.PUBLIC_FORMS_ENABLED;
  if (switchValue !== "true") return { open: false, why: "off" };
  const noticeUrl = noticeAddress(env.PRIVACY_NOTICE_URL || processEnv.PRIVACY_NOTICE_URL);
  return noticeUrl ? { open: true, noticeUrl } : { open: false, why: "no-notice" };
}

/** Technical limits, to keep the inbox and the database from being filled by one sender or one wave. They are not a legal period of anything. */
export const INQUIRIES_PER_SENDER_PER_HOUR = 5;
export const INQUIRIES_PER_SITE_PER_HOUR = 60;
/** Messages waiting for the professional; past this the form stops receiving until some are handled. */
export const INQUIRIES_WAITING_MAX = 500;
/** What the form sends is a few lines: a body larger than this is not from the form. */
export const INQUIRY_BODY_MAX_BYTES = 8192;
export const INQUIRY_NAME_MAX = 160;
export const INQUIRY_CONTACT_MAX = 254;
export const INQUIRY_MESSAGE_MAX = 1000;

/** The names of the fields of the form: in Portuguese, as the visitor's browser sends them. `empresa_extra` is the bait a person never sees. */
export const FIELD = { name: "nome", contact: "contato", message: "mensagem", consent: "aceite", page: "pagina", bait: "empresa_extra" } as const;

export type InquiryField = "name" | "contact" | "message" | "consent";
export const INQUIRY_FIELD_PROBLEM: Record<InquiryField, string> = {
  name: "Escreva o seu nome (de 2 a 160 letras).",
  contact: "Escreva um e-mail ou um telefone (com DDD) para a resposta chegar até você.",
  message: "A mensagem passou de 1000 letras ou tem caracteres que não podem ser enviados.",
  consent: "Marque que leu o aviso de privacidade para enviar.",
};

export interface InquiryValue {
  name: string;
  email: string | null;
  phone: string | null;
  message: string | null;
  /** The address of the page the form was on ("" for the home page). */
  page: string;
}
export type ParsedInquiry = { kind: "ok"; value: InquiryValue } | { kind: "bot" } | { kind: "invalid"; field: InquiryField };

/** Controls and invisible formatting characters would make two different texts look the same (new lines are fine in a message). */
export const cleanText = (raw: string) => raw.replace(/\r\n/g, "\n").trim();
export const hasHiddenText = (text: string, lines: boolean) => /[\p{Cc}\p{Cf}]/u.test(lines ? text.replace(/\n/g, "") : text);
const clean = cleanText;
const hasHidden = hasHiddenText;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A name as the inbox keeps it (2 to 160 letters, nothing hidden), or null. */
export function readName(raw: string): string | null {
  const name = clean(raw);
  return name.length < 2 || name.length > INQUIRY_NAME_MAX || hasHidden(name, false) ? null : name;
}

/** A way to reach the person as the inbox keeps it: an e-mail, or a phone number with its area code. Null when it is neither. */
export function readContact(raw: string): { email: string | null; phone: string | null } | null {
  const contact = clean(raw);
  if (contact.length < 3 || contact.length > INQUIRY_CONTACT_MAX || hasHidden(contact, false)) return null;
  if (contact.includes("@")) return EMAIL.test(contact) ? { email: contact, phone: null } : null;
  if (contact.length > 30 || !/^[\d\s()+.-]+$/.test(contact) || phoneKey(contact) === null) return null;
  return { email: null, phone: contact };
}

const text = (form: Pick<FormData, "get">, name: string): string | null => {
  const value = form.get(name);
  return typeof value === "string" ? value : null;
};

/**
 * What the form sent, as a value or the first thing wrong with it. A filled bait field is a program: it is told "bot" and the route answers as if
 * it worked, so the program learns nothing. The box that says the notice was read must be ticked.
 */
export function parseInquiry(form: Pick<FormData, "get">): ParsedInquiry {
  if ((text(form, FIELD.bait) ?? "") !== "") return { kind: "bot" };
  const name = readName(text(form, FIELD.name) ?? "");
  if (name === null) return { kind: "invalid", field: "name" };
  const contact = readContact(text(form, FIELD.contact) ?? "");
  if (contact === null) return { kind: "invalid", field: "contact" };
  const { email, phone } = contact;
  const rawMessage = clean(text(form, FIELD.message) ?? "");
  if (rawMessage.length > INQUIRY_MESSAGE_MAX || hasHidden(rawMessage, true)) return { kind: "invalid", field: "message" };
  if (text(form, FIELD.consent) !== "on") return { kind: "invalid", field: "consent" };
  const page = pageSlug.safeParse(text(form, FIELD.page) ?? "");
  return { kind: "ok", value: { name, email, phone, message: rawMessage === "" ? null : rawMessage, page: page.success ? page.data : "" } };
}

/** The keys a lead is searched by, so the inbox can say that a person is already in the list. */
export const contactKeys = (value: Pick<InquiryValue, "email" | "phone">) => ({
  emailKey: value.email ? emailKey(value.email) : null,
  phoneKey: value.phone ? phoneKey(value.phone) : null,
});

/**
 * A keyed hash of the sender's address: enough to count how often one sender writes, not to know who it was. 32 hex characters; the secret is the
 * environment's (the same one that signs the sessions), so the hash means nothing outside this deployment.
 */
export async function senderKey(secret: string, address: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`site-inquiry:${address}`));
  return [...new Uint8Array(signed).slice(0, 16)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Where the answers of the form go, from the page that has it (see image-urls.ts for the same two levels). */
export const INQUIRY_SEND_PATH = "m/contato";
export const INQUIRY_THANKS_PATH = "m/enviado";

/**
 * The body of the form, read without trusting its size: a form of this kind is a few lines, so a body past `max` is refused before it is all
 * read. Null when it is too large.
 */
export async function readLimitedBody(request: Request, max: number = INQUIRY_BODY_MAX_BYTES): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
