import { requireStudent } from "@/modules/auth/server";
import { recordReportDownload, studentAssessmentsFor } from "@/db/assessment-reports";
import { renderAssessmentPdf } from "@/modules/pdf/assessment-pdf";
import { reportFileName } from "@/modules/avaliacoes/v2/report";

export const dynamic = "force-dynamic";

/**
 * The report of one recorded Avaliação Física, for the login linked to that student (user's decision of 02/11/2026: the report goes to the
 * student too). The student comes from the verified links of the login: an address for somebody else's student or assessment is a 404.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ studentId: string; assessmentId: string }> }) {
  const { db, user, links } = await requireStudent();
  const { studentId, assessmentId } = await params;
  const link = links.find((item) => item.studentId === studentId);
  const source = link ? await studentAssessmentsFor(db, user.id, link.studentId).source(assessmentId) : null;
  if (!link || !source)
    return new Response("Página não encontrada.", {
      status: 404,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
    });
  const now = new Date();
  const bytes = await renderAssessmentPdf({ ...source, generatedAt: now });
  await recordReportDownload(db, { organizationId: link.organizationId, actorUserId: user.id, assessmentId }, now);
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${reportFileName(source.assessment)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
