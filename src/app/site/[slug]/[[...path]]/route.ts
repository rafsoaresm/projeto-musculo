import { getCloudflareContext } from "@opennextjs/cloudflare";
import { publicBuilderPage } from "@/db/builder-public";
import { sha256Hex } from "@/db/crypto";
import { notFoundDocument, publicDocument, PUBLIC_CSP } from "@/modules/frappe-site/public-page";
import { requestedRoute } from "@/modules/frappe-site/routes";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; path?: string[] }> };

const base = { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": PUBLIC_CSP, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin" };

/**
 * A page published from the embedded editor, as a document of its own (no layout of the tool around it). No session: what is shown is what the
 * editor says is published, read by the address of the site and the route of the page. An address that does not exist, a page that is not
 * published and a route that cannot name a page answer the same 404. `no-cache` with the digest as ETag: taking a page offline or publishing a
 * change is seen at the next request, and an unchanged page costs a small answer.
 */
export async function GET(request: Request, { params }: Params) {
  const { slug, path } = await params;
  const route = requestedRoute(path);
  const notFound = () => new Response(notFoundDocument(), { status: 404, headers: { ...base, "Cache-Control": "no-store" } });
  if (route === null) return notFound();
  const { env } = await getCloudflareContext({ async: true });
  const found = await publicBuilderPage(env.DB, slug, route);
  if (!found) return notFound();
  const html = publicDocument(found, path?.length ?? 0);
  const etag = `"${await sha256Hex(html)}"`;
  const headers = { ...base, "Cache-Control": "public, no-cache", ETag: etag };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(html, { headers });
}
