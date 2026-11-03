import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireWorkspace } from "@/modules/auth/server";
import { studentsFor } from "@/db/students";
import { assessmentsFor } from "@/db/assessments";
import { Notice, PageHeading } from "@/components/ui";
import { AssessmentView } from "@/modules/avaliacoes/assessment-view";
import { formatCalendarDate } from "@/modules/training/format";
import { AssessmentShell } from "@/modules/avaliacoes/v2/assessment-shell";
import { isStepKey } from "@/modules/avaliacoes/v2/steps";
import { DiscardDraftButton } from "@/modules/avaliacoes/v2/discard-button";
import { COMPOSITION_MODULE, readComposition } from "@/modules/avaliacoes/v2/composition";
import { PROFILE_MODULE, SCREENING_MODULE, readProfile, readScreening } from "@/modules/avaliacoes/v2/screening";
import { POSTURE_MODULE, readPosture } from "@/modules/avaliacoes/v2/posture";
import { MOVEMENT_MODULE, readMovement } from "@/modules/avaliacoes/v2/flexitest";
import { TESTS_MODULE, readTests } from "@/modules/avaliacoes/v2/physical-tests";
import { CONCLUSION_MODULE, readConclusion } from "@/modules/avaliacoes/v2/conclusion";
import { ASSESSMENT_NAME, assessmentTitle } from "@/modules/avaliacoes/names";
import { RecordedAssessmentView } from "@/modules/avaliacoes/v2/recorded-view";
import { storedPhotos } from "@/modules/avaliacoes/v2/posture-photos";
import { photoStorageAvailable } from "@/db/binding";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: ASSESSMENT_NAME };

export default async function Assessment({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; assessmentId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { db, context, workspace } = await requireWorkspace();
  const { id, assessmentId } = await params;
  const student = await studentsFor(db, context).findById(id);
  if (!student) notFound();
  const api = assessmentsFor(db, context);
  const detail = await api.get(assessmentId);
  // The assessment must belong to the student in the address, not just to this professional.
  if (!detail || detail.studentId !== student.id) notFound();
  const back = (
    <Link href={`/profissional/alunos/${student.id}/avaliacoes`} className="button secondary">
      <ArrowLeft size={17} /> Voltar à avaliação física
    </Link>
  );

  if (detail.state === "DRAFT" && detail.formatVersion === 2) {
    const [v2, snapshot, suggestedEquation, original, photoStorage] = await Promise.all([
      api.sections(assessmentId),
      api.studentSnapshot(assessmentId),
      // A reassessment suggests the reference of the previous one (decision 2); an amendment already carries its own.
      detail.kind === "REASSESSMENT" && !detail.amendsAssessmentId ? api.previousEquation(assessmentId) : Promise.resolve(null),
      detail.amendsAssessmentId ? api.sections(detail.amendsAssessmentId) : Promise.resolve(null),
      photoStorageAvailable(),
    ]);
    const section = (module: string) => v2?.sections.find((item) => item.module === module)?.payload;
    const originalScreening = original?.sections.find((item) => item.module === SCREENING_MODULE)?.payload;
    const { etapa } = await searchParams;
    return (
      <>
        <PageHeading
          eyebrow={workspace.name}
          title={`${assessmentTitle(detail)} de ${student.displayName}`}
          description={
            detail.amendsAssessmentId
              ? `Rascunho que retifica a avaliação de ${formatCalendarDate(detail.assessedOn)}. Motivo: ${detail.amendReason ?? ""}`
              : `Rascunho de ${formatCalendarDate(detail.assessedOn)}.`
          }
        />
        <AssessmentShell
          studentId={student.id}
          assessmentId={assessmentId}
          assessedOn={detail.assessedOn}
          birthDate={snapshot?.birthDate ?? null}
          revision={v2?.revision ?? 1}
          composition={readComposition(section(COMPOSITION_MODULE))}
          profile={readProfile(section(PROFILE_MODULE))}
          screening={readScreening(section(SCREENING_MODULE))}
          posture={readPosture(section(POSTURE_MODULE))}
          movement={readMovement(section(MOVEMENT_MODULE))}
          tests={readTests(section(TESTS_MODULE))}
          conclusion={readConclusion(section(CONCLUSION_MODULE))}
          initialStep={isStepKey(etapa) ? etapa : undefined}
          photos={storedPhotos(detail.photos)}
          photoStorage={photoStorage}
          suggestedEquation={suggestedEquation}
          amendment={
            detail.amendsAssessmentId
              ? { reason: detail.amendReason ?? "", originalScreening: originalScreening === undefined ? null : readScreening(originalScreening) }
              : null
          }
        />
        {back}
      </>
    );
  }

  // A draft of the earlier format can no longer be filled nor recorded (user's decision of 03/11/2026): it is discarded, and the Avaliação
  // Física is started in its place. Nothing of it is shown as if it were a record.
  if (detail.state === "DRAFT")
    return (
      <>
        <PageHeading
          eyebrow={workspace.name}
          title={`Rascunho do formato anterior de ${student.displayName}`}
          description={`Aberto em ${formatCalendarDate(detail.assessedOn)}.`}
        />
        <section className="panel">
          <Notice tone="warning">
            <p>
              <strong>Este rascunho é do formato anterior da avaliação, que não é mais usado.</strong> Ele não pode ser preenchido nem
              registrado. Descarte-o para iniciar a avaliação física deste aluno; as avaliações já registradas continuam no histórico.
            </p>
          </Notice>
          <div className="assessment-start">
            <DiscardDraftButton studentId={student.id} assessmentId={assessmentId} />
          </div>
        </section>
        {back}
      </>
    );

  if (detail.formatVersion === 2) {
    const [v2, list] = await Promise.all([api.sections(assessmentId), api.listForStudent(student.id)]);
    const openDraft = list.find((item) => item.state === "DRAFT") ?? null;
    const amendedAt = detail.amendedById ? (list.find((item) => item.id === detail.amendedById)?.recordedAt ?? null) : null;
    const section = (module: string) => v2?.sections.find((item) => item.module === module)?.payload;
    const screening = section(SCREENING_MODULE) === undefined ? null : readScreening(section(SCREENING_MODULE));
    const reviewer = screening?.parq.professionalReview.reviewerUserId;
    const decidedBy = reviewer ? await api.professionalName(reviewer) : null;
    return (
      <>
        <PageHeading
          eyebrow={workspace.name}
          title={`${assessmentTitle(detail)} de ${formatCalendarDate(detail.assessedOn)}`}
          description={student.displayName}
        />
        <RecordedAssessmentView
          detail={detail}
          profile={section(PROFILE_MODULE) === undefined ? null : readProfile(section(PROFILE_MODULE))}
          screening={screening}
          composition={section(COMPOSITION_MODULE) === undefined ? null : readComposition(section(COMPOSITION_MODULE))}
          posture={section(POSTURE_MODULE) === undefined ? null : readPosture(section(POSTURE_MODULE))}
          movement={section(MOVEMENT_MODULE) === undefined ? null : readMovement(section(MOVEMENT_MODULE))}
          tests={section(TESTS_MODULE) === undefined ? null : readTests(section(TESTS_MODULE))}
          conclusion={section(CONCLUSION_MODULE) === undefined ? null : readConclusion(section(CONCLUSION_MODULE))}
          decidedBy={decidedBy}
          amendedAt={amendedAt}
          canAmend={openDraft === null && detail.amendedById === null}
        />
        {back}
      </>
    );
  }

  return (
    <>
      <PageHeading
        eyebrow={workspace.name}
        title={`${assessmentTitle(detail)} de ${formatCalendarDate(detail.assessedOn)}`}
        description={student.displayName}
      />
      <AssessmentView detail={detail} />
      {back}
    </>
  );
}
