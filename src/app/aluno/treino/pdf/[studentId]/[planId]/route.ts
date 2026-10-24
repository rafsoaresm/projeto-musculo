import { requireStudent } from "@/modules/auth/server";
import { recordPdfDownload } from "@/db/plan-documents";
import { studentTrainingFor } from "@/db/student-plan";
import { pdfFileName, renderPlanPdf } from "@/modules/pdf/plan-pdf";

export const dynamic = "force-dynamic";

/**
 * The newest delivered revision of one plan, for the login linked to that student. The student
 * comes from the verified links of the login: an address for somebody else's student is a 404.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ studentId: string; planId: string }> },
) {
  const { db, user, links } = await requireStudent();
  const { studentId, planId } = await params;
  const link = links.find((item) => item.studentId === studentId);
  const plan = link
    ? (await studentTrainingFor(db, user.id, link.studentId)).find((item) => item.planId === planId)
    : undefined;
  if (!link || !plan)
    return new Response("Página não encontrada.", {
      status: 404,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
    });
  const now = new Date();
  const bytes = await renderPlanPdf({
    studentName: link.studentName,
    organizationName: link.organizationName,
    plan,
    generatedAt: now,
  });
  await recordPdfDownload(
    db,
    { organizationId: link.organizationId, actorUserId: user.id, revisionId: plan.revisionId },
    now,
  );
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${pdfFileName(plan)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
