/**
 * The single anonymising choke point (design V4 §3.3). `buildProviderPayload` is the ONLY place that can create a
 * `SafeProviderRequest`; adapters refuse anything else. It serialises the final request and FAILS CLOSED:
 *
 *  1. structural patterns (e-mail, phone-like digit runs, CPF, ISO/BR dates, URL, UUID, long hex, "@x") run on the EXACT bytes that go to
 *     the provider: system + schema + user;
 *  2. the deny-list (real name, e-mail, phone, ids, plan title and every value the context builder flagged) runs on the `user` message
 *     ONLY, because the system prompt and the schema are build-time constants (the tests scan them against the canary instead).
 *
 * Matching is accent-insensitive on normalised text: tokens as WHOLE words, values as whole phrases (and, from 6 characters, as a
 * substring of the compacted text), digit-only values (phone, document) by digit sequence ignoring separators. A word that is also a
 * code of the closed vocabulary ("Core", "Push", "Hypertrophy") can never fail the call: a code is never derived from the name, so
 * nothing is revealed. Errors carry rule labels, NEVER the matched value. Nothing here logs.
 *
 * Aliases and bands REDUCE re-identification; they do not guarantee it is impossible (docs/MOTOR-PRESCRICAO.md).
 */
import { sha256Hex, canonicalJson } from "@/modules/prescricao/motor/hash";
import { normalizeText } from "@/modules/prescricao/motor/vocabulary";
import { FLEXITEST_CODES } from "@/modules/avaliacoes/v2/flexitest";
import type { DenyList } from "./context-types";
import { PLANNER_SYSTEM_PROMPT } from "./prompt";
import { estimateTokens } from "./quota";
import type { AiTask, ProviderKind, SafeProviderRequest, WireSchema } from "./provedores/port";
import {
  DOSE_PROFILE_CODES, EQUIPMENT_CODES, EXERCISE_CLASSES, MODALITY_CODES, MUSCLE_CODES, PATTERN_CODES, PROGRESSION_INTENTS, QUESTION_CODES,
  SPLIT_FAMILIES, STIMULUS_CODES, UNCERTAINTY_CODES, WORKOUT_ROLES,
} from "./vocab";

export type PrivacyHitKind = "DENY_VALUE" | "PATTERN";
export interface PrivacyHit {
  kind: PrivacyHitKind;
  /** A rule label ("token", "value", "digits", "pattern:email"), never the matched text. */
  where: string;
}
export class PrivacyBlockedError extends Error {
  constructor(readonly hits: PrivacyHit[]) {
    super("PRIVACY_BLOCKED");
    this.name = "PrivacyBlockedError";
  }
}

// ---------- normalisation ----------

/** Accent-insensitive, lower-case, every run of non-alphanumerics collapsed to one space. */
export const normalizeForScan = (text: string): string => normalizeText(text).replace(/[^a-z0-9]+/g, " ").trim();
const ALIAS_TOKEN = /^[xtf]\d+$/;

/** Keys and enum values of `TrainingPlanningContext` and of the request envelope (the closed structure of the payload). */
const STRUCTURE_WORDS = [
  "task", "promptVersion", "context", "contextVersion", "student", "experience", "goalCodes", "ageBand", "sessionMinutes", "daysPerWeek", "equipment", "known",
  "codes", "origins", "screening", "parq", "decision", "observations", "alias", "kind", "code", "grade", "readings", "level", "periodization", "phases", "irregular",
  "history", "windowDays", "sessionsBand", "recordsBand", "painRecorded", "constraints", "hasLocked", "hasPreserved", "excludedPatterns", "excludedCautionTags",
  "timeBudget", "library", "eligibleExercises", "byPattern", "byPrimaryMuscle", "reviewedShare", "candidates", "modality", "primaryMuscles", "secondaryMuscles",
  "patterns", "difficulty", "compound", "laterality", "metric", "metadata", "index", "weeks", "sessionsPerWeek", "stimulus", "weekdays", "weekSequence", "workouts",
  "sessionsInPhase", "perWeek", "min", "max", "modalities", "exerciseTarget", "existingFocus", "muscles", "hasFixedItems", "PLANNER", "ADJUSTMENTS",
  "BEGINNER", "INTERMEDIATE", "ADVANCED", "CLEAR", "POSITIVE", "NOT_DONE", "SOFT", "HARD", "ALL", "MOST", "SOME", "NONE", "FEW", "MANY", "UNILATERAL", "BILATERAL",
  "REVIEWED", "INFERRED", "REPS", "TIME", "DISTANCE", "INTERVALS", "CONTINUOUS", "BY_TIME", "STUDENT_DECLARED", "ASSESSED", "PROFESSIONAL_DECISION", "UNKNOWN",
  "FLEXITEST", "ASSESSMENT", "FINDING", "SCREENING", "SCORE", "CAUTION", "TAG", "RESTRICTION", "REFERRAL", "PROFESSIONAL_REVIEW", "CLEARED", "CAUTION_ADVISED",
  "REFERRED", "ACCEPT", "DEFER", "MOVEMENT", "POSTURE", "FLEXIBILITY", "ANAMNESIS", "ASSESSMENT_CONTEXT", "fixed", "true", "false", "null",
] as const;

/** Tokens of the closed vocabulary: a deny-list word equal to one of these never blocks (a code is never derived from a name). */
function buildFixedTokens(extra: Iterable<string> = []): Set<string> {
  const set = new Set<string>();
  const add = (word: string) => {
    for (const t of normalizeForScan(word).split(" ")) if (t) set.add(t);
  };
  for (const list of [
    MUSCLE_CODES, PATTERN_CODES, EQUIPMENT_CODES, MODALITY_CODES, STIMULUS_CODES, WORKOUT_ROLES, SPLIT_FAMILIES, UNCERTAINTY_CODES, QUESTION_CODES,
    DOSE_PROFILE_CODES, EXERCISE_CLASSES, PROGRESSION_INTENTS, STRUCTURE_WORDS, FLEXITEST_CODES, ["LOW", "MEDIUM", "HIGH", "S1", "S2", "S3", "UPPER", "LOWER"],
  ] as ReadonlyArray<readonly string[]>) {
    list.forEach(add);
  }
  PLANNER_SYSTEM_PROMPT.split(/\s+/).forEach(add);
  for (const w of extra) add(w);
  return set;
}
let FIXED: Set<string> | null = null;
const BY_SCHEMAS = new Map<string, ReadonlySet<string>>();
/** Memoised; the extra words are the enum values and keys of the wire schemas (supplied by `fixedTokensFromSchemas`). */
export function fixedTokens(schemas: readonly unknown[] = []): ReadonlySet<string> {
  if (schemas.length === 0) return (FIXED ??= buildFixedTokens());
  // Schemas are module constants: one entry per distinct set (bounded, in case a caller ever builds them on the fly).
  const key = JSON.stringify(schemas);
  const hit = BY_SCHEMAS.get(key);
  if (hit) return hit;
  const built = buildFixedTokens(schemaWords(schemas));
  if (BY_SCHEMAS.size >= 16) BY_SCHEMAS.clear();
  BY_SCHEMAS.set(key, built);
  return built;
}
function schemaWords(schemas: readonly unknown[]): string[] {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node !== "object" || node === null) return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "properties" && typeof v === "object" && v !== null) {
        for (const [name, sub] of Object.entries(v)) {
          out.push(name);
          walk(sub);
        }
      } else if (k === "enum" && Array.isArray(v)) {
        for (const e of v) if (typeof e === "string") out.push(e);
      } else walk(v);
    }
  };
  schemas.forEach(walk);
  return out;
}

// ---------- structural patterns ----------

const PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["pattern:email", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  ["pattern:at", /@\w/],
  ["pattern:cpf", /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/],
  ["pattern:iso-date", /\b\d{4}-\d{2}-\d{2}\b/],
  ["pattern:br-date", /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/],
  ["pattern:url", /https?:\/\/|\bwww\./i],
  ["pattern:uuid", /\b[0-9a-f]{8}-[0-9a-f]{4}-/i],
  ["pattern:hex", /\b[0-9a-f]{32,}\b/i],
];
/** Digit runs allowing the separators people type inside phone and document numbers. */
const DIGIT_RUN = /\d[\d\s().\-/+]*\d|\d/g;
const digitsOf = (text: string): string[] => (text.match(DIGIT_RUN) ?? []).map((run) => run.replace(/\D/g, "")).filter(Boolean);
const PHONE_MIN_DIGITS = 8;

export function scanPatterns(text: string): PrivacyHit[] {
  const hits: PrivacyHit[] = [];
  for (const [where, re] of PATTERNS) if (re.test(text)) hits.push({ kind: "PATTERN", where });
  if (digitsOf(text).some((d) => d.length >= PHONE_MIN_DIGITS)) hits.push({ kind: "PATTERN", where: "pattern:phone" });
  return hits;
}

// ---------- deny-list ----------

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Searches the serialised `user` message for the deny-list. Pure. */
export function scanPayload(serialised: string, deny: DenyList, fixed: ReadonlySet<string> = fixedTokens()): PrivacyHit[] {
  const hits: PrivacyHit[] = [];
  const norm = normalizeForScan(serialised);
  const words = norm.split(" ").filter(Boolean);
  const present = new Set(words.filter((t) => !/^\d+$/.test(t) && !ALIAS_TOKEN.test(t) && !fixed.has(t)));
  const spaced = ` ${norm} `;
  const compact = norm.replace(/ /g, "");
  const runs = new Set(digitsOf(serialised));
  const flag = (where: string) => hits.push({ kind: "DENY_VALUE", where });

  for (const raw of deny.tokens) {
    const t = normalizeForScan(raw);
    if (t.length >= 3 && !/^\d+$/.test(t) && present.has(t)) flag("token");
  }
  for (const raw of deny.values) {
    const v = normalizeForScan(raw);
    if (!v) continue;
    if (/^\d+$/.test(v) && v.length >= 6) {
      // a phone or document number: compare digit sequences, with and without separators
      if (runs.has(v) || [...runs].some((r) => r.length >= v.length && r.includes(v))) flag("digits");
      continue;
    }
    if (v.length < 4) continue;
    const parts = v.split(" ");
    // a value made only of vocabulary words reveals nothing (the payload carries the CODE, not the typed text)
    if (parts.every((p) => fixed.has(p) || ALIAS_TOKEN.test(p))) continue;
    if (new RegExp(`(?: |^)${escape(v)}(?: |$)`).test(spaced)) flag("value");
    else if (v.length >= 6 && compact.includes(v.replace(/ /g, ""))) flag("value-compact");
  }
  return hits;
}

// ---------- the choke point ----------

const ISSUED = new WeakSet<object>();

export interface ProviderPayloadBody {
  kind: ProviderKind;
  system: string;
  /** Serialised once with `canonicalJson`. */
  user: unknown;
  schema: WireSchema;
  schemaName: string;
  /** Wire schemas whose enums and keys extend the fixed vocabulary (the planner schema). */
  vocabularySchemas?: readonly unknown[];
}

/** Throws `PrivacyBlockedError`; on success returns the only object an adapter accepts. No provider is called and nothing is reserved on failure. */
export async function buildProviderPayload(task: AiTask, body: ProviderPayloadBody, deny: DenyList): Promise<SafeProviderRequest> {
  const user = canonicalJson(body.user);
  const schema = canonicalJson(body.schema);
  const fixed = fixedTokens(body.vocabularySchemas ?? []);
  const hits = [...scanPatterns(`${body.system}\n${schema}\n${user}`), ...scanPayload(user, deny, fixed)];
  if (hits.length > 0) throw new PrivacyBlockedError(hits);
  const request = Object.freeze({
    task,
    schemaKind: body.kind,
    system: body.system,
    user,
    payloadHash: await sha256Hex(user),
    estimatedInputTokens: estimateTokens(body.system.length + schema.length + user.length),
    schemaName: body.schemaName,
    schema: body.schema,
  });
  ISSUED.add(request);
  return request as unknown as SafeProviderRequest;
}

/** Adapters call this first: the request was issued by `buildProviderPayload`, is for this provider's dialect, and `user` still hashes to `payloadHash`. */
export async function verifyIssued(req: SafeProviderRequest, kind: ProviderKind): Promise<boolean> {
  return ISSUED.has(req) && req.schemaKind === kind && (await sha256Hex(req.user)) === req.payloadHash;
}

/** For tests and the static guard: the user message as sent. */
export const serialisedUser = (req: SafeProviderRequest): string => req.user;
