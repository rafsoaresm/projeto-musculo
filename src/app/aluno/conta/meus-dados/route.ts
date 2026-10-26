import { requireStudent } from "@/modules/auth/server";
import { studentExportFor } from "@/db/student-export";
import { exportFileName, serializeExport } from "@/modules/pedidos/export";

export const dynamic = "force-dynamic";

const refusal = (status: number, text: string) =>
  new Response(text, { status, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });

/**
 * A copy of what the tool shows the student, for the login that asks. The student comes from the
 * verified links of that login, never from the address or a header.
 */
export async function GET() {
  const { db, user } = await requireStudent();
  const now = new Date();
  const outcome = await studentExportFor(db, user.id).generate(now);
  if (outcome.status === "rate_limited")
    return refusal(429, "Você já baixou os seus dados várias vezes na última hora. Tente de novo daqui a pouco.");
  if (outcome.status === "not_found") return refusal(404, "Página não encontrada.");
  return new Response(serializeExport(outcome.document), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFileName(now)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
