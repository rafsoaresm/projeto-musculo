import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, Hourglass } from "lucide-react";
import { requireWorkspace } from "@/modules/auth/server";
import { studentsFor } from "@/db/students";
import { studentAccessFor } from "@/db/student-access";
import { plansFor } from "@/db/plans";
import { Kpi, PageHeading, Pill } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Visão geral" };

export default async function ProfessionalHome() {
  const { db, context, workspace, user } = await requireWorkspace();
  const [students, access, plans] = await Promise.all([
    studentsFor(db, context).list(),
    studentAccessFor(db, context).statuses(),
    plansFor(db, context).overview(),
  ]);
  const drafts = plans.filter((plan) => plan.state === "DRAFT");
  const pending = drafts.filter((plan) => plan.below > 0).length;
  const active = access.filter((s) => s.access === "ACTIVE").length;
  const invited = access.filter((s) => s.access === "INVITED").length;
  const firstStudent = students[0];
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
          <li className="planned">
            <span className="step-mark" aria-hidden="true">
              <Hourglass size={14} />
            </span>
            <div>
              <h3>
                Avaliar, aprovar e entregar <Pill tone="warning">Em breve</Pill>
              </h3>
              <p>
                Avaliações com triagem, aprovação e entrega do plano ao aluno
                ainda não existem. A prescrição manual já está disponível, e
                nada do que falta é simulado aqui.
              </p>
            </div>
          </li>
        </ol>
      </section>
    </>
  );
}
