import { z } from "zod";
import { DELIVERIES, type Delivery } from "@/modules/leads/contracts";
import { ALT_MAX, CAPTION_MAX } from "./images";
import { ACCENTS, DEFAULT_THEME, MODES } from "./site-theme";

/**
 * The page of a professional, as a document of typed blocks. Never HTML, never a script, never a free link:
 * every string is plain text that React escapes, and the only links on the page are made from the contact
 * fields (WhatsApp, e-mail, Instagram) by the functions below, which accept nothing else. A draft may be
 * incomplete (empty fields); what must be complete is checked when publishing (`publishIssues`).
 *
 * `schemaVersion` lets a later change of the blocks read the documents that already exist. Version 1 (the
 * first editor: five kinds of block, no theme) is still read: releases are immutable, so a page published in
 * version 1 keeps being served, upgraded in memory by `parseContent`, and a draft in version 1 opens in the
 * editor as version 2 and is saved as such.
 */
export const SITE_SCHEMA_VERSION = 2;

/** Blocks on the page itself (a "2 columns" counts one). */
export const MAX_BLOCKS = 20;
/** Elements in each column of a "2 columns" block. */
export const MAX_COLUMN_ITEMS = 6;
/** Every block of the document, the ones inside columns included. */
export const MAX_NODES = 60;
export const MAX_CONTENT_BYTES = 60_000;
export const TITLE_MAX = 80;
export const DESCRIPTION_MAX = 200;
export const EYEBROW_MAX = 60;
export const HEADING_MAX = 120;
export const SUBHEADING_MAX = 300;
export const TEXT_MAX = 2000;
export const BUTTON_MAX = 40;
export const FAQ_MAX = 10;
export const QUESTION_MAX = 160;
export const ANSWER_MAX = 800;
export const SERVICES_MAX = 12;
export const STATS_MAX = 6;
export const STAT_VALUE_MAX = 16;
export const STAT_LABEL_MAX = 80;
export const QUOTE_MAX = 600;
export const AUTHOR_MAX = 80;

export const CHANNELS = ["whatsapp", "email", "instagram"] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_LABEL: Record<Channel, string> = { whatsapp: "WhatsApp", email: "E-mail", instagram: "Instagram" };

export const RATIOS = ["equal", "left", "right"] as const;
export type Ratio = (typeof RATIOS)[number];
export const RATIO_LABEL: Record<Ratio, string> = { equal: "50 / 50", left: "60 / 40", right: "40 / 60" };

export const SECTION_TYPES = ["hero", "text", "services", "about", "quote", "stats", "faq", "cta"] as const;
/** What fits inside a column: small elements only, never a section and never another "2 columns". */
export const COLUMN_TYPES = ["heading", "paragraph", "button", "image"] as const;
export const BLOCK_TYPES = [...SECTION_TYPES, "columns", ...COLUMN_TYPES] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];
export type ColumnType = (typeof COLUMN_TYPES)[number];
export const BLOCK_LABEL: Record<BlockType, string> = {
  hero: "Destaque",
  text: "Texto",
  services: "Serviços",
  about: "Sobre mim",
  quote: "Depoimento",
  stats: "Indicadores",
  faq: "Perguntas frequentes",
  cta: "Chamada para contato",
  columns: "2 colunas",
  heading: "Título",
  paragraph: "Parágrafo",
  button: "Botão",
  image: "Imagem",
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

const eyebrow = plain(EYEBROW_MAX);

const hero = z
  .object({
    id,
    type: z.literal("hero"),
    eyebrow,
    heading: plain(HEADING_MAX),
    subheading: plain(SUBHEADING_MAX),
    buttonLabel: plain(BUTTON_MAX),
    buttonChannel: z.enum(CHANNELS).optional(),
  })
  .strict();
const text = z.object({ id, type: z.literal("text"), eyebrow, heading: plain(HEADING_MAX), text: plain(TEXT_MAX) }).strict();
const services = z
  .object({
    id,
    type: z.literal("services"),
    eyebrow,
    heading: plain(HEADING_MAX),
    intro: plain(SUBHEADING_MAX),
    serviceIds: z.array(z.string().min(1).max(64)).max(SERVICES_MAX),
    /** Written when publishing, from the services that are on offer at that moment; absent in a draft. */
    items: z.array(resolvedService).max(SERVICES_MAX).optional(),
  })
  .strict();
const about = z
  .object({
    id,
    type: z.literal("about"),
    eyebrow,
    heading: plain(HEADING_MAX),
    text: plain(TEXT_MAX),
    stat: plain(STAT_VALUE_MAX),
    statLabel: plain(STAT_LABEL_MAX),
  })
  .strict();
const quote = z
  .object({
    id,
    type: z.literal("quote"),
    eyebrow,
    quote: plain(QUOTE_MAX),
    author: plain(AUTHOR_MAX),
    /** The professional says the person authorized this testimony; publishing asks for it. */
    authorized: z.boolean(),
  })
  .strict();
const stats = z
  .object({
    id,
    type: z.literal("stats"),
    eyebrow,
    heading: plain(HEADING_MAX),
    items: z.array(z.object({ value: plain(STAT_VALUE_MAX), label: plain(STAT_LABEL_MAX) }).strict()).max(STATS_MAX),
  })
  .strict();
const faq = z
  .object({
    id,
    type: z.literal("faq"),
    eyebrow,
    heading: plain(HEADING_MAX),
    items: z.array(z.object({ question: plain(QUESTION_MAX), answer: plain(ANSWER_MAX) }).strict()).max(FAQ_MAX),
  })
  .strict();
const cta = z
  .object({
    id,
    type: z.literal("cta"),
    eyebrow,
    heading: plain(HEADING_MAX),
    text: plain(SUBHEADING_MAX),
    buttonLabel: plain(BUTTON_MAX),
    buttonChannel: z.enum(CHANNELS).optional(),
  })
  .strict();

const headingElement = z.object({ id, type: z.literal("heading"), text: plain(HEADING_MAX) }).strict();
const paragraphElement = z.object({ id, type: z.literal("paragraph"), text: plain(TEXT_MAX) }).strict();
const buttonElement = z
  .object({ id, type: z.literal("button"), label: plain(BUTTON_MAX), channel: z.enum(CHANNELS).optional() })
  .strict();
export const IMAGE_SIZES = ["full", "medium", "small"] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];
export const IMAGE_SIZE_LABEL: Record<ImageSize, string> = { full: "Largura toda", medium: "Média", small: "Pequena" };
/** An image of the site's library. `assetId` is "" until one is chosen; the description is for who cannot see it. */
const imageElement = z
  .object({
    id,
    type: z.literal("image"),
    assetId: z.string().max(64),
    alt: plain(ALT_MAX),
    caption: plain(CAPTION_MAX),
    size: z.enum(IMAGE_SIZES),
  })
  .strict();
/** An element that fits in a column (and also stands on the page by itself). */
export const columnItem = z.discriminatedUnion("type", [headingElement, paragraphElement, buttonElement, imageElement]);
export type ColumnItem = z.infer<typeof columnItem>;

const columns = z
  .object({
    id,
    type: z.literal("columns"),
    ratio: z.enum(RATIOS),
    left: z.array(columnItem).max(MAX_COLUMN_ITEMS),
    right: z.array(columnItem).max(MAX_COLUMN_ITEMS),
  })
  .strict();

export const block = z.discriminatedUnion("type", [
  hero,
  text,
  services,
  about,
  quote,
  stats,
  faq,
  cta,
  columns,
  headingElement,
  paragraphElement,
  buttonElement,
  imageElement,
]);
export type Block = z.infer<typeof block>;
export type BlockOf<T extends BlockType> = Extract<Block, { type: T }>;
export type Columns = BlockOf<"columns">;

export const contact = z
  .object({ whatsapp: plain(30), email: plain(254), instagram: plain(31) })
  .strict();
export type Contact = z.infer<typeof contact>;

export const theme = z.object({ accent: z.enum(ACCENTS), mode: z.enum(MODES) }).strict();

/** Every block of the document, the ones inside columns included, in reading order. */
export function allBlocks(blocks: readonly Block[]): Block[] {
  return blocks.flatMap((b): Block[] => (b.type === "columns" ? [b, ...b.left, ...b.right] : [b]));
}

export const siteContent = z
  .object({
    schemaVersion: z.literal(SITE_SCHEMA_VERSION),
    title: plain(TITLE_MAX),
    description: plain(DESCRIPTION_MAX),
    contact,
    theme,
    /** The logo, an image of the site's library; absent or "" for none. */
    logoAssetId: z.string().max(64).optional(),
    blocks: z.array(block).max(MAX_BLOCKS),
  })
  .strict()
  .refine((content) => new Set(allBlocks(content.blocks).map((b) => b.id)).size === allBlocks(content.blocks).length, { message: "block ids repeat" })
  .refine((content) => allBlocks(content.blocks).length <= MAX_NODES, { message: "too many blocks" })
  .refine((content) => JSON.stringify(content).length <= MAX_CONTENT_BYTES, { message: "too large" });
export type SiteContent = z.infer<typeof siteContent>;

// ---- version 1, still read ----

const v1Hero = hero.omit({ eyebrow: true });
const v1Text = text.omit({ eyebrow: true });
const v1Services = services.omit({ eyebrow: true });
const v1Faq = faq.omit({ eyebrow: true });
const v1Cta = cta.omit({ eyebrow: true });
const contentV1 = z
  .object({
    schemaVersion: z.literal(1),
    title: plain(TITLE_MAX),
    description: plain(DESCRIPTION_MAX),
    contact,
    blocks: z.array(z.discriminatedUnion("type", [v1Hero, v1Text, v1Services, v1Faq, v1Cta])).max(MAX_BLOCKS),
  })
  .strict()
  .refine((content) => new Set(content.blocks.map((b) => b.id)).size === content.blocks.length, { message: "block ids repeat" })
  .refine((content) => JSON.stringify(content).length <= MAX_CONTENT_BYTES, { message: "too large" });

function upgradeV1(old: z.infer<typeof contentV1>): SiteContent {
  return siteContent.parse({
    schemaVersion: SITE_SCHEMA_VERSION,
    title: old.title,
    description: old.description,
    contact: old.contact,
    theme: DEFAULT_THEME,
    blocks: old.blocks.map((b) => ({ ...b, eyebrow: "" })),
  });
}

const versionOf = (raw: unknown) =>
  typeof raw === "object" && raw !== null && "schemaVersion" in raw ? (raw as { schemaVersion: unknown }).schemaVersion : undefined;

/** A stored or received document of any version we know, as version 2. Throws a ZodError when it is not valid. */
export function parseContent(raw: unknown): SiteContent {
  return versionOf(raw) === 1 ? upgradeV1(contentV1.parse(raw)) : siteContent.parse(raw);
}
export function safeParseContent(raw: unknown): { success: true; data: SiteContent } | { success: false } {
  try {
    return { success: true, data: parseContent(raw) };
  } catch {
    return { success: false };
  }
}

export const newBlockId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 10);

/** An empty block of a type, with the fields it has. Nothing is invented: the texts are for the person to write. */
export function emptyBlock(type: BlockType, blockId = newBlockId()): Block {
  switch (type) {
    case "hero":
      return { id: blockId, type, eyebrow: "", heading: "", subheading: "", buttonLabel: "", buttonChannel: undefined };
    case "text":
      return { id: blockId, type, eyebrow: "", heading: "", text: "" };
    case "services":
      return { id: blockId, type, eyebrow: "", heading: "Serviços", intro: "", serviceIds: [] };
    case "about":
      return { id: blockId, type, eyebrow: "", heading: "Sobre mim", text: "", stat: "", statLabel: "" };
    case "quote":
      return { id: blockId, type, eyebrow: "Depoimento", quote: "", author: "", authorized: false };
    case "stats":
      return {
        id: blockId,
        type,
        eyebrow: "",
        heading: "",
        items: [
          { value: "", label: "" },
          { value: "", label: "" },
          { value: "", label: "" },
        ],
      };
    case "faq":
      return { id: blockId, type, eyebrow: "", heading: "Perguntas frequentes", items: [{ question: "", answer: "" }] };
    case "cta":
      return { id: blockId, type, eyebrow: "", heading: "", text: "", buttonLabel: "", buttonChannel: undefined };
    case "columns":
      return { id: blockId, type, ratio: "equal", left: [], right: [] };
    case "heading":
      return { id: blockId, type, text: "" };
    case "paragraph":
      return { id: blockId, type, text: "" };
    case "button":
      return { id: blockId, type, label: "", channel: undefined };
    case "image":
      return { id: blockId, type, assetId: "", alt: "", caption: "", size: "full" };
  }
}

/** The images of the library that the document uses: the ones in image blocks, in columns too, and the logo. */
export function referencedAssetIds(content: SiteContent): string[] {
  const ids = allBlocks(content.blocks).flatMap((b) => (b.type === "image" && b.assetId ? [b.assetId] : []));
  if (content.logoAssetId) ids.push(content.logoAssetId);
  return [...new Set(ids)];
}

/** What a new site starts with: the name as the title, a highlight and a call to get in touch. No invented claims. */
export function starterContent(title: string): SiteContent {
  return {
    schemaVersion: SITE_SCHEMA_VERSION,
    title,
    description: "",
    contact: { whatsapp: "", email: "", instagram: "" },
    theme: DEFAULT_THEME,
    blocks: [
      { ...(emptyBlock("hero") as BlockOf<"hero">), heading: title },
      { ...(emptyBlock("cta") as BlockOf<"cta">), heading: "Fale comigo", buttonLabel: "Chamar no WhatsApp", buttonChannel: "whatsapp" },
    ],
  };
}

// ---- the services chosen in a block, written as they are on offer ----

export interface LiveService {
  name: string;
  description: string | null;
  delivery: Delivery;
}

/** The services chosen in each block, written as they are on offer now. A draft does not carry them. */
export function resolveServices(content: SiteContent, live: ReadonlyMap<string, LiveService>): SiteContent {
  return {
    ...content,
    blocks: content.blocks.map((b) =>
      b.type === "services"
        ? {
            ...b,
            items: b.serviceIds.flatMap((serviceId) => {
              const service = live.get(serviceId);
              return service
                ? [{ name: service.name, ...(service.description ? { description: service.description } : {}), delivery: service.delivery }]
                : [];
            }),
          }
        : b,
    ),
  };
}

/** What the draft keeps: a release brought back as a draft loses the resolved services, which are made again. */
export function withoutResolvedServices(content: SiteContent): SiteContent {
  return {
    ...content,
    blocks: content.blocks.map((b) => {
      if (b.type !== "services") return b;
      const { items: _items, ...rest } = b;
      void _items;
      return rest;
    }),
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
  /** Position (from 1) of the block on the page, for the message; null for what concerns the whole page. */
  block: number | null;
  /** The block the issue is about (the one inside a column, when it is that), so the editor can show it. */
  blockId: string | null;
  message: string;
}

/**
 * The problems that stop a publication. `liveServiceIds` are the services on offer right now; `assetIds` the images
 * of the site's library (null when the caller has not looked: then only what the document itself says is checked).
 */
export function publishIssues(content: SiteContent, liveServiceIds: ReadonlySet<string>, assetIds: ReadonlySet<string> | null = null): PublishIssue[] {
  const issues: PublishIssue[] = [];
  const add = (block: number | null, blockId: string | null, message: string) => issues.push({ block, blockId, message });
  if (!content.title) add(null, null, "Dê um título ao site.");
  if (content.blocks.length === 0) add(null, null, "Acrescente pelo menos um bloco.");

  /** A button is a pair: a text and a contact. Both empty is "no button"; one of them alone is a mistake. */
  const button = (at: number, blockId: string, label: string, buttonLabel: string, channel: Channel | undefined) => {
    if (!buttonLabel && !channel) return;
    if (!buttonLabel) add(at, blockId, `${label}: escreva o texto do botão.`);
    else if (!channel) add(at, blockId, `${label}: escolha para onde o botão leva.`);
    else if (!channelUrl(content.contact, channel))
      add(at, blockId, `${label}: o botão leva ao ${CHANNEL_LABEL[channel]}, mas esse contato não está preenchido ou é inválido.`);
  };
  const element = (at: number, label: string, item: ColumnItem) => {
    if (item.type === "heading" && !item.text) add(at, item.id, `${label}: escreva o título.`);
    else if (item.type === "paragraph" && !item.text) add(at, item.id, `${label}: escreva o texto.`);
    else if (item.type === "button") {
      if (!item.label && !item.channel) add(at, item.id, `${label}: o botão precisa de texto e de um contato.`);
      else button(at, item.id, label, item.label, item.channel);
    } else if (item.type === "image") {
      if (!item.assetId) add(at, item.id, `${label}: escolha a imagem.`);
      else if (assetIds && !assetIds.has(item.assetId)) add(at, item.id, `${label}: a imagem escolhida não está mais na biblioteca. Escolha outra.`);
      if (item.assetId && !item.alt) add(at, item.id, `${label}: descreva a imagem para quem não consegue vê-la (texto alternativo).`);
    }
  };

  content.blocks.forEach((b, index) => {
    const at = index + 1;
    const label = `Bloco ${at} (${BLOCK_LABEL[b.type]})`;
    switch (b.type) {
      case "hero":
        if (!b.heading) add(at, b.id, `${label}: escreva o título do destaque.`);
        button(at, b.id, label, b.buttonLabel, b.buttonChannel);
        break;
      case "text":
        if (!b.text) add(at, b.id, `${label}: escreva o texto.`);
        break;
      case "services":
        if (b.serviceIds.length === 0) add(at, b.id, `${label}: escolha pelo menos um serviço.`);
        for (const serviceId of b.serviceIds)
          if (!liveServiceIds.has(serviceId)) add(at, b.id, `${label}: um dos serviços escolhidos saiu da oferta. Tire-o do bloco.`);
        break;
      case "about":
        if (!b.text) add(at, b.id, `${label}: escreva o texto.`);
        if (b.stat && !b.statLabel) add(at, b.id, `${label}: o destaque numérico precisa de uma legenda.`);
        break;
      case "quote":
        if (!b.quote) add(at, b.id, `${label}: escreva o depoimento.`);
        if (!b.author) add(at, b.id, `${label}: diga de quem é o depoimento.`);
        if (!b.authorized) add(at, b.id, `${label}: confirme que a pessoa autorizou o uso do depoimento.`);
        break;
      case "stats": {
        const filled = b.items.filter((item) => item.value && item.label);
        if (filled.length === 0) add(at, b.id, `${label}: escreva pelo menos um indicador com o número e a legenda.`);
        if (filled.length !== b.items.length) add(at, b.id, `${label}: todo indicador precisa de número e legenda. Complete ou remova.`);
        break;
      }
      case "faq": {
        const filled = b.items.filter((item) => item.question && item.answer);
        if (filled.length === 0) add(at, b.id, `${label}: escreva pelo menos uma pergunta com a resposta.`);
        if (filled.length !== b.items.length) add(at, b.id, `${label}: toda pergunta precisa de resposta, e vice-versa.`);
        break;
      }
      case "cta":
        if (!b.heading) add(at, b.id, `${label}: escreva o título da chamada.`);
        if (!b.buttonLabel && !b.buttonChannel) add(at, b.id, `${label}: a chamada precisa de um botão.`);
        button(at, b.id, label, b.buttonLabel, b.buttonChannel);
        break;
      case "columns":
        if (b.left.length + b.right.length === 0) add(at, b.id, `${label}: as colunas estão vazias.`);
        b.left.forEach((item, position) => element(at, `${label}, coluna da esquerda, elemento ${position + 1} (${BLOCK_LABEL[item.type]})`, item));
        b.right.forEach((item, position) => element(at, `${label}, coluna da direita, elemento ${position + 1} (${BLOCK_LABEL[item.type]})`, item));
        break;
      case "heading":
      case "paragraph":
      case "button":
      case "image":
        element(at, label, b);
        break;
    }
  });
  if (content.logoAssetId && assetIds && !assetIds.has(content.logoAssetId)) add(null, null, "O logotipo escolhido não está mais na biblioteca. Escolha outro ou tire o logotipo.");
  return issues;
}
