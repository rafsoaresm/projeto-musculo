import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { canonicalJson, sha256Hex } from "@/modules/prescricao/motor/hash";
import type {
  EngineResult,
  FlagDecision,
  ItemOut,
  ItemTarget,
  OccurrenceOut,
} from "@/modules/prescricao/motor/types";
import { revisionGate, type RevisionGateMode } from "./revision-gates";
import { activeUser, assertContext, technicalAccessExists, type AuthenticatedContext } from "./students";

/**
 * Automatic prescription proposals (motor S6, design §4.1–§4.2). A proposal is the engine's workspace on one DRAFT revision:
 * generate, continue, regenerate a scope, substitute, lock, decide a flag, rebase, discard. Nothing here writes a prescription,
 * approves or delivers anything; applying a proposal to the draft is S7.
 *
 * Every statement binds ?1 organization, ?2 user, ?3 plan, ?4 revision (the shared gate, `revision-gates.ts`), from the verified
 * session. Every read is gated by organization + active user + active technical assignment + revocation.
 *
 * Concurrency: every change is a compare-and-set on `version` with a client write id (`last_write_id`); the statements after the
 * first run only when the proposal carries that write id at the expected next version (one D1 batch = one transaction). A
 * retry with the same write id or idempotency key answers "replayed" instead of writing twice; the same key with another
 * request hash answers `key_reused`. Errors from the database are never mapped blindly: after a failure the rows are read
 * again to tell what happened.
 */

export type GenerationScopeKind =
  | "FULL"
  | "CONTINUE"
  | "ITEM"
  | "OCCURRENCE"
  | "WEEK"
  | "WORKOUT"
  | "PHASE"
  | "FROM_PHASE"
  | "SUBSTITUTE"
  | "REBASE";

/** What one engine run read and produced, for the append-only ledger (no health free text: ids, codes, hashes). */
export interface GenerationRecord {
  idempotencyKey: string;
  requestHash: string;
  scope: GenerationScopeKind;
  scopeJson: unknown;
  /** The revision's content_version the engine input was read at (for REBASE, the new base). */
  baseContentVersion: number;
  catalogHash: string;
  inputHash: string;
  facts: unknown;
  studentId: string;
  /** Canonical engine input for replay; null when it passes the column's technical size (the ledger keeps the hashes). */
  inputJson: string | null;
  /** The professional's answers the proposal was generated with (shown again as "da geração anterior"). */
  parameters: unknown;
}

export type GenerateOutcome =
  | { status: "created" | "replayed"; proposalId: string; version: number; complete: boolean }
  | { status: "revision_changed"; contentVersion: number }
  | { status: "open_exists"; proposalId: string }
  | { status: "key_reused" }
  | { status: "not_open" }
  | { status: "too_large" }
  | { status: "not_found" };

export type MutateOutcome =
  | { status: "saved"; version: number; replayed: boolean }
  | { status: "conflict"; version: number }
  | { status: "revision_changed"; contentVersion: number }
  | { status: "key_reused" }
  | { status: "closed" }
  | { status: "not_open" }
  | { status: "invalid_target" }
  | { status: "too_large" }
  | { status: "not_found" };

export type ProposalState = "OPEN" | "APPLIED" | "DISCARDED" | "SUPERSEDED";

export interface ProposalHeader {
  id: string;
  planId: string;
  revisionId: string;
  state: ProposalState;
  version: number;
  baseContentVersion: number;
  engineVersion: string;
  rulesId: string;
  rulesVersion: string;
  /** The answers of the latest generation (parsed JSON; the caller validates before use). */
  parameters: unknown;
  status: "SUCCEEDED" | "INFEASIBLE";
  validation: "PASSED" | "WARNINGS" | "BLOCKED";
  complete: boolean;
  phasesGenerated: number[];
  outputHash: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  /** The revision now: its state and content counter (a proposal on an older counter must be rebased). */
  revisionState: string;
  contentVersion: number;
  /** Ledger references of the latest generation of this proposal (ids, dates, counts, catalog hash). */
  lastFacts: unknown;
}

/** The proposal's result without the sessions: what `summary_json` holds. */
export type ProposalSummary = Omit<EngineResult, "occurrences">;

export interface ProposalPage {
  header: ProposalHeader;
  summary: ProposalSummary;
  occurrences: OccurrenceOut[];
}

export interface ProposalHistory {
  proposals: Array<{
    id: string;
    state: ProposalState;
    version: number;
    status: string;
    validation: string;
    complete: boolean;
    createdAt: string;
    closedAt: string | null;
    generations: Array<{
      id: string;
      scope: GenerationScopeKind;
      createdAt: string;
      engineVersion: string;
      rulesId: string;
      rulesVersion: string;
      status: string;
      validation: string;
      outputHash: string;
      inputStored: boolean;
    }>;
    decisions: Array<{ action: string; createdAt: string; actorUserId: string; versionAfter: number }>;
  }>;
}

/**
 * Technical limit, not a training rule: rows of sessions/items go to D1 as ONE bound JSON value per statement (`json_each`),
 * never in the SQL text. Each statement carries at most this many bytes of JSON. Measured on local workerd (S6, docs/VALIDACAO.md):
 * not a production figure.
 */
export const PROPOSAL_WRITE_CHUNK_BYTES = 256_000;
/** Column limit of `prescription_generation_inputs.input_json` (0042). */
export const GENERATION_INPUT_MAX = 900_000;
/** Lock/unlock targets per request: the decision row's `target_json` is at most 2000 characters (0042). */
export const MAX_LOCK_TARGETS = 5;

const DECISION_FOR_SCOPE: Record<GenerationScopeKind, string> = {
  FULL: "GENERATED",
  CONTINUE: "CONTINUED",
  ITEM: "REGENERATE_ITEM",
  OCCURRENCE: "REGENERATE_OCCURRENCE",
  WEEK: "REGENERATE_WEEK",
  WORKOUT: "REGENERATE_WORKOUT",
  PHASE: "REGENERATE_PHASE",
  FROM_PHASE: "REGENERATE_FROM_PHASE",
  SUBSTITUTE: "SUBSTITUTE",
  REBASE: "REBASE",
};
const EVENT_FOR_SCOPE: Record<GenerationScopeKind, string> = {
  FULL: "PROPOSAL_GENERATED",
  CONTINUE: "PROPOSAL_CONTINUED",
  ITEM: "PROPOSAL_REGENERATED",
  OCCURRENCE: "PROPOSAL_REGENERATED",
  WEEK: "PROPOSAL_REGENERATED",
  WORKOUT: "PROPOSAL_REGENERATED",
  PHASE: "PROPOSAL_REGENERATED",
  FROM_PHASE: "PROPOSAL_REGENERATED",
  SUBSTITUTE: "PROPOSAL_SUBSTITUTED",
  REBASE: "PROPOSAL_REBASED",
};

/** SHA-256 of the canonical result: the proposal's `output_hash`. */
export async function outputHashOf(result: EngineResult): Promise<string> {
  return sha256Hex(canonicalJson(result));
}

export function summaryOf(result: EngineResult): ProposalSummary {
  const { occurrences, ...summary } = result;
  void occurrences;
  return summary;
}

const occKey = (o: { phaseIndex: number; week: number; slot: number }) => `${o.phaseIndex}|${o.week}|${o.slot}`;

function issueCodes(result: EngineResult): string[] {
  return [...new Set(result.issues.map((i) => i.code))].sort();
}

/** Splits rows into JSON arrays of at most `max` bytes each (a single bigger row goes alone). */
export function jsonChunks(rows: unknown[], max = PROPOSAL_WRITE_CHUNK_BYTES): string[] {
  const out: string[] = [];
  let current: string[] = [];
  let size = 2;
  for (const row of rows) {
    const text = JSON.stringify(row);
    if (current.length && size + text.length + 1 > max) {
      out.push(`[${current.join(",")}]`);
      current = [];
      size = 2;
    }
    current.push(text);
    size += text.length + 1;
  }
  if (current.length) out.push(`[${current.join(",")}]`);
  return out;
}

function occurrenceRow(o: OccurrenceOut) {
  return {
    id: crypto.randomUUID(),
    p: o.phaseIndex,
    w: o.week,
    s: o.slot,
    label: o.label,
    weekStart: o.weekStart,
    plannedDate: o.plannedDate,
    stimulus: o.stimulus?.value ?? null,
    stimulusJson: o.stimulus ? JSON.stringify(o.stimulus) : null,
    estimatedMinutes: o.estimatedMinutes,
    durationComplete: o.durationComplete ? 1 : 0,
    budgetMinutes: o.budgetMinutes,
    budgetSource: o.budgetSource,
  };
}

function itemRow(o: OccurrenceOut, i: ItemOut) {
  return {
    id: crypto.randomUUID(),
    p: o.phaseIndex,
    w: o.week,
    s: o.slot,
    slotKey: i.slotKey,
    substitutesSlotKey: i.substitutesSlotKey,
    position: i.position,
    exerciseId: i.exerciseId,
    exerciseName: i.exerciseName,
    modality: i.modality,
    metric: i.dose?.metric ?? null,
    doseJson: i.dose ? JSON.stringify(i.dose) : null,
    doseText: i.display.doseText,
    sets: i.display.sets,
    reps: i.display.reps,
    loadInstruction: i.display.loadInstruction,
    cadence: i.display.cadence,
    restSeconds: i.display.restSeconds,
    restText: i.display.restText,
    rirMin: i.display.rirMin,
    rirMax: i.display.rirMax,
    traceJson: JSON.stringify(i.trace),
    alternativesJson: JSON.stringify(i.alternatives),
    metadata: i.metadata,
    origin: i.origin,
    existingId: i.existingPrescribedExerciseId,
  };
}

interface HeaderRow {
  id: string;
  planId: string;
  revisionId: string;
  state: ProposalState;
  version: number;
  baseContentVersion: number;
  engineVersion: string;
  rulesId: string;
  rulesVersion: string;
  parametersJson: string;
  status: "SUCCEEDED" | "INFEASIBLE";
  validation: "PASSED" | "WARNINGS" | "BLOCKED";
  complete: number;
  phasesGenerated: string;
  outputHash: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  revisionState: string;
  contentVersion: number;
  lastFacts: string | null;
  summaryJson: string;
}
interface OccurrenceDbRow {
  phaseIndex: number;
  week: number;
  slot: number;
  label: string;
  weekStart: string;
  plannedDate: string | null;
  stimulusJson: string | null;
  estimatedMinutes: number | null;
  durationComplete: number;
  budgetMinutes: number | null;
  budgetSource: OccurrenceOut["budgetSource"];
}
interface ItemDbRow {
  id: string;
  phaseIndex: number;
  week: number;
  slot: number;
  slotKey: string;
  substitutesSlotKey: string | null;
  position: number;
  exerciseId: string | null;
  exerciseName: string;
  modality: string | null;
  doseJson: string | null;
  doseText: string | null;
  sets: string | null;
  reps: string | null;
  loadInstruction: string | null;
  cadence: string | null;
  restSeconds: number | null;
  restText: string | null;
  rirMin: number | null;
  rirMax: number | null;
  traceJson: string;
  alternativesJson: string;
  metadata: ItemOut["metadata"];
  origin: ItemOut["origin"];
  existingId: string | null;
}

function toHeader(row: HeaderRow): ProposalHeader {
  return {
    id: row.id,
    planId: row.planId,
    revisionId: row.revisionId,
    state: row.state,
    version: row.version,
    baseContentVersion: row.baseContentVersion,
    engineVersion: row.engineVersion,
    rulesId: row.rulesId,
    rulesVersion: row.rulesVersion,
    parameters: JSON.parse(row.parametersJson) as unknown,
    status: row.status,
    validation: row.validation,
    complete: row.complete === 1,
    phasesGenerated: JSON.parse(row.phasesGenerated) as number[],
    outputHash: row.outputHash,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    closedAt: row.closedAt,
    revisionState: row.revisionState,
    contentVersion: row.contentVersion,
    lastFacts: row.lastFacts ? (JSON.parse(row.lastFacts) as unknown) : null,
  };
}

function toOccurrences(occurrences: OccurrenceDbRow[], items: ItemDbRow[]): OccurrenceOut[] {
  const byOcc = new Map<string, ItemOut[]>();
  for (const i of items) {
    const list = byOcc.get(occKey({ phaseIndex: i.phaseIndex, week: i.week, slot: i.slot })) ?? [];
    list.push({
      slotKey: i.slotKey,
      position: i.position,
      exerciseId: i.exerciseId,
      exerciseName: i.exerciseName,
      modality: i.modality,
      dose: i.doseJson ? (JSON.parse(i.doseJson) as ItemOut["dose"]) : null,
      display: {
        sets: i.sets,
        reps: i.reps,
        loadInstruction: i.loadInstruction,
        cadence: i.cadence,
        restSeconds: i.restSeconds,
        restText: i.restText,
        rirMin: i.rirMin,
        rirMax: i.rirMax,
        doseText: i.doseText ?? "",
      },
      origin: i.origin,
      existingPrescribedExerciseId: i.existingId,
      substitutesSlotKey: i.substitutesSlotKey,
      alternatives: JSON.parse(i.alternativesJson) as string[],
      metadata: i.metadata,
      trace: JSON.parse(i.traceJson) as ItemOut["trace"],
    });
    byOcc.set(occKey({ phaseIndex: i.phaseIndex, week: i.week, slot: i.slot }), list);
  }
  return occurrences.map((o) => ({
    phaseIndex: o.phaseIndex,
    week: o.week,
    slot: o.slot,
    label: o.label,
    plannedDate: o.plannedDate,
    weekStart: o.weekStart,
    stimulus: o.stimulusJson ? (JSON.parse(o.stimulusJson) as OccurrenceOut["stimulus"]) : null,
    items: (byOcc.get(occKey(o)) ?? []).sort((a, b) => a.position - b.position),
    estimatedMinutes: o.estimatedMinutes,
    durationComplete: o.durationComplete === 1,
    budgetMinutes: o.budgetMinutes,
    budgetSource: o.budgetSource,
  }));
}

/** An item still holds the professional's substitution after an unlock when its trace says so. */
function unlockedOrigin(item: ItemOut): ItemOut["origin"] {
  return item.trace.selection.some((t) => t.code === "PROFESSIONAL_SUBSTITUTION") ? "SUBSTITUTED" : "ENGINE";
}

/** Database errors with a specific meaning. Anything else is rethrown (a bug), never mapped to an answer. */
function knownFailure(error: unknown): "not_open" | "closed" | "invalid_target" | "too_large" | "unique" | null {
  const text = String(error);
  if (text.includes("PLAN_REVISION_FROZEN")) return "not_open";
  if (text.includes("PROPOSAL_CLOSED")) return "closed";
  if (text.includes("PROPOSAL_ITEM_INVALID")) return "invalid_target";
  if (text.includes("CHECK constraint failed")) return "too_large";
  if (text.includes("UNIQUE")) return "unique";
  return null;
}

export function proposalsFor(db: D1Database, context: AuthenticatedContext | null) {
  const { userId, organizationId } = assertContext(context);
  const draft = revisionGate("DRAFT");
  const any = revisionGate("ANY");
  // ?5 proposal, ?6 write id, ?7 the version the proposal has right after this write.
  const token = `EXISTS (SELECT 1 FROM prescription_proposals tok
    WHERE tok.organization_id = ?1 AND tok.id = ?5 AND tok.last_write_id = ?6 AND tok.version = ?7)`;
  const gated = (sql: string, planId: string, revisionId: string, proposalId: string, writeId: string, versionAfter: number, ...rest: unknown[]) =>
    db.prepare(sql).bind(organizationId, userId, planId, revisionId, proposalId, writeId, versionAfter, ...rest);

  const headerSql = (gate: string) => `SELECT p.id, p.plan_id AS planId, p.revision_id AS revisionId, p.state, p.version,
      p.base_content_version AS baseContentVersion, p.engine_version AS engineVersion, p.rules_id AS rulesId,
      p.rules_version AS rulesVersion, p.parameters_json AS parametersJson, p.status, p.validation, p.complete,
      p.phases_generated AS phasesGenerated, p.output_hash AS outputHash, p.created_at AS createdAt, p.updated_at AS updatedAt,
      p.closed_at AS closedAt, p.summary_json AS summaryJson,
      (SELECT r.state FROM plan_revisions r WHERE r.organization_id = p.organization_id AND r.id = p.revision_id) AS revisionState,
      (SELECT r.content_version FROM plan_revisions r WHERE r.organization_id = p.organization_id AND r.id = p.revision_id) AS contentVersion,
      (SELECT g.facts_json FROM prescription_generations g WHERE g.organization_id = p.organization_id AND g.proposal_id = p.id
        ORDER BY g.created_at DESC, g.rowid DESC LIMIT 1) AS lastFacts
    FROM prescription_proposals p
    WHERE p.organization_id = ?1 AND p.plan_id = ?3 AND p.revision_id = ?4 AND ${gate}`;
  const occurrenceSql = `SELECT o.phase_index AS phaseIndex, o.week_index AS week, o.slot_index AS slot, o.workout_label AS label,
      o.week_start AS weekStart, o.planned_date AS plannedDate, o.stimulus_json AS stimulusJson,
      o.estimated_minutes AS estimatedMinutes, o.duration_complete AS durationComplete, o.budget_minutes AS budgetMinutes,
      o.budget_source AS budgetSource
    FROM proposal_occurrences o
    JOIN prescription_proposals p ON p.organization_id = o.organization_id AND p.id = o.proposal_id
    WHERE o.organization_id = ?1 AND o.proposal_id = ?5 AND p.plan_id = ?3 AND p.revision_id = ?4 AND ${draft}
      AND (?6 IS NULL OR o.phase_index = ?6) AND (?7 IS NULL OR o.week_index = ?7)
    ORDER BY o.phase_index, o.week_index, o.slot_index`;
  const itemSql = `SELECT i.id, o.phase_index AS phaseIndex, o.week_index AS week, o.slot_index AS slot, i.slot_key AS slotKey,
      i.substitutes_slot_key AS substitutesSlotKey, i.position, i.exercise_id AS exerciseId, i.exercise_name AS exerciseName,
      i.modality, i.dose_json AS doseJson, i.dose_text AS doseText, i.sets, i.reps, i.load_instruction AS loadInstruction,
      i.cadence, i.rest_seconds AS restSeconds, i.rest_text AS restText, i.rir_min AS rirMin, i.rir_max AS rirMax,
      i.trace_json AS traceJson, i.alternatives_json AS alternativesJson, i.metadata_trust AS metadata, i.origin,
      i.existing_prescribed_exercise_id AS existingId
    FROM proposal_items i
    JOIN proposal_occurrences o ON o.organization_id = i.organization_id AND o.id = i.proposal_occurrence_id
    JOIN prescription_proposals p ON p.organization_id = i.organization_id AND p.id = i.proposal_id
    WHERE i.organization_id = ?1 AND i.proposal_id = ?5 AND p.plan_id = ?3 AND p.revision_id = ?4 AND ${draft}
      AND (?6 IS NULL OR o.phase_index = ?6) AND (?7 IS NULL OR o.week_index = ?7)
    ORDER BY o.phase_index, o.week_index, o.slot_index, i.position`;

  /** Header, sessions and items read in one batch (one transaction): a consistent snapshot of one version. */
  async function snapshot(
    planId: string,
    revisionId: string,
    proposalId: string,
    page: { phaseIndex?: number; week?: number } = {},
  ): Promise<{ header: ProposalHeader; summary: ProposalSummary; occurrences: OccurrenceOut[]; itemIds: Map<string, string> } | null> {
    const binds = [organizationId, userId, planId, revisionId, proposalId, page.phaseIndex ?? null, page.week ?? null];
    const [h, o, i] = await db.batch([
      db.prepare(`${headerSql(draft)} AND p.id = ?5`).bind(organizationId, userId, planId, revisionId, proposalId),
      db.prepare(occurrenceSql).bind(...binds),
      db.prepare(itemSql).bind(...binds),
    ]);
    const row = (h.results as HeaderRow[])[0];
    if (!row) return null;
    const items = i.results as ItemDbRow[];
    return {
      header: toHeader(row),
      summary: JSON.parse(row.summaryJson) as ProposalSummary,
      occurrences: toOccurrences(o.results as OccurrenceDbRow[], items),
      // (session, slot) -> row id, for writes that address one stored row (lock, unlock)
      itemIds: new Map(items.map((x) => [`${occKey({ phaseIndex: x.phaseIndex, week: x.week, slot: x.slot })}|${x.slotKey}`, x.id])),
    };
  }

  async function header(planId: string, revisionId: string, proposalId: string, mode: RevisionGateMode = "DRAFT") {
    const row = await db
      .prepare(`${headerSql(mode === "DRAFT" ? draft : any)} AND p.id = ?5`)
      .bind(organizationId, userId, planId, revisionId, proposalId)
      .first<HeaderRow>();
    return row ? toHeader(row) : null;
  }

  /** The generation with this key on this revision (gated), to tell a replay from a reused key. */
  async function byKey(planId: string, revisionId: string, key: string) {
    return db
      .prepare(
        `SELECT g.proposal_id AS proposalId, g.request_hash AS requestHash FROM prescription_generations g
         WHERE g.organization_id = ?1 AND g.plan_id = ?3 AND g.revision_id = ?4 AND g.idempotency_key = ?5 AND ${any}`,
      )
      .bind(organizationId, userId, planId, revisionId, key)
      .first<{ proposalId: string; requestHash: string }>();
  }

  async function decisionByWrite(planId: string, revisionId: string, proposalId: string, writeId: string) {
    return db
      .prepare(
        `SELECT d.proposal_version_after AS versionAfter FROM proposal_decisions d
         JOIN prescription_proposals p ON p.organization_id = d.organization_id AND p.id = d.proposal_id
         WHERE d.organization_id = ?1 AND d.proposal_id = ?5 AND d.write_id = ?6 AND p.plan_id = ?3 AND p.revision_id = ?4 AND ${any}`,
      )
      .bind(organizationId, userId, planId, revisionId, proposalId, writeId)
      .first<{ versionAfter: number }>();
  }

  /** After a write that did not land: read again and say why (never guessed from the error text alone). */
  async function classifyMutation(
    planId: string,
    revisionId: string,
    proposalId: string,
    cas: { expectedVersion: number; writeId: string },
    key: { idempotencyKey: string; requestHash: string } | null,
    expectedContent: number | null,
  ): Promise<MutateOutcome> {
    if (key) {
      const found = await byKey(planId, revisionId, key.idempotencyKey);
      if (found) {
        if (found.requestHash !== key.requestHash || found.proposalId !== proposalId) return { status: "key_reused" };
        const now = await header(planId, revisionId, proposalId, "ANY");
        return now ? { status: "saved", version: now.version, replayed: true } : { status: "not_found" };
      }
    }
    const decided = await decisionByWrite(planId, revisionId, proposalId, cas.writeId);
    if (decided) return { status: "saved", version: decided.versionAfter, replayed: true };
    const now = await header(planId, revisionId, proposalId, "ANY");
    if (!now) return { status: "not_found" };
    if (now.state !== "OPEN") return { status: "closed" };
    if (now.revisionState !== "DRAFT") return { status: "not_open" };
    if (now.version !== cas.expectedVersion) return { status: "conflict", version: now.version };
    if (expectedContent !== null && now.contentVersion !== expectedContent)
      return { status: "revision_changed", contentVersion: now.contentVersion };
    return { status: "conflict", version: now.version };
  }

  /**
   * Statements that rewrite the sessions of the result that differ from `previous` (all of them when there is none): items of
   * changed or vanished sessions are deleted, vanished sessions deleted, changed sessions upserted, their items inserted. Each
   * statement is gated on the write token, so none runs unless the compare-and-set before it landed.
   */
  function contentStatements(
    planId: string,
    revisionId: string,
    proposalId: string,
    writeId: string,
    versionAfter: number,
    generationId: string,
    previous: OccurrenceOut[],
    next: OccurrenceOut[],
  ): { statements: D1PreparedStatement[]; written: number; removed: number; items: number } {
    const before = new Map(previous.map((o) => [occKey(o), canonicalJson(o)]));
    const after = new Set(next.map(occKey));
    const changed = next.filter((o) => before.get(occKey(o)) !== canonicalJson(o));
    const vanished = previous.filter((o) => !after.has(occKey(o)));
    const touched = [...changed, ...vanished].map((o) => [o.phaseIndex, o.week, o.slot]);
    const statements: D1PreparedStatement[] = [];
    const g = (sql: string, ...rest: unknown[]) => gated(sql, planId, revisionId, proposalId, writeId, versionAfter, ...rest);
    // One indexed lookup per JSON row (UNIQUE proposal_id, phase, week, slot). A join of json_each with proposal_occurrences let
    // SQLite re-parse every row once per stored session: measured 13.7 s for 504 sessions × 10 items on local workerd (S6).
    const occurrenceLookup = (p: string, w: string, sl: string) => `SELECT o.id FROM proposal_occurrences o
      WHERE o.organization_id = ?1 AND o.proposal_id = ?5 AND o.phase_index = json_extract(j.value, ${p})
        AND o.week_index = json_extract(j.value, ${w}) AND o.slot_index = json_extract(j.value, ${sl})`;
    const occurrenceIdOf = (p: string, w: string, sl: string) => `SELECT (${occurrenceLookup(p, w, sl)}) FROM json_each(?8) j`;
    if (previous.length)
      for (const chunk of jsonChunks(touched)) {
        statements.push(
          g(
            `DELETE FROM proposal_items WHERE organization_id = ?1 AND proposal_id = ?5 AND ${token}
               AND proposal_occurrence_id IN (${occurrenceIdOf("'$[0]'", "'$[1]'", "'$[2]'")})`,
            chunk,
          ),
        );
      }
    for (const chunk of jsonChunks(vanished.map((o) => [o.phaseIndex, o.week, o.slot])))
      statements.push(
        g(
          `DELETE FROM proposal_occurrences WHERE organization_id = ?1 AND proposal_id = ?5 AND ${token}
             AND id IN (${occurrenceIdOf("'$[0]'", "'$[1]'", "'$[2]'")})`,
          chunk,
        ),
      );
    for (const chunk of jsonChunks(changed.map(occurrenceRow)))
      statements.push(
        g(
          `INSERT INTO proposal_occurrences (id, organization_id, proposal_id, phase_index, week_index, slot_index, workout_label,
             week_start, planned_date, stimulus, stimulus_json, estimated_minutes, duration_complete, budget_minutes, budget_source,
             generation_id)
           SELECT json_extract(j.value, '$.id'), ?1, ?5, json_extract(j.value, '$.p'), json_extract(j.value, '$.w'),
             json_extract(j.value, '$.s'), json_extract(j.value, '$.label'), json_extract(j.value, '$.weekStart'),
             json_extract(j.value, '$.plannedDate'), json_extract(j.value, '$.stimulus'), json_extract(j.value, '$.stimulusJson'),
             json_extract(j.value, '$.estimatedMinutes'), json_extract(j.value, '$.durationComplete'),
             json_extract(j.value, '$.budgetMinutes'), json_extract(j.value, '$.budgetSource'), ?9
           FROM json_each(?8) j WHERE ${token}
           ON CONFLICT (proposal_id, phase_index, week_index, slot_index) DO UPDATE SET
             week_start = excluded.week_start, planned_date = excluded.planned_date, stimulus = excluded.stimulus,
             stimulus_json = excluded.stimulus_json, estimated_minutes = excluded.estimated_minutes,
             duration_complete = excluded.duration_complete, budget_minutes = excluded.budget_minutes,
             budget_source = excluded.budget_source, generation_id = excluded.generation_id`,
          chunk,
          generationId,
        ),
      );
    const itemRows = changed.flatMap((o) => o.items.map((i) => itemRow(o, i)));
    for (const chunk of jsonChunks(itemRows))
      statements.push(
        g(
          `INSERT INTO proposal_items (id, organization_id, proposal_id, proposal_occurrence_id, slot_key, substitutes_slot_key, position,
             exercise_id, exercise_name, modality, metric, dose_json, dose_text, sets, reps, load_instruction, cadence, rest_seconds,
             rest_text, rir_min, rir_max, trace_json, alternatives_json, metadata_trust, origin, existing_prescribed_exercise_id,
             generation_id)
           SELECT json_extract(j.value, '$.id'), ?1, ?5,
             (${occurrenceLookup("'$.p'", "'$.w'", "'$.s'")}),
             json_extract(j.value, '$.slotKey'),
             json_extract(j.value, '$.substitutesSlotKey'), json_extract(j.value, '$.position'), json_extract(j.value, '$.exerciseId'),
             json_extract(j.value, '$.exerciseName'), json_extract(j.value, '$.modality'), json_extract(j.value, '$.metric'),
             json_extract(j.value, '$.doseJson'), json_extract(j.value, '$.doseText'), json_extract(j.value, '$.sets'),
             json_extract(j.value, '$.reps'), json_extract(j.value, '$.loadInstruction'), json_extract(j.value, '$.cadence'),
             json_extract(j.value, '$.restSeconds'), json_extract(j.value, '$.restText'), json_extract(j.value, '$.rirMin'),
             json_extract(j.value, '$.rirMax'), json_extract(j.value, '$.traceJson'), json_extract(j.value, '$.alternativesJson'),
             json_extract(j.value, '$.metadata'), json_extract(j.value, '$.origin'), json_extract(j.value, '$.existingId'), ?9
           FROM json_each(?8) j
           WHERE ${token}`,
          chunk,
          generationId,
        ),
      );
    return { statements, written: changed.length, removed: vanished.length, items: itemRows.length };
  }

  function generationStatements(
    planId: string,
    revisionId: string,
    proposalId: string,
    writeId: string,
    versionAfter: number,
    generationId: string,
    rec: GenerationRecord,
    result: EngineResult,
    outputHash: string,
    baseProposalVersion: number | null,
    stamp: string,
  ): D1PreparedStatement[] {
    const g = (sql: string, ...rest: unknown[]) => gated(sql, planId, revisionId, proposalId, writeId, versionAfter, ...rest);
    const out = [
      g(
        `INSERT INTO prescription_generations (id, organization_id, plan_id, revision_id, proposal_id, idempotency_key, request_hash,
           scope, scope_json, base_content_version, base_proposal_version, engine_version, rules_id, rules_version, vocabulary_version,
           catalog_hash, input_hash, output_hash, facts_json, status, validation, issue_codes_json, requested_by_user_id, created_at)
         SELECT ?8, ?1, ?3, ?4, ?5, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?2, ?26
         WHERE ${token}`,
        generationId,
        rec.idempotencyKey,
        rec.requestHash,
        rec.scope,
        JSON.stringify(rec.scopeJson ?? {}),
        rec.baseContentVersion,
        baseProposalVersion,
        result.engineVersion,
        result.rules.id,
        result.rules.version,
        result.vocabularyVersion,
        rec.catalogHash,
        rec.inputHash,
        outputHash,
        canonicalJson(rec.facts),
        result.status,
        result.validation,
        JSON.stringify(rec.inputJson === null ? [...issueCodes(result), "INPUT_NOT_STORED"].sort() : issueCodes(result)),
        stamp,
      ),
    ];
    if (rec.inputJson !== null)
      out.push(
        g(
          `INSERT INTO prescription_generation_inputs (generation_id, organization_id, student_id, input_json, created_at)
           SELECT ?8, ?1, ?9, ?10, ?11 WHERE ${token}`,
          generationId,
          rec.studentId,
          rec.inputJson,
          stamp,
        ),
      );
    return out;
  }

  const decisionStatement = (
    planId: string,
    revisionId: string,
    proposalId: string,
    writeId: string,
    versionAfter: number,
    action: string,
    target: unknown,
    change: unknown,
    generationId: string | null,
    stamp: string,
  ) =>
    gated(
      `INSERT INTO proposal_decisions (id, organization_id, proposal_id, actor_user_id, action, write_id, target_json, change_json,
         generation_id, proposal_version_after, created_at)
       SELECT ?8, ?1, ?5, ?2, ?9, ?6, ?10, ?11, ?12, ?7, ?13 WHERE ${token}`,
      planId,
      revisionId,
      proposalId,
      writeId,
      versionAfter,
      crypto.randomUUID(),
      action,
      JSON.stringify(target ?? {}),
      change === null ? null : JSON.stringify(change),
      generationId,
      stamp,
    );
  const eventStatement = (planId: string, revisionId: string, proposalId: string, writeId: string, versionAfter: number, action: string, stamp: string) =>
    gated(
      `INSERT INTO training_plan_events (id, organization_id, plan_id, revision_id, actor_user_id, action, created_at)
       SELECT ?8, r.organization_id, r.plan_id, r.id, ?2, ?9, ?10 FROM plan_revisions r
       WHERE r.organization_id = ?1 AND r.id = ?4 AND r.plan_id = ?3 AND ${token}`,
      planId,
      revisionId,
      proposalId,
      writeId,
      versionAfter,
      crypto.randomUUID(),
      action,
      stamp,
    );

  const phasesOf = (result: EngineResult) => {
    const generated = [...new Set(result.occurrences.map((o) => o.phaseIndex))].sort((a, b) => a - b);
    const complete = result.phases.every((p) => generated.includes(p.phaseIndex));
    return { generated, complete };
  };

  async function open(planId: string, revisionId: string): Promise<ProposalHeader | null> {
    const row = await db
      .prepare(`${headerSql(draft)} AND p.state = 'OPEN'`)
      .bind(organizationId, userId, planId, revisionId)
      .first<HeaderRow>();
    return row ? toHeader(row) : null;
  }

  async function asEngineResult(planId: string, revisionId: string, proposalId: string) {
    const snap = await snapshot(planId, revisionId, proposalId);
    if (!snap) return null;
    return { header: snap.header, result: { ...snap.summary, occurrences: snap.occurrences } as EngineResult, itemIds: snap.itemIds };
  }

  async function replayOf(planId: string, revisionId: string, key: { idempotencyKey: string; requestHash: string }): Promise<GenerateOutcome | null> {
    const found = await byKey(planId, revisionId, key.idempotencyKey);
    if (!found) return null;
    if (found.requestHash !== key.requestHash) return { status: "key_reused" };
    const now = await header(planId, revisionId, found.proposalId, "ANY");
    return now ? { status: "replayed", proposalId: now.id, version: now.version, complete: now.complete } : { status: "not_found" };
  }

  /** Runs a mutation batch and answers what happened; after any failure the rows are read again. */
  async function runMutation(
    planId: string,
    revisionId: string,
    proposalId: string,
    cas: { expectedVersion: number; writeId: string },
    statements: D1PreparedStatement[],
    key: { idempotencyKey: string; requestHash: string } | null,
    expectedContent: number | null,
  ): Promise<MutateOutcome> {
    let failure: ReturnType<typeof knownFailure> = null;
    try {
      await db.batch(statements);
    } catch (error) {
      failure = knownFailure(error);
      if (!failure) throw error;
    }
    if (!failure) {
      const landed = await db
        .prepare(
          `SELECT version FROM prescription_proposals WHERE organization_id = ?1 AND id = ?2 AND last_write_id = ?3 AND version = ?4`,
        )
        .bind(organizationId, proposalId, cas.writeId, cas.expectedVersion + 1)
        .first<{ version: number }>();
      const decided = landed ? await decisionByWrite(planId, revisionId, proposalId, cas.writeId) : null;
      if (landed && decided) return { status: "saved", version: landed.version, replayed: false };
    }
    if (failure === "too_large" || failure === "invalid_target") return { status: failure };
    return classifyMutation(planId, revisionId, proposalId, cas, key, expectedContent);
  }

  return {
    /** The OPEN proposal of a DRAFT revision, or null. */
    open,

    /** One proposal's header (DRAFT gate by default; "ANY" for history). */
    header,

    /** One page of a proposal (a phase, optionally one week) with its summary. DRAFT revisions only. */
    async view(planId: string, revisionId: string, proposalId: string, page: { phaseIndex: number; week?: number }): Promise<ProposalPage | null> {
      const snap = await snapshot(planId, revisionId, proposalId, page);
      return snap ? { header: snap.header, summary: snap.summary, occurrences: snap.occurrences } : null;
    },

    /** The whole proposal as an engine result (to regenerate, substitute, rebase), with its header: one consistent read. */
    async asEngineResult(planId: string, revisionId: string, proposalId: string): Promise<{ header: ProposalHeader; result: EngineResult } | null> {
      const snap = await asEngineResult(planId, revisionId, proposalId);
      return snap ? { header: snap.header, result: snap.result } : null;
    },

    /** Proposals of a revision in any state, with their generations and decisions (no content, no health text). */
    async history(planId: string, revisionId: string): Promise<ProposalHistory> {
      const [p, g, d] = await db.batch([
        db
          .prepare(
            `SELECT p.id, p.state, p.version, p.status, p.validation, p.complete, p.created_at AS createdAt, p.closed_at AS closedAt
             FROM prescription_proposals p WHERE p.organization_id = ?1 AND p.plan_id = ?3 AND p.revision_id = ?4 AND ${any}
             ORDER BY p.created_at, p.rowid`,
          )
          .bind(organizationId, userId, planId, revisionId),
        db
          .prepare(
            `SELECT g.proposal_id AS proposalId, g.id, g.scope, g.created_at AS createdAt, g.engine_version AS engineVersion,
               g.rules_id AS rulesId, g.rules_version AS rulesVersion, g.status, g.validation, g.output_hash AS outputHash,
               EXISTS (SELECT 1 FROM prescription_generation_inputs i WHERE i.organization_id = g.organization_id AND i.generation_id = g.id) AS inputStored
             FROM prescription_generations g WHERE g.organization_id = ?1 AND g.plan_id = ?3 AND g.revision_id = ?4 AND ${any}
             ORDER BY g.created_at, g.rowid`,
          )
          .bind(organizationId, userId, planId, revisionId),
        db
          .prepare(
            `SELECT d.proposal_id AS proposalId, d.action, d.created_at AS createdAt, d.actor_user_id AS actorUserId,
               d.proposal_version_after AS versionAfter
             FROM proposal_decisions d JOIN prescription_proposals p ON p.organization_id = d.organization_id AND p.id = d.proposal_id
             WHERE d.organization_id = ?1 AND p.plan_id = ?3 AND p.revision_id = ?4 AND ${any}
             ORDER BY d.created_at, d.rowid`,
          )
          .bind(organizationId, userId, planId, revisionId),
      ]);
      type Gen = ProposalHistory["proposals"][number]["generations"][number];
      type Dec = ProposalHistory["proposals"][number]["decisions"][number];
      const gens = (g.results as Array<Omit<Gen, "inputStored"> & { proposalId: string; inputStored: number }>).map(({ proposalId, inputStored, ...rest }) => ({
        proposalId,
        row: { ...rest, inputStored: inputStored === 1 } as Gen,
      }));
      const decs = (d.results as Array<Dec & { proposalId: string }>).map(({ proposalId, ...rest }) => ({ proposalId, row: rest as Dec }));
      type P = { id: string; state: ProposalState; version: number; status: string; validation: string; complete: number; createdAt: string; closedAt: string | null };
      return {
        proposals: (p.results as P[]).map((row) => ({
          ...row,
          complete: row.complete === 1,
          generations: gens.filter((x) => x.proposalId === row.id).map((x) => x.row),
          decisions: decs.filter((x) => x.proposalId === row.id).map((x) => x.row),
        })),
      };
    },

    /**
     * The answers of the newest proposal of this plan (any revision), gated through the plan's student: shown as "da geração
     * anterior em dd/mm", each value reused only by a click.
     */
    async lastAnswers(planId: string): Promise<{ proposalId: string; revisionId: string; createdAt: string; answers: unknown } | null> {
      const row = await db
        .prepare(
          `SELECT p.id AS proposalId, p.revision_id AS revisionId, p.created_at AS createdAt, p.parameters_json AS parametersJson
           FROM prescription_proposals p
           JOIN training_plans tp ON tp.organization_id = p.organization_id AND tp.id = p.plan_id
           JOIN students s ON s.organization_id = tp.organization_id AND s.id = tp.student_id
           WHERE p.organization_id = ?1 AND p.plan_id = ?3 AND ${activeUser("?2")} AND ${technicalAccessExists("s", "?2")}
           ORDER BY p.created_at DESC, p.rowid DESC LIMIT 1`,
        )
        .bind(organizationId, userId, planId)
        .first<{ proposalId: string; revisionId: string; createdAt: string; parametersJson: string }>();
      return row
        ? { proposalId: row.proposalId, revisionId: row.revisionId, createdAt: row.createdAt, answers: JSON.parse(row.parametersJson) as unknown }
        : null;
    },

    /** Replay check before running the engine: the generation already recorded under this key, if any. */
    replayOf,

    /** Replay check for a keyed mutation (continue, regenerate, substitute, rebase) on a given proposal, before running the engine. */
    async mutationReplay(
      planId: string,
      revisionId: string,
      proposalId: string,
      key: { idempotencyKey: string; requestHash: string },
      writeId: string,
    ): Promise<MutateOutcome | null> {
      const found = await byKey(planId, revisionId, key.idempotencyKey);
      if (found) {
        if (found.requestHash !== key.requestHash || found.proposalId !== proposalId) return { status: "key_reused" };
        const now = await header(planId, revisionId, proposalId, "ANY");
        return now ? { status: "saved", version: now.version, replayed: true } : { status: "not_found" };
      }
      const decided = await decisionByWrite(planId, revisionId, proposalId, writeId);
      return decided ? { status: "saved", version: decided.versionAfter, replayed: true } : null;
    },

    /**
     * A new proposal from a FULL generation (possibly only its first phases: `complete` says). One batch: the proposal row only if
     * the revision is still a DRAFT at `rec.baseContentVersion`, has no OPEN proposal and this key was never used on it; then,
     * gated on it, the decision, the ledger row, the deletable input, sessions, items and the plan event.
     */
    async recordGeneration(planId: string, revisionId: string, rec: GenerationRecord, result: EngineResult, now = new Date()): Promise<GenerateOutcome> {
      const proposalId = crypto.randomUUID();
      const generationId = crypto.randomUUID();
      const writeId = rec.idempotencyKey;
      const stamp = now.toISOString();
      const outputHash = await outputHashOf(result);
      const { generated, complete } = phasesOf(result);
      const content = contentStatements(planId, revisionId, proposalId, writeId, 1, generationId, [], result.occurrences);
      const statements: D1PreparedStatement[] = [
        db
          .prepare(
            `INSERT INTO prescription_proposals (id, organization_id, plan_id, revision_id, state, version, last_write_id,
               base_content_version, engine_version, rules_id, rules_version, parameters_json, status, validation, complete,
               phases_generated, summary_json, output_hash, created_by_user_id, created_at, updated_at)
             SELECT ?5, ?1, ?3, ?4, 'OPEN', 1, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?2, ?18, ?18
             FROM plan_revisions r0
             WHERE r0.organization_id = ?1 AND r0.id = ?4 AND r0.plan_id = ?3 AND r0.state = 'DRAFT' AND r0.content_version = ?7
               AND ${draft}
               AND NOT EXISTS (SELECT 1 FROM prescription_proposals x WHERE x.organization_id = ?1 AND x.revision_id = ?4 AND x.state = 'OPEN')
               AND NOT EXISTS (SELECT 1 FROM prescription_generations x WHERE x.organization_id = ?1 AND x.revision_id = ?4 AND x.idempotency_key = ?6)`,
          )
          .bind(
            organizationId,
            userId,
            planId,
            revisionId,
            proposalId,
            writeId,
            rec.baseContentVersion,
            result.engineVersion,
            result.rules.id,
            result.rules.version,
            canonicalJson(rec.parameters ?? {}),
            result.status,
            result.validation,
            complete ? 1 : 0,
            JSON.stringify(generated),
            canonicalJson(summaryOf(result)),
            outputHash,
            stamp,
          ),
        decisionStatement(planId, revisionId, proposalId, writeId, 1, "GENERATED", { phases: generated },
          { occurrences: content.written, items: content.items, complete }, generationId, stamp),
        ...generationStatements(planId, revisionId, proposalId, writeId, 1, generationId, rec, result, outputHash, null, stamp),
        ...content.statements,
        eventStatement(planId, revisionId, proposalId, writeId, 1, EVENT_FOR_SCOPE.FULL, stamp),
      ];
      let failure: ReturnType<typeof knownFailure> = null;
      try {
        await db.batch(statements);
      } catch (error) {
        failure = knownFailure(error);
        if (!failure) throw error;
      }
      const mine = failure ? null : await header(planId, revisionId, proposalId, "ANY");
      if (mine) return { status: "created", proposalId, version: mine.version, complete: mine.complete };
      const replay = await replayOf(planId, revisionId, rec);
      if (replay) return replay;
      const already = await open(planId, revisionId);
      if (already) return { status: "open_exists", proposalId: already.id };
      const revision = await db
        .prepare(
          `SELECT r.state, r.content_version AS contentVersion FROM plan_revisions r
           WHERE r.organization_id = ?1 AND r.id = ?4 AND r.plan_id = ?3 AND ${any}`,
        )
        .bind(organizationId, userId, planId, revisionId)
        .first<{ state: string; contentVersion: number }>();
      if (!revision) return { status: "not_found" };
      if (revision.state !== "DRAFT") return { status: "not_open" };
      if (revision.contentVersion !== rec.baseContentVersion) return { status: "revision_changed", contentVersion: revision.contentVersion };
      if (failure === "too_large") return { status: "too_large" };
      throw new Error(`PROPOSAL_WRITE_UNEXPLAINED${failure ? `:${failure}` : ""}`);
    },

    /**
     * An engine run on an OPEN proposal (continue, regenerate a scope, substitute, rebase): compare-and-set on the version and,
     * except for REBASE, on the revision still being at the proposal's base content version (`rec.baseContentVersion`). REBASE
     * moves the base forward to `rec.baseContentVersion`, only while the revision is exactly there. Only the sessions that differ
     * from `previous` are rewritten. `previous` must be the result read at `expectedVersion` (`asEngineResult`); the
     * compare-and-set guarantees the stored rows still are that result.
     */
    async recordChange(
      planId: string,
      revisionId: string,
      proposalId: string,
      cas: { expectedVersion: number; writeId: string },
      rec: GenerationRecord,
      previous: EngineResult,
      result: EngineResult,
      decision: { target: unknown },
      now = new Date(),
    ): Promise<MutateOutcome> {
      if (rec.scope === "FULL") throw new Error("PROPOSAL_SCOPE_INVALID");
      const generationId = crypto.randomUUID();
      const stamp = now.toISOString();
      const versionAfter = cas.expectedVersion + 1;
      const outputHash = await outputHashOf(result);
      const { generated, complete } = phasesOf(result);
      const rebase = rec.scope === "REBASE";
      const content = contentStatements(planId, revisionId, proposalId, cas.writeId, versionAfter, generationId, previous.occurrences, result.occurrences);
      const statements: D1PreparedStatement[] = [
        db
          .prepare(
            `UPDATE prescription_proposals SET version = version + 1, last_write_id = ?6, status = ?8, validation = ?9, complete = ?10,
               phases_generated = ?11, summary_json = ?12, output_hash = ?13, parameters_json = ?14, updated_at = ?15,
               base_content_version = CASE WHEN ?16 = 1 THEN ?17 ELSE base_content_version END
             WHERE organization_id = ?1 AND id = ?5 AND plan_id = ?3 AND revision_id = ?4 AND state = 'OPEN' AND version = ?7 AND ${draft}
               AND base_content_version <= ?17
               AND (SELECT r1.content_version FROM plan_revisions r1 WHERE r1.organization_id = ?1 AND r1.id = ?4) = ?17
               AND (?16 = 1 OR base_content_version = ?17)`,
          )
          .bind(
            organizationId,
            userId,
            planId,
            revisionId,
            proposalId,
            cas.writeId,
            cas.expectedVersion,
            result.status,
            result.validation,
            complete ? 1 : 0,
            JSON.stringify(generated),
            canonicalJson(summaryOf(result)),
            outputHash,
            canonicalJson(rec.parameters ?? {}),
            stamp,
            rebase ? 1 : 0,
            rec.baseContentVersion,
          ),
        decisionStatement(planId, revisionId, proposalId, cas.writeId, versionAfter, DECISION_FOR_SCOPE[rec.scope], decision.target,
          { occurrences: content.written, removed: content.removed, items: content.items, complete }, generationId, stamp),
        ...generationStatements(planId, revisionId, proposalId, cas.writeId, versionAfter, generationId, rec, result, outputHash, cas.expectedVersion, stamp),
        ...content.statements,
        eventStatement(planId, revisionId, proposalId, cas.writeId, versionAfter, EVENT_FOR_SCOPE[rec.scope], stamp),
      ];
      return runMutation(planId, revisionId, proposalId, cas, statements, rec, rec.baseContentVersion);
    },

    /**
     * Locks (or unlocks) items of a proposal by slot key: every session of that phase holding the slot. A locked item is kept as
     * it is by the next regeneration. Rows already in the revision (PRESERVED) are kept anyway and are never locked.
     */
    async setLocked(
      planId: string,
      revisionId: string,
      proposalId: string,
      cas: { expectedVersion: number; writeId: string },
      targets: ItemTarget[],
      locked: boolean,
      now = new Date(),
    ): Promise<MutateOutcome> {
      if (!targets.length || targets.length > MAX_LOCK_TARGETS) return { status: "invalid_target" };
      const replay = await decisionByWrite(planId, revisionId, proposalId, cas.writeId);
      if (replay) return { status: "saved", version: replay.versionAfter, replayed: true };
      const snap = await asEngineResult(planId, revisionId, proposalId);
      if (!snap) return { status: "not_found" };
      if (snap.header.state !== "OPEN") return { status: "closed" };
      if (snap.header.version !== cas.expectedVersion) return { status: "conflict", version: snap.header.version };
      const wanted = new Set(targets.map((t) => `${t.phaseIndex}|${t.slotKey}`));
      const changes: Array<{ id: string; origin: ItemOut["origin"] }> = [];
      let found = 0;
      let preserved = 0;
      const occurrences = snap.result.occurrences.map((o) => ({
        ...o,
        items: o.items.map((i) => {
          if (!wanted.has(`${o.phaseIndex}|${i.slotKey}`)) return i;
          found += 1;
          if (i.origin === "PRESERVED") {
            preserved += 1;
            return i;
          }
          const origin: ItemOut["origin"] = locked ? "LOCKED" : i.origin === "LOCKED" ? unlockedOrigin(i) : i.origin;
          const id = snap.itemIds.get(`${occKey(o)}|${i.slotKey}`);
          if (origin !== i.origin && id) changes.push({ id, origin });
          return { ...i, origin };
        }),
      }));
      if (!found || preserved) return { status: "invalid_target" };
      const result: EngineResult = { ...snap.result, occurrences };
      const stamp = now.toISOString();
      const versionAfter = cas.expectedVersion + 1;
      const statements: D1PreparedStatement[] = [
        db
          .prepare(
            `UPDATE prescription_proposals SET version = version + 1, last_write_id = ?6, output_hash = ?8, updated_at = ?9
             WHERE organization_id = ?1 AND id = ?5 AND plan_id = ?3 AND revision_id = ?4 AND state = 'OPEN' AND version = ?7 AND ${draft}`,
          )
          .bind(organizationId, userId, planId, revisionId, proposalId, cas.writeId, cas.expectedVersion, await outputHashOf(result), stamp),
        decisionStatement(planId, revisionId, proposalId, cas.writeId, versionAfter, locked ? "LOCK" : "UNLOCK", { targets }, { items: changes.length }, null, stamp),
        // Each stored row gets its own origin back: an unlocked item returns to SUBSTITUTED when the professional chose it.
        ...jsonChunks(changes).map((chunk) =>
          gated(
            `UPDATE proposal_items SET origin = (SELECT json_extract(j.value, '$.origin') FROM json_each(?8) j WHERE json_extract(j.value, '$.id') = proposal_items.id)
             WHERE organization_id = ?1 AND proposal_id = ?5 AND origin <> 'PRESERVED' AND ${token}
               AND id IN (SELECT json_extract(j.value, '$.id') FROM json_each(?8) j)`,
            planId,
            revisionId,
            proposalId,
            cas.writeId,
            versionAfter,
            chunk,
          ),
        ),
        eventStatement(planId, revisionId, proposalId, cas.writeId, versionAfter, locked ? "PROPOSAL_LOCKED" : "PROPOSAL_UNLOCKED", stamp),
      ];
      return runMutation(planId, revisionId, proposalId, cas, statements, null, null);
    },

    /**
     * Records the professional's decision about an alert (one click on its suggestion, or "ciente"): it goes into the answers used
     * by the next regeneration and is shown on the alert. No session changes until the professional regenerates.
     */
    async acceptFlagDecision(
      planId: string,
      revisionId: string,
      proposalId: string,
      cas: { expectedVersion: number; writeId: string },
      flagCode: string,
      decision: FlagDecision,
      now = new Date(),
    ): Promise<MutateOutcome> {
      const replay = await decisionByWrite(planId, revisionId, proposalId, cas.writeId);
      if (replay) return { status: "saved", version: replay.versionAfter, replayed: true };
      const snap = await asEngineResult(planId, revisionId, proposalId);
      if (!snap) return { status: "not_found" };
      if (snap.header.state !== "OPEN") return { status: "closed" };
      if (snap.header.version !== cas.expectedVersion) return { status: "conflict", version: snap.header.version };
      if (!snap.result.flags.some((f) => f.code === flagCode)) return { status: "invalid_target" };
      const params = (snap.header.parameters ?? {}) as Record<string, unknown> & {
        acceptedFlagDecisions?: Array<{ flagCode: string; decision: FlagDecision }>;
      };
      const parameters = {
        ...params,
        acceptedFlagDecisions: [...(params.acceptedFlagDecisions ?? []).filter((d) => d.flagCode !== flagCode), { flagCode, decision }],
      };
      const result: EngineResult = { ...snap.result, flags: snap.result.flags.map((f) => (f.code === flagCode ? { ...f, decided: decision } : f)) };
      const stamp = now.toISOString();
      const versionAfter = cas.expectedVersion + 1;
      return runMutation(
        planId,
        revisionId,
        proposalId,
        cas,
        [
          db
            .prepare(
              `UPDATE prescription_proposals SET version = version + 1, last_write_id = ?6, parameters_json = ?8, summary_json = ?9,
                 output_hash = ?10, updated_at = ?11
               WHERE organization_id = ?1 AND id = ?5 AND plan_id = ?3 AND revision_id = ?4 AND state = 'OPEN' AND version = ?7 AND ${draft}`,
            )
            .bind(organizationId, userId, planId, revisionId, proposalId, cas.writeId, cas.expectedVersion, canonicalJson(parameters),
              canonicalJson(summaryOf(result)), await outputHashOf(result), stamp),
          decisionStatement(planId, revisionId, proposalId, cas.writeId, versionAfter, "ACCEPT_FLAG_DECISION", { flagCode }, { decision }, null, stamp),
          eventStatement(planId, revisionId, proposalId, cas.writeId, versionAfter, "PROPOSAL_FLAG_DECIDED", stamp),
        ],
        null,
        null,
      );
    },

    /** Closes an OPEN proposal as DISCARDED: nothing of it is applied; its ledger, decisions and rows stay. */
    async discard(planId: string, revisionId: string, proposalId: string, cas: { expectedVersion: number; writeId: string }, now = new Date()): Promise<MutateOutcome> {
      const replay = await decisionByWrite(planId, revisionId, proposalId, cas.writeId);
      if (replay) return { status: "saved", version: replay.versionAfter, replayed: true };
      const stamp = now.toISOString();
      const versionAfter = cas.expectedVersion + 1;
      return runMutation(
        planId,
        revisionId,
        proposalId,
        cas,
        [
          db
            .prepare(
              `UPDATE prescription_proposals SET state = 'DISCARDED', version = version + 1, last_write_id = ?6, closed_at = ?8,
                 closed_by_user_id = ?2, updated_at = ?8
               WHERE organization_id = ?1 AND id = ?5 AND plan_id = ?3 AND revision_id = ?4 AND state = 'OPEN' AND version = ?7 AND ${draft}`,
            )
            .bind(organizationId, userId, planId, revisionId, proposalId, cas.writeId, cas.expectedVersion, stamp),
          decisionStatement(planId, revisionId, proposalId, cas.writeId, versionAfter, "DISCARD", {}, null, null, stamp),
          eventStatement(planId, revisionId, proposalId, cas.writeId, versionAfter, "PROPOSAL_DISCARDED", stamp),
        ],
        null,
        null,
      );
    },
  };
}

export type ProposalsRepository = ReturnType<typeof proposalsFor>;
