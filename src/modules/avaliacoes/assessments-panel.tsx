import Link from "next/link";
import { Pill } from "@/components/ui";
import type { AssessmentSummary } from "@/db/assessments";
import { formatCalendarDate } from "@/modules/training/format";
import { StartAssessmentButton } from "./start-button";
import { ScreeningPill } from "./screening-pill";
import { ASSESSMENT_NAME, assessmentTitle } from "./names";

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
        <ul className="plan-list">
          {draft && draftHref && (
            <li>
              <Link className="account-link" href={draftHref}>
                {earlierDraft ? "Rascunho do formato anterior" : "Rascunho"} de {formatCalendarDate(draft.assessedOn)}
              </Link>{" "}
              <Pill tone="neutral">{earlierDraft ? "Só pode ser descartado" : "Em edição"}</Pill>
            </li>
          )}
          {recorded.map((item) => (
            <li key={item.id}>
              <Link className="account-link" href={`/profissional/alunos/${studentId}/avaliacoes/${item.id}`}>
                {assessmentTitle(item)} de {formatCalendarDate(item.assessedOn)}
              </Link>{" "}
              <ScreeningPill risk={item.riskStatus} reviewed={item.reviewed} />
            </li>
          ))}
        </ul>
      )}
      {recorded.length > 0 && (
        <p>
          <Link className="account-link" href={`/profissional/alunos/${studentId}/evolucao`}>
            Ver a evolução ao longo do tempo
          </Link>
        </p>
      )}
      {draft && draftHref ? (
        <Link className="button primary small" href={draftHref}>
          {earlierDraft ? "Abrir o rascunho do formato anterior" : "Continuar a avaliação física"}
        </Link>
      ) : (
        <StartAssessmentButton studentId={studentId} first={recorded.length === 0} />
      )}
    </section>
  );
}
