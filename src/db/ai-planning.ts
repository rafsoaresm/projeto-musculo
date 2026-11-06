import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import {
  circuitDecision, CIRCUIT_FAILURE_THRESHOLD, CIRCUIT_WINDOW_MS, countsForCircuit, type CircuitDecision, type CircuitRow,
} from "@/modules/prescricao/planejador/circuit";
import type { AiGateState } from "@/modules/prescricao/planejador/gate";
import type { AiTask, ProviderErrorCode } from "@/modules/prescricao/planejador/provedores/port";
import {
  monthKey, remainingTokens, type Allowance, type Currency, type MonthUse, type Reservation, type TypedPrices,
} from "@/modules/prescricao/planejador/quota";
import { adminGuard } from "./platform";
import { revisionGate } from "./revision-gates";
import { activeUser, assertContext, technicalAccessExists, type AuthenticatedContext } from "./students";

/**
 * Organization-side repository of the AI planner (design V4 §3.6, §3.8): gate state, the usage ledger (reserve -> settle, race-safe, per
 * organization and month), the tenant-segregated cache with TTL, planning runs with idempotency keys and single flight, the circuit
 * breaker, and the one reader of provider-key ciphertext (`aiSystemFor`).
 *
 * Isolation: organization and user come from the verified session (`AuthenticatedContext`), never from a payload. Every statement
 * filters `organization_id`; statements that touch a revision's content carry the shared revision gate (organization + active user +
 * active technical assignment + non-revoked membership, `revision-gates.ts`); the others carry the membership gate below.
 *
 * Concurrency: D1 batches are one transaction. Every decision that must be atomic (allowance, cost cap, per-minute limit, kill switch,
 * organization enabled) is a predicate of the ONE conditional UPDATE that reserves; the ledger row is inserted only when that UPDATE
 * changed a row, through `(SELECT changes())`. Nothing here approves, delivers or writes a plan; there is no logging and no prompt,
 * response text or name in any column.
 *
 * Binding convention of the reserve family: ?1 organization, ?2 user, ?3 plan, ?4 revision (the shared gate), then statement-specific.
 */

export const MEMBER = (org: string, user: string) =>
  `(${activeUser(user)} AND EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = ${org} AND m.user_id = ${user}
     AND m.revoked_at IS NULL AND m.role IN ('OWNER','MANAGER','TECHNICAL')))`;

export const AI_MAX_RUNNING_PER_ORG = 2;
export const AI_CACHE_PURGE_BATCH = 50;

// ---------- types ----------

export interface TaskSettings {
  task: AiTask;
  enabled: boolean;
  providerKind: string | null;
  modelId: string | null;
  maxInputTokens: number;
  maxOutputTokens: number;
  timeoutMs: number;
  maxRetries: 0 | 1;
  prices: TypedPrices | null;
  sendSystemExerciseNames: boolean;
  version: number;
}
export interface GateSnapshot {
  /** The revision is reachable by this user (organization + active user + technical assignment). */
  reach: boolean;
  /** Everything the pure gate needs from the database; the caller fills env/circuit/minor/size facts. */
  state: Omit<AiGateState, "envKill" | "secretsKeyOk" | "mockEnabled" | "circuitOpen">;
  taskSettings: TaskSettings | null;
  requestsPerMinute: number | null;
  month: string;
}
export interface ReserveInput {
  planId: string;
  revisionId: string;
  task: AiTask;
  ledgerId: string;
  /** Server generated: `${runId}:${attempt}`, never a client key. */
  requestKey: string;
  /** The RUNNING run this reservation belongs to: `reserve` stamps `planning_runs.ledger_id` in the same batch, so a crashed run can be charged by id. */
  runId?: string;
  providerKind: string;
  modelId: string;
  reservation: Reservation;
  prices: TypedPrices | null;
  now: Date;
  staleMs: number;
}
export type ReserveResult = { ok: true; ledgerId: string } | { ok: false };

export interface SettleInput {
  ledgerId: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number | null;
  usageSource: "PROVIDER" | "ESTIMATE";
  costMicros: number | null;
  prices: TypedPrices | null;
  attempts: number;
  latencyMs: number | null;
  httpStatus: number | null;
  now: Date;
}
export type LedgerAction =
  | ({ kind: "SETTLE" } & SettleInput)
  | { kind: "RELEASE"; ledgerId: string; errorCode: string | null; countAsFailure: boolean; now: Date }
  | { kind: "CHARGE_UNKNOWN"; ledgerId: string; inputTokens: number; errorCode: string; attempts: number; latencyMs: number | null; now: Date };

export interface CachedResponse {
  responseJson: string;
  responseHash: string;
  providerKind: string;
  modelId: string;
  promptVersion: string;
  hits: number;
}
export interface CachePutInput {
  planId: string;
  revisionId: string;
  cacheKey: string;
  task: AiTask;
  providerKind: string;
  modelId: string;
  promptVersion: string;
  responseJson: string;
  responseHash: string;
  inputTokens: number | null;
  outputTokens: number | null;
  now: Date;
  expiresAt: Date;
}

export type RunStatus = "RUNNING" | "SUCCEEDED" | "FAILED";
export interface RunRow {
  id: string;
  planId: string;
  revisionId: string;
  idempotencyKey: string;
  requestHash: string;
  attempt: number;
  mode: "AI" | "RULES";
  status: RunStatus;
  failureCode: string | null;
  baseContentVersion: number;
  structureFingerprint: string;
  contextHash: string | null;
  aliasesHash: string | null;
  cacheKey: string | null;
  cacheHit: boolean;
  providerKind: string | null;
  modelId: string | null;
  promptVersion: string | null;
  schemaVersion: number | null;
  templatesVersion: string | null;
  responseHash: string | null;
  blueprintHash: string | null;
  usageJson: string | null;
  ledgerId: string | null;
  startedAt: string;
  finishedAt: string | null;
}
export interface RunStartInput {
  runId: string;
  planId: string;
  revisionId: string;
  idempotencyKey: string;
  requestHash: string;
  mode: "AI" | "RULES";
  baseContentVersion: number;
  structureFingerprint: string;
  contextHash: string | null;
  aliasesHash: string | null;
  cacheKey: string | null;
  providerKind: string | null;
  modelId: string | null;
  promptVersion: string | null;
  schemaVersion: number | null;
  templatesVersion: string | null;
  omittedJson: string;
  now: Date;
  /** Runs started before this instant no longer count against the per-organization AI ceiling (a dead Worker must not lock the organization out). */
  staleBefore?: Date;
}
export type RunStartResult =
  | { ok: true }
  | { ok: false; reason: "duplicate_key" | "in_flight" | "busy" | "not_found" };

export interface RunFinishInput {
  runId: string;
  planId: string;
  revisionId: string;
  /** The attempt the caller holds: a takeover bumps it and the old holder's finish is then a no-op. */
  attempt: number;
  status: "SUCCEEDED" | "FAILED";
  failureCode: string | null;
  cacheHit: boolean;
  responseHash: string | null;
  blueprintHash: string | null;
  usageJson: string | null;
  ledgerId: string | null;
  now: Date;
}
export interface FinishRunInput {
  ledger: LedgerAction | null;
  cache?: CachePutInput;
  /** The validated model output (deletable with the student's data). */
  payloadJson?: string;
  run: RunFinishInput;
}

export interface ProfessionalUsage {
  month: string;
  allowance: Allowance | null;
  used: { input: number; output: number };
  /** No cost field: the professional never sees costs. */
  remaining: ReturnType<typeof remainingTokens> | null;
}

export interface CircuitCheck {
  decision: CircuitDecision;
  /** True when this caller may send the single probe (or the circuit is closed). */
  allowed: boolean;
  probe: boolean;
}

// ---------- row shapes ----------

interface RunRaw {
  id: string; planId: string; revisionId: string; idempotencyKey: string; requestHash: string; attempt: number; mode: "AI" | "RULES"; status: RunStatus;
  failureCode: string | null; baseContentVersion: number; structureFingerprint: string; contextHash: string | null; aliasesHash: string | null; cacheKey: string | null;
  cacheHit: number; providerKind: string | null; modelId: string | null; promptVersion: string | null; schemaVersion: number | null; templatesVersion: string | null;
  responseHash: string | null; blueprintHash: string | null; usageJson: string | null; ledgerId: string | null; startedAt: string; finishedAt: string | null;
}
const RUN_COLUMNS = `r.id, r.plan_id AS planId, r.revision_id AS revisionId, r.idempotency_key AS idempotencyKey, r.request_hash AS requestHash, r.attempt, r.mode,
  r.status, r.failure_code AS failureCode, r.base_content_version AS baseContentVersion, r.structure_fingerprint AS structureFingerprint,
  r.context_hash AS contextHash, r.aliases_hash AS aliasesHash, r.cache_key AS cacheKey, r.cache_hit AS cacheHit, r.provider_kind AS providerKind,
  r.model_id AS modelId, r.prompt_version AS promptVersion, r.schema_version AS schemaVersion, r.templates_version AS templatesVersion,
  r.response_hash AS responseHash, r.blueprint_hash AS blueprintHash, r.usage_json AS usageJson, r.ledger_id AS ledgerId,
  r.started_at AS startedAt, r.finished_at AS finishedAt`;
const toRun = (raw: RunRaw): RunRow => ({ ...raw, cacheHit: raw.cacheHit === 1 });


// ---------- acceptances (the professional's choice from a run; append-only) ----------

export interface AcceptanceRow {
  id: string;
  planId: string;
  revisionId: string;
  runId: string;
  idempotencyKey: string;
  requestHash: string;
  strategyId: "S1" | "S2" | "S3" | "CUSTOM";
  splitFamily: string;
  finalJson: string;
  dosingJson: string;
  editsJson: string;
  acceptanceHash: string;
  structureFingerprint: string;
  baseContentVersion: number;
  acceptedByUserId: string;
  acceptedAt: string;
}
export interface AcceptanceInsert {
  id: string;
  planId: string;
  revisionId: string;
  runId: string;
  idempotencyKey: string;
  requestHash: string;
  strategyId: AcceptanceRow["strategyId"];
  splitFamily: string;
  finalJson: string;
  dosingJson: string;
  editsJson: string;
  acceptanceHash: string;
  structureFingerprint: string;
  baseContentVersion: number;
  now: Date;
}
export type AcceptanceInsertResult = { ok: true } | { ok: false; reason: "duplicate_key" | "revision_changed" | "run_invalid" | "not_found" };

const ACCEPTANCE_COLUMNS = `a.id, a.plan_id AS planId, a.revision_id AS revisionId, a.run_id AS runId, a.idempotency_key AS idempotencyKey, a.request_hash AS requestHash,
  a.strategy_id AS strategyId, a.split_family AS splitFamily, a.final_json AS finalJson, a.dosing_json AS dosingJson, a.edits_json AS editsJson,
  a.acceptance_hash AS acceptanceHash, a.structure_fingerprint AS structureFingerprint, a.base_content_version AS baseContentVersion,
  a.accepted_by_user_id AS acceptedByUserId, a.accepted_at AS acceptedAt`;

export const iso = (d: Date) => d.toISOString();
export const changesOf = (result: { meta?: { changes?: number } } | undefined) => result?.meta?.changes ?? 0;

// ---------- statement builders (shared by the single operations and the composed batches) ----------

/** Housekeeping: reservations older than the stale cutoff become CHARGED_UNKNOWN. Counters FIRST (they read the RESERVED rows), then the flip. */
function sweepStatements(db: D1Database, gateSql: string, gateBinds: unknown[], month: string, now: Date, cutoff: Date): D1PreparedStatement[] {
  const sum = (col: string) => `(SELECT COALESCE(SUM(${col}),0) FROM ai_usage_ledger WHERE organization_id = ?1 AND month = ?5 AND state = 'RESERVED' AND created_at < ?7)`;
  return [
    db.prepare(
      `UPDATE ai_usage_month SET
         used_input = used_input + ${sum("reserved_input")},
         reserved_input = reserved_input - ${sum("reserved_input")},
         reserved_output = reserved_output - ${sum("reserved_output")},
         reserved_cost_micros = reserved_cost_micros - ${sum("reserved_cost_micros")},
         failed_requests = failed_requests + (SELECT COUNT(*) FROM ai_usage_ledger WHERE organization_id = ?1 AND month = ?5 AND state = 'RESERVED' AND created_at < ?7),
         updated_at = ?6
       WHERE organization_id = ?1 AND month = ?5 AND ${gateSql}`,
    ).bind(...gateBinds, month, iso(now), iso(cutoff)),
    db.prepare(
      `UPDATE ai_usage_ledger SET state = 'CHARGED_UNKNOWN', input_tokens = reserved_input, output_tokens = 0, usage_source = 'ESTIMATE', error_code = 'STALE', settled_at = ?6
       WHERE organization_id = ?1 AND month = ?5 AND state = 'RESERVED' AND created_at < ?7 AND ${gateSql}`,
    ).bind(...gateBinds, month, iso(now), iso(cutoff)),
  ];
}

/** The reserve family: ensure month row, sweep, conditional reserve, ledger insert. `extra` is ANDed into the reserve predicate (takeover CAS). */
export function reserveStatements(db: D1Database, ctx: { organizationId: string; userId: string }, input: ReserveInput, extra: { sql: string; binds: unknown[] } | null): D1PreparedStatement[] {
  const month = monthKey(input.now);
  const gate = revisionGate("DRAFT");
  const gateBinds = [ctx.organizationId, ctx.userId, input.planId, input.revisionId];
  const now = iso(input.now);
  const r = input.reservation;
  const pricesTyped = input.prices ? 1 : 0;
  const minuteAgo = iso(new Date(input.now.getTime() - 60_000));
  const cutoff = new Date(input.now.getTime() - input.staleMs);
  // the month before: reservations left behind at the end of a month are swept by the first reserve of the next one
  const [year, mm] = month.split("-").map(Number);
  const previous = mm === 1 ? `${year - 1}-12` : `${year}-${String(mm - 1).padStart(2, "0")}`;
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT OR IGNORE INTO ai_usage_month (organization_id, month, updated_at) SELECT ?1, ?5, ?6 WHERE ${gate}`).bind(...gateBinds, month, now),
    ...sweepStatements(db, gate, gateBinds, month, input.now, cutoff),
  ];
  statements.push(...sweepStatements(db, gate, gateBinds, previous, input.now, cutoff));
  // ?5 month ?6 now ?7 resIn ?8 resOut ?9 resCost ?10 pricesTyped ?11 priceCurrency ?12 perAttempt ?13 task ?14 minuteAgo [extra from ?15]
  const extraSql = extra ? ` AND ${extra.sql}` : "";
  statements.push(
    db.prepare(
      `UPDATE ai_usage_month
          SET reserved_input = reserved_input + ?7, reserved_output = reserved_output + ?8, reserved_cost_micros = reserved_cost_micros + ?9, updated_at = ?6
        WHERE organization_id = ?1 AND month = ?5 AND ${gate}
          AND (SELECT kill_switch FROM ai_platform_settings WHERE id = 1) = 0
          AND EXISTS (
            SELECT 1 FROM ai_organization_settings os JOIN ai_quota_plans qp ON qp.id = os.quota_plan_id
             WHERE os.organization_id = ?1 AND os.enabled = 1 AND qp.archived_at IS NULL
               AND ((qp.allowance_mode = 'TOTAL'
                     AND ai_usage_month.used_input + ai_usage_month.used_output + ai_usage_month.reserved_input + ai_usage_month.reserved_output + ?7 + ?8 <= qp.monthly_total_tokens)
                 OR (qp.allowance_mode = 'SPLIT'
                     AND ai_usage_month.used_input + ai_usage_month.reserved_input + ?7 <= qp.monthly_input_tokens
                     AND ai_usage_month.used_output + ai_usage_month.reserved_output + ?8 <= qp.monthly_output_tokens))
               AND (CASE ?13 WHEN 'PLANNER' THEN qp.per_request_cap_planning ELSE qp.per_request_cap_adjustment END) >= ?12
               AND (CASE ?13 WHEN 'PLANNER' THEN qp.per_request_cap_planning ELSE qp.per_request_cap_adjustment END) > 0
               AND (qp.monthly_cost_cap_micros IS NULL OR ?10 = 0
                    OR (qp.cost_cap_currency = ?11
                        AND (ai_usage_month.cost_currency IS NULL OR ai_usage_month.cost_currency = ?11)
                        AND ai_usage_month.cost_micros + ai_usage_month.reserved_cost_micros + ?9 <= qp.monthly_cost_cap_micros))
               AND (SELECT COUNT(*) FROM ai_usage_ledger WHERE organization_id = ?1 AND cache_hit = 0 AND created_at >= ?14) < qp.requests_per_minute
          )${extraSql}`,
    ).bind(...gateBinds, month, now, r.input, r.output, r.costMicros, pricesTyped, input.prices?.currency ?? null, r.perAttemptTokens, input.task, minuteAgo, ...(extra?.binds ?? [])),
    db.prepare(
      `INSERT INTO ai_usage_ledger (id, organization_id, month, task, request_key, state, provider_kind, model_id, reserved_input, reserved_output, reserved_cost_micros, requested_by_user_id, created_at)
       SELECT ?5, ?1, ?6, ?7, ?8, 'RESERVED', ?9, ?10, ?11, ?12, ?13, ?2, ?14 WHERE (SELECT changes()) = 1`,
    ).bind(
      ctx.organizationId, ctx.userId, input.planId, input.revisionId,
      input.ledgerId, month, input.task, input.requestKey, input.providerKind, input.modelId, r.input, r.output, r.costMicros, now,
    ),
  );
  return statements;
}

/** Settles / releases / charges ONE ledger row: counters first (they read the RESERVED row), then the flip. Guarded by state = 'RESERVED'. */
export function ledgerStatements(db: D1Database, ctx: { organizationId: string; userId: string }, action: LedgerAction): D1PreparedStatement[] {
  const member = MEMBER("?1", "?2");
  const owned = `SELECT 1 FROM ai_usage_ledger WHERE id = ?3 AND organization_id = ?1 AND state = 'RESERVED'`;
  const monthOf = `(SELECT month FROM ai_usage_ledger WHERE id = ?3 AND organization_id = ?1)`;
  const reservedOf = (col: string) => `(SELECT ${col} FROM ai_usage_ledger WHERE id = ?3 AND organization_id = ?1)`;
  const base = [ctx.organizationId, ctx.userId, action.ledgerId];
  const iso1 = iso(action.now);
  if (action.kind === "SETTLE") {
    return [
      db.prepare(
        `UPDATE ai_usage_month SET
           reserved_input = reserved_input - ${reservedOf("reserved_input")}, reserved_output = reserved_output - ${reservedOf("reserved_output")},
           reserved_cost_micros = reserved_cost_micros - ${reservedOf("reserved_cost_micros")},
           used_input = used_input + ?4, used_output = used_output + ?5, requests = requests + 1,
           cost_micros = cost_micros + COALESCE(?6, 0), cost_currency = COALESCE(cost_currency, ?7), updated_at = ?8
         WHERE organization_id = ?1 AND month = ${monthOf} AND EXISTS (${owned}) AND ${member}`,
      ).bind(...base, action.inputTokens, action.outputTokens, action.costMicros, action.costMicros === null ? null : action.prices?.currency ?? null, iso1),
      db.prepare(
        `UPDATE ai_usage_ledger SET state = 'SETTLED', input_tokens = ?4, output_tokens = ?5, cached_input_tokens = ?6, usage_source = ?7, cost_micros = ?8, currency = ?9,
           price_input_micros_per_million = ?10, price_output_micros_per_million = ?11, attempts = ?12, latency_ms = ?13, http_status = ?14, settled_at = ?15
         WHERE id = ?3 AND organization_id = ?1 AND state = 'RESERVED' AND ${member}`,
      ).bind(
        ...base, action.inputTokens, action.outputTokens, action.cachedInputTokens, action.usageSource, action.costMicros, action.costMicros === null ? null : action.prices?.currency ?? null,
        action.prices?.inputMicrosPerMillion ?? null, action.prices?.outputMicrosPerMillion ?? null, action.attempts, action.latencyMs, action.httpStatus, iso1,
      ),
    ];
  }
  if (action.kind === "RELEASE") {
    return [
      db.prepare(
        `UPDATE ai_usage_month SET
           reserved_input = reserved_input - ${reservedOf("reserved_input")}, reserved_output = reserved_output - ${reservedOf("reserved_output")},
           reserved_cost_micros = reserved_cost_micros - ${reservedOf("reserved_cost_micros")},
           failed_requests = failed_requests + ?4, updated_at = ?5
         WHERE organization_id = ?1 AND month = ${monthOf} AND EXISTS (${owned}) AND ${member}`,
      ).bind(...base, action.countAsFailure ? 1 : 0, iso1),
      db.prepare(
        `UPDATE ai_usage_ledger SET state = 'RELEASED', error_code = ?4, settled_at = ?5 WHERE id = ?3 AND organization_id = ?1 AND state = 'RESERVED' AND ${member}`,
      ).bind(...base, action.errorCode, iso1),
    ];
  }
  // CHARGE_UNKNOWN: the request may have been billed (timeout/network after it left). One attempt's input estimate is charged; the output and the unused attempts are released.
  const charged = `MIN(?4, ${reservedOf("reserved_input")})`;
  return [
    db.prepare(
      `UPDATE ai_usage_month SET
         reserved_input = reserved_input - ${reservedOf("reserved_input")}, reserved_output = reserved_output - ${reservedOf("reserved_output")},
         reserved_cost_micros = reserved_cost_micros - ${reservedOf("reserved_cost_micros")},
         used_input = used_input + ${charged}, requests = requests + 1, failed_requests = failed_requests + 1, updated_at = ?5
       WHERE organization_id = ?1 AND month = ${monthOf} AND EXISTS (${owned}) AND ${member}`,
    ).bind(...base, action.inputTokens, iso1),
    db.prepare(
      `UPDATE ai_usage_ledger SET state = 'CHARGED_UNKNOWN', input_tokens = MIN(?4, reserved_input), output_tokens = 0, usage_source = 'ESTIMATE', error_code = ?5,
         attempts = ?6, latency_ms = ?7, settled_at = ?8
       WHERE id = ?3 AND organization_id = ?1 AND state = 'RESERVED' AND ${member}`,
    ).bind(...base, action.inputTokens, action.errorCode, action.attempts, action.latencyMs, iso1),
  ];
}

export function cachePutStatements(db: D1Database, ctx: { organizationId: string; userId: string }, c: CachePutInput, guard: { sql: string; binds: unknown[] } | null): D1PreparedStatement[] {
  const gate = revisionGate("ANY");
  const gateBinds = [ctx.organizationId, ctx.userId, c.planId, c.revisionId];
  const guardSql = guard ? ` AND ${guard.sql}` : "";
  return [
    // Opportunistic purge of THIS organization's expired rows (there is no background process).
    db.prepare(
      `DELETE FROM ai_planner_cache WHERE rowid IN (SELECT rowid FROM ai_planner_cache WHERE organization_id = ?1 AND expires_at <= ?5 LIMIT ${AI_CACHE_PURGE_BATCH}) AND ${gate}`,
    ).bind(...gateBinds, iso(c.now)),
    db.prepare(
      `INSERT INTO ai_planner_cache (organization_id, cache_key, student_id, task, provider_kind, model_id, prompt_version, response_json, response_hash,
         input_tokens, output_tokens, created_at, expires_at, hits)
       SELECT ?1, ?5, tp.student_id, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, 0
         FROM training_plans tp WHERE tp.organization_id = ?1 AND tp.id = ?3 AND ${gate}${guardSql}
       ON CONFLICT (organization_id, cache_key) DO UPDATE SET
         student_id = excluded.student_id, task = excluded.task, provider_kind = excluded.provider_kind, model_id = excluded.model_id, prompt_version = excluded.prompt_version,
         response_json = excluded.response_json, response_hash = excluded.response_hash, input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens,
         created_at = excluded.created_at, expires_at = excluded.expires_at, hits = 0, last_hit_at = NULL`,
    ).bind(
      ...gateBinds, c.cacheKey, c.task, c.providerKind, c.modelId, c.promptVersion, c.responseJson, c.responseHash, c.inputTokens, c.outputTokens, iso(c.now), iso(c.expiresAt),
      ...(guard?.binds ?? []),
    ),
  ];
}

function runFinishStatement(db: D1Database, ctx: { organizationId: string; userId: string }, f: RunFinishInput): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE planning_runs SET status = ?5, failure_code = ?6, cache_hit = ?7, response_hash = ?8, blueprint_hash = ?9, usage_json = ?10, ledger_id = ?11, finished_at = ?12
        WHERE id = ?3 AND organization_id = ?1 AND revision_id = ?4 AND status = 'RUNNING' AND attempt = ?13 AND ${MEMBER("?1", "?2")}`,
    )
    .bind(ctx.organizationId, ctx.userId, f.runId, f.revisionId, f.status, f.failureCode, f.cacheHit ? 1 : 0, f.responseHash, f.blueprintHash, f.usageJson, f.ledgerId, iso(f.now), f.attempt);
}

// ---------- the repository ----------

export function aiPlanningFor(db: D1Database, context: AuthenticatedContext | null) {
  const { userId, organizationId } = assertContext(context);
  const ctx = { organizationId, userId };

  async function run(planId: string, revisionId: string, where: string, ...binds: unknown[]): Promise<RunRow | null> {
    const row = await db
      .prepare(`SELECT ${RUN_COLUMNS} FROM planning_runs r WHERE r.organization_id = ?1 AND r.plan_id = ?3 AND r.revision_id = ?4 AND ${revisionGate("ANY")} AND ${where}`)
      .bind(organizationId, userId, planId, revisionId, ...binds)
      .first<RunRaw>();
    return row ? toRun(row) : null;
  }


  async function acceptance(planId: string, revisionId: string, where: string, bind: unknown, tail = ""): Promise<AcceptanceRow | null> {
    return db
      .prepare(`SELECT ${ACCEPTANCE_COLUMNS} FROM blueprint_acceptances a WHERE a.organization_id = ?1 AND a.plan_id = ?3 AND a.revision_id = ?4 AND ${revisionGate("ANY")} AND ${where} ${tail}`)
      .bind(organizationId, userId, planId, revisionId, bind)
      .first<AcceptanceRow>();
  }

  return {
    /** One batch: reach + platform switch + task + provider connection + organization settings + plan + month counters. Reads only. */
    async gateState(planId: string, revisionId: string, task: AiTask, now: Date): Promise<GateSnapshot> {
      const month = monthKey(now);
      const [reach, platform, taskRow, connection, org, usage] = await db.batch([
        db.prepare(`SELECT 1 AS ok WHERE ${revisionGate("ANY")}`).bind(organizationId, userId, planId, revisionId),
        db.prepare(`SELECT kill_switch AS killSwitch FROM ai_platform_settings WHERE id = 1 AND ${MEMBER("?1", "?2")}`).bind(organizationId, userId),
        db.prepare(
          `SELECT task, enabled, provider_kind AS providerKind, model_id AS modelId, max_input_tokens AS maxInputTokens, max_output_tokens AS maxOutputTokens,
                  timeout_ms AS timeoutMs, max_retries AS maxRetries, currency, price_input_micros_per_million AS priceIn, price_output_micros_per_million AS priceOut,
                  send_system_exercise_names AS sendNames, version
             FROM ai_task_settings WHERE task = ?3 AND ${MEMBER("?1", "?2")}`,
        ).bind(organizationId, userId, task),
        db.prepare(
          `SELECT 1 AS ok FROM ai_provider_connections c JOIN ai_task_settings t ON t.provider_kind = c.kind WHERE t.task = ?3 AND ${MEMBER("?1", "?2")}`,
        ).bind(organizationId, userId, task),
        db.prepare(
          `SELECT os.enabled, qp.id AS planId, qp.archived_at AS archivedAt, qp.allowance_mode AS mode, qp.monthly_total_tokens AS total, qp.monthly_input_tokens AS input,
                  qp.monthly_output_tokens AS output, qp.per_request_cap_planning AS capPlanning, qp.per_request_cap_adjustment AS capAdjustment,
                  qp.monthly_cost_cap_micros AS costCap, qp.cost_cap_currency AS costCapCurrency, qp.requests_per_minute AS rpm
             FROM ai_organization_settings os LEFT JOIN ai_quota_plans qp ON qp.id = os.quota_plan_id
            WHERE os.organization_id = ?1 AND ${MEMBER("?1", "?2")}`,
        ).bind(organizationId, userId),
        db.prepare(
          `SELECT used_input AS usedInput, used_output AS usedOutput, reserved_input AS reservedInput, reserved_output AS reservedOutput,
                  cost_micros AS costMicros, reserved_cost_micros AS reservedCostMicros, cost_currency AS costCurrency
             FROM ai_usage_month WHERE organization_id = ?1 AND month = ?3 AND ${MEMBER("?1", "?2")}`,
        ).bind(organizationId, userId, month),
      ]);
      const t = taskRow.results[0] as
        | { task: AiTask; enabled: number; providerKind: string | null; modelId: string | null; maxInputTokens: number; maxOutputTokens: number; timeoutMs: number; maxRetries: number;
            currency: Currency | null; priceIn: number | null; priceOut: number | null; sendNames: number; version: number }
        | undefined;
      const o = org.results[0] as
        | { enabled: number; planId: string | null; archivedAt: string | null; mode: "TOTAL" | "SPLIT" | null; total: number | null; input: number | null; output: number | null;
            capPlanning: number | null; capAdjustment: number | null; costCap: number | null; costCapCurrency: Currency | null; rpm: number | null }
        | undefined;
      const m = usage.results[0] as (MonthUse & { costMicros: number; reservedCostMicros: number; costCurrency: Currency | null }) | undefined;
      const prices: TypedPrices | null = t && t.currency && t.priceIn !== null && t.priceOut !== null
        ? { currency: t.currency, inputMicrosPerMillion: t.priceIn, outputMicrosPerMillion: t.priceOut }
        : null;
      const taskSettings: TaskSettings | null = t
        ? {
            task: t.task, enabled: t.enabled === 1, providerKind: t.providerKind, modelId: t.modelId, maxInputTokens: t.maxInputTokens, maxOutputTokens: t.maxOutputTokens,
            timeoutMs: t.timeoutMs, maxRetries: t.maxRetries === 1 ? 1 : 0, prices, sendSystemExerciseNames: t.sendNames === 1, version: t.version,
          }
        : null;
      const allowance: Allowance | null = o?.planId
        ? o.mode === "TOTAL" ? { mode: "TOTAL", total: o.total ?? 0 } : { mode: "SPLIT", input: o.input ?? 0, output: o.output ?? 0 }
        : null;
      return {
        reach: reach.results.length > 0,
        month,
        taskSettings,
        requestsPerMinute: o?.rpm ?? null,
        state: {
          panelKill: (platform.results[0] as { killSwitch: number } | undefined)?.killSwitch === 1,
          task: t ? { enabled: t.enabled === 1, providerKind: t.providerKind, modelId: t.modelId, currency: t.currency, hasPrices: prices !== null } : null,
          providerConnected: connection.results.length > 0,
          org: o ? { enabled: o.enabled === 1 } : null,
          plan: o?.planId && allowance
            ? {
                archived: o.archivedAt !== null, allowance, perRequestCapPlanning: o.capPlanning ?? 0, perRequestCapAdjustment: o.capAdjustment ?? 0,
                costCapMicros: o.costCap, costCapCurrency: o.costCapCurrency,
              }
            : null,
          month: m ?? null,
        },
      };
    },

    // ---------- ledger ----------

    /** ONE batch: ensure the month row, sweep stale reservations, conditional reserve, ledger insert. `ok:false` = a predicate refused (re-read the gate to say which). */
    async reserve(input: ReserveInput): Promise<ReserveResult> {
      const statements = reserveStatements(db, ctx, input, null);
      const ledgerAt = statements.length - 1;
      if (input.runId) {
        // Only when the ledger row was just inserted and the run is still RUNNING: the run now points at its reservation.
        statements.push(
          db
            .prepare(
              `UPDATE planning_runs SET ledger_id = ?5 WHERE id = ?6 AND organization_id = ?1 AND revision_id = ?4 AND plan_id = ?3 AND status = 'RUNNING'
                 AND (SELECT changes()) = 1 AND ${MEMBER("?1", "?2")}`,
            )
            .bind(ctx.organizationId, ctx.userId, input.planId, input.revisionId, input.ledgerId, input.runId),
        );
      }
      const results = await db.batch(statements);
      return changesOf(results[ledgerAt]) === 1 ? { ok: true, ledgerId: input.ledgerId } : { ok: false };
    },

    /** Settle, release or charge-unknown ONE reservation (no run involved: panel tests, probes). Returns whether the reservation was still RESERVED. */
    async ledger(action: LedgerAction): Promise<boolean> {
      const results = await db.batch(ledgerStatements(db, ctx, action));
      return changesOf(results[1]) === 1;
    },

    /** A cache HIT is recorded as a 0-token SETTLED ledger row (`cache_hit = 1`) and a counter. */
    async recordCacheHit(input: { planId: string; revisionId: string; task: AiTask; ledgerId: string; requestKey: string; providerKind: string; modelId: string; now: Date }): Promise<boolean> {
      const month = monthKey(input.now);
      const gate = revisionGate("ANY");
      const base = [organizationId, userId, input.planId, input.revisionId];
      const now = iso(input.now);
      const results = await db.batch([
        db.prepare(`INSERT OR IGNORE INTO ai_usage_month (organization_id, month, updated_at) SELECT ?1, ?5, ?6 WHERE ${gate}`).bind(...base, month, now),
        db.prepare(
          `INSERT INTO ai_usage_ledger (id, organization_id, month, task, request_key, state, provider_kind, model_id, reserved_input, reserved_output, reserved_cost_micros,
             input_tokens, output_tokens, cached_input_tokens, usage_source, cache_hit, requested_by_user_id, created_at, settled_at)
           SELECT ?5, ?1, ?6, ?7, ?8, 'SETTLED', ?9, ?10, 0, 0, 0, 0, 0, 0, 'ESTIMATE', 1, ?2, ?11, ?11 WHERE ${gate}`,
        ).bind(...base, input.ledgerId, month, input.task, input.requestKey, input.providerKind, input.modelId, now),
        db.prepare(`UPDATE ai_usage_month SET cache_hits = cache_hits + 1, updated_at = ?6 WHERE organization_id = ?1 AND month = ?5 AND (SELECT changes()) = 1`).bind(...base, month, now),
      ]);
      return changesOf(results[1]) === 1;
    },

    /** Reservations older than the cutoff of THIS organization and month become CHARGED_UNKNOWN (counters first). */
    async sweepStale(month: string, now: Date, staleMs: number): Promise<number> {
      const memberGate = MEMBER("?1", "?2");
      const cutoff = new Date(now.getTime() - staleMs);
      const sum = (col: string) => `(SELECT COALESCE(SUM(${col}),0) FROM ai_usage_ledger WHERE organization_id = ?1 AND month = ?3 AND state = 'RESERVED' AND created_at < ?5)`;
      const results = await db.batch([
        db.prepare(
          `UPDATE ai_usage_month SET used_input = used_input + ${sum("reserved_input")}, reserved_input = reserved_input - ${sum("reserved_input")},
             reserved_output = reserved_output - ${sum("reserved_output")}, reserved_cost_micros = reserved_cost_micros - ${sum("reserved_cost_micros")},
             failed_requests = failed_requests + (SELECT COUNT(*) FROM ai_usage_ledger WHERE organization_id = ?1 AND month = ?3 AND state = 'RESERVED' AND created_at < ?5), updated_at = ?4
           WHERE organization_id = ?1 AND month = ?3 AND ${memberGate}
             AND EXISTS (SELECT 1 FROM ai_usage_ledger WHERE organization_id = ?1 AND month = ?3 AND state = 'RESERVED' AND created_at < ?5)`,
        ).bind(organizationId, userId, month, iso(now), iso(cutoff)),
        db.prepare(
          `UPDATE ai_usage_ledger SET state = 'CHARGED_UNKNOWN', input_tokens = reserved_input, output_tokens = 0, usage_source = 'ESTIMATE', error_code = 'STALE', settled_at = ?4
           WHERE organization_id = ?1 AND month = ?3 AND state = 'RESERVED' AND created_at < ?5 AND ${memberGate}`,
        ).bind(organizationId, userId, month, iso(now), iso(cutoff)),
      ]);
      return changesOf(results[1]);
    },

    // ---------- cache ----------

    /** A hit requires `expires_at > now`; it bumps `hits` in the same batch. The caller re-validates the response against the CURRENT bundle. */
    async cacheGet(planId: string, revisionId: string, cacheKey: string, now: Date): Promise<CachedResponse | null> {
      const gate = revisionGate("ANY");
      const binds = [organizationId, userId, planId, revisionId, cacheKey, iso(now)];
      const [, read] = await db.batch([
        db.prepare(`UPDATE ai_planner_cache SET hits = hits + 1, last_hit_at = ?6 WHERE organization_id = ?1 AND cache_key = ?5 AND expires_at > ?6 AND ${gate}`).bind(...binds),
        db.prepare(
          `SELECT response_json AS responseJson, response_hash AS responseHash, provider_kind AS providerKind, model_id AS modelId, prompt_version AS promptVersion, hits
             FROM ai_planner_cache WHERE organization_id = ?1 AND cache_key = ?5 AND expires_at > ?6 AND ${gate}`,
        ).bind(...binds),
      ]);
      return (read.results[0] as CachedResponse | undefined) ?? null;
    },

    /** Writes the validated response (replacing an expired entry) and purges up to 50 expired rows of this organization in the same batch. */
    async cachePut(input: CachePutInput): Promise<void> {
      await db.batch(cachePutStatements(db, ctx, input, null));
    },

    // ---------- runs ----------

    runByKey: (planId: string, revisionId: string, idempotencyKey: string) => run(planId, revisionId, "r.idempotency_key = ?5", idempotencyKey),
    runById: (planId: string, revisionId: string, runId: string) => run(planId, revisionId, "r.id = ?5", runId),
    /** The blocker of the single-flight index: a RUNNING run of this organization with this cache key. */
    async runningByCacheKey(planId: string, revisionId: string, cacheKey: string): Promise<RunRow | null> {
      return run(planId, revisionId, "r.status = 'RUNNING' AND r.cache_key = ?5", cacheKey);
    },
    /** The newest run of the revision (any status, or only `status`). */
    /** The revision's CURRENT content_version (null = not reachable). Suggestions made for another version are stale. */
    async currentContentVersion(planId: string, revisionId: string): Promise<number | null> {
      const row = await db
        .prepare(`SELECT r.content_version AS v FROM plan_revisions r WHERE r.organization_id = ?1 AND r.plan_id = ?3 AND r.id = ?4 AND ${revisionGate("ANY")}`)
        .bind(organizationId, userId, planId, revisionId)
        .first<{ v: number }>();
      return row?.v ?? null;
    },

    async latestRun(planId: string, revisionId: string, status?: RunStatus): Promise<RunRow | null> {
      const row = await db
        .prepare(
          `SELECT ${RUN_COLUMNS} FROM planning_runs r WHERE r.organization_id = ?1 AND r.plan_id = ?3 AND r.revision_id = ?4 AND ${revisionGate("ANY")}
             AND (?5 IS NULL OR r.status = ?5) ORDER BY r.started_at DESC, r.rowid DESC LIMIT 1`,
        )
        .bind(organizationId, userId, planId, revisionId, status ?? null)
        .first<RunRaw>();
      return row ? toRun(row) : null;
    },

    /**
     * Inserts a RUNNING run. UNIQUE (organization, revision, idempotency key) and the single-flight index on (organization, cache key) turn a
     * duplicate into a typed answer; at most AI_MAX_RUNNING_PER_ORG AI runs per organization are RUNNING (counted inside the insert). Rules-mode
     * runs are not counted and never refused for that reason: "continue by rules" must work while AI runs are busy.
     */
    async runStart(input: RunStartInput): Promise<RunStartResult> {
      const gate = revisionGate("DRAFT");
      try {
        const result = await db
          .prepare(
            `INSERT INTO planning_runs (id, organization_id, plan_id, revision_id, idempotency_key, request_hash, attempt, mode, status, base_content_version, structure_fingerprint,
               context_hash, aliases_hash, cache_key, provider_kind, model_id, prompt_version, schema_version, templates_version, omitted_json, requested_by_user_id, started_at)
             SELECT ?5, ?1, ?3, ?4, ?6, ?7, 1, ?8, 'RUNNING', ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?2, ?20
              WHERE ${gate} AND (?8 = 'RULES' OR (SELECT COUNT(*) FROM planning_runs WHERE organization_id = ?1 AND status = 'RUNNING' AND mode = 'AI' AND (?21 IS NULL OR started_at >= ?21)) < ${AI_MAX_RUNNING_PER_ORG})`,
          )
          .bind(
            organizationId, userId, input.planId, input.revisionId, input.runId, input.idempotencyKey, input.requestHash, input.mode, input.baseContentVersion,
            input.structureFingerprint, input.contextHash, input.aliasesHash, input.cacheKey, input.providerKind, input.modelId, input.promptVersion, input.schemaVersion,
            input.templatesVersion, input.omittedJson, iso(input.now), input.staleBefore ? iso(input.staleBefore) : null,
          )
          .run();
        if (changesOf(result) === 1) return { ok: true };
      } catch {
        // A unique violation: tell WHICH one by reading the rows again, never by parsing the driver message.
        if (await run(input.planId, input.revisionId, "r.idempotency_key = ?5", input.idempotencyKey)) return { ok: false, reason: "duplicate_key" };
        if (input.cacheKey && (await run(input.planId, input.revisionId, "r.status = 'RUNNING' AND r.cache_key = ?5", input.cacheKey))) return { ok: false, reason: "in_flight" };
        throw new Error("PLANNING_RUN_INSERT_FAILED");
      }
      const reach = await db.prepare(`SELECT 1 AS ok WHERE ${gate}`).bind(organizationId, userId, input.planId, input.revisionId).first();
      return { ok: false, reason: reach ? "busy" : "not_found" };
    },

    /** Finishes a run (CAS on status and attempt). Optionally in the SAME batch: ledger action, cache entry and the model payload. Returns whether the run was finished by this call. */
    async finishRun(input: FinishRunInput): Promise<boolean> {
      const statements: D1PreparedStatement[] = [];
      if (input.ledger) statements.push(...ledgerStatements(db, ctx, input.ledger));
      const finishAt = statements.length;
      statements.push(runFinishStatement(db, ctx, input.run));
      const ownRun = `EXISTS (SELECT 1 FROM planning_runs WHERE id = %RUN% AND organization_id = ?1 AND status = 'SUCCEEDED' AND attempt = %ATT%)`;
      if (input.cache && input.run.status === "SUCCEEDED") {
        statements.push(...cachePutStatements(db, ctx, input.cache, { sql: ownRun.replace("%RUN%", "?16").replace("%ATT%", "?17"), binds: [input.run.runId, input.run.attempt] }));
      }
      if (input.payloadJson !== undefined && input.run.status === "SUCCEEDED") {
        statements.push(
          db
            .prepare(
              `INSERT INTO planning_run_payloads (run_id, organization_id, student_id, blueprint_json, created_at)
               SELECT ?3, ?1, tp.student_id, ?5, ?6 FROM training_plans tp
                WHERE tp.organization_id = ?1 AND tp.id = ?7 AND ${MEMBER("?1", "?2")}
                  AND EXISTS (SELECT 1 FROM planning_runs WHERE id = ?3 AND organization_id = ?1 AND status = 'SUCCEEDED' AND attempt = ?8)`,
            )
            .bind(organizationId, userId, input.run.runId, input.run.revisionId, input.payloadJson, iso(input.run.now), input.run.planId, input.run.attempt),
        );
      }
      const results = await db.batch(statements);
      return changesOf(results[finishAt]) === 1;
    },

    /**
     * Takes over a STALE run of the SAME idempotency key in ONE batch: the old ledger row (if any) is charged as unknown by id, the run's attempt and
     * start are moved by compare-and-set, and the new reservation (request key `${runId}:${attempt + 1}`) is made only if that CAS won.
     */
    async takeoverRun(input: { runId: string; expectedStartedAt: string; expectedAttempt: number; oldLedgerId: string | null; oldInputEstimate: number; reserve: Omit<ReserveInput, "requestKey" | "ledgerId"> & { newLedgerId: string } }): Promise<ReserveResult & { attempt?: number; claimed?: boolean }> {
      const now = input.reserve.now;
      const newAttempt = input.expectedAttempt + 1;
      const statements: D1PreparedStatement[] = [];
      if (input.oldLedgerId) {
        statements.push(...ledgerStatements(db, ctx, { kind: "CHARGE_UNKNOWN", ledgerId: input.oldLedgerId, inputTokens: input.oldInputEstimate, errorCode: "STALE", attempts: 1, latencyMs: null, now }));
      }
      const casAt = statements.length;
      statements.push(
        db
          .prepare(
            `UPDATE planning_runs SET attempt = attempt + 1, started_at = ?5, ledger_id = ?8 WHERE id = ?3 AND organization_id = ?1 AND revision_id = ?4 AND status = 'RUNNING'
               AND started_at = ?6 AND attempt = ?7 AND ${MEMBER("?1", "?2")}`,
          )
          .bind(organizationId, userId, input.runId, input.reserve.revisionId, iso(now), input.expectedStartedAt, input.expectedAttempt, input.reserve.newLedgerId),
      );
      const reserve = reserveStatements(db, ctx, { ...input.reserve, ledgerId: input.reserve.newLedgerId, requestKey: `${input.runId}:${newAttempt}` }, {
        // The CAS above stamps THIS caller's new ledger id on the run: only the caller whose CAS won can reserve (two takeovers in the same millisecond cannot both pass).
        sql: `EXISTS (SELECT 1 FROM planning_runs WHERE id = ?15 AND organization_id = ?1 AND attempt = ?16 AND ledger_id = ?17)`,
        binds: [input.runId, newAttempt, input.reserve.newLedgerId],
      });
      statements.push(...reserve);
      const results = await db.batch(statements);
      if (changesOf(results[results.length - 1]) === 1) return { ok: true, ledgerId: input.reserve.newLedgerId, attempt: newAttempt };
      // `claimed`: this caller WON the compare-and-set but the quota refused: the run is RUNNING at `attempt` and must be finished (FAILED) with it.
      // Not claimed: another caller took the run (or it moved): do nothing.
      return changesOf(results[casAt]) === 1 ? { ok: false, claimed: true, attempt: newAttempt } : { ok: false, claimed: false };
    },

    /** A stale RUNNING run that blocks the single-flight key (another idempotency key): charge its ledger row as unknown and mark it FAILED/STALE. */
    async expireStaleRun(input: { planId: string; revisionId: string; runId: string; expectedStartedAt: string; oldLedgerId: string | null; oldInputEstimate: number; now: Date }): Promise<boolean> {
      const statements: D1PreparedStatement[] = [];
      if (input.oldLedgerId) {
        statements.push(...ledgerStatements(db, ctx, { kind: "CHARGE_UNKNOWN", ledgerId: input.oldLedgerId, inputTokens: input.oldInputEstimate, errorCode: "STALE", attempts: 1, latencyMs: null, now: input.now }));
      }
      const at = statements.length;
      statements.push(
        db
          .prepare(
            `UPDATE planning_runs SET status = 'FAILED', failure_code = 'STALE', finished_at = ?5 WHERE id = ?3 AND organization_id = ?1 AND revision_id = ?4
               AND status = 'RUNNING' AND started_at = ?6 AND ${MEMBER("?1", "?2")}`,
          )
          .bind(organizationId, userId, input.runId, input.revisionId, iso(input.now), input.expectedStartedAt),
      );
      const results = await db.batch(statements);
      return changesOf(results[at]) === 1;
    },

    /** The validated model output of a run (reach is proven through the revision gate). */
    async payloadOf(planId: string, revisionId: string, runId: string): Promise<string | null> {
      const row = await db
        .prepare(
          `SELECT p.blueprint_json AS json FROM planning_run_payloads p JOIN planning_runs r ON r.organization_id = p.organization_id AND r.id = p.run_id
            WHERE p.organization_id = ?1 AND p.run_id = ?5 AND r.plan_id = ?3 AND r.revision_id = ?4 AND ${revisionGate("ANY")}`,
        )
        .bind(organizationId, userId, planId, revisionId, runId)
        .first<{ json: string }>();
      return row?.json ?? null;
    },


    // ---------- acceptances ----------

    async acceptanceByKey(planId: string, revisionId: string, idempotencyKey: string): Promise<AcceptanceRow | null> {
      return acceptance(planId, revisionId, "a.idempotency_key = ?5", idempotencyKey);
    },
    async acceptanceById(planId: string, revisionId: string, acceptanceId: string): Promise<AcceptanceRow | null> {
      return acceptance(planId, revisionId, "a.id = ?5", acceptanceId);
    },
    /** The newest acceptance of the revision: a new acceptance supersedes the earlier ones. */
    async latestAcceptance(planId: string, revisionId: string): Promise<AcceptanceRow | null> {
      return acceptance(planId, revisionId, "1 = ?5", 1, "ORDER BY a.accepted_at DESC, a.rowid DESC LIMIT 1");
    },

    /**
     * Records an acceptance (append-only). The insert itself holds what makes it valid: the revision is a DRAFT the acting user reaches, its content
     * version is still the one the strategy was planned for, and the run is a SUCCEEDED run of this revision for that version and structure.
     * UNIQUE (organization, revision, idempotency key) turns a duplicate into a typed answer; the caller compares the request hash.
     */
    async insertAcceptance(input: AcceptanceInsert): Promise<AcceptanceInsertResult> {
      const binds = [
        organizationId, userId, input.planId, input.revisionId, input.id, input.runId, input.idempotencyKey, input.requestHash, input.strategyId, input.splitFamily,
        input.finalJson, input.dosingJson, input.editsJson, input.acceptanceHash, input.structureFingerprint, input.baseContentVersion, iso(input.now),
      ];
      try {
        const result = await db
          .prepare(
            `INSERT INTO blueprint_acceptances (id, organization_id, plan_id, revision_id, run_id, idempotency_key, request_hash, strategy_id, split_family, final_json,
               dosing_json, edits_json, acceptance_hash, structure_fingerprint, base_content_version, accepted_by_user_id, accepted_at)
             SELECT ?5, ?1, ?3, ?4, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?2, ?17
              WHERE ${revisionGate("DRAFT")}
                AND EXISTS (SELECT 1 FROM plan_revisions v WHERE v.organization_id = ?1 AND v.id = ?4 AND v.plan_id = ?3 AND v.content_version = ?16)
                AND EXISTS (SELECT 1 FROM planning_runs pr WHERE pr.organization_id = ?1 AND pr.id = ?6 AND pr.revision_id = ?4 AND pr.plan_id = ?3 AND pr.status = 'SUCCEEDED'
                              AND pr.base_content_version = ?16 AND pr.structure_fingerprint = ?15)`,
          )
          .bind(...binds)
          .run();
        if (changesOf(result) === 1) return { ok: true };
      } catch {
        if (await acceptance(input.planId, input.revisionId, "a.idempotency_key = ?5", input.idempotencyKey)) return { ok: false, reason: "duplicate_key" };
        throw new Error("ACCEPTANCE_INSERT_FAILED");
      }
      const reach = await db.prepare(`SELECT 1 AS ok WHERE ${revisionGate("DRAFT")}`).bind(organizationId, userId, input.planId, input.revisionId).first();
      if (!reach) return { ok: false, reason: "not_found" };
      const version = await db
        .prepare("SELECT 1 AS ok FROM plan_revisions v WHERE v.organization_id = ?1 AND v.id = ?2 AND v.plan_id = ?3 AND v.content_version = ?4")
        .bind(organizationId, input.revisionId, input.planId, input.baseContentVersion)
        .first();
      return { ok: false, reason: version ? "run_invalid" : "revision_changed" };
    },

    // ---------- usage (professional, read only, no costs) ----------

    async usageForProfessional(now: Date): Promise<ProfessionalUsage> {
      const month = monthKey(now);
      const [usage, plan] = await db.batch([
        db.prepare(
          `SELECT used_input AS usedInput, used_output AS usedOutput, reserved_input AS reservedInput, reserved_output AS reservedOutput
             FROM ai_usage_month WHERE organization_id = ?1 AND month = ?3 AND ${MEMBER("?1", "?2")}`,
        ).bind(organizationId, userId, month),
        db.prepare(
          `SELECT qp.allowance_mode AS mode, qp.monthly_total_tokens AS total, qp.monthly_input_tokens AS input, qp.monthly_output_tokens AS output
             FROM ai_organization_settings os JOIN ai_quota_plans qp ON qp.id = os.quota_plan_id
            WHERE os.organization_id = ?1 AND os.enabled = 1 AND qp.archived_at IS NULL AND ${MEMBER("?1", "?2")}`,
        ).bind(organizationId, userId),
      ]);
      const m = (usage.results[0] as MonthUse | undefined) ?? { usedInput: 0, usedOutput: 0, reservedInput: 0, reservedOutput: 0 };
      const p = plan.results[0] as { mode: "TOTAL" | "SPLIT"; total: number | null; input: number | null; output: number | null } | undefined;
      const allowance: Allowance | null = p ? (p.mode === "TOTAL" ? { mode: "TOTAL", total: p.total ?? 0 } : { mode: "SPLIT", input: p.input ?? 0, output: p.output ?? 0 }) : null;
      return { month, allowance, used: { input: m.usedInput, output: m.usedOutput }, remaining: allowance ? remainingTokens(allowance, m) : null };
    },

    // ---------- circuit breaker (per provider and model, platform wide) ----------

    /** May this caller send a request? A CLOSED circuit allows; after the open period exactly ONE caller wins the probe by compare-and-set on what it read. */
    async circuitCheck(kind: string, modelId: string, now: Date, staleMs: number): Promise<CircuitCheck> {
      const row = await db
        .prepare(
          `SELECT state, consecutive_failures AS consecutiveFailures, first_failure_at AS firstFailureAt, opened_at AS openedAt, probe_started_at AS probeStartedAt
             FROM ai_circuit_state WHERE provider_kind = ?3 AND model_id = ?4 AND ${MEMBER("?1", "?2")}`,
        )
        .bind(organizationId, userId, kind, modelId)
        .first<CircuitRow>();
      const decision = circuitDecision(row ?? null, now, staleMs);
      if (decision === "ALLOW") return { decision, allowed: true, probe: false };
      if (decision === "BLOCK" || !row) return { decision, allowed: false, probe: false };
      const claim = await db
        .prepare(
          `UPDATE ai_circuit_state SET state = 'HALF_OPEN', probe_started_at = ?5, updated_at = ?5
            WHERE provider_kind = ?3 AND model_id = ?4 AND ${MEMBER("?1", "?2")}
              AND ((state = 'OPEN' AND opened_at IS ?6) OR (state = 'HALF_OPEN' AND probe_started_at IS ?7))`,
        )
        .bind(organizationId, userId, kind, modelId, iso(now), row.openedAt, row.probeStartedAt)
        .run();
      return changesOf(claim) === 1 ? { decision, allowed: true, probe: true } : { decision: "BLOCK", allowed: false, probe: false };
    },

    /** The caller that won the probe sent nothing (busy, quota, unreadable key): give the probe back, so the circuit does not stay blocked until the probe goes stale. */
    async circuitReleaseProbe(kind: string, modelId: string, probeStartedAt: Date): Promise<void> {
      await db
        .prepare(
          `UPDATE ai_circuit_state SET state = 'OPEN', probe_started_at = NULL, updated_at = ?5
            WHERE provider_kind = ?3 AND model_id = ?4 AND state = 'HALF_OPEN' AND probe_started_at IS ?5 AND ${MEMBER("?1", "?2")}`,
        )
        .bind(organizationId, userId, kind, modelId, iso(probeStartedAt))
        .run();
    },

    /** Records a provider failure. Only SERVER_ERROR / NETWORK / TIMEOUT count; a failed probe re-opens immediately. */
    async circuitFailure(kind: string, modelId: string, code: ProviderErrorCode, now: Date): Promise<void> {
      if (!countsForCircuit(code)) return;
      const windowStart = iso(new Date(now.getTime() - CIRCUIT_WINDOW_MS));
      const count = `(CASE WHEN state = 'HALF_OPEN' THEN consecutive_failures + 1
                           WHEN first_failure_at IS NOT NULL AND first_failure_at >= ?5 THEN consecutive_failures + 1 ELSE 1 END)`;
      await db.batch([
        db.prepare(`INSERT OR IGNORE INTO ai_circuit_state (provider_kind, model_id, updated_at) SELECT ?3, ?4, ?6 WHERE ${MEMBER("?1", "?2")}`).bind(organizationId, userId, kind, modelId, windowStart, iso(now)),
        db.prepare(
          `UPDATE ai_circuit_state SET
             consecutive_failures = ${count},
             first_failure_at = CASE WHEN state = 'HALF_OPEN' THEN first_failure_at WHEN first_failure_at IS NOT NULL AND first_failure_at >= ?5 THEN first_failure_at ELSE ?6 END,
             opened_at = CASE WHEN state = 'HALF_OPEN' THEN ?6 WHEN state = 'OPEN' THEN opened_at WHEN ${count} >= ${CIRCUIT_FAILURE_THRESHOLD} THEN ?6 ELSE opened_at END,
             state = CASE WHEN state IN ('HALF_OPEN','OPEN') THEN 'OPEN' WHEN ${count} >= ${CIRCUIT_FAILURE_THRESHOLD} THEN 'OPEN' ELSE 'CLOSED' END,
             probe_started_at = NULL, updated_at = ?6
           WHERE provider_kind = ?3 AND model_id = ?4 AND ${MEMBER("?1", "?2")}`,
        ).bind(organizationId, userId, kind, modelId, windowStart, iso(now)),
      ]);
    },

    /**
     * Any answer that proves the provider is up (including model-quality failures) closes the circuit, but only an answer to a request SENT at or after
     * the circuit opened (`sentAt`): a slow success from a call that was already in flight when it opened must not close it early.
     */
    async circuitSuccess(kind: string, modelId: string, now: Date, sentAt: Date): Promise<void> {
      await db
        .prepare(
          `UPDATE ai_circuit_state SET state = 'CLOSED', consecutive_failures = 0, first_failure_at = NULL, opened_at = NULL, probe_started_at = NULL, updated_at = ?5
            WHERE provider_kind = ?3 AND model_id = ?4 AND (state <> 'CLOSED' OR consecutive_failures > 0)
              AND (opened_at IS NULL OR opened_at <= ?6) AND ${MEMBER("?1", "?2")}`,
        )
        .bind(organizationId, userId, kind, modelId, iso(now), iso(sentAt))
        .run();
    },

    // ---------- erasure ----------

    /**
     * Removes what the AI layer keeps ABOUT a student: cache rows and model payloads. Runs, ledger and acceptances (hashes, counts, codes) stay.
     * Reach is the same as for the student's own data: the acting professional needs the active technical assignment over THIS student.
     */
    async eraseStudentAi(studentId: string): Promise<{ cache: number; payloads: number; adjustments: number }> {
      const reach = `EXISTS (SELECT 1 FROM students s WHERE s.organization_id = ?1 AND s.id = ?3 AND ${technicalAccessExists("s", "?2")})`;
      const [cache, payloads, adjustments] = await db.batch([
        db.prepare(`DELETE FROM ai_planner_cache WHERE organization_id = ?1 AND student_id = ?3 AND ${MEMBER("?1", "?2")} AND ${reach}`).bind(organizationId, userId, studentId),
        db.prepare(`DELETE FROM planning_run_payloads WHERE organization_id = ?1 AND student_id = ?3 AND ${MEMBER("?1", "?2")} AND ${reach}`).bind(organizationId, userId, studentId),
        // The assisted adjustments' suggestions (real ids, exercise names, diff) go with the student; the requests, ledger and decisions stay (codes and hashes only).
        db.prepare(`DELETE FROM adjustment_payloads WHERE organization_id = ?1 AND student_id = ?3 AND ${MEMBER("?1", "?2")} AND ${reach}`).bind(organizationId, userId, studentId),
      ]);
      return { cache: changesOf(cache), payloads: changesOf(payloads), adjustments: changesOf(adjustments) };
    },
  };
}

/**
 * The ONLY reader of provider-key ciphertext. It returns the sealed value for one provider to the server code that is about to call
 * it (the caller decrypts with `secrets.ts` and never keeps the plaintext). Membership of the acting user is proven in the statement.
 */
/** The one SELECT of key ciphertext: `?3` is the provider kind, the guard decides who may read (an active member, or an active platform manager). */
const keyQuery = (guard: string) => `SELECT key_ciphertext AS ciphertext, key_key_id AS keyId FROM ai_provider_connections WHERE kind = ?3 AND ${guard}`;

export function aiSystemFor(db: D1Database, context: AuthenticatedContext | null) {
  const { userId, organizationId } = assertContext(context);
  return {
    async readKeyForCall(kind: string): Promise<{ ciphertext: string; keyId: string } | null> {
      const row = await db.prepare(keyQuery(MEMBER("?1", "?2"))).bind(organizationId, userId, kind).first<{ ciphertext: string; keyId: string }>();
      return row ?? null;
    },
  };
}

/**
 * The same reader for the gestor panel's "Testar conexão", "Listar modelos" and "Testar modelo": an active platform manager, never an
 * organization. The ciphertext is decrypted by the caller right before a request that carries no student data and is never returned.
 */
export function aiPlatformKeyFor(db: D1Database, context: { userId: string }) {
  const userId = context?.userId?.trim();
  if (!userId) throw new Error("AUTHENTICATION_REQUIRED");
  return {
    async readKeyForTest(kind: string): Promise<{ ciphertext: string; keyId: string } | null> {
      const row = await db.prepare(keyQuery(adminGuard("?1"))).bind(userId, null, kind).first<{ ciphertext: string; keyId: string }>();
      return row ?? null;
    },
  };
}
