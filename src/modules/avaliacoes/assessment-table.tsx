import Link from "next/link";
import { Pill } from "@/components/ui";
import type { StudentAssessmentRow } from "@/db/assessments";
import { formatCalendarDate } from "@/modules/training/format";
import { ScreeningPill } from "./screening-pill";

/** Every student with the newest recorded assessment. Alerts without a review come first. */
export function AssessmentTable({ rows }: { rows: StudentAssessmentRow[] }) {
  return (
    <div className="table-wrap">
      <table className="data-table stack">
        <caption className="sr-only">Avaliações dos seus alunos</caption>
        <thead>
          <tr>
            <th scope="col">Aluno</th>
            <th scope="col">Última avaliação</th>
            <th scope="col">Triagem</th>
            <th scope="col">Rascunho</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.studentId}>
              <th scope="row" data-label="Aluno">
                <Link className="row-link" href={`/profissional/alunos/${row.studentId}/avaliacoes`}>
                  {row.studentName}
                </Link>
              </th>
              <td data-label="Última avaliação">
                {row.assessedOn && row.assessmentId ? (
                  <Link className="row-link" href={`/profissional/alunos/${row.studentId}/avaliacoes/${row.assessmentId}`}>
                    {formatCalendarDate(row.assessedOn)}
                  </Link>
                ) : (
                  "Nenhuma"
                )}
              </td>
              <td data-label="Triagem">
                {row.riskStatus ? (
                  <ScreeningPill risk={row.riskStatus} reviewed={row.reviewed} />
                ) : (
                  <Pill tone="neutral">Sem triagem registrada</Pill>
                )}
              </td>
              <td data-label="Rascunho">
                {row.draftId ? (
                  <Link className="row-link" href={`/profissional/alunos/${row.studentId}/avaliacoes/${row.draftId}`}>
                    Continuar
                  </Link>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
