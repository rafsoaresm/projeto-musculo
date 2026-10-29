import { emptyBlock, newBlockId, type BoxNode, type BoxTag, type PlainBlockType, type SiteNode } from "./contracts";
import type { Style } from "./style";

/**
 * What the library of the editor offers to add. A container comes with a plain, visible starting style (a section has
 * room around it, a row lays its content side by side), written into the document like any other style so the person
 * sees it in the style panel and changes it there; nothing about a preset is hidden in the page's stylesheet.
 */
export type Group = "structure" | "element" | "section" | "template";
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
];

export const GROUP_LABEL: Record<Group, string> = { structure: "Estrutura", element: "Elementos básicos", section: "Seções prontas", template: "Modelos" };

export const catalogueItem = (key: string): CatalogueItem | undefined => CATALOGUE.find((item) => item.key === key);
