/**
 * Planning context builder (design V4 §2.2): from what the gated adapter already read (`GenerationContext`, through
 * `automatica/context.ts:loadGenerationContext`), the professional's answers and the engine's own eligibility, the minimised,
 * coded `TrainingPlanningContext` a planner request is built from, plus the server-only companion data (refs, alias tables,
 * deny list, omitted-field record) and the hashes.
 *
 * Intended for the server: `GenerationContext` exists only there for one request, and `refs`/`aliases`/`denyList` never go to
 * a provider. The module itself is pure (no database, network or clock), so tests run it directly.
 *
 * What it guarantees (tested):
 * - no free text: every string in `context` is an enum, a vocabulary code or an alias; names, e-mail, phone, birth date, ids,
 *   labels, dates, notes, body measures, photos and library names never enter it, and each omission is recorded in `omitted`;
 * - deterministic: the same inputs in any order give the same JSON and the same `contextHash`; logging one more workout inside a
 *   band does not change it;
 * - the shortlist (`candidates`) is a subset of what the ENGINE considers eligible for some workout of the plan (pending
 *   metadata, excluded exercises and unavailable equipment never enter).
 *
 * Honest limit: coding, aliases and bands reduce but do not guarantee non-re-identification.
 */
import { CAUTION_TAGS } from "@/modules/biblioteca/metadata/vocabulary";
import { ageOn } from "@/modules/ficha/contracts";
import { prepare, prepareWorkout } from "@/modules/prescricao/motor/generate";
import { DEFAULT_RULESET, getRuleSet } from "@/modules/prescricao/motor/rules";
import { parseSlotKey } from "@/modules/prescricao/motor/select";
import type { CatalogExercise, Experience, ItemTarget, RuleSetRef, StructureFacts, StructurePhase } from "@/modules/prescricao/motor/types";
import { cmp, normalizeText } from "@/modules/prescricao/motor/vocabulary";
import { buildEngineInput, goalSuggestions } from "@/modules/prescricao/automatica/build-input";
import type { BuildOutcome, GenerationAnswers } from "@/modules/prescricao/automatica/contracts";
import { structureFacts, studentFacts, type GenerationContext } from "@/modules/prescricao/automatica/facts";
import { assignAliases } from "./alias";
import type {
  AgeBand, Band, DenyList, OmittedRecord, Origin, PlanningCandidate, PlanningContextBundle, PlanningPhase, TrainingPlanningContext,
} from "./context-types";
import { contextHash, structureFingerprint } from "./hashes";
import {
  CONTEXT_MAX_SESSION_MINUTES, HISTORY_BAND_FEW_MAX, PLANNER_MAX_CANDIDATES, PLANNER_MAX_PHASES, PLANNER_MAX_WORKOUTS_PER_PHASE, PLANNING_CONTEXT_VERSION,
} from "./versions";
import { EQUIPMENT_CODES, MODALITY_CODES, MUSCLE_CODES, PATTERN_CODES, STIMULUS_CODES } from "./vocab";

const CODE = /^[A-Z0-9_]{1,40}$/;
const FINDING_CODE = /^[A-Za-z0-9_:.-]{1,60}$/;
const PATTERN_SET = new Set(PATTERN_CODES);
const MUSCLE_SET = new Set(MUSCLE_CODES);
const MODALITY_SET = new Set(MODALITY_CODES);
const EQUIPMENT_SET = new Set(EQUIPMENT_CODES);
const STIMULUS_SET = new Set(STIMULUS_CODES);
const CAUTION_SET = new Set(Object.keys(CAUTION_TAGS));
/** Finding kinds that carry coded observations; anamnesis and assessment results are health detail not needed to choose a split. */
/** Words of an ordinary plan title that say nothing about a person; never refused in prose. Other title words (a name) are. */
const GENERIC_TITLE_WORDS = new Set(["plano", "treino", "treinos", "programa", "ciclo", "periodizacao", "prescricao", "fase", "semana", "semanas", "mensal", "individual", "personalizado"]);
const SENT_FINDING_KINDS = new Set(["MOVEMENT", "POSTURE", "FLEXIBILITY"]);

const keep = (list: readonly string[] | undefined, allowed: ReadonlySet<string>): string[] => [...new Set((list ?? []).filter((c) => allowed.has(c)))].sort(cmp);
const band = (n: number): Band => (n <= 0 ? "NONE" : n <= HISTORY_BAND_FEW_MAX ? "FEW" : "MANY");

export function ageBandOf(birthDate: string | null | undefined, asOf: string): { band: AgeBand | null; minor: boolean } {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return { band: null, minor: false };
  const age = ageOn(birthDate, asOf);
  if (!Number.isFinite(age) || age < 0) return { band: null, minor: false };
  if (age < 18) return { band: null, minor: true };
  return { band: age < 30 ? "18_29" : age < 40 ? "30_39" : age < 50 ? "40_49" : age < 60 ? "50_59" : "60_PLUS", minor: false };
}

/** Floor to the 15-minute step, at least 15, at most 180 (a coarse band, not the exact value). */
export function sessionMinutesBand(minutes: number | null | undefined): number | null {
  if (!minutes || !Number.isFinite(minutes) || minutes <= 0) return null;
  return Math.min(CONTEXT_MAX_SESSION_MINUTES, Math.max(15, Math.floor(minutes / 15) * 15));
}

function isoWeekday(date: string): number | null {
  const d = new Date(`${date}T00:00:00Z`);
  const n = d.getUTCDay();
  return Number.isNaN(n) ? null : n === 0 ? 7 : n;
}

export interface PlanningContextOptions {
  /** From the verified session. Server refs only; never sent. */
  organizationId: string;
  answers: GenerationAnswers;
  rules?: RuleSetRef;
  locked?: ItemTarget[];
  /** Extra values the server knows identify a person or a record (student display name, organization name...). They only feed the deny list. */
  identifiers?: ReadonlyArray<string | null | undefined>;
}

export type PlanningContextOutcome =
  | { ok: true; bundle: PlanningContextBundle; build: Extract<BuildOutcome, { ok: true }> }
  /** `buildEngineInput` refused the answers (unknown exercise, unknown target, unsupported suggestion). */
  | { ok: false; code: "BUILD_REJECTED"; build: Extract<BuildOutcome, { ok: false }> }
  /** More phases or distinct volume labels than the planner supports (D11): only the legacy path is available. */
  | { ok: false; code: "STRUCTURE_TOO_LARGE" };

/** Eligibility-ordered shortlist of the pool: every pattern first (one, then two), then uncovered primary muscles. */
export function shortlist(pool: readonly CatalogExercise[], cap = PLANNER_MAX_CANDIDATES): { chosen: CatalogExercise[]; capped: boolean } {
  const rank = (e: CatalogExercise) => [e.metadataStatus === "REVIEWED" ? 0 : 1, e.compound === true ? 0 : 1, e.difficulty ?? 99, e.id] as const;
  const order = (a: CatalogExercise, b: CatalogExercise) => {
    const x = rank(a), y = rank(b);
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || cmp(x[3], y[3]);
  };
  const sorted = [...pool].sort(order);
  const chosen = new Map<string, CatalogExercise>();
  const patterns = [...new Set(sorted.flatMap((e) => e.patterns.filter((p) => PATTERN_SET.has(p))))].sort(cmp);
  const take = (e: CatalogExercise) => { if (chosen.size < cap) chosen.set(e.id, e); };
  for (const round of [1, 2])
    for (const p of patterns) {
      const have = [...chosen.values()].filter((e) => e.patterns.includes(p)).length;
      if (have >= round) continue;
      const next = sorted.find((e) => !chosen.has(e.id) && e.patterns.includes(p));
      if (next) take(next);
    }
  const muscles = [...new Set(sorted.flatMap((e) => e.primaryMuscles.filter((m) => MUSCLE_SET.has(m))))].sort(cmp);
  for (const m of muscles) {
    if ([...chosen.values()].some((e) => e.primaryMuscles.includes(m))) continue;
    const next = sorted.find((e) => !chosen.has(e.id) && e.primaryMuscles.includes(m));
    if (next) take(next);
  }
  return { chosen: [...chosen.values()].sort((a, b) => cmp(a.id, b.id)), capped: pool.length > chosen.size };
}

const candidateOf = (alias: `X${number}`, e: CatalogExercise): PlanningCandidate => ({
  alias,
  modality: e.modality && MODALITY_SET.has(e.modality) ? e.modality : null,
  primaryMuscles: keep(e.primaryMuscles, MUSCLE_SET),
  secondaryMuscles: keep(e.secondaryMuscles, MUSCLE_SET),
  patterns: keep(e.patterns, PATTERN_SET),
  difficulty: e.difficulty,
  compound: e.compound,
  laterality: e.laterality,
  metric: e.metric,
  metadata: e.metadataStatus === "REVIEWED" ? "REVIEWED" : "INFERRED",
});

const phaseOk = (p: StructurePhase) => new Set(p.workouts.map((w) => w.label)).size <= PLANNER_MAX_WORKOUTS_PER_PHASE;

export async function buildPlanningContext(gen: GenerationContext, options: PlanningContextOptions): Promise<PlanningContextOutcome> {
  const rules = options.rules ?? DEFAULT_RULESET;
  const ruleSet = getRuleSet(rules);
  if (!ruleSet) throw new Error("RULESET_UNKNOWN");
  const { answers } = options;
  const saved: StructureFacts = structureFacts(gen.revision.schedule);
  if (saved.phases.length > PLANNER_MAX_PHASES || !saved.phases.every(phaseOk)) return { ok: false, code: "STRUCTURE_TOO_LARGE" };

  const build = buildEngineInput(gen, answers, { rules, locked: options.locked ?? [] });
  if (!build.ok) return { ok: false, code: "BUILD_REJECTED", build };
  const { input } = build;
  const facts = studentFacts(gen.profile, gen.assessment);
  const profile = gen.profile;
  const omitted: OmittedRecord[] = [];
  const omit = (field: string, reason: OmittedRecord["reason"], detail?: string) => omitted.push({ field, reason, ...(detail ? { detail } : {}) });

  // --- student ---
  const experienceMap = ruleSet.rules.EXPERIENCE_MAP.value as Record<string, Experience>;
  const level = facts.level?.value;
  const experience = level ? (experienceMap[normalizeText(level)] ?? null) : null;
  const goalCodes = keep(goalSuggestions(facts.goal?.value ?? null, rules).map((s) => s.value), STIMULUS_SET);
  const age = ageBandOf(profile?.birthDate, gen.asOf);
  const minutesFromAnswers = answers.availableMinutes ?? null;
  const minutes = sessionMinutesBand(minutesFromAnswers ?? profile?.sessionMinutes);
  const days = profile?.daysPerWeek && profile.daysPerWeek >= 1 && profile.daysPerWeek <= 7 ? profile.daysPerWeek : null;
  const equipmentKnown = answers.equipmentCodes !== undefined;
  const equipmentCodes = !equipmentKnown || answers.equipmentCodes === "NONE" ? [] : keep(answers.equipmentCodes as string[], EQUIPMENT_SET);
  const o = (known: boolean, from: Origin): Origin => (known ? from : "UNKNOWN");

  // --- observations (coded) ---
  const sent = facts.findings.filter((f) => SENT_FINDING_KINDS.has(f.kind) && FINDING_CODE.test(f.code));
  const dropped = facts.findings.length - sent.length;
  const aliasInput = {
    workoutLabels: saved.phases.flatMap((p) => p.workouts.map((w) => w.label)),
    findings: sent.map((f) => ({ kind: f.kind, code: f.code })),
  };

  // --- library: what the engine considers eligible for some workout of the plan ---
  const engine = prepare(input);
  if (!engine) throw new Error("RULESET_UNKNOWN");
  const pool = new Map<string, CatalogExercise>();
  const modalitiesOf = new Map<string, string[] | null>();
  for (const phase of input.structure.phases)
    for (const workout of phase.workouts) {
      const draft = prepareWorkout(engine, phase, workout);
      modalitiesOf.set(`${phase.index}|${workout.label}`, draft.modalities ? keep(draft.modalities.value, MODALITY_SET) : null);
      for (const e of draft.pool) if (e.metadataStatus !== "PENDING" && !e.archived) pool.set(e.id, e);
    }
  const eligible = [...pool.values()];
  const { chosen, capped } = shortlist(eligible);
  const aliases = await assignAliases({ ...aliasInput, exerciseIds: chosen.map((e) => e.id) });
  const aliasOfId = new Map([...aliases.exercises].map(([a, id]) => [id, a]));
  const aliasOfLabel = new Map([...aliases.workouts].map(([a, l]) => [l, a]));
  const candidates = chosen.map((e) => candidateOf(aliasOfId.get(e.id)!, e));
  const count = (pick: (e: CatalogExercise) => readonly string[], allowed: ReadonlySet<string>) => {
    const out: Record<string, number> = {};
    for (const e of eligible) for (const c of new Set(pick(e))) if (allowed.has(c)) out[c] = (out[c] ?? 0) + 1;
    return Object.fromEntries(Object.entries(out).sort(([a], [b]) => cmp(a, b)));
  };
  const reviewed = eligible.filter((e) => e.metadataStatus === "REVIEWED").length;
  const reviewedShare = !eligible.length ? "NONE" : reviewed === eligible.length ? "ALL" : reviewed * 2 >= eligible.length ? "MOST" : reviewed > 0 ? "SOME" : "NONE";
  if (capped) omit("library.candidates", "CAPPED", `${chosen.length} of ${eligible.length}`);

  // --- periodization ---
  const fixed = new Set<string>();
  for (const x of gen.existing) fixed.add(`${x.phaseIndex}|${x.workoutLabel}`);
  for (const l of options.locked ?? []) {
    const parsed = parseSlotKey(l.slotKey);
    if (parsed) fixed.add(`${l.phaseIndex}|${parsed.label}`);
  }
  let irregular = false;
  let unknownStimulus = false;
  const phases: PlanningPhase[] = saved.phases.map((phase) => {
    const inputPhase = input.structure.phases.find((p) => p.index === phase.index)!;
    const weeksOf = (label: string) => Array.from({ length: phase.weeks }, (_, i) => phase.occurrences.filter((x) => x.week === i + 1 && x.label === label).length);
    const firstFull =
      Array.from({ length: phase.weeks }, (_, i) => i + 1).find((w) => phase.occurrences.filter((x) => x.week === w).length === phase.sessionsPerWeek) ?? 1;
    const week = phase.occurrences.filter((x) => x.week === firstFull).sort((a, b) => a.slot - b.slot);
    const weekdays = week.length && week.every((x) => x.plannedDate) ? week.map((x) => isoWeekday(x.plannedDate!)) : null;
    const answered = answers.stimulusByPhase.find((s) => s.phaseIndex === phase.index)?.value ?? inputPhase.stimulus?.value ?? null;
    const stimulus = answered ? answered.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_") : null;
    if (stimulus && !STIMULUS_SET.has(stimulus)) unknownStimulus = true;
    return {
      index: phase.index,
      weeks: phase.weeks,
      sessionsPerWeek: phase.sessionsPerWeek,
      stimulus: stimulus && STIMULUS_SET.has(stimulus) ? stimulus : null,
      weekdays: weekdays && weekdays.every((d): d is number => d !== null) ? weekdays : null,
      weekSequence: week.flatMap((x) => {
        const a = aliasOfLabel.get(x.label);
        if (a === undefined) { irregular = true; return []; }
        return [a];
      }),
      workouts: [...new Map(inputPhase.workouts.map((w) => [w.label, w])).values()].map((w) => {
        const perWeek = weeksOf(w.label);
        const min = Math.min(...perWeek), max = Math.max(...perWeek);
        if (min !== max) irregular = true;
        const chosenCount = answers.exerciseCountByWorkout.find((c) => c.phaseIndex === phase.index && c.label === w.label)?.count;
        const muscles = keep(w.focus.muscles, MUSCLE_SET), patterns = keep(w.focus.patterns, PATTERN_SET);
        return {
          alias: aliasOfLabel.get(w.label)!,
          sessionsInPhase: perWeek.reduce((a, b) => a + b, 0),
          perWeek: { min, max },
          modalities: modalitiesOf.get(`${phase.index}|${w.label}`) ?? null,
          exerciseTarget: chosenCount ?? w.exerciseTarget ?? null,
          existingFocus: muscles.length || patterns.length ? { muscles, patterns } : null,
          hasFixedItems: fixed.has(`${phase.index}|${w.label}`),
        };
      }),
    };
  });
  if (unknownStimulus) omit("periodization.stimulus", "UNKNOWN_VALUE", "estímulo fora do vocabulário");

  const context: TrainingPlanningContext = {
    contextVersion: PLANNING_CONTEXT_VERSION,
    student: {
      experience,
      goalCodes,
      ageBand: age.band,
      sessionMinutes: minutes,
      daysPerWeek: days,
      equipment: { known: equipmentKnown, codes: equipmentCodes },
      origins: {
        experience: o(experience !== null, "STUDENT_DECLARED"),
        goal: o(goalCodes.length > 0, facts.goal?.source === "ASSESSMENT" ? "ASSESSED" : "STUDENT_DECLARED"),
        sessionMinutes: o(minutes !== null, minutesFromAnswers ? "PROFESSIONAL_DECISION" : "STUDENT_DECLARED"),
        daysPerWeek: o(days !== null, "STUDENT_DECLARED"),
        equipment: o(equipmentKnown, "PROFESSIONAL_DECISION"),
      },
    },
    screening: { parq: facts.screening.parq, decision: facts.screening.professionalDecision },
    observations: sent.map((f, i) => ({
      alias: `F${i + 1}` as const,
      kind: f.kind,
      code: f.code,
      grade: f.grade && CODE.test(f.grade) ? f.grade : null,
      readings: (f.readings ?? []).filter((r) => FINDING_CODE.test(r.code) && Number.isInteger(r.level)).map((r) => ({ code: r.code, level: r.level })).sort((a, b) => cmp(a.code, b.code)),
    })),
    periodization: { phases, irregular },
    history: {
      windowDays: gen.history.window.sinceDays,
      sessionsBand: band(gen.history.window.sessions),
      recordsBand: band(gen.history.summary.logs.length),
      painRecorded: gen.history.summary.logs.some((l) => l.pain),
    },
    constraints: {
      hasLocked: (options.locked?.length ?? 0) > 0,
      hasPreserved: gen.existing.length > 0,
      excludedPatterns: keep(answers.excludedPatterns, PATTERN_SET),
      excludedCautionTags: keep(answers.excludedCautionTags, CAUTION_SET),
      timeBudget: answers.timeBudget ?? "SOFT",
    },
    library: {
      eligibleExercises: eligible.length,
      byPattern: count((e) => e.patterns, PATTERN_SET),
      byPrimaryMuscle: count((e) => e.primaryMuscles, MUSCLE_SET),
      reviewedShare,
      candidates,
    },
  };

  // --- omitted-field record (always: it documents what is never sent) ---
  omit("profile.name", "DIRECT_IDENTIFIER");
  omit("profile.email", "DIRECT_IDENTIFIER");
  omit("profile.phone", "DIRECT_IDENTIFIER");
  omit("profile.birthDate", "NOT_NEEDED", "só a faixa etária");
  omit("profile.gender", "NOT_NEEDED");
  omit("profile.height", "NOT_NEEDED");
  omit("profile.weight", "NOT_NEEDED");
  omit("profile.bodyMeasuredOn", "NOT_NEEDED");
  omit("profile.goal", "FREE_TEXT", "só códigos de estímulo");
  omit("profile.level", "FREE_TEXT", "só a experiência mapeada");
  omit("profile.freeText", "FREE_TEXT", "equipamentos, local, lesões, cirurgias, dores, limitações, condições, notas, preferências, observações");
  omit("assessment.label", "FREE_TEXT");
  omit("assessment.ids", "DIRECT_IDENTIFIER", "ids, datas e referências");
  omit("assessment.conclusion", "FREE_TEXT");
  if (dropped > 0) omit("assessment.findings", "HEALTH_DETAIL", `${dropped} achado(s) de anamnese, resultados ou código fora do padrão`);
  omit("structure.dates", "NOT_NEEDED", "só índices, semanas e dias da semana");
  omit("structure.names", "FREE_TEXT", "nomes de fases e de treinos, rótulos reais");
  omit("parameters.preferredExerciseIds", "DIRECT_IDENTIFIER");
  omit("parameters.excludedExerciseIds", "DIRECT_IDENTIFIER");
  omit("parameters.acceptedFlagDecisions", "DIRECT_IDENTIFIER", "os códigos de alerta contêm ids de exercício");
  omit("parameters.lockedAndPreserved", "DIRECT_IDENTIFIER", "só se existem");
  omit("history.perExercise", "DEFERRED", "contexto v1 envia só faixas");
  omit("plan.title", "FREE_TEXT");
  omit("ids", "DIRECT_IDENTIFIER", "aluno, plano, revisão, organização e usuário ficam no servidor");

  // --- deny list: values that must never appear in a provider payload ---
  const values = new Set<string>();
  const tokens = new Set<string>();
  // Prose deny list (what the model's TEXT may not contain): only real identifiers. The model never saw goal, level, phase or workout
  // names, exercise names or free-text profile values, so ordinary pt-BR words ("hipertrofia", "Fase 1", "prancha", "treino") are not here.
  const prose = new Set<string>();
  const addProse = (raw: string | null | undefined, min = 3) => {
    const v = raw ? normalizeText(raw).replace(/[^a-z0-9]+/g, " ").trim() : "";
    if (v.length >= min) prose.add(v);
  };
  const addValue = (raw: string | null | undefined) => {
    const v = raw ? normalizeText(raw) : "";
    if (v.length >= 3) values.add(v);
  };
  const addName = (raw: string | null | undefined) => {
    addValue(raw);
    addProse(raw);
    for (const t of normalizeText(raw ?? "").split(/[^a-z0-9]+/)) if (t.length >= 3) { tokens.add(t); prose.add(t); }
  };
  for (const x of options.identifiers ?? []) addName(x);
  addValue(gen.plan.title);
  addProse(gen.plan.title, 4);
  for (const t of normalizeText(gen.plan.title).split(/[^a-z0-9]+/))
    if (t.length >= 4) {
      tokens.add(t);
      if (!GENERIC_TITLE_WORDS.has(t)) prose.add(t);
    }
  for (const id of [gen.plan.id, gen.plan.studentId, gen.revision.id, options.organizationId]) { addValue(id); addProse(id, 4); }
  for (const p of saved.phases) {
    addValue(p.name);
    for (const w of p.workouts) { addValue(w.label); addValue(w.name); }
  }
  if (profile) {
    addValue(profile.email);
    addProse(profile.email);
    if (profile.email) { addValue(profile.email.split("@")[0]); addProse(profile.email.split("@")[0]); }
    addValue(profile.phone);
    const digits = (profile.phone ?? "").replace(/\D/g, "");
    if (digits.length >= 6) {
      values.add(digits);
      prose.add(digits);
      // written without the country code (55) by whoever types it
      if (digits.startsWith("55") && digits.length >= 12) { values.add(digits.slice(2)); prose.add(digits.slice(2)); }
    }
    if (profile.birthDate) {
      values.add(profile.birthDate);
      const [y, m, d] = profile.birthDate.split("-");
      values.add(`${d}/${m}/${y}`);
      values.add(y);
      prose.add(`${d} ${m} ${y}`);
    }
    for (const text of [
      profile.goal, profile.level, profile.location, profile.equipment, profile.experience, profile.injuries, profile.surgeries, profile.pains, profile.limitations,
      profile.medicationsConditions, profile.relevantNotes, profile.preferredExercises, profile.dislikedExercises, profile.excludedExercises, profile.professionalNotes,
    ]) addValue(text);
  }
  for (const e of chosen) { addValue(e.id); addValue(e.name); }
  if (gen.assessment) addValue(gen.assessment.id);
  values.delete("");

  const bundle: PlanningContextBundle = {
    context,
    refs: {
      organizationId: options.organizationId,
      planId: gen.plan.id,
      revisionId: gen.revision.id,
      studentId: gen.plan.studentId,
      baseContentVersion: gen.revision.contentVersion,
      structureFingerprint: await structureFingerprint(saved),
      catalogHash: gen.catalogHash,
      rules,
    },
    aliases,
    omitted,
    denyList: { values: [...values].sort(cmp), tokens: [...tokens].sort(cmp), prose: [...prose].sort(cmp) } satisfies DenyList,
    minor: age.minor,
    contextHash: await contextHash(context),
  };
  return { ok: true, bundle, build };
}
