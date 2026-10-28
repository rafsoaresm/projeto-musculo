import { requireWorkspace } from "@/modules/auth/server";
import { getSiteMediaBucket } from "@/db/binding";
import { siteAssetsFor } from "@/db/site-assets";
import { IMAGE_REFUSAL_MESSAGE, MAX_IMAGE_BYTES } from "@/modules/meu-site/images";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });
const sameOriginRequest = (request: Request) => request.headers.get("x-site-request") === "1";

/**
 * The library of images of the professional's site: list it, and add to it. The organization and the person come from the
 * verified session; adding needs a header that a form on another site cannot send, so the request cannot be forged.
 * The file the browser sends is checked again here and stored without its metadata.
 */
export async function GET() {
  const { db, context } = await requireWorkspace();
  const bucket = await getSiteMediaBucket();
  return json({ available: bucket !== null, assets: await siteAssetsFor(db, bucket, context).list() });
}

export async function POST(request: Request) {
  if (!sameOriginRequest(request)) return json({ error: "Pedido não aceito." }, 400);
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_IMAGE_BYTES) return json({ error: IMAGE_REFUSAL_MESSAGE.TOO_LARGE }, 413);
  const { db, context } = await requireWorkspace();
  const bytes = new Uint8Array(await request.arrayBuffer());
  const result = await siteAssetsFor(db, await getSiteMediaBucket(), context).add(bytes);
  switch (result.status) {
    case "stored":
      return json({ asset: result.asset });
    case "invalid":
      return json({ error: IMAGE_REFUSAL_MESSAGE[result.reason] }, result.reason === "TOO_LARGE" ? 413 : 415);
    case "limit":
      return json({ error: "A biblioteca já tem 60 imagens. Remova alguma que não esteja em uso." }, 409);
    case "unavailable":
      return json({ error: "Imagens indisponíveis neste ambiente." }, 503);
    default:
      return json({ error: "Só o proprietário ou a gestão acrescentam imagens ao site." }, 403);
  }
}
