import Link from "next/link";
import { Pill } from "@/components/ui";
import type { AssessmentSummary } from "@/db/assessments";
import { formatCalendarDate } from "@/modules/training/format";
import { StartAssessmentButton } from "./start-button";
import { ScreeningPill } from "./screening-pill";
import { ASSESSMENT_NAME, assessmentTitle } from "./names";
import { formatResult, methodLabel } from "./v2/review";

/**
 * The Avaliação Física of one student: the open draft, the recorded ones (newest first; those of the earlier format stay readable, under their
 * own name) and the way to start the next one. An open draft of the earlier format can no longer be filled, only discarded.
 */
export function AssessmentsPanel({ studentId, assessments }: { studentId: string; assessments: AssessmentSummary[] }) {
  const draft = assessments.find((item) => item.state === "DRAFT");
  const recorded = assessments.filter((item) => item.state === "RECORDED");
  const draftHref = draft && `/profissional/alunos/${studentId}/avaliacoes/${draft.id}`;
  const earlierDraft = draft !== undefined && draft.formatVersion === null;
  return (
    <section className="panel" aria-labelledby="avaliacoes-aluno">
      <p className="eyebrow">AVALIAÇÃO FÍSICA</p>
      <h2 id="avaliacoes-aluno">{ASSESSMENT_NAME}</h2>
      <p className="muted">
        Cada avaliação física é um registro com data: triagem, medidas, movimento e revisão. Uma avaliação registrada não muda; a reavaliação é
        um novo registro.
      </p>
      {assessments.length === 0 ? (
        <p>Este aluno ainda não tem avaliação física. Sem triagem registrada, a aprovação de um plano pede o seu aviso de ciência.</p>
      ) : (
        <>
          {draft && draftHref && (
            <ul className="plan-list">
              <li>
                <Link className="account-link" href={draftHref}>
                  {earlierDraft ? "Rascunho do formato anterior" : draft.amendsAssessmentId ? "Rascunho da retificação" : "Rascunho"} de{" "}
                  {formatCalendarDate(draft.assessedOn)}
                </Link>{" "}
                <Pill tone="neutral">{earlierDraft ? "Só pode ser descartado" : "Em edição"}</Pill>
              </li>
            </ul>
          )}
          {recorded.length > 0 && (
            <div className="table-wrap">
              <table className="data-table stack assessment-history">
                <caption className="sr-only">Histórico de avaliações físicas</caption>
                <thead>
                  <tr>
                    <th scope="col">Avaliação</th>
                    <th scope="col">Triagem</th>
                    <th scope="col">Gordura estimada</th>
                    <th scope="col">IMC</th>
                  </tr>
                </thead>
                <tbody>
                  {recorded.map((item) => {
                    const fat = item.results.find((result) => result.code === "body_fat_percent");
                    const index = item.results.find((result) => result.code === "bmi");
                    return (
                      <tr key={item.id}>
                        <th scope="row" data-label="Avaliação">
                          <Link className="row-link" href={`/profissional/alunos/${studentId}/avaliacoes/${item.id}`}>
                            {assessmentTitle(item)} de {formatCalendarDate(item.assessedOn)}
                          </Link>
                          {item.amendedById && (
                            <>
                              {" "}
                              <Pill tone="neutral">Retificada</Pill>
                            </>
                          )}
                        </th>
                        <td data-label="Triagem">
                          <ScreeningPill risk={item.riskStatus} reviewed={item.reviewed} parq={item.formatVersion === 2} />
                        </td>
                        <td data-label="Gordura estimada">
                          {fat && fat.value !== null ? (
                            <>
                              {formatResult(fat.code, fat.value, fat.unit)} <span className="small muted">({methodLabel(fat.method)})</span>
                            </>
                          ) : (
                            <span className="muted">Não calculada</span>
                          )}
                        </td>
                        <td data-label="IMC">
                          {index && index.value !== null ? formatResult(index.code, index.value, index.unit) : <span className="muted">Não calculado</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {recorded.length > 0 && (
        <p>
          <Link className="account-link" href={`/profissional/alunos/${studentId}/evolucao`}>
            Ver a evolução ao longo do tempo
          </Link>
        </p>
      )}
      <div className="assessment-start">
        {draft && draftHref ? (
          <Link className="button primary small" href={draftHref}>
            {earlierDraft ? "Abrir o rascunho do formato anterior" : draft.amendsAssessmentId ? "Continuar a retificação" : "Continuar a avaliação física"}
          </Link>
        ) : (
          <StartAssessmentButton studentId={studentId} first={recorded.length === 0} />
        )}
      </div>
    </section>
  );
}
