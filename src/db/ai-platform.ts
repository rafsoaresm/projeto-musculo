import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import type { SealedSecret } from "@/modules/prescricao/planejador/secrets";
import { REAL_PROVIDER_KINDS, type AiTask, type RealProviderKind } from "@/modules/prescricao/planejador/provedores/port";
import type { Currency } from "@/modules/prescricao/planejador/quota";
import { adminGuard, type PlatformContext } from "./platform";

/**
 * Gestor-side repository of the AI layer (design V4 §3.8): provider keys, task -> provider/model mapping, quota plans, per-organization
 * enablement and the plan assigned to it, the global kill switch, usage totals and the AI slice of the audit trail.
 *
 * Every statement carries `adminGuard("?1")` (an active platform manager) and every WRITE additionally requires that manager to have
 * two-factor enabled (decision D5). Each change and its audit row are ONE `db.batch`; the audit row carries the action and a subject
 * (provider kind, task, plan id, organization id) and NEVER a key, a fragment of it or a payload.
 *
 * Provider keys are WRITE-ONLY here: `key_ciphertext` is written by `saveConnection` and never appears in any SELECT of this file
 * (`listConnections` names a constant column list that omits it). The only reader is `aiSystemFor` in `ai-planning.ts`.
 */

export const AI_AUDIT_ACTIONS = [
  "AI_PROVIDER_CONNECTED", "AI_PROVIDER_ROTATED", "AI_PROVIDER_REMOVED", "AI_PROVIDER_TESTED", "AI_MODEL_TESTED", "AI_TASK_CONFIGURED",
  "AI_KILL_SWITCH_ON", "AI_KILL_SWITCH_OFF", "AI_PLAN_SAVED", "AI_PLAN_ARCHIVED", "AI_ORG_ENABLED", "AI_ORG_DISABLED", "AI_ORG_PLAN_ASSIGNED",
] as const;
export type AiAuditAction = (typeof AI_AUDIT_ACTIONS)[number];

const writer = `${adminGuard("?1")} AND EXISTS (SELECT 1 FROM auth_user au WHERE au.id = ?1 AND au.two_factor_enabled = 1)`;
const iso = (d: Date) => d.toISOString();
const changesOf = (r: { meta?: { changes?: number } } | undefined) => r?.meta?.changes ?? 0;
const nameKey = (name: string) => name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export interface ConnectionRow {
  kind: RealProviderKind;
  last4: string;
  connectedAt: string;
  connectedByEmail: string | null;
  rotatedAt: string | null;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestCode: string | null;
  version: number;
}
export interface TaskRow {
  task: AiTask;
  enabled: boolean;
  providerKind: string | null;
  modelId: string | null;
  maxInputTokens: number;
  maxOutputTokens: number;
  timeoutMs: number;
  maxRetries: 0 | 1;
  currency: Currency | null;
  priceInputMicrosPerMillion: number | null;
  priceOutputMicrosPerMillion: number | null;
  sendSystemExerciseNames: boolean;
  version: number;
}
export interface TaskInput {
  enabled: boolean;
  providerKind: string | null;
  modelId: string | null;
  maxInputTokens: number;
  maxOutputTokens: number;
  timeoutMs: number;
  maxRetries: 0 | 1;
  /** Both prices or neither; integer micro-units of `currency` per 1M tokens. Absent = cost unknown. */
  prices: { currency: Currency; inputMicrosPerMillion: number; outputMicrosPerMillion: number } | null;
  sendSystemExerciseNames: boolean;
  /** Ceilings from the environment (AI_HARD_*): the input is clamped, never trusted. */
  ceilings: { maxOutputTokens: number; timeoutMs: number };
  /** `AI_MOCK_ENABLED`: the mock provider may be chosen only then. */
  mockAllowed: boolean;
}
export type SaveTaskResult = "saved" | "conflict" | "provider_not_connected" | "invalid";

export interface PlanInput {
  name: string;
  allowance: { mode: "TOTAL"; total: number } | { mode: "SPLIT"; input: number; output: number };
  perRequestCapPlanning: number;
  perRequestCapAdjustment: number;
  requestsPerMinute: number;
  costCap: { micros: number; currency: Currency } | null;
}
export interface PlanRow {
  id: string;
  name: string;
  mode: "TOTAL" | "SPLIT";
  totalTokens: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  perRequestCapPlanning: number;
  perRequestCapAdjustment: number;
  requestsPerMinute: number;
  costCapMicros: number | null;
  costCapCurrency: Currency | null;
  archivedAt: string | null;
  organizations: number;
  version: number;
}
export type SavePlanResult = { ok: true; id: string } | { ok: false; reason: "conflict" | "name_taken" | "currency_mismatch" | "invalid" | "not_found" };

export interface OrganizationAiRow {
  organizationId: string;
  organizationName: string;
  enabled: boolean;
  quotaPlanId: string | null;
  quotaPlanName: string | null;
  usedTokens: number;
  usedInput: number;
  usedOutput: number;
  /** Reserved by calls in flight (counted against the allowance like use). */
  reservedTokens: number;
  reservedInput: number;
  reservedOutput: number;
  /** Cost used and reserved this month in `costCurrency` (null currency: nothing was priced). Counted against the plan's cost cap like the gate does. */
  costMicros: number;
  reservedCostMicros: number;
  costCurrency: Currency | null;
  version: number;
}
export type SetOrganizationResult = "saved" | "conflict" | "plan_required" | "ack_required" | "not_found";

export interface UsageRow {
  organizationId: string;
  organizationName: string;
  task: AiTask;
  requests: number;
  cacheHits: number;
  errors: number;
  /** Calls counted both in `requests` and in `errors` (tokens spent, outcome unknown): the error rate counts them once. */
  chargedUnknown?: number;
  inputTokens: number;
  outputTokens: number;
  /** Null when no call of the group was priced, or when the priced calls used more than one currency: shown as unknown, never 0. */
  costMicros: number | null;
  currency: Currency | null;
  /** Calls that spent tokens with no typed price: when above 0 and `costMicros` is set, the cost is PARTIAL (only the priced calls). */
  unpricedCalls: number;
  /** True when the priced calls used more than one currency (they are never added together). */
  mixedCurrency: boolean;
}
export interface CircuitView {
  providerKind: string;
  modelId: string;
  state: "CLOSED" | "OPEN" | "HALF_OPEN";
  consecutiveFailures: number;
  /** Since when the state holds (opened_at for OPEN/HALF_OPEN, else the last update). */
  since: string;
}
export interface AiAuditRow {
  id: string;
  action: string;
  createdAt: string;
  actorEmail: string;
  subject: string;
}

const intOk = (n: unknown, min: number, max: number): n is number => typeof n === "number" && Number.isInteger(n) && n >= min && n <= max;

export function aiPlatformFor(db: D1Database, context: PlatformContext) {
  const userId = context?.userId?.trim();
  if (!userId) throw new Error("AUTHENTICATION_REQUIRED");

  /** The audit row of the change that ran just before it in the batch (`changes()` is the preceding statement's count). */
  const audit = (action: AiAuditAction, subject: string, organizationId: string | null = null): D1PreparedStatement =>
    db
      .prepare(
        `INSERT INTO access_audit_events (id, organization_id, actor_user_id, action, subject_id, created_at)
         SELECT ?2, ?3, ?1, ?4, ?5, ?6 WHERE (SELECT changes()) > 0 AND ${writer}`,
      )
      .bind(userId, crypto.randomUUID(), organizationId, action, subject, new Date().toISOString());

  return {
    /** True for an active platform manager who has two-factor on: the only kind of actor that may change anything here (decision D5). */
    async canWrite(): Promise<boolean> {
      const row = await db.prepare(`SELECT 1 AS ok WHERE ${writer}`).bind(userId).first<{ ok: number }>();
      return row !== null;
    },

    // ---------- global switch ----------
    async getSettings(): Promise<{ killSwitch: boolean; byEmail: string | null; at: string | null }> {
      const row = await db
        .prepare(
          `SELECT s.kill_switch AS killSwitch, a.email AS byEmail, s.kill_switch_at AS at FROM ai_platform_settings s
             LEFT JOIN auth_user a ON a.id = s.kill_switch_by_user_id WHERE s.id = 1 AND ${adminGuard("?1")}`,
        )
        .bind(userId)
        .first<{ killSwitch: number; byEmail: string | null; at: string | null }>();
      return { killSwitch: row?.killSwitch === 1, byEmail: row?.byEmail ?? null, at: row?.at ?? null };
    },

    /** Returns false when the actor may not write (not an active gestor, or no two-factor). */
    async setKillSwitch(on: boolean, now: Date): Promise<boolean> {
      const results = await db.batch([
        db
          .prepare(`UPDATE ai_platform_settings SET kill_switch = ?2, kill_switch_by_user_id = ?1, kill_switch_at = ?3, updated_at = ?3 WHERE id = 1 AND ${writer}`)
          .bind(userId, on ? 1 : 0, iso(now)),
        audit(on ? "AI_KILL_SWITCH_ON" : "AI_KILL_SWITCH_OFF", "platform"),
      ]);
      return changesOf(results[0]) === 1;
    },

    // ---------- provider connections (keys are write-only) ----------
    async listConnections(): Promise<ConnectionRow[]> {
      const result = await db
        .prepare(
          `SELECT c.kind, c.key_last4 AS last4, c.connected_at AS connectedAt, a.email AS connectedByEmail, c.rotated_at AS rotatedAt,
                  c.last_test_at AS lastTestAt, c.last_test_ok AS lastTestOk, c.last_test_code AS lastTestCode, c.version
             FROM ai_provider_connections c LEFT JOIN auth_user a ON a.id = c.connected_by_user_id
            WHERE ${adminGuard("?1")} ORDER BY c.kind`,
        )
        .bind(userId)
        .all<Omit<ConnectionRow, "lastTestOk"> & { lastTestOk: number | null }>();
      return result.results.map((r) => ({ ...r, lastTestOk: r.lastTestOk === null ? null : r.lastTestOk === 1 }));
    },

    /** Connects (first time) or rotates (a key already exists). Returns what happened, or "denied" when the actor may not write. */
    async saveConnection(kind: RealProviderKind, sealed: SealedSecret, now: Date): Promise<"connected" | "rotated" | "denied"> {
      if (!(REAL_PROVIDER_KINDS as readonly string[]).includes(kind)) return "denied";
      const at = iso(now);
      const results = await db.batch([
        db
          .prepare(
            `UPDATE ai_provider_connections SET key_ciphertext = ?3, key_key_id = ?4, key_last4 = ?5, rotated_at = ?6, rotated_by_user_id = ?1,
               last_test_at = NULL, last_test_ok = NULL, last_test_code = NULL, version = version + 1
             WHERE kind = ?2 AND ${writer}`,
          )
          .bind(userId, kind, sealed.ciphertext, sealed.keyId, sealed.last4, at),
        audit("AI_PROVIDER_ROTATED", kind),
        db
          .prepare(
            `INSERT INTO ai_provider_connections (kind, key_ciphertext, key_key_id, key_last4, connected_at, connected_by_user_id)
             SELECT ?2, ?3, ?4, ?5, ?6, ?1 WHERE ${writer} AND NOT EXISTS (SELECT 1 FROM ai_provider_connections WHERE kind = ?2)`,
          )
          .bind(userId, kind, sealed.ciphertext, sealed.keyId, sealed.last4, at),
        audit("AI_PROVIDER_CONNECTED", kind),
      ]);
      return changesOf(results[0]) === 1 ? "rotated" : changesOf(results[2]) === 1 ? "connected" : "denied";
    },

    /** Refused with "mapped" while a task uses the provider. */
    async removeConnection(kind: RealProviderKind): Promise<"removed" | "mapped" | "not_found" | "denied"> {
      const results = await db.batch([
        db
          .prepare(`DELETE FROM ai_provider_connections WHERE kind = ?2 AND ${writer} AND NOT EXISTS (SELECT 1 FROM ai_task_settings WHERE provider_kind = ?2)`)
          .bind(userId, kind),
        audit("AI_PROVIDER_REMOVED", kind),
      ]);
      if (changesOf(results[0]) === 1) return "removed";
      const state = await db
        .prepare(
          `SELECT (SELECT COUNT(*) FROM ai_provider_connections WHERE kind = ?2) AS present, (SELECT COUNT(*) FROM ai_task_settings WHERE provider_kind = ?2) AS mapped
            WHERE ${writer}`,
        )
        .bind(userId, kind)
        .first<{ present: number; mapped: number }>();
      if (!state) return "denied";
      return state.mapped > 0 ? "mapped" : state.present === 0 ? "not_found" : "denied";
    },

    /** Result of "Testar conexão" / "Listar modelos": a code, never a message from the provider. */
    async recordTest(kind: RealProviderKind, ok: boolean, code: string | null, now: Date): Promise<boolean> {
      const results = await db.batch([
        db
          .prepare(`UPDATE ai_provider_connections SET last_test_at = ?3, last_test_ok = ?4, last_test_code = ?5 WHERE kind = ?2 AND ${writer}`)
          .bind(userId, kind, iso(now), ok ? 1 : 0, code ? code.slice(0, 40) : null),
        audit("AI_PROVIDER_TESTED", kind),
      ]);
      return changesOf(results[0]) === 1;
    },

    /** "Testar modelo" spends tokens outside any organization ledger: the audit row is its only trace. */
    async recordModelTest(task: AiTask, now: Date, minIntervalMs: number): Promise<"recorded" | "too_soon" | "denied"> {
      // One statement decides and the audit row follows only if it matched, so two concurrent clicks cannot both pass the interval.
      const results = await db.batch([
        db
          .prepare(
            `UPDATE ai_task_settings SET task = task WHERE task = ?2 AND ${writer}
               AND NOT EXISTS (SELECT 1 FROM access_audit_events a WHERE a.action = 'AI_MODEL_TESTED' AND a.subject_id = ?2 AND a.created_at > ?3)`,
          )
          .bind(userId, task, iso(new Date(now.getTime() - minIntervalMs))),
        audit("AI_MODEL_TESTED", task),
      ]);
      if (changesOf(results[0]) === 1) return "recorded";
      return (await this.lastModelTestAt(task)) ? "too_soon" : "denied";
    },

    // ---------- task -> provider / model ----------
    async getTasks(): Promise<TaskRow[]> {
      const result = await db
        .prepare(
          `SELECT task, enabled, provider_kind AS providerKind, model_id AS modelId, max_input_tokens AS maxInputTokens, max_output_tokens AS maxOutputTokens,
                  timeout_ms AS timeoutMs, max_retries AS maxRetries, currency, price_input_micros_per_million AS priceInputMicrosPerMillion,
                  price_output_micros_per_million AS priceOutputMicrosPerMillion, send_system_exercise_names AS sendSystemExerciseNames, version
             FROM ai_task_settings WHERE ${adminGuard("?1")} ORDER BY task`,
        )
        .bind(userId)
        .all<Omit<TaskRow, "enabled" | "sendSystemExerciseNames" | "maxRetries"> & { enabled: number; sendSystemExerciseNames: number; maxRetries: number }>();
      return result.results.map((r) => ({ ...r, enabled: r.enabled === 1, sendSystemExerciseNames: r.sendSystemExerciseNames === 1, maxRetries: r.maxRetries === 1 ? 1 : 0 }));
    },

    /** Compare-and-set on `version`; the provider must be connected (the mock only where the environment allows it); limits are clamped to the ceilings. */
    async saveTask(task: AiTask, input: TaskInput, expectedVersion: number, now: Date): Promise<SaveTaskResult> {
      const model = input.modelId?.trim() || null;
      const provider = input.providerKind?.trim() || null;
      if ((provider === null) !== (model === null)) return "invalid";
      if (provider !== null && ![...REAL_PROVIDER_KINDS, "mock"].includes(provider as never)) return "invalid";
      if (provider === "mock" && !input.mockAllowed) return "invalid";
      if (model !== null && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(model)) return "invalid";
      if (input.enabled && provider === null) return "invalid";
      if (!intOk(input.maxInputTokens, 500, 200_000) || !intOk(input.maxOutputTokens, 100, 32_000) || !intOk(input.timeoutMs, 2000, 120_000)) return "invalid";
      const p = input.prices;
      if (p && (!intOk(p.inputMicrosPerMillion, 0, 1e12) || !intOk(p.outputMicrosPerMillion, 0, 1e12) || !["BRL", "USD", "EUR"].includes(p.currency))) return "invalid";
      const maxOut = Math.min(input.maxOutputTokens, input.ceilings.maxOutputTokens);
      const timeout = Math.min(input.timeoutMs, input.ceilings.timeoutMs);
      const results = await db.batch([
        db
          .prepare(
            `UPDATE ai_task_settings SET enabled = ?3, provider_kind = ?4, model_id = ?5, max_input_tokens = ?6, max_output_tokens = ?7, timeout_ms = ?8, max_retries = ?9,
               currency = ?10, price_input_micros_per_million = ?11, price_output_micros_per_million = ?12, send_system_exercise_names = ?13,
               updated_at = ?14, updated_by_user_id = ?1, version = version + 1
             WHERE task = ?2 AND version = ?15 AND ${writer}
               AND (?4 IS NULL OR ?4 = 'mock' OR EXISTS (SELECT 1 FROM ai_provider_connections WHERE kind = ?4))`,
          )
          .bind(
            userId, task, input.enabled ? 1 : 0, provider, model, input.maxInputTokens, maxOut, timeout, input.maxRetries, p?.currency ?? null,
            p?.inputMicrosPerMillion ?? null, p?.outputMicrosPerMillion ?? null, input.sendSystemExerciseNames ? 1 : 0, iso(now), expectedVersion,
          ),
        audit("AI_TASK_CONFIGURED", task),
      ]);
      if (changesOf(results[0]) === 1) return "saved";
      const row = await db
        .prepare(`SELECT version, (SELECT COUNT(*) FROM ai_provider_connections WHERE kind = ?3) AS connected FROM ai_task_settings WHERE task = ?2 AND ${writer}`)
        .bind(userId, task, provider)
        .first<{ version: number; connected: number }>();
      if (!row) return "invalid";
      if (row.version !== expectedVersion) return "conflict";
      return provider && provider !== "mock" && row.connected === 0 ? "provider_not_connected" : "invalid";
    },

    // ---------- quota plans ----------
    async listPlans(): Promise<PlanRow[]> {
      const result = await db
        .prepare(
          `SELECT qp.id, qp.name, qp.allowance_mode AS mode, qp.monthly_total_tokens AS totalTokens, qp.monthly_input_tokens AS inputTokens,
                  qp.monthly_output_tokens AS outputTokens, qp.per_request_cap_planning AS perRequestCapPlanning, qp.per_request_cap_adjustment AS perRequestCapAdjustment,
                  qp.requests_per_minute AS requestsPerMinute, qp.monthly_cost_cap_micros AS costCapMicros, qp.cost_cap_currency AS costCapCurrency,
                  qp.archived_at AS archivedAt, qp.version,
                  (SELECT COUNT(*) FROM ai_organization_settings os WHERE os.quota_plan_id = qp.id) AS organizations
             FROM ai_quota_plans qp WHERE ${adminGuard("?1")} ORDER BY qp.archived_at IS NOT NULL, qp.name_key`,
        )
        .bind(userId)
        .all<PlanRow>();
      return result.results;
    },

    /** Create (`expectedVersion` null) or edit. Zero allowance is allowed: it means "IA não incluída". A cost cap needs every task that has typed prices to use the same currency. */
    async savePlan(planId: string | null, input: PlanInput, expectedVersion: number | null, now: Date): Promise<SavePlanResult> {
      const name = input.name.replace(/\s+/g, " ").trim();
      const a = input.allowance;
      const tokensOk = a.mode === "TOTAL" ? intOk(a.total, 0, 1e12) : intOk(a.input, 0, 1e12) && intOk(a.output, 0, 1e12);
      if (name.length < 1 || name.length > 60 || !tokensOk || !intOk(input.perRequestCapPlanning, 0, 1e9) || !intOk(input.perRequestCapAdjustment, 0, 1e9)
        || !intOk(input.requestsPerMinute, 1, 120) || (input.costCap && (!intOk(input.costCap.micros, 0, 1e15) || !["BRL", "USD", "EUR"].includes(input.costCap.currency)))) {
        return { ok: false, reason: "invalid" };
      }
      const key = nameKey(name);
      const cap = input.costCap;
      const fields = [
        name, key, a.mode, a.mode === "TOTAL" ? a.total : null, a.mode === "SPLIT" ? a.input : null, a.mode === "SPLIT" ? a.output : null,
        input.perRequestCapPlanning, input.perRequestCapAdjustment,
      ];
      const at = iso(now);
      try {
        let results;
        if (planId === null) {
          const id = crypto.randomUUID();
          results = await db.batch([
            db
              .prepare(
                `INSERT INTO ai_quota_plans (id, name, name_key, allowance_mode, monthly_total_tokens, monthly_input_tokens, monthly_output_tokens, per_request_cap_planning,
                   per_request_cap_adjustment, monthly_cost_cap_micros, cost_cap_currency, requests_per_minute, created_at, created_by_user_id, updated_at, updated_by_user_id)
                 SELECT ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?1, ?14, ?1 WHERE ${writer} AND (?11 IS NULL OR NOT EXISTS
                   (SELECT 1 FROM ai_task_settings WHERE price_input_micros_per_million IS NOT NULL AND currency <> ?12))`,
              )
              .bind(userId, id, ...fields, cap?.micros ?? null, cap?.currency ?? null, input.requestsPerMinute, at),
            audit("AI_PLAN_SAVED", id),
          ]);
          if (changesOf(results[0]) === 1) return { ok: true, id };
        } else {
          results = await db.batch([
            db
              .prepare(
                `UPDATE ai_quota_plans SET name = ?3, name_key = ?4, allowance_mode = ?5, monthly_total_tokens = ?6, monthly_input_tokens = ?7, monthly_output_tokens = ?8,
                   per_request_cap_planning = ?9, per_request_cap_adjustment = ?10, monthly_cost_cap_micros = ?11, cost_cap_currency = ?12, requests_per_minute = ?13,
                   updated_at = ?14, updated_by_user_id = ?1, version = version + 1
                 WHERE id = ?2 AND version = ?15 AND archived_at IS NULL AND ${writer}
                   AND (?11 IS NULL OR NOT EXISTS (SELECT 1 FROM ai_task_settings WHERE price_input_micros_per_million IS NOT NULL AND currency <> ?12))`,
              )
              .bind(userId, planId, ...fields, cap?.micros ?? null, cap?.currency ?? null, input.requestsPerMinute, at, expectedVersion),
            audit("AI_PLAN_SAVED", planId),
          ]);
          if (changesOf(results[0]) === 1) return { ok: true, id: planId };
        }
      } catch (error) {
        if (String(error).includes("name_key")) return { ok: false, reason: "name_taken" };
        throw error;
      }
      if (planId !== null) {
        const row = await db.prepare(`SELECT version, archived_at AS archivedAt FROM ai_quota_plans WHERE id = ?2 AND ${writer}`).bind(userId, planId).first<{ version: number; archivedAt: string | null }>();
        if (!row || row.archivedAt) return { ok: false, reason: "not_found" };
        if (row.version !== expectedVersion) return { ok: false, reason: "conflict" };
      }
      return { ok: false, reason: cap ? "currency_mismatch" : "invalid" };
    },

    async archivePlan(planId: string, now: Date): Promise<boolean> {
      const results = await db.batch([
        db.prepare(`UPDATE ai_quota_plans SET archived_at = ?3, updated_at = ?3, updated_by_user_id = ?1, version = version + 1 WHERE id = ?2 AND archived_at IS NULL AND ${writer}`).bind(userId, planId, iso(now)),
        audit("AI_PLAN_ARCHIVED", planId),
      ]);
      return changesOf(results[0]) === 1;
    },

    // ---------- organizations ----------
    async listOrganizations(month: string): Promise<OrganizationAiRow[]> {
      const result = await db
        .prepare(
          `SELECT o.id AS organizationId, o.name AS organizationName, COALESCE(os.enabled, 0) AS enabled, os.quota_plan_id AS quotaPlanId, qp.name AS quotaPlanName,
                  COALESCE(um.used_input + um.used_output, 0) AS usedTokens, COALESCE(um.used_input, 0) AS usedInput,
                  COALESCE(um.used_output, 0) AS usedOutput, COALESCE(um.reserved_input + um.reserved_output, 0) AS reservedTokens,
                  COALESCE(um.reserved_input, 0) AS reservedInput, COALESCE(um.reserved_output, 0) AS reservedOutput, COALESCE(um.cost_micros, 0) AS costMicros,
                  COALESCE(um.reserved_cost_micros, 0) AS reservedCostMicros, um.cost_currency AS costCurrency, COALESCE(os.version, 0) AS version
             FROM organizations o LEFT JOIN ai_organization_settings os ON os.organization_id = o.id
             LEFT JOIN ai_quota_plans qp ON qp.id = os.quota_plan_id
             LEFT JOIN ai_usage_month um ON um.organization_id = o.id AND um.month = ?2
            WHERE ${adminGuard("?1")} ORDER BY o.name, o.id`,
        )
        .bind(userId, month)
        .all<Omit<OrganizationAiRow, "enabled"> & { enabled: number }>();
      return result.results.map((r) => ({ ...r, enabled: r.enabled === 1 }));
    },

    /**
     * Enabling needs a plan (assigned in the same call or before, not archived) and the acknowledgement of the CURRENT version; the actor and
     * the time are recorded. Disabling is immediate and keeps history. `expectedVersion` is 0 for an organization with no row yet.
     */
    async setOrganization(
      organizationId: string,
      change: { enabled?: boolean; quotaPlanId?: string | null; ackVersion?: string },
      expectedVersion: number,
      currentAckVersion: string,
      now: Date,
    ): Promise<SetOrganizationResult> {
      const enableSet = change.enabled !== undefined ? 1 : 0;
      const enable = change.enabled ? 1 : 0;
      if (enable === 1 && change.ackVersion !== currentAckVersion) return "ack_required";
      const planSet = change.quotaPlanId !== undefined ? 1 : 0;
      const at = iso(now);
      const results = await db.batch([
        db
          .prepare(`INSERT OR IGNORE INTO ai_organization_settings (organization_id, updated_at) SELECT o.id, ?3 FROM organizations o WHERE o.id = ?2 AND ${writer}`)
          .bind(userId, organizationId, at),
        db
          .prepare(
            `UPDATE ai_organization_settings SET
               quota_plan_id = CASE WHEN ?3 = 1 THEN ?4 ELSE quota_plan_id END,
               plan_assigned_at = CASE WHEN ?3 = 1 THEN ?9 ELSE plan_assigned_at END,
               plan_assigned_by_user_id = CASE WHEN ?3 = 1 THEN ?1 ELSE plan_assigned_by_user_id END,
               enabled = CASE WHEN ?5 = 1 THEN ?6 ELSE enabled END,
               enabled_at = CASE WHEN ?5 = 1 AND ?6 = 1 THEN ?9 ELSE enabled_at END,
               enabled_by_user_id = CASE WHEN ?5 = 1 AND ?6 = 1 THEN ?1 ELSE enabled_by_user_id END,
               ack_version = CASE WHEN ?5 = 1 AND ?6 = 1 THEN ?7 ELSE ack_version END,
               version = version + 1, updated_at = ?9
             WHERE organization_id = ?2 AND version = ?8 AND ${writer}
               AND (?5 = 0 OR ?6 = 0 OR EXISTS (SELECT 1 FROM ai_quota_plans qp
                    WHERE qp.id = (CASE WHEN ?3 = 1 THEN ?4 ELSE ai_organization_settings.quota_plan_id END) AND qp.archived_at IS NULL))`,
          )
          .bind(userId, organizationId, planSet, change.quotaPlanId ?? null, enableSet, enable, change.ackVersion ?? null, expectedVersion === 0 ? 1 : expectedVersion, at),
        ...(change.enabled !== undefined ? [audit(change.enabled ? "AI_ORG_ENABLED" : "AI_ORG_DISABLED", organizationId, organizationId)] : []),
        ...(planSet === 1 ? [audit("AI_ORG_PLAN_ASSIGNED", organizationId, organizationId)] : []),
      ]);
      if (changesOf(results[1]) === 1) return "saved";
      const row = await db
        .prepare(`SELECT (SELECT version FROM ai_organization_settings WHERE organization_id = ?2) AS version, (SELECT COUNT(*) FROM organizations WHERE id = ?2) AS present WHERE ${writer}`)
        .bind(userId, organizationId)
        .first<{ version: number | null; present: number }>();
      if (!row || row.present === 0) return "not_found";
      if ((row.version ?? 0) !== (expectedVersion === 0 ? 1 : expectedVersion)) return "conflict";
      return "plan_required";
    },

    // ---------- usage and audit ----------
    async usage(month: string): Promise<UsageRow[]> {
      const result = await db
        .prepare(
          `SELECT l.organization_id AS organizationId, o.name AS organizationName, l.task,
                  SUM(CASE WHEN l.cache_hit = 0 AND l.state IN ('SETTLED','CHARGED_UNKNOWN') THEN 1 ELSE 0 END) AS requests,
                  SUM(l.cache_hit) AS cacheHits,
                  SUM(CASE WHEN l.state IN ('RELEASED','CHARGED_UNKNOWN') THEN 1 ELSE 0 END) AS errors,
                  SUM(CASE WHEN l.cache_hit = 0 AND l.state = 'CHARGED_UNKNOWN' THEN 1 ELSE 0 END) AS chargedUnknown,
                  COALESCE(SUM(l.input_tokens), 0) AS inputTokens, COALESCE(SUM(l.output_tokens), 0) AS outputTokens,
                  CASE WHEN COUNT(DISTINCT l.currency) > 1 THEN NULL ELSE SUM(l.cost_micros) END AS costMicros,
                  CASE WHEN COUNT(DISTINCT l.currency) > 1 THEN NULL ELSE MAX(l.currency) END AS currency,
                  SUM(CASE WHEN l.cache_hit = 0 AND l.state IN ('SETTLED','CHARGED_UNKNOWN') AND l.cost_micros IS NULL THEN 1 ELSE 0 END) AS unpricedCalls,
                  CASE WHEN COUNT(DISTINCT l.currency) > 1 THEN 1 ELSE 0 END AS mixedCurrency
             FROM ai_usage_ledger l JOIN organizations o ON o.id = l.organization_id
            WHERE l.month = ?2 AND ${adminGuard("?1")}
            GROUP BY l.organization_id, l.task ORDER BY o.name, l.task`,
        )
        .bind(userId, month)
        .all<Omit<UsageRow, "mixedCurrency"> & { mixedCurrency: number }>();
      return result.results.map((r) => ({ ...r, mixedCurrency: r.mixedCurrency === 1 }));
    },

    /** Last "Testar modelo" of a task (any manager): the panel allows one test per task every few seconds. */
    async lastModelTestAt(task: AiTask): Promise<string | null> {
      const row = await db
        .prepare(`SELECT MAX(a.created_at) AS at FROM access_audit_events a WHERE a.action = 'AI_MODEL_TESTED' AND a.subject_id = ?2 AND ${adminGuard("?1")}`)
        .bind(userId, task)
        .first<{ at: string | null }>();
      return row?.at ?? null;
    },

    async listCircuits(): Promise<CircuitView[]> {
      const result = await db
        .prepare(
          `SELECT provider_kind AS providerKind, model_id AS modelId, state, consecutive_failures AS consecutiveFailures, COALESCE(opened_at, updated_at) AS since
             FROM ai_circuit_state WHERE ${adminGuard("?1")} ORDER BY provider_kind, model_id`,
        )
        .bind(userId)
        .all<CircuitView>();
      return result.results;
    },

    async listAuditAi(limit = 50): Promise<AiAuditRow[]> {
      const actions = AI_AUDIT_ACTIONS.map((a) => `'${a}'`).join(",");
      const result = await db
        .prepare(
          `SELECT a.id, a.action, a.created_at AS createdAt, au.email AS actorEmail, a.subject_id AS subject
             FROM access_audit_events a JOIN auth_user au ON au.id = a.actor_user_id
            WHERE ${adminGuard("?1")} AND a.action IN (${actions}) ORDER BY a.created_at DESC, a.id LIMIT ?2`,
        )
        .bind(userId, Math.min(Math.max(limit, 1), 200))
        .all<AiAuditRow>();
      return result.results;
    },
  };
}
