import { getCloudflareContext } from "@opennextjs/cloudflare";
import { publicBuilderPage } from "@/db/builder-public";
import { sha256Hex } from "@/db/crypto";
import { codeDocument, codePolicy } from "@/modules/frappe-site/code";
import { codeOfPage } from "@/modules/frappe-site/public-page";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; page: string; n: string }> };

/** An address that is not a frame of a published page, a page that is not on the air and an unknown site all answer the same. */
const notFound = () =>
  new Response("Página não encontrada.", { status: 404, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" } });

/**
 * The document that a frame of free code shows (see frappe-site/code.ts): the code of one block of a PUBLISHED page, in a page of its own, with a
 * policy that walls it in. `sandbox allow-scripts` with no `allow-same-origin` makes this document an origin of its own, so the code it holds cannot read
 * a cookie or a storage of the site nor reach into the page that frames it; and it can fetch nothing unless the site opened the network (`codePolicy`).
 * The same policy holds when somebody opens this address directly, outside any frame. No session: what is shown is what is published, read by the
 * address of the site, the page and the position of the block.
 */
export async function GET(request: Request, { params }: Params) {
  const { slug, page, n } = await params;
  let name: string;
  try {
    name = decodeURIComponent(page);
  } catch {
    return notFound();
  }
  if (!/^[A-Za-z0-9_-]{1,140}$/.test(name) || !/^\d{1,2}$/.test(n)) return notFound();
  const { env } = await getCloudflareContext({ async: true });
  const found = await publicBuilderPage(env.DB, slug, "", name);
  if (!found) return notFound();
  const block = codeOfPage(found).find((entry) => entry.index === Number(n));
  if (!block) return notFound();
  const html = codeDocument(block.html);
  const etag = `"${await sha256Hex(`${found.codeExternalOpen ? "open" : "closed"}\n${html}`)}"`;
  const headers = {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": codePolicy(found.codeExternalOpen),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "public, no-cache",
    ETag: etag,
  };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(html, { headers });
}
