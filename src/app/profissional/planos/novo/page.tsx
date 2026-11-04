import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ListChecks, Search } from "lucide-react";
import { requireWorkspace } from "@/modules/auth/server";
import { studentsFor } from "@/db/students";
import { plansFor, type PlanInProgress } from "@/db/plans";
import { PageHeading, Pill } from "@/components/ui";
import { canPrescribe } from "@/modules/planos/access";
import { stateLabel } from "@/modules/planos/labels";
import { matchesName } from "@/modules/planos/student-search";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Novo plano" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * "Novo plano" from Planos e treinos (0.93, user's request of 03/11/2026): choose the student, then the student's own
 * Novo plano form. The list comes from the students repository, narrowed to the students with an active technical
 * assignment (the rule `plansFor().create` checks), so a student reached only by another kind of access never appears
 * here to fail on save. The search is a plain GET form, so it works without JavaScript.
 */
export default async function NewPlanPicker({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { db, context, workspace } = await requireWorkspace();
  const query = (first((await searchParams).q) ?? "").slice(0, 80);
  const back = (
    <Link href="/profissional/prescricao" className="button secondary">
      <ArrowLeft size={17} /> Voltar a Planos e treinos
    </Link>
  );
  if (!canPrescribe(workspace.role))
    return (
      <>
        <PageHeading eyebrow="PLANOS E TREINOS" title="Novo plano: escolha o aluno" />
        <section className="panel">
          <h2>Novo plano é feito pela equipe técnica.</h2>
          <p>O plano é prescrito por quem tem o aluno atribuído, seja dono, gestor ou técnico.</p>
        </section>
        {back}
      </>
    );
  const [students, open] = await Promise.all([
    studentsFor(db, context).prescribable(),
    plansFor(db, context).inProgress(),
  ]);
  const byStudent = new Map<string, PlanInProgress[]>();
  for (const plan of open) byStudent.set(plan.studentId, [...(byStudent.get(plan.studentId) ?? []), plan]);
  const shown = students
    .filter((student) => matchesName(student.displayName, query))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "pt-BR"));
  return (
    <>
      <PageHeading
        eyebrow="PLANOS E TREINOS"
        title="Novo plano: escolha o aluno"
        description="O plano é salvo no cadastro do aluno. Depois de escolher, defina o ciclo e siga direto para a prescrição dos exercícios."
      />
      {students.length === 0 ? (
        <section className="panel">
          <h2>Nenhum aluno no seu atendimento.</h2>
          <p>Para prescrever um plano, cadastre o aluno ou peça que ele seja atribuído a você.</p>
          <Link className="button primary" href="/profissional/alunos">
            Ver alunos
          </Link>
        </section>
      ) : (
        <>
          <form className="panel picker-search" method="get" role="search">
            <label>
              Buscar aluno pelo nome
              <input name="q" type="search" defaultValue={query} maxLength={80} autoComplete="off" />
            </label>
            <button className="button secondary">
              <Search size={17} /> Buscar
            </button>
          </form>
          <p className="small muted" role="status">
            {query
              ? `${shown.length} de ${students.length} ${students.length === 1 ? "aluno" : "alunos"} para “${query}”`
              : `${students.length} ${students.length === 1 ? "aluno" : "alunos"}`}
          </p>
          {shown.length === 0 ? (
            <section className="panel">
              <h2>Nenhum aluno com esse nome.</h2>
              <p>Confira a grafia ou limpe a busca.</p>
              <Link className="button secondary" href="/profissional/planos/novo">
                Limpar a busca
              </Link>
            </section>
          ) : (
            <ul className="student-list picker-list" aria-label="Alunos">
              {shown.map((student) => {
                const plans = byStudent.get(student.id) ?? [];
                return (
                  <li key={student.id} className="picker-row">
                    <div className="picker-main">
                      <h2>{student.displayName}</h2>
                      {plans.length === 0 ? (
                        <p className="small muted">Nenhum plano em andamento.</p>
                      ) : (
                        <ul className="picker-plans">
                          {plans.map((plan) => {
                            const label = stateLabel(plan.state);
                            return (
                              <li key={plan.planId}>
                                <span className="small">
                                  Em andamento: <strong>{plan.title}</strong>, revisão {plan.revisionNumber}
                                </span>{" "}
                                <Pill tone={label.tone}>{label.text}</Pill>
                                {plan.state === "DRAFT" && (
                                  <Link
                                    className="step-link"
                                    href={`/profissional/alunos/${student.id}/planos/${plan.planId}/${plan.revisionId}#prescricao`}
                                  >
                                    Continuar prescrição
                                    <span className="sr-only"> de {plan.title}</span>
                                  </Link>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                    <Link
                      className="button primary small picker-action"
                      href={`/profissional/alunos/${student.id}/planos/novo`}
                    >
                      <ListChecks size={16} /> Novo plano
                      <span className="sr-only"> para {student.displayName}</span>
                      <ArrowRight size={16} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      {back}
    </>
  );
}
