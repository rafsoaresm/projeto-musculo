/**
 * The input adapter's pure half (motor S5, design §2.2): it turns what the gated repositories read (profile, newest recorded
 * assessment, library with its metadata, saved structure, rows already prescribed) into the engine's facts. No database here,
 * so every rule below is tested directly.
 *
 * Rules kept throughout:
 * - a missing value stays missing (null, empty list or a question), never a number or a guess;
 * - free text (equipment, preferences, injuries, the assessment's notes and conclusions) is never parsed and never copied into
 *   the facts: the screen shows it to the professional, who turns it into explicit answers;
 * - the PAR-Q and the professional's decision become flags only; an isolated observation of the assessment (posture,
 *   Flexiteste, a test result) is context, never an automatic contraindication. Only a movement test graded MODERATE or
 *   STOPPED_BY_PAIN produces a one-click suggestion (rule MOVEMENT_FINDING_PATTERN_MAP), which the professional decides.
 */
import type { AssessmentDetail, ResultRow, ScreeningStanding } from "@/db/assessments";
import type { ExerciseRecord } from "@/db/exercises";
import type { PrescribedItemWithDose } from "@/db/prescription";
import type { StudentProfile } from "@/db/student-profile";
import { ANAMNESIS, GOALS, POSTURE_REGION_BY_KEY } from "@/modules/avaliacoes/catalog";
import { MOVEMENT_GRADES, MOVEMENT_TESTS, POSTURE_VIEWS } from "@/modules/avaliacoes/contracts";
import type { PostureRegionKey } from "@/modules/avaliacoes/catalog";
import { PARQ_CODES, type ProfilePayload, type ScreeningPayload } from "@/modules/avaliacoes/v2/screening";
import type { PosturePayload } from "@/modules/avaliacoes/v2/posture";
import type { MovementPayload } from "@/modules/avaliacoes/v2/flexitest";
import { REPETITION_TESTS, TEST_TITLE, type TestsPayload } from "@/modules/avaliacoes/v2/physical-tests";
import type { ConclusionPayload } from "@/modules/avaliacoes/v2/conclusion";
import { FLAG_LABEL, RESULT_LABEL, formatResult, isResultEstimate, methodLabel } from "@/modules/avaliacoes/v2/review";
import type { ResolvedMetadata } from "@/modules/biblioteca/metadata/status";
import { describeDose } from "@/modules/prescricao/describe";
import { validateDose } from "@/modules/prescricao/motor/dose";
import type {
  CatalogExercise,
  DisplayFields,
  Dose,
  ExistingItem,
  Fact,
  FindingFact,
  Metric,
  ScreeningFacts,
  StructureFacts,
  StructurePhase,
  StudentFacts,
} from "@/modules/prescricao/motor/types";
import type { ExposureHistory, ExposureWindow } from "@/modules/execucao/exposures";
import { phaseWorkouts } from "@/modules/training/periodization";
import type { PeriodizationSchedule } from "@/modules/training/contracts";
import { isV2Phase } from "@/modules/training/contracts";

/** The newest recorded assessment, as the adapter reads it. Modules of the new format are null for the earlier format. */
export interface AssessmentRecord {
  id: string;
  assessedOn: string;
  recordedAt: string | null;
  /** 2: Avaliação Física (PAR-Q, modules); null: the earlier format (six-item screening, metrics, posture, movement). */
  formatVersion: number | null;
  standing: Pick<ScreeningStanding, "risk" | "reviewed" | "reviewedAt">;
  /** Earlier format only: the six answers and the posture/movement rows. */
  legacy: Pick<AssessmentDetail, "flags" | "posture" | "movement"> | null;
  profile: ProfilePayload | null;
  screening: ScreeningPayload | null;
  posture: PosturePayload | null;
  movement: MovementPayload | null;
  tests: TestsPayload | null;
  /** Free text written by the professional (considerations, limitations, referrals): shown, never interpreted. */
  conclusion: ConclusionPayload | null;
  results: ResultRow[];
}

/** Everything one generation reads, already authorized (design §2.1). Lives only on the server, for one request. */
export interface GenerationContext {
  asOf: string;
  plan: { id: string; studentId: string; title: string };
  revision: {
    id: string;
    state: string;
    contentVersion: number;
    prescriptionModel: string;
    schedule: PeriodizationSchedule;
  };
  profile: StudentProfile | null;
  assessment: AssessmentRecord | null;
  /** The organization's visible, not archived library with resolved metadata: the only source of exercise ids. */
  catalog: CatalogExercise[];
  /** SHA-256 of the catalog with its resolved metadata, as read (design §2: the ledger's catalog reference). */
  catalogHash: string;
  /** Catalog ids whose caution markers nobody set (never inferred): an exclusion by marker cannot see them. */
  cautionTagsUnknown: string[];
  history: { window: Omit<ExposureWindow, "rows">; summary: ExposureHistory };
  /** Rows already in the DRAFT revision: always preserved (design §2.2). */
  existing: PrescribedItemWithDose[];
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/* ---------------- Screening ---------------- */

const PARQ_DECISION_MAP = { cleared: "CLEARED", medical_clearance: "MEDICAL_CLEARANCE", other: "OTHER" } as const;

/**
 * PAR-Q of the newest recorded assessment:
 * - Avaliação Física: all seven "Não" → CLEAR; any "Sim" → POSITIVE; anything else (no screening module, a question without an
 *   answer) → NOT_DONE. The decision is the professional's (Liberado / Precisa de liberação médica / Outra decisão); "Precisa
 *   de liberação médica" never blocks (PENDENCIAS R13, closed by the user on 03/11/2026).
 * - Earlier format: its risk column; a recorded review counts as a decision (REVIEWED), never as "cleared". Without a "Sim",
 *   a question the reader gives as not answered (null: before 0031 "Não" and "never asked" were stored alike) → NOT_DONE.
 * - No recorded assessment: NOT_DONE.
 */
export function screeningFacts(assessment: AssessmentRecord | null): ScreeningFacts {
  if (!assessment) return { parq: "NOT_DONE", professionalDecision: null, medicalClearanceRecorded: false };
  const ref = `assessment:${assessment.id}`;
  if (assessment.formatVersion === 2) {
    const s = assessment.screening;
    if (!s) return { parq: "NOT_DONE", professionalDecision: null, medicalClearanceRecorded: false, ref };
    const answers = PARQ_CODES.map((code) => s.parq.answers[code] ?? "unanswered");
    const parq = answers.includes("yes") ? "POSITIVE" : answers.every((a) => a === "no") ? "CLEAR" : "NOT_DONE";
    const decision = s.parq.professionalReview.decision;
    const mapped = decision ? PARQ_DECISION_MAP[decision] : null;
    return { parq, professionalDecision: mapped, medicalClearanceRecorded: mapped === "MEDICAL_CLEARANCE", ref };
  }
  const positive = assessment.standing.risk === "REVIEW_REQUIRED";
  // Before 0031 a "Não" and a question never asked were stored alike: the reader gives null for those, and the product shows
  // them as not answered. Without a "Sim", any such question means the screening was not done, never that it was clear.
  const flags = Object.values(assessment.legacy?.flags ?? {}) as Array<boolean | null>;
  const unasked = !assessment.legacy || flags.length === 0 || flags.some((flag) => flag === null);
  return {
    parq: positive ? "POSITIVE" : unasked ? "NOT_DONE" : "CLEAR",
    professionalDecision: positive && assessment.standing.reviewed ? "REVIEWED" : null,
    medicalClearanceRecorded: false,
    ref,
  };
}

/* ---------------- Findings ---------------- */

const MOVEMENT_LABEL: Record<string, string> = Object.fromEntries(MOVEMENT_TESTS.map((t) => [t.key, t.label]));
const GRADE_LABEL: Record<string, string> = Object.fromEntries(MOVEMENT_GRADES.map((g) => [g.key, g.label]));
const LEGACY_POSTURE_LABEL: Record<string, string> = Object.fromEntries(POSTURE_VIEWS.flatMap((v) => v.items.map((i) => [i.key, i.label])));

/** Text of a recorded result with its method and the limitations its formula flagged (never a classification of the student). */
export function resultLabel(result: ResultRow): string {
  const name = RESULT_LABEL[result.code] ?? result.code;
  const value = result.value === null ? "sem valor" : formatResult(result.code, result.value, result.unit);
  const how = `${methodLabel(result.method)}${isResultEstimate(result.code, result.method) ? ", estimativa" : ""}`;
  const limits = result.flags.map((flag) => FLAG_LABEL[flag] ?? flag);
  return `${name}: ${value} (${how}${limits.length ? `; limitações: ${limits.join("; ")}` : ""})`;
}

/**
 * Observations of the assessment as engine findings. Labels come from the product's catalogs (and recorded numbers), never
 * from free text: the details of an anamnesis answer, posture notes, test conditions and the conclusion stay out.
 */
export function findingFacts(assessment: AssessmentRecord | null): FindingFact[] {
  if (!assessment) return [];
  const ref = `assessment:${assessment.id}`;
  const out: FindingFact[] = [];
  // Movement tests (earlier format): the only findings that may produce a one-click suggestion (by grade, rule MOVEMENT_FINDING_GRADES).
  for (const m of assessment.legacy?.movement ?? []) {
    if (m.grade === "NOT_ASSESSED") continue;
    out.push({ kind: "MOVEMENT", code: m.test, label: `${MOVEMENT_LABEL[m.test] ?? m.test}: ${GRADE_LABEL[m.grade] ?? m.grade}`, grade: m.grade, ref });
  }
  for (const key of assessment.legacy?.posture.findings ?? [])
    out.push({ kind: "POSTURE", code: key, label: `Postura: ${LEGACY_POSTURE_LABEL[key] ?? key}`, ref });
  if (assessment.posture) {
    for (const [key, findings] of Object.entries(assessment.posture.findings) as Array<[PostureRegionKey, string[] | undefined]>) {
      const region = POSTURE_REGION_BY_KEY[key];
      for (const finding of findings ?? []) {
        if (!region || finding === region.neutral) continue;
        out.push({ kind: "POSTURE", code: `${key}:${finding}`, label: `Postura, ${region.label}: ${region.findings[finding] ?? finding}`, ref });
      }
    }
  }
  if (assessment.movement) {
    const assessed = Object.keys(assessment.movement.flexitest.levels).length;
    if (assessed > 0) out.push({ kind: "FLEXIBILITY", code: "FLEXITEST", label: `Flexiteste: ${assessed} de 15 movimentos avaliados`, ref });
  }
  if (assessment.screening) {
    for (const [code, entry] of Object.entries(assessment.screening.anamnesis) as Array<[keyof typeof ANAMNESIS, { answer: string | null } | undefined]>) {
      if (entry?.answer !== "yes") continue;
      out.push({ kind: "ANAMNESIS", code, label: `Anamnese: ${ANAMNESIS[code] ?? code}: Sim (detalhes na avaliação)`, ref });
    }
  }
  if (assessment.tests) {
    for (const key of REPETITION_TESTS) {
      const reps = assessment.tests[key].repetitions;
      if (reps !== null) out.push({ kind: "ASSESSMENT_CONTEXT", code: `TEST:${key}`, label: `${TEST_TITLE[key]}: ${reps} repetições completas`, ref });
    }
  }
  for (const result of assessment.results)
    out.push({ kind: "ASSESSMENT_CONTEXT", code: `RESULT:${result.code}`, label: resultLabel(result), ref });
  return out;
}

/* ---------------- Student ---------------- */

/** Goals from the profile and from the assessment's goal list (catalog labels only; the free "notes" field is not read). */
export function goalText(profile: StudentProfile | null, assessment: AssessmentRecord | null): string | null {
  const parts: string[] = [];
  if (profile?.goal) parts.push(profile.goal);
  for (const code of assessment?.profile?.goals ?? []) {
    const label = GOALS[code];
    if (label && !parts.includes(label)) parts.push(label);
  }
  return parts.length ? parts.join("; ") : null;
}

export function studentFacts(profile: StudentProfile | null, assessment: AssessmentRecord | null): StudentFacts {
  const fromProfile = <T,>(value: T): Fact<T> => ({ value, source: "PROFILE", basis: "STUDENT_DATA", ref: "profile" });
  const goal = goalText(profile, assessment);
  return {
    level: profile?.level ? fromProfile(profile.level) : null,
    goal: goal ? { ...fromProfile(goal), ...(profile?.goal ? {} : { source: "ASSESSMENT" as const, ref: `assessment:${assessment!.id}` }) } : null,
    sessionMinutes: profile?.sessionMinutes ? fromProfile(profile.sessionMinutes) : null,
    screening: screeningFacts(assessment),
    findings: findingFacts(assessment),
  };
}

/* ---------------- Library ---------------- */

const METRICS: ReadonlySet<string> = new Set(["REPS", "TIME", "DISTANCE", "INTERVALS", "CONTINUOUS"]);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Library key of a name, as `exercises.name_key` (lower case, spaces collapsed). */
export const libraryNameKey = (name: string) => name.normalize("NFC").trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, " ");

/**
 * One library exercise as the engine sees it (S4 handoff): resolved field values by precedence, the per-exercise summary as
 * `metadataStatus`, curated alternatives as `substitutes`. A missing or pending field is null or an empty list, never a guess;
 * an exercise with a required field missing is PENDING and is never picked (its empty `equipment` then means nothing).
 */
export function catalogExercise(record: ExerciseRecord, meta: ResolvedMetadata | undefined): CatalogExercise {
  const value = (field: keyof ResolvedMetadata["fields"]) => {
    const f = meta?.fields[field];
    return f && f.provenance !== "PENDING" ? f.value : null;
  };
  const metric = value("metric");
  const difficulty = value("difficulty");
  const laterality = value("laterality");
  const compound = value("compound");
  const spr = value("seconds_per_rep");
  const alternatives = value("equipment_alternatives");
  return {
    id: record.id,
    name: record.name,
    nameKey: libraryNameKey(record.name),
    category: record.category,
    modality: typeof value("modality") === "string" ? (value("modality") as string) : null,
    metric: typeof metric === "string" && METRICS.has(metric) ? (metric as Metric) : null,
    primaryMuscles: strings(value("primary_muscles")),
    secondaryMuscles: strings(value("secondary_muscles")),
    patterns: strings(value("movement_patterns")),
    equipment: strings(value("equipment")),
    // A pending (or never filled) equipment field is unknown, not "needs none": the engine refuses it even when picked by hand.
    ...(meta?.fields.equipment && meta.fields.equipment.provenance !== "PENDING" && meta.fields.equipment.value !== null ? {} : { equipmentKnown: false }),
    equipmentAlternatives: Array.isArray(alternatives) ? alternatives.filter(Array.isArray).map(strings) : [],
    difficulty: typeof difficulty === "number" ? difficulty : null,
    laterality: laterality === "UNILATERAL" || laterality === "BILATERAL" ? laterality : null,
    compound: typeof compound === "boolean" ? compound : null,
    secondsPerRep: typeof spr === "number" ? spr : null,
    cautionTags: strings(value("caution_tags")),
    substitutes: [...new Set((meta?.alternatives ?? []).map((a) => a.exerciseId))].sort(cmp),
    metadataStatus: meta?.summary ?? "PENDING",
    archived: record.archivedAt !== null,
  };
}

export function buildCatalog(records: ExerciseRecord[], metadata: ReadonlyMap<string, ResolvedMetadata>): CatalogExercise[] {
  return records
    .filter((r) => r.archivedAt === null)
    .map((r) => catalogExercise(r, metadata.get(r.id)))
    .sort((a, b) => cmp(a.id, b.id));
}

/** Exercises whose caution markers nobody set (the field is never inferred): an exclusion by marker cannot see them. */
export function withoutCautionField(records: ReadonlyMap<string, ResolvedMetadata>, ids: string[]): string[] {
  return ids
    .filter((id) => {
      const f = records.get(id)?.fields.caution_tags;
      return !f || f.provenance === "PENDING" || f.value === null;
    })
    .sort(cmp);
}

/* ---------------- Structure ---------------- */

/**
 * The saved structure as engine facts. Occurrences come from the stored schedule itself (the same weeks, slots and planned
 * dates `buildPeriodization` wrote and the student's calendar uses); a phase without training days has no planned dates.
 * The free "focus note" of a workout is shown, never interpreted; only its minutes reach the engine.
 */
export function structureFacts(schedule: PeriodizationSchedule): StructureFacts {
  return {
    startDate: schedule.startDate,
    phases: schedule.phases.map((phase): StructurePhase => ({
      index: phase.index,
      name: isV2Phase(phase) ? phase.name : null,
      weeks: phase.weeks,
      sessionsPerWeek: phase.sessionsPerWeek,
      workouts: phaseWorkouts(phase).map((w) => ({
        label: w.label,
        name: w.name,
        exerciseTarget: w.target,
        focus: w.focus?.minutes ? { minutes: w.focus.minutes } : {},
      })),
      occurrences: phase.microcycles.flatMap((week) =>
        isV2Phase(phase)
          ? (week as (typeof phase.microcycles)[number]).slots.map((s) => ({
              week: week.index, slot: s.slot, label: s.label, plannedDate: s.plannedDate, weekStart: week.startDate,
            }))
          : week.sessions.map((label, i) => ({ week: week.index, slot: i + 1, label, plannedDate: null, weekStart: week.startDate })),
      ),
    })),
  };
}

/* ---------------- Rows already prescribed ---------------- */

/** A stored structured dose read back; anything that is not a valid dose of a known metric is null (the text stays). */
export function readStoredDose(raw: string | null): Dose | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || !METRICS.has(String((value as { metric?: unknown }).metric))) return null;
    const dose = value as Dose;
    return validateDose(dose).some((i) => i.severity === "ERROR") ? null : dose;
  } catch {
    return null;
  }
}

/** Every current row of the DRAFT revision becomes PRESERVED (design §2.2): its stored text is kept as typed. */
export function existingItems(items: PrescribedItemWithDose[]): ExistingItem[] {
  return items.map((item) => {
    const display: DisplayFields = {
      sets: item.sets,
      reps: item.reps,
      loadInstruction: item.loadInstruction,
      cadence: item.cadence,
      restSeconds: item.restSeconds,
      restText: item.restText,
      rirMin: item.rirMin,
      rirMax: item.rirMax,
      doseText: item.doseText ?? describeDose(item),
    };
    return {
      prescribedExerciseId: item.id,
      phaseIndex: item.phaseIndex,
      label: item.workoutLabel,
      exerciseId: item.exerciseId,
      name: item.name,
      nameKey: libraryNameKey(item.name),
      position: item.position,
      dose: readStoredDose(item.doseJson),
      display,
      origin: item.origin,
    };
  });
}
