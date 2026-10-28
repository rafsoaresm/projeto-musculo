import { getCloudflareContext } from "@opennextjs/cloudflare";
import { sha256Hex } from "@/db/crypto";
import { publishedSiteBySlug } from "@/db/sites";
import { publicCssImages } from "@/modules/meu-site/image-urls";
import { buildSiteCss } from "@/modules/meu-site/site-css";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/**
 * The stylesheet of a public page: made from the typed styles of the release the page's pointer names, and from nothing
 * else. No session. A page that is not published (never, or taken offline) answers the same 404 as an address that does not
 * exist. `no-cache` with the digest as ETag, so a new version or taking the page offline is seen at the next request and
 * an unchanged sheet costs a small answer.
 */
export async function GET(request: Request, { params }: Params) {
  const { slug } = await params;
  const { env } = await getCloudflareContext({ async: true });
  const site = await publishedSiteBySlug(env.DB, slug);
  if (!site) return new Response("Página não encontrada.", { status: 404, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Type": "text/plain; charset=utf-8" } });
  const css = buildSiteCss(site.content, publicCssImages(process.env.NEXT_PUBLIC_BASE_PATH || "", site.slug, site.images));
  const etag = `"${await sha256Hex(css)}"`;
  const headers = { "Cache-Control": "public, no-cache", ETag: etag, "X-Content-Type-Options": "nosniff" };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(css, { headers: { ...headers, "Content-Type": "text/css; charset=utf-8" } });
}
