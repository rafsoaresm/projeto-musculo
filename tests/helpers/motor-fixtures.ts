import {
  DEFAULT_RULESET,
  scheduleOccurrences,
  type CatalogExercise,
  type EngineInput,
  type GenerationParameters,
  type StructurePhase,
  type StructureWorkout,
} from "@/modules/prescricao/motor";

type ExerciseSeed = Partial<CatalogExercise> & Pick<CatalogExercise, "id" | "name">;

export function exercise(seed: ExerciseSeed): CatalogExercise {
  return {
    category: null, modality: "RESISTANCE", metric: "REPS", primaryMuscles: [], secondaryMuscles: [], patterns: [],
    equipment: [], equipmentAlternatives: [], difficulty: null, laterality: "BILATERAL", compound: null, secondsPerRep: null,
    cautionTags: [], substitutes: [], metadataStatus: "REVIEWED", archived: false,
    ...seed,
  };
}

/** Biblioteca fictícia com metadados revisados (nomes e ids inventados para teste). */
export const CATALOG: CatalogExercise[] = [
  exercise({ id: "ex-squat", name: "Agachamento livre", primaryMuscles: ["QUADRICEPS", "GLUTEUS"], secondaryMuscles: ["ADDUCTORS"], patterns: ["SQUAT"], equipment: ["BARBELL", "RACK"], compound: true, difficulty: 3, substitutes: ["ex-legpress"] }),
  exercise({ id: "ex-legpress", name: "Leg press", primaryMuscles: ["QUADRICEPS", "GLUTEUS"], patterns: ["SQUAT"], equipment: ["MACHINE"], compound: true, difficulty: 1 }),
  exercise({ id: "ex-goblet", name: "Agachamento goblet", primaryMuscles: ["QUADRICEPS"], patterns: ["SQUAT"], equipment: ["DUMBBELL"], compound: true, difficulty: 2 }),
  exercise({ id: "ex-airsquat", name: "Agachamento sem carga", primaryMuscles: ["QUADRICEPS"], patterns: ["SQUAT"], equipment: [], compound: true, difficulty: 1 }),
  exercise({ id: "ex-rdl", name: "Levantamento romeno", primaryMuscles: ["HAMSTRINGS", "GLUTEUS"], secondaryMuscles: ["ERECTORS"], patterns: ["HINGE"], equipment: ["BARBELL"], equipmentAlternatives: [["DUMBBELL"]], compound: true, difficulty: 3 }),
  exercise({ id: "ex-legcurl", name: "Mesa flexora", primaryMuscles: ["HAMSTRINGS"], patterns: ["KNEE_FLEXION"], equipment: ["MACHINE"], compound: false, difficulty: 1 }),
  exercise({ id: "ex-lunge", name: "Afundo", primaryMuscles: ["QUADRICEPS", "GLUTEUS"], patterns: ["LUNGE"], equipment: [], laterality: "UNILATERAL", compound: true, difficulty: 2 }),
  exercise({ id: "ex-bench", name: "Supino reto", primaryMuscles: ["CHEST"], secondaryMuscles: ["TRICEPS", "FRONT_DELTOID"], patterns: ["HORIZONTAL_PUSH"], equipment: ["BARBELL", "BENCH"], compound: true, difficulty: 2, substitutes: ["ex-pushup"] }),
  exercise({ id: "ex-pushup", name: "Flexão de braços", primaryMuscles: ["CHEST"], secondaryMuscles: ["TRICEPS"], patterns: ["HORIZONTAL_PUSH"], equipment: [], compound: true, difficulty: 2 }),
  exercise({ id: "ex-dbpress", name: "Supino com halteres", primaryMuscles: ["CHEST"], secondaryMuscles: ["TRICEPS"], patterns: ["HORIZONTAL_PUSH"], equipment: ["DUMBBELL", "BENCH"], compound: true, difficulty: 2 }),
  exercise({ id: "ex-row", name: "Remada curvada", primaryMuscles: ["UPPER_BACK", "LATS"], secondaryMuscles: ["BICEPS"], patterns: ["HORIZONTAL_PULL"], equipment: ["BARBELL"], compound: true, difficulty: 3 }),
  exercise({ id: "ex-cablerow", name: "Remada baixa", primaryMuscles: ["UPPER_BACK"], secondaryMuscles: ["BICEPS"], patterns: ["HORIZONTAL_PULL"], equipment: ["CABLE"], compound: true, difficulty: 1 }),
  exercise({ id: "ex-pulldown", name: "Puxada frontal", primaryMuscles: ["LATS"], secondaryMuscles: ["BICEPS"], patterns: ["VERTICAL_PULL"], equipment: ["CABLE"], compound: true, difficulty: 1 }),
  exercise({ id: "ex-ohp", name: "Desenvolvimento", primaryMuscles: ["FRONT_DELTOID"], secondaryMuscles: ["TRICEPS"], patterns: ["VERTICAL_PUSH"], equipment: ["DUMBBELL"], compound: true, difficulty: 2 }),
  exercise({ id: "ex-curl", name: "Rosca direta", primaryMuscles: ["BICEPS"], patterns: ["ELBOW_FLEXION"], equipment: ["DUMBBELL"], compound: false, difficulty: 1 }),
  exercise({ id: "ex-triceps", name: "Tríceps na polia", primaryMuscles: ["TRICEPS"], patterns: ["ELBOW_EXTENSION"], equipment: ["CABLE"], compound: false, difficulty: 1 }),
  exercise({ id: "ex-plank", name: "Prancha", metric: "TIME", primaryMuscles: ["ABS"], patterns: ["ANTI_EXTENSION"], equipment: [], compound: false, difficulty: 1 }),
  exercise({ id: "ex-sled", name: "Empurrar trenó", metric: "DISTANCE", primaryMuscles: ["QUADRICEPS"], patterns: ["SQUAT"], equipment: ["SLED"], compound: true, difficulty: 2 }),
  exercise({ id: "ex-bike", name: "Bicicleta ergométrica", modality: "CARDIO", metric: "CONTINUOUS", primaryMuscles: [], patterns: ["CYCLICAL"], equipment: ["BIKE"] }),
  exercise({ id: "ex-run-int", name: "Corrida intervalada", modality: "CARDIO", metric: "INTERVALS", patterns: ["CYCLICAL"], equipment: [] }),
  exercise({ id: "ex-walk", name: "Caminhada", modality: "CARDIO", metric: "CONTINUOUS", patterns: ["CYCLICAL"], equipment: [] }),
  exercise({ id: "ex-hipmob", name: "Mobilidade de quadril", modality: "MOBILITY", metric: "TIME", patterns: ["MOBILITY"], equipment: [] }),
  exercise({ id: "ex-tspine", name: "Mobilidade torácica", modality: "MOBILITY", metric: "REPS", patterns: ["MOBILITY"], equipment: [] }),
];

export const FULL_GYM = ["BARBELL", "RACK", "MACHINE", "DUMBBELL", "BENCH", "CABLE", "BIKE", "SLED"];

export interface PhaseSeed {
  weeks: number;
  sessionsPerWeek: number;
  workouts: Array<Partial<StructureWorkout> & { label: string }>;
  rotation?: string[];
  trainingDays?: number[] | null;
  stimulus?: string;
  name?: string;
}

export function structure(startDate: string, phases: PhaseSeed[]): EngineInput["structure"] {
  const occ = scheduleOccurrences(startDate, phases.map((p) => ({
    weeks: p.weeks, sessionsPerWeek: p.sessionsPerWeek, rotation: p.rotation ?? p.workouts.map((w) => w.label), trainingDays: p.trainingDays ?? null,
  })));
  return {
    startDate,
    phases: phases.map((p, i): StructurePhase => ({
      index: i + 1, name: p.name ?? `Fase ${i + 1}`, weeks: p.weeks, sessionsPerWeek: p.sessionsPerWeek,
      workouts: p.workouts.map((w) => ({ name: null, exerciseTarget: 4, focus: {}, ...w })),
      occurrences: occ[i],
      ...(p.stimulus ? { stimulus: { value: p.stimulus, source: "STRUCTURE" as const, basis: "PROFESSIONAL" as const } } : {}),
    })),
  };
}

export function parameters(over: Partial<GenerationParameters> = {}): GenerationParameters {
  return {
    doseMode: "FILL_FROM_POLICY", metadataTrust: "REVIEWED_AND_INFERRED", stimulusByPhase: [], modalitiesByWorkout: [],
    availableEquipment: FULL_GYM, availableMinutes: 90, timeBudget: "SOFT", exerciseCountByWorkout: [], preferredExerciseIds: [],
    excludedExerciseIds: [], excludedPatterns: [], excludedCautionTags: [], phaseCoverage: [], progressionByPhase: [], doseOverrides: [],
    metricOverrides: [], acceptedFlagDecisions: [],
    ...over,
  };
}

/** Periodização padrão: 2 fases (hipertrofia 4 semanas ABC 3x; força 3 semanas AB 2x). */
export function baseInput(over: Partial<EngineInput> = {}): EngineInput {
  return {
    rules: DEFAULT_RULESET,
    asOf: "2026-11-04",
    parameters: parameters(),
    student: {
      level: { value: "Intermediário", source: "PROFILE", basis: "STUDENT_DATA" },
      goal: { value: "Hipertrofia e saúde", source: "PROFILE", basis: "STUDENT_DATA" },
      sessionMinutes: { value: 60, source: "PROFILE", basis: "STUDENT_DATA" },
      screening: { parq: "CLEAR", professionalDecision: null, medicalClearanceRecorded: false },
      findings: [],
    },
    structure: structure("2026-11-09", [
      {
        weeks: 4, sessionsPerWeek: 3, stimulus: "HYPERTROPHY", trainingDays: [0, 2, 4],
        workouts: [
          { label: "A", name: "Inferiores", focus: { muscles: ["QUADRICEPS", "HAMSTRINGS", "GLUTEUS"] } },
          { label: "B", name: "Empurrar", focus: { muscles: ["CHEST", "FRONT_DELTOID", "TRICEPS"] } },
          { label: "C", name: "Puxar", focus: { muscles: ["UPPER_BACK", "LATS", "BICEPS"] } },
        ],
      },
      {
        weeks: 3, sessionsPerWeek: 2, stimulus: "STRENGTH", trainingDays: [1, 4],
        workouts: [
          { label: "A", exerciseTarget: 3, focus: { patterns: ["SQUAT", "HINGE", "HORIZONTAL_PUSH"] } },
          { label: "B", exerciseTarget: 3, focus: { patterns: ["HORIZONTAL_PULL", "VERTICAL_PUSH", "VERTICAL_PULL"] } },
        ],
      },
    ]),
    catalog: CATALOG,
    history: [],
    existing: [],
    locked: [],
    scope: { kind: "FULL" },
    ...over,
  };
}

export const codes = (r: { issues: Array<{ code: string }> }) => r.issues.map((i) => i.code);

/** Versão anterior à auditoria: testes que fixam detalhes da seleção ou do resultado da 2026.11.2 usam esta versão explicitamente. */
export const LEGACY_RULES = { id: "gymgital-base", version: "2026.11.2" } as const;
