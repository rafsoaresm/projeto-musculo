import { emptyBlock, newBlockId, type BlockType, type BoxNode, type BoxTag, type SiteNode } from "./contracts";
import type { Style } from "./style";

/**
 * What the library of the editor offers to add. A container comes with a plain, visible starting style (a section has
 * room around it, a row lays its content side by side), written into the document like any other style so the person
 * sees it in the style panel and changes it there; nothing about a preset is hidden in the page's stylesheet.
 */
export type Group = "structure" | "element" | "section";
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

const element = (type: BlockType) => () => emptyBlock(type);

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
];

export const GROUP_LABEL: Record<Group, string> = { structure: "Estrutura", element: "Elementos básicos", section: "Seções prontas" };

export const catalogueItem = (key: string): CatalogueItem | undefined => CATALOGUE.find((item) => item.key === key);
