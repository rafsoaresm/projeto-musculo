import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireWorkspace } from "@/modules/auth/server";
import { studentsFor } from "@/db/students";
import { studentAccessFor } from "@/db/student-access";
import { plansFor } from "@/db/plans";
import { profilesFor } from "@/db/student-profile";
import { assessmentsFor } from "@/db/assessments";
import { executionFor } from "@/db/workout-sessions";
import { PageHeading } from "@/components/ui";
import { InvitePanel } from "@/modules/convites/invite-panel";
import { PlansPanel } from "@/modules/planos/plans-panel";
import { ProfileSummary } from "@/modules/ficha/profile-summary";
import { AssessmentsPanel } from "@/modules/avaliacoes/assessments-panel";
import { ExecutionPanel } from "@/modules/execucao/execution-panel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Aluno" };

export default async function Student({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { db, context, workspace } = await requireWorkspace();
  const { id } = await params;
  const student = await studentsFor(db, context).findById(id);
  if (!student) notFound();
  const access = await studentAccessFor(db, context).statusOf(student.id);
  const plans = await plansFor(db, context).listForStudent(student.id);
  const profile = await profilesFor(db, context).get(student.id);
  const assessments = await assessmentsFor(db, context).listForStudent(student.id);
  const executions = await executionFor(db, context).list(student.id, 5);
  return (
    <>
      <PageHeading
        eyebrow={workspace.name}
        title={student.displayName}
        description="Cadastro salvo no seu espaço de atendimento."
      />
      <section className="panel" aria-labelledby="acesso-aluno">
        <p className="eyebrow">ÁREA DO ALUNO</p>
        <h2 id="acesso-aluno">Acesso do aluno</h2>
        <InvitePanel
          studentId={student.id}
          access={access?.access ?? "NONE"}
          activeSince={access?.activeSince ?? null}
          inviteExpiresAt={access?.inviteExpiresAt ?? null}
        />
      </section>
      <ProfileSummary studentId={student.id} profile={profile} />
      <AssessmentsPanel studentId={student.id} assessments={assessments} />
      <PlansPanel studentId={student.id} plans={plans} />
      <ExecutionPanel studentId={student.id} rows={executions} />
      <section className="panel">
        <p className="eyebrow">PLANEJADOR</p>
        <h2>Explorar sem salvar</h2>
        <p className="muted">
          Teste um ciclo no planejador sem criar plano para este aluno.
        </p>
        <Link href="/profissional/periodizacao" className="account-link">
          Abrir o planejador
        </Link>
      </section>
      <Link href="/profissional/alunos" className="button secondary">
        <ArrowLeft size={17} /> Voltar aos alunos
      </Link>
    </>
  );
}
