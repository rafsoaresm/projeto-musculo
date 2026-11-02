import { getCloudflareContext } from "@opennextjs/cloudflare";
import { sha256Hex } from "@/db/crypto";
import { publicTrackingBySlug } from "@/db/site-tracking";
import { scriptConfig } from "@/modules/meu-site/tracking";
import { trackingScript } from "@/modules/meu-site/tracking-script";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/**
 * The script of a site with tagging (Meu Site 0.71), for both editors and the thank-you pages: the consent banner, the loader of the tools and the
 * events, with this site's settings embedded (public identifiers only). No session. An address that does not exist and a site with no tool on
 * answer the same 404. A static segment beside `m/[assetId]` (an image id is a UUID, so "rastreio" is never one). `no-cache` with the digest as
 * ETag: a change in the panel is seen at the next page, and an unchanged script costs a small answer.
 */
export async function GET(request: Request, { params }: Params) {
  const { slug } = await params;
  const { env } = await getCloudflareContext({ async: true });
  const settings = await publicTrackingBySlug(env.DB, slug);
  if (!settings) {
    return new Response("Não encontrado.", { status: 404, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Type": "text/plain; charset=utf-8" } });
  }
  const body = trackingScript(scriptConfig(slug, settings));
  const etag = `"${await sha256Hex(body)}"`;
  const headers = { "Cache-Control": "public, no-cache", ETag: etag, "X-Content-Type-Options": "nosniff" };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(body, { headers: { ...headers, "Content-Type": "text/javascript; charset=utf-8" } });
}
