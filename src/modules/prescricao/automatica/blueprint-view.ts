/**
 * What a proposal shows about the strategy it was generated with (design V4 §4.7/§4.8), as data for the screens: the compiled block
 * (`parameters.blueprint`) plus the recorded links (acceptance, planner run, hashes), and the origin of each item. Pure, no I/O, no
 * `server-only`. Fixed pt-BR labels only: no model text ever reaches this view, and no hash is a secret (hashes of codes).
 */
import { SPLIT_DISPLAY_NAME } from "../planejador/vocab";
import type { BlueprintLinkRow } from "@/db/prescription-proposals";
import type { ItemOut, WorkoutSummary } from "../motor/types";
import { parseGenerationAnswers, type BlueprintAnswers } from "./contracts";

export type OriginKind = "PROFESSIONAL" | "RULES_HEURISTIC" | "AI_SUGGESTED" | "STUDENT_DATA";

/** "Sugestão da IA" is the model's proposal, never evidence; "Heurística operacional (editável)" is the rules mode's. */
export const ORIGIN_LABELS: Record<OriginKind, string> = {
  PROFESSIONAL: "Decisão do profissional",
  RULES_HEURISTIC: "Padrão por regras (editável)",
  AI_SUGGESTED: "Sugestão da IA",
  STUDENT_DATA: "Dado do aluno",
};

export const ROLE_LABELS: Record<string, string> = {
  FULL_BODY: "Corpo inteiro", UPPER: "Superior", LOWER: "Inferior", PUSH: "Empurrar", PULL: "Puxar", LEGS: "Pernas",
  CHEST_TRICEPS: "Peito e tríceps", BACK_BICEPS: "Costas e bíceps", SHOULDERS_ARMS: "Ombros e braços", CORE: "Core", CUSTOM: "Personalizado",
  CARDIO: "Cardio", MOBILITY: "Mobilidade", BALANCE: "Equilíbrio", SKILL: "Habilidade",
};

export interface ProposalBlueprintView {
  strategies: Array<{ acceptanceId: string; strategyId: string; splitFamily: string; familyLabel: string; source: "AI_SUGGESTED" | "RULES_HEURISTIC"; originLabel: string }>;
  workouts: Array<{ phaseIndex: number; label: string; role: string; roleLabel: string; source: OriginKind; originLabel: string; strategyId: string }>;
  /** What was recorded with each generation: the hashes that make it reproducible (the model's response itself is stored apart, deletable). */
  record: {
    generations: Array<{ generationId: string; createdAt: string; compiledHash: string; rules: { id: string; version: string } }>;
    runs: Array<{ acceptanceId: string; runId: string; blueprintHash: string | null; responseHash: string | null; kind: "AI" | "RULES" }>;
  };
}

/** The compiled block of stored answers, or null when the proposal has none (old proposals, no strategy). */
export function blueprintOf(parameters: unknown): BlueprintAnswers | null {
  try {
    return parseGenerationAnswers(parameters).blueprint ?? null;
  } catch {
    return null;
  }
}

export function proposalBlueprintView(parameters: unknown, links: readonly BlueprintLinkRow[]): ProposalBlueprintView | null {
  const block = blueprintOf(parameters);
  if (!block) return null;
  const generations = new Map<string, ProposalBlueprintView["record"]["generations"][number]>();
  for (const l of links)
    if (!generations.has(l.generationId))
      generations.set(l.generationId, { generationId: l.generationId, createdAt: l.createdAt, compiledHash: l.compiledHash, rules: { id: l.rulesId, version: l.rulesVersion } });
  const ordered = [...generations.values()];
  const latest = links.length ? links[links.length - 1].generationId : null;
  const latestRuns = links.filter((l) => l.generationId === latest);
  const runs = latestRuns.map((l) => ({ acceptanceId: l.acceptanceId, runId: l.runId, blueprintHash: l.blueprintHash, responseHash: l.responseHash, kind: l.responseHash ? ("AI" as const) : ("RULES" as const) }));
  const originOf = (s: OriginKind) => ORIGIN_LABELS[s];
  return {
    strategies: block.acceptances.map((a) => ({
      acceptanceId: a.acceptanceId, strategyId: a.strategyId, splitFamily: a.splitFamily, familyLabel: SPLIT_DISPLAY_NAME[a.splitFamily], source: a.source, originLabel: originOf(a.source),
    })),
    workouts: block.workouts.map((w) => ({
      phaseIndex: w.phaseIndex, label: w.label, role: w.role, roleLabel: ROLE_LABELS[w.role] ?? w.role, source: w.source, originLabel: originOf(w.source),
      strategyId: block.acceptances.find((a) => a.acceptanceId === w.acceptanceId)?.strategyId ?? "",
    })),
    record: { generations: ordered, runs },
  };
}

// ---------- origin of each item ----------

export interface ItemProvenance {
  /** Who decided the item: the professional (kept/locked/substituted rows), else the one that drove its choice. */
  decidedBy: OriginKind;
  /** Where the workout's focus came from (null when the workout has no strategy focus). */
  focus: OriginKind | null;
  /** The rule weights that ranked it: always the operational rules (heuristic, editable). */
  selection: OriginKind;
  /** Dose: the professional when a policy override or typed value applies, else the rules' defaults. */
  dose: OriginKind;
  /** The history or a caution of the student influenced the choice. */
  studentData: boolean;
  labels: { decidedBy: string; focus: string | null; selection: string; dose: string; studentData: string | null };
}

/**
 * The origin of an item, split in facets (the UI shows pills per facet): professional / rule heuristic / AI / student data. Rules:
 * a preserved, locked or substituted row is the professional's; the focus is `coverage.blueprint.source` for a strategy workout; the
 * ranking weights are always rules; the dose is the professional's only where a trace says so; traces of the student's own data (history, pain, assessment) mark student data.
 */
export function itemProvenance(item: Pick<ItemOut, "origin" | "trace">, workout: Pick<WorkoutSummary, "coverage"> | null): ItemProvenance {
  const professional = item.origin === "PRESERVED" || item.origin === "LOCKED" || item.origin === "SUBSTITUTED";
  const bp = workout?.coverage?.origin === "BLUEPRINT_FOCUS" ? workout.coverage.blueprint : undefined;
  const focus: OriginKind | null = bp ? bp.source : null;
  const studentData = item.trace.selection.some((t) => t.basis === "STUDENT_DATA");
  const dose: OriginKind = item.trace.params.some((p) => p.basis === "PROFESSIONAL") ? "PROFESSIONAL" : "RULES_HEURISTIC";
  const decidedBy: OriginKind = professional ? "PROFESSIONAL" : focus === "AI_SUGGESTED" ? "AI_SUGGESTED" : "RULES_HEURISTIC";
  return {
    decidedBy, focus, selection: "RULES_HEURISTIC", dose, studentData,
    labels: {
      decidedBy: ORIGIN_LABELS[decidedBy],
      focus: focus ? ORIGIN_LABELS[focus] : null,
      selection: ORIGIN_LABELS.RULES_HEURISTIC,
      dose: ORIGIN_LABELS[dose],
      studentData: studentData ? ORIGIN_LABELS.STUDENT_DATA : null,
    },
  };
}
