import Link from "next/link";
import { Pill } from "@/components/ui";
import type { ExecutionRow } from "@/db/workout-sessions";
import { formatCalendarDate } from "@/modules/training/format";

/** What the student logged, in a short list on the student page. Read only. */
export function ExecutionPanel({ studentId, rows }: { studentId: string; rows: ExecutionRow[] }) {
  const unread = rows.filter((row) => row.painReported && !row.acknowledgedAt).length;
  return (
    <section className="panel" aria-labelledby="execucao-aluno">
      <p className="eyebrow">EXECUÇÃO DOS TREINOS</p>
      <h2 id="execucao-aluno">
        O que o aluno registrou {unread > 0 && <Pill tone="warning">{unread} relato{unread > 1 ? "s" : ""} de dor sem leitura</Pill>}
      </h2>
      <p className="muted">
        Cargas, repetições, esforço e relatos de dor que o aluno anotou depois de treinar. É o diário do
        aluno: não altera a prescrição.
      </p>
      {rows.length === 0 ? (
        <p>O aluno ainda não registrou nenhum treino.</p>
      ) : (
        <>
          <ul className="plan-list">
            {rows.slice(0, 5).map((row) => (
              <li key={row.id}>
                <Link className="account-link" href={`/profissional/alunos/${studentId}/execucao/${row.id}`}>
                  {formatCalendarDate(row.performedOn)} · treino {row.workoutLabel}, fase {row.phaseIndex}
                </Link>{" "}
                {row.painReported && <Pill tone="warning">Relato de dor</Pill>}{" "}
                {row.acknowledgedAt && <Pill tone="success">Lido</Pill>}
              </li>
            ))}
          </ul>
          <p>
            <Link className="account-link" href={`/profissional/alunos/${studentId}/execucao`}>
              Ver todos os registros
            </Link>
          </p>
        </>
      )}
    </section>
  );
}
