import type {
  Dose, DosePolicy, Exercise, GenerationInput, GenerationResult, Issue,
  Phase, PrescriptionItem, PrescriptionPolicies, Session, Stimulus, Template, VolumeRow,
} from "./types.ts";

export const ENGINE_VERSION = "1.0.0";
export const POLICY_VERSION = "gymgital-base-2026.11";

/** Curated references support the principles; exact default numbers below are editable product heuristics. */
export const REFERENCES = [
  { rule: "RESISTANCE_GOAL_MATCH", source: "Currier et al. (2026), ACSM, PMID 41843416", type: "evidence" as const },
  { rule: "VOLUME_DIRECT_INDIRECT", source: "Pelland et al. (2026), PMID 41343037", type: "evidence" as const },
  { rule: "DOSE_DEFAULTS", source: "Gymgital configurable starting points, professional review required", type: "heuristic" as const },
  { rule: "PROGRESSION_DEFAULTS", source: "Gymgital operational double-progression policy; not a universal clinical threshold", type: "heuristic" as const },
];

const defaults: Record<string, Record<string, DosePolicy>> = {
  resistance: {
    hypertrophy: { sets: 3, repsMin: 8, repsMax: 12, rirMin: 2, rirMax: 3, restSeconds: 120, secondsPerRep: 5 },
    strength: { sets: 3, repsMin: 3, repsMax: 6, rirMin: 2, rirMax: 3, restSeconds: 210, secondsPerRep: 5 },
    power: { sets: 3, repsMin: 2, repsMax: 5, rirMin: 3, rirMax: 5, restSeconds: 180, secondsPerRep: 4, notes: "Priorize qualidade e intenção de velocidade; interrompa ao perder velocidade técnica." },
    endurance: { sets: 2, repsMin: 12, repsMax: 20, rirMin: 2, rirMax: 4, restSeconds: 90, secondsPerRep: 4 },
    general: { sets: 2, repsMin: 8, repsMax: 12, rirMin: 2, rirMax: 4, restSeconds: 120, secondsPerRep: 5 },
    recovery: { sets: 1, repsMin: 8, repsMax: 12, rirMin: 4, rirMax: 6, restSeconds: 90, secondsPerRep: 5 },
  },
  cardio: { general: { sets: 1, durationSeconds: 900, restSeconds: 0, notes: "Intensidade individualizada pelo profissional (conversa/RPE/zona, quando definida)." } },
  mobility: { general: { sets: 2, durationSeconds: 40, restSeconds: 20 } },
  balance: { general: { sets: 2, durationSeconds: 30, restSeconds: 30 } },
  skill: { general: { sets: 3, durationSeconds: 45, restSeconds: 90 } },
};
const strCmp = (a: string, b: string) => a.localeCompare(b, "en");
const sorted = <T>(items: T[], key: (x: T) => string): T[] => [...items].sort((a, b) => strCmp(key(a), key(b)));
const contains = (arr: string[] | undefined, x: string): boolean => Boolean(arr?.includes(x));
const positiveInt = (n: number): boolean => Number.isSafeInteger(n) && n >= 0;
const finite = (n: number | undefined): n is number => typeof n === "number" && Number.isFinite(n);
const round = (x: number): number => Math.round(x * 100) / 100;

function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => strCmp(a, b))
      .filter(([, v]) => v !== undefined).map(([k, v]) => `${JSON.stringify(k)}:${sortedJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function stableHash(value: unknown): string {
  const text = sortedJson(value);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, "0");
}
function dateAdd(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function validDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00.000Z`)) && dateAdd(date, 0) === date;
}
function ensure(cond: boolean, path: string): void {
  if (!cond) throw new Error(`INVALID_INPUT:${path}`);
}
function validateInput(input: GenerationInput): void {
  ensure(validDate(input.periodization.startDate), "periodization.startDate");
  ensure(Boolean(input.student.id?.trim()), "student.id");
  ensure(Boolean(input.student.objective?.trim()), "student.objective");
  ensure(Array.isArray(input.student.availableEquipment), "student.availableEquipment");
  ensure(Boolean(input.student.screening?.state), "student.screening");
  ensure(Array.isArray(input.periodization.phases) && input.periodization.phases.length > 0, "periodization.phases");
  ensure(Array.isArray(input.catalog), "catalog");
  ensure(new Set(input.catalog.map((e) => e.id)).size === input.catalog.length, "catalog.duplicateIds");
  const ids = new Set<string>();
  for (const [i, p] of input.periodization.phases.entries()) {
    ensure(!ids.has(p.id) && Boolean(p.id), `phases[${i}].id`); ids.add(p.id);
    ensure(Number.isSafeInteger(p.weeks) && p.weeks > 0, `phases[${i}].weeks`);
    ensure(positiveInt(p.sessionsPerWeek), `phases[${i}].sessionsPerWeek`);
    ensure(p.templates.length > 0 || p.sessionsPerWeek === 0, `phases[${i}].templates`);
    ensure(new Set(p.templates.map(t => t.id)).size === p.templates.length, `phases[${i}].templates.ids`);
    ensure((p.rotation ?? p.templates.map(t => t.id)).every(id => p.templates.some(t => t.id === id)), `phases[${i}].rotation`);
    ensure(!p.trainingDays || (p.trainingDays.length === p.sessionsPerWeek && p.trainingDays.every(n => Number.isInteger(n) && n >= 0 && n <= 6)), `phases[${i}].trainingDays`);
    for (const [j, t] of p.templates.entries()) {
      ensure(positiveInt(t.exerciseCount), `phases[${i}].templates[${j}].exerciseCount`);
      ensure(!finite(t.minutes) || t.minutes > 0, `phases[${i}].templates[${j}].minutes`);
      ensure(new Set(t.lockedExerciseIds ?? []).size === (t.lockedExerciseIds ?? []).length, `phases[${i}].templates[${j}].lockedExerciseIds`);
    }
  }
}
function resolveStimulus(goal: string): string {
  const key = goal.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/hipertrof|muscle|grow|massa/.test(key)) return "hypertrophy";
  if (/potenc|power|explos/.test(key)) return "power";
  if (/forca|strength/.test(key)) return "strength";
  if (/resist|endurance|condicion|cardio|emagrec/.test(key)) return "endurance";
  if (/recuper|adapt|regener/.test(key)) return "recovery";
  return "general";
}
function stimulusFor(p: Phase, template: Template, week: number, sequence: number, goal: string): string {
  let stimulus: Stimulus = p.blocks?.[week - 1] ?? template.stimulus ?? p.stimulus ?? resolveStimulus(goal);
  if (p.strategy === "undulating_daily") stimulus = sequence % 2 === 0 ? stimulus : (stimulus === "strength" ? "hypertrophy" : "strength");
  if (p.strategy === "undulating_weekly") stimulus = week % 2 === 1 ? stimulus : (stimulus === "strength" ? "hypertrophy" : "strength");
  return stimulus;
}
function policyFor(e: Exercise, stimulus: string, template: Template, policies: PrescriptionPolicies): DosePolicy {
  const base = defaults[e.modality]?.[stimulus] ?? defaults[e.modality]?.general ?? {
    sets: 1, durationSeconds: 300, restSeconds: 60,
    notes: "Modalidade customizada: ajustar a métrica e a dose com protocolo do profissional.",
  };
  const user = policies.byStimulus?.[stimulus]?.[e.modality] ?? {};
  const modality = policies.byModality?.[e.modality] ?? {};
  const local = template.doseOverrides?.[e.id] ?? {};
  const merged = { ...base, ...user, ...modality, ...local };
  ensure(Number.isSafeInteger(merged.sets) && merged.sets >= 0, `policy.${e.id}.sets`);
  ensure(finite(merged.restSeconds) && merged.restSeconds >= 0, `policy.${e.id}.restSeconds`);
  ensure(!finite(merged.repsMin) || merged.repsMin >= 0, `policy.${e.id}.repsMin`);
  ensure(!finite(merged.repsMax) || merged.repsMax >= (merged.repsMin ?? 0), `policy.${e.id}.repsMax`);
  return merged;
}
function doseFor(e: Exercise, stimulus: string, template: Template, phase: Phase, week: number, policies: PrescriptionPolicies): Dose {
  const v: DosePolicy = { ...policyFor(e, stimulus, template, policies), ...(phase.weeklyPolicies?.[week]?.[e.modality] ?? {}) };
  if (phase.strategy === "linear" && phase.linear && e.modality === "resistance") {
    const fraction = phase.weeks <= 1 ? 0 : (week - 1) / (phase.weeks - 1);
    const wave = (range: [number, number] | undefined) => range ? Math.round(range[0] + (range[1] - range[0]) * fraction) : undefined;
    for (const key of ["sets", "repsMin", "repsMax", "rirMin", "rirMax"] as const) {
      const value = wave(phase.linear[key]);
      if (value !== undefined) v[key] = value;
    }
    if (v.repsMin !== undefined && v.repsMax !== undefined && v.repsMin > v.repsMax)
      throw new Error(`INVALID_LINEAR_RAMP:${phase.id}`);
  }
  if (e.metric === "reps" && v.repsMin === undefined && v.repsMax === undefined) {
    v.repsMin = 8; v.repsMax = 12;
    v.notes = [v.notes, "Faixa operacional genérica; revisar com protocolo específico."].filter(Boolean).join(" ");
  }
  if (e.metric === "time" && v.durationSeconds === undefined) v.durationSeconds = 60;
  if (e.metric === "distance" && v.distanceMeters === undefined) v.distanceMeters = 100;

  if (phase.deloadWeeks?.includes(week)) {
    const multiplier = phase.deloadMultiplier ?? 0.6;
    ensure(finite(multiplier) && multiplier > 0 && multiplier <= 1, `phase.${phase.id}.deloadMultiplier`);
    v.sets = Math.max(1, Math.round(v.sets * multiplier));
    v.notes = [v.notes, "Semana de descarga definida pelo profissional; menor volume planejado."].filter(Boolean).join(" ");
  }
  // Avoid invented kilograms or assuming an evaluation predicts an exact load.
  return {
    ...v, loadKg: null, loadBasis: e.modality === "resistance" ? "TOTAL" : "NONE",
    loadInstruction: e.modality === "resistance"
      ? "Calibrar carga na execução com técnica e esforço-alvo; registrar base (total/por mão/por lado)."
      : "Usar a métrica da modalidade; ajustar intensidade com o protocolo escolhido.",
    progression: e.modality === "resistance"
      ? "Dupla progressão condicional: avançar somente após execuções comparáveis, sem dor e dentro do esforço previsto."
      : "Progressão condicionada aos registros, à tolerância e à revisão profissional.",
  };
}
function durationItem(e: Exercise, dose: Dose, policies: PrescriptionPolicies): number {
  const sets = dose.sets;
  const sec = e.metric === "reps"
    ? (dose.repsMax ?? dose.repsMin ?? 8) * (dose.secondsPerRep ?? e.secondsPerRep ?? 5)
    : e.metric === "time" ? (dose.durationSeconds ?? 40) : (dose.distanceMeters ?? 100) / 1.5;
  const sides = e.unilateral ? 2 : 1;
  const extra = (policies.duration?.transitionSeconds ?? 40) + (policies.duration?.setupSeconds ?? 20);
  return (sets * sides * sec + Math.max(0, sets - 1) * dose.restSeconds + extra) / 60;
}
function durationSession(items: PrescriptionItem[], catalogById: Map<string, Exercise>, policies: PrescriptionPolicies): number {
  if (items.length === 0) return 0;
  let duration = (policies.duration?.warmupSeconds ?? 420) / 60;
  for (const item of items) {
    const e = catalogById.get(item.exerciseId);
    if (e) duration += durationItem(e, item.dose, policies);
  }
  return round(duration);
}
function allowed(e: Exercise, input: GenerationInput, t: Template): boolean {
  const s = input.student;
  if (e.manualOnly || contains(s.excludedExerciseIds, e.id) || contains(t.excludedExerciseIds, e.id)) return false;
  if (e.movementPatterns.some(pattern => contains(s.excludedPatterns, pattern))) return false;
  if (t.modalities?.length && !t.modalities.includes(e.modality)) return false;
  const inventory = new Set(s.availableEquipment);
  if (!e.equipment.every(eq => inventory.has(eq))) return false;
  if (e.compatibleAny?.length && !e.compatibleAny.some(set => set.every(eq => inventory.has(eq)))) return false;
  return true;
}
function score(e: Exercise, picked: Exercise[], t: Template, input: GenerationInput): number {
  const done = new Map<string, number>();
  for (const x of picked) for (const m of x.primaryMuscles) done.set(m, (done.get(m) ?? 0) + 1);
  let value = 0;
  const targetMuscles = t.targetMuscles ?? [];
  for (const muscle of e.primaryMuscles) {
    if (targetMuscles.includes(muscle)) value += 65 / (1 + (done.get(muscle) ?? 0) * 2);
  }
  for (const muscle of e.secondaryMuscles ?? []) {
    if (targetMuscles.includes(muscle)) value += 9 / (1 + (done.get(muscle) ?? 0));
  }
  for (const pattern of e.movementPatterns) {
    if (t.targetPatterns?.includes(pattern)) {
      value += picked.some(x => x.movementPatterns.includes(pattern)) ? 5 : 32;
    }
  }
  if (!targetMuscles.length && !t.targetPatterns?.length) value += 15;
  if (contains(input.student.preferredExerciseIds, e.id)) value += 22;
  if (input.existing?.some(x => x.templateId === t.id && x.exerciseId === e.id)) value += 24;
  if ((input.student.experience ?? "").toLowerCase() === "beginner") value -= (e.difficulty ?? 1) * 6;
  else value -= (e.difficulty ?? 1) * 0.5;
  return value;
}
function alternatives(e: Exercise, selectedIds: Set<string>, pool: Exercise[], count: number): string[] {
  return pool.filter(x => x.id !== e.id && !selectedIds.has(x.id) && x.modality === e.modality &&
    x.primaryMuscles.some(m => e.primaryMuscles.includes(m)) &&
    x.movementPatterns.some(p => e.movementPatterns.includes(p)))
    .sort((a, b) => strCmp(a.id, b.id)).slice(0, count).map(x => x.id);
}
interface Selection { selected: Exercise[]; issues: Issue[]; }
function selectTemplate(input: GenerationInput, p: Phase, t: Template, stimulus: string): Selection {
  const issues: Issue[] = [];
  const path = `phases.${p.id}.templates.${t.id}`;
  const pool = sorted(input.catalog.filter(x => allowed(x, input, t)), x => x.id);
  const byId = new Map(pool.map(x => [x.id, x]));
  const locked = t.lockedExerciseIds ?? [];
  const retained = input.existing?.filter(x => x.phaseId === p.id && x.templateId === t.id && x.locked).map(x => x.exerciseId) ?? [];
  const required = [...new Set([...locked, ...retained])];
  for (const id of required) if (!byId.has(id)) {
    issues.push({ severity: "ERROR", code: "LOCKED_EXERCISE_INELIGIBLE", path, message: `Exercício travado ${id} indisponível ou incompatível.`, suggestedAction: "Rever bloqueio/equipamento ou substituir manualmente." });
  }
  if (required.length > t.exerciseCount) {
    issues.push({ severity: "ERROR", code: "LOCKED_EXCEEDS_TARGET", path, message: `${required.length} travas para alvo de ${t.exerciseCount}.` });
  }
  const picked: Exercise[] = required.map(id => byId.get(id)).filter((v): v is Exercise => v !== undefined);
  const budget = t.minutes ?? input.student.minutesPerSession;
  const policies = input.policies ?? {};
  if (pool.length < t.exerciseCount) {
    issues.push({ severity: "ERROR", code: "CATALOG_INSUFFICIENT", path,
      message: `Solicitados ${t.exerciseCount} exercícios; ${pool.length} elegíveis no catálogo.`,
      suggestedAction: "Adicionar alternativas ao catálogo, alterar equipamento ou rever a quantidade." });
  }
  // Beam search prioritizes coverage while respecting feasibility. Beam width affects performance, never counts.
  const beamWidth = Math.max(1, Math.floor(policies.beamWidth ?? 10));
  type Candidate = { picked: Exercise[]; quality: number; minutes: number; };
  let beam: Candidate[] = [{ picked, quality: picked.reduce((sum, e, i) => sum + score(e, picked.slice(0, i), t, input), 0), minutes: 0 }];
  for (let slot = picked.length; slot < t.exerciseCount; slot++) {
    const next: Candidate[] = [];
    for (const candidate of beam) {
      const have = new Set(candidate.picked.map(x => x.id));
      for (const e of pool) {
        if (have.has(e.id)) continue;
        const test = [...candidate.picked, e];
        const estimate = durationSession(test.map((x, i) => ({
          exerciseId: x.id, exerciseName: x.name, modality: x.modality, order: i + 1,
          dose: doseFor(x, stimulus, t, p, 1, policies), alternativeIds: [],
          videoStatus: "MISSING", origin: "ENGINE", reasons: [],
        })), new Map(pool.map(x => [x.id, x])), policies);
        // Do not skip a candidate only because current budget cannot hold it:
        // this enables reporting the exact prescription and its infeasibility.
        const overflow = budget === undefined ? 0 : Math.max(0, estimate - budget);
        next.push({ picked: test, quality: candidate.quality + score(e, candidate.picked, t, input) - overflow * 3, minutes: estimate });
      }
    }
    if (!next.length) break;
    next.sort((a, b) => b.quality - a.quality || strCmp(a.picked.map(x => x.id).join("|"), b.picked.map(x => x.id).join("|")));
    beam = next.slice(0, beamWidth);
  }
  const chosen = beam[0]?.picked ?? picked;
  if (chosen.length !== t.exerciseCount) issues.push({ severity: "ERROR", code: "EXERCISE_TARGET_UNMET", path, message: `${chosen.length}/${t.exerciseCount} exercícios possíveis sem duplicações.` });
  if (t.targetMuscles?.length) for (const muscle of t.targetMuscles) {
    if (!chosen.some(x => x.primaryMuscles.includes(muscle))) issues.push({ severity: "WARNING", code: "MUSCLE_NOT_COVERED", path, message: `Musculatura ${muscle} sem exercício primário na sessão.` });
  }
  return { selected: chosen, issues };
}
function buildItems(selected: Exercise[], input: GenerationInput, p: Phase, t: Template, stimulus: string, week: number): PrescriptionItem[] {
  const pool = input.catalog.filter(x => allowed(x, input, t));
  const used = new Set(selected.map(x => x.id));
  const locked = new Set([...(t.lockedExerciseIds ?? []), ...(input.existing?.filter(x => x.phaseId === p.id && x.templateId === t.id && x.locked).map(x => x.exerciseId) ?? [])]);
  return selected.map((e, i) => {
    const reasons = [e.primaryMuscles.filter(m => t.targetMuscles?.includes(m)).map(m => `Cobre ${m}`).join(", "),
      e.movementPatterns.filter(pattern => t.targetPatterns?.includes(pattern)).map(p => `Padrão ${p}`).join(", ")].filter(Boolean);
    return { exerciseId: e.id, exerciseName: e.name, modality: e.modality, order: i + 1,
      dose: doseFor(e, stimulus, t, p, week, input.policies ?? {}),
      alternativeIds: alternatives(e, used, pool, input.policies?.alternativeCount ?? 4),
      videoStatus: e.video?.status ?? "MISSING", origin: locked.has(e.id) ? "LOCKED" : input.existing?.some(x => x.phaseId === p.id && x.templateId === t.id && x.exerciseId === e.id) ? "PRESERVED" : "ENGINE",
      reasons: reasons.length ? reasons : ["Elegível para modalidade e equipamentos confirmados."],
    };
  });
}
function trainingDays(phase: Phase): number[] {
  if (phase.trainingDays) return [...phase.trainingDays];
  if (phase.sessionsPerWeek === 0) return [];
  return Array.from({ length: phase.sessionsPerWeek }, (_, index) => Math.floor(index * 7 / phase.sessionsPerWeek));
}
function volumeFor(sessions: Session[], byId: Map<string, Exercise>): VolumeRow[] {
  const map = new Map<string, VolumeRow>();
  const occurrences = new Map<string, Set<string>>();
  for (const s of sessions) {
    for (const item of s.items) {
      const e = byId.get(item.exerciseId);
      if (!e || e.modality !== "resistance") continue;
      const direct = new Set(e.primaryMuscles);
      const indirect = new Set((e.secondaryMuscles ?? []).filter(m => !direct.has(m)));
      for (const muscle of new Set([...direct, ...indirect])) {
        const key = `${s.phaseId}|${s.week}|${muscle}`;
        let row = map.get(key);
        if (!row) {
          row = { phaseId: s.phaseId, week: s.week, muscle, directSets: 0, indirectSets: 0, weightedSets: 0, occurrences: 0 };
          map.set(key, row);
        }
        if (direct.has(muscle)) row.directSets += item.dose.sets;
        else row.indirectSets += item.dose.sets;
        if (!occurrences.has(key)) occurrences.set(key, new Set());
        occurrences.get(key)?.add(s.id);
      }
    }
  }
  for (const [key, row] of map) {
    row.weightedSets = round(row.directSets + row.indirectSets * 0.5);
    row.occurrences = occurrences.get(key)?.size ?? 0;
  }
  return [...map.values()].sort((a, b) => strCmp(`${a.phaseId}|${a.week.toString().padStart(5, "0")}|${a.muscle}`, `${b.phaseId}|${b.week.toString().padStart(5, "0")}|${b.muscle}`));
}

/** Pure generation: no database, network, LLM, mutation, or medical inference. */
export function generatePrescription(input: GenerationInput): GenerationResult {
  validateInput(input);
  const issues: Issue[] = [];
  const trace: GenerationResult["decisionTrace"] = [];
  const policies = input.policies ?? {};
  const byId = new Map(input.catalog.map(e => [e.id, e]));
  const sessions: Session[] = [];
  let cursor = input.periodization.startDate;
  if (input.student.screening.state !== "reviewed") issues.push({ severity: "WARNING", code: "SCREENING_REVIEW_REQUIRED", path: "student.screening", message: "Rascunho gerável; aprovação e entrega exigem decisão profissional documentada." });
  if (input.student.restrictions?.length) issues.push({ severity: "WARNING", code: "RESTRICTIONS_NEED_INTERPRETATION", path: "student.restrictions", message: "Restrições relatadas precisam ser interpretadas e convertidas em bloqueios explícitos pelo profissional." });
  if (input.student.assessment?.limitations?.length) issues.push({ severity: "INFO", code: "ASSESSMENT_LIMITATIONS", path: "student.assessment", message: "A avaliação possui limitações documentadas; dados isolados não vetam exercícios automaticamente." });
  const phaseSelection = new Map<string, ReturnType<typeof selectTemplate>>();
  input.periodization.phases.forEach((p, phaseIndex) => {
    const selectedScope = !input.scope?.phaseIds || input.scope.phaseIds.includes(p.id);
    const rotation = p.rotation ?? p.templates.map(t => t.id);
    const days = trainingDays(p);
    const templateExposureCount = new Map<string, number>();
    for (let week = 1; week <= p.weeks; week++) {
      for (let slotIndex = 0; slotIndex < p.sessionsPerWeek; slotIndex++) {
        if (!selectedScope) continue;
        const day = days[slotIndex] ?? 0;
        const templateId = rotation[((week - 1) * p.sessionsPerWeek + slotIndex) % rotation.length];
        const template = p.templates.find(t => t.id === templateId);
        if (!template) throw new Error(`INVALID_ROTATION:${p.id}`);
        const exposureIndex = templateExposureCount.get(template.id) ?? 0;
        templateExposureCount.set(template.id, exposureIndex + 1);
        const stimulus = stimulusFor(p, template, week, exposureIndex, input.student.objective);
        const key = `${p.id}|${template.id}|${stimulus}`;
        let selection = phaseSelection.get(key);
        if (!selection) {
          selection = selectTemplate(input, p, template, stimulus);
          phaseSelection.set(key, selection);
          issues.push(...selection.issues);
        }
        const id = `${p.id}:w${week}:s${slotIndex + 1}`;
        const items = buildItems(selection.selected, input, p, template, stimulus, week);
        const estimatedMinutes = durationSession(items, byId, policies);
        const limit = template.minutes ?? input.student.minutesPerSession;
        if (finite(limit) && estimatedMinutes > limit) issues.push({ severity: "ERROR", code: "TIME_BUDGET_EXCEEDED", path: `sessions.${id}`,
          message: `Sessão prevista: ${estimatedMinutes} min; limite informado: ${limit} min.`, suggestedAction: "Rever alvo, número de séries, tempo ou estrutura da sessão; não reduzir descansos silenciosamente." });
        sessions.push({ id, phaseId: p.id, phaseIndex: phaseIndex + 1, week, day, date: dateAdd(cursor, (week - 1) * 7 + day), slotIndex, templateId: template.id,
          label: template.label, stimulus, items, estimatedMinutes, projected: true });
        trace.push({ sessionId: id, rule: "CATALOG_MATCH_AND_DOSE", inputs: ["student.availableEquipment", "student.excludedExerciseIds", `phases.${p.id}`, "catalog", "policies"], result: `${items.length} exercícios elegíveis; ${stimulus}; ${estimatedMinutes} minutos.` });
      }
    }
    cursor = dateAdd(cursor, p.weeks * 7);
  });
  const volume = volumeFor(sessions, byId);
  for (const exercise of new Map(sessions.flatMap(s => s.items).map(item => [item.exerciseId, byId.get(item.exerciseId)])).values()) {
    if (!exercise) continue;
    if (!defaults[exercise.modality] && !policies.byModality?.[exercise.modality])
      issues.push({ severity: "WARNING", code: "CUSTOM_MODALITY_HEURISTIC", path: `catalog.${exercise.id}`,
        message: `Modalidade ${exercise.modality} sem política específica; dose inicial genérica exige revisão técnica.` });
  }
  for (const p of input.periodization.phases) {
    if (input.scope?.phaseIds && !input.scope.phaseIds.includes(p.id)) continue;
    if (p.strategy === "linear" && !p.linear) issues.push({ severity: "WARNING", code: "LINEAR_RAMP_UNSPECIFIED", path: `phase.${p.id}`, message: "Estratégia linear sem parâmetros de rampa; doses mantidas, progressão de carga permanece condicional." });
    if (!p.volumeTargets) continue;
    for (let week = 1; week <= p.weeks; week++) for (const [muscle, minSets] of Object.entries(p.volumeTargets)) {
      const actual = volume.find(v => v.phaseId === p.id && v.week === week && v.muscle === muscle)?.directSets ?? 0;
      if (actual < minSets) issues.push({ severity: "WARNING", code: "VOLUME_TARGET_BELOW", path: `phase.${p.id}.week.${week}.${muscle}`,
        message: `${muscle}: ${actual} séries diretas vs alvo ${minSets}.`, suggestedAction: "Avaliar redistribuição ou configuração do alvo." });
    }
  }
  // Deduplicate selection-only issues, preserve per-session budget diagnostics.
  const unique = issues.filter((issue, index) => issues.findIndex(x => x.code === issue.code && x.path === issue.path && x.message === issue.message) === index);
  const status = unique.some(i => i.severity === "ERROR") ? "INFEASIBLE" : "SUCCEEDED";
  return {
    engineVersion: ENGINE_VERSION, inputHash: stableHash({ input, engine: ENGINE_VERSION, policy: POLICY_VERSION }), policyVersion: POLICY_VERSION,
    status, validation: status === "INFEASIBLE" ? "BLOCKED" : unique.some(i => i.severity === "WARNING") ? "WARNINGS" : "PASSED",
    requiresProfessionalReview: true,
    sessions, issues: unique, volume, evidence: REFERENCES, decisionTrace: trace,
  };
}

/** Check that applying a proposal cannot silently target the wrong revision. */
export function assertRevisionForApply(baseVersion: number, currentVersion: number, state: string): void {
  if (baseVersion !== currentVersion) throw new Error("409:REVISION_CONFLICT");
  if (state !== "DRAFT") throw new Error("409:IMMUTABLE_REVISION");
}

/** In-memory replacement proposal preserving training-specific dose recomputation. */
export function replaceExercise(input: GenerationInput, result: GenerationResult, sessionId: string, oldId: string, nextId: string): GenerationResult {
  const session = result.sessions.find(s => s.id === sessionId);
  if (!session) throw new Error("SESSION_NOT_FOUND");
  const original = session.items.find(i => i.exerciseId === oldId);
  if (!original) throw new Error("EXERCISE_NOT_FOUND");
  const phase = input.periodization.phases.find(p => p.id === session.phaseId);
  const template = phase?.templates.find(t => t.id === session.templateId);
  const replacement = input.catalog.find(e => e.id === nextId);
  if (!phase || !template || !replacement || !allowed(replacement, input, template)) throw new Error("REPLACEMENT_INELIGIBLE");
  if (session.items.some(i => i.exerciseId === nextId)) throw new Error("REPLACEMENT_DUPLICATE");
  const templateChange = { ...template, lockedExerciseIds: [nextId], exerciseCount: 1 };
  const next = buildItems([replacement], input, phase, templateChange, session.stimulus, session.week)[0];
  if (!next) throw new Error("REPLACEMENT_FAILED");
  const sessions = result.sessions.map(s => s.id === sessionId ? { ...s,
    items: s.items.map(i => i.exerciseId === oldId ? { ...next, order: i.order, origin: "LOCKED" as const } : i),
  } : s).map(s => ({ ...s, estimatedMinutes: durationSession(s.items, new Map(input.catalog.map(e => [e.id, e])), input.policies ?? {}) }));
  const newIssues = [...result.issues.filter(i => !(i.code === "TIME_BUDGET_EXCEEDED" && i.path === `sessions.${sessionId}`)),
    { severity: "INFO" as const, code: "PROFESSIONAL_REPLACEMENT", path: `sessions.${sessionId}`, message: `${oldId} substituído por ${nextId}; dose e duração recalculadas.` }];
  const updated = sessions.find(s => s.id === sessionId);
  const maxMinutes = template.minutes ?? input.student.minutesPerSession;
  if (updated && finite(maxMinutes) && updated.estimatedMinutes > maxMinutes)
    newIssues.push({ severity: "ERROR", code: "TIME_BUDGET_EXCEEDED", path: `sessions.${sessionId}`,
      message: `Sessão após substituição: ${updated.estimatedMinutes} min; limite ${maxMinutes} min.` });
  const hasErrors = newIssues.some(i => i.severity === "ERROR");
  return { ...result, sessions, status: hasErrors ? "INFEASIBLE" : "SUCCEEDED",
    validation: hasErrors ? "BLOCKED" : newIssues.some(i => i.severity === "WARNING") ? "WARNINGS" : "PASSED",
    volume: volumeFor(sessions, new Map(input.catalog.map(e => [e.id, e]))), issues: newIssues,
    decisionTrace: [...result.decisionTrace, { sessionId, rule: "PROFESSIONAL_REPLACEMENT", inputs: [oldId, nextId], result: "Revisão humana: alternativa elegível, parâmetros recalculados, sem herdar carga." }],
  };
}