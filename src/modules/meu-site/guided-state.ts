/**
 * Where the person is in the Editor Guiado: the tab, the page, the section being edited, and on a phone the step (the list or the fields) and
 * whether the preview is open over everything. Pure, so the screen only draws it; `normalizeGuided` keeps it pointing at something that exists
 * after any change of the document (a page deleted, an undo).
 */
import { HOME, allNodes, pageById, pageContent, type SiteContent } from "./contracts";
import { sectionsOf } from "./guided-model";

export const GUIDED_TABS = ["paginas", "conteudo", "marca", "seo", "publicar"] as const;
export type GuidedTab = (typeof GUIDED_TABS)[number];
export const GUIDED_TAB_LABEL: Record<GuidedTab, string> = { paginas: "Páginas", conteudo: "Conteúdo", marca: "Marca", seo: "SEO", publicar: "Publicar" };

/** A section of the page (its id), or the site's own header and footer, which are the same on every page. */
export type SectionRef = string;
export const HEADER: SectionRef = "header";
export const FOOTER: SectionRef = "footer";

export interface GuidedState {
  tab: GuidedTab;
  pageId: string;
  section: SectionRef | null;
  /** On a narrow screen: the list of sections, or the fields of the chosen one. */
  step: "lista" | "campos";
  /** On a narrow screen: the preview over everything. */
  preview: boolean;
}

export type GuidedAction =
  | { type: "tab"; tab: GuidedTab }
  | { type: "page"; pageId: string }
  | { type: "section"; section: SectionRef }
  | { type: "back" }
  | { type: "preview"; open: boolean }
  /** A section chosen on the preview: on a phone the preview closes and its fields open. */
  | { type: "pick"; section: SectionRef; pageId?: string };

export const startGuided = (): GuidedState => ({ tab: "conteudo", pageId: HOME, section: HEADER, step: "lista", preview: false });

export function guidedReducer(state: GuidedState, action: GuidedAction): GuidedState {
  switch (action.type) {
    case "tab":
      return state.tab === action.tab ? state : { ...state, tab: action.tab };
    case "page":
      return state.pageId === action.pageId ? state : { ...state, pageId: action.pageId, section: HEADER, step: "lista" };
    case "section":
      return { ...state, section: action.section, step: "campos" };
    case "back":
      return state.step === "lista" ? state : { ...state, step: "lista" };
    case "preview":
      return state.preview === action.open ? state : { ...state, preview: action.open };
    case "pick":
      return { ...state, tab: "conteudo", pageId: action.pageId ?? state.pageId, section: action.section, step: "campos", preview: false };
  }
}

/** The state pointing at what exists: a page that is gone falls back to the home page, a section that is gone to the header. Same object when fine. */
export function normalizeGuided(content: SiteContent, state: GuidedState): GuidedState {
  const pageId = state.pageId === HOME || pageById(content, state.pageId) ? state.pageId : HOME;
  const blocks = pageContent(content, pageId).blocks;
  const section = state.section === null || state.section === HEADER || state.section === FOOTER || blocks.some((entry) => entry.id === state.section) ? state.section : HEADER;
  if (pageId === state.pageId && section === state.section) return state;
  return { ...state, pageId, section, step: pageId === state.pageId ? state.step : "lista" };
}

/** The name of a page as the editor says it. */
export function pageName(content: SiteContent, pageId: string): string {
  if (pageId === HOME) return "Página inicial";
  const page = pageById(content, pageId);
  return page ? page.title || "Página sem título" : "Página inicial";
}

/** The site's header and footer, then the page's own sections, in the order the page draws them. */
export function guidedSections(content: SiteContent, pageId: string): Array<{ ref: SectionRef; label: string }> {
  return [{ ref: HEADER, label: "Cabeçalho do site" }, ...sectionsOf(content, pageId).map((entry) => ({ ref: entry.id, label: entry.label })), { ref: FOOTER, label: "Rodapé do site" }];
}

/** "Página X › Seção Y": where the person is editing. */
export function guidedTrail(content: SiteContent, state: GuidedState): { page: string; section: string | null } {
  const section = state.section === null ? null : (guidedSections(content, state.pageId).find((entry) => entry.ref === state.section)?.label ?? null);
  return { page: pageName(content, state.pageId), section };
}

/** The section of the page that holds a node (an issue found inside a section points at the section). */
export function sectionOfNode(content: SiteContent, pageId: string, nodeId: string): SectionRef | null {
  return pageContent(content, pageId).blocks.find((entry) => allNodes([entry]).some((node) => node.id === nodeId))?.id ?? null;
}
