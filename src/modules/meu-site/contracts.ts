import { z } from "zod";
import { DELIVERIES } from "@/modules/leads/contracts";

/**
 * The page of a professional, as a document of typed blocks. Never HTML, never a script, never a free link:
 * every string is plain text that React escapes, and the only links on the page are made from the contact
 * fields (WhatsApp, e-mail, Instagram) by the functions below, which accept nothing else. A draft may be
 * incomplete (empty fields); what must be complete is checked when publishing (`publishIssues`).
 * `schemaVersion` lets a later change of the blocks read the documents that already exist.
 */
export const SITE_SCHEMA_VERSION = 1;

export const MAX_BLOCKS = 20;
export const MAX_CONTENT_BYTES = 60_000;
export const TITLE_MAX = 80;
export const DESCRIPTION_MAX = 200;
export const HEADING_MAX = 120;
export const SUBHEADING_MAX = 300;
export const TEXT_MAX = 2000;
export const BUTTON_MAX = 40;
export const FAQ_MAX = 10;
export const QUESTION_MAX = 160;
export const ANSWER_MAX = 800;
export const SERVICES_MAX = 12;

export const CHANNELS = ["whatsapp", "email", "instagram"] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_LABEL: Record<Channel, string> = { whatsapp: "WhatsApp", email: "E-mail", instagram: "Instagram" };

export const BLOCK_TYPES = ["hero", "text", "services", "faq", "cta"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];
export const BLOCK_LABEL: Record<BlockType, string> = {
  hero: "Destaque",
  text: "Texto",
  services: "Serviços",
  faq: "Perguntas frequentes",
  cta: "Chamada para contato",
};

export const PUBLIC_WARNING =
  "Esta página é pública, para qualquer pessoa. Não coloque aqui dados, nomes ou fotos de alunos, nem promessas de resultado de saúde.";

/** Plain text of at most `max` characters; line breaks stay, control and invisible characters do not. */
const plain = (max: number) =>
  z
    .string()
    .transform((value) => value.replace(/\r\n/g, "\n").trim())
    .pipe(z.string().max(max).refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value.replace(/\n/g, ""))));

const id = z.string().regex(/^[a-z0-9-]{1,40}$/);

const deliveryEnum = z.enum(DELIVERIES);
export const resolvedService = z
  .object({ name: plain(160), description: plain(1000).optional(), delivery: deliveryEnum })
  .strict();
export type ResolvedService = z.infer<typeof resolvedService>;

const hero = z
  .object({
    id,
    type: z.literal("hero"),
    heading: plain(HEADING_MAX),
    subheading: plain(SUBHEADING_MAX),
    buttonLabel: plain(BUTTON_MAX),
    buttonChannel: z.enum(CHANNELS).optional(),
  })
  .strict();
const text = z.object({ id, type: z.literal("text"), heading: plain(HEADING_MAX), text: plain(TEXT_MAX) }).strict();
const services = z
  .object({
    id,
    type: z.literal("services"),
    heading: plain(HEADING_MAX),
    intro: plain(SUBHEADING_MAX),
    serviceIds: z.array(z.string().min(1).max(64)).max(SERVICES_MAX),
    /** Written when publishing, from the services that are on offer at that moment; absent in a draft. */
    items: z.array(resolvedService).max(SERVICES_MAX).optional(),
  })
  .strict();
const faq = z
  .object({
    id,
    type: z.literal("faq"),
    heading: plain(HEADING_MAX),
    items: z.array(z.object({ question: plain(QUESTION_MAX), answer: plain(ANSWER_MAX) }).strict()).max(FAQ_MAX),
  })
  .strict();
const cta = z
  .object({
    id,
    type: z.literal("cta"),
    heading: plain(HEADING_MAX),
    text: plain(SUBHEADING_MAX),
    buttonLabel: plain(BUTTON_MAX),
    buttonChannel: z.enum(CHANNELS).optional(),
  })
  .strict();

export const block = z.discriminatedUnion("type", [hero, text, services, faq, cta]);
export type Block = z.infer<typeof block>;

export const contact = z
  .object({ whatsapp: plain(30), email: plain(254), instagram: plain(31) })
  .strict();
export type Contact = z.infer<typeof contact>;

export const siteContent = z
  .object({
    schemaVersion: z.literal(SITE_SCHEMA_VERSION),
    title: plain(TITLE_MAX),
    description: plain(DESCRIPTION_MAX),
    contact,
    blocks: z.array(block).max(MAX_BLOCKS),
  })
  .strict()
  .refine((content) => new Set(content.blocks.map((b) => b.id)).size === content.blocks.length, { message: "block ids repeat" })
  .refine((content) => JSON.stringify(content).length <= MAX_CONTENT_BYTES, { message: "too large" });
export type SiteContent = z.infer<typeof siteContent>;

export const newBlockId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 10);

/** An empty block of a type, with the fields it has. */
export function emptyBlock(type: BlockType, blockId = newBlockId()): Block {
  switch (type) {
    case "hero":
      return { id: blockId, type, heading: "", subheading: "", buttonLabel: "", buttonChannel: undefined };
    case "text":
      return { id: blockId, type, heading: "", text: "" };
    case "services":
      return { id: blockId, type, heading: "Serviços", intro: "", serviceIds: [] };
    case "faq":
      return { id: blockId, type, heading: "Perguntas frequentes", items: [{ question: "", answer: "" }] };
    case "cta":
      return { id: blockId, type, heading: "", text: "", buttonLabel: "", buttonChannel: undefined };
  }
}

/** What a new site starts with: the name as the title, a highlight and a call to get in touch. No invented claims. */
export function starterContent(title: string): SiteContent {
  return {
    schemaVersion: SITE_SCHEMA_VERSION,
    title,
    description: "",
    contact: { whatsapp: "", email: "", instagram: "" },
    blocks: [
      { ...(emptyBlock("hero") as Extract<Block, { type: "hero" }>), heading: title },
      { ...(emptyBlock("cta") as Extract<Block, { type: "cta" }>), heading: "Fale comigo", buttonLabel: "Chamar no WhatsApp", buttonChannel: "whatsapp" },
    ],
  };
}

// ---- contact links: the only links the page has ----

const digitsOf = (value: string) => value.replace(/\D/g, "");

/** WhatsApp wa.me link. A number with 10 or 11 digits is taken as Brazilian (DDD included) and gets the 55. */
export function whatsappUrl(raw: string): string | null {
  let digits = digitsOf(raw);
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  if (digits.length < 12 || digits.length > 15) return null;
  return `https://wa.me/${digits}`;
}
export function emailUrl(raw: string): string | null {
  const value = raw.trim();
  return z.email().safeParse(value).success && value.length <= 254 ? `mailto:${value}` : null;
}
export function instagramUrl(raw: string): string | null {
  const handle = raw.trim().replace(/^@/, "");
  return /^[A-Za-z0-9._]{1,30}$/.test(handle) ? `https://www.instagram.com/${handle}/` : null;
}
export function channelUrl(contacts: Contact, channel: Channel | undefined): string | null {
  if (channel === "whatsapp") return whatsappUrl(contacts.whatsapp);
  if (channel === "email") return emailUrl(contacts.email);
  if (channel === "instagram") return instagramUrl(contacts.instagram);
  return null;
}

// ---- the address of the page ----

export const SLUG_MIN = 3;
export const SLUG_MAX = 40;
/** Names that would read as parts of the tool. The page lives under /s/, but the address is not worth a doubt. */
export const RESERVED_SLUGS = [
  "api", "app", "admin", "gestor", "profissional", "aluno", "alunos", "convite", "aceite", "acesso", "entrar", "cadastro",
  "projeto", "demonstracao", "esqueci-a-senha", "redefinir-senha", "organizacao", "login", "logout", "www", "site", "sites",
  "painel", "portal", "area-do-aluno", "suporte", "ajuda", "contato", "termos", "privacidade", "trainer", "trainer-prescription",
] as const;

export const slugSchema = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(
    z
      .string()
      .min(SLUG_MIN)
      .max(SLUG_MAX)
      .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$/)
      .refine((value) => !value.includes("--"))
      .refine((value) => !(RESERVED_SLUGS as readonly string[]).includes(value)),
  );

/** "Studio Força & Saúde" → "studio-forca-saude". Falls back to "meu-site" when nothing usable is left. */
export function slugFromName(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
  return slugSchema.safeParse(base).success ? base : "meu-site";
}

export const titleSchema = plain(TITLE_MAX).pipe(z.string().min(2));

// ---- what must be complete to publish ----

export interface PublishIssue {
  block: number | null;
  message: string;
}

/** The problems that stop a publication. `liveServiceIds` are the services on offer right now. */
export function publishIssues(content: SiteContent, liveServiceIds: ReadonlySet<string>): PublishIssue[] {
  const issues: PublishIssue[] = [];
  const add = (block: number | null, message: string) => issues.push({ block, message });
  if (!content.title) add(null, "Dê um título ao site.");
  if (content.blocks.length === 0) add(null, "Acrescente pelo menos um bloco.");
  content.blocks.forEach((b, index) => {
    const at = index + 1;
    const label = `Bloco ${at} (${BLOCK_LABEL[b.type]})`;
    const button = (channel: Channel | undefined, buttonLabel: string) => {
      if (!buttonLabel && !channel) return;
      if (!buttonLabel) add(at, `${label}: escreva o texto do botão.`);
      else if (!channel) add(at, `${label}: escolha para onde o botão leva.`);
      else if (!channelUrl(content.contact, channel))
        add(at, `${label}: o botão leva ao ${CHANNEL_LABEL[channel]}, mas esse contato não está preenchido ou é inválido.`);
    };
    if (b.type === "hero") {
      if (!b.heading) add(at, `${label}: escreva o título do destaque.`);
      button(b.buttonChannel, b.buttonLabel);
    } else if (b.type === "text") {
      if (!b.text) add(at, `${label}: escreva o texto.`);
    } else if (b.type === "services") {
      if (b.serviceIds.length === 0) add(at, `${label}: escolha pelo menos um serviço.`);
      for (const serviceId of b.serviceIds)
        if (!liveServiceIds.has(serviceId)) add(at, `${label}: um dos serviços escolhidos saiu da oferta. Tire-o do bloco.`);
    } else if (b.type === "faq") {
      const filled = b.items.filter((item) => item.question && item.answer);
      if (filled.length === 0) add(at, `${label}: escreva pelo menos uma pergunta com a resposta.`);
      if (filled.length !== b.items.length) add(at, `${label}: toda pergunta precisa de resposta, e vice-versa.`);
    } else if (b.type === "cta") {
      if (!b.heading) add(at, `${label}: escreva o título da chamada.`);
      if (!b.buttonLabel && !b.buttonChannel) add(at, `${label}: a chamada precisa de um botão.`);
      button(b.buttonChannel, b.buttonLabel);
    }
  });
  return issues;
}
