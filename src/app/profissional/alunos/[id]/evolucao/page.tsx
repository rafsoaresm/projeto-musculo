import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireWorkspace } from "@/modules/auth/server";
import { studentsFor } from "@/db/students";
import { assessmentsFor } from "@/db/assessments";
import { PageHeading } from "@/components/ui";
import { EvolutionView } from "@/modules/avaliacoes/evolution-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Evolução do aluno" };

export default async function StudentEvolution({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { db, context, workspace } = await requireWorkspace();
  const { id } = await params;
  const student = await studentsFor(db, context).findById(id);
  if (!student) notFound();
  const history = await assessmentsFor(db, context).history(student.id);
  return (
    <>
      <PageHeading
        eyebrow={workspace.name}
        title={`Evolução de ${student.displayName}`}
        description="Os indicadores e as avaliações registradas ao longo do tempo, e o que mudou de uma para a outra."
      />
      <EvolutionView studentId={student.id} history={history} />
      <Link href={`/profissional/alunos/${student.id}/avaliacoes`} className="button secondary">
        <ArrowLeft size={17} /> Voltar às avaliações
      </Link>
    </>
  );
}
