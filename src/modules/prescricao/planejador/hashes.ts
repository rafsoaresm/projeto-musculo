/**
 * Hash definitions of the planner (design V4 §2.9), all over `motor/hash.ts` canonical JSON. Timestamps never enter a hash.
 */
import { canonicalJson, sha256Hex } from "@/modules/prescricao/motor/hash";
import type { StructureFacts } from "@/modules/prescricao/motor/types";
import type { AliasTables, TrainingPlanningContext } from "./context-types";

export const contextHash = (context: TrainingPlanningContext): Promise<string> => sha256Hex(canonicalJson(context));

/** The sorted lines the alias map hash is computed over: "X1=<id>" then "T1=<label>" (findings are derived from the context, not mapped). */
export function aliasMapLines(tables: Pick<AliasTables, "exercises" | "workouts">): string[] {
  const x = [...tables.exercises].sort(([a], [b]) => Number(a.slice(1)) - Number(b.slice(1))).map(([alias, id]) => `${alias}=${id}`);
  const t = [...tables.workouts].sort(([a], [b]) => Number(a.slice(1)) - Number(b.slice(1))).map(([alias, label]) => `${alias}=${label}`);
  return [...x, ...t];
}
export const aliasMapHash = (tables: Pick<AliasTables, "exercises" | "workouts">): Promise<string> => sha256Hex(aliasMapLines(tables).join("\n"));

/** The saved structure as it matters to a plan: phases, labels, every occurrence with its planned date. */
export function structureFingerprint(structure: StructureFacts): Promise<string> {
  return sha256Hex(
    canonicalJson(
      structure.phases.map((p) => ({
        index: p.index, name: p.name, weeks: p.weeks, sessionsPerWeek: p.sessionsPerWeek,
        workouts: p.workouts.map((w) => w.label),
        occurrences: p.occurrences.map((o) => [o.week, o.slot, o.label, o.plannedDate]),
      })),
    ),
  );
}

export const responseHash = (validatedWire: unknown): Promise<string> => sha256Hex(canonicalJson(validatedWire));
export const blueprintHash = (blueprint: unknown): Promise<string> => sha256Hex(canonicalJson(blueprint));
export const acceptanceHash = (parts: { runBlueprintHash: string; strategyId: string; phases: unknown; dosing: unknown }): Promise<string> =>
  sha256Hex(canonicalJson(parts));

/** Organization is a column of the cache primary key, not part of the hash. */
export function plannerCacheKey(parts: {
  task: string; contextHash: string; aliasMapHash: string; promptVersion: string; schemaVersion: number; provider: string; modelId: string;
  maxOutputTokens: number; roleFocusRef: string; strategiesMax: number;
}): Promise<string> {
  const { maxOutputTokens, ...rest } = parts;
  return sha256Hex(canonicalJson({ ...rest, limits: { maxOutputTokens } }));
}
