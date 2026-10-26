import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
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
import { formatCalendarDate } from "@/modules/training/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Visão geral" };

export default async function ProfessionalHome() {
  const { db, context, workspace, user } = await requireWorkspace();
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
  const steps = [
    {
      done: students.length > 0,
      title: "Cadastrar o primeiro aluno",
      text: "O cadastro fica vinculado a você como profissional responsável.",
      href: "/profissional/alunos/novo",
      cta: "Cadastrar aluno",
    },
    {
      done: active + invited > 0,
      title: "Convidar o aluno para a área do aluno",
      text: "Gere um link de uso único. Só quem recebe o link se vincula ao cadastro.",
      href: firstStudent
        ? `/profissional/alunos/${firstStudent.id}`
        : "/profissional/alunos",
      cta: "Gerar convite",
    },
    {
      done: plans.length > 0,
      title: "Planejar o ciclo e prescrever os exercícios",
      text: "Defina fases, divisão dos treinos e a duração real do calendário, e depois escolha os exercícios de cada treino.",
      href: firstStudent
        ? `/profissional/alunos/${firstStudent.id}/planos/novo`
        : "/profissional/periodizacao",
      cta: firstStudent ? "Criar um plano" : "Abrir periodização",
    },
    {
      done: assessed,
      title: "Registrar a avaliação e a triagem",
      text: "A triagem e os indicadores ficam como registros com data. Qualquer sinal marcado pede a sua revisão antes da entrega.",
      href: firstStudent
        ? `/profissional/alunos/${firstStudent.id}/avaliacoes`
        : "/profissional/avaliacoes",
      cta: "Abrir avaliações",
    },
    {
      done: delivered,
      title: "Aprovar e entregar o plano",
      text: "Aprovar e entregar são dois atos seus. O aluno só vê a revisão entregue, e ela não muda mais.",
      href: "/profissional/prescricao",
      cta: "Ver os planos",
    },
  ];
  return (
    <>
      <PageHeading
        eyebrow={workspace.name}
        title={`Olá, ${user.name.split(" ")[0]}.`}
        description="Seu atendimento em um só lugar."
      />
      <div className="kpi-grid">
        <Kpi label="Alunos sob seu atendimento" value={students.length} />
        <Kpi label="Com acesso ao portal" value={active} />
        <Kpi label="Convites pendentes" value={invited} />
        <Kpi
          label="Planos em rascunho"
          value={drafts.length}
          hint={pending > 0 ? `${pending} com treinos abaixo do alvo` : undefined}
        />
        <Kpi
          label="Revisões obrigatórias pendentes"
          value={alerts}
          hint={alerts > 0 ? "Triagem com alerta sem revisão registrada" : undefined}
        />
        <Kpi
          label="Relatos de dor sem leitura"
          value={painPending.length}
          hint={painPending.length > 0 ? "Registros de treino com dor ou desconforto" : undefined}
        />
        <Kpi
          label="Check-ins sem leitura"
          value={checkinsPending.length}
          hint={
            checkinsPending.some((row) => row.discomfort)
              ? `${checkinsPending.filter((row) => row.discomfort).length} com relato de desconforto`
              : undefined
          }
        />
        <Kpi
          label="Pedidos de alunos sobre os dados"
          value={requestsPending.length}
          hint={
            requestsPending.some((row) => row.overdue)
              ? `${requestsPending.filter((row) => row.overdue).length} passou do prazo de 15 dias`
              : requestsPending.length > 0
                ? "Resposta em até 15 dias"
                : undefined
          }
        />
      </div>
      {requestsPending.length > 0 && (
        <section className="panel" aria-labelledby="pedidos-pendentes">
          <p className="eyebrow">PEDIDOS DO TITULAR</p>
          <h2 id="pedidos-pendentes">Pedidos de alunos sobre os dados deles</h2>
          <p className="small muted">Do prazo mais próximo ao mais distante. A resposta é sua; a ferramenta não avisa por e-mail.</p>
          <ul className="plan-list">
            {requestsPending.slice(0, 8).map((row) => (
              <li key={row.id}>
                <Link className="account-link" href={`/profissional/alunos/${row.studentId}#pedidos`}>
                  {row.studentName} · {REQUEST_KIND_LABEL[row.kind]} · {row.overdue ? "passou do prazo em" : "prazo"}{" "}
                  {formatDate(row.dueAt)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {checkinsPending.length > 0 && (
        <section className="panel" aria-labelledby="checkins-pendentes">
          <p className="eyebrow">CHECK-INS</p>
          <h2 id="checkins-pendentes">Check-ins dos alunos sem leitura</h2>
          <p className="small muted">Primeiro os que relatam desconforto, depois os outros, do mais novo ao mais antigo.</p>
          <ul className="plan-list">
            {checkinsPending.slice(0, 8).map((row) => (
              <li key={row.checkinId}>
                <Link className="account-link" href={`/profissional/alunos/${row.studentId}#checkins`}>
                  {row.studentName} · check-in de {formatCalendarDate(row.checkedOn)}
                  {row.discomfort ? " · relato de desconforto" : ""}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {painPending.length > 0 && (
        <section className="panel" aria-labelledby="dor-pendente">
          <p className="eyebrow">RELATOS DE DOR</p>
          <h2 id="dor-pendente">Registros de treino com dor ou desconforto sem leitura</h2>
          <ul className="plan-list">
            {painPending.slice(0, 8).map((row) => (
              <li key={row.sessionId}>
                <Link className="account-link" href={`/profissional/alunos/${row.studentId}/execucao/${row.sessionId}`}>
                  {row.studentName} · treino {row.workoutLabel} de {formatCalendarDate(row.performedOn)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="panel">
        <p className="eyebrow">PRÓXIMOS PASSOS</p>
        <h2>Do cadastro ao acompanhamento</h2>
        <ol className="steps">
          {steps.map((step) => (
            <li key={step.title} className={step.done ? "done" : undefined}>
              <span className="step-mark" aria-hidden="true">
                {step.done ? <Check size={16} /> : null}
              </span>
              <div>
                <h3>
                  {step.title}{" "}
                  {step.done && <Pill tone="success">Concluído</Pill>}
                </h3>
                <p>{step.text}</p>
              </div>
              <Link className="text-link" href={step.href}>
                {step.cta} <ArrowRight size={15} />
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
