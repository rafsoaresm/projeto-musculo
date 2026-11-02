import { getCloudflareContext } from "@opennextjs/cloudflare";
import { publicBuilderPage } from "@/db/builder-public";
import { sha256Hex } from "@/db/crypto";
import { publicTrackingBySlug } from "@/db/site-tracking";
import { notFoundDocument, publicDocument, PUBLIC_CSP } from "@/modules/frappe-site/public-page";
import { requestedRoute } from "@/modules/frappe-site/routes";
import { formsGate } from "@/modules/meu-site/inquiries";
import { publicPageCsp, toolsOf } from "@/modules/meu-site/tracking-csp";

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
  // The forms of the page are drawn only when the environment opened the public forms (and the site its own switch: the document checks it).
  const gate = formsGate(env, process.env);
  // The site's tagging (0.71), read at each request: with a tool on, the page loads the site's script and its policy lets that script and the
  // tools' hosts in; without one, the document and the policy are exactly what they were.
  const tracking = await publicTrackingBySlug(env.DB, slug);
  const html = publicDocument(found, path?.length ?? 0, gate.open ? gate.noticeUrl : null, tracking !== null);
  const policy = publicPageCsp(tracking && toolsOf(tracking));
  // The policy depends on the tools, the document only on whether there is one: the digest covers both when the site has tagging.
  const etag = `"${await sha256Hex(tracking ? `${html}\n${policy}` : html)}"`;
  const headers = { ...base, "Content-Security-Policy": policy, "Cache-Control": "public, no-cache", ETag: etag };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(html, { headers });
}
