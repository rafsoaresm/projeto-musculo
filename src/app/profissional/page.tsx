import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { requireWorkspace } from "@/modules/auth/server";
import { studentsFor } from "@/db/students";
import { studentAccessFor } from "@/db/student-access";
import { plansFor } from "@/db/plans";
import { assessmentsFor } from "@/db/assessments";
import { Kpi, PageHeading, Pill } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Visão geral" };

export default async function ProfessionalHome() {
  const { db, context, workspace, user } = await requireWorkspace();
  const [students, access, plans, assessments] = await Promise.all([
    studentsFor(db, context).list(),
    studentAccessFor(db, context).statuses(),
    plansFor(db, context).overview(),
    assessmentsFor(db, context).overview(),
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
      </div>
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
