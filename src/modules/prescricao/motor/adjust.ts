/**
 * Pure simulation of assisted adjustments (design V4 §6.5, sub-stage 4.3a): a change to ONE point of a proposal is simulated over a COPY
 * with the engine's own operations (`substitute`, `changeDoses`), which already revalidate eligibility and recompute dose, duration,
 * volume and audit. Nothing here reads a clock, a database or a provider; nothing is mutated (inputs are never written to).
 *
 * The constraints are the professional's own ticks, checked on the numbers of the simulation (never on what a model says it did).
 * A constraint is OK, VIOLATED (with the numbers) or UNCHECKABLE (a quantity it needs is unknown, e.g. a dose with no sets).
 */
import { describeStructuredDose } from "./dose";
import { changeDoses, substitute } from "./regenerate";
import type { CatalogExercise, Dose, DosePatch, EngineInput, EngineResult, ItemOut, OccurrenceOut, SubstitutionTarget } from "./types";

export const DOSE_OP_CODES = ["CHANGE_SETS", "CHANGE_REPS", "CHANGE_REST", "CHANGE_RIR"] as const;
export type DoseOpCode = (typeof DOSE_OP_CODES)[number];

export type ResolvedOp =
  | { kind: "SUBSTITUTE_EXERCISE"; target: SubstitutionTarget; fromExerciseId: string; newExerciseId: string }
  | { kind: "DOSE"; op: DoseOpCode; phaseIndex: number; label: string; slotKey: string; exerciseId: string; patch: DosePatch };

export type ResolvedConstraint =
  | { kind: "NO_WEEKLY_SETS_INCREASE"; muscles: readonly string[] }
  | { kind: "MAX_WEEKLY_SETS"; muscles: readonly string[]; maxWeighted: number }
  | { kind: "NO_DURATION_INCREASE" }
  | { kind: "MAX_SESSION_MINUTES"; minutes: number }
  | { kind: "SAME_PATTERN" }
  | { kind: "EQUIPMENT_CLASS"; equipment: string };

export type ConstraintStatus = "OK" | "VIOLATED" | "UNCHECKABLE";
export interface ConstraintCheck {
  constraint: ResolvedConstraint;
  status: ConstraintStatus;
  /** pt-BR, built from the measured numbers ("Costas +2 séries ponderadas na semana 3"). Null when OK. */
  detail: string | null;
}

// ---------- dose overrides ----------

export interface AdjustOverride {
  exerciseId: string;
  phaseIndex: number;
  label: string;
  patch: DosePatch;
}
export const overrideOf = (op: Extract<ResolvedOp, { kind: "DOSE" }>): AdjustOverride => ({ exerciseId: op.exerciseId, phaseIndex: op.phaseIndex, label: op.label, patch: op.patch });

type KeyedOverride = { exerciseId?: string; phaseIndex?: number; label?: string; stimulus?: string; modality?: string; metric?: string; patch: DosePatch };
/** Same item, same phase and workout, same set of parameters: a newer adjustment replaces the older one instead of stacking. */
export const overrideKey = (o: KeyedOverride): string =>
  JSON.stringify([o.exerciseId ?? null, o.phaseIndex ?? null, o.label ?? null, o.stimulus ?? null, o.modality ?? null, o.metric ?? null, Object.keys(o.patch.values ?? {}).sort()]);

/** Existing overrides minus the ones the new ones replace, then the new ones (order is the engine's tie-break: the newest wins). */
export function mergeDoseOverrides<T extends KeyedOverride>(existing: readonly T[], incoming: readonly T[]): T[] {
  const replaced = new Set(incoming.map(overrideKey));
  return [...existing.filter((o) => !replaced.has(overrideKey(o))), ...incoming];
}

// ---------- simulation ----------

export type SimulationOutcome =
  | {
      ok: true;
      result: EngineResult;
      overrides: AdjustOverride[];
      substitutions: Array<{ target: SubstitutionTarget; newExerciseId: string }>;
      /** Dose operations whose item ended with the same dose (a weekly ramp overwrote the typed value). */
      noEffect: ResolvedOp[];
    }
  | { ok: false; code: string; message: string };

const fail = (code: string, message: string): SimulationOutcome => ({ ok: false, code, message });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function itemsAt(result: EngineResult, phaseIndex: number, label: string, slotKey: string): ItemOut[] {
  return result.occurrences.filter((o) => o.phaseIndex === phaseIndex && o.label === label).flatMap((o) => o.items.filter((i) => i.slotKey === slotKey));
}

/** Does the item's dose have the quantity the operation changes? */
function doseFits(op: DoseOpCode, dose: Dose | null): string | null {
  if (!dose) return "A dose deste exercício está vazia: preencha-a na proposta antes de ajustá-la.";
  if (op === "CHANGE_SETS") return dose.metric === "REPS" || dose.metric === "TIME" || dose.metric === "DISTANCE" ? null : "Este exercício não é medido em séries.";
  if (op === "CHANGE_REST") return dose.metric === "REPS" || dose.metric === "TIME" || dose.metric === "DISTANCE" ? null : "Este exercício não tem pausa entre séries.";
  return dose.metric === "REPS" ? null : "Repetições e RIR só valem para exercícios medidos em repetições.";
}

/**
 * Simulates `ops` (all substitutions, or all dose operations; at most two) on `previous`. `input` is the engine input the proposal was
 * built with (the same rules, answers and locked items); it is never modified. The result is what the proposal WOULD be.
 */
export function simulateAdjustments(input: EngineInput, previous: EngineResult, ops: readonly ResolvedOp[]): SimulationOutcome {
  if (!ops.length) return fail("NO_OPERATIONS", "Nada a ajustar.");
  if (ops.length > 2) return fail("TOO_MANY_OPERATIONS", "Um ajuste muda no máximo dois pontos.");
  const kinds = new Set(ops.map((o) => o.kind));
  if (kinds.size > 1) return fail("MIXED_OPERATIONS", "Troque exercícios ou ajuste doses, não os dois no mesmo pedido.");
  let result = previous;
  const substitutions: Array<{ target: SubstitutionTarget; newExerciseId: string }> = [];
  const overrides: AdjustOverride[] = [];
  const noEffect: ResolvedOp[] = [];

  if (ops[0].kind === "SUBSTITUTE_EXERCISE") {
    for (const op of ops) {
      if (op.kind !== "SUBSTITUTE_EXERCISE") continue;
      const out = substitute(input, result, op.target, op.newExerciseId);
      if (!out.ok) return fail(out.code, out.message);
      result = out.result;
      substitutions.push({ target: op.target, newExerciseId: op.newExerciseId });
    }
  } else {
    const doseOps = ops.filter((o): o is Extract<ResolvedOp, { kind: "DOSE" }> => o.kind === "DOSE");
    for (const op of doseOps) {
      const items = itemsAt(previous, op.phaseIndex, op.label, op.slotKey);
      if (!items.length) return fail("TARGET_NOT_FOUND", "Item não encontrado na proposta.");
      const bad = doseFits(op.op, items[0].dose);
      if (bad) return fail("DOSE_NOT_APPLICABLE", bad);
      overrides.push(overrideOf(op));
    }
    const next: EngineInput = { ...input, parameters: { ...input.parameters, doseOverrides: mergeDoseOverrides(input.parameters.doseOverrides, overrides) } };
    const out = changeDoses(next, previous, doseOps.map((o) => ({ phaseIndex: o.phaseIndex, slotKey: o.slotKey })));
    if (!out.ok) return fail(out.code, out.message);
    result = out.result;
    for (const op of doseOps)
      if (same(itemsAt(previous, op.phaseIndex, op.label, op.slotKey).map((i) => i.dose), itemsAt(result, op.phaseIndex, op.label, op.slotKey).map((i) => i.dose))) noEffect.push(op);
  }

  // Invariants of every simulation.
  if (result.status === "INFEASIBLE" && previous.status !== "INFEASIBLE") return fail("INFEASIBLE_INTRODUCED", "O ajuste tornaria a proposta inviável.");
  const before = new Set(previous.issues.filter((i) => i.severity === "ERROR").map((i) => `${i.code}|${i.path}`));
  const introduced = result.issues.find((i) => i.severity === "ERROR" && !before.has(`${i.code}|${i.path}`));
  if (introduced) return fail("ERROR_INTRODUCED", introduced.message);
  const keep = (o: OccurrenceOut) => o.items.filter((i) => i.origin === "LOCKED" || i.origin === "PRESERVED").map((i) => [i.slotKey, i.exerciseId, i.dose]);
  const byKey = (r: EngineResult) => new Map(r.occurrences.map((o) => [`${o.phaseIndex}|${o.week}|${o.slot}`, keep(o)] as const));
  const after = byKey(result);
  for (const [key, rows] of byKey(previous)) if (!same(rows, after.get(key) ?? [])) return fail("LOCKED_CHANGED", "O ajuste mexeria numa linha travada ou preservada.");
  return { ok: true, result, overrides, substitutions, noEffect };
}

// ---------- constraints ----------

function changedOccurrences(before: EngineResult, after: EngineResult): OccurrenceOut[] {
  const rows = new Map(before.occurrences.map((o) => [`${o.phaseIndex}|${o.week}|${o.slot}`, o] as const));
  return after.occurrences.filter((o) => {
    const b = rows.get(`${o.phaseIndex}|${o.week}|${o.slot}`);
    return !b || !same(b.items.map((i) => [i.exerciseId, i.dose]), o.items.map((i) => [i.exerciseId, i.dose]));
  });
}

const key3 = (phaseIndex: number, week: number, muscle: string) => `${phaseIndex}|${week}|${muscle}`;
const fmt = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");

export function evaluateConstraints(
  before: EngineResult,
  after: EngineResult,
  constraints: readonly ResolvedConstraint[],
  catalog: ReadonlyMap<string, CatalogExercise>,
  ops: readonly ResolvedOp[],
  muscleName: (code: string) => string = (c) => c,
): ConstraintCheck[] {
  const changed = changedOccurrences(before, after);
  const beforeVolume = new Map(before.volume.map((v) => [key3(v.phaseIndex, v.week, v.muscle), v.weightedSets] as const));
  const afterVolume = new Map(after.volume.map((v) => [key3(v.phaseIndex, v.week, v.muscle), v.weightedSets] as const));
  const beforeOcc = new Map(before.occurrences.map((o) => [`${o.phaseIndex}|${o.week}|${o.slot}`, o] as const));
  const musclesOf = (id: string | null): string[] => (id ? [...(catalog.get(id)?.primaryMuscles ?? []), ...(catalog.get(id)?.secondaryMuscles ?? [])] : []);
  /** An item of a changed occurrence whose sets are unknown and which loads one of `muscles`. */
  const setsUnknown = (muscles: readonly string[]) =>
    changed.some((o) => [...o.items, ...(beforeOcc.get(`${o.phaseIndex}|${o.week}|${o.slot}`)?.items ?? [])].some((i) => {
      const unknown = !i.dose || !("sets" in i.dose);
      return unknown && musclesOf(i.exerciseId).some((m) => muscles.includes(m));
    }));
  const substitutions = ops.filter((o): o is Extract<ResolvedOp, { kind: "SUBSTITUTE_EXERCISE" }> => o.kind === "SUBSTITUTE_EXERCISE");

  return constraints.map((constraint): ConstraintCheck => {
    const ok: ConstraintCheck = { constraint, status: "OK", detail: null };
    switch (constraint.kind) {
      case "NO_WEEKLY_SETS_INCREASE":
      case "MAX_WEEKLY_SETS": {
        const worse: string[] = [];
        const seen = new Set<string>();
        for (const o of changed)
          for (const m of constraint.muscles) {
            const k = key3(o.phaseIndex, o.week, m);
            if (seen.has(k)) continue;
            seen.add(k);
            const b = beforeVolume.get(k) ?? 0;
            const a = afterVolume.get(k) ?? 0;
            if (constraint.kind === "NO_WEEKLY_SETS_INCREASE" ? a > b : a > constraint.maxWeighted)
              worse.push(constraint.kind === "NO_WEEKLY_SETS_INCREASE"
                ? `${muscleName(m)} +${fmt(a - b)} séries ponderadas na semana ${o.week} (fase ${o.phaseIndex})`
                : `${muscleName(m)} ${fmt(a)} séries ponderadas na semana ${o.week} (fase ${o.phaseIndex}), limite ${fmt(constraint.maxWeighted)}`);
          }
        if (worse.length) return { constraint, status: "VIOLATED", detail: `Violaria: ${worse.slice(0, 3).join("; ")}${worse.length > 3 ? ` e mais ${worse.length - 3}` : ""}.` };
        if (setsUnknown(constraint.muscles)) return { constraint, status: "UNCHECKABLE", detail: "Não dá para verificar: um exercício envolvido não tem séries definidas." };
        return ok;
      }
      case "NO_DURATION_INCREASE":
      case "MAX_SESSION_MINUTES": {
        const worse: string[] = [];
        let unknown = false;
        for (const o of changed) {
          const b = beforeOcc.get(`${o.phaseIndex}|${o.week}|${o.slot}`);
          const limit = constraint.kind === "MAX_SESSION_MINUTES" ? constraint.minutes : b?.estimatedMinutes ?? null;
          if (o.estimatedMinutes === null || limit === null) { unknown = true; continue; }
          if (o.estimatedMinutes > limit) worse.push(`≈ ${o.estimatedMinutes} min na semana ${o.week}, sessão ${o.slot} (limite ${limit} min)`);
          else if (!o.durationComplete || (constraint.kind === "NO_DURATION_INCREASE" && b && !b.durationComplete)) unknown = true;
        }
        if (worse.length) return { constraint, status: "VIOLATED", detail: `Violaria: ${worse.slice(0, 3).join("; ")}${worse.length > 3 ? ` e mais ${worse.length - 3}` : ""}.` };
        if (unknown) return { constraint, status: "UNCHECKABLE", detail: "Não dá para verificar: a duração é parcial (dose vazia ou descanso não informado)." };
        return ok;
      }
      case "SAME_PATTERN": {
        for (const s of substitutions) {
          const from = catalog.get(s.fromExerciseId);
          const to = catalog.get(s.newExerciseId);
          if (!from || !to || !from.patterns.length || !to.patterns.length) return { constraint, status: "UNCHECKABLE", detail: "Não dá para verificar: falta o padrão de movimento de um dos exercícios." };
          if (!to.patterns.some((p) => from.patterns.includes(p))) return { constraint, status: "VIOLATED", detail: `Violaria: ${to.name} não tem o padrão de movimento de ${from.name}.` };
        }
        return ok;
      }
      case "EQUIPMENT_CLASS": {
        for (const s of substitutions) {
          const to = catalog.get(s.newExerciseId);
          if (!to) return { constraint, status: "UNCHECKABLE", detail: "Não dá para verificar: exercício fora da biblioteca." };
          if (to.equipmentKnown === false) return { constraint, status: "UNCHECKABLE", detail: `Não dá para verificar: o equipamento de ${to.name} está pendente na biblioteca.` };
          const sets = [to.equipment, ...to.equipmentAlternatives];
          if (!sets.some((set) => set.includes(constraint.equipment))) return { constraint, status: "VIOLATED", detail: `Violaria: ${to.name} não usa o equipamento pedido.` };
        }
        return ok;
      }
    }
  });
}

/** "3 × 8–12 repetições · RIR 2 · descanso 90 s" or the empty text. */
export function doseTextOf(dose: Dose | null): string {
  return dose ? describeStructuredDose(dose) : "Sem dose definida";
}
