import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireWorkspace } from "@/modules/auth/server";
import { studentsFor } from "@/db/students";
import { assessmentsFor } from "@/db/assessments";
import { assessmentTemplatesFor } from "@/db/assessment-templates";
import { PageHeading } from "@/components/ui";
import { AssessmentsPanel } from "@/modules/avaliacoes/assessments-panel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Avaliação Física do aluno" };

export default async function StudentAssessments({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { db, context, workspace } = await requireWorkspace();
  const { id } = await params;
  const student = await studentsFor(db, context).findById(id);
  if (!student) notFound();
  const [assessments, templates] = await Promise.all([
    assessmentsFor(db, context).listForStudent(student.id),
    assessmentTemplatesFor(db, context).list(),
  ]);
  return (
    <>
      <PageHeading
        eyebrow={workspace.name}
        title={`Avaliação Física de ${student.displayName}`}
        description="Triagem, medidas, movimento e revisão, registrados ao longo do tempo."
      />
      <AssessmentsPanel studentId={student.id} assessments={assessments} templates={templates} />
      <Link href={`/profissional/alunos/${student.id}?aba=avaliacoes`} className="button secondary">
        <ArrowLeft size={17} /> Voltar ao aluno
      </Link>
    </>
  );
}
