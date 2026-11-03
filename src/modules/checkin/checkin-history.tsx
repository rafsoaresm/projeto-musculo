import { Pill, formatDateTime } from "@/components/ui";
import type { CheckinRow } from "@/db/student-checkins";
import { formatCalendarDate } from "@/modules/training/format";
import { todayInBrazil } from "@/modules/execucao/contracts";
import { RECOVERY_LABELS } from "./contracts";

/**
 * Check-ins as the student said them, newest first. Facts only: no verdict, no color by value, no
 * "good" or "bad". Each check-in shows the questions it was answered with (its own version, not the
 * current one); a question left blank reads "sem resposta", never a number. `audience` only changes
 * who is addressed.
 */
export function CheckinHistory({
  rows,
  audience,
  newReplies,
  renderRowAction,
}: {
  rows: CheckinRow[];
  audience: "student" | "professional";
  /** Ids of check-ins with a reply the student has not seen yet. */
  newReplies?: ReadonlySet<string>;
  renderRowAction?: (row: CheckinRow) => React.ReactNode;
}) {
  if (rows.length === 0)
    return (
      <p className="muted">
        {audience === "student"
          ? "Você ainda não fez nenhum check-in."
          : "O aluno ainda não fez nenhum check-in."}
      </p>
    );
  return (
    <ul className="plan-list checkin-list">
      {rows.map((row) => {
        const scales = [
          row.form.askEffort && `Esforço percebido: ${row.effort === null ? "não informado" : `${row.effort} de 10`}`,
          row.form.askRecovery &&
            `Recuperação: ${row.recovery === null ? "não informada" : (RECOVERY_LABELS[row.recovery] ?? "não informada")}`,
        ].filter(Boolean);
        const madeOn = todayInBrazil(new Date(row.createdAt));
        return (
          <li key={row.id} className="checkin-item">
            <div className="checkin-head">
              <strong>{formatCalendarDate(row.checkedOn)}</strong>
              {row.discomfort && <Pill tone="warning">Relato de desconforto</Pill>}
              {row.acknowledgedAt && (
                <Pill tone="success">
                  {audience === "student" ? "Lido pelo seu profissional" : "Lido"} em{" "}
                  {formatCalendarDate(row.acknowledgedAt.slice(0, 10))}
                </Pill>
              )}
              {newReplies?.has(row.id) && <Pill tone="brand">Nova resposta</Pill>}
            </div>
            {madeOn !== row.checkedOn && (
              <p className="small muted">Registrado depois, em {formatCalendarDate(madeOn)}.</p>
            )}
            {scales.length > 0 && <p className="small">{scales.join(" · ")}</p>}
            {row.discomfort && row.discomfortNotes && <p className="small">Desconforto: {row.discomfortNotes}</p>}
            {row.notes && <p className="small">Observações: {row.notes}</p>}
            {row.form.questions.length > 0 && (
              <dl className="checkin-answers">
                {row.form.questions.map((question) => {
                  const answer = row.answers.find((item) => item.questionId === question.id)?.answer ?? null;
                  return (
                    <div key={question.id}>
                      <dt>{question.text}</dt>
                      <dd className={answer === null ? "muted" : undefined}>{answer ?? "Sem resposta"}</dd>
                    </div>
                  );
                })}
              </dl>
            )}
            {audience === "professional" && row.formVersion !== null && (
              <p className="small muted">Respondido com as perguntas da versão {row.formVersion}.</p>
            )}
            {row.replies.length > 0 && (
              <ol className="checkin-replies" aria-label="Respostas do profissional">
                {row.replies.map((reply) => (
                  <li key={reply.id}>
                    <p className="small checkin-reply-meta">
                      <strong>{reply.authorName ?? "Profissional"}</strong> respondeu em {formatDateTime(reply.createdAt)}
                    </p>
                    <p className="checkin-reply-body">{reply.body}</p>
                  </li>
                ))}
              </ol>
            )}
            {renderRowAction?.(row)}
          </li>
        );
      })}
    </ul>
  );
}
