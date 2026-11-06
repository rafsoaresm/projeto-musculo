"use server";
import { requireWorkspace } from "@/modules/auth/server";
import { PLAN_MESSAGE } from "./copy";
import {
  planFailureOfGate, plannerService, type Availability, type PlanFailure, type PlanningOutcome, type PlanningState, type PlanPayload,
} from "./orchestration";
import type { StrategyListView } from "./strategy-view";

/**
 * Server actions of the strategy planner (sub-stage 1.3; PR 4 wires the screens). Each takes the session on the server
 * (`requireWorkspace`: organization and user never come from the browser), takes plan and revision from the route and hands the rest to
 * `plannerService`, which parses it strictly and goes through the gated repositories. What comes back is client-safe: strategies with
 * real labels and fixed names, a message, a state. Never a provider, model, key, cost, hash (but the run id) or prompt.
 *
 * None of these applies a strategy, approves or delivers anything: they only suggest (PR 2 compiles an accepted one into a generation).
 */
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const badId = (): PlanningOutcome => ({ ok: false, reason: "not_found", message: PLAN_MESSAGE.not_found, canContinueByRules: false });

async function planner() {
  const { db, context, workspace } = await requireWorkspace();
  return plannerService(db, context, { extraIdentifiers: [workspace.name] });
}

export interface PlanningAvailability {
  /** READY, or the coarse reason a professional may know. */
  state: "READY" | PlanFailure;
  message: string;
  /** Tokens only, read-only: the professional never sees a cost. */
  usage: Availability["usage"];
}

/** GEN-01: whether "Planejar com IA" can be offered for this revision, and the read-only usage line. Calls nothing external. */
export async function getPlanningAvailability(planId: string, revisionId: string): Promise<PlanningAvailability | null> {
  if (!ID.test(String(planId)) || !ID.test(String(revisionId))) return null;
  const found = await (await planner()).availability(planId, revisionId);
  if (!found) return null;
  return { state: found.state === "READY" ? "READY" : planFailureOfGate(found.state), message: found.message, usage: found.usage };
}

/** "Planejar com IA" or "Continuar por regras": one planning call for the whole cycle. */
export async function planStrategies(planId: string, revisionId: string, payload: PlanPayload): Promise<PlanningOutcome> {
  if (!ID.test(String(planId)) || !ID.test(String(revisionId))) return badId();
  return (await planner()).plan(planId, revisionId, payload);
}

/** The explicit state of the revision's planning (none, generating, failed with the way out, ready). */
export async function getPlanningState(planId: string, revisionId: string): Promise<PlanningState> {
  if (!ID.test(String(planId)) || !ID.test(String(revisionId))) return { state: "NONE" };
  return (await planner()).state(planId, revisionId);
}

/** The newest suggested strategies of the revision (AI or rules), or null. */
export async function getLatestStrategies(planId: string, revisionId: string): Promise<StrategyListView | null> {
  if (!ID.test(String(planId)) || !ID.test(String(revisionId))) return null;
  return (await planner()).latest(planId, revisionId);
}
