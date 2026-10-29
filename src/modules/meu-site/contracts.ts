import { z } from "zod";
import { DELIVERIES, type Delivery } from "@/modules/leads/contracts";
import { ALT_MAX, CAPTION_MAX } from "./images";
import { HEX_COLOR } from "./brand-color";
import { ACCENTS, DEFAULT_THEME, FONTS, MODES, WIDTHS } from "./site-theme";
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
 * A component is a node (and what it holds) kept once in `components` and drawn wherever a `component` node points to
 * it: the node is the instance, which can only change the texts, buttons and images that the definition leaves open
 * (`overrides`) and its own style. A component never holds another one, so there is no cycle to follow.
 *
 * A site may have more pages besides the home page (`blocks`): each of `pages` has its own address (`slug`), title (the menu's label), description
 * for search engines and blocks. The limits of a page (blocks, nodes, depth) are the ones of a page; the site has a limit of its own for all of them.
 * A button or a link may go to a page (`page`: "home" or the identifier of one), in the same way it goes to a contact or to a block of its own page.
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
/** Nodes of all the pages together (the ones inside the definitions of the components are not counted: they have their own limits). */
export const MAX_SITE_NODES = 800;
export const MAX_CONTENT_BYTES = 400_000;
/** Pages besides the home page. */
export const MAX_PAGES = 10;
export const PAGE_TITLE_MAX = 40;
/** The identifier of the home page in a link to a page. */
export const HOME = "home";
/** Components kept in a site, and nodes in the definition of one. */
export const MAX_COMPONENTS = 20;
export const MAX_COMPONENT_NODES = 40;
/** The nodes of the page once every component is drawn where it is used: what the server has to print. */
export const MAX_EXPANDED_NODES = 600;
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

export const SECTION_TYPES = ["hero", "text", "services", "about", "quote", "stats", "faq", "cta", "contactForm"] as const;
/** What holds nothing else and stands by itself. */
export const ELEMENT_TYPES = ["heading", "paragraph", "button", "link", "image"] as const;
/** The kinds of node that can be made empty, from the library. */
export const BLOCK_KINDS = [...SECTION_TYPES, "box", ...ELEMENT_TYPES] as const;
export type PlainBlockType = (typeof BLOCK_KINDS)[number];
/** Every kind of node, the instance of a component included (that one is made from a component, never empty). */
export const BLOCK_TYPES = [...BLOCK_KINDS, "component"] as const;
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
  contactForm: "Formulário de contato",
  box: "Contêiner",
  heading: "Título",
  paragraph: "Parágrafo",
  button: "Botão",
  link: "Link",
  image: "Imagem",
  component: "Componente",
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
/**
 * The contact form: a name, a way to reach the person, an optional message and the box that says the privacy notice was read. The fields and their
 * texts are the tool's, not the page's (what a visitor is asked is not a promise a professional makes); the page owns the title, a line above the
 * fields and the text of the button. It appears on the public page only when the environment has opened the public forms and the site has been opened
 * for messages: otherwise it is not there at all.
 */
const contactFormShape = {
  type: z.literal("contactForm"),
  eyebrow,
  heading: plain(HEADING_MAX),
  text: plain(SUBHEADING_MAX),
  buttonLabel: plain(BUTTON_MAX),
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
const contactForm = z.object({ ...base, ...contactFormShape }).strict();
const heading = z
  .object({ ...base, ...headingShape, level: z.number().int().min(2).max(6) })
  .strict();
const paragraph = z.object({ ...base, ...paragraphShape }).strict();
/** The point a button or a link goes to: a contact, another node of the same page, or another page of the site (only one of them). */
const anchor = id.optional();
const pageRef = id.optional();
const oneDestination = (node: { channel?: unknown; anchor?: unknown; page?: unknown }) => [node.channel, node.anchor, node.page].filter((value) => value !== undefined).length <= 1;
const button = z
  .object({ ...base, ...buttonShape, anchor, page: pageRef })
  .strict()
  .refine(oneDestination, { message: "a button goes to a contact, to a block or to a page, only one of them" });
const link = z
  .object({ ...base, type: z.literal("link"), label: plain(BUTTON_MAX), channel: z.enum(CHANNELS).optional(), anchor, page: pageRef })
  .strict()
  .refine(oneDestination, { message: "a link goes to a contact, to a block or to a page, only one of them" });
const image = z.object({ ...base, ...imageShape }).strict();
/**
 * What an instance may change in the nodes of its component: the texts of titles and paragraphs, the label and the contact of buttons and
 * links, the image (with its description and caption). Nothing else: the layout and the style are the component's.
 */
export const OVERRIDE_FIELDS = {
  heading: ["text"],
  paragraph: ["text"],
  button: ["label", "channel"],
  link: ["label", "channel"],
  image: ["assetId", "alt", "caption"],
} as const;
const overrideFields = z
  .object({ text: plain(TEXT_MAX), label: plain(BUTTON_MAX), channel: z.enum(CHANNELS), assetId: z.string().max(64), alt: plain(ALT_MAX), caption: plain(CAPTION_MAX) })
  .partial()
  .strict();
export type OverrideFields = z.infer<typeof overrideFields>;
/** An instance of a component: where it stands on the page, and what it changes of the component's nodes, by their identifiers. */
const component = z
  .object({
    ...base,
    type: z.literal("component"),
    componentId: id,
    overrides: z.record(id, overrideFields).refine((overrides) => Object.keys(overrides).length <= MAX_COMPONENT_NODES, { message: "too many overrides" }),
  })
  .strict();

export type HeroNode = z.infer<typeof hero>;
export type TextNode = z.infer<typeof text>;
export type ServicesNode = z.infer<typeof services>;
export type AboutNode = z.infer<typeof about>;
export type QuoteNode = z.infer<typeof quote>;
export type StatsNode = z.infer<typeof stats>;
export type FaqNode = z.infer<typeof faq>;
export type CtaNode = z.infer<typeof cta>;
export type ContactFormNode = z.infer<typeof contactForm>;
export type HeadingNode = z.infer<typeof heading>;
export type ParagraphNode = z.infer<typeof paragraph>;
export type ButtonNode = z.infer<typeof button>;
export type LinkNode = z.infer<typeof link>;
export type ImageNode = z.infer<typeof image>;
export type ComponentNode = z.infer<typeof component>;
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
export type SiteNode =
  | HeroNode
  | TextNode
  | ServicesNode
  | AboutNode
  | QuoteNode
  | StatsNode
  | FaqNode
  | CtaNode
  | ContactFormNode
  | BoxNode
  | HeadingNode
  | ParagraphNode
  | ButtonNode
  | LinkNode
  | ImageNode
  | ComponentNode;
/** The names the rest of the code already used. */
export type Block = SiteNode;
export type BlockOf<T extends BlockType> = Extract<SiteNode, { type: T }>;
export type ElementNode = HeadingNode | ParagraphNode | ButtonNode | LinkNode | ImageNode;

const box: z.ZodType<BoxNode> = z
  .object({ ...base, type: z.literal("box"), tag: z.enum(BOX_TAGS), children: z.array(z.lazy(() => node)).max(MAX_CHILDREN) })
  .strict();
const node: z.ZodType<SiteNode> = z.lazy(() => z.union([box, heading, paragraph, button, link, image, component, hero, text, services, about, quote, stats, faq, cta, contactForm]));
export const siteNode = node;

/** A node kept once and drawn wherever an instance points to it. */
export interface ComponentDef {
  id: string;
  name: string;
  root: SiteNode;
}
const componentDef: z.ZodType<ComponentDef> = z.object({ id, name: plain(NAME_MAX).pipe(z.string().min(1)), root: z.lazy(() => node) }).strict();

export const contact = z
  .object({ whatsapp: plain(30), email: plain(254), instagram: plain(31) })
  .strict();
export type Contact = z.infer<typeof contact>;

export const theme = z
  .object({
    accent: z.enum(ACCENTS),
    mode: z.enum(MODES),
    width: z.enum(WIDTHS),
    /** The font of the whole page; absent for the one it always had. */
    font: z.enum(FONTS).optional(),
    /** The color of the brand, `#rrggbb`: the page's palette is made from it (brand-color.ts) and it takes the place of `accent`. */
    brand: z
      .string()
      .transform((value) => value.trim().toLowerCase())
      .pipe(z.string().regex(HEX_COLOR))
      .optional(),
  })
  .strict();

/**
 * An address of a page of the site, below the site's own: lowercase letters, digits and hyphens. "m" is not allowed: `/m/` is where the images
 * of the page are served from.
 */
export const PAGE_SLUG_RESERVED = ["m"] as const;
export const pageSlug = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(
    z
      .string()
      .min(1)
      .max(40)
      .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/)
      .refine((value) => !value.includes("--"))
      .refine((value) => !(PAGE_SLUG_RESERVED as readonly string[]).includes(value)),
  );
/**
 * A page of the site besides the home page. `title` is its label in the menu and in the title of the tab; it may be empty in a draft (publishing
 * says so, and the menu leaves the page out until it has one). `inMenu` is absent for the page that is in the menu.
 */
export const pageSchema = z
  .object({
    id,
    slug: pageSlug,
    title: plain(PAGE_TITLE_MAX),
    description: plain(DESCRIPTION_MAX),
    inMenu: z.boolean().optional(),
    blocks: z.array(node).max(MAX_BLOCKS),
  })
  .strict();
export type PageDef = z.infer<typeof pageSchema>;

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

// ---- pages ----

/** The pages of a document besides the home page (none when it has not got the list). */
export const pagesOf = (content: { pages?: readonly PageDef[] }): readonly PageDef[] => content.pages ?? [];
export const pageById = (content: { pages?: readonly PageDef[] }, pageId: string): PageDef | undefined => (content.pages ?? []).find((entry) => entry.id === pageId);

/**
 * The document as the editor shows one page of it: the blocks of the page are `blocks` (so everything that works on "the page" works on it), and
 * the blocks of the home page take its place in `pages`. Every tree is still in the document, so what looks across pages (the identifiers, the
 * components, the images, the limits of the site) is the same. Doing it twice gives the document back. The home page, or a page that is not
 * there, is the document itself.
 */
export function swapPage<T extends { blocks: SiteNode[]; pages?: PageDef[] }>(content: T, pageId: string | null): T {
  if (pageId === null || pageId === HOME) return content;
  const target = (content.pages ?? []).find((entry) => entry.id === pageId);
  if (!target) return content;
  return { ...content, blocks: target.blocks, pages: (content.pages ?? []).map((entry) => (entry.id === pageId ? { ...entry, blocks: content.blocks } : entry)) };
}
/** The document as one page draws it: the blocks of the page in place of the home page's. */
export const pageContent = <T extends { blocks: SiteNode[]; pages?: PageDef[] }>(content: T, pageId: string | null): T => {
  const swapped = swapPage(content, pageId);
  return swapped === content ? content : { ...swapped, pages: content.pages };
};

// ---- components ----

/** What of a document the functions below look at. */
interface Held {
  blocks: readonly SiteNode[];
  components?: readonly ComponentDef[];
  pages?: ReadonlyArray<{ id: string; blocks: readonly SiteNode[] }>;
}
/** Every tree of nodes of the document: the home page's blocks, then each page's. The limits of a page are checked tree by tree. */
const treesOf = (content: Pick<Held, "blocks" | "pages">): Array<readonly SiteNode[]> => [content.blocks, ...(content.pages ?? []).map((entry) => entry.blocks)];
/** The components of a document (none when it has not got the list). */
export const componentsOf = (content: Pick<Held, "components">): readonly ComponentDef[] => content.components ?? [];
export const componentById = (content: Pick<Held, "components">, componentId: string): ComponentDef | undefined => componentsOf(content).find((entry) => entry.id === componentId);
/** Every node the document keeps: the ones on its pages and the ones in the definitions of its components. */
export const documentNodes = (content: Held): SiteNode[] => [...treesOf(content).flatMap((blocks) => allNodes(blocks)), ...componentsOf(content).flatMap((entry) => allNodes([entry.root]))];
/** The nodes of all the pages together, the ones inside containers included (what `MAX_SITE_NODES` limits). */
export const siteNodeCount = (content: Pick<Held, "blocks" | "pages">): number => treesOf(content).reduce((sum, blocks) => sum + allNodes(blocks).length, 0);

/**
 * What the most crowded page adds up to once its instances of components are drawn: each instance itself and every node of its component. A page
 * is what the server prints for a visit, so the limit is of a page, not of the site.
 */
export function expandedCount(content: Held): number {
  const sizes = new Map(componentsOf(content).map((entry) => [entry.id, allNodes([entry.root]).length]));
  return Math.max(...treesOf(content).map((blocks) => allNodes(blocks).reduce((sum, entry) => sum + 1 + (entry.type === "component" ? sizes.get(entry.componentId) ?? 0 : 0), 0)));
}

/**
 * The root of a component as one instance draws it: the nodes of the definition with the instance's own texts, labels, contacts and images laid over.
 * What the definition does not leave open, and a field that does not belong to the node, is ignored; an override of a button's contact takes away
 * its link to a block or to a page (a button goes to only one place).
 */
export function applyOverrides(root: SiteNode, overrides: ComponentNode["overrides"]): SiteNode {
  if (Object.keys(overrides).length === 0) return root;
  return mapNodes([root], (entry) => {
    const own = overrides[entry.id];
    const open = (OVERRIDE_FIELDS as Record<string, readonly (keyof OverrideFields)[]>)[entry.type];
    if (!own || !open) return entry;
    const merged: Record<string, unknown> = { ...entry };
    for (const field of open) if (own[field] !== undefined) merged[field] = own[field];
    if ((entry.type === "button" || entry.type === "link") && own.channel !== undefined) {
      delete merged.anchor;
      delete merged.page;
    }
    return merged as unknown as SiteNode;
  })[0];
}

/** Whether the components of the document are well made: distinct, none inside another, small enough, and every instance still a valid node once drawn. */
function componentsAreWhole(content: Held): boolean {
  const list = componentsOf(content);
  if (new Set(list.map((entry) => entry.id)).size !== list.length) return false;
  for (const entry of list) {
    const inside = allNodes([entry.root]);
    if (inside.length > MAX_COMPONENT_NODES || inside.some((item) => item.type === "component")) return false;
  }
  for (const instance of treesOf(content).flatMap((blocks) => allNodes(blocks))) {
    if (instance.type !== "component") continue;
    const definition = list.find((entry) => entry.id === instance.componentId);
    if (definition && !node.safeParse(applyOverrides(definition.root, instance.overrides)).success) return false;
  }
  return true;
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
    /** Whether search engines may list the page; absent is yes. The page stays open to whoever has the address either way. */
    indexable: z.boolean().optional(),
    blocks: z.array(node).max(MAX_BLOCKS),
    /** The components of the site, each kept once; absent when there is none. */
    components: z.array(componentDef).max(MAX_COMPONENTS).optional(),
    /** The pages besides the home page (`blocks`), in the order of the menu; absent when the site has only one. */
    pages: z.array(pageSchema).max(MAX_PAGES).optional(),
  })
  .strict()
  .refine((content) => new Set(documentNodes(content).map((b) => b.id)).size === documentNodes(content).length, { message: "block ids repeat" })
  .refine((content) => pagesOf(content).every((entry, at, list) => entry.id !== HOME && list.findIndex((other) => other.id === entry.id) === at), { message: "page ids repeat" })
  .refine((content) => pagesOf(content).every((entry, at, list) => list.findIndex((other) => other.slug === entry.slug) === at), { message: "page addresses repeat" })
  .refine((content) => treesOf(content).every((blocks) => allNodes(blocks).length <= MAX_NODES), { message: "too many blocks" })
  .refine((content) => siteNodeCount(content) <= MAX_SITE_NODES, { message: "too many blocks in the site" })
  .refine((content) => treesOf(content).every((blocks) => boxDepth(blocks) <= MAX_DEPTH) && componentsOf(content).every((entry) => boxDepth([entry.root]) <= MAX_DEPTH), { message: "containers nested too deep" })
  .refine(componentsAreWhole, { message: "components are not valid" })
  .refine((content) => expandedCount(content) <= MAX_EXPANDED_NODES, { message: "too many blocks once the components are drawn" })
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
/** One node of a document (for what is pasted from the clipboard), or null when it is not one. Nested too deep is refused before the recursion of the schema. */
export function parseNode(raw: unknown): SiteNode | null {
  if (rawDepth(raw, RAW_DEPTH_LIMIT) > RAW_DEPTH_LIMIT) return null;
  const parsed = siteNode.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
/** The definition of a component in a copy from the clipboard, or null when it is not one (nested too deep, an instance inside, too large). */
export function parseComponentDef(raw: unknown): ComponentDef | null {
  if (rawDepth(raw, RAW_DEPTH_LIMIT) > RAW_DEPTH_LIMIT) return null;
  const parsed = componentDef.safeParse(raw);
  if (!parsed.success) return null;
  const inside = allNodes([parsed.data.root]);
  return inside.length <= MAX_COMPONENT_NODES && !inside.some((entry) => entry.type === "component") ? parsed.data : null;
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
export function emptyBlock(type: PlainBlockType, blockId = newBlockId()): SiteNode {
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
    case "contactForm":
      return { id: blockId, type, eyebrow: "", heading: "", text: "", buttonLabel: "Enviar mensagem" };
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

/** The images of the library that the document uses: in image blocks (those of the components and those an instance chooses), in the style of any node (a background), and the logo. */
export function referencedAssetIds(content: SiteContent): string[] {
  const ids: string[] = [];
  for (const entry of documentNodes(content)) {
    if (entry.type === "image" && entry.assetId) ids.push(entry.assetId);
    if (entry.type === "component") for (const own of Object.values(entry.overrides)) if (own.assetId) ids.push(own.assetId);
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
  const resolve = (b: SiteNode): SiteNode =>
    b.type === "services"
      ? {
          ...b,
          items: b.serviceIds.flatMap((serviceId) => {
            const service = live.get(serviceId);
            return service ? [{ name: service.name, ...(service.description ? { description: service.description } : {}), delivery: service.delivery }] : [];
          }),
        }
      : b;
  return withEachNode(content, resolve);
}

/** The document with `change` applied to every node, on every page and in the components. */
export function withEachNode(content: SiteContent, change: (entry: SiteNode) => SiteNode): SiteContent {
  const next: SiteContent = { ...content, blocks: mapNodes(content.blocks, change) };
  if (content.pages) next.pages = content.pages.map((entry) => ({ ...entry, blocks: mapNodes(entry.blocks, change) }));
  if (content.components) next.components = content.components.map((entry) => ({ ...entry, root: mapNodes([entry.root], change)[0] }));
  return next;
}

/** What the draft keeps: a release brought back as a draft loses the resolved services, which are made again. */
export function withoutResolvedServices(content: SiteContent): SiteContent {
  return withEachNode(content, (b) => {
    if (b.type !== "services") return b;
    const { items: _items, ...rest } = b;
    void _items;
    return rest;
  });
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
  /** The page the issue is about: its identifier, or null for the home page and for what concerns the whole site. */
  page: string | null;
  /** Position (from 1) of the block on the page, for the message; null for what concerns the whole page. */
  block: number | null;
  /** The node the issue is about (the one inside a container, when it is that), so the editor can show it. */
  blockId: string | null;
  message: string;
  /**
   * "blocking" stops the publication: there is nothing to publish (no title, no block) or a safeguard that the person has to
   * state (a testimony's authorization). "warning" is something to look at that does not stop it: the page is published without
   * the part that is not ready (the public page leaves out a button with no contact, an incomplete question, an image that is
   * not there) when the person chooses "publish anyway".
   */
  severity: "blocking" | "warning";
}

/**
 * The problems that stop a publication. `liveServiceIds` are the services on offer right now; `assetIds` the images
 * of the site's library (null when the caller has not looked: then only what the document itself says is checked).
 */
export function publishIssues(
  content: SiteContent,
  liveServiceIds: ReadonlySet<string>,
  assetIds: ReadonlySet<string> | null = null,
  /** What the site itself says about the form: `inquiriesOpen` is its own switch for messages (undefined when the caller has not looked). */
  site: { inquiriesOpen?: boolean } = {},
): PublishIssue[] {
  const issues: PublishIssue[] = [];
  /** The page being looked at: what is found is about it, and the message says which one when it is not the home page. */
  let where: { page: string | null; prefix: string } = { page: null, prefix: "" };
  const add = (block: number | null, blockId: string | null, message: string, severity: PublishIssue["severity"] = "warning") =>
    issues.push({ page: where.page, block, blockId, message: `${where.prefix}${message}`, severity });
  if (!content.title) add(null, null, "Dê um título ao site.", "blocking");
  if (content.blocks.length === 0) add(null, null, "Acrescente pelo menos um bloco.", "blocking");
  /** The blocks of the page being looked at: a button may go to one of them. */
  let nodeIds = new Set<string>();
  const pageExists = (target: string) => target === HOME || pageById(content, target) !== undefined;
  const places = pagesOf(content).length > 0 ? "um contato, um bloco desta página ou outra página" : "um contato ou um bloco da página";

  /** A button is a pair: a text and a contact. Both empty is "no button"; one of them alone is a mistake. */
  const button = (at: number, blockId: string, label: string, buttonLabel: string, channel: Channel | undefined) => {
    if (!buttonLabel && !channel) return;
    if (!buttonLabel) add(at, blockId, `${label}: escreva o texto do botão.`);
    else if (!channel) add(at, blockId, `${label}: escolha para onde o botão leva.`);
    else if (!channelUrl(content.contact, channel))
      add(at, blockId, `${label}: o botão leva ao ${CHANNEL_LABEL[channel]}, mas esse contato não está preenchido ou é inválido.`);
  };
  /** A button or a link of its own: a text, and a place to go (a contact, another block of the page, or another page of the site). */
  const destination = (at: number, label: string, item: ButtonNode | LinkNode) => {
    const noun = item.type === "link" ? "link" : "botão";
    const goes = item.channel || item.anchor || item.page;
    if (!item.label && !goes) add(at, item.id, `${label}: o ${noun} precisa de texto e de um destino (${places}).`);
    else if (!item.label) add(at, item.id, `${label}: escreva o texto do ${noun}.`);
    else if (!goes) add(at, item.id, `${label}: escolha para onde o ${noun} leva.`);
    else if (item.channel && !channelUrl(content.contact, item.channel))
      add(at, item.id, `${label}: o ${noun} leva ao ${CHANNEL_LABEL[item.channel]}, mas esse contato não está preenchido ou é inválido.`);
    else if (item.anchor && !nodeIds.has(item.anchor)) add(at, item.id, `${label}: o ${noun} leva a um bloco que não existe mais. Escolha outro.`);
    else if (item.page && !pageExists(item.page)) add(at, item.id, `${label}: o ${noun} leva a uma página que não existe mais. Escolha outra.`);
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

  /**
   * `inside` is set while the nodes of a component are visited, as one instance draws them: the issues are written about the instance (the
   * block the editor can show), with the name of the component, and the position in the page is the instance's.
   */
  const visit = (root: SiteNode, at: number, trail: number[], b: SiteNode, inside?: { instance: ComponentNode; name: string }) => {
    const where = inside ? `Bloco ${at} (Componente “${inside.name}”)` : `Bloco ${at} (${BLOCK_LABEL[root.type]})`;
    const label = trail.length === 0 ? (inside ? where : `Bloco ${at} (${BLOCK_LABEL[b.type]})`) : `${where}, camada ${trail.map((position) => position + 1).join(".")} (${BLOCK_LABEL[b.type]})`;
    const start = issues.length;
    check(root, at, trail, b, label, inside);
    // What is found inside a component is about the instance: it is the block that stands on the page.
    if (inside) for (let position = start; position < issues.length; position++) issues[position] = { ...issues[position], blockId: inside.instance.id };
  };
  const check = (root: SiteNode, at: number, trail: number[], b: SiteNode, label: string, inside?: { instance: ComponentNode; name: string }) => {
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
        if (!b.authorized) add(at, b.id, `${label}: confirme que a pessoa autorizou o uso do depoimento.`, "blocking");
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
      case "contactForm":
        if (!b.buttonLabel) add(at, b.id, `${label}: escreva o texto do botão de enviar.`);
        if (site.inquiriesOpen === false)
          add(at, b.id, `${label}: o recebimento de mensagens do site está desligado, então o formulário não aparece para quem visita. Ligue em “Mensagens do site”, na tela do Meu Site.`);
        break;
      case "box":
        b.children.forEach((child, position) => visit(root, at, [...trail, position], child, inside));
        break;
      case "component": {
        const definition = componentById(content, b.componentId);
        if (!definition) add(at, b.id, `${label}: o componente deste bloco não existe mais. Desvincule o bloco ou exclua-o.`);
        else visit(definition.root, at, [], applyOverrides(definition.root, b.overrides), { instance: b, name: definition.name });
        break;
      }
      case "heading":
      case "paragraph":
      case "button":
      case "link":
      case "image":
        element(at, label, b);
        break;
    }
  };
  nodeIds = new Set(allNodes(content.blocks).map((entry) => entry.id));
  content.blocks.forEach((b, index) => visit(b, index + 1, [], b));
  for (const entry of pagesOf(content)) {
    where = { page: entry.id, prefix: `Página “${entry.title || entry.slug}”: ` };
    nodeIds = new Set(allNodes(entry.blocks).map((inner) => inner.id));
    if (!entry.title) add(null, null, "dê um título à página: ele é o nome dela no menu, e sem ele a página fica fora do menu.");
    if (entry.blocks.length === 0) add(null, null, "a página está sem blocos. Acrescente algum ou apague a página.");
    entry.blocks.forEach((b, index) => visit(b, index + 1, [], b));
  }
  where = { page: null, prefix: "" };
  if (content.logoAssetId && assetIds && !assetIds.has(content.logoAssetId)) add(null, null, "O logotipo escolhido não está mais na biblioteca. Escolha outro ou tire o logotipo.");
  return issues;
}
