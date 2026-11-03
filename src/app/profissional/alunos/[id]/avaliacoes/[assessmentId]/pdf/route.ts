import { requireWorkspace } from "@/modules/auth/server";
import { assessmentReportsFor, recordReportDownload } from "@/db/assessment-reports";
import { photoBucketOrNull } from "@/db/binding";
import { renderAssessmentPdf } from "@/modules/pdf/assessment-pdf";
import { reportFileName } from "@/modules/avaliacoes/v2/report";

export const dynamic = "force-dynamic";

/**
 * The report of a recorded Avaliação Física as a PDF, for the professional who has the student under active technical care. A draft, an
 * assessment of the earlier format, another student's or another organization's is a plain 404.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; assessmentId: string }> }) {
  const { db, context, user } = await requireWorkspace();
  const { id, assessmentId } = await params;
  const source = await assessmentReportsFor(db, context).source(id, assessmentId, await photoBucketOrNull());
  if (!source)
    return new Response("Página não encontrada.", {
      status: 404,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
    });
  const now = new Date();
  const bytes = await renderAssessmentPdf({ ...source, generatedAt: now });
  await recordReportDownload(db, { organizationId: context.organizationId, actorUserId: user.id, assessmentId }, now);
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${reportFileName(source.assessment)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
