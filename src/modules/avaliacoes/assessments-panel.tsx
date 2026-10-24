import Link from "next/link";
import { Pill } from "@/components/ui";
import type { AssessmentSummary } from "@/db/assessments";
import { formatCalendarDate } from "@/modules/training/format";
import { StartAssessmentButton } from "./start-button";
import { ScreeningPill } from "./screening-pill";

/** Assessments of one student, newest first, and the way to start another. */
export function AssessmentsPanel({
  studentId,
  assessments,
}: {
  studentId: string;
  assessments: AssessmentSummary[];
}) {
  const draft = assessments.find((item) => item.state === "DRAFT");
  const recorded = assessments.filter((item) => item.state === "RECORDED");
  return (
    <section className="panel" aria-labelledby="avaliacoes-aluno">
      <p className="eyebrow">AVALIAÇÕES</p>
      <h2 id="avaliacoes-aluno">Avaliações e triagem</h2>
      <p className="muted">
        Cada avaliação é um registro com data: a triagem do documento mestre e
        os indicadores que você escolher. Uma avaliação registrada não muda; a
        reavaliação é um novo registro.
      </p>
      {assessments.length === 0 ? (
        <p>Este aluno ainda não tem avaliação. Sem triagem registrada, a aprovação de um plano pede o seu aviso de ciência.</p>
      ) : (
        <ul className="plan-list">
          {draft && (
            <li>
              <Link className="account-link" href={`/profissional/alunos/${studentId}/avaliacoes/${draft.id}`}>
                Rascunho de {formatCalendarDate(draft.assessedOn)}
              </Link>{" "}
              <Pill tone="neutral">Em edição</Pill>
            </li>
          )}
          {recorded.map((item) => (
            <li key={item.id}>
              <Link className="account-link" href={`/profissional/alunos/${studentId}/avaliacoes/${item.id}`}>
                {item.kind === "INITIAL" ? "Avaliação inicial" : "Reavaliação"} de{" "}
                {formatCalendarDate(item.assessedOn)}
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
      {draft ? (
        <Link className="button primary small" href={`/profissional/alunos/${studentId}/avaliacoes/${draft.id}`}>
          Continuar o rascunho
        </Link>
      ) : (
        <StartAssessmentButton studentId={studentId} first={recorded.length === 0} />
      )}
    </section>
  );
}
