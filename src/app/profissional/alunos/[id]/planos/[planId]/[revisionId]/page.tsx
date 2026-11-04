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
import { Notice, PageHeading, Pill } from "@/components/ui";
import { proposalsFor } from "@/db/prescription-proposals";
import { AppliedProposalNotes, AutoPrescriptionCard } from "@/modules/prescricao/automatica/auto-card";
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
  searchParams,
}: {
  params: Promise<{ id: string; planId: string; revisionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { db, context } = await requireWorkspace();
  const { id, planId, revisionId } = await params;
  const query = await searchParams;
  const one = (key: string) => (typeof query[key] === "string" ? (query[key] as string) : undefined);
  const student = await studentsFor(db, context).findById(id);
  if (!student) notFound();
  const detail = await plansFor(db, context).findRevision(planId, revisionId);
  // The plan must belong to the student in the address, not just to this professional.
  if (!detail || detail.plan.studentId !== student.id) notFound();
  await recordStudentRead(db, context, student.id, "PLAN_REVISION");
  const { revision } = detail;
  const label = stateLabel(revision.state);
  const [items, library, access, standing] = await Promise.all([
    prescriptionFor(db, context).listWithDose(planId, revisionId),
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
  const selfHref = `/profissional/alunos/${student.id}/planos/${planId}/${revisionId}`;
  // Motor S9: the automatic prescription. A DRAFT shows the way in (or the open proposal); a revision written session by session
  // (OCCURRENCE) gets the per-session editor and the notes of the proposal that wrote it.
  const proposals = proposalsFor(db, context);
  const openProposal = revision.state === "DRAFT" ? await proposals.open(planId, revisionId) : null;
  const perSession = revision.prescriptionModel === "OCCURRENCE";
  const occurrencePhase = perSession
    ? (revision.schedule.phases.find((p) => String(p.index) === one("fase")) ?? revision.schedule.phases[0])
    : null;
  const occurrenceWeek = occurrencePhase
    ? Math.min(Math.max(1, Math.trunc(Number(one("semana")) || 1)), occurrencePhase.microcycles.length || 1)
    : 1;
  const [sessions, history] = await Promise.all([
    occurrencePhase ? prescriptionFor(db, context).occurrences(planId, revisionId, { phaseIndex: occurrencePhase.index }) : Promise.resolve([]),
    perSession ? proposals.history(planId, revisionId) : Promise.resolve(null),
  ]);
  const appliedId = history?.proposals.filter((p) => p.state === "APPLIED").at(-1)?.id ?? null;
  const applied = appliedId ? await proposals.summary(planId, revisionId, appliedId) : null;
  // Edited counts the rows changed in any session too (per-session doses, take-outs and substitutions mark the session doses).
  const automatic = items.some((item) => item.origin === "SYSTEM" || item.origin === "SYSTEM_EDITED")
    ? await prescriptionFor(db, context).automaticCounts(planId, revisionId)
    : { total: 0, edited: 0 };
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
        automatic={automatic.total ? automatic : null}
      />
    ) : null;
  const editor = (
    <PrescriptionEditor
      planId={planId}
      revisionId={revisionId}
      schedule={revision.schedule}
      // The structured dose stays on the server; the editor shows the stored text.
      items={items.map((item) => ({ ...item, doseJson: null }))}
      library={library.map((exercise) => ({
        id: exercise.id,
        name: exercise.name,
        category: exercise.category,
      }))}
      readOnly={revision.state !== "DRAFT"}
      openProposal={Boolean(openProposal)}
      occurrence={
        occurrencePhase
          ? { selfHref, phaseIndex: occurrencePhase.index, week: occurrenceWeek, sessions }
          : undefined
      }
    />
  );
  const notes = applied ? (
    <AppliedProposalNotes header={applied.header} summary={applied.summary} historyHref={`${selfHref}/automatica`} />
  ) : null;
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
      {one("aplicada") === "1" && revision.state === "DRAFT" && (
        <Notice>Proposta aplicada ao rascunho. Revise, edite, marque como pronta e aprove como de costume.</Notice>
      )}
      {/* 0.93: the prescription is the main content of a draft; the structure is folded under it. */}
      {revision.state === "DRAFT" ? (
        <DraftWorkspace
          editor={
            <>
              <AutoPrescriptionCard href={`${selfHref}/automatica`} open={openProposal} applied={perSession} />
              {notes}
              {editor}
            </>
          }
          input={revision.input}
          structureSummary={`${revision.schedule.phases.length} ${revision.schedule.phases.length === 1 ? "fase" : "fases"} · ${revision.schedule.totalWeeks} ${revision.schedule.totalWeeks === 1 ? "semana" : "semanas"} · ${formatCalendarDate(revision.schedule.startDate)} a ${formatCalendarDate(revision.schedule.endDate)}`}
          save={saveDraft.bind(null, planId, revisionId)}
          markReady={markReady.bind(null, planId, revisionId)}
        />
      ) : (
        <>
          {decision}
          {notes}
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
