/**
 * Client-safe projection of a stored blueprint (design V4 §3.10 `StrategyListView`): real labels, fixed display names, no hashes
 * except the run id, no provider, model, key or cost. A professional sees only `producer: "AI" | "RULES"`. Pure.
 */
import type { StoredWorkout, TrainingBlueprint } from "./blueprint";

export interface StrategyWorkoutView {
  label: string;
  role: StoredWorkout["role"];
  source: StoredWorkout["source"];
  focusDelta: StoredWorkout["focusDelta"];
  candidateExerciseIds: string[];
}
export interface StrategyView {
  strategyId: "S1" | "S2" | "S3";
  splitFamily: string;
  displayName: string;
  recommended: boolean;
  explanation: string;
  tradeoffs: string[];
  /** True when the saved labels, rotation or frequency cannot carry it: informational only, it cannot be accepted. */
  requiresScheduleChange: boolean;
  /** Offered for acceptance (PR 2): the opposite of `requiresScheduleChange`. */
  acceptable: boolean;
  supportedByContext: "YES" | "PARTIAL" | "NO";
  confidence: "LOW" | "MEDIUM" | "HIGH";
  evidenceRefs: string[];
  provenance: "AI_SUGGESTED" | "RULES_HEURISTIC";
  phases: Array<{ phaseIndex: number; splitType: string; workouts: StrategyWorkoutView[] }>;
  dosingIntent: Array<{ exerciseClass: string; profileCode: string }>;
  progressionIntent: Array<{ phaseIndex: number; intent: string }>;
}
export interface StrategyListView {
  runId: string;
  producer: "AI" | "RULES";
  /** "Sugestão da IA" or "Heurística operacional (editável)": rules mode is never presented as AI. */
  label: string;
  /** The revision content version the suggestion was made for; a different current version means the prescription changed since. */
  baseContentVersion: number;
  global: TrainingBlueprint["global"];
  recommendedStrategyId: "S1" | "S2" | "S3";
  strategies: StrategyView[];
}

export function toStrategyListView(blueprint: TrainingBlueprint, runId: string, baseContentVersion: number): StrategyListView {
  return {
    runId,
    producer: blueprint.producer.kind,
    label: blueprint.label,
    baseContentVersion,
    global: blueprint.global,
    recommendedStrategyId: blueprint.recommendedStrategyId,
    strategies: blueprint.strategies.map((s) => ({
      strategyId: s.strategyId,
      splitFamily: s.splitFamily,
      displayName: s.displayName,
      recommended: s.strategyId === blueprint.recommendedStrategyId,
      explanation: s.explanation,
      tradeoffs: s.tradeoffs,
      requiresScheduleChange: s.requiresScheduleChange,
      acceptable: !s.requiresScheduleChange,
      supportedByContext: s.supportedByContext,
      confidence: s.confidence,
      evidenceRefs: s.evidenceRefs,
      provenance: s.provenance,
      phases: s.phases.map((p) => ({
        phaseIndex: p.phaseIndex,
        splitType: p.splitType,
        workouts: p.workouts.map((w) => ({ label: w.label, role: w.role, source: w.source, focusDelta: w.focusDelta, candidateExerciseIds: w.candidateExerciseIds })),
      })),
      dosingIntent: s.dosingIntent,
      progressionIntent: s.progressionIntent,
    })),
  };
}
