import { checkinsFor } from "@/db/student-checkins";
import type { AuthenticatedContext } from "@/db/students";
import type { D1Database } from "@cloudflare/workers-types";
import { formatDate } from "@/components/ui";
import { AcknowledgeCheckinForm } from "./acknowledge-form";
import { CheckinHistory } from "./checkin-history";
import { CheckinFormEditor } from "./form-editor";
import { ReplyCheckinForm } from "./reply-form";

/**
 * What the student said in their check-ins, for the professional with an active technical
 * assignment over them. Facts only; the ones not read yet carry the form to register the reading,
 * every one can be replied to, and the professional chooses what the next check-ins ask.
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
  const repository = checkinsFor(db, context);
  const [rows, current] = await Promise.all([repository.list(studentId, 14), repository.form(studentId)]);
  return (
    <>
      <section className="panel" id="checkins" aria-labelledby="checkins-aluno">
        <p className="eyebrow">CHECK-INS</p>
        <h2 id="checkins-aluno">Check-ins do aluno</h2>
        <p className="muted">
          O que o aluno disse, do jeito que ele disse, com as perguntas com que cada check-in foi respondido. A
          ferramenta não pontua, não avisa por conta própria e não muda o treino por causa de um check-in.
        </p>
        <CheckinHistory
          rows={rows}
          audience="professional"
          renderRowAction={(row) => (
            <>
              {row.acknowledgedAt === null && <AcknowledgeCheckinForm checkinId={row.id} />}
              <ReplyCheckinForm checkinId={row.id} replied={row.replies.length > 0} />
            </>
          )}
        />
      </section>
      {current && (
        <section className="panel" aria-labelledby="checkin-perguntas">
          <p className="eyebrow">CHECK-IN</p>
          <h2 id="checkin-perguntas">Perguntas do check-in</h2>
          <p className="muted">
            O que este aluno responde nos próximos check-ins.
            {current.createdAt && ` Última mudança em ${formatDate(current.createdAt)}.`}
          </p>
          <CheckinFormEditor studentId={studentId} form={current.form} version={current.version} />
        </section>
      )}
    </>
  );
}
