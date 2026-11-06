"use server";
import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/modules/auth/server";
import {
  ADJUST_MESSAGE, adjustService, type AdjustApplyOutcome, type AdjustAvailability, type AdjustFailureOutcome, type AdjustOutcome, type AlternativesOutcome, type SuggestionView,
} from "./adjust-service";
import { planFailureOfGate } from "./orchestration";

/**
 * Server actions of the assisted adjustments (sub-stage 4.3). Each takes the session on the server (`requireWorkspace`: organization and user
 * never come from the browser), takes plan and revision from the route and hands the rest to `adjustService`, which parses it strictly and goes
 * through the gated repositories. What comes back is client-safe: a suggestion with fixed pt-BR sentences, exercise names of the visible library
 * and a diff; never a provider, model, key, cost, hash, prompt or id of the student.
 *
 * `applyAdjustment` writes ONLY the proposal (a new version, through the proposal service); none of these approves, applies to the draft or
 * delivers anything.
 */
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const bad = (): AdjustFailureOutcome => ({ ok: false, reason: "invalid", message: ADJUST_MESSAGE.invalid, canUseEngine: false });

async function service() {
  const { db, context, workspace } = await requireWorkspace();
  return adjustService(db, context, { extraIdentifiers: [workspace.name] });
}

export interface AdjustAvailabilityView {
  /** READY, or the coarse reason a professional may know. */
  state: "READY" | string;
  message: string;
  /** Tokens only, read-only: the professional never sees a cost. */
  usage: AdjustAvailability["usage"];
}

/** Whether "Sugerir alternativa com IA" can be offered for this revision, and the read-only usage line. Calls nothing external. */
export async function getAdjustAvailability(planId: string, revisionId: string): Promise<AdjustAvailabilityView | null> {
  if (!ID.test(String(planId)) || !ID.test(String(revisionId))) return null;
  const found = await (await service()).availability(planId, revisionId);
  if (!found) return null;
  return { state: found.state === "READY" ? "READY" : planFailureOfGate(found.state), message: found.message, usage: found.usage };
}

/** The engine's alternatives for the item, each with the ticked constraints evaluated. Reads only. */
export async function loadAdjustAlternatives(planId: string, revisionId: string, payload: unknown): Promise<AlternativesOutcome> {
  if (!ID.test(String(planId)) || !ID.test(String(revisionId))) return bad();
  return (await service()).alternatives(planId, revisionId, payload);
}

/** "Sugerir alternativa com IA" / "Ver impacto": a suggestion with the before/after. Never changes the proposal. */
export async function suggestAdjustment(planId: string, revisionId: string, payload: unknown): Promise<AdjustOutcome> {
  if (!ID.test(String(planId)) || !ID.test(String(revisionId))) return bad();
  return (await service()).suggest(planId, revisionId, payload);
}

/** "Aplicar ajuste à proposta": a new version of the proposal with ONLY that point change. */
export async function applyAdjustment(planId: string, revisionId: string, payload: unknown): Promise<AdjustApplyOutcome> {
  if (!ID.test(String(planId)) || !ID.test(String(revisionId))) return bad();
  const out = await (await service()).apply(planId, revisionId, payload);
  if (out.ok && !out.replayed) revalidatePath("/profissional/alunos", "layout");
  return out;
}

/** "Descartar sugestão": records the decision; the proposal is untouched. */
export async function rejectAdjustment(planId: string, revisionId: string, payload: unknown): Promise<{ ok: true } | AdjustFailureOutcome> {
  if (!ID.test(String(planId)) || !ID.test(String(revisionId))) return bad();
  return (await service()).reject(planId, revisionId, payload);
}

/** The newest undecided suggestion that still applies to the open version (to show it again after a reload). */
export async function getCurrentAdjustment(planId: string, revisionId: string, proposalId: string): Promise<SuggestionView | null> {
  if (!ID.test(String(planId)) || !ID.test(String(revisionId)) || !ID.test(String(proposalId))) return null;
  return (await service()).current(planId, revisionId, proposalId);
}
