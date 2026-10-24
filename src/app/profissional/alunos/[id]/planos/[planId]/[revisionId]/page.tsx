import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireWorkspace } from "@/modules/auth/server";
import { studentsFor } from "@/db/students";
import { plansFor } from "@/db/plans";
import { exercisesFor } from "@/db/exercises";
import { studentAccessFor } from "@/db/student-access";
import { prescriptionFor } from "@/db/prescription";
import { assessmentsFor } from "@/db/assessments";
import { PageHeading, Pill } from "@/components/ui";
import { Planner } from "@/modules/training/components/planner";
import {
  createRevision,
  markReady,
  saveDraft,
} from "@/modules/planos/actions";
import { PlanReadOnly } from "@/modules/planos/plan-readonly";
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
            ? "Rascunho em edição. Salve a estrutura, prescreva os exercícios e marque como pronta quando estiver certo: depois disso a revisão não aceita mais edição."
            : revision.state === "DELIVERED"
              ? "Revisão entregue ao aluno. Ela não muda mais."
              : "Revisão fechada para edição."
        }
        aside={<Pill tone={label.tone}>{label.text}</Pill>}
      />
      {revision.state === "DRAFT" ? (
        <Planner
          initial={revision.input}
          persist={{
            saveLabel: "Salvar alterações",
            save: saveDraft.bind(null, planId, revisionId),
            ready: {
              label: "Marcar estrutura como pronta",
              action: markReady.bind(null, planId, revisionId),
            },
          }}
        />
      ) : (
        <PlanReadOnly
          state={revision.state}
          schedule={revision.schedule}
          createRevision={createRevision.bind(null, planId, revisionId)}
        />
      )}
      {decision}
      {editor}
      <Link href={`/profissional/alunos/${student.id}`} className="button secondary">
        <ArrowLeft size={17} /> Voltar ao aluno
      </Link>
    </>
  );
}
