"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { plansFor } from "@/db/plans";
import type { ManualWorkout } from "@/db/prescription-proposals";
import { requireWorkspace } from "@/modules/auth/server";
import type { GenerationQuestion } from "./contracts";
import {
  proposalService,
  type ApplyPayload,
  type CasPayload,
  type ContinuePayload,
  type FlagPayload,
  type GeneratePayload,
  type LockPayload,
  type ProposalOutcome,
  type RegeneratePayload,
  type SubstitutePayload,
} from "./service";

/**
 * Server actions of the automatic prescription proposal (motor S6, design §4.8). Each one takes the session on the server
 * (`requireWorkspace`: organization and user never come from the browser), takes plan and revision from the route, and hands the
 * rest to `proposalService`, which parses it strictly and goes through repositories gated by the active technical assignment.
 * What comes back has no plan data: a message, a notice, and ids/versions the screen needs for the next compare-and-set.
 *
 * `applyProposal` (motor S7) writes the proposal into the same DRAFT revision; none of these approves or delivers anything.
 */
export type ProposalActionResult = {
  error?: string;
  notice?: string;
  data?: {
    proposalId?: string;
    version?: number;
    complete?: boolean;
    replayed?: boolean;
    contentVersion?: number;
    reason?: string;
    questions?: GenerationQuestion[];
  };
};

function toResult(outcome: ProposalOutcome): ProposalActionResult {
  if (outcome.ok)
    return {
      ...(outcome.notice ? { notice: outcome.notice } : {}),
      data: { proposalId: outcome.proposalId, version: outcome.version, complete: outcome.complete, replayed: outcome.replayed },
    };
  return {
    error: outcome.message,
    data: {
      reason: outcome.reason,
      ...(outcome.proposalId ? { proposalId: outcome.proposalId } : {}),
      ...(outcome.version !== undefined ? { version: outcome.version } : {}),
      ...(outcome.contentVersion !== undefined ? { contentVersion: outcome.contentVersion } : {}),
      ...(outcome.questions ? { questions: outcome.questions } : {}),
    },
  };
}
const refresh = () => revalidatePath("/profissional/alunos", "layout");

async function run(work: (service: ReturnType<typeof proposalService>) => Promise<ProposalOutcome>): Promise<ProposalActionResult> {
  const { db, context } = await requireWorkspace();
  const outcome = await work(proposalService(db, context));
  if (outcome.ok && !outcome.replayed) refresh();
  return toResult(outcome);
}

export async function generateProposal(planId: string, revisionId: string, payload: GeneratePayload): Promise<ProposalActionResult> {
  return run((s) => s.generate(planId, revisionId, payload));
}

export async function continueProposal(planId: string, revisionId: string, payload: ContinuePayload): Promise<ProposalActionResult> {
  return run((s) => s.continue(planId, revisionId, payload));
}

export async function regenerateScope(planId: string, revisionId: string, payload: RegeneratePayload): Promise<ProposalActionResult> {
  return run((s) => s.regenerate(planId, revisionId, payload));
}

export async function substituteExercise(planId: string, revisionId: string, payload: SubstitutePayload): Promise<ProposalActionResult> {
  return run((s) => s.substitute(planId, revisionId, payload));
}

export async function rebaseProposal(planId: string, revisionId: string, payload: ContinuePayload): Promise<ProposalActionResult> {
  return run((s) => s.rebase(planId, revisionId, payload));
}

export async function lockItems(planId: string, revisionId: string, payload: LockPayload): Promise<ProposalActionResult> {
  return run((s) => s.lock(planId, revisionId, payload));
}

export async function acceptFlagDecision(planId: string, revisionId: string, payload: FlagPayload): Promise<ProposalActionResult> {
  return run((s) => s.acceptFlagDecision(planId, revisionId, payload));
}

export async function discardProposal(planId: string, revisionId: string, payload: CasPayload): Promise<ProposalActionResult> {
  return run((s) => s.discard(planId, revisionId, payload));
}

export type ApplyActionResult = {
  error?: string;
  data?: {
    reason?: string;
    version?: number;
    contentVersion?: number;
    phasesMissing?: number[];
    workouts?: ManualWorkout[];
    exerciseIds?: string[];
  };
};

/**
 * "Aplicar ao rascunho". On success the professional is taken to the revision page (`?aplicada=1`), where the existing flow
 * continues: review, edit, mark ready, approve, deliver. `redirect` throws by design, so it is called outside any try/catch.
 */
export async function applyProposal(planId: string, revisionId: string, payload: ApplyPayload): Promise<ApplyActionResult> {
  const { db, context } = await requireWorkspace();
  const outcome = await proposalService(db, context).apply(planId, revisionId, payload);
  if (!outcome.ok) {
    const { ok, message, reason, ...rest } = outcome;
    void ok;
    return { error: message, data: { reason, ...rest } };
  }
  const detail = await plansFor(db, context).findRevision(planId, revisionId);
  if (!outcome.replayed) refresh();
  if (!detail) return {};
  redirect(`/profissional/alunos/${detail.plan.studentId}/planos/${planId}/${revisionId}?aplicada=1`);
}
