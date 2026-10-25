import { requireWorkspace } from "@/modules/auth/server";
import { getPhotoBucket } from "@/db/binding";
import { assessmentPhotosFor } from "@/db/assessment-photos";
import { MAX_PHOTO_BYTES } from "@/modules/avaliacoes/photos";
import { PHOTO_DENIAL_MESSAGE } from "@/modules/consentimento/photo-authorization";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; assessmentId: string; view: string }> };

const NO_STORE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const text = (message: string, status: number) =>
  new Response(message, { status, headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" } });
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: NO_STORE });

/**
 * The postural photo of one view. Reading and changing it need the professional's own session
 * and an active technical assignment over the student; anything else is a plain 404. Changing
 * needs a header that a form on another site cannot send, so the request cannot be forged.
 */
async function photos() {
  const { db, context } = await requireWorkspace();
  try {
    return { repo: assessmentPhotosFor(db, await getPhotoBucket(), context) };
  } catch (error) {
    if (error instanceof Error && error.message === "PHOTO_STORAGE_UNAVAILABLE") return { repo: null };
    throw error;
  }
}
const sameOriginRequest = (request: Request) => request.headers.get("x-photo-request") === "1";

export async function GET(_request: Request, { params }: Params) {
  const { id, assessmentId, view } = await params;
  const { repo } = await photos();
  if (!repo) return text("Armazenamento de fotos indisponível.", 503);
  const photo = await repo.read(assessmentId, view);
  // The assessment must belong to the student in the address, not just to this professional.
  if (!photo || photo.studentId !== id) return text("Página não encontrada.", 404);
  return new Response(photo.body as unknown as BodyInit, {
    headers: {
      ...NO_STORE,
      "Content-Type": "image/jpeg",
      "Content-Length": String(photo.size),
      "Content-Disposition": "inline",
    },
  });
}

export async function PUT(request: Request, { params }: Params) {
  if (!sameOriginRequest(request)) return text("Pedido não aceito.", 400);
  const { assessmentId, view } = await params;
  const { repo } = await photos();
  if (!repo) return text("Armazenamento de fotos indisponível.", 503);
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_PHOTO_BYTES) return text("A foto é grande demais.", 413);
  const body = new Uint8Array(await request.arrayBuffer());
  const result = await repo.put(assessmentId, view, body);
  switch (result.status) {
    case "stored":
      return json({ stored: true, replaced: result.replaced });
    case "consent_required":
      return json({ error: PHOTO_DENIAL_MESSAGE[result.reason] }, 403);
    case "minor":
      return json({ error: "Fotos de menores de idade não são suportadas pela ferramenta." }, 422);
    case "invalid":
      return json(
        {
          error:
            result.reason === "TOO_LARGE"
              ? "A foto é grande demais."
              : result.reason === "VIEW"
                ? "Vista inválida."
                : "A foto precisa ser uma imagem JPEG válida.",
        },
        result.reason === "TOO_LARGE" ? 413 : result.reason === "VIEW" ? 404 : 415,
      );
    default:
      return text("Página não encontrada.", 404);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  if (!sameOriginRequest(request)) return text("Pedido não aceito.", 400);
  const { assessmentId, view } = await params;
  const { repo } = await photos();
  if (!repo) return text("Armazenamento de fotos indisponível.", 503);
  const result = await repo.remove(assessmentId, view);
  return result.status === "removed" ? json({ removed: true }) : text("Página não encontrada.", 404);
}
