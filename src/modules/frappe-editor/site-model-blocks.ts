/**
 * A site model of the Editor Guiado (models/: Energia, Bem-estar, Premium, Performance) as the blocks of a page of the Editor Avançado (the
 * embedded Frappe Builder). The page is made from the same document the Editor Guiado draws, so there is one source for both editors: its
 * typed styles become the editor's style maps (camelCase CSS, one map for the computer, the tablet and the phone), and the rules the guided page
 * takes from the app's style sheet (globals.css: `.site`, `.site-heading`, `.site-text`, `.button`, `.site-whatsapp`, the FAQ, the testimony,
 * the header of a palette...) are written on each block, since a page of the editor has no such sheet. Every color of the palette is written as
 * its value (no `var(--site-…)` is left), and the font is the editor's own Inter.
 *
 * Nothing invented is published (AGENTS.md): the texts are the ones "Ver o modelo" shows, except that every text the model leaves empty on a
 * site that is created (a name, a price, a number, a testimony: `say` in models/bricks.ts) becomes a marker in brackets that says what to write
 * there ("[Seu nome]", "[Preço do plano]"). The sample photos are files of the app that a published page does not serve: an image is an empty box
 * of its shape, for the person to choose a photo of their own in the editor, and a background photo is the palette's dark color. The WhatsApp
 * buttons go to the organization's number when there is a valid one, otherwise to the contact part of the page; never to a made-up number.
 *
 * Pure and deterministic (the same model and title give the same blocks, with ids `<model>-<n>`), with nothing of Node: it runs on the Workers.
 *
 * What the four models use and how it maps: box -> its own tag; heading -> h1 (the first one of the first part) or h2..h6; paragraph -> a text
 * block; button / link -> `a` (WhatsApp buttons in the green pill with the WhatsApp mark as inline SVG); image -> `img` with no file; quote ->
 * a section with the eyebrow, the text and the author; faq -> a section with `details`/`summary`; contactForm -> a form like the editor's form
 * templates (name, e-mail, mobile, message and a button: the server adds the privacy box). The site's header (title, menu, WhatsApp) is made
 * from `menu` and `headerCta`. Not mapped, because no model uses them: the old section types (hero, text, services, about, stats, cta), the
 * instances of components, `illustration` drawings and photos of the library (`assetId`); they are left out of the page.
 */
import type { SiteModelDef } from "@/modules/meu-site/models";
import { whatsappUrl, type SiteContent, type SiteNode } from "@/modules/meu-site/contracts";
import { SCREENS, resolveStyle, type Screen } from "@/modules/meu-site/screens";
import { paletteVars, type PaletteVars } from "@/modules/meu-site/site-palette";
import { cssDeclarations, type Style } from "@/modules/meu-site/style";

export type CssMap = Record<string, string>;

/** A block as the editor keeps it in a page's `blocks` (and as frappe-site/render.ts reads it). */
export interface FrappeBlock {
  element: string;
  originalElement?: string;
  blockId: string;
  blockName?: string;
  children: FrappeBlock[];
  baseStyles: CssMap;
  tabletStyles: CssMap;
  mobileStyles: CssMap;
  attributes: Record<string, string>;
  customAttributes: Record<string, string>;
  classes: string[];
  innerHTML?: string;
}

export interface SiteModelPageOptions {
  /** The number the WhatsApp buttons go to (the organization's), or null: they then go to the contact part of the page. */
  whatsapp: string | null;
}

/** The text a marker puts where the model leaves a fact of the person empty, by the name the model gives that node. */
const MARKERS: Record<string, string> = {
  "Seu nome": "[Seu nome]",
  "Sua profissão e especialidade": "[Sua profissão e especialidade]",
  "Sua história e formação": "[Sua história, formação e experiência]",
  "Destaques (ex.: experiência)": "[Destaques reais do seu trabalho]",
  "Número (só se for real)": "[Número]",
  "O que o número conta": "[O que o número conta]",
  "Selo de destaque (opcional)": "[Selo do plano (opcional)]",
  "Valor (R$)": "[Preço do plano]",
  Periodicidade: "[Periodicidade]",
  "Para quem é o plano": "[Para quem é o plano]",
  "O que inclui (item)": "[O que o plano inclui]",
  "Rótulo dos depoimentos": "[Rótulo da seção]",
  "Título dos depoimentos": "[Título da seção de depoimentos]",
  "Texto do contato": "[Escreva aqui: uma frase para o contato]",
  "Quem você treina (só se for real)": "[Quem você treina, só se for real]",
  "Rótulo da equipe": "[Rótulo da seção]",
  "Título da equipe": "[Título da seção da equipe]",
  "Quem é a equipe": "[Escreva aqui: quem é a equipe]",
  "Nome do coach": "[Nome do profissional]",
  "Especialidade do coach": "[Especialidade]",
};
const markerFor = (name: string | undefined, fallback = "[Escreva aqui]") => (name ? (MARKERS[name] ?? `[Escreva aqui: ${name}]`) : fallback);
const QUOTE_MARKERS = { eyebrow: "[Nota da avaliação (opcional)]", quote: "[Depoimento de um aluno, com autorização]", author: "[Nome de quem deu o depoimento]" };
const FAQ_ANSWER_MARKER = "[Escreva a resposta]";
const PHOTO_ALT = "Troque pela sua foto";

/** The WhatsApp mark (whatsapp-icon.tsx, Figma `17:3`), drawn in the label's color. */
const WHATSAPP_PATH =
  "M14.56 11.985C14.3125 11.8608 13.095 11.2625 12.8683 11.18C12.6408 11.0975 12.4758 11.0567 12.31 11.305C12.145 11.5525 11.6708 12.11 11.5267 12.275C11.3825 12.44 11.2375 12.4608 10.99 12.3375C10.7425 12.2133 9.94417 11.9517 8.99833 11.1083C8.2625 10.4517 7.765 9.64083 7.62083 9.3925C7.47667 9.145 7.60583 9.01083 7.72917 8.8875C7.84083 8.77666 7.9775 8.59833 8.10083 8.45416C8.225 8.30916 8.26583 8.20583 8.34917 8.04083C8.43167 7.87583 8.39083 7.73166 8.32833 7.6075C8.26667 7.48333 7.77083 6.26416 7.565 5.76916C7.36333 5.28666 7.15917 5.3525 7.0075 5.34416C6.86333 5.3375 6.69833 5.33583 6.5325 5.33583C6.3675 5.33583 6.09917 5.3975 5.8725 5.645C5.64583 5.8925 5.00583 6.49166 5.00583 7.71C5.00583 8.92833 5.89333 10.1058 6.01667 10.2708C6.14083 10.4358 7.7625 12.9375 10.2467 14.01C10.8375 14.265 11.2983 14.4175 11.6575 14.5317C12.25 14.72 12.7892 14.6933 13.2158 14.63C13.6908 14.5592 14.6808 14.0308 14.8875 13.4525C15.0942 12.875 15.0942 12.3792 15.0317 12.2758C14.97 12.1725 14.805 12.1108 14.5567 11.9867L14.56 11.985ZM10.0417 18.1333C8.56666 18.1324 7.11899 17.7352 5.85 16.9833L5.55 16.8083L2.43333 17.625L3.26667 14.5833L3.06667 14.275C2.25675 12.9943 1.81559 11.5151 1.79167 10C1.79167 5.45833 5.49167 1.75833 10.0417 1.75833C11.1235 1.75568 12.1951 1.96711 13.1948 2.38044C14.1945 2.79378 15.1026 3.40084 15.8667 4.16666C16.6354 4.93076 17.2448 5.83981 17.6596 6.84113C18.0745 7.84246 18.2865 8.91615 18.2833 10C18.2833 14.5417 14.5833 18.2417 10.0417 18.2417V18.1333ZM17.05 3.63333C16.157 2.65485 15.0764 1.86587 13.8725 1.31329C12.6685 0.760703 11.3658 0.455788 10.0417 0.416664C4.58333 0.416664 0.141668 4.85833 0.141668 10.3083C0.141668 12.0583 0.600001 13.775 1.46667 15.2667L0.0583344 20.4167L5.31667 19.0417C6.76689 19.8296 8.39122 20.2421 10.0417 20.2417C15.5 20.2417 19.9417 15.8 19.9417 10.35C19.9417 7.70833 18.9167 5.225 17.05 3.35833V3.63333Z";
const WHATSAPP_SVG = `<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="${WHATSAPP_PATH}" fill="currentColor"/></svg>`;
const MENU_SVG = '<svg width="18" height="14" viewBox="0 0 18 14" aria-hidden="true" focusable="false"><path d="M0 1H18M0 7H18M0 13H18" stroke="currentColor" stroke-width="2"/></svg>';
/** The green of the WhatsApp (style.ts: it does not follow the palette) and its hover (globals.css `.site-whatsapp:hover`). */
const WHATSAPP_GREEN = "#0e8544";
const WHATSAPP_HOVER = "#0b6e38";

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const kebabToCamel = (name: string) => name.replace(/-([a-z])/g, (_all, letter: string) => letter.toUpperCase());

// ---- styles: the typed style of a node as the editor's maps ----

/** `var(--site-<name>)` -> the key of the palette's variables. */
const PALETTE_VAR: Record<string, keyof PaletteVars> = {
  bg: "bg",
  surface: "surface",
  ink: "ink",
  text: "text",
  muted: "muted",
  line: "line",
  solid: "solid",
  on: "on",
  accent: "accent",
  soft: "soft",
  "soft-line": "softLine",
  dark: "dark",
  "on-dark": "onDark",
  "on-dark-muted": "onDarkMuted",
  "accent-on-dark": "accentOnDark",
};

/**
 * The declarations of a typed style (style.ts writes them, so a value is exactly what the guided page gets), as a camelCase map with the palette's
 * colors written out. The theme's text variables a color also sets (`--site-ink`) are not CSS of a block: the converter carries them itself
 * (`Inherited`). A background photo writes nothing (no image is served from here).
 */
function cssMap(style: Style, vars: PaletteVars): CssMap {
  const out: CssMap = {};
  for (const declaration of cssDeclarations(style, { imageUrl: () => null })) {
    const at = declaration.indexOf(":");
    const property = declaration.slice(0, at);
    if (property.startsWith("--")) continue;
    let value = declaration.slice(at + 1).replace(/var\(--site-([a-z-]+)\)/g, (all, name: string) => (PALETTE_VAR[name] ? vars[PALETTE_VAR[name]] : all));
    if (value.includes("var(")) continue;
    if (property === "font-family") value = value.includes("Inter") ? "Inter" : value;
    out[kebabToCamel(property)] = value;
  }
  return out;
}

/** What a block's rules are at each size: the computer's, then what the tablet changes, then what the phone changes over the tablet. */
interface Sized {
  base: CssMap;
  tablet?: CssMap;
  mobile?: CssMap;
}

const changed = (next: CssMap, previous: CssMap): CssMap => {
  const out: CssMap = {};
  for (const [key, value] of Object.entries(next)) if (previous[key] !== value) out[key] = value;
  return out;
};

/**
 * The maps of a node: the rules the guided page takes from its sheet (`implicit`, per size), then the node's own style, laid over in the same order
 * as the guided page's cascade. The editor's tablet rules apply up to 1023px and its phone rules up to 576px, the same limits as the guided page.
 */
function sizedStyles(node: { style?: Style; styleTablet?: Style; styleMobile?: Style } | null, implicit: Sized, vars: PaletteVars): Pick<FrappeBlock, "baseStyles" | "tabletStyles" | "mobileStyles"> {
  const full: Record<Screen, CssMap> = { desktop: {}, tablet: {}, mobile: {} };
  let carried: CssMap = {};
  for (const screen of SCREENS) {
    const own = node ? resolveStyle(node, screen) : {};
    const layer = screen === "desktop" ? implicit.base : screen === "tablet" ? (implicit.tablet ?? {}) : (implicit.mobile ?? {});
    carried = { ...carried, ...layer };
    full[screen] = { ...carried, ...cssMap(own, vars), ...(own.hidden ? { display: "none" } : null) };
  }
  return { baseStyles: full.desktop, tabletStyles: changed(full.tablet, full.desktop), mobileStyles: changed(full.mobile, full.tablet) };
}

// ---- the build ----

/** The theme's text colors at a point of the tree: a node with a color of its own sets them for what is inside (as `--site-ink` does). */
interface Inherited {
  ink: string;
}

interface Build {
  key: string;
  vars: PaletteVars;
  count: number;
  /** The DOM id of each node a link or the menu goes to. */
  anchors: Map<string, string>;
  /** Each node of the preview with the same node as a created site has it (to tell a sample from a text of the model). */
  site: Map<SiteNode, SiteNode>;
  /** The node that holds the page's only h1. */
  firstHeading: SiteNode | null;
  whatsapp: { href: string; external: boolean };
}

const nextId = (build: Build) => `${build.key}-${(build.count += 1)}`;

function block(build: Build, element: string, styles: Pick<FrappeBlock, "baseStyles" | "tabletStyles" | "mobileStyles">, extra: Partial<FrappeBlock> = {}): FrappeBlock {
  return { element, blockId: nextId(build), children: [], attributes: {}, customAttributes: {}, classes: [], ...styles, ...extra };
}
const plainStyles = (base: CssMap, tablet: CssMap = {}, mobile: CssMap = {}) => ({ baseStyles: base, tabletStyles: tablet, mobileStyles: mobile });

/**
 * A text of the preview as the page gets it: the created site's text when it has one (a text of the model), a marker when only the preview has it
 * (a fact of the person), nothing when neither has (the node is then left out).
 */
function textOf(preview: string, site: string | undefined, marker: string): { text: string; marker: boolean } | null {
  if (site !== undefined && site !== "") return { text: site, marker: false };
  // The separators around the sample ("ATLETAS TREINADOS  •  ") stay around the marker, so it reads as part of the same line.
  if (preview !== "") return { text: `${/^[\s•|/]*/.exec(preview)![0]}${marker}${/[\s•|/]*$/.exec(preview)![0]}`, marker: true };
  return null;
}

/** Pairs each node of the preview with the created site's node at the same place (the two documents have the same tree; only their ids differ). */
function pairTrees(preview: readonly SiteNode[], site: readonly SiteNode[], out: Map<SiteNode, SiteNode>): void {
  preview.forEach((node, at) => {
    const twin = site[at];
    if (!twin || twin.type !== node.type) return;
    out.set(node, twin);
    if (node.type === "box" && twin.type === "box") pairTrees(node.children, twin.children, out);
  });
}

const slug = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "secao";

function* walk(nodes: readonly SiteNode[]): Generator<SiteNode> {
  for (const node of nodes) {
    yield node;
    if (node.type === "box") yield* walk(node.children);
  }
}

/** The DOM ids of the parts that the menu and the links go to: the menu's label (`#contato`), else the part's name, never twice the same. */
function anchorIds(content: SiteContent): Map<string, string> {
  const wanted = new Map<string, string>();
  for (const entry of content.menu ?? []) if (entry.label.trim() && !wanted.has(entry.anchor)) wanted.set(entry.anchor, entry.label);
  for (const node of walk(content.blocks))
    if ((node.type === "button" || node.type === "link") && node.anchor && !wanted.has(node.anchor)) {
      const target = [...walk(content.blocks)].find((entry) => entry.id === node.anchor);
      wanted.set(node.anchor, target?.name ?? "secao");
    }
  const existing = new Set([...walk(content.blocks)].map((node) => node.id));
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const [id, label] of wanted) {
    if (!existing.has(id)) continue;
    let name = slug(label);
    for (let n = 2; used.has(name); n += 1) name = `${slug(label)}-${n}`;
    used.add(name);
    out.set(id, name);
  }
  return out;
}

/** The part of the page that holds the contact form (where the WhatsApp buttons go without a number): its DOM id, given one if it has none. */
function contactAnchor(content: SiteContent, anchors: Map<string, string>): string | null {
  const part = content.blocks.find((entry) => [...walk([entry])].some((node) => node.type === "contactForm"));
  if (!part) return null;
  if (!anchors.has(part.id)) {
    const taken = new Set(anchors.values());
    let name = "contato";
    for (let n = 2; taken.has(name); n += 1) name = `contato-${n}`;
    anchors.set(part.id, name);
  }
  return anchors.get(part.id)!;
}

// ---- the rules of the guided page's sheet (globals.css), per kind of node ----

const BUTTON_BASE: CssMap = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "10px",
  minHeight: "52px",
  paddingTop: "12px",
  paddingRight: "28px",
  paddingBottom: "12px",
  paddingLeft: "28px",
  borderRadius: "9999px",
  fontSize: "16px",
  lineHeight: "20px",
  fontWeight: "700",
  textAlign: "center",
  textDecoration: "none",
  width: "fit-content",
};
const whatsappLook = (): CssMap => ({
  ...BUTTON_BASE,
  gap: "9px",
  backgroundColor: WHATSAPP_GREEN,
  color: "#ffffff",
  paddingRight: "20px",
  paddingLeft: "20px",
  fontWeight: "600",
  "hover:backgroundColor": WHATSAPP_HOVER,
});
const eyebrowLook = (vars: PaletteVars): CssMap => ({
  color: vars.accent,
  fontSize: "12px",
  fontWeight: "700",
  letterSpacing: "0px",
  textTransform: "uppercase",
  overflowWrap: "anywhere",
  margin: "0px",
});

// ---- the nodes ----

function convert(node: SiteNode, build: Build, inherited: Inherited, top: boolean): FrappeBlock | null {
  const { vars } = build;
  const twin = build.site.get(node);
  const own = (node.style?.color ? cssMap({ color: node.style.color }, vars).color : undefined) ?? inherited.ink;
  const inside: Inherited = { ink: own };
  const anchor = build.anchors.get(node.id);
  const withAnchor = (made: FrappeBlock): FrappeBlock => {
    if (anchor) made.attributes.id = anchor;
    if (node.name) made.blockName = node.name;
    // The root of the page is a column that centers what it holds: a part of the page takes the whole width, as on the guided page.
    if (top) made.baseStyles = { width: "100%", flexShrink: "0", ...made.baseStyles };
    return made;
  };

  switch (node.type) {
    case "box": {
      const made = block(build, node.tag, sizedStyles(node, { base: { boxSizing: "border-box", minWidth: "0px" } }, vars));
      made.children = node.children.flatMap((child) => convert(child, build, inside, false) ?? []);
      return withAnchor(made);
    }
    case "heading": {
      const text = textOf(node.text, twin?.type === "heading" ? twin.text : undefined, markerFor(node.name));
      if (!text) return null;
      const element = build.firstHeading === node ? "h1" : `h${Math.min(6, Math.max(2, node.level))}`;
      const implicit: CssMap = { color: inherited.ink, fontSize: "30px", fontWeight: "700", lineHeight: "1.2", overflowWrap: "anywhere", margin: "0px" };
      return withAnchor(block(build, element, sizedStyles(node, { base: implicit }, vars), { innerHTML: escapeHtml(text.text) }));
    }
    case "paragraph": {
      const text = textOf(node.text, twin?.type === "paragraph" ? twin.text : undefined, markerFor(node.name));
      if (!text) return null;
      const implicit: CssMap = { maxWidth: "68ch", whiteSpace: "pre-line", overflowWrap: "anywhere", margin: "0px" };
      return withAnchor(block(build, "p", sizedStyles(node, { base: implicit }, vars), { innerHTML: escapeHtml(text.text) }));
    }
    case "button":
    case "link": {
      const label = textOf(node.label, twin?.type === node.type ? twin.label : undefined, markerFor(node.name, "[Texto do link]"));
      if (!label) return null;
      let href = "#";
      let external = false;
      if (node.channel === "whatsapp") ({ href, external } = build.whatsapp);
      else if (node.anchor && build.anchors.has(node.anchor)) href = `#${build.anchors.get(node.anchor)!}`;
      // A page of the site, an e-mail or an Instagram the model does not know: "#", for the person to point it in the editor.
      const icon = node.type === "button" && node.icon === "whatsapp";
      const implicit: CssMap =
        node.type === "link"
          ? { color: vars.accent, textDecoration: "underline", textUnderlineOffset: "3px", overflowWrap: "anywhere" }
          : icon
            ? whatsappLook()
            : { ...BUTTON_BASE, backgroundColor: vars.solid, color: vars.on };
      const made = block(build, "a", sizedStyles(node, { base: implicit }, vars), {
        attributes: { href, ...(external ? { target: "_blank", rel: "noopener noreferrer" } : null) },
        innerHTML: `${icon ? WHATSAPP_SVG : ""}${escapeHtml(label.text)}`,
      });
      if (icon || node.style?.background === "whatsapp") made.baseStyles["hover:backgroundColor"] = WHATSAPP_HOVER;
      return withAnchor(made);
    }
    case "image": {
      // No photo the page can serve (a sample is a file of the app, never published): the frame of the photo, empty, for the person to choose one.
      const ratio = node.ratio && node.ratio !== "auto" ? node.ratio.replace(":", " / ") : "4 / 3";
      const implicit: CssMap = { display: "block", width: "100%", height: "auto", aspectRatio: ratio, objectFit: "cover", backgroundColor: vars.soft, borderRadius: "12px", minWidth: "0px" };
      return withAnchor(block(build, "img", sizedStyles(node, { base: implicit }, vars), { attributes: { alt: PHOTO_ALT } }));
    }
    case "quote": {
      const pair = twin?.type === "quote" ? twin : undefined;
      const made = block(build, "section", sizedStyles(node, { base: { display: "grid", gap: "12px", paddingTop: "40px", paddingBottom: "40px", minWidth: "0px" } }, vars));
      const eyebrow = textOf(node.eyebrow, pair?.eyebrow, QUOTE_MARKERS.eyebrow);
      if (eyebrow)
        made.children.push(block(build, "p", plainStyles({ ...eyebrowLook(vars), fontSize: "22px", ...(eyebrow.marker ? { textTransform: "none" } : null) }), { innerHTML: escapeHtml(eyebrow.text) }));
      const quote = textOf(node.quote, pair?.quote, QUOTE_MARKERS.quote);
      if (quote)
        made.children.push(
          block(build, "p", plainStyles({ color: own, whiteSpace: "pre-line", overflowWrap: "anywhere", margin: "0px" }), {
            innerHTML: escapeHtml(quote.marker ? quote.text : `“${quote.text}”`),
          }),
        );
      const author = textOf(node.author, pair?.author, QUOTE_MARKERS.author);
      if (author) made.children.push(block(build, "p", plainStyles({ color: vars.muted, fontSize: "13px", fontWeight: "400", lineHeight: "1.5", overflowWrap: "anywhere", margin: "0px" }), { innerHTML: escapeHtml(author.text) }));
      return withAnchor(made);
    }
    case "faq": {
      const made = block(build, "section", sizedStyles(node, { base: { display: "grid", gap: "12px", paddingTop: "40px", paddingBottom: "40px", minWidth: "0px" } }, vars));
      if (node.eyebrow) made.children.push(block(build, "p", plainStyles(eyebrowLook(vars)), { innerHTML: escapeHtml(node.eyebrow) }));
      if (node.heading)
        made.children.push(
          block(build, "h2", plainStyles({ color: own, fontSize: "46px", fontWeight: "700", lineHeight: "1.2", margin: "0px 0px 12px", overflowWrap: "anywhere" }, {}, { fontSize: "32px" }), {
            innerHTML: escapeHtml(node.heading),
          }),
        );
      for (const item of node.items) {
        if (!item.question) continue;
        const details = block(build, "details", plainStyles({ display: "block", borderRadius: "12px", padding: "18px 24px", backgroundColor: `${own}0d` }));
        details.children.push(
          block(
            build,
            "summary",
            plainStyles({ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px", listStyle: "none", cursor: "pointer", color: own, fontSize: "16px", fontWeight: "600", overflowWrap: "anywhere" }),
            {
              innerHTML: `${escapeHtml(item.question)}<span style="flex-shrink: 0; color: ${vars.accent}; font-size: 22px; font-weight: 600; line-height: 1;" aria-hidden="true">+</span>`,
            },
          ),
          block(build, "p", plainStyles({ margin: "12px 0px 0px", color: vars.text, whiteSpace: "pre-line", overflowWrap: "anywhere" }), {
            innerHTML: escapeHtml(item.answer || FAQ_ANSWER_MARKER),
          }),
        );
        made.children.push(details);
      }
      return withAnchor(made);
    }
    case "contactForm":
      return withAnchor(contactForm(node, build, own));
    default:
      // Not used by any of the models (see the head of this file): left out of the page.
      return null;
  }
}

/**
 * The contact form, as the editor's form templates are made (frappe-site/form.ts reads it): a text field named `nome`, an e-mail, a mobile, a
 * message and a button. The privacy box, the bait and where it sends are added by the server, and only where the public forms are open.
 */
function contactForm(node: Extract<SiteNode, { type: "contactForm" }>, build: Build, ink: string): FrappeBlock {
  const { vars } = build;
  const section = block(build, "section", sizedStyles(node, { base: { display: "grid", gap: "12px", paddingTop: "40px", paddingBottom: "40px", minWidth: "0px" } }, build.vars));
  if (node.eyebrow) section.children.push(block(build, "p", plainStyles(eyebrowLook(vars)), { innerHTML: escapeHtml(node.eyebrow) }));
  if (node.heading) section.children.push(block(build, "h2", plainStyles({ color: ink, fontSize: "30px", fontWeight: "700", lineHeight: "1.2", margin: "0px" }), { innerHTML: escapeHtml(node.heading) }));
  if (node.text) section.children.push(block(build, "p", plainStyles({ maxWidth: "68ch", whiteSpace: "pre-line", margin: "0px" }), { innerHTML: escapeHtml(node.text) }));
  const form = block(build, "form", plainStyles({ display: "grid", gap: "14px", width: "100%", maxWidth: "560px", marginTop: "12px" }), { blockName: "Formulário de contato" });
  const control: CssMap = {
    width: "100%",
    minHeight: "46px",
    padding: "10px 14px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: vars.line,
    borderRadius: "12px",
    backgroundColor: vars.bg,
    color: vars.ink,
    fontSize: "16px",
    fontWeight: "400",
  };
  const field = (label: string, element: "input" | "textarea", attributes: Record<string, string>, custom: Record<string, string>) => {
    const group = block(build, "div", plainStyles({ display: "grid", gap: "6px" }));
    group.children.push(
      block(build, "label", plainStyles({ color: ink, fontSize: "14px", fontWeight: "600" }), { innerHTML: escapeHtml(label) }),
      block(build, element, plainStyles(element === "textarea" ? { ...control, minHeight: "110px", resize: "vertical" } : control), {
        attributes,
        customAttributes: { ...custom, "aria-label": label },
      }),
    );
    return group;
  };
  form.children.push(
    field("Nome", "input", { type: "text" }, { name: "nome", required: "true", autocomplete: "name" }),
    field("E-mail", "input", { type: "email" }, { name: "email", autocomplete: "email" }),
    field("Celular com DDD", "input", { type: "tel" }, { name: "telefone", autocomplete: "tel" }),
    field("Mensagem (opcional)", "textarea", { rows: "4" }, { name: "mensagem" }),
  );
  const submit = block(build, "button", plainStyles({ ...BUTTON_BASE, width: "100%", backgroundColor: vars.solid, color: vars.on, cursor: "pointer" }), { attributes: { type: "submit" } });
  submit.children.push(block(build, "p", plainStyles({ color: vars.on, fontSize: "16px", fontWeight: "700", margin: "0px" }), { innerHTML: escapeHtml(node.buttonLabel || "Enviar mensagem") }));
  form.children.push(submit);
  section.children.push(form);
  return section;
}

/**
 * The header of a site model (globals.css, `.site[data-site-accent="palette"] .site-header`): the name on the left, the menu in the middle and the
 * WhatsApp button on the right; on a phone the name and a "Menu" button that opens the list under the header (a `details`, so it works without a
 * script, as the guided page's checkbox does).
 */
function header(content: SiteContent, build: Build): FrappeBlock {
  const { vars } = build;
  const links = (content.menu ?? []).filter((entry) => entry.label.trim() && build.anchors.has(entry.anchor));
  const bar = block(
    build,
    "header",
    plainStyles(
      {
        position: "relative",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px 30px",
        width: "100%",
        flexShrink: "0",
        padding: "24px 80px",
        backgroundColor: vars.surface,
      },
      { padding: "24px 40px" },
      { flexWrap: "nowrap", gap: "12px", padding: "24px 22px" },
    ),
    { blockName: "Cabeçalho" },
  );
  bar.children.push(
    block(build, "p", plainStyles({ color: vars.ink, fontSize: "24px", fontWeight: "700", lineHeight: "1.22", overflowWrap: "anywhere", margin: "0px" }, {}, { fontSize: "19px", flex: "1 1 auto", minWidth: "0px" }), {
      innerHTML: escapeHtml(content.title),
      blockName: "Nome do site",
    }),
  );
  if (links.length > 0) {
    const nav = block(build, "nav", plainStyles({ flex: "1 1 auto", display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "4px 30px" }, {}, { display: "none" }), {
      attributes: { "aria-label": "Menu do site" },
      blockName: "Menu",
    });
    for (const entry of links)
      nav.children.push(
        block(build, "a", plainStyles({ display: "inline-block", padding: "4px 0px", color: vars.ink, fontSize: "14px", fontWeight: "600", textDecoration: "none", "hover:color": vars.accent }), {
          attributes: { href: `#${build.anchors.get(entry.anchor)!}` },
          innerHTML: escapeHtml(entry.label),
        }),
      );
    bar.children.push(nav);
    const menu = block(build, "details", plainStyles({ display: "none" }, {}, { display: "block", flex: "none" }), { blockName: "Menu do celular" });
    menu.children.push(
      block(
        build,
        "summary",
        plainStyles({
          display: "flex",
          alignItems: "center",
          gap: "8px",
          minHeight: "44px",
          padding: "0px 14px",
          borderWidth: "1px",
          borderStyle: "solid",
          borderColor: vars.line,
          borderRadius: "30px",
          color: vars.ink,
          fontSize: "15px",
          fontWeight: "600",
          listStyle: "none",
          cursor: "pointer",
        }),
        { innerHTML: `${MENU_SVG}Menu` },
      ),
    );
    const list = block(
      build,
      "div",
      plainStyles({
        position: "absolute",
        top: "100%",
        left: "0px",
        right: "0px",
        zIndex: "5",
        display: "flex",
        flexDirection: "column",
        padding: "4px 22px 12px",
        backgroundColor: vars.bg,
        borderBottom: `1px solid ${vars.line}`,
        boxShadow: "0 12px 20px -12px rgba(0, 0, 0, 0.25)",
      }),
    );
    links.forEach((entry, at) =>
      list.children.push(
        block(
          build,
          "a",
          plainStyles({ display: "block", padding: "14px 0px", color: vars.text, fontSize: "15px", fontWeight: "600", textDecoration: "none", ...(at > 0 ? { borderTop: `1px solid ${vars.line}` } : null) }),
          { attributes: { href: `#${build.anchors.get(entry.anchor)!}` }, innerHTML: escapeHtml(entry.label) },
        ),
      ),
    );
    menu.children.push(list);
    bar.children.push(menu);
  }
  const cta = content.headerCta?.label.trim();
  if (cta)
    bar.children.push(
      block(build, "a", plainStyles({ ...whatsappLook(), fontSize: "15px", order: "3" }, {}, { display: "none" }), {
        attributes: { href: build.whatsapp.href, ...(build.whatsapp.external ? { target: "_blank", rel: "noopener noreferrer" } : null) },
        innerHTML: `${WHATSAPP_SVG}${escapeHtml(cta)}`,
        blockName: "Botão do WhatsApp",
      }),
    );
  return bar;
}

/**
 * The root block of a new page made from a site model: the page's body (as the editor's own root: a column that centers what it holds), with the
 * header of the site, then every part of the model in order (the models have a footer of their own).
 */
export function siteModelPage(model: SiteModelDef, title: string, options: SiteModelPageOptions): FrappeBlock {
  const content = model.build(title, "preview");
  const site = new Map<SiteNode, SiteNode>();
  pairTrees(content.blocks, model.build(title, "site").blocks, site);
  const vars = paletteVars(model.palette);
  const anchors = anchorIds(content);
  const contact = contactAnchor(content, anchors);
  const direct = options.whatsapp ? whatsappUrl(options.whatsapp, content.whatsappCta?.message ?? "") : null;
  const first = content.blocks[0];
  const build: Build = {
    key: model.key,
    vars,
    count: 0,
    anchors,
    site,
    firstHeading: first ? ([...walk([first])].find((node) => node.type === "heading") ?? null) : null,
    whatsapp: direct ? { href: direct, external: true } : { href: contact ? `#${contact}` : "#", external: false },
  };
  const children = [header(content, build), ...content.blocks.flatMap((node) => convert(node, build, { ink: vars.ink }, true) ?? [])];
  return {
    element: "div",
    originalElement: "body",
    blockId: "root",
    blockName: "body",
    children,
    baseStyles: {
      display: "flex",
      flexWrap: "wrap",
      flexShrink: "0",
      flexDirection: "column",
      alignItems: "center",
      backgroundColor: vars.bg,
      color: vars.text,
      fontFamily: "Inter",
      fontSize: "16px",
      lineHeight: "1.5",
    },
    tabletStyles: {},
    mobileStyles: {},
    attributes: {},
    customAttributes: {},
    classes: [],
  };
}
