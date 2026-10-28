import { getCloudflareContext } from "@opennextjs/cloudflare";
import { publishedAssetBySlug } from "@/db/site-assets";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; assetId: string }> };

/**
 * An image of a public page. No session, no cookie read: it is served only if the version the page's pointer names uses
 * it. An unknown address, an image that was only uploaded or only in a draft, a page taken offline and the image of
 * another site all answer the same 404. The bucket has no public address (the platform has no public buckets); this route
 * is the only way out. `no-cache` with the digest as ETag, so taking a page offline stops its images at the next request
 * and an unchanged image costs a small answer. Nothing in the file can run: it is sent as an image, with no sniffing.
 */
export async function GET(request: Request, { params }: Params) {
  const { slug, assetId } = await params;
  const { env } = await getCloudflareContext({ async: true });
  const image = await publishedAssetBySlug(env.DB, env.SITE_MEDIA ?? null, slug, assetId);
  if (!image) return new Response("Imagem não encontrada.", { status: 404, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Type": "text/plain; charset=utf-8" } });
  const etag = `"${image.sha256}"`;
  const headers = {
    "Cache-Control": "public, no-cache",
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
  if (request.headers.get("if-none-match") === etag) {
    await image.body.cancel();
    return new Response(null, { status: 304, headers });
  }
  return new Response(image.body as unknown as BodyInit, {
    headers: { ...headers, "Content-Type": image.contentType, "Content-Length": String(image.bytes), "Content-Disposition": "inline" },
  });
}
