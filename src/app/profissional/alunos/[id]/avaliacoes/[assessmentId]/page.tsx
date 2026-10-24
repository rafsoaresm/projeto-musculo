import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireWorkspace } from "@/modules/auth/server";
import { studentsFor } from "@/db/students";
import { assessmentsFor } from "@/db/assessments";
import { profilesFor } from "@/db/student-profile";
import { ageOn } from "@/modules/ficha/contracts";
import { PageHeading } from "@/components/ui";
import { AssessmentForm } from "@/modules/avaliacoes/assessment-form";
import { AssessmentView } from "@/modules/avaliacoes/assessment-view";
import { formatCalendarDate } from "@/modules/training/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Avaliação" };

export default async function Assessment({
  params,
}: {
  params: Promise<{ id: string; assessmentId: string }>;
}) {
  const { db, context, workspace } = await requireWorkspace();
  const { id, assessmentId } = await params;
  const student = await studentsFor(db, context).findById(id);
  if (!student) notFound();
  const detail = await assessmentsFor(db, context).get(assessmentId);
  // The assessment must belong to the student in the address, not just to this professional.
  if (!detail || detail.studentId !== student.id) notFound();
  // Photos of a student known to be under 18 are not accepted (the file is the only place that says so).
  const birthDate = detail.state === "DRAFT" ? (await profilesFor(db, context).get(student.id))?.birthDate : null;
  const minor = Boolean(birthDate && ageOn(birthDate, new Date().toISOString().slice(0, 10)) < 18);
  return (
    <>
      <PageHeading
        eyebrow={workspace.name}
        title={
          detail.state === "DRAFT"
            ? `${detail.kind === "INITIAL" ? "Avaliação inicial" : "Reavaliação"} de ${student.displayName}`
            : `Avaliação de ${formatCalendarDate(detail.assessedOn)}`
        }
        description={
          detail.state === "DRAFT"
            ? "Rascunho em edição. Só vale como registro depois de registrada."
            : student.displayName
        }
      />
      {detail.state === "DRAFT" ? (
        <section className="panel">
          <AssessmentForm detail={detail} minor={minor} />
        </section>
      ) : (
        <AssessmentView detail={detail} />
      )}
      <Link href={`/profissional/alunos/${student.id}/avaliacoes`} className="button secondary">
        <ArrowLeft size={17} /> Voltar às avaliações
      </Link>
    </>
  );
}
