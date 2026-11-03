import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireWorkspace } from "@/modules/auth/server";
import { studentsFor } from "@/db/students";
import { assessmentsFor } from "@/db/assessments";
import { photoStorageAvailable } from "@/db/binding";
import { Notice, PageHeading } from "@/components/ui";
import { AssessmentForm } from "@/modules/avaliacoes/assessment-form";
import { AssessmentView } from "@/modules/avaliacoes/assessment-view";
import { formatCalendarDate } from "@/modules/training/format";
import { assessmentV2Here } from "@/modules/avaliacoes/v2/switch";
import { AssessmentShell } from "@/modules/avaliacoes/v2/assessment-shell";
import { COMPOSITION_MODULE, readComposition } from "@/modules/avaliacoes/v2/composition";

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
  const api = assessmentsFor(db, context);
  const v2 = await api.sections(assessmentId);
  // A draft of the new format (handoff V2) is never edited by the earlier form: it has its own guided steps, open only where the switch is on.
  if (detail.state === "DRAFT" && v2?.formatVersion === 2) {
    const open = await assessmentV2Here();
    const snapshot = open ? await api.studentSnapshot(assessmentId) : null;
    const composition = v2.sections.find((section) => section.module === COMPOSITION_MODULE);
    return (
      <>
        <PageHeading
          eyebrow={workspace.name}
          title={`${detail.kind === "INITIAL" ? "Avaliação inicial" : "Reavaliação"} de ${student.displayName}`}
          description={`Rascunho de ${formatCalendarDate(detail.assessedOn)}.`}
        />
        {open ? (
          <AssessmentShell
            studentId={student.id}
            assessmentId={assessmentId}
            assessedOn={detail.assessedOn}
            birthDate={snapshot?.birthDate ?? null}
            revision={v2.revision}
            composition={readComposition(composition?.payload)}
          />
        ) : (
          <Notice tone="warning">
            <p>A avaliação no formato novo está fechada neste ambiente. Ela não pode ser editada aqui.</p>
          </Notice>
        )}
        <Link href={`/profissional/alunos/${student.id}/avaliacoes`} className="button secondary">
          <ArrowLeft size={17} /> Voltar às avaliações
        </Link>
      </>
    );
  }
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
          <AssessmentForm detail={detail} storageReady={await photoStorageAvailable()} />
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
