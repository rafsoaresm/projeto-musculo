import { requireStudent } from "@/modules/auth/server";
import { getPhotoBucket } from "@/db/binding";
import { studentAssessmentsFor } from "@/db/assessment-reports";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const text = (message: string, status: number) => new Response(message, { status, headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" } });

/**
 * Slice 0.86: the posture photo of one view of a recorded Avaliação Física, for the login linked to that student (user's decision of 03/11/2026:
 * "o aluno pode ver as próprias fotos"). Read only: there is no PUT or DELETE here. The student comes from the verified links of the login,
 * exactly like the student's PDF route; a draft, another student's assessment, an erased photo or an unknown view is a plain 404.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ studentId: string; assessmentId: string; view: string }> }) {
  const { db, user, links } = await requireStudent();
  const { studentId, assessmentId, view } = await params;
  const link = links.find((item) => item.studentId === studentId);
  if (!link) return text("Página não encontrada.", 404);
  let photo;
  try {
    photo = await studentAssessmentsFor(db, user.id, link.studentId).photo(await getPhotoBucket(), assessmentId, view);
  } catch (error) {
    // The storage is off here or failed to answer: 503, never the image of anyone else and never a bare 500.
    if (error instanceof Error && error.message === "PHOTO_STORAGE_UNAVAILABLE") return text("Armazenamento de fotos indisponível.", 503);
    throw error;
  }
  if (!photo) return text("Página não encontrada.", 404);
  return new Response(photo.body as unknown as BodyInit, {
    headers: { ...NO_STORE, "Content-Type": "image/jpeg", "Content-Length": String(photo.size), "Content-Disposition": "inline" },
  });
}
