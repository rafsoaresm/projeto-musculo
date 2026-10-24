import { requireWorkspace } from "@/modules/auth/server";
import { planDocumentsFor, recordPdfDownload } from "@/db/plan-documents";
import { pdfFileName, renderPlanPdf } from "@/modules/pdf/plan-pdf";

export const dynamic = "force-dynamic";

/**
 * The delivered revision as a PDF, for the professional who has the student under active
 * technical care. Anything that is not a delivered revision of that student is a plain 404.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; planId: string; revisionId: string }> },
) {
  const { db, context, user } = await requireWorkspace();
  const { id, planId, revisionId } = await params;
  const source = await planDocumentsFor(db, context).delivered(planId, revisionId);
  // The plan must belong to the student in the address, not just to this professional.
  if (!source || source.studentId !== id)
    return new Response("Página não encontrada.", {
      status: 404,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
    });
  const now = new Date();
  const bytes = await renderPlanPdf({
    studentName: source.studentName,
    organizationName: source.organizationName,
    plan: source.plan,
    generatedAt: now,
  });
  await recordPdfDownload(
    db,
    { organizationId: context.organizationId, actorUserId: user.id, revisionId },
    now,
  );
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${pdfFileName(source.plan)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
