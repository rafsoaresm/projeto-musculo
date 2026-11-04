import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireWorkspace } from "@/modules/auth/server";
import { studentsFor } from "@/db/students";
import { plansFor } from "@/db/plans";
import { recordStudentRead } from "@/db/student-reads";
import { exercisesFor } from "@/db/exercises";
import { studentAccessFor } from "@/db/student-access";
import { prescriptionFor } from "@/db/prescription";
import { assessmentsFor } from "@/db/assessments";
import { PageHeading, Pill } from "@/components/ui";
import { formatCalendarDate } from "@/modules/training/format";
import {
  createRevision,
  markReady,
  saveDraft,
} from "@/modules/planos/actions";
import { PlanReadOnly } from "@/modules/planos/plan-readonly";
import { DraftWorkspace } from "@/modules/planos/draft-workspace";
import { stateLabel } from "@/modules/planos/labels";
import { PrescriptionEditor } from "@/modules/prescricao/prescription-editor";
import { ApprovalPanel, type ScreeningInfo } from "@/modules/planos/approval-panel";
import { progressOf } from "@/modules/prescricao/summary";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Plano" };

export default async function PlanRevision({
  params,
}: {
  params: Promise<{ id: string; planId: string; revisionId: string }>;
}) {
  const { db, context } = await requireWorkspace();
  const { id, planId, revisionId } = await params;
  const student = await studentsFor(db, context).findById(id);
  if (!student) notFound();
  const detail = await plansFor(db, context).findRevision(planId, revisionId);
  // The plan must belong to the student in the address, not just to this professional.
  if (!detail || detail.plan.studentId !== student.id) notFound();
  await recordStudentRead(db, context, student.id, "PLAN_REVISION");
  const { revision } = detail;
  const label = stateLabel(revision.state);
  const [items, library, access, standing] = await Promise.all([
    prescriptionFor(db, context).list(planId, revisionId),
    exercisesFor(db, context).list(),
    studentAccessFor(db, context).statusOf(student.id),
    assessmentsFor(db, context).standing(student.id),
  ]);
  const screening: ScreeningInfo = !standing
    ? { kind: "NONE" }
    : {
        kind:
          standing.risk === "CLEAR"
            ? "CLEAR"
            : standing.reviewed
              ? "REVIEWED"
              : "BLOCKED",
        assessedOn: standing.assessedOn,
        parq: standing.formatVersion === 2,
        href: `/profissional/alunos/${student.id}/avaliacoes/${standing.assessmentId}`,
      };
  const progress = progressOf(revision.schedule, items);
  const decision =
    revision.state === "READY" ||
    revision.state === "APPROVED" ||
    revision.state === "DELIVERED" ? (
      <ApprovalPanel
        planId={planId}
        revisionId={revisionId}
        state={revision.state}
        below={progress.filter((slot) => slot.status === "BELOW").length}
        workouts={progress.length}
        approvedAt={revision.approvedAt}
        deliveredAt={revision.deliveredAt}
        deliveredByName={revision.deliveredByName}
        deliveredOrganizationName={revision.deliveredOrganizationName}
        portal={access?.access ?? "NONE"}
        studentHref={`/profissional/alunos/${student.id}`}
        screening={screening}
        pdfHref={`/profissional/alunos/${student.id}/planos/${planId}/${revisionId}/pdf`}
      />
    ) : null;
  const editor = (
    <PrescriptionEditor
      planId={planId}
      revisionId={revisionId}
      schedule={revision.schedule}
      items={items}
      library={library.map((exercise) => ({
        id: exercise.id,
        name: exercise.name,
        category: exercise.category,
      }))}
      readOnly={revision.state !== "DRAFT"}
    />
  );
  return (
    <>
      <PageHeading
        eyebrow={`${student.displayName} · Revisão ${revision.revisionNumber}`}
        title={detail.plan.title}
        description={
          revision.state === "DRAFT"
            ? "Rascunho em edição. Prescreva os exercícios de cada treino; a estrutura do ciclo fica logo abaixo. Quando estiver certo, marque como pronta: depois disso a revisão não aceita mais edição."
            : revision.state === "DELIVERED"
              ? "Revisão entregue ao aluno. Ela não muda mais."
              : "Revisão fechada para edição."
        }
        aside={<Pill tone={label.tone}>{label.text}</Pill>}
      />
      {/* 0.93: the prescription is the main content of a draft; the structure is folded under it. */}
      {revision.state === "DRAFT" ? (
        <DraftWorkspace
          editor={editor}
          input={revision.input}
          structureSummary={`${revision.schedule.phases.length} ${revision.schedule.phases.length === 1 ? "fase" : "fases"} · ${revision.schedule.totalWeeks} ${revision.schedule.totalWeeks === 1 ? "semana" : "semanas"} · ${formatCalendarDate(revision.schedule.startDate)} a ${formatCalendarDate(revision.schedule.endDate)}`}
          save={saveDraft.bind(null, planId, revisionId)}
          markReady={markReady.bind(null, planId, revisionId)}
        />
      ) : (
        <>
          {decision}
          {editor}
          <PlanReadOnly
            state={revision.state}
            schedule={revision.schedule}
            createRevision={createRevision.bind(null, planId, revisionId)}
          />
        </>
      )}
      <Link href={`/profissional/alunos/${student.id}?aba=periodizacao`} className="button secondary">
        <ArrowLeft size={17} /> Voltar ao aluno
      </Link>
    </>
  );
}
