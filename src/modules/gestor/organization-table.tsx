import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Pill, formatDate } from "@/components/ui";
import type { OrganizationRow } from "@/db/platform";

/** Shared by the real manager area and the demonstration. */
export function OrganizationTable({
  rows,
  hrefFor,
  caption,
}: {
  rows: OrganizationRow[];
  /** Omit to render rows without a detail link. */
  hrefFor?: (row: OrganizationRow) => string;
  caption: string;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table stack">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Organização</th>
            <th scope="col">Responsável</th>
            <th scope="col" className="num">
              Profissionais
            </th>
            <th scope="col" className="num">
              Alunos
            </th>
            <th scope="col" className="num">
              Acessos de aluno
            </th>
            <th scope="col">Situação</th>
            <th scope="col">Criada em</th>
            {hrefFor && (
              <th scope="col">
                <span className="sr-only">Detalhes</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <th scope="row" data-label="Organização">{row.name}</th>
              <td data-label="Responsável">
                {row.ownerName ?? "—"}
                {row.ownerEmail && (
                  <small className="cell-sub">{row.ownerEmail}</small>
                )}
              </td>
              <td className="num" data-label="Profissionais">{row.members}</td>
              <td className="num" data-label="Alunos">{row.students}</td>
              <td className="num" data-label="Acessos de aluno">{row.portalAccesses}</td>
              <td data-label="Situação">
                {row.blockedMembers > 0 ? (
                  <Pill tone="danger">
                    {row.blockedMembers === 1
                      ? "1 acesso bloqueado"
                      : `${row.blockedMembers} acessos bloqueados`}
                  </Pill>
                ) : (
                  <Pill tone="success">Ativa</Pill>
                )}
              </td>
              <td data-label="Criada em">{formatDate(row.createdAt)}</td>
              {hrefFor && (
                <td>
                  <Link
                    className="row-link"
                    href={hrefFor(row)}
                    aria-label={`Ver detalhes de ${row.name}`}
                  >
                    Ver <ArrowRight size={15} />
                  </Link>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
