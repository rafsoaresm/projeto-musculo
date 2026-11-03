import { requireStudent } from "@/modules/auth/server";
import { studentExportFor } from "@/db/student-export";
import { readableExport, readablePdfFileName } from "@/modules/pedidos/export-readable";
import { renderExportPdf } from "@/modules/pdf/export-pdf";

export const dynamic = "force-dynamic";

const refusal = (status: number, text: string) =>
  new Response(text, { status, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });

/**
 * "Baixar meus dados" as a PDF (slice 0.91): the same copy as the JSON, for the login that asks, under the
 * same trail and the same hourly limit. The student comes from the verified links of that login, never
 * from the address or a header.
 */
export async function GET() {
  const { db, user } = await requireStudent();
  const now = new Date();
  const outcome = await studentExportFor(db, user.id).generate(now);
  if (outcome.status === "rate_limited")
    return refusal(429, "Você já baixou os seus dados várias vezes na última hora. Tente de novo daqui a pouco.");
  if (outcome.status === "not_found") return refusal(404, "Página não encontrada.");
  const bytes = await renderExportPdf({ readable: readableExport(outcome.source), accountName: outcome.source.account.name });
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${readablePdfFileName(now)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
