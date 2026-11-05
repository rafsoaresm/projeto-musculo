/**
 * The `mock` provider (design V4 §3.2): deterministic, no network, no key. Used by tests, e2e and dev ONLY when `AI_MOCK_ENABLED=true`
 * (never stored in `ai_provider_connections`, never in production config). It reads the coded context from the request, builds a valid
 * `PlannerResponse` with a small self-contained producer (the rules-mode producer of sub-stage 1.3 will be able to replace it) and
 * returns an ESTIMATED usage. Behaviour switches by `modelId`:
 *
 *   mock-ok (default) · mock-ul · mock-fb · mock-schedule · mock-slow (400 ms) · mock-timeout (never answers before the timeout)
 *   mock-invalid-json · mock-truncated · mock-quota · mock-500 · mock-hostile (an answer the validator must refuse whole)
 */
import type { TrainingPlanningContext } from "../context-types";
import type { PlannerResponse } from "../blueprint";
import { estimateTokens } from "../quota";
import { ROLE_FOCUS_INTERIM_TABLE } from "../role-focus";
import { isNonVolumeRole, type SplitFamily, type WorkoutRole } from "../vocab";
import { verifyIssued } from "../privacy";
import type { CallSettings, ListModelsResult, PlannerProvider, ProviderErrorCode, ProviderResult, SafeProviderRequest, Usage } from "./port";

export const MOCK_MODELS = [
  "mock-ok", "mock-ul", "mock-fb", "mock-schedule", "mock-slow", "mock-timeout", "mock-invalid-json", "mock-truncated", "mock-quota", "mock-500", "mock-hostile",
] as const;

type Phase = TrainingPlanningContext["periodization"]["phases"][number];
type Strategy = PlannerResponse["strategies"][number];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const nonVolumeRole = (modalities: string[] | null): WorkoutRole =>
  modalities?.includes("CARDIO") ? "CARDIO" : modalities?.includes("MOBILITY") ? "MOBILITY" : modalities?.includes("BALANCE") ? "BALANCE" : "SKILL";
const isVolume = (modalities: string[] | null): boolean => modalities === null || modalities.includes("RESISTANCE");

function rolesFor(phase: Phase, family: SplitFamily): Map<string, WorkoutRole> {
  const roles = new Map<string, WorkoutRole>();
  let volumeIndex = 0;
  const cycle: Partial<Record<SplitFamily, WorkoutRole[]>> = {
    UPPER_LOWER: ["UPPER", "LOWER"],
    PUSH_PULL_LEGS: ["PUSH", "PULL", "LEGS"],
    BODY_PART: ["CHEST_TRICEPS", "BACK_BICEPS", "LEGS", "SHOULDERS_ARMS", "LEGS"],
  };
  for (const w of phase.workouts) {
    if (!isVolume(w.modalities)) {
      roles.set(w.alias, nonVolumeRole(w.modalities));
      continue;
    }
    const list = cycle[family];
    roles.set(w.alias, list ? list[volumeIndex % list.length] : "FULL_BODY");
    volumeIndex += 1;
  }
  return roles;
}

function candidatesFor(context: TrainingPlanningContext, role: WorkoutRole): string[] {
  if (isNonVolumeRole(role)) return [];
  const focus = ROLE_FOCUS_INTERIM_TABLE[role];
  return context.library.candidates
    .filter((c) => (c.modality === null || c.modality === "RESISTANCE") && (c.primaryMuscles.some((m) => focus.dominantMuscles.includes(m)) || c.patterns.some((p) => focus.targetPatterns.includes(p))))
    .slice(0, 6)
    .map((c) => c.alias);
}

function strategyOf(context: TrainingPlanningContext, id: "S1" | "S2" | "S3", family: SplitFamily, recommended: boolean): Strategy {
  const phases = context.periodization.phases;
  return {
    strategyId: id,
    splitFamily: family,
    explanation: "Sugestão simulada para testes, gerada sem modelo real.",
    tradeoffs: [],
    confidence: "LOW",
    evidenceRefs: [],
    phases: phases.map((phase, i) => {
      const earlier = phases.findIndex((p, j) => j < i && p.workouts.map((w) => w.alias).join(",") === phase.workouts.map((w) => w.alias).join(","));
      if (earlier >= 0) return { phase: phase.index, splitType: family, sameAsPhase: phases[earlier].index, workouts: [] };
      const roles = rolesFor(phase, family);
      return {
        phase: phase.index,
        splitType: family,
        sameAsPhase: null,
        workouts: phase.workouts.map((w) => {
          const role = roles.get(w.alias) as WorkoutRole;
          return { workout: w.alias, role, delta: null, candidateAliases: recommended ? candidatesFor(context, role) : [] };
        }),
      };
    }),
    dosingIntent: [],
    progressionIntent: [],
  };
}

/** The deterministic mock plan for a context. Exported for tests. */
export function mockPlan(context: TrainingPlanningContext, model: string): PlannerResponse {
  const first = context.periodization.phases[0];
  const volume = first ? first.workouts.filter((w) => isVolume(w.modalities)).length : 0;
  const upperLower = volume >= 2 && volume % 2 === 0;
  const family: SplitFamily = model === "mock-fb" ? "FULL_BODY" : model === "mock-ul" ? "UPPER_LOWER" : model === "mock-schedule" ? "PUSH_PULL_LEGS" : upperLower ? "UPPER_LOWER" : "FULL_BODY";
  const strategies: Strategy[] = [strategyOf(context, "S1", family, true)];
  if (family !== "FULL_BODY") strategies.push(strategyOf(context, "S2", "FULL_BODY", false));
  return {
    schemaVersion: 1,
    global: {
      goalCodes: context.student.goalCodes.filter((g) => /^[A-Z_]{3,30}$/.test(g)).slice(0, 3),
      rationale: "Resposta simulada e determinística, usada apenas em testes.",
      assumptions: [],
      uncertainties: [],
      questionsForProfessional: [],
      keyTradeoffs: [],
    },
    recommendedStrategyId: "S1",
    strategies,
  };
}

/** What the validator must refuse whole: an alias outside the shortlist, a dose in prose and a link. */
function hostilePlan(context: TrainingPlanningContext): PlannerResponse {
  const plan = mockPlan(context, "mock-ok");
  const s1 = plan.strategies[0];
  const firstPhase = s1.phases.find((p) => p.workouts.length > 0);
  if (firstPhase) firstPhase.workouts[0] = { ...firstPhase.workouts[0], candidateAliases: ["X999"] };
  s1.explanation = "Faça 3x10 e veja https://exemplo.test para mais.";
  return plan;
}

const estimateUsage = (req: SafeProviderRequest, outputChars: number): Usage => ({
  inputTokens: estimateTokens(req.system.length + req.user.length),
  outputTokens: estimateTokens(outputChars),
  cachedInputTokens: null,
  source: "ESTIMATE",
});
const fail = (code: ProviderErrorCode, latencyMs: number, usage: Usage | null, httpStatus: number | null = null, retryable = false): ProviderResult => ({
  ok: false, code, httpStatus, retryable, retryAfterMs: null, usage, latencyMs,
});

export const mockProvider: PlannerProvider = {
  kind: "mock",

  async call(req: SafeProviderRequest, settings: CallSettings): Promise<ProviderResult> {
    if (settings.kind !== "mock" || !(await verifyIssued(req, "mock"))) return fail("BAD_REQUEST", 0, null);
    const model = settings.modelId;
    if (model === "mock-timeout") {
      await sleep(Math.max(1, settings.timeoutMs));
      return fail("TIMEOUT", settings.timeoutMs, null);
    }
    if (model === "mock-slow") await sleep(400);
    const usage = estimateUsage(req, 0);
    if (model === "mock-500") return fail("SERVER_ERROR", 1, null, 500, true);
    if (model === "mock-quota") return fail("PROVIDER_QUOTA", 1, null, 402);
    if (model === "mock-invalid-json") return fail("INVALID_JSON", 1, { ...usage, outputTokens: 10 }, 200);
    if (model === "mock-truncated") return fail("TRUNCATED", 1, { ...usage, outputTokens: settings.maxOutputTokens }, 200);
    let context: TrainingPlanningContext | null = null;
    try {
      context = (JSON.parse(req.user) as { context?: TrainingPlanningContext }).context ?? null;
    } catch {
      context = null;
    }
    if (!context) return fail("INVALID_JSON", 1, usage, 200);
    const json = model === "mock-hostile" ? hostilePlan(context) : mockPlan(context, model);
    return { ok: true, json, usage: estimateUsage(req, JSON.stringify(json).length), latencyMs: model === "mock-slow" ? 400 : 1, providerRequestId: null, finish: "STOP" };
  },

  async listModels(): Promise<ListModelsResult> {
    return { ok: true, models: MOCK_MODELS.map((id) => ({ id, label: null })) };
  },
};
