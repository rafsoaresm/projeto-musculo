import { checkinsFor } from "@/db/student-checkins";
import type { AuthenticatedContext } from "@/db/students";
import type { D1Database } from "@cloudflare/workers-types";
import { AcknowledgeCheckinForm } from "./acknowledge-form";
import { CheckinHistory } from "./checkin-history";

/**
 * What the student said in their check-ins, for the professional with an active technical
 * assignment over them. Facts only; the ones not read yet carry the form to register the reading.
 */
export async function CheckinPanel({
  db,
  context,
  studentId,
}: {
  db: D1Database;
  context: AuthenticatedContext;
  studentId: string;
}) {
  const rows = await checkinsFor(db, context).list(studentId, 14);
  return (
    <section className="panel" id="checkins" aria-labelledby="checkins-aluno">
      <p className="eyebrow">CHECK-INS</p>
      <h2 id="checkins-aluno">Check-ins do aluno</h2>
      <p className="muted">
        O que o aluno disse sobre esforço, recuperação e desconforto, do jeito que ele disse. A ferramenta
        não pontua, não avisa por conta própria e não muda o treino por causa de um check-in.
      </p>
      <CheckinHistory
        rows={rows}
        audience="professional"
        renderRowAction={(row) => (row.acknowledgedAt === null ? <AcknowledgeCheckinForm checkinId={row.id} /> : null)}
      />
    </section>
  );
}
