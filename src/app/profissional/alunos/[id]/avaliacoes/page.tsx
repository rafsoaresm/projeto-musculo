import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireWorkspace } from "@/modules/auth/server";
import { studentsFor } from "@/db/students";
import { assessmentsFor } from "@/db/assessments";
import { PageHeading } from "@/components/ui";
import { AssessmentsPanel } from "@/modules/avaliacoes/assessments-panel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Avaliações do aluno" };

export default async function StudentAssessments({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { db, context, workspace } = await requireWorkspace();
  const { id } = await params;
  const student = await studentsFor(db, context).findById(id);
  if (!student) notFound();
  const assessments = await assessmentsFor(db, context).listForStudent(student.id);
  return (
    <>
      <PageHeading
        eyebrow={workspace.name}
        title={`Avaliações de ${student.displayName}`}
        description="Triagem e indicadores registrados ao longo do tempo."
      />
      <AssessmentsPanel studentId={student.id} assessments={assessments} />
      <Link href={`/profissional/alunos/${student.id}`} className="button secondary">
        <ArrowLeft size={17} /> Voltar ao aluno
      </Link>
    </>
  );
}
