import { Notice, formatDateTime } from "@/components/ui";
import type { AssessmentDetail } from "@/db/assessments";
import { formatCalendarDate } from "@/modules/training/format";
import { ReviewForm } from "./review-form";
import { ScreeningPill } from "./screening-pill";
import { CLEAR_TEXT, REVIEW_REQUIRED_TEXT, SCREENING_ITEMS, SIDE_LABEL } from "./contracts";

/** A recorded assessment, exactly as it was recorded, plus the professional's reviews. */
export function AssessmentView({ detail }: { detail: AssessmentDetail }) {
  const marked = SCREENING_ITEMS.filter((item) => detail.flags[item.key]);
  return (
    <>
      <section className="panel" aria-labelledby="triagem-titulo">
        <p className="eyebrow">TRIAGEM</p>
        <h2 id="triagem-titulo">
          {detail.kind === "INITIAL" ? "Avaliação inicial" : "Reavaliação"} de{" "}
          {formatCalendarDate(detail.assessedOn)}
        </h2>
        <p>
          <ScreeningPill risk={detail.riskStatus} reviewed={detail.reviewed} />{" "}
          <span className="small muted">
            Registrada em {detail.recordedAt ? formatDateTime(detail.recordedAt) : "—"}. Não muda mais.
          </span>
        </p>
        {marked.length > 0 ? (
          <ul>
            {marked.map((item) => (
              <li key={item.key}>{item.label}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">{CLEAR_TEXT}</p>
        )}
        {detail.screeningNotes && <p>{detail.screeningNotes}</p>}
        {detail.riskStatus === "REVIEW_REQUIRED" && !detail.reviewed && (
          <Notice tone="warning">
            <p>
              <strong>{REVIEW_REQUIRED_TEXT}</strong> Enquanto não houver uma
              revisão sua registrada abaixo, nenhum plano deste aluno pode ser
              aprovado nem entregue.
            </p>
          </Notice>
        )}
      </section>

      <section className="panel" aria-labelledby="indicadores-titulo">
        <p className="eyebrow">INDICADORES</p>
        <h2 id="indicadores-titulo">Medidas registradas</h2>
        {detail.metrics.length === 0 ? (
          <p className="muted">Nenhum indicador registrado nesta avaliação.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table stack">
              <caption className="sr-only">Indicadores da avaliação</caption>
              <thead>
                <tr>
                  <th scope="col">Medida</th>
                  <th scope="col">Valor</th>
                  <th scope="col">Lado</th>
                  <th scope="col">Observação</th>
                </tr>
              </thead>
              <tbody>
                {detail.metrics.map((metric, index) => (
                  <tr key={index}>
                    <th scope="row" data-label="Medida">
                      {metric.name}
                    </th>
                    <td data-label="Valor">
                      {metric.valueText}
                      {metric.unit ? ` ${metric.unit}` : ""}
                    </td>
                    <td data-label="Lado">{metric.side ? SIDE_LABEL[metric.side] : "—"}</td>
                    <td data-label="Observação">{metric.notes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {detail.notes && <p>{detail.notes}</p>}
      </section>

      {detail.riskStatus === "REVIEW_REQUIRED" && (
        <section className="panel" aria-labelledby="revisao-titulo">
          <p className="eyebrow">REVISÃO DO PROFISSIONAL</p>
          <h2 id="revisao-titulo">Revisão do alerta</h2>
          <p className="muted">
            A revisão registra em que você se baseou (por exemplo, a
            orientação de um profissional de saúde). Ela fica anexada à
            avaliação, não apaga o alerta e não é liberação clínica da
            ferramenta.
          </p>
          {detail.reviews.length > 0 && (
            <ul className="review-list">
              {detail.reviews.map((review, index) => (
                <li key={index}>
                  <p>{review.basis}</p>
                  <p className="small muted">
                    {review.reviewerName ?? "Profissional"} · {formatDateTime(review.reviewedAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <ReviewForm assessmentId={detail.id} hasReview={detail.reviews.length > 0} />
        </section>
      )}
    </>
  );
}
