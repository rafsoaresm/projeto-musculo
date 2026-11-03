import type { Metadata } from "next";
import { Fragment } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { requireStudent } from "@/modules/auth/server";
import { studentAssessmentsFor } from "@/db/assessment-reports";
import { PageHeading, Pill } from "@/components/ui";
import { formatCalendarDate } from "@/modules/training/format";
import { ASSESSMENT_NAME, assessmentKindLabel } from "@/modules/avaliacoes/names";
import { REPORT_NOTICE } from "@/modules/avaliacoes/v2/report";
import { ResultsEvolution } from "@/modules/avaliacoes/v2/results-evolution";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `${ASSESSMENT_NAME} · Área do aluno` };

/**
 * The recorded Avaliações Físicas of the student, each with its report in PDF (user's decision of 02/11/2026: the report goes to the professional
 * and to the student; no lock, decision of 03/11/2026). Drafts never appear; the earlier format has no report. Slice 0.84: below the list, the
 * results of those assessments over time, in the same comparable series as the professional's page (0.82), read only.
 */
export default async function StudentAssessmentsPage() {
  const { db, user, links } = await requireStudent();
  // The students come from the verified links of this login, never from the address.
  const perStudent = await Promise.all(
    links.map(async (link) => {
      const mine = studentAssessmentsFor(db, user.id, link.studentId);
      const [items, evolution] = await Promise.all([mine.list(), mine.evolution()]);
      return { link, items, evolution };
    }),
  );
  const any = perStudent.some((entry) => entry.items.length > 0);
  return (
    <>
      <PageHeading
        eyebrow="ÁREA DO ALUNO"
        title={ASSESSMENT_NAME}
        description="As avaliações que o seu profissional registrou, com o relatório em PDF e os resultados ao longo do tempo."
      />
      {!any && (
        <section className="panel">
          <h2>Nenhuma avaliação física registrada ainda.</h2>
          <p>Quando o seu profissional finalizar uma avaliação física, o relatório aparece aqui. Rascunhos nunca chegam até você.</p>
        </section>
      )}
      {perStudent.map(({ link, items, evolution }) =>
        items.length === 0 ? null : (
          <Fragment key={link.studentId}>
            <section className="panel" aria-labelledby={`avaliacoes-${link.studentId}`}>
              <h2 id={`avaliacoes-${link.studentId}`}>
                {links.length > 1 ? `${link.organizationName} · ${link.studentName}` : "Avaliações registradas"}
              </h2>
              <p className="muted small">{REPORT_NOTICE} O relatório traz o que foi medido e registrado, com o método de cada resultado.</p>
              <div className="table-wrap">
                <table className="data-table stack">
                  <caption className="sr-only">Avaliações físicas registradas</caption>
                  <thead>
                    <tr>
                      <th scope="col">Data</th>
                      <th scope="col">Tipo</th>
                      <th scope="col">Situação</th>
                      <th scope="col">Relatório</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id}>
                        <th scope="row" data-label="Data">
                          {formatCalendarDate(item.assessedOn)}
                        </th>
                        <td data-label="Tipo">{assessmentKindLabel({ kind: item.kind, formatVersion: 2, amendsAssessmentId: item.amendsAssessmentId })}</td>
                        <td data-label="Situação">
                          {item.amendedById ? <Pill tone="warning">Retificada</Pill> : <Pill tone="neutral">Registrada</Pill>}
                        </td>
                        <td data-label="Relatório">
                          <Link
                            className="button secondary small av2-report-button"
                            href={`/aluno/avaliacoes/pdf/${link.studentId}/${item.id}`}
                            download
                            prefetch={false}
                            aria-label={`Baixar PDF da avaliação de ${formatCalendarDate(item.assessedOn)}`}
                          >
                            <Download size={16} /> Baixar PDF
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            {evolution.length > 0 && (
              <ResultsEvolution
                history={evolution}
                headingId={`resultados-${link.studentId}`}
                heading={links.length > 1 ? `Resultados ao longo do tempo · ${link.studentName}` : "Resultados ao longo do tempo"}
              />
            )}
          </Fragment>
        ),
      )}
    </>
  );
}
