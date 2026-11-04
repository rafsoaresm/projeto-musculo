/**
 * Caso de regressão "Xintus" (fictício): hipertrofia e tonificação, intermediário, 2 anos de treino, 4 sessões por semana de
 * 60 min, academia completa, 12 semanas em 3 fases, rotação ABAB, Flexiteste com dorsiflexão do tornozelo nível 2 (os demais 3),
 * PAR-Q sem "Sim", sem lesões nem dor. Nomes, ids e números são inventados para teste.
 */
import {
  DEFAULT_RULESET, revalidate, toDisplayFields,
  type CatalogExercise, type CoverageTargets, type Dose, type EngineInput, type EngineResult, type ItemOut, type OccurrenceOut, type RuleSetRef,
} from "@/modules/prescricao/motor";
import { FLEXITEST_CODES, FLEXITEST_LABEL } from "@/modules/avaliacoes/v2/flexitest";
import { CATALOG, FULL_GYM, baseInput, exercise, parameters, structure } from "./motor-fixtures";

export const XINTUS_CATALOG: CatalogExercise[] = [
  ...CATALOG,
  exercise({ id: "ex-legext", name: "Cadeira extensora", primaryMuscles: ["QUADRICEPS"], patterns: ["KNEE_EXTENSION"], equipment: ["MACHINE"], compound: false, difficulty: 1 }),
  exercise({ id: "ex-hipthrust", name: "Elevação de quadril", primaryMuscles: ["GLUTEUS"], patterns: ["HIP_EXTENSION"], equipment: ["BARBELL", "BENCH"], compound: true, difficulty: 2 }),
  exercise({ id: "ex-seatedcurl", name: "Cadeira flexora", primaryMuscles: ["HAMSTRINGS"], patterns: ["KNEE_FLEXION"], equipment: ["MACHINE"], compound: false, difficulty: 1 }),
  exercise({ id: "ex-calf", name: "Panturrilha na máquina", primaryMuscles: ["CALVES"], patterns: ["PLANTAR_FLEXION"], equipment: ["MACHINE"], compound: false, difficulty: 1 }),
  exercise({ id: "ex-lateral", name: "Elevação lateral", primaryMuscles: ["SIDE_DELTOID"], patterns: ["SHOULDER_ABDUCTION"], equipment: ["DUMBBELL"], compound: false, difficulty: 1 }),
  exercise({ id: "ex-facepull", name: "Face pull", primaryMuscles: ["REAR_DELTOID"], patterns: ["HORIZONTAL_ABDUCTION"], equipment: ["CABLE"], compound: false, difficulty: 1 }),
  exercise({ id: "ex-crunch", name: "Abdominal supra", primaryMuscles: ["ABS"], patterns: ["TRUNK_FLEXION"], equipment: [], compound: false, difficulty: 1 }),
  exercise({ id: "ex-hackslide", name: "Agachamento hack", primaryMuscles: ["QUADRICEPS", "GLUTEUS"], patterns: ["SQUAT"], equipment: ["MACHINE"], compound: true, difficulty: 2 }),
];

/** O rótulo como `automatica/facts.ts` o escreve (PR #97): 15 leituras, dorsiflexão 2 e as demais 3. */
export const XINTUS_LEVELS: Record<string, number> = Object.fromEntries(FLEXITEST_CODES.map((c) => [c, c === "ankle_dorsiflexion" ? 2 : 3]));
export const XINTUS_FLEXITEST_LABEL =
  `Flexiteste: ${FLEXITEST_CODES.length} de ${FLEXITEST_CODES.length} movimentos avaliados; ` +
  `${FLEXITEST_CODES.map((c) => `${FLEXITEST_LABEL[c]}: nível ${XINTUS_LEVELS[c]}`).join("; ")}. São observações, não contraindicações automáticas.`;

/** As 15 leituras estruturadas (o motor só as lê com FINDING_OBSERVATION_MAP, 2026.11.4+). */
export const XINTUS_READINGS = FLEXITEST_CODES.map((code) => ({ code, label: FLEXITEST_LABEL[code], level: XINTUS_LEVELS[code] }));

export function xintusInput(rules: RuleSetRef = DEFAULT_RULESET, over: Partial<EngineInput> = {}): EngineInput {
  const phase = {
    weeks: 4, sessionsPerWeek: 4, stimulus: "HYPERTROPHY", rotation: ["A", "B"], trainingDays: [0, 1, 3, 4],
    workouts: [{ label: "A", exerciseTarget: 6 }, { label: "B", exerciseTarget: 6 }],
  };
  return baseInput({
    rules,
    student: {
      level: { value: "Intermediário", source: "PROFILE", basis: "STUDENT_DATA" },
      goal: { value: "Hipertrofia e tonificação", source: "PROFILE", basis: "STUDENT_DATA" },
      sessionMinutes: { value: 60, source: "PROFILE", basis: "STUDENT_DATA" },
      screening: { parq: "CLEAR", professionalDecision: null, medicalClearanceRecorded: false },
      findings: [{ kind: "FLEXIBILITY", code: "FLEXITEST", label: XINTUS_FLEXITEST_LABEL, ref: "assessment:as-xintus", readings: XINTUS_READINGS }],
    },
    structure: structure("2026-11-09", [phase, phase, phase]),
    catalog: XINTUS_CATALOG,
    parameters: parameters({
      availableEquipment: FULL_GYM, availableMinutes: 60,
      progressionByPhase: [{ phaseIndex: 1, progression: { model: "CUSTOM", weekOverrides: [{ week: 1, patch: { values: { sets: 2 } } }, { week: 2, patch: { values: { sets: 2 } } }] } }],
    }),
    ...over,
  });
}

/** O plano anterior do Xintus: A e B fixos, toda dose 8–12 / RIR 1–3 / 90 s, 2 séries nas semanas 1–2 da fase 1 e 3 depois. */
export const XINTUS_PREVIOUS_PLAN: Record<string, string[]> = {
  A: ["ex-squat", "ex-legpress", "ex-legext", "ex-bench", "ex-dbpress", "ex-ohp"],
  B: ["ex-rdl", "ex-row", "ex-pulldown", "ex-curl", "ex-triceps", "ex-plank"],
};

export interface PlanItemSeed {
  exerciseId: string | null;
  name?: string;
  dose: Dose | null;
  /** Base dos parâmetros da dose: política padrão (HEURISTIC, DOSE_DEFAULTS) ou decisão do profissional. */
  doseBasis?: "POLICY" | "PROFESSIONAL";
  origin?: ItemOut["origin"];
}

export function repsDose(sets: number, over: Partial<Extract<Dose, { metric: "REPS" }>> = {}): Dose {
  return { metric: "REPS", sets, reps: { min: 8, max: 12 }, intensity: { kind: "RIR", range: { min: 1, max: 3 } }, restSeconds: 90, loadBasis: "TOTAL", loadKg: null, ...over };
}

function paramsOf(dose: Dose | null, basis: "POLICY" | "PROFESSIONAL"): ItemOut["trace"]["params"] {
  if (!dose) return [];
  const b = basis === "POLICY" ? { basis: "HEURISTIC" as const, ruleId: "DOSE_DEFAULTS" } : { basis: "PROFESSIONAL" as const };
  const names = dose.metric === "REPS" ? ["sets", "repsMin", "repsMax", "restSeconds", "rirMin", "rirMax"] : dose.metric === "TIME" ? ["sets", "durationMin", "durationMax", "restSeconds"] : ["sets"];
  return names.map((param) => ({ param, value: null, ...b }));
}

/**
 * Um resultado montado à mão a partir de um plano (exercícios e doses por ocorrência) e revalidado pelo motor, que calcula
 * duração, volume e, nas regras com auditoria, a auditoria. `items(occ)` devolve os itens de cada sessão da estrutura.
 */
export function resultFrom(
  input: EngineInput,
  items: (occ: { phaseIndex: number; week: number; slot: number; label: string }) => PlanItemSeed[],
  coverage: (phaseIndex: number, label: string) => CoverageTargets | null = () => null,
): EngineResult {
  const byId = new Map(input.catalog.map((e) => [e.id, e]));
  const occurrences: OccurrenceOut[] = [];
  for (const phase of input.structure.phases)
    for (const o of [...phase.occurrences].sort((a, b) => a.week - b.week || a.slot - b.slot)) {
      const seeds = items({ phaseIndex: phase.index, week: o.week, slot: o.slot, label: o.label });
      const counts = new Map<string, number>();
      occurrences.push({
        phaseIndex: phase.index, week: o.week, slot: o.slot, label: o.label, plannedDate: o.plannedDate, weekStart: o.weekStart,
        stimulus: phase.stimulus ?? null,
        items: seeds.map((s, i): ItemOut => {
          const e = s.exerciseId ? byId.get(s.exerciseId) : undefined;
          const ref = s.exerciseId ?? `custom:${s.name ?? "x"}`;
          const k = counts.get(ref) ?? 0;
          counts.set(ref, k + 1);
          return {
            slotKey: `${phase.index}|${o.label}|${ref}|${k}`, position: i + 1, exerciseId: s.exerciseId, exerciseName: s.name ?? e?.name ?? "Exercício",
            modality: e?.modality ?? null, dose: s.dose, display: toDisplayFields(s.dose), origin: s.origin ?? "ENGINE",
            existingPrescribedExerciseId: null, substitutesSlotKey: null, alternatives: [], metadata: e ? "REVIEWED" : "NOT_APPLICABLE",
            trace: { selection: [], params: paramsOf(s.dose, s.doseBasis ?? "POLICY") },
          };
        }),
        estimatedMinutes: null, durationComplete: false, budgetMinutes: null, budgetSource: null,
      });
    }
  const raw: EngineResult = {
    engineVersion: "test", rules: input.rules, vocabularyVersion: "test", status: "SUCCEEDED", validation: "PASSED", requiresProfessionalReview: true,
    phases: input.structure.phases.map((p) => ({ phaseIndex: p.index, name: p.name, weeks: p.weeks, sessionsPerWeek: p.sessionsPerWeek, progression: null })),
    workouts: input.structure.phases.flatMap((p) => p.workouts.map((w) => ({
      phaseIndex: p.index, label: w.label, name: w.name, stimulus: p.stimulus ?? null, modalities: { value: ["RESISTANCE"], source: "RULES" as const, basis: "HEURISTIC" as const },
      count: null, coverage: coverage(p.index, w.label), eligible: 0, excluded: {},
    }))),
    occurrences, issues: [], assumptions: [], flags: [], volume: [], historySuggestions: [], rulesUsed: [],
  };
  return revalidate(input, raw);
}

/** Dose do plano anterior: 2 séries nas semanas 1–2 da fase 1, 3 depois; a prancha é por tempo. */
export function xintusPreviousDose(exerciseId: string, phaseIndex: number, week: number): Dose {
  const sets = phaseIndex === 1 && week <= 2 ? 2 : 3;
  if (exerciseId === "ex-plank") return { metric: "TIME", sets, durationSeconds: { min: 30, max: 45 }, restSeconds: 60 };
  return repsDose(sets);
}

export function xintusPreviousResult(rules: RuleSetRef = DEFAULT_RULESET, over: Partial<EngineInput> = {}): EngineResult {
  const input = xintusInput(rules, over);
  return resultFrom(input, (o) => XINTUS_PREVIOUS_PLAN[o.label].map((id) => ({ exerciseId: id, dose: xintusPreviousDose(id, o.phaseIndex, o.week) })));
}
