/**
 * Which published page answers an address. A page's route is written the way the editor writes it (`sobre`, `/servicos/personal`); the
 * address of the site (`/site/<slug>/<route>`) gives the same without the slashes at the ends. The home page is the one the settings of
 * the editor name; without such a setting, a page whose route is empty, `home` or `index`; without one either, the page published first.
 */
export interface PageRef {
  name: string;
  route: string;
  publishedAt: string;
}

/** A route without the slashes at its ends. */
export const routeOf = (route: string): string => route.trim().replace(/^\/+|\/+$/g, "");

const HOME_ROUTES = ["", "home", "index"];

export function pickPage(pages: PageRef[], requested: string, home: string): PageRef | null {
  const wanted = routeOf(requested);
  if (wanted !== "") return pages.find((page) => routeOf(page.route) === wanted) ?? null;
  const named = routeOf(home);
  const byName = named !== "" ? pages.find((page) => routeOf(page.route) === named) : undefined;
  if (byName) return byName;
  for (const route of HOME_ROUTES) {
    const found = pages.find((page) => routeOf(page.route) === route);
    if (found) return found;
  }
  return [...pages].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.name.localeCompare(b.name))[0] ?? null;
}

/**
 * The route asked by an address, from the segments after the site's own. Null for a request that cannot name a page (an empty segment,
 * a `.` or `..`, a control character or a slash hidden in a segment), which answers like a page that does not exist.
 */
export function requestedRoute(segments: string[] | undefined): string | null {
  const clean: string[] = [];
  for (const raw of segments ?? []) {
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (!segment || segment === "." || segment === ".." || /[\u0000-\u001f\u007f/\\]/.test(segment) || segment.length > 200) return null;
    clean.push(segment);
  }
  return clean.join("/");
}
