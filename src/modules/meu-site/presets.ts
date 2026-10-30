import { emptyBlock, newBlockId, type BoxNode, type BoxTag, type PlainBlockType, type SiteNode } from "./contracts";
import type { Style } from "./style";

/**
 * What the library of the editor offers to add. A container comes with a plain, visible starting style (a section has
 * room around it, a row lays its content side by side), written into the document like any other style so the person
 * sees it in the style panel and changes it there; nothing about a preset is hidden in the page's stylesheet.
 */
export type Group = "structure" | "element" | "section" | "template" | "layout";
export interface CatalogueItem {
  key: string;
  group: Group;
  label: string;
  hint: string;
  create: () => SiteNode;
}

const box = (name: string, tag: BoxTag, style: Style, children: SiteNode[] = []): BoxNode => ({
  ...(emptyBlock("box", newBlockId()) as BoxNode),
  name,
  tag,
  style,
  children,
});

const STACK: Style = { display: "flex", direction: "column", gap: "12px" };
const SECTION: Style = { display: "flex", direction: "column", gap: "16px", padding: { top: "48px", right: "20px", bottom: "48px", left: "20px" } };
const CONTAINER: Style = { display: "flex", direction: "column", gap: "12px", width: "100%", maxWidth: "1100px", margin: { left: "auto", right: "auto" } };
const ROW: Style = { display: "flex", direction: "row", wrap: "wrap", gap: "16px", align: "start" };
const COLUMN: Style = { display: "flex", direction: "column", gap: "12px", grow: 1, shrink: 1, basis: "240px", minWidth: "0px" };
const GRID: Style = { display: "grid", columns: 3, gap: "16px" };

const element = (type: PlainBlockType) => () => emptyBlock(type);

// ---- ready-made sections made of containers and elements ("modelos") ----
//
// A template is a tree like any other: containers with a plain starting style, and elements. Nothing in it is hidden, and nothing is invented:
// the texts the person has to write are left empty (the editor shows what goes there), and the only words that are filled in are labels of
// structure (the names of the places a link goes to) and the text of the contact buttons, which go to the contact the person filled in.

const SIDES = (top: string, right: string, bottom = top, left = right) => ({ top, right, bottom, left });
// The page already keeps its own side margin (20px): a template that added its own would sit further in than the blocks around it.
const SECTION_PADDING = SIDES("48px", "0px");
const heading = (level: 2 | 3 | 4 = 3): SiteNode => ({ ...emptyBlock("heading"), level }) as SiteNode;
const paragraph = (style?: Style): SiteNode => ({ ...emptyBlock("paragraph"), ...(style ? { style } : null) }) as SiteNode;
const contactButton = (label: string): SiteNode => ({ ...emptyBlock("button"), label, channel: "whatsapp" }) as SiteNode;
const labelled = (label: string, channel?: "whatsapp" | "email" | "instagram"): SiteNode => ({ ...emptyBlock("link"), label, ...(channel ? { channel } : null) }) as SiteNode;
const image = (size: "full" | "medium" | "small", style?: Style): SiteNode => ({ ...emptyBlock("image"), size, ...(style ? { style } : null) }) as SiteNode;
/** A container with the style it has at each size of the screen: what the tablet and the phone change is written in the node itself. */
const adapted = (name: string, tag: BoxTag, style: Style, sizes: { tablet?: Style; mobile?: Style }, children: SiteNode[]): BoxNode => ({
  ...box(name, tag, style, children),
  ...(sizes.tablet ? { styleTablet: sizes.tablet } : null),
  ...(sizes.mobile ? { styleMobile: sizes.mobile } : null),
});
/** Three equal columns on the computer, two on the tablet and one on the phone. */
const GRID3: Style = { display: "grid", columns: 3, gap: "24px", padding: SECTION_PADDING };
const GRID3_TABLET: Style = { columns: 2 };
const GRID3_PHONE: Style = { columns: 1 };
const CARD: Style = {
  display: "flex",
  direction: "column",
  gap: "12px",
  padding: SIDES("24px", "24px"),
  radius: "16px",
  borderWidth: "1px",
  borderStyle: "solid",
  borderColor: "line",
  background: "bg",
  shadow: "sm",
};
const column = (children: SiteNode[], style: Style = {}): BoxNode => box("Coluna", "div", { display: "flex", direction: "column", gap: "8px", ...style }, children);
const THREE = <T,>(make: () => T): T[] => [make(), make(), make()];

const navigationBar = (): SiteNode =>
  box(
    "Barra de navegação",
    "header",
    { display: "flex", direction: "row", wrap: "wrap", justify: "between", align: "center", gap: "16px", padding: SIDES("16px", "20px"), borderWidth: "1px", borderStyle: "solid", borderColor: "line" },
    [
      paragraph({ fontWeight: 800 }),
      box("Links", "nav", { display: "flex", direction: "row", wrap: "wrap", gap: "20px", align: "center" }, [labelled("Serviços"), labelled("Sobre mim"), labelled("Contato", "whatsapp")]),
    ],
  );
const pageFooter = (): SiteNode =>
  box("Rodapé", "footer", { display: "flex", direction: "column", align: "center", gap: "12px", padding: SIDES("32px", "20px"), borderWidth: "1px", borderStyle: "solid", borderColor: "line" }, [
    paragraph({ textAlign: "center", color: "muted" }),
    box("Links", "nav", { display: "flex", direction: "row", wrap: "wrap", justify: "center", gap: "20px" }, [labelled("Instagram", "instagram"), labelled("WhatsApp", "whatsapp"), labelled("E-mail", "email")]),
  ]);
const threeHighlights = (): SiteNode => adapted("3 destaques", "section", GRID3, { tablet: GRID3_TABLET, mobile: GRID3_PHONE }, THREE(() => column([heading(3), paragraph()])));
const testimonials = (): SiteNode => adapted("Depoimentos", "section", GRID3, { tablet: GRID3_TABLET, mobile: GRID3_PHONE }, THREE(() => emptyBlock("quote")));
const plans = (): SiteNode =>
  adapted("Planos", "section", GRID3, { tablet: GRID3_TABLET, mobile: GRID3_PHONE }, THREE(() => box("Plano", "article", CARD, [heading(3), paragraph(), contactButton("Quero este plano")])));
const imageAndText = (): SiteNode =>
  box("Imagem e texto", "section", { display: "flex", direction: "row", wrap: "wrap", gap: "32px", align: "center", padding: SECTION_PADDING }, [
    image("medium", { grow: 1, shrink: 1, basis: "280px", minWidth: "0px" }),
    column([heading(2), paragraph(), contactButton("Falar comigo")], { gap: "12px", align: "start", grow: 1, shrink: 1, basis: "280px", minWidth: "0px" }),
  ]);

// ---- layouts: sections that arrange a page the way a designed site does (a big title beside a picture, a band of numbers, colored cards) ----
//
// Same rule as the templates above: containers and elements with a plain starting style (each size of the screen written in the node), nothing hidden
// and no text or picture invented. A picture is an empty frame of a shape (the editor draws the frame, the person chooses the image); the words that are
// filled in are only the text of the contact buttons. The colors are names of the theme (`solid`, `on`, `soft`), so they follow the accent the person picks.

/** The same node with a style at each size. */
const styled = <T extends SiteNode>(node: T, style: Style, sizes: { tablet?: Style; mobile?: Style } = {}): T => ({
  ...node,
  style,
  ...(sizes.tablet ? { styleTablet: sizes.tablet } : null),
  ...(sizes.mobile ? { styleMobile: sizes.mobile } : null),
});
/** A picture in a frame of a shape, cropped at the centre to fill it. */
const framed = (ratio: "1:1" | "4:5" | "3:4" | "4:3" | "3:2" | "16:9", style: Style = {}): SiteNode => ({ ...image("full", { radius: "24px", overflow: "hidden", ...style }), ratio }) as SiteNode;
/** A small line above a title: capital letters, spaced, in the color of the accent. */
const KICKER: Style = { fontSize: "13px", fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase", color: "accent" };
const bigTitle = (size: string, sizes: { tablet?: string; mobile?: string } = {}): SiteNode =>
  styled(heading(2), { fontFamily: "display", fontSize: size, fontWeight: 800, lineHeight: 1, textTransform: "uppercase" }, {
    ...(sizes.tablet ? { tablet: { fontSize: sizes.tablet } } : null),
    ...(sizes.mobile ? { mobile: { fontSize: sizes.mobile } } : null),
  });

/** A band with a color of its own keeps some air above and below, so two of them (or a band and a card) do not touch. */
const BAND_MARGIN = SIDES("24px", "0px");

/** A title beside a picture; `pictureFirst` puts the picture on the left. On the phone one is over the other. */
const splitHero = (pictureFirst: boolean) => (): SiteNode => {
  const copy = column(
    [
      styled(paragraph(), KICKER),
      bigTitle("64px", { tablet: "52px", mobile: "40px" }),
      styled(paragraph(), { fontSize: "18px", color: "muted" }),
      contactButton("Falar comigo"),
    ],
    { gap: "16px", align: "start", justify: "center" },
  );
  return adapted(
    pictureFirst ? "Destaque com imagem à esquerda" : "Destaque dividido",
    "section",
    { display: "grid", columns: 2, gap: "48px", align: "center", padding: SIDES("56px", "0px") },
    { tablet: { gap: "32px" }, mobile: { columns: 1, gap: "24px", padding: SIDES("32px", "0px") } },
    pictureFirst ? [framed("4:5"), copy] : [copy, framed("4:5")],
  );
};
/** Four numbers across, each with its caption, on a soft band. The numbers are left for the person to write. */
const numbersBand = (): SiteNode =>
  adapted(
    "Faixa de números",
    "section",
    { display: "grid", columns: 4, gap: "16px", padding: SIDES("28px", "20px"), background: "soft", radius: "16px", margin: BAND_MARGIN },
    { tablet: { columns: 2 }, mobile: { columns: 2, padding: SIDES("20px", "12px") } },
    Array.from({ length: 4 }, () =>
      column(
        [
          styled(heading(3), { fontFamily: "display", fontSize: "44px", fontWeight: 800, lineHeight: 1, textAlign: "center" }, { mobile: { fontSize: "34px" } }),
          styled(paragraph(), { fontSize: "14px", color: "muted", textAlign: "center" }),
        ],
        { gap: "6px", align: "stretch" },
      ),
    ),
  );
/** A colored band with five short items in a row (the names of the places of the page, or of what is offered). */
const linkBand = (): SiteNode =>
  adapted(
    "Faixa de links",
    "section",
    { display: "flex", direction: "row", wrap: "wrap", justify: "between", align: "center", gap: "16px", padding: SIDES("18px", "24px"), background: "solid", color: "on", radius: "14px", margin: BAND_MARGIN },
    { mobile: { justify: "center", padding: SIDES("16px", "16px") } },
    Array.from({ length: 5 }, () => styled(paragraph(), { fontWeight: 700, textAlign: "center" })),
  );
/** Three cards: filled with the accent, dark, and only outlined; each with a title, a text and a contact button. */
const colorCards = (): SiteNode => {
  const card = (name: string, look: Style, button: Style): SiteNode =>
    box(name, "article", { display: "flex", direction: "column", align: "start", gap: "12px", padding: SIDES("28px", "24px"), radius: "20px", minHeight: "240px", ...look }, [
      styled(heading(3), { fontFamily: "display", fontSize: "26px", fontWeight: 800, lineHeight: 1.1, textTransform: "uppercase" }),
      paragraph(),
      styled(contactButton("Saiba mais"), button),
    ]);
  return adapted(
    "Cartões coloridos",
    "section",
    { display: "grid", columns: 3, gap: "20px", padding: SIDES("48px", "0px") },
    { tablet: { columns: 2 }, mobile: { columns: 1, padding: SIDES("32px", "0px") } },
    [
      card("Cartão cheio", { background: "solid", color: "on" }, { background: "white", color: "black" }),
      card("Cartão escuro", { background: "black", color: "white" }, { background: "white", color: "black" }),
      card("Cartão vazado", { borderWidth: "2px", borderStyle: "solid", borderColor: "ink" }, {}),
    ],
  );
};
/** A picture, a card of text and another picture side by side (a little tighter on the tablet); on the phone they stack. */
const aboutPanels = (): SiteNode =>
  adapted(
    "Sobre em painéis",
    "section",
    { display: "grid", columns: 3, gap: "16px", align: "stretch", padding: SIDES("48px", "0px") },
    { tablet: { gap: "12px" }, mobile: { columns: 1, gap: "16px", padding: SIDES("32px", "0px") } },
    [
      framed("3:4"),
      styled(
        box("Texto", "div", {}, [
          styled(paragraph(), KICKER),
          styled(heading(2), { fontFamily: "display", fontSize: "34px", fontWeight: 800, lineHeight: 1.05, textTransform: "uppercase" }, { tablet: { fontSize: "24px" }, mobile: { fontSize: "34px" } }),
          paragraph(),
          labelled("Ler mais"),
        ]),
        { display: "flex", direction: "column", gap: "14px", justify: "center", align: "start", padding: SIDES("28px", "24px"), background: "soft", radius: "24px" },
        { tablet: { padding: SIDES("20px", "16px") }, mobile: { padding: SIDES("28px", "24px") } },
      ),
      framed("3:4"),
    ],
  );
/** A closing band: a big title on one side, a line of text and a button on the other. */
const finalBand = (): SiteNode =>
  adapted(
    "Chamada final em faixa",
    "section",
    { display: "grid", columns: 2, gap: "32px", align: "center", padding: SIDES("40px", "40px"), background: "solid", color: "on", radius: "24px", margin: BAND_MARGIN },
    { tablet: { padding: SIDES("32px", "32px") }, mobile: { columns: 1, gap: "20px", padding: SIDES("28px", "20px") } },
    [
      bigTitle("48px", { mobile: "36px" }),
      column([paragraph(), styled(contactButton("Falar comigo"), { background: "black", color: "white" })], { gap: "16px", align: "start" }),
    ],
  );

export const CATALOGUE: readonly CatalogueItem[] = [
  { key: "section", group: "structure", label: "Seção", hint: "Faixa da página", create: () => box("Seção", "section", SECTION) },
  { key: "container", group: "structure", label: "Contêiner", hint: "Centralizado", create: () => box("Contêiner", "div", CONTAINER) },
  { key: "row", group: "structure", label: "Linha", hint: "Lado a lado", create: () => box("Linha", "div", ROW) },
  { key: "column", group: "structure", label: "Coluna", hint: "Um sobre o outro", create: () => box("Coluna", "div", COLUMN) },
  { key: "grid", group: "structure", label: "Grade", hint: "3 colunas iguais", create: () => box("Grade", "div", GRID) },
  {
    key: "columns2",
    group: "structure",
    label: "2 colunas",
    hint: "Uma linha com duas colunas",
    create: () => box("2 colunas", "div", ROW, [box("Coluna", "div", COLUMN), box("Coluna", "div", COLUMN)]),
  },
  { key: "stack", group: "structure", label: "Pilha", hint: "Contêiner simples", create: () => box("Pilha", "div", STACK) },
  { key: "heading", group: "element", label: "Título", hint: "Texto em destaque", create: element("heading") },
  { key: "paragraph", group: "element", label: "Parágrafo", hint: "Texto simples", create: element("paragraph") },
  { key: "button", group: "element", label: "Botão", hint: "Leva a um contato ou bloco", create: element("button") },
  { key: "link", group: "element", label: "Link", hint: "Texto que leva a um contato ou bloco", create: element("link") },
  { key: "image", group: "element", label: "Imagem", hint: "Da biblioteca do site", create: element("image") },
  { key: "hero", group: "section", label: "Destaque", hint: "Título e botão", create: element("hero") },
  { key: "text", group: "section", label: "Texto", hint: "Título e texto", create: element("text") },
  { key: "services", group: "section", label: "Serviços", hint: "Da sua lista", create: element("services") },
  { key: "about", group: "section", label: "Sobre mim", hint: "Apresentação", create: element("about") },
  { key: "quote", group: "section", label: "Depoimento", hint: "Com autorização", create: element("quote") },
  { key: "stats", group: "section", label: "Indicadores", hint: "Números do método", create: element("stats") },
  { key: "faq", group: "section", label: "Perguntas frequentes", hint: "Respostas curtas", create: element("faq") },
  { key: "cta", group: "section", label: "Chamada para contato", hint: "Chamada com botão", create: element("cta") },
  { key: "contactForm", group: "section", label: "Formulário de contato", hint: "Nome, contato e mensagem", create: element("contactForm") },
  { key: "template-navigation", group: "template", label: "Barra de navegação", hint: "Nome e links", create: navigationBar },
  { key: "template-highlights", group: "template", label: "3 destaques", hint: "Três colunas com título e texto", create: threeHighlights },
  { key: "template-image-text", group: "template", label: "Imagem e texto", hint: "Uma imagem ao lado do texto", create: imageAndText },
  { key: "template-plans", group: "template", label: "Planos", hint: "Três cartões com botão", create: plans },
  { key: "template-testimonials", group: "template", label: "Depoimentos", hint: "Três depoimentos lado a lado", create: testimonials },
  { key: "template-footer", group: "template", label: "Rodapé", hint: "Texto e links de contato", create: pageFooter },
  { key: "layout-split-hero", group: "layout", label: "Destaque dividido", hint: "Título grande ao lado de uma imagem", create: splitHero(false) },
  { key: "layout-split-hero-reverse", group: "layout", label: "Destaque com imagem à esquerda", hint: "A imagem primeiro, o título ao lado", create: splitHero(true) },
  { key: "layout-numbers", group: "layout", label: "Faixa de números", hint: "Quatro números em destaque", create: numbersBand },
  { key: "layout-link-band", group: "layout", label: "Faixa de links", hint: "Uma faixa colorida com cinco itens", create: linkBand },
  { key: "layout-cards", group: "layout", label: "Cartões coloridos", hint: "Três cartões: cheio, escuro e vazado", create: colorCards },
  { key: "layout-about-panels", group: "layout", label: "Sobre em painéis", hint: "Imagem, texto e imagem", create: aboutPanels },
  { key: "layout-final-band", group: "layout", label: "Chamada final em faixa", hint: "Título grande, texto e botão", create: finalBand },
];

export const GROUP_LABEL: Record<Group, string> = { structure: "Estrutura", element: "Elementos básicos", section: "Seções prontas", template: "Modelos", layout: "Layouts" };

export const catalogueItem = (key: string): CatalogueItem | undefined => CATALOGUE.find((item) => item.key === key);
