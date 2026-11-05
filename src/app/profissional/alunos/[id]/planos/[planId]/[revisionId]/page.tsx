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
import { RevisionOverview } from "@/modules/planos/revision-overview";
import { proposalsFor } from "@/db/prescription-proposals";
import { AppliedProposalNotes, AutoPrescriptionCard } from "@/modules/prescricao/automatica/auto-card";
import { formatCalendarDate } from "@/modules/training/format";
import { createRevision, saveDraft } from "@/modules/planos/actions";
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
  // 0.96: one strip for approval and delivery. Same data for a draft, a ready, an approved and a delivered revision.
  const approval = {
    planId,
    revisionId,
    revisionNumber: revision.revisionNumber,
    below: progress.filter((slot) => slot.status === "BELOW").length,
    workouts: progress.length,
    exercises: items.length,
    approvedAt: revision.approvedAt,
    deliveredAt: revision.deliveredAt,
    deliveredByName: revision.deliveredByName,
    deliveredOrganizationName: revision.deliveredOrganizationName,
    portal: access?.access ?? "NONE",
    studentHref: `/profissional/alunos/${student.id}`,
    screening,
    pdfHref: `/profissional/alunos/${student.id}/planos/${planId}/${revisionId}/pdf`,
    automatic: automatic.total ? automatic : null,
    historyHref: perSession ? `${selfHref}/automatica` : null,
    // The notes the applied proposal recorded (alerts, warnings, assumptions): the same count the folded notes of a draft show.
    records: applied
      ? applied.summary.flags.length +
        applied.summary.issues.filter((issue) => issue.severity !== "INFO").length +
        applied.summary.assumptions.length
      : 0,
    openProposal: Boolean(openProposal),
  } as const;
  const decision =
    revision.state === "READY" || revision.state === "APPROVED" || revision.state === "DELIVERED" ? (
      <ApprovalPanel
        {...approval}
        state={revision.state}
        createRevision={createRevision.bind(null, planId, revisionId)}
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
      {revision.state === "DRAFT" ? (
        <PageHeading
          eyebrow={`${student.displayName} · Revisão ${revision.revisionNumber}`}
          title={detail.plan.title}
          description="Rascunho em edição. Prescreva os exercícios de cada treino; a estrutura do ciclo fica logo abaixo. Quando estiver certo, use Aprovar e entregar: depois disso a revisão não aceita mais edição."
          aside={<Pill tone={label.tone}>{label.text}</Pill>}
        />
      ) : (
        <header className="fa-head">
          <Link className="fa-back fa-n" href="/profissional/planos">
            <span aria-hidden="true">‹</span> Planos e treinos
          </Link>
          <nav className="fa-crumbs fa-w" aria-label="Trilha">
            <Link href={`/profissional/alunos/${student.id}`}>{student.displayName}</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">Revisão {revision.revisionNumber}</span>
          </nav>
          <h1>{detail.plan.title}</h1>
          <p className="fa-head-line fa-w">
            {revision.state === "READY"
              ? "Revisão pronta para aprovação e entrega"
              : revision.state === "APPROVED"
                ? "Aprovada, aguardando entrega"
                : "Revisão entregue · somente leitura"}
          </p>
          <p className="fa-head-line fa-n">
            Revisão {revision.revisionNumber} · {revision.state === "READY" ? "pronta para aprovação" : revision.state === "APPROVED" ? "aprovada, não entregue" : "entregue"}
          </p>
        </header>
      )}
      {one("aplicada") === "1" && revision.state === "DRAFT" && (
        <Notice>Proposta aplicada ao rascunho. Revise, edite e use Aprovar e entregar quando estiver certo.</Notice>
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
          approval={approval}
        />
      ) : (
        <>
          {decision}
          <RevisionOverview
            state={revision.state as "READY" | "APPROVED" | "DELIVERED"}
            schedule={revision.schedule}
            progress={progress}
            items={items.map((item) => ({
              id: item.id,
              phaseIndex: item.phaseIndex,
              workoutLabel: item.workoutLabel,
              position: item.position,
              name: item.name,
              sets: item.sets,
              reps: item.reps,
              loadInstruction: item.loadInstruction,
              cadence: item.cadence,
              restSeconds: item.restSeconds,
              restText: item.restText,
              rirMin: item.rirMin,
              rirMax: item.rirMax,
              notes: item.notes,
              doseText: item.doseText ?? null,
            }))}
            perSession={perSession}
            records={approval.records > 0 ? { count: approval.records, href: `${selfHref}/automatica` } : null}
            access={
              revision.state === "DELIVERED" && approval.portal !== "ACTIVE"
                ? {
                    text:
                      approval.portal === "INVITED"
                        ? "O convite do aluno ainda está pendente. A revisão ficará visível quando o acesso for habilitado."
                        : "Acesso do aluno ainda inativo. A revisão ficará visível quando o acesso for habilitado.",
                    href: approval.studentHref,
                  }
                : null
            }
            full={
              <>
                {notes}
                {editor}
                <PlanReadOnly schedule={revision.schedule} />
              </>
            }
          />
        </>
      )}
      <Link href={`/profissional/alunos/${student.id}?aba=periodizacao`} className="button secondary">
        <ArrowLeft size={17} /> Voltar ao aluno
      </Link>
    </>
  );
}
