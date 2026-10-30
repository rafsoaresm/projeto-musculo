/**
 * The addresses of a public page, written from the page itself: the page does not know the mount path of the platform (`/app`, `/treinador`
 * or nothing), so every address it writes is relative, built from how deep the page is (`depth` segments after the site's own: the home page
 * is 0). The home page answers at `/site/<slug>`, a page of route `a/b` at `/site/<slug>/a/b`; a relative address resolves from the
 * folder of the page's own address (`/site/` for the home page).
 */
import type { UrlContext } from "./html";
import { routeOf } from "./routes";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** How to go up to the root of the mount path (where `/site`, `/s` and `/frappe-editor` are) from a page `depth` segments deep. */
export const toMountRoot = (depth: number) => "../".repeat(depth + 1);

export function urlContext(slug: string, depth: number): UrlContext {
  const up = "../".repeat(depth);
  return {
    page(raw) {
      const suffixAt = raw.search(/[?#]/);
      const path = suffixAt === -1 ? raw : raw.slice(0, suffixAt);
      const suffix = suffixAt === -1 ? "" : raw.slice(suffixAt);
      let decoded = path;
      try {
        decoded = decodeURIComponent(path);
      } catch {
        // an address that is not valid percent-encoding is written as it came
      }
      const segments = routeOf(decoded.replace(/\\/g, "/"))
        .split("/")
        .filter((segment) => segment && segment !== "." && segment !== "..");
      const route = segments.map(encodeURIComponent).join("/");
      return `${up}${slug}${route ? `/${route}` : ""}${suffix.replace(/[\u0000-\u001f\u007f<>"\s]/g, "")}`;
    },
    asset(raw) {
      // The address of an image of this site, as the editor wrote it (with the mount path or the origin of the moment: only the end counts).
      const match = /(?:^|\/)s\/([a-z0-9-]{3,40})\/m\/([^/?#]+)$/.exec(raw.split(/[?#]/)[0] ?? "");
      if (!match || match[1] !== slug || !ID.test(match[2]!)) return null;
      return `${toMountRoot(depth)}s/${slug}/m/${match[2]!.toLowerCase()}`;
    },
  };
}
