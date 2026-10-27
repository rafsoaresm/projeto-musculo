import { z } from "zod";
import { parseName } from "@/modules/configuracoes/contracts";

/**
 * Commercial side of the tool: the services a professional sells and the people interested in them (leads).
 * A lead is not a student: it holds only what is needed to answer the person (a name, a way to reach them,
 * where they came from and what they asked about). Health information belongs to the authenticated
 * onboarding of a student, never to a lead, and the screens say so.
 */

export const LEAD_STAGES = ["NEW", "CONTACT", "ASSESSMENT", "PROPOSAL", "WON", "LOST"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];
export const LEAD_STAGE_LABEL: Record<LeadStage, string> = {
  NEW: "Novo",
  CONTACT: "Em contato",
  ASSESSMENT: "Avaliação ou conversa",
  PROPOSAL: "Proposta",
  WON: "Contratado",
  LOST: "Perdido",
};

/** SITE is reserved for the public form (a later slice); nobody picks it by hand. */
export const LEAD_SOURCES = ["INSTAGRAM", "WHATSAPP", "INDICACAO", "PRESENCIAL", "SITE", "OUTRO"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];
export const LEAD_SOURCES_BY_HAND = LEAD_SOURCES.filter((source) => source !== "SITE");
export const LEAD_SOURCE_LABEL: Record<LeadSource, string> = {
  INSTAGRAM: "Instagram",
  WHATSAPP: "WhatsApp",
  INDICACAO: "Indicação",
  PRESENCIAL: "Presencial",
  SITE: "Site",
  OUTRO: "Outro",
};

export const LOST_REASONS = ["PRICE", "NO_RESPONSE", "CHOSE_OTHER", "NOT_NOW", "OTHER"] as const;
export type LostReason = (typeof LOST_REASONS)[number];
export const LOST_REASON_LABEL: Record<LostReason, string> = {
  PRICE: "Preço",
  NO_RESPONSE: "Parou de responder",
  CHOSE_OTHER: "Escolheu outro profissional",
  NOT_NOW: "Não é o momento",
  OTHER: "Outro motivo",
};

export const DELIVERIES = ["IN_PERSON", "ONLINE", "HYBRID"] as const;
export type Delivery = (typeof DELIVERIES)[number];
export const DELIVERY_LABEL: Record<Delivery, string> = {
  IN_PERSON: "Presencial",
  ONLINE: "Online",
  HYBRID: "Presencial e online",
};

export const NOTE_MAX = 1000;
export const SERVICE_DESCRIPTION_MAX = 1000;

export const HEALTH_WARNING =
  "Não registre aqui dados de saúde (lesões, doenças, medicamentos). Isso é coletado com a pessoa já como aluno, na ficha.";

/** Controls and invisible formatting characters would make two different texts look the same. */
const plain = (max: number) =>
  z
    .string()
    .transform((value) => value.replace(/\r\n/g, "\n").trim())
    .pipe(
      z
        .string()
        .max(max)
        .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value.replace(/\n/g, ""))),
    );

/** What reaches the person's address book: lower case, no spaces. The same address typed two ways matches. */
export function emailKey(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Digits only, without the country code of Brazil, so "(11) 91234-5678", "11912345678" and "+55 11 91234-5678"
 * are the same number. Returns null when what was typed cannot be a phone number.
 */
export function phoneKey(phone: string): string | null {
  let digits = phone.replace(/\D/g, "");
  if (digits.length >= 12 && digits.startsWith("55")) digits = digits.slice(2);
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

const optionalText = (schema: z.ZodType<string>) =>
  z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), schema.optional());

const leadFields = {
  name: z.string().transform((value, ctx) => {
    try {
      return parseName({ name: value });
    } catch {
      ctx.addIssue({ code: "custom", message: "name" });
      return z.NEVER;
    }
  }),
  email: optionalText(
    z
      .string()
      .trim()
      .max(254)
      .pipe(z.email()),
  ),
  phone: optionalText(
    z
      .string()
      .trim()
      .min(6)
      .max(30)
      .refine((value) => phoneKey(value) !== null),
  ),
  source: z.enum(LEAD_SOURCES_BY_HAND as [LeadSource, ...LeadSource[]]),
  serviceId: optionalText(z.string().min(1).max(64)),
};

export const leadInput = z
  .object({ ...leadFields, note: optionalText(plain(NOTE_MAX)) })
  .strict()
  .refine((lead) => Boolean(lead.email) || Boolean(lead.phone), { message: "contact", path: ["email"] });
export type LeadInput = z.infer<typeof leadInput>;

export const leadEdit = z
  .object(leadFields)
  .strict()
  .refine((lead) => Boolean(lead.email) || Boolean(lead.phone), { message: "contact", path: ["email"] });
export type LeadEdit = z.infer<typeof leadEdit>;

export const noteInput = z.object({ note: plain(NOTE_MAX).pipe(z.string().min(1)) }).strict();

export const stageMove = z
  .object({
    to: z.enum(LEAD_STAGES),
    lostReason: optionalText(z.enum(LOST_REASONS)),
    note: optionalText(plain(NOTE_MAX)),
  })
  .strict()
  .refine((move) => (move.to === "LOST") === Boolean(move.lostReason), { message: "lostReason", path: ["lostReason"] });
export type StageMove = z.infer<typeof stageMove>;

export const serviceInput = z
  .object({
    name: leadFields.name,
    description: optionalText(plain(SERVICE_DESCRIPTION_MAX)),
    delivery: z.enum(DELIVERIES),
  })
  .strict();
export type ServiceInput = z.infer<typeof serviceInput>;
