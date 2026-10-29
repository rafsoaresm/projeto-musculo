import { HOME, pageById, pagesOf, type SiteContent } from "./contracts";

/** What the home page is called in the menu. */
export const HOME_LABEL = "Início";

export interface NavItem {
  /** `HOME` or the identifier of a page. */
  id: string;
  label: string;
  href: string;
  current: boolean;
}

/**
 * The pages of a site as one page draws them: the menu in its header, and where a button or a link that goes to a page leads. The addresses are not
 * decided here (they depend on where the page is drawn: the published site, the preview, the editor); `hrefOf` gives them.
 */
export interface SiteNav {
  /** The menu: the home page and the pages that are in it, in order. It is drawn only when it has more than the home page. */
  items: NavItem[];
  /** Where a page goes, or null when there is no such page (a link that goes there is left out of the public page). */
  href: (pageId: string) => string | null;
  /** The editor's preview: a click on a link to a page shows it there instead of following an address. */
  onVisit?: (pageId: string) => void;
}

export function siteNav(content: SiteContent, current: string, hrefOf: (pageId: string, slug: string | null) => string, onVisit?: (pageId: string) => void): SiteNav {
  const items: NavItem[] = [
    { id: HOME, label: HOME_LABEL, href: hrefOf(HOME, null), current: current === HOME },
    // A page with no title has no name to show: it stays out of the menu until it has one.
    ...pagesOf(content)
      .filter((entry) => entry.inMenu !== false && entry.title !== "")
      .map((entry) => ({ id: entry.id, label: entry.title, href: hrefOf(entry.id, entry.slug), current: current === entry.id })),
  ];
  return {
    items,
    href: (pageId) => {
      if (pageId === HOME) return hrefOf(HOME, null);
      const found = pageById(content, pageId);
      return found ? hrefOf(found.id, found.slug) : null;
    },
    onVisit,
  };
}
