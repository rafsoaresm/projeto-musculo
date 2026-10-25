import { Pill } from "@/components/ui";
import type { CheckinRow } from "@/db/student-checkins";
import { formatCalendarDate } from "@/modules/training/format";
import { RECOVERY_LABELS } from "./contracts";

/**
 * Check-ins as the student said them, newest first. Facts only: no verdict, no color by value, no
 * "good" or "bad". `audience` only changes who is addressed.
 */
export function CheckinHistory({
  rows,
  audience,
  renderRowAction,
}: {
  rows: CheckinRow[];
  audience: "student" | "professional";
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
      {rows.map((row) => (
        <li key={row.id}>
          <div>
            <strong>{formatCalendarDate(row.checkedOn)}</strong>{" "}
            {row.discomfort && <Pill tone="warning">Relato de desconforto</Pill>}{" "}
            {row.acknowledgedAt && (
              <Pill tone="success">
                {audience === "student" ? "Lido pelo seu profissional" : "Lido"} em{" "}
                {formatCalendarDate(row.acknowledgedAt.slice(0, 10))}
              </Pill>
            )}
          </div>
          <p className="small">
            Esforço percebido: {row.effort === null ? "não informado" : `${row.effort} de 10`} · Recuperação:{" "}
            {row.recovery === null ? "não informada" : RECOVERY_LABELS[row.recovery]}
          </p>
          {row.discomfort && row.discomfortNotes && <p className="small">Desconforto: {row.discomfortNotes}</p>}
          {row.notes && <p className="small">Observações: {row.notes}</p>}
          {renderRowAction?.(row)}
        </li>
      ))}
    </ul>
  );
}
