import Link from "next/link";
import { Pill } from "@/components/ui";
import type { PlanOverviewRow } from "@/db/plans";
import { formatCalendarDate } from "@/modules/training/format";
import { stateLabel } from "./labels";

/** The newest revision of each plan and what is still missing from its prescription. */
export function PlanTable({ rows }: { rows: PlanOverviewRow[] }) {
  return (
    <div className="table-wrap">
      <table className="data-table stack">
        <caption className="sr-only">Planos e prescrição dos seus alunos</caption>
        <thead>
          <tr>
            <th scope="col">Aluno</th>
            <th scope="col">Plano</th>
            <th scope="col">Revisão</th>
            <th scope="col">Período</th>
            <th scope="col" className="num">
              Exercícios
            </th>
            <th scope="col">Pendências</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const label = stateLabel(row.state);
            return (
              <tr key={row.revisionId}>
                <th scope="row" data-label="Aluno">
                  <Link className="row-link" href={`/profissional/alunos/${row.studentId}`}>
                    {row.studentName}
                  </Link>
                </th>
                <td data-label="Plano">
                  <Link
                    className="row-link"
                    href={`/profissional/alunos/${row.studentId}/planos/${row.planId}/${row.revisionId}`}
                  >
                    {row.title}
                  </Link>
                </td>
                <td data-label="Revisão">
                  {row.revisionNumber} <Pill tone={label.tone}>{label.text}</Pill>
                </td>
                <td data-label="Período">
                  {formatCalendarDate(row.startDate)} a {formatCalendarDate(row.endDate)}
                </td>
                <td className="num" data-label="Exercícios">
                  {row.exercises}
                </td>
                <td data-label="Pendências">
                  {row.below > 0 ? (
                    <Pill tone="warning">
                      {row.below} de {row.workouts} treinos abaixo do alvo
                    </Pill>
                  ) : (
                    <Pill tone="success">Alvo atendido em todos os treinos</Pill>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
