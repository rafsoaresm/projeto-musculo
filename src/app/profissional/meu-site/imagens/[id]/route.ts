import { requireWorkspace } from "@/modules/auth/server";
import { getSiteMediaBucket } from "@/db/binding";
import { siteAssetsFor } from "@/db/site-assets";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const NO_STORE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });
const notFound = () => new Response("Imagem não encontrada.", { status: 404, headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" } });

/**
 * One image of the library, for the editor and the preview: only to a login that reads this organization's site. The
 * public page does not use this address; its images come from the public route, and only when a published version uses them.
 */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const { db, context } = await requireWorkspace();
  const image = await siteAssetsFor(db, await getSiteMediaBucket(), context).read(id);
  if (!image) return notFound();
  return new Response(image.body as unknown as BodyInit, {
    headers: {
      ...NO_STORE,
      "Content-Type": image.contentType,
      "Content-Length": String(image.bytes),
      "Content-Disposition": "inline",
      // Whatever it is, it is not a document: nothing in it runs.
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}

export async function DELETE(request: Request, { params }: Params) {
  if (request.headers.get("x-site-request") !== "1") return json({ error: "Pedido não aceito." }, 400);
  const { id } = await params;
  const { db, context } = await requireWorkspace();
  const result = await siteAssetsFor(db, await getSiteMediaBucket(), context).remove(id);
  switch (result.status) {
    case "removed":
      return json({ removed: true });
    case "in_draft":
      return json({ error: "A imagem está em uso no rascunho. Tire-a da página e salve antes de remover." }, 409);
    case "published":
      return json({ error: "Uma versão publicada usou esta imagem e não muda: ela fica na biblioteca." }, 409);
    default:
      return notFound();
  }
}
