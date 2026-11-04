import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireWorkspace } from "@/modules/auth/server";
import { studentsFor } from "@/db/students";
import { plansFor } from "@/db/plans";
import { proposalsFor } from "@/db/prescription-proposals";
import { exercisesFor } from "@/db/exercises";
import { recordStudentRead } from "@/db/student-reads";
import { PageHeading, Pill, formatDateTime } from "@/components/ui";
import { stateLabel } from "@/modules/planos/labels";
import { proposalService } from "@/modules/prescricao/automatica/service";
import { ContextSummary } from "@/modules/prescricao/automatica/context-summary";
import { GenerationForm } from "@/modules/prescricao/automatica/generation-form";
import { ProposalView, type ProposalHeaderView } from "@/modules/prescricao/automatica/proposal-view";
import { ApplyPanel } from "@/modules/prescricao/automatica/apply-panel";
import { canAcceptSuggestions, pageAudit, pickPhase, pickWeek } from "@/modules/prescricao/automatica/view";
import { getRuleSet } from "@/modules/prescricao/motor/rules";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Prescrição automática" };

const ACTION_LABELS: Record<string, string> = {
  GENERATED: "Gerada",
  CONTINUED: "Geração continuada",
  REGENERATE_ITEM: "Exercício trocado pela ferramenta",
  REGENERATE_OCCURRENCE: "Sessão regenerada",
  REGENERATE_WEEK: "Semana regenerada",
  REGENERATE_WORKOUT: "Treino regenerado",
  REGENERATE_PHASE: "Fase regenerada",
  REGENERATE_FROM_PHASE: "Fases regeneradas",
  SUBSTITUTE: "Exercício substituído",
  LOCK: "Exercício mantido",
  UNLOCK: "Exercício destravado",
  ACCEPT_FLAG_DECISION: "Decisão de alerta",
  REBASE: "Atualizada com o rascunho",
  DISCARD: "Descartada",
  APPLY: "Aplicada ao rascunho",
};
const STATE_LABELS: Record<string, string> = { OPEN: "Aberta", APPLIED: "Aplicada", DISCARDED: "Descartada", SUPERSEDED: "Substituída ao marcar como pronta" };

/**
 * The automatic prescription of one revision (design §6.1): on a DRAFT, the generation form when no proposal is open, or the open
 * proposal with its review operations and the apply panel. On a revision past DRAFT, only the history (read-only). The same guards
 * as the revision page: the session's organization and user, the plan of the student in the address, and the read trail.
 */
export default async function AutomaticPrescription({
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
  if (!detail || detail.plan.studentId !== student.id) notFound();
  await recordStudentRead(db, context, student.id, "PLAN_REVISION");
  const { revision } = detail;
  const revisionHref = `/profissional/alunos/${student.id}/planos/${planId}/${revisionId}`;
  const selfHref = `${revisionHref}/automatica`;
  const repo = proposalsFor(db, context);
  const service = proposalService(db, context);
  const label = stateLabel(revision.state);
  const heading = (
    <PageHeading
      eyebrow={`${student.displayName} · ${detail.plan.title} · Revisão ${revision.revisionNumber}`}
      title="Prescrição automática"
      description="Proposta gerada a partir da periodização salva e dos dados do aluno, para você revisar. Nada é aprovado nem liberado ao aluno por aqui."
      aside={<Pill tone={label.tone}>{label.text}</Pill>}
    />
  );
  const back = (
    <Link href={revisionHref} className="button secondary">
      <ArrowLeft size={17} /> Voltar à revisão
    </Link>
  );

  if (revision.state !== "DRAFT") {
    const history = await repo.history(planId, revisionId);
    return (
      <>
        {heading}
        <section className="panel" aria-labelledby="historico-titulo">
          <h2 id="historico-titulo">Histórico das propostas</h2>
          <p className="muted">Esta revisão não está mais em rascunho: nada pode ser gerado nem aplicado aqui. O histórico fica como registro.</p>
          {history.proposals.length === 0 ? (
            <p className="small muted">Nenhuma proposta automática foi gerada para esta revisão.</p>
          ) : (
            <ul className="auto-list">
              {history.proposals.map((p) => (
                <li key={p.id}>
                  <strong>{STATE_LABELS[p.state] ?? p.state}</strong> <span className="small muted">· criada em {formatDateTime(p.createdAt)}</span>
                  <ul className="auto-list small">
                    {p.decisions.map((d, n) => (
                      <li key={n}>
                        {ACTION_LABELS[d.action] ?? d.action} · {formatDateTime(d.createdAt)}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </section>
        {back}
      </>
    );
  }

  const open = await repo.open(planId, revisionId);
  if (!open) {
    const loaded = await service.screen(planId, revisionId);
    if (loaded.status !== "ok") notFound();
    const { screen } = loaded;
    return (
      <>
        {heading}
        <ContextSummary considered={screen.considered} freeText={screen.freeText} assumptions={screen.assumptions} />
        <GenerationForm planId={planId} revisionId={revisionId} screen={screen} />
        {back}
      </>
    );
  }

  const first = await repo.summary(planId, revisionId, open.id);
  if (!first) notFound();
  const phaseIndex = pickPhase(first.summary.phases, open.phasesGenerated, one("fase"));
  const [page, preview, library] = await Promise.all([
    phaseIndex === null ? Promise.resolve(null) : repo.view(planId, revisionId, open.id, { phaseIndex }),
    service.previewApply(planId, revisionId, open.id),
    exercisesFor(db, context).list(),
  ]);
  if (!page || phaseIndex === null) notFound();
  const phase = page.summary.phases.find((p) => p.phaseIndex === phaseIndex);
  const week = pickWeek(phase, one("semana"));
  // The audit recorded with the proposal comes with the summary already read; only a proposal generated before the audit has
  // it computed now (design V3 §3.9), never written back.
  const audit = await pageAudit(page.summary, () => service.viewAudit(planId, revisionId, open.id));
  // Sent to the screen once, as `audit`, not twice.
  const summaryWithoutAudit = { ...page.summary };
  delete summaryWithoutAudit.audit;
  const header: ProposalHeaderView = {
    id: page.header.id,
    version: page.header.version,
    baseContentVersion: page.header.baseContentVersion,
    contentVersion: page.header.contentVersion,
    status: page.header.status,
    validation: page.header.validation,
    complete: page.header.complete,
    phasesGenerated: page.header.phasesGenerated,
    engineVersion: page.header.engineVersion,
    rulesId: page.header.rulesId,
    rulesVersion: page.header.rulesVersion,
    createdAt: page.header.createdAt,
    updatedAt: page.header.updatedAt,
  };
  return (
    <>
      {heading}
      <ProposalView
        planId={planId}
        revisionId={revisionId}
        selfHref={selfHref}
        header={header}
        summary={summaryWithoutAudit}
        occurrences={page.occurrences}
        phaseIndex={phaseIndex}
        week={week}
        library={library.map((exercise) => ({ id: exercise.id, name: exercise.name }))}
        audit={audit}
        acceptSuggestions={canAcceptSuggestions(getRuleSet({ id: page.header.rulesId, version: page.header.rulesVersion }))}
      />
      {preview && (
        <ApplyPanel
          planId={planId}
          revisionId={revisionId}
          proposalId={open.id}
          version={page.header.version}
          counts={preview.counts}
          manualWorkouts={preview.manualWorkouts}
          phasesMissing={preview.phasesMissing}
          infeasible={preview.infeasible}
          catalogChanged={preview.catalogChanged.length}
          stale={page.header.contentVersion !== page.header.baseContentVersion}
        />
      )}
      {back}
    </>
  );
}
