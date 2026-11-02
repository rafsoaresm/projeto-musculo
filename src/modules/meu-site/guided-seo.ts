/**
 * What search engines and shared links show of each page: the title and the description the public page writes (`publicMetadata` reads the
 * same two functions, so the editor's preview and the published page cannot disagree), and a preview the way a search result shows them.
 */
import { HOME, pageById, type SiteContent } from "./contracts";

/** The title of a page in the browser tab and in a search result: the page's own, then the site's. */
export function pageMetaTitle(content: Pick<SiteContent, "title" | "pages">, pageId: string): string {
  const page = pageId === HOME ? undefined : pageById(content, pageId);
  return page ? `${page.title || page.slug} — ${content.title}` : content.title;
}

/** The description: the page's own, or the site's when the page has none. */
export function pageMetaDescription(content: Pick<SiteContent, "description" | "pages">, pageId: string): string {
  const page = pageId === HOME ? undefined : pageById(content, pageId);
  return page?.description || content.description;
}

/** Roughly what a search result shows before cutting: more is not wrong, it is only not seen. */
export const SEO_TITLE_SHOWN = 60;
export const SEO_DESCRIPTION_SHOWN = 160;

const cut = (text: string, size: number) => (text.length > size ? `${text.slice(0, size - 1).trimEnd()}…` : text);

export interface SeoPreview {
  title: string;
  url: string;
  description: string;
  notes: string[];
}

/** The page as a search result would show it, and what is worth knowing about it. `url` is the public address, or null before there is one. */
export function seoPreview(content: SiteContent, pageId: string, url: string | null): SeoPreview {
  const title = pageMetaTitle(content, pageId);
  const own = pageId === HOME ? content.description : (pageById(content, pageId)?.description ?? "");
  const description = pageMetaDescription(content, pageId);
  const notes: string[] = [];
  if (content.indexable === false) notes.push("O site pede aos buscadores que não o listem (opção “Aparecer nos buscadores” desmarcada).");
  if (title.length > SEO_TITLE_SHOWN) notes.push(`O título tem ${title.length} caracteres: os buscadores costumam mostrar cerca de ${SEO_TITLE_SHOWN}.`);
  if (!description) notes.push("Sem descrição: o buscador escolhe sozinho um trecho da página para mostrar.");
  else if (!own) notes.push("Esta página não tem descrição própria: vale a do site.");
  return {
    title: cut(title, SEO_TITLE_SHOWN),
    url: url ?? "O endereço aparece quando o site tiver um endereço público.",
    description: description ? cut(description, SEO_DESCRIPTION_SHOWN) : "",
    notes,
  };
}
