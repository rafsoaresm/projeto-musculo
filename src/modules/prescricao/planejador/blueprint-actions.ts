"use server";
import { requireWorkspace } from "@/modules/auth/server";
import type { ProposalOutcome } from "@/modules/prescricao/automatica/service";
import {
  ACCEPT_MESSAGE, blueprintService, type AcceptanceView, type AcceptOutcome, type AcceptPayload, type BlueprintGeneratePayload, type BlueprintReplanPayload,
} from "./accept";
import type { StrategyListView } from "./strategy-view";

/**
 * Server actions of the strategy acceptance (sub-stage 2.3; PR 4 wires the screens). Each takes the session on the server (organization and
 * user never come from the browser), takes plan and revision from the route and hands the rest to `blueprintService`, which parses it strictly
 * and goes through the gated repositories. The compiled strategy is never an input: the server builds it from the stored acceptance.
 *
 * None of these applies a proposal, approves or delivers anything: a generation only creates an OPEN proposal.
 */
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const badId = (): AcceptOutcome => ({ ok: false, reason: "not_found", message: ACCEPT_MESSAGE.not_found });
const badProposal = (): ProposalOutcome => ({ ok: false, reason: "not_found", message: ACCEPT_MESSAGE.not_found });

async function service() {
  const { db, context } = await requireWorkspace();
  return blueprintService(db, context);
}

/** "Aceitar estratégia": records the choice (and the professional's edits of the focus) for the revision. */
export async function acceptStrategy(planId: string, revisionId: string, payload: AcceptPayload): Promise<AcceptOutcome> {
  if (!ID.test(String(planId)) || !ID.test(String(revisionId))) return badId();
  return (await service()).accept(planId, revisionId, payload);
}

/** "Gerar com a estratégia aceita": a new OPEN proposal built from the accepted strategy. */
export async function generateFromStrategy(planId: string, revisionId: string, payload: BlueprintGeneratePayload): Promise<ProposalOutcome> {
  if (!ID.test(String(planId)) || !ID.test(String(revisionId))) return badProposal();
  return (await service()).generate(planId, revisionId, payload);
}

/** "Voltar à estratégia" on an open proposal (a phase, from a phase on, or all). */
export async function replanFromStrategy(planId: string, revisionId: string, payload: BlueprintReplanPayload): Promise<ProposalOutcome> {
  if (!ID.test(String(planId)) || !ID.test(String(revisionId))) return badProposal();
  return (await service()).replan(planId, revisionId, payload);
}

/** What a replan would keep (the professional's decisions) and replace (the engine's picks). */
export async function previewReplan(planId: string, revisionId: string, proposalId: string, scope: BlueprintReplanPayload["scope"]): Promise<{ kept: number; replaced: number; phases: number[] } | null> {
  if (!ID.test(String(planId)) || !ID.test(String(revisionId)) || !ID.test(String(proposalId))) return null;
  return (await service()).replanPreview(planId, revisionId, proposalId, scope);
}

/** The newest suggested strategies and the newest acceptance of the revision. */
export async function getStrategyAcceptance(planId: string, revisionId: string): Promise<{ run: StrategyListView; acceptance: AcceptanceView | null } | null> {
  if (!ID.test(String(planId)) || !ID.test(String(revisionId))) return null;
  return (await service()).current(planId, revisionId);
}
