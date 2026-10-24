import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireWorkspace } from "@/modules/auth/server";
import { studentsFor } from "@/db/students";
import { studentAccessFor } from "@/db/student-access";
import { plansFor } from "@/db/plans";
import { PageHeading } from "@/components/ui";
import { InvitePanel } from "@/modules/convites/invite-panel";
import { PlansPanel } from "@/modules/planos/plans-panel";

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
      <PlansPanel studentId={student.id} plans={plans} />
      <section className="panel">
        <p className="eyebrow">ATENDIMENTO</p>
        <h2>Próximas etapas</h2>
        <p>
          Avaliações, prescrição vinculada e entrega de treinos serão integradas
          nas próximas etapas. Hoje o plano guarda só a estrutura do ciclo.
        </p>
        <Link href="/profissional/periodizacao" className="account-link">
          Explorar o planejador sem salvar
        </Link>
      </section>
      <Link href="/profissional/alunos" className="button secondary">
        <ArrowLeft size={17} /> Voltar aos alunos
      </Link>
    </>
  );
}
