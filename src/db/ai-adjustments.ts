import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import type { AiTask } from "@/modules/prescricao/planejador/provedores/port";
import {
  AI_CACHE_PURGE_BATCH, AI_MAX_RUNNING_PER_ORG, cachePutStatements, changesOf, iso, ledgerStatements, MEMBER, reserveStatements,
  type CachePutInput, type LedgerAction, type ReserveInput, type ReserveResult,
} from "./ai-planning";
import { revisionGate } from "./revision-gates";
import { assertContext, type AuthenticatedContext } from "./students";

/**
 * Organization-side repository of the assisted adjustments (design V4 §6.7, sub-stage 4.3b): the structured request (idempotent per
 * proposal and key), the single-flight guard of the AI mode, the suggestion with its diff (deletable with the student's data) and the
 * professional's decision (one per request, append-only). The ledger, the cache and the circuit are the planner's (`ai-planning.ts`);
 * this module only adds the rows that belong to a proposal.
 *
 * Isolation: organization and user come from the verified session, never a payload. Every statement filters `organization_id` and
 * carries the shared revision gate (organization + active user + active technical assignment). Nothing here writes a prescription,
 * approves or delivers: the proposal itself changes only through the proposal repository.
 *
 * Binding convention (as the planner's): ?1 organization, ?2 user, ?3 plan, ?4 revision, then statement-specific.
 */

export type AdjustmentMode = "AI" | "STRUCTURED";
export type AdjustmentStatus = "RUNNING" | "SUCCEEDED" | "FAILED";
export type AdjustmentDecisionKind = "APPLIED" | "REJECTED" | "EXPIRED";

export interface AdjustmentRow {
  id: string;
  planId: string;
  revisionId: string;
  proposalId: string;
  baseVersion: number;
  idempotencyKey: string;
  requestHash: string;
  requestJson: string;
  mode: AdjustmentMode;
  status: AdjustmentStatus;
  failureCode: string | null;
  attempt: number;
  contextHash: string | null;
  cacheKey: string | null;
  cacheHit: boolean;
  providerKind: string | null;
  modelId: string | null;
  promptVersion: string | null;
  responseHash: string | null;
  usageJson: string | null;
  ledgerId: string | null;
  startedAt: string;
  finishedAt: string | null;
}
interface Raw extends Omit<AdjustmentRow, "cacheHit"> {
  cacheHit: number;
}
const COLUMNS = `a.id, a.plan_id AS planId, a.revision_id AS revisionId, a.proposal_id AS proposalId, a.base_version AS baseVersion, a.idempotency_key AS idempotencyKey,
  a.request_hash AS requestHash, a.request_json AS requestJson, a.mode, a.status, a.failure_code AS failureCode, a.attempt, a.context_hash AS contextHash,
  a.cache_key AS cacheKey, a.cache_hit AS cacheHit, a.provider_kind AS providerKind, a.model_id AS modelId, a.prompt_version AS promptVersion,
  a.response_hash AS responseHash, a.usage_json AS usageJson, a.ledger_id AS ledgerId, a.started_at AS startedAt, a.finished_at AS finishedAt`;
const toRow = (raw: Raw): AdjustmentRow => ({ ...raw, cacheHit: raw.cacheHit === 1 });

export interface AdjustmentStartInput {
  id: string;
  planId: string;
  revisionId: string;
  proposalId: string;
  baseVersion: number;
  idempotencyKey: string;
  requestHash: string;
  requestJson: string;
  mode: AdjustmentMode;
  contextHash: string | null;
  cacheKey: string | null;
  providerKind: string | null;
  modelId: string | null;
  promptVersion: string | null;
  now: Date;
  /** AI requests started before this instant no longer count against the per-organization ceiling. */
  staleBefore?: Date;
}
export type AdjustmentStartResult = { ok: true } | { ok: false; reason: "duplicate_key" | "in_flight" | "busy" | "not_found" };

export interface AdjustmentFinishInput {
  requestId: string;
  planId: string;
  revisionId: string;
  attempt: number;
  status: "SUCCEEDED" | "FAILED";
  failureCode: string | null;
  cacheHit: boolean;
  responseHash: string | null;
  usageJson: string | null;
  ledgerId: string | null;
  now: Date;
  ledger?: LedgerAction | null;
  cache?: CachePutInput;
  /** The suggestion (ops with real ids, reason codes, diff). Deletable with the student's data. */
  payloadJson?: string;
  /**
   * Retention of DECIDED suggestions (applied, rejected or expired): when this call stores a suggestion it also deletes up to
   * `AI_CACHE_PURGE_BATCH` suggestions of THIS organization decided more than this many days ago (default: the cache validity). Undecided
   * suggestions are never purged by age: the professional may still be looking at them.
   */
  retentionDays?: number;
}

export const ADJUSTMENT_PAYLOAD_RETENTION_DEFAULT_DAYS = 14;

export function aiAdjustmentsFor(db: D1Database, context: AuthenticatedContext | null) {
  const { userId, organizationId } = assertContext(context);
  const ctx = { organizationId, userId };

  async function one(planId: string, revisionId: string, where: string, ...binds: unknown[]): Promise<AdjustmentRow | null> {
    const row = await db
      .prepare(`SELECT ${COLUMNS} FROM adjustment_requests a WHERE a.organization_id = ?1 AND a.plan_id = ?3 AND a.revision_id = ?4 AND ${revisionGate("ANY")} AND ${where}`)
      .bind(organizationId, userId, planId, revisionId, ...binds)
      .first<Raw>();
    return row ? toRow(row) : null;
  }

  return {
    requestByKey: (planId: string, revisionId: string, proposalId: string, idempotencyKey: string) =>
      one(planId, revisionId, "a.proposal_id = ?5 AND a.idempotency_key = ?6", proposalId, idempotencyKey),
    requestById: (planId: string, revisionId: string, requestId: string) => one(planId, revisionId, "a.id = ?5", requestId),
    runningByCacheKey: (planId: string, revisionId: string, cacheKey: string) => one(planId, revisionId, "a.status = 'RUNNING' AND a.cache_key = ?5", cacheKey),

    /** The newest suggestion of a proposal that is still undecided (to show it again after a reload). */
    async latestUndecided(planId: string, revisionId: string, proposalId: string): Promise<AdjustmentRow | null> {
      const row = await db
        .prepare(
          `SELECT ${COLUMNS} FROM adjustment_requests a
            WHERE a.organization_id = ?1 AND a.plan_id = ?3 AND a.revision_id = ?4 AND a.proposal_id = ?5 AND a.status = 'SUCCEEDED' AND ${revisionGate("ANY")}
              AND NOT EXISTS (SELECT 1 FROM adjustment_decisions d WHERE d.organization_id = a.organization_id AND d.request_id = a.id)
              AND EXISTS (SELECT 1 FROM adjustment_payloads p WHERE p.organization_id = a.organization_id AND p.request_id = a.id)
            ORDER BY a.started_at DESC, a.rowid DESC LIMIT 1`,
        )
        .bind(organizationId, userId, planId, revisionId, proposalId)
        .first<Raw>();
      return row ? toRow(row) : null;
    },

    /**
     * Inserts a RUNNING request of an OPEN proposal at exactly `baseVersion`. UNIQUE (organization, proposal, key) and the single-flight index on
     * (organization, cache key) turn a duplicate into a typed answer. AI requests count against the same per-organization ceiling as planning runs;
     * STRUCTURED ones (no provider) never do.
     */
    async start(input: AdjustmentStartInput): Promise<AdjustmentStartResult> {
      const gate = revisionGate("DRAFT");
      const open = `EXISTS (SELECT 1 FROM prescription_proposals p WHERE p.organization_id = ?1 AND p.id = ?5 AND p.plan_id = ?3 AND p.revision_id = ?4 AND p.state = 'OPEN' AND p.version = ?7)`;
      try {
        const result = await db
          .prepare(
            `INSERT INTO adjustment_requests (id, organization_id, plan_id, revision_id, proposal_id, base_version, idempotency_key, request_hash, request_json, mode, status,
               attempt, context_hash, cache_key, provider_kind, model_id, prompt_version, requested_by_user_id, started_at)
             SELECT ?15, ?1, ?3, ?4, ?5, ?7, ?6, ?8, ?9, ?10, 'RUNNING', 1, ?11, ?12, ?13, ?14, ?16, ?2, ?17
              WHERE ${gate} AND ${open}
                AND (?10 = 'STRUCTURED' OR (
                  (SELECT COUNT(*) FROM planning_runs WHERE organization_id = ?1 AND status = 'RUNNING' AND mode = 'AI' AND (?18 IS NULL OR started_at >= ?18))
                  + (SELECT COUNT(*) FROM adjustment_requests WHERE organization_id = ?1 AND status = 'RUNNING' AND mode = 'AI' AND (?18 IS NULL OR started_at >= ?18))) < ${AI_MAX_RUNNING_PER_ORG})`,
          )
          .bind(
            organizationId, userId, input.planId, input.revisionId, input.proposalId, input.idempotencyKey, input.baseVersion, input.requestHash, input.requestJson, input.mode,
            input.contextHash, input.cacheKey, input.providerKind, input.modelId, input.id, input.promptVersion, iso(input.now), input.staleBefore ? iso(input.staleBefore) : null,
          )
          .run();
        if (changesOf(result) === 1) return { ok: true };
      } catch {
        // A unique violation: say WHICH one by reading the rows again, never by parsing the driver message.
        if (await one(input.planId, input.revisionId, "a.proposal_id = ?5 AND a.idempotency_key = ?6", input.proposalId, input.idempotencyKey)) return { ok: false, reason: "duplicate_key" };
        if (input.cacheKey && (await one(input.planId, input.revisionId, "a.status = 'RUNNING' AND a.cache_key = ?5", input.cacheKey))) return { ok: false, reason: "in_flight" };
        throw new Error("ADJUSTMENT_REQUEST_INSERT_FAILED");
      }
      const reach = await db.prepare(`SELECT 1 AS ok WHERE ${gate} AND ${open}`).bind(organizationId, userId, input.planId, input.revisionId, input.proposalId, "", input.baseVersion).first();
      return { ok: false, reason: reach ? "busy" : "not_found" };
    },

    /** Reserves tokens for one attempt (task ADJUSTMENTS): the planner's conditional reserve, race-safe, in one batch. */
    async reserve(input: Omit<ReserveInput, "task" | "runId">): Promise<ReserveResult> {
      const statements = reserveStatements(db, ctx, { ...input, task: "ADJUSTMENTS" as AiTask }, null);
      const results = await db.batch(statements);
      return changesOf(results[statements.length - 1]) === 1 ? { ok: true, ledgerId: input.ledgerId } : { ok: false };
    },

    /**
     * Finishes a request (CAS on status and attempt). Optionally in the SAME batch: the ledger action, the cache entry and the suggestion.
     * Returns whether the request was finished by this call.
     */
    async finish(input: AdjustmentFinishInput): Promise<boolean> {
      const statements: D1PreparedStatement[] = [];
      if (input.ledger) statements.push(...ledgerStatements(db, ctx, input.ledger));
      const at = statements.length;
      statements.push(
        db
          .prepare(
            `UPDATE adjustment_requests SET status = ?5, failure_code = ?6, cache_hit = ?7, response_hash = ?8, usage_json = ?9, ledger_id = ?10, finished_at = ?11
              WHERE id = ?3 AND organization_id = ?1 AND revision_id = ?4 AND status = 'RUNNING' AND attempt = ?12 AND ${MEMBER("?1", "?2")}`,
          )
          .bind(organizationId, userId, input.requestId, input.revisionId, input.status, input.failureCode, input.cacheHit ? 1 : 0, input.responseHash, input.usageJson, input.ledgerId, iso(input.now), input.attempt),
      );
      const ownRequest = `EXISTS (SELECT 1 FROM adjustment_requests WHERE id = %REQ% AND organization_id = ?1 AND status = 'SUCCEEDED' AND attempt = %ATT%)`;
      if (input.cache && input.status === "SUCCEEDED")
        statements.push(...cachePutStatements(db, ctx, input.cache, { sql: ownRequest.replace("%REQ%", "?16").replace("%ATT%", "?17"), binds: [input.requestId, input.attempt] }));
      if (input.payloadJson !== undefined && input.status === "SUCCEEDED") {
        statements.push(
          db
            .prepare(
              `INSERT INTO adjustment_payloads (request_id, organization_id, student_id, suggestion_json, created_at)
               SELECT ?3, ?1, tp.student_id, ?5, ?6 FROM training_plans tp
                WHERE tp.organization_id = ?1 AND tp.id = ?7 AND ${MEMBER("?1", "?2")}
                  AND EXISTS (SELECT 1 FROM adjustment_requests WHERE id = ?3 AND organization_id = ?1 AND status = 'SUCCEEDED' AND attempt = ?8)`,
            )
            .bind(organizationId, userId, input.requestId, input.revisionId, input.payloadJson, iso(input.now), input.planId, input.attempt),
        );
      }
      if (input.payloadJson !== undefined && input.status === "SUCCEEDED") {
        const cutoff = new Date(input.now.getTime() - (input.retentionDays ?? ADJUSTMENT_PAYLOAD_RETENTION_DEFAULT_DAYS) * 86_400_000);
        statements.push(
          db
            .prepare(
              `DELETE FROM adjustment_payloads WHERE rowid IN (
                 SELECT p.rowid FROM adjustment_payloads p JOIN adjustment_decisions d ON d.organization_id = p.organization_id AND d.request_id = p.request_id
                  WHERE p.organization_id = ?1 AND d.decided_at <= ?3 LIMIT ${AI_CACHE_PURGE_BATCH}) AND ${MEMBER("?1", "?2")}`,
            )
            .bind(organizationId, userId, iso(cutoff)),
        );
      }
      const results = await db.batch(statements);
      return changesOf(results[at]) === 1;
    },

    /** A stale RUNNING request that blocks the single-flight key: mark it FAILED/STALE (its reservation is charged by the planner's sweep). */
    async expireStale(planId: string, revisionId: string, requestId: string, expectedStartedAt: string, now: Date): Promise<boolean> {
      const result = await db
        .prepare(
          `UPDATE adjustment_requests SET status = 'FAILED', failure_code = 'STALE', finished_at = ?5 WHERE id = ?3 AND organization_id = ?1 AND revision_id = ?4 AND plan_id = ?7
             AND status = 'RUNNING' AND started_at = ?6 AND ${MEMBER("?1", "?2")}`,
        )
        .bind(organizationId, userId, requestId, revisionId, iso(now), expectedStartedAt, planId)
        .run();
      return changesOf(result) === 1;
    },

    /** The stored suggestion (reach is proven through the revision gate). Null once erased with the student's data. */
    async payloadOf(planId: string, revisionId: string, requestId: string): Promise<string | null> {
      const row = await db
        .prepare(
          `SELECT p.suggestion_json AS json FROM adjustment_payloads p JOIN adjustment_requests a ON a.organization_id = p.organization_id AND a.id = p.request_id
            WHERE p.organization_id = ?1 AND p.request_id = ?5 AND a.plan_id = ?3 AND a.revision_id = ?4 AND ${revisionGate("ANY")}`,
        )
        .bind(organizationId, userId, planId, revisionId, requestId)
        .first<{ json: string }>();
      return row?.json ?? null;
    },

    async decisionOf(planId: string, revisionId: string, requestId: string): Promise<{ decision: AdjustmentDecisionKind; generationId: string | null; decidedAt: string } | null> {
      const row = await db
        .prepare(
          `SELECT d.decision, d.generation_id AS generationId, d.decided_at AS decidedAt FROM adjustment_decisions d JOIN adjustment_requests a ON a.organization_id = d.organization_id AND a.id = d.request_id
            WHERE d.organization_id = ?1 AND d.request_id = ?5 AND a.plan_id = ?3 AND a.revision_id = ?4 AND ${revisionGate("ANY")}`,
        )
        .bind(organizationId, userId, planId, revisionId, requestId)
        .first<{ decision: AdjustmentDecisionKind; generationId: string | null; decidedAt: string }>();
      return row ?? null;
    },

    /** The id of the generation row an apply produced (its idempotency key is the apply's). */
    async generationIdByKey(planId: string, revisionId: string, proposalId: string, idempotencyKey: string): Promise<string | null> {
      const row = await db
        .prepare(
          `SELECT g.id FROM prescription_generations g WHERE g.organization_id = ?1 AND g.plan_id = ?3 AND g.revision_id = ?4 AND g.proposal_id = ?5
             AND g.idempotency_key = ?6 AND ${revisionGate("ANY")}`,
        )
        .bind(organizationId, userId, planId, revisionId, proposalId, idempotencyKey)
        .first<{ id: string }>();
      return row?.id ?? null;
    },

    /** Records the professional's decision, only while the revision is still a draft. One per request: a second one is refused by the table (`already`). */
    async decide(input: { id: string; planId: string; revisionId: string; requestId: string; decision: AdjustmentDecisionKind; generationId: string | null; now: Date }): Promise<{ ok: true } | { ok: false; reason: "already" | "not_found" }> {
      try {
        const result = await db
          .prepare(
            `INSERT INTO adjustment_decisions (id, organization_id, request_id, decision, generation_id, decided_by_user_id, decided_at)
             SELECT ?5, ?1, a.id, ?6, ?7, ?2, ?8 FROM adjustment_requests a
              WHERE a.organization_id = ?1 AND a.id = ?9 AND a.plan_id = ?3 AND a.revision_id = ?4 AND a.status = 'SUCCEEDED' AND ${revisionGate("DRAFT")}`,
          )
          .bind(organizationId, userId, input.planId, input.revisionId, input.id, input.decision, input.generationId, iso(input.now), input.requestId)
          .run();
        return changesOf(result) === 1 ? { ok: true } : { ok: false, reason: "not_found" };
      } catch {
        return (await this.decisionOf(input.planId, input.revisionId, input.requestId)) ? { ok: false, reason: "already" } : { ok: false, reason: "not_found" };
      }
    },
  };
}
