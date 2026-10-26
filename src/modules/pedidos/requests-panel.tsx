import type { D1Database } from "@cloudflare/workers-types";
import { Pill, formatDate } from "@/components/ui";
import { dataRequestsFor } from "@/db/data-requests";
import type { AuthenticatedContext } from "@/db/students";
import { AnswerRequestForm } from "./answer-request-form";
import { REQUEST_KIND_LABEL, outcomeLabel } from "./contracts";

/**
 * The requests the student made about their own data, for the professional with an active technical
 * assignment over them. The deadline is shown as a fact; the answer is the professional's. The ones
 * still open carry the form to answer them.
 */
export async function RequestsPanel({
  db,
  context,
  studentId,
}: {
  db: D1Database;
  context: AuthenticatedContext;
  studentId: string;
}) {
  const requests = dataRequestsFor(db, context);
  const [rows, photosStored] = await Promise.all([requests.forStudent(studentId), requests.photosStored(studentId)]);
  return (
    <section className="panel" id="pedidos" aria-labelledby="pedidos-aluno">
      <p className="eyebrow">PEDIDOS DO TITULAR</p>
      <h2 id="pedidos-aluno">Pedidos do aluno sobre os dados dele</h2>
      <p className="muted">
        O que o aluno pediu sobre os próprios dados, com o prazo de 15 dias para a sua resposta. A ferramenta não
        avisa por e-mail: o pedido aparece aqui e na visão geral.
      </p>
      {rows.length === 0 ? (
        <p className="muted">O aluno não fez nenhum pedido.</p>
      ) : (
        <ul className="plan-list request-list">
          {rows.map((row) => (
            <li key={row.id}>
              <div>
                <strong>{REQUEST_KIND_LABEL[row.kind]}</strong>{" "}
                {row.outcome === null ? (
                  row.overdue ? (
                    <Pill tone="danger">Passou do prazo ({formatDate(row.dueAt)})</Pill>
                  ) : (
                    <Pill tone="brand">Prazo {formatDate(row.dueAt)}</Pill>
                  )
                ) : (
                  <Pill tone={row.outcome === "FULFILLED" ? "success" : "neutral"}>
                    {outcomeLabel(row.outcome, "professional")} em{" "}
                    {formatDate(row.decidedAt ?? row.createdAt)}
                  </Pill>
                )}
              </div>
              <p className="small muted">Pedido de {formatDate(row.createdAt)}</p>
              {row.message && <p className="small">O aluno escreveu: {row.message}</p>}
              {row.outcomeNote && row.outcome !== "CANCELLED" && <p className="small">Resposta registrada: {row.outcomeNote}</p>}
              {row.outcome === null && <AnswerRequestForm requestId={row.id} kind={row.kind} photosStored={photosStored} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
