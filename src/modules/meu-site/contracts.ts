import { z } from "zod";
import { DELIVERIES, type Delivery } from "@/modules/leads/contracts";
import { ALT_MAX, CAPTION_MAX } from "./images";
import { ACCENTS, DEFAULT_THEME, MODES, WIDTHS } from "./site-theme";
import { nodeAssetIds } from "./screens";
import { styleSchema, type Style } from "./style";

/**
 * The page of a professional, as a document: a tree of typed nodes. A node is a container (which holds other nodes),
 * an element (heading, paragraph, button, link, image) or a ready-made section (hero, services, about...). Each one may
 * carry a `style`, made of typed values (see style.ts): there is never HTML, a script, a free class or a free link.
 * Every string is plain text that React escapes, and the only links are made from the contact fields (WhatsApp,
 * e-mail, Instagram) by the functions below, or point at another node of the same page. A draft may be incomplete
 * (empty fields); what must be complete is checked when publishing (`publishIssues`).
 *
 * `schemaVersion` lets a later change of the blocks read the documents that already exist. Versions 1 (five kinds of
 * block, no theme) and 2 (sections, "2 columns" with elements inside, a theme) are still read: releases are immutable,
 * so a page published in an older version keeps being served, upgraded in memory by `parseContent`, and a draft in an
 * older version opens in the editor as version 3 and is saved as such.
 */
export const SITE_SCHEMA_VERSION = 3;

/** Nodes on the page itself. */
export const MAX_BLOCKS = 40;
/** Nodes inside one container. */
export const MAX_CHILDREN = 40;
/** Containers inside containers. */
export const MAX_DEPTH = 8;
/** Every node of the document, the ones inside containers included. */
export const MAX_NODES = 200;
export const MAX_CONTENT_BYTES = 150_000;
export const TITLE_MAX = 80;
export const NAME_MAX = 40;
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

/** The ratio of the columns of a "2 columns" block of version 2 (read only, to upgrade). */
const RATIOS = ["equal", "left", "right"] as const;

export const BOX_TAGS = ["div", "section", "header", "footer", "nav", "article", "aside"] as const;
export type BoxTag = (typeof BOX_TAGS)[number];
export const BOX_TAG_LABEL: Record<BoxTag, string> = {
  div: "Genérico (div)",
  section: "Seção",
  header: "Cabeçalho",
  footer: "Rodapé",
  nav: "Navegação",
  article: "Artigo",
  aside: "Lateral",
};
/** `h1` is the page's own (the first highlight, or the name of the site), so a heading of the document is h2 to h6. */
export const HEADING_LEVELS = [2, 3, 4, 5, 6] as const;

export const SECTION_TYPES = ["hero", "text", "services", "about", "quote", "stats", "faq", "cta"] as const;
/** What holds nothing else and stands by itself. */
export const ELEMENT_TYPES = ["heading", "paragraph", "button", "link", "image"] as const;
export const BLOCK_TYPES = [...SECTION_TYPES, "box", ...ELEMENT_TYPES] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];
export const BLOCK_LABEL: Record<BlockType, string> = {
  hero: "Destaque",
  text: "Texto",
  services: "Serviços",
  about: "Sobre mim",
  quote: "Depoimento",
  stats: "Indicadores",
  faq: "Perguntas frequentes",
  cta: "Chamada para contato",
  box: "Contêiner",
  heading: "Título",
  paragraph: "Parágrafo",
  button: "Botão",
  link: "Link",
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
/**
 * What every node has: its identifier, an optional name for the layers, and its style: the computer's in `style`, and
 * only what is different on the tablet and on the phone in `styleTablet` and `styleMobile` (see screens.ts).
 */
const base = { id, name: plain(NAME_MAX).optional(), style: styleSchema.optional(), styleTablet: styleSchema.optional(), styleMobile: styleSchema.optional() };

const deliveryEnum = z.enum(DELIVERIES);
export const resolvedService = z
  .object({ name: plain(160), description: plain(1000).optional(), delivery: deliveryEnum })
  .strict();
export type ResolvedService = z.infer<typeof resolvedService>;

const eyebrow = plain(EYEBROW_MAX);

// What each node holds, apart from what every node has. Version 2 reuses these shapes.
const heroShape = {
  type: z.literal("hero"),
  eyebrow,
  heading: plain(HEADING_MAX),
  subheading: plain(SUBHEADING_MAX),
  buttonLabel: plain(BUTTON_MAX),
  buttonChannel: z.enum(CHANNELS).optional(),
};
const textShape = { type: z.literal("text"), eyebrow, heading: plain(HEADING_MAX), text: plain(TEXT_MAX) };
const servicesShape = {
  type: z.literal("services"),
  eyebrow,
  heading: plain(HEADING_MAX),
  intro: plain(SUBHEADING_MAX),
  serviceIds: z.array(z.string().min(1).max(64)).max(SERVICES_MAX),
  /** Written when publishing, from the services that are on offer at that moment; absent in a draft. */
  items: z.array(resolvedService).max(SERVICES_MAX).optional(),
};
const aboutShape = {
  type: z.literal("about"),
  eyebrow,
  heading: plain(HEADING_MAX),
  text: plain(TEXT_MAX),
  stat: plain(STAT_VALUE_MAX),
  statLabel: plain(STAT_LABEL_MAX),
};
const quoteShape = {
  type: z.literal("quote"),
  eyebrow,
  quote: plain(QUOTE_MAX),
  author: plain(AUTHOR_MAX),
  /** The professional says the person authorized this testimony; publishing asks for it. */
  authorized: z.boolean(),
};
const statsShape = {
  type: z.literal("stats"),
  eyebrow,
  heading: plain(HEADING_MAX),
  items: z.array(z.object({ value: plain(STAT_VALUE_MAX), label: plain(STAT_LABEL_MAX) }).strict()).max(STATS_MAX),
};
const faqShape = {
  type: z.literal("faq"),
  eyebrow,
  heading: plain(HEADING_MAX),
  items: z.array(z.object({ question: plain(QUESTION_MAX), answer: plain(ANSWER_MAX) }).strict()).max(FAQ_MAX),
};
const ctaShape = {
  type: z.literal("cta"),
  eyebrow,
  heading: plain(HEADING_MAX),
  text: plain(SUBHEADING_MAX),
  buttonLabel: plain(BUTTON_MAX),
  buttonChannel: z.enum(CHANNELS).optional(),
};
const headingShape = { type: z.literal("heading"), text: plain(HEADING_MAX) };
const paragraphShape = { type: z.literal("paragraph"), text: plain(TEXT_MAX) };
const buttonShape = { type: z.literal("button"), label: plain(BUTTON_MAX), channel: z.enum(CHANNELS).optional() };
export const IMAGE_SIZES = ["full", "medium", "small"] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];
export const IMAGE_SIZE_LABEL: Record<ImageSize, string> = { full: "Largura toda", medium: "Média", small: "Pequena" };
/** An image of the site's library. `assetId` is "" until one is chosen; the description is for who cannot see it. */
const imageShape = {
  type: z.literal("image"),
  assetId: z.string().max(64),
  alt: plain(ALT_MAX),
  caption: plain(CAPTION_MAX),
  size: z.enum(IMAGE_SIZES),
};

const hero = z.object({ ...base, ...heroShape }).strict();
const text = z.object({ ...base, ...textShape }).strict();
const services = z.object({ ...base, ...servicesShape }).strict();
const about = z.object({ ...base, ...aboutShape }).strict();
const quote = z.object({ ...base, ...quoteShape }).strict();
const stats = z.object({ ...base, ...statsShape }).strict();
const faq = z.object({ ...base, ...faqShape }).strict();
const cta = z.object({ ...base, ...ctaShape }).strict();
const heading = z
  .object({ ...base, ...headingShape, level: z.number().int().min(2).max(6) })
  .strict();
const paragraph = z.object({ ...base, ...paragraphShape }).strict();
/** The point a button or a link goes to: a contact, or another node of the same page (not both). */
const anchor = id.optional();
const button = z
  .object({ ...base, ...buttonShape, anchor })
  .strict()
  .refine((node) => !(node.channel && node.anchor), { message: "a button goes to a contact or to a block, not both" });
const link = z
  .object({ ...base, type: z.literal("link"), label: plain(BUTTON_MAX), channel: z.enum(CHANNELS).optional(), anchor })
  .strict()
  .refine((node) => !(node.channel && node.anchor), { message: "a link goes to a contact or to a block, not both" });
const image = z.object({ ...base, ...imageShape }).strict();

export type HeroNode = z.infer<typeof hero>;
export type TextNode = z.infer<typeof text>;
export type ServicesNode = z.infer<typeof services>;
export type AboutNode = z.infer<typeof about>;
export type QuoteNode = z.infer<typeof quote>;
export type StatsNode = z.infer<typeof stats>;
export type FaqNode = z.infer<typeof faq>;
export type CtaNode = z.infer<typeof cta>;
export type HeadingNode = z.infer<typeof heading>;
export type ParagraphNode = z.infer<typeof paragraph>;
export type ButtonNode = z.infer<typeof button>;
export type LinkNode = z.infer<typeof link>;
export type ImageNode = z.infer<typeof image>;
/** A container: it holds other nodes and is laid out by its style (a row, a column, a grid, a section). */
export interface BoxNode {
  id: string;
  name?: string;
  style?: Style;
  styleTablet?: Style;
  styleMobile?: Style;
  type: "box";
  tag: BoxTag;
  children: SiteNode[];
}
export type SiteNode = HeroNode | TextNode | ServicesNode | AboutNode | QuoteNode | StatsNode | FaqNode | CtaNode | BoxNode | HeadingNode | ParagraphNode | ButtonNode | LinkNode | ImageNode;
/** The names the rest of the code already used. */
export type Block = SiteNode;
export type BlockOf<T extends BlockType> = Extract<SiteNode, { type: T }>;
export type ElementNode = HeadingNode | ParagraphNode | ButtonNode | LinkNode | ImageNode;

const box: z.ZodType<BoxNode> = z
  .object({ ...base, type: z.literal("box"), tag: z.enum(BOX_TAGS), children: z.array(z.lazy(() => node)).max(MAX_CHILDREN) })
  .strict();
const node: z.ZodType<SiteNode> = z.lazy(() => z.union([box, heading, paragraph, button, link, image, hero, text, services, about, quote, stats, faq, cta]));
export const siteNode = node;

export const contact = z
  .object({ whatsapp: plain(30), email: plain(254), instagram: plain(31) })
  .strict();
export type Contact = z.infer<typeof contact>;

export const theme = z.object({ accent: z.enum(ACCENTS), mode: z.enum(MODES), width: z.enum(WIDTHS) }).strict();

/** Every node of the document, the ones inside containers included, in reading order. */
export function allNodes(blocks: readonly SiteNode[]): SiteNode[] {
  const out: SiteNode[] = [];
  const stack = [...blocks].reverse();
  while (stack.length > 0) {
    const current = stack.pop()!;
    out.push(current);
    if (current.type === "box") for (let at = current.children.length - 1; at >= 0; at--) stack.push(current.children[at]);
  }
  return out;
}
export const allBlocks = allNodes;
export const isBox = (entry: SiteNode): entry is BoxNode => entry.type === "box";

/** Containers inside containers, counting the deepest line: a container on the page alone is 1, none is 0. */
export function boxDepth(blocks: readonly SiteNode[]): number {
  let deepest = 0;
  const stack: Array<[SiteNode, number]> = blocks.map((entry) => [entry, 1]);
  while (stack.length > 0) {
    const [current, depth] = stack.pop()!;
    if (current.type !== "box") continue;
    deepest = Math.max(deepest, depth);
    for (const child of current.children) stack.push([child, depth + 1]);
  }
  return deepest;
}

/**
 * How deep a raw document nests its `children`, counted without recursion, so a hostile document cannot overflow the
 * stack of the checks below before they refuse it. Anything that is not an object or array adds nothing.
 */
function rawDepth(value: unknown, limit: number): number {
  let deepest = 0;
  const stack: Array<[unknown, number]> = [[value, 0]];
  while (stack.length > 0) {
    const [current, depth] = stack.pop()!;
    if (current === null || typeof current !== "object") continue;
    deepest = Math.max(deepest, depth);
    if (deepest > limit) return deepest;
    for (const child of Array.isArray(current) ? current : Object.values(current)) stack.push([child, depth + 1]);
  }
  return deepest;
}
/** Generous: a node has a few levels of its own (style, items) besides the containers. */
const RAW_DEPTH_LIMIT = (MAX_DEPTH + 2) * 3 + 8;

export const siteContent = z
  .object({
    schemaVersion: z.literal(SITE_SCHEMA_VERSION),
    title: plain(TITLE_MAX),
    description: plain(DESCRIPTION_MAX),
    contact,
    theme,
    /** The logo, an image of the site's library; absent or "" for none. */
    logoAssetId: z.string().max(64).optional(),
    blocks: z.array(node).max(MAX_BLOCKS),
  })
  .strict()
  .refine((content) => new Set(allNodes(content.blocks).map((b) => b.id)).size === allNodes(content.blocks).length, { message: "block ids repeat" })
  .refine((content) => allNodes(content.blocks).length <= MAX_NODES, { message: "too many blocks" })
  .refine((content) => boxDepth(content.blocks) <= MAX_DEPTH, { message: "containers nested too deep" })
  .refine((content) => JSON.stringify(content).length <= MAX_CONTENT_BYTES, { message: "too large" });
export type SiteContent = z.infer<typeof siteContent>;

// ---- version 2 (sections, "2 columns", a theme without width), still read ----

const v2Heading = z.object({ id, ...headingShape }).strict();
const v2Paragraph = z.object({ id, ...paragraphShape }).strict();
const v2Button = z.object({ id, ...buttonShape }).strict();
const v2Image = z.object({ id, ...imageShape }).strict();
const v2Item = z.discriminatedUnion("type", [v2Heading, v2Paragraph, v2Button, v2Image]);
const v2Columns = z
  .object({ id, type: z.literal("columns"), ratio: z.enum(RATIOS), left: z.array(v2Item).max(6), right: z.array(v2Item).max(6) })
  .strict();
const v2Block = z.discriminatedUnion("type", [
  z.object({ id, ...heroShape }).strict(),
  z.object({ id, ...textShape }).strict(),
  z.object({ id, ...servicesShape }).strict(),
  z.object({ id, ...aboutShape }).strict(),
  z.object({ id, ...quoteShape }).strict(),
  z.object({ id, ...statsShape }).strict(),
  z.object({ id, ...faqShape }).strict(),
  z.object({ id, ...ctaShape }).strict(),
  v2Columns,
  v2Heading,
  v2Paragraph,
  v2Button,
  v2Image,
]);
type V2Block = z.infer<typeof v2Block>;
type V2Item = z.infer<typeof v2Item>;
const v2AllIds = (blocks: readonly V2Block[]) => blocks.flatMap((b) => (b.type === "columns" ? [b.id, ...b.left.map((i) => i.id), ...b.right.map((i) => i.id)] : [b.id]));
const contentV2 = z
  .object({
    schemaVersion: z.literal(2),
    title: plain(TITLE_MAX),
    description: plain(DESCRIPTION_MAX),
    contact,
    theme: z.object({ accent: z.enum(ACCENTS), mode: z.enum(MODES) }).strict(),
    logoAssetId: z.string().max(64).optional(),
    blocks: z.array(v2Block).max(20),
  })
  .strict()
  .refine((content) => new Set(v2AllIds(content.blocks)).size === v2AllIds(content.blocks).length, { message: "block ids repeat" })
  .refine((content) => JSON.stringify(content).length <= 60_000, { message: "too large" });

/** What a column of version 2 looked like: a stack of its elements, and a share of the row that wraps when it is narrow. */
const COLUMN_SHARE: Record<(typeof RATIOS)[number], readonly [number, number]> = { equal: [1, 1], left: [3, 2], right: [2, 3] };

function upgradeV2Item(item: V2Item): SiteNode {
  return item.type === "heading" ? { ...item, level: 2 } : item;
}
function upgradeV2Block(entry: V2Block): SiteNode {
  if (entry.type === "heading") return { ...entry, level: 2 };
  if (entry.type !== "columns") return entry;
  const shares = COLUMN_SHARE[entry.ratio];
  // A side with nothing in it took no room on the page of version 2, and takes none here.
  const sides = (
    [
      ["l", entry.left, shares[0]],
      ["r", entry.right, shares[1]],
    ] as const
  ).filter(([, items]) => items.length > 0);
  return {
    id: entry.id,
    type: "box",
    tag: "div",
    name: "2 colunas",
    style: { display: "flex", direction: "row", wrap: "wrap", gap: "24px", padding: { top: "24px", bottom: "24px" } },
    children: sides.map(([key, items, grow]): BoxNode => ({
      id: `${entry.id}-${key}`,
      type: "box",
      tag: "div",
      style: { display: "flex", direction: "column", gap: "12px", grow, shrink: 1, basis: "240px", minWidth: "0px" },
      children: items.map(upgradeV2Item),
    })),
  };
}
function upgradeV2(old: z.infer<typeof contentV2>): SiteContent {
  return siteContent.parse({
    ...old,
    schemaVersion: SITE_SCHEMA_VERSION,
    theme: { ...old.theme, width: DEFAULT_THEME.width },
    blocks: old.blocks.map(upgradeV2Block),
  });
}

// ---- version 1 (five kinds of block, no theme), still read ----

const v1Hero = z.object({ id, ...heroShape }).omit({ eyebrow: true }).strict();
const v1Text = z.object({ id, ...textShape }).omit({ eyebrow: true }).strict();
const v1Services = z.object({ id, ...servicesShape }).omit({ eyebrow: true }).strict();
const v1Faq = z.object({ id, ...faqShape }).omit({ eyebrow: true }).strict();
const v1Cta = z.object({ id, ...ctaShape }).omit({ eyebrow: true }).strict();
const contentV1 = z
  .object({
    schemaVersion: z.literal(1),
    title: plain(TITLE_MAX),
    description: plain(DESCRIPTION_MAX),
    contact,
    blocks: z.array(z.discriminatedUnion("type", [v1Hero, v1Text, v1Services, v1Faq, v1Cta])).max(20),
  })
  .strict()
  .refine((content) => new Set(content.blocks.map((b) => b.id)).size === content.blocks.length, { message: "block ids repeat" })
  .refine((content) => JSON.stringify(content).length <= 60_000, { message: "too large" });

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

/** A stored or received document of any version we know, as version 3. Throws a ZodError when it is not valid. */
export function parseContent(raw: unknown): SiteContent {
  if (rawDepth(raw, RAW_DEPTH_LIMIT) > RAW_DEPTH_LIMIT) throw new z.ZodError([{ code: "custom", path: [], message: "nested too deep", input: undefined }]);
  const version = versionOf(raw);
  if (version === 1) return upgradeV1(contentV1.parse(raw));
  if (version === 2) return upgradeV2(contentV2.parse(raw));
  return siteContent.parse(raw);
}
export function safeParseContent(raw: unknown): { success: true; data: SiteContent } | { success: false } {
  try {
    return { success: true, data: parseContent(raw) };
  } catch {
    return { success: false };
  }
}

export const newBlockId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 10);

/** An empty node of a type, with the fields it has. Nothing is invented: the texts are for the person to write. */
export function emptyBlock(type: BlockType, blockId = newBlockId()): SiteNode {
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
    case "box":
      return { id: blockId, type, tag: "div", children: [] };
    case "heading":
      return { id: blockId, type, level: 2, text: "" };
    case "paragraph":
      return { id: blockId, type, text: "" };
    case "button":
      return { id: blockId, type, label: "", channel: undefined };
    case "link":
      return { id: blockId, type, label: "", channel: undefined };
    case "image":
      return { id: blockId, type, assetId: "", alt: "", caption: "", size: "full" };
  }
}

/** The images of the library that the document uses: in image blocks, in the style of any node (a background), and the logo. */
export function referencedAssetIds(content: SiteContent): string[] {
  const ids: string[] = [];
  for (const entry of allNodes(content.blocks)) {
    if (entry.type === "image" && entry.assetId) ids.push(entry.assetId);
    ids.push(...nodeAssetIds(entry));
  }
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

/** A copy of the tree with each node replaced by what `change` gives (containers first get their children changed). */
export function mapNodes(blocks: readonly SiteNode[], change: (entry: SiteNode) => SiteNode): SiteNode[] {
  return blocks.map((entry) => change(entry.type === "box" ? { ...entry, children: mapNodes(entry.children, change) } : entry));
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
    blocks: mapNodes(content.blocks, (b) =>
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
    blocks: mapNodes(content.blocks, (b) => {
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
  /** The node the issue is about (the one inside a container, when it is that), so the editor can show it. */
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
  const nodeIds = new Set(allNodes(content.blocks).map((entry) => entry.id));

  /** A button is a pair: a text and a contact. Both empty is "no button"; one of them alone is a mistake. */
  const button = (at: number, blockId: string, label: string, buttonLabel: string, channel: Channel | undefined) => {
    if (!buttonLabel && !channel) return;
    if (!buttonLabel) add(at, blockId, `${label}: escreva o texto do botão.`);
    else if (!channel) add(at, blockId, `${label}: escolha para onde o botão leva.`);
    else if (!channelUrl(content.contact, channel))
      add(at, blockId, `${label}: o botão leva ao ${CHANNEL_LABEL[channel]}, mas esse contato não está preenchido ou é inválido.`);
  };
  /** A button or a link of its own: a text, and a place to go (a contact, or another block of the page). */
  const destination = (at: number, label: string, item: ButtonNode | LinkNode) => {
    const noun = item.type === "link" ? "link" : "botão";
    if (!item.label && !item.channel && !item.anchor) add(at, item.id, `${label}: o ${noun} precisa de texto e de um destino (um contato ou um bloco da página).`);
    else if (!item.label) add(at, item.id, `${label}: escreva o texto do ${noun}.`);
    else if (!item.channel && !item.anchor) add(at, item.id, `${label}: escolha para onde o ${noun} leva.`);
    else if (item.channel && !channelUrl(content.contact, item.channel))
      add(at, item.id, `${label}: o ${noun} leva ao ${CHANNEL_LABEL[item.channel]}, mas esse contato não está preenchido ou é inválido.`);
    else if (item.anchor && !nodeIds.has(item.anchor)) add(at, item.id, `${label}: o ${noun} leva a um bloco que não existe mais. Escolha outro.`);
  };
  const element = (at: number, label: string, item: ElementNode) => {
    if (item.type === "heading" && !item.text) add(at, item.id, `${label}: escreva o título.`);
    else if (item.type === "paragraph" && !item.text) add(at, item.id, `${label}: escreva o texto.`);
    else if (item.type === "button" || item.type === "link") destination(at, label, item);
    else if (item.type === "image") {
      if (!item.assetId) add(at, item.id, `${label}: escolha a imagem.`);
      else if (assetIds && !assetIds.has(item.assetId)) add(at, item.id, `${label}: a imagem escolhida não está mais na biblioteca. Escolha outra.`);
      if (item.assetId && !item.alt) add(at, item.id, `${label}: descreva a imagem para quem não consegue vê-la (texto alternativo).`);
    }
  };

  const visit = (root: SiteNode, at: number, trail: number[], b: SiteNode) => {
    const label =
      trail.length === 0
        ? `Bloco ${at} (${BLOCK_LABEL[b.type]})`
        : `Bloco ${at} (${BLOCK_LABEL[root.type]}), camada ${trail.map((position) => position + 1).join(".")} (${BLOCK_LABEL[b.type]})`;
    if (assetIds)
      for (const assetId of nodeAssetIds(b))
        if (!assetIds.has(assetId)) add(at, b.id, `${label}: a imagem de fundo escolhida não está mais na biblioteca. Escolha outra ou tire o fundo.`);
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
      case "box":
        b.children.forEach((child, position) => visit(root, at, [...trail, position], child));
        break;
      case "heading":
      case "paragraph":
      case "button":
      case "link":
      case "image":
        element(at, label, b);
        break;
    }
  };
  content.blocks.forEach((b, index) => visit(b, index + 1, [], b));
  if (content.logoAssetId && assetIds && !assetIds.has(content.logoAssetId)) add(null, null, "O logotipo escolhido não está mais na biblioteca. Escolha outro ou tire o logotipo.");
  return issues;
}
