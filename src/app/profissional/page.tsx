import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, Plus } from "lucide-react";
import { requireWorkspace } from "@/modules/auth/server";
import { studentsFor } from "@/db/students";
import { studentAccessFor } from "@/db/student-access";
import { plansFor } from "@/db/plans";
import { assessmentsFor } from "@/db/assessments";
import { executionFor } from "@/db/workout-sessions";
import { checkinsFor } from "@/db/student-checkins";
import { dataRequestsFor } from "@/db/data-requests";
import { REQUEST_KIND_LABEL } from "@/modules/pedidos/contracts";
import { Kpi, PageHeading, Pill, formatDate } from "@/components/ui";
import { attentionQueue } from "@/modules/atendimento/attention";
import { formatCalendarDate } from "@/modules/training/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Visão geral" };

export default async function ProfessionalHome() {
  const { db, context } = await requireWorkspace();
  const [students, access, plans, assessments, painPending, checkinsPending, requestsPending] = await Promise.all([
    studentsFor(db, context).list(),
    studentAccessFor(db, context).statuses(),
    plansFor(db, context).overview(),
    assessmentsFor(db, context).overview(),
    executionFor(db, context).painPending(),
    checkinsFor(db, context).pending(),
    dataRequestsFor(db, context).pending(),
  ]);
  const alerts = assessments.filter((row) => row.riskStatus === "REVIEW_REQUIRED" && !row.reviewed).length;
  const assessed = assessments.some((row) => row.assessmentId !== null);
  const drafts = plans.filter((plan) => plan.state === "DRAFT");
  const pending = drafts.filter((plan) => plan.below > 0).length;
  const active = access.filter((s) => s.access === "ACTIVE").length;
  const invited = access.filter((s) => s.access === "INVITED").length;
  const firstStudent = students[0];
  const delivered = plans.some((plan) => plan.state === "DELIVERED");
  // A draft to go back to, and a delivered revision to look at (handoff V4, AC02.2): the step points to the work itself, not to doing it again.
  const draft = drafts[0];
  const deliveredPlan = plans.find((plan) => plan.state === "DELIVERED");
  const planHref = (plan: (typeof plans)[number]) => `/profissional/alunos/${plan.studentId}/planos/${plan.planId}/${plan.revisionId}`;
  const steps: Array<{ done: boolean; status?: string; title: string; text: string; href: string; cta: string }> = [
    {
      done: students.length > 0,
      title: "Cadastrar o primeiro aluno",
      text: "O cadastro fica vinculado a você como profissional responsável.",
      href: students.length > 0 ? "/profissional/alunos" : "/profissional/alunos/novo",
      cta: students.length > 0 ? "Ver alunos" : "Cadastrar aluno",
    },
    {
      // Done only when a student is in the portal: a link that was generated is not an access (V4, A08 and AC02.1).
      done: active > 0,
      status: active === 0 && invited > 0 ? "Convite gerado, aguardando aceite" : undefined,
      title: "Convidar o aluno para a área do aluno",
      text: "Gere um link de uso único. Só quem recebe o link se vincula ao cadastro.",
      href: firstStudent
        ? `/profissional/alunos/${firstStudent.id}`
        : "/profissional/alunos",
      cta: active > 0 || invited > 0 ? "Ver situação do acesso" : "Gerar convite",
    },
    {
      done: plans.length > 0,
      status: draft && !deliveredPlan ? "Plano em rascunho" : undefined,
      title: "Planejar o ciclo e prescrever os exercícios",
      text: "Defina fases, divisão dos treinos e a duração real do calendário, e depois escolha os exercícios de cada treino.",
      href: draft
        ? planHref(draft)
        : firstStudent
          ? `/profissional/alunos/${firstStudent.id}/planos/novo`
          : "/profissional/alunos",
      cta: draft ? "Continuar plano" : firstStudent ? "Criar um plano" : "Ver alunos",
    },
    {
      done: assessed,
      title: "Registrar a avaliação física",
      text: "Triagem, medidas, movimento e revisão ficam como registros com data. Um alerta da triagem pede a sua revisão antes da entrega.",
      href: firstStudent
        ? `/profissional/alunos/${firstStudent.id}/avaliacoes`
        : "/profissional/avaliacoes",
      cta: "Abrir a avaliação física",
    },
    {
      done: delivered,
      title: "Aprovar e entregar o plano",
      text: "Aprovar e entregar são dois atos seus. O aluno só vê a revisão entregue, e ela não muda mais.",
      href: deliveredPlan ? planHref(deliveredPlan) : "/profissional/prescricao",
      cta: deliveredPlan ? "Ver entrega" : "Ver os planos",
    },
  ];
  // The work queue (handoff V4 T02, Figma 1:2): one list with the student, the reason and where to act; nothing at zero becomes an item.
  const names = new Map(students.map((student) => [student.id, student.displayName]));
  const queue = attentionQueue({
    requests: requestsPending.map((row) => ({ id: row.id, studentId: row.studentId, studentName: row.studentName, kindLabel: REQUEST_KIND_LABEL[row.kind], overdue: row.overdue, dueOn: formatDate(row.dueAt) })),
    alerts: assessments
      .filter((row) => row.riskStatus === "REVIEW_REQUIRED" && !row.reviewed && row.assessmentId && row.assessedOn)
      .map((row) => ({ studentId: row.studentId, studentName: row.studentName, assessmentId: row.assessmentId!, assessedOn: formatCalendarDate(row.assessedOn!) })),
    pain: painPending.map((row) => ({ ...row, performedOn: formatCalendarDate(row.performedOn) })),
    checkins: checkinsPending.map((row) => ({ checkinId: row.checkinId, studentId: row.studentId, studentName: row.studentName, checkedOn: formatCalendarDate(row.checkedOn), discomfort: row.discomfort })),
    drafts: drafts.map((plan) => ({ studentId: plan.studentId, studentName: plan.studentName, planId: plan.planId, revisionId: plan.revisionId, title: plan.title, revisionNumber: plan.revisionNumber })),
    invited: access.filter((row) => row.access === "INVITED").map((row) => ({ studentId: row.studentId, studentName: names.get(row.studentId) ?? "Aluno" })),
  });
  const shown = queue.slice(0, 8);
  const allDone = steps.every((step) => step.done);
  return (
    <>
      <PageHeading
        title="Visão geral"
        description="Fila de trabalho, prioridades e próxima melhor ação"
      />
      <hr className="overview-heading-rule" />
      <ul className="count-chips" aria-label="Resumo do que pede a sua atenção">
        <li>{queue.length === 1 ? "1 pendência" : `${queue.length} pendências`}</li>
        <li>{students.length === 1 ? "1 aluno" : `${students.length} alunos`}</li>
        <li>{drafts.length === 1 ? "1 plano em rascunho" : `${drafts.length} planos em rascunho`}</li>
        {alerts > 0 && <li>{alerts === 1 ? "1 revisão de triagem" : `${alerts} revisões de triagem`}</li>}
      </ul>
      <div className="overview-grid">
        <section className="panel" aria-labelledby="atencao">
          <h2 id="atencao">Demandam atenção</h2>
          <p className="small muted">Priorizadas por motivo e prazo</p>
          {queue.length === 0 ? (
            <div className="empty-inline">
              <h3>Nada pede a sua atenção agora.</h3>
              <p className="muted">Quando houver revisão, relato, pedido ou plano em andamento, ele aparece aqui com o caminho para resolver.</p>
            </div>
          ) : (
            <>
              <ul className="attention-queue">
                {shown.map((item) => (
                  <li key={item.key}>
                    <div>
                      <strong>
                        {item.student} — {item.reason}
                      </strong>
                      <span className="small muted">{item.detail}</span>
                    </div>
                    <Link className="button primary small" href={item.href}>
                      {item.cta}
                    </Link>
                  </li>
                ))}
              </ul>
              {queue.length > shown.length && (
                <p className="small muted">E mais {queue.length - shown.length} na lista de cada módulo.</p>
              )}
            </>
          )}
        </section>
        <div className="overview-side">
          <section className="panel" aria-labelledby="atalhos">
            <h2 id="atalhos">Atalhos</h2>
            <p className="small muted">Tarefas recorrentes</p>
            <div className="shortcut-list">
              <Link className="button primary" href="/profissional/alunos/novo">
                <Plus size={18} /> Novo aluno
              </Link>
              <Link className="button muted-fill" href="/profissional/alunos">
                <Plus size={18} /> Criar plano
              </Link>
              <p className="small muted">Para criar um plano, escolha o aluno.</p>
            </div>
          </section>
          <section className="panel" aria-labelledby="resumo">
            <h2 id="resumo">Resumo da operação</h2>
            <p className="small muted">Indicadores com acesso aos detalhes</p>
            <div className="kpi-grid compact">
              <Kpi label="Alunos sob seu atendimento" value={students.length} href="/profissional/alunos" />
              <Kpi label="Com acesso ao portal" value={active} href="/profissional/alunos" />
              <Kpi label="Convites aguardando aceite" value={invited} href="/profissional/alunos" />
              <Kpi
                href="/profissional/prescricao"
                label="Planos em rascunho"
                value={drafts.length}
                hint={pending > 0 ? `${pending} com treinos abaixo do alvo (aviso)` : undefined}
              />
            </div>
          </section>
        </div>
      </div>
      {/* Compact and collapsible (V4 T02): open while there is a step to take, closed once every step is done. */}
      <details className="panel steps-panel" open={!allDone}>
        <summary>
          <span className="eyebrow">PRÓXIMOS PASSOS</span>
          <h2>Do cadastro ao acompanhamento</h2>
        </summary>
        <ol className="steps">
          {steps.map((step) => (
            <li key={step.title} className={step.done ? "done" : undefined}>
              <span className="step-mark" aria-hidden="true">
                {step.done ? <Check size={16} /> : null}
              </span>
              <div>
                <h3>
                  {step.title}{" "}
                  {step.done ? (
                    <Pill tone="success">Concluído</Pill>
                  ) : (
                    step.status && <Pill tone="warning">{step.status}</Pill>
                  )}
                </h3>
                <p>{step.text}</p>
              </div>
              <Link className="text-link" href={step.href}>
                {step.cta} <ArrowRight size={15} />
              </Link>
            </li>
          ))}
        </ol>
      </details>
    </>
  );
}
