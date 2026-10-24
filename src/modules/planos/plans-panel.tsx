import Link from "next/link";
import { Plus } from "lucide-react";
import type { PlanSummary } from "@/db/plans";
import { Pill } from "@/components/ui";
import { formatCalendarDate } from "@/modules/training/format";
import { stateLabel } from "./labels";

/** Saved periodization plans of one student. Only the technical team sees this. */
export function PlansPanel({
  studentId,
  plans,
}: {
  studentId: string;
  plans: PlanSummary[];
}) {
  return (
    <section className="panel" aria-labelledby="planos-aluno">
      <p className="eyebrow">PERIODIZAÇÃO</p>
      <h2 id="planos-aluno">Planos salvos</h2>
      <p className="muted">
        Cada plano guarda o ciclo e os exercícios em revisões, que seguem
        Rascunho, Estrutura pronta, Aprovada e Entregue. Só uma revisão
        entregue aparece para o aluno, e ela nunca muda: alterações viram uma
        nova revisão.
      </p>
      {plans.length === 0 ? (
        <p>Este aluno ainda não tem plano salvo.</p>
      ) : (
        <ul className="plan-list">
          {plans.map((plan) => (
            <li key={plan.id}>
              <strong>{plan.title}</strong>
              <ul>
                {plan.revisions.map((revision) => {
                  const label = stateLabel(revision.state);
                  return (
                    <li key={revision.id}>
                      <Link
                        className="account-link"
                        href={`/profissional/alunos/${studentId}/planos/${plan.id}/${revision.id}`}
                      >
                        Revisão {revision.revisionNumber}
                      </Link>{" "}
                      <Pill tone={label.tone}>{label.text}</Pill>{" "}
                      <span className="small muted">
                        {formatCalendarDate(revision.startDate)} a{" "}
                        {formatCalendarDate(revision.endDate)} ·{" "}
                        {revision.totalWeeks} semanas ·{" "}
                        {revision.totalSessions} sessões
                      </span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <Link
        className="button primary small"
        href={`/profissional/alunos/${studentId}/planos/novo`}
      >
        <Plus size={16} /> Novo plano
      </Link>
    </section>
  );
}
