/**
 * Fixtures of the V4 planner (design V4 §8): the Xintus planning context and the canary student, built from a hand-made
 * `GenerationContext` (what `loadGenerationContext` returns), so the pure tests need no database. Names, ids and numbers are fictitious.
 */
import { emptyProfile } from "@/modules/ficha/contracts";
import { PARQ_CODES, readScreening } from "@/modules/avaliacoes/v2/screening";
import { readMovement } from "@/modules/avaliacoes/v2/flexitest";
import { parseGenerationAnswers, type GenerationAnswersInput } from "@/modules/prescricao/automatica/contracts";
import type { AssessmentRecord, GenerationContext } from "@/modules/prescricao/automatica/facts";
import { buildPlanningContext, type PlanningContextOptions } from "@/modules/prescricao/planejador/context";
import type { PlanningContextBundle } from "@/modules/prescricao/planejador/context-types";
import type { PlannerResponse } from "@/modules/prescricao/planejador/blueprint";
import type { CatalogExercise } from "@/modules/prescricao/motor/types";
import { buildPeriodization } from "@/modules/training/periodization";
import { exercise, FULL_GYM } from "./motor-fixtures";
import { XINTUS_CATALOG, XINTUS_LEVELS } from "./xintus";

export const ASOF = "2026-11-05";

export interface PhaseSeedV2 {
  name?: string;
  weeks: number;
  sessionsPerWeek: number;
  workouts: Array<{ label: string; name?: string | null; exerciseTarget?: number | null; focus?: { muscles?: string[]; patterns?: string[]; minutes?: number } }>;
  rotation?: string[];
  trainingDays?: number[];
}

export function scheduleOf(phases: PhaseSeedV2[], startDate = "2026-11-09") {
  return buildPeriodization({
    schemaVersion: 2, startDate,
    phases: phases.map((p, i) => ({
      name: p.name ?? `Fase ${i + 1}`, weeks: p.weeks, sessionsPerWeek: p.sessionsPerWeek,
      workouts: p.workouts.map((w) => ({ exerciseTarget: 6, ...w })),
      ...(p.rotation ? { rotation: p.rotation } : {}),
      ...(p.trainingDays ? { trainingDays: p.trainingDays } : {}),
    })),
  });
}

const allNo = () => readScreening({ parq: { answers: Object.fromEntries(PARQ_CODES.map((c) => [c, "no"])), professionalReview: { decision: null } } });

export function assessmentOf(over: Partial<AssessmentRecord> = {}): AssessmentRecord {
  return {
    id: "as-xintus", assessedOn: "2026-10-20", recordedAt: "2026-10-20T12:00:00Z", formatVersion: 2,
    standing: { risk: "CLEAR", reviewed: false, reviewedAt: null } as unknown as AssessmentRecord["standing"],
    legacy: null, profile: null, screening: allNo(), posture: null,
    movement: readMovement({ flexitest: { levels: XINTUS_LEVELS } }), tests: null, conclusion: null, results: [],
    ...over,
  };
}

const XINTUS_PHASE: PhaseSeedV2 = {
  weeks: 4, sessionsPerWeek: 4, trainingDays: [0, 1, 3, 4],
  workouts: [{ label: "A", exerciseTarget: 6 }, { label: "B", exerciseTarget: 6 }],
};

export function generationContext(over: Partial<GenerationContext> = {}): GenerationContext {
  return {
    asOf: ASOF,
    plan: { id: "plan-xintus-1", studentId: "stu-xintus-1", title: "Plano Xintus" },
    revision: {
      id: "rev-xintus-1", state: "DRAFT", contentVersion: 3, prescriptionModel: "MESOCYCLE",
      schedule: scheduleOf([XINTUS_PHASE, XINTUS_PHASE, XINTUS_PHASE]),
    },
    profile: {
      ...emptyProfile, studentId: "stu-xintus-1", updatedAt: "2026-10-20T12:00:00Z",
      goal: "Hipertrofia", level: "Intermediário", daysPerWeek: 4, sessionMinutes: 60,
      birthDate: "1994-06-02", gender: "Masculino", heightCm: 178, weightKg: 82,
    },
    assessment: assessmentOf(),
    catalog: XINTUS_CATALOG,
    catalogHash: "c".repeat(64),
    cautionTagsUnknown: [],
    history: {
      window: { since: "2026-05-09", until: ASOF, sinceDays: 180, sessions: 0, truncated: false },
      summary: { logs: [], exercises: [], customSkipped: 0, notDone: 0, sessionsWithEffort: 0 },
    },
    existing: [],
    ...over,
  };
}

export const XINTUS_ANSWERS: GenerationAnswersInput = {
  stimulusByPhase: [1, 2, 3].map((phaseIndex) => ({ phaseIndex, value: "HYPERTROPHY", basis: "PROFESSIONAL" as const })),
  equipmentCodes: FULL_GYM,
};

export const planOptions = (over: Partial<PlanningContextOptions> = {}, answers: GenerationAnswersInput = XINTUS_ANSWERS): PlanningContextOptions => ({
  organizationId: "org-xintus-1", answers: parseGenerationAnswers(answers), ...over,
});

export async function xintusBundle(ctxOver: Partial<GenerationContext> = {}, over: Partial<PlanningContextOptions> = {}, answers?: GenerationAnswersInput): Promise<PlanningContextBundle> {
  const out = await buildPlanningContext(generationContext(ctxOver), planOptions(over, answers));
  if (!out.ok) throw new Error(`bundle: ${out.code}`);
  return out.bundle;
}

// ---------- the canary student (design §8): every identifying value is searchable ----------

export const CANARY = {
  name: "Zélia Quintanilha Braga",
  email: "zelia.quintanilha@exemplo.test",
  phone: "+55 11 98888-7766",
  cpf: "123.456.789-09",
  birthDate: "1991-03-14",
  planTitle: "Plano da Zélia — hipertrofia",
  labels: ["Superior Zélia", "B"],
  exerciseName: "Remada da Zélia",
  address: "mora na rua das Acácias, 45",
  pain: "dor no ombro esquerdo desde março",
};

export function canaryContext(): GenerationContext {
  const base = generationContext();
  const phase: PhaseSeedV2 = {
    weeks: 4, sessionsPerWeek: 4, name: "Base Zélia", trainingDays: [0, 1, 3, 4],
    workouts: [{ label: CANARY.labels[0], name: "Treino da Zélia" }, { label: CANARY.labels[1] }],
  };
  const catalog: CatalogExercise[] = [
    ...XINTUS_CATALOG,
    exercise({ id: "ex-zelia-own-1", name: CANARY.exerciseName, primaryMuscles: ["LATS"], patterns: ["VERTICAL_PULL"], equipment: ["CABLE"], compound: true, difficulty: 1 }),
  ];
  return {
    ...base,
    plan: { id: "plan-zelia-uuid-1", studentId: "stu-zelia-uuid-1", title: CANARY.planTitle },
    revision: { ...base.revision, id: "rev-zelia-uuid-1", schedule: scheduleOf([phase, phase]) },
    profile: {
      ...emptyProfile, studentId: "stu-zelia-uuid-1", updatedAt: "2026-10-20T12:00:00Z",
      email: CANARY.email, phone: CANARY.phone, birthDate: CANARY.birthDate, goal: "Hipertrofia", level: "Intermediário",
      daysPerWeek: 4, sessionMinutes: 62, location: CANARY.address, injuries: CANARY.pain, professionalNotes: `CPF ${CANARY.cpf}`,
      gender: "Feminino", heightCm: 165, weightKg: 61,
    },
    catalog,
  };
}

export const CANARY_ANSWERS: GenerationAnswersInput = {
  stimulusByPhase: [1, 2].map((phaseIndex) => ({ phaseIndex, value: "HYPERTROPHY", basis: "PROFESSIONAL" as const })),
  equipmentCodes: FULL_GYM,
};

export async function canaryBundle(): Promise<PlanningContextBundle> {
  const out = await buildPlanningContext(canaryContext(), planOptions({ identifiers: [CANARY.name, "Clínica Acácia Ltda"], organizationId: "org-canary-uuid-1" }, CANARY_ANSWERS));
  if (!out.ok) throw new Error(`bundle: ${out.code}`);
  return out.bundle;
}

// ---------- wire responses ----------

type Strategy = PlannerResponse["strategies"][number];
const GLOBAL: PlannerResponse["global"] = {
  goalCodes: ["HYPERTROPHY"], rationale: "Quatro sessões por semana permitem separar superior e inferior.",
  assumptions: ["Equipamento completo informado pelo profissional."], uncertainties: [], questionsForProfessional: [], keyTradeoffs: [],
};

/** A valid UPPER_LOWER recommendation over the Xintus structure: phases 2 and 3 repeat phase 1. */
export function upperLowerResponse(over: { candidates?: string[] } = {}): PlannerResponse {
  const s1: Strategy = {
    strategyId: "S1", splitFamily: "UPPER_LOWER", explanation: "Superior e inferior em dias alternados.", tradeoffs: ["Cada grupo é treinado duas vezes por semana."],
    confidence: "MEDIUM", evidenceRefs: ["S.days", "S.minutes"],
    phases: [
      { phase: 1, splitType: "UPPER_LOWER", sameAsPhase: null, workouts: [
        { workout: "T1", role: "UPPER", delta: null, candidateAliases: over.candidates ?? ["X2"] },
        { workout: "T2", role: "LOWER", delta: null, candidateAliases: [] },
      ] },
      { phase: 2, splitType: "UPPER_LOWER", sameAsPhase: 1, workouts: [] },
      { phase: 3, splitType: "UPPER_LOWER", sameAsPhase: 1, workouts: [] },
    ],
    dosingIntent: [{ exerciseClass: "COMPOUND_LOWER", profileCode: "COMPOUND_HEAVY" }],
    progressionIntent: [{ phase: 1, intent: "VOLUME_RAMP" }],
  };
  const s2: Strategy = {
    strategyId: "S2", splitFamily: "FULL_BODY", explanation: "Corpo inteiro em todas as sessões.", tradeoffs: [], confidence: "LOW", evidenceRefs: [],
    phases: [1, 2, 3].map((phase) => ({ phase, splitType: "FULL_BODY" as const, sameAsPhase: null, workouts: [
      { workout: "T1", role: "FULL_BODY" as const, delta: null, candidateAliases: [] }, { workout: "T2", role: "FULL_BODY" as const, delta: null, candidateAliases: [] },
    ] })),
    dosingIntent: [], progressionIntent: [],
  };
  return { schemaVersion: 1, global: GLOBAL, recommendedStrategyId: "S1", strategies: [s1, s2] };
}
