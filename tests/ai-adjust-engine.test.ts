import { beforeAll, describe, expect, it } from "vitest";
import { alternativesFor, DEFAULT_RULESET, generate, type EngineInput, type EngineResult, type ItemOut } from "@/modules/prescricao/motor";
import { evaluateConstraints, mergeDoseOverrides, simulateAdjustments, type ResolvedOp } from "@/modules/prescricao/motor/adjust";
import { diffResults } from "@/modules/prescricao/planejador/adjust-diff";
import { exercise, parameters } from "./helpers/motor-fixtures";
import { XINTUS_CATALOG, xintusInput } from "./helpers/xintus";

// Assisted adjustments, pure engine part (design V4 §6.5, §8.5): the Xintus request "trocar a puxada vertical por uma alternativa em máquina,
// sem aumentar o volume semanal de costas" as chips, the constraint check with a violated case, the diff and the invariants.
const ASSIST = exercise({ id: "ex-assistpull", name: "Puxada articulada", primaryMuscles: ["LATS"], secondaryMuscles: ["BICEPS"], patterns: ["VERTICAL_PULL"], equipment: ["MACHINE"], compound: true, difficulty: 1 });
const HEAVY = exercise({ id: "ex-heavypull", name: "Barra fixa com carga", primaryMuscles: ["LATS", "UPPER_BACK"], secondaryMuscles: ["BICEPS"], patterns: ["VERTICAL_PULL"], equipment: ["CABLE"], compound: true, difficulty: 4 });
const CATALOG = [...XINTUS_CATALOG, ASSIST, HEAVY];
const catalog = new Map(CATALOG.map((e) => [e.id, e]));

let input: EngineInput;
let before: EngineResult;
let pulldown: ItemOut;
const target = () => ({ phaseIndex: 1, slotKey: pulldown.slotKey, applies: { kind: "PHASE" as const } });
const swap = (newExerciseId: string): ResolvedOp => ({ kind: "SUBSTITUTE_EXERCISE", target: target(), fromExerciseId: "ex-pulldown", newExerciseId });
const sets = (n: number): ResolvedOp => ({ kind: "DOSE", op: "CHANGE_SETS", phaseIndex: 1, label: "B", slotKey: pulldown.slotKey, exerciseId: "ex-pulldown", patch: { values: { sets: n } } });
const BACK = { kind: "NO_WEEKLY_SETS_INCREASE", muscles: ["LATS", "UPPER_BACK"] } as const;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as object)) deepFreeze(v);
  }
  return value;
}

beforeAll(() => {
  input = xintusInput(DEFAULT_RULESET, { catalog: CATALOG });
  before = generate(input);
  pulldown = before.occurrences.find((o) => o.label === "B")!.items.find((i) => i.exerciseId === "ex-pulldown")!;
});

describe("substitution through the engine's own path", () => {
  it("the engine ranks the machine pull as an eligible alternative with the same pattern", () => {
    const alts = alternativesFor(input, before, { phaseIndex: 1, slotKey: pulldown.slotKey }, 8);
    expect(alts.map((a) => a.exerciseId)).toContain("ex-assistpull");
  });

  it("Xintus request as chips: diff shows the item before -> after, same volume, constraints OK, audit introduced/resolved", () => {
    const ops = [swap("ex-assistpull")];
    const sim = simulateAdjustments(input, before, ops);
    if (!sim.ok) throw new Error(sim.message);
    expect(sim.noEffect).toEqual([]);
    expect(sim.substitutions).toHaveLength(1);
    const checks = evaluateConstraints(before, sim.result, [BACK, { kind: "EQUIPMENT_CLASS", equipment: "MACHINE" }, { kind: "SAME_PATTERN" }], catalog, ops);
    expect(checks.map((c) => c.status)).toEqual(["OK", "OK", "OK"]);
    const diff = diffResults(before, sim.result, checks);
    // weeks 1-2 (2 sets) and weeks 3-4 (3 sets) are two rows of the same swap: the dose stays, the exercise changes
    expect(diff.items.map((r) => [r.before.exerciseName, r.after.exerciseName, r.scopeText, r.sessions])).toEqual([
      ["Puxada frontal", "Puxada articulada", "semanas 1–2", 4],
      ["Puxada frontal", "Puxada articulada", "semanas 3–4", 4],
    ]);
    expect(diff.items[0].before.doseText).toBe(diff.items[0].after.doseText);
    expect(diff.items[0].after.provenance).toBe("SUBSTITUTED");
    expect(diff.counts).toEqual({ itemsChanged: 2, occurrencesTouched: 8 });
    // same sets, same muscles: no volume or minutes row
    expect(diff.volume).toEqual([]);
    expect(diff.minutes).toEqual([]);
    // the audit is recomputed: the diff lists only what appeared or went away
    expect(diff.audit.introduced.every((f) => f.key && f.rationale)).toBe(true);
    expect(diff.audit.introduced.length + diff.audit.resolved.length).toBeGreaterThan(0);
    // the rest of the proposal is byte-equal
    const other = (r: EngineResult) => JSON.stringify(r.occurrences.filter((o) => o.phaseIndex !== 1 || o.label !== "B"));
    expect(other(sim.result)).toBe(other(before));
  });

  it("a replacement that breaks SAME_PATTERN / EQUIPMENT_CLASS is VIOLATED with the reason; the engine still allows the swap", () => {
    const ops = [swap("ex-heavypull")];
    const sim = simulateAdjustments(input, before, ops);
    if (!sim.ok) throw new Error(sim.message);
    const checks = evaluateConstraints(before, sim.result, [{ kind: "EQUIPMENT_CLASS", equipment: "MACHINE" }, { kind: "SAME_PATTERN" }], catalog, ops);
    expect(checks[0]).toMatchObject({ status: "VIOLATED" });
    expect(checks[0].detail).toContain("Barra fixa com carga não usa o equipamento pedido");
    expect(checks[1].status).toBe("OK");
  });

  it("a replacement that adds back volume violates 'sem aumentar o volume semanal de costas' with the exact numbers", () => {
    const ops = [swap("ex-heavypull")];
    const sim = simulateAdjustments(input, before, ops);
    if (!sim.ok) throw new Error(sim.message);
    const [check] = evaluateConstraints(before, sim.result, [BACK], catalog, ops, (m) => (m === "UPPER_BACK" ? "Costas" : m));
    expect(check.status).toBe("VIOLATED");
    expect(check.detail).toMatch(/^Violaria: Costas \+\d+(,\d+)? séries ponderadas na semana 1 \(fase 1\)/);
    const diff = diffResults(before, sim.result, [check]);
    const row = diff.volume.find((v) => v.muscle === "UPPER_BACK" && v.week === 1)!;
    expect(row.delta).toBeGreaterThan(0);
    expect(row.after - row.before).toBeCloseTo(row.delta, 5);
  });

  it("refuses what the engine refuses: ineligible replacement, duplicate in the session, same exercise, locked target", () => {
    const code = (ops: ResolvedOp[], inp = input) => {
      const out = simulateAdjustments(inp, before, ops);
      return out.ok ? "OK" : out.code;
    };
    expect(code([swap("ex-bike")])).toBe("REPLACEMENT_INELIGIBLE");
    expect(code([swap("ex-row")])).toBe("REPLACEMENT_DUPLICATE");
    expect(code([swap("ex-pulldown")])).toBe("REPLACEMENT_DUPLICATE");
    expect(code([swap("ex-nope")])).toBe("EXERCISE_NOT_IN_CATALOG");
    expect(code([swap("ex-assistpull")], { ...input, locked: [{ phaseIndex: 1, slotKey: pulldown.slotKey }] })).toBe("TARGET_LOCKED");
    expect(code([])).toBe("NO_OPERATIONS");
    expect(code([swap("ex-assistpull"), sets(4)])).toBe("MIXED_OPERATIONS");
    expect(code([swap("ex-assistpull"), swap("ex-heavypull"), swap("ex-assistpull")])).toBe("TOO_MANY_OPERATIONS");
  });

  it("never mutates its inputs", () => {
    const frozenInput = deepFreeze(structuredClone(input));
    const frozenBefore = deepFreeze(structuredClone(before));
    expect(simulateAdjustments(frozenInput, frozenBefore, [swap("ex-assistpull")]).ok).toBe(true);
    expect(simulateAdjustments(frozenInput, frozenBefore, [sets(4)]).ok).toBe(true);
  });

  it("is deterministic: the same inputs give the same diff", () => {
    const a = simulateAdjustments(input, before, [swap("ex-assistpull")]);
    const b = simulateAdjustments(input, before, [swap("ex-assistpull")]);
    if (!a.ok || !b.ok) throw new Error("sim");
    expect(JSON.stringify(diffResults(before, a.result))).toBe(JSON.stringify(diffResults(before, b.result)));
  });
});

describe("dose operations (no provider involved)", () => {
  it("CHANGE_SETS +1 on a back exercise violates the volume constraint (canApply false) and shows where", () => {
    const ops = [sets(4)];
    const sim = simulateAdjustments(input, before, ops);
    if (!sim.ok) throw new Error(sim.message);
    expect(sim.overrides).toEqual([{ exerciseId: "ex-pulldown", phaseIndex: 1, label: "B", patch: { values: { sets: 4 } } }]);
    const [check] = evaluateConstraints(before, sim.result, [BACK], catalog, ops);
    expect(check.status).toBe("VIOLATED");
    const diff = diffResults(before, sim.result, [check]);
    // weeks 1-2 are set to 2 sets by the saved progression: only weeks 3-4 change (honest partial effect)
    expect(diff.items.map((r) => r.scopeText)).toEqual(["semanas 3–4"]);
    expect(diff.items[0].after.doseText.startsWith("4 ×")).toBe(true);
    expect(diff.minutes.length).toBeGreaterThan(0);
    expect(diff.volume.every((v) => v.delta > 0 && v.week >= 3)).toBe(true);
  });

  it("changing reps, rest and RIR rewrites only that parameter", () => {
    const reps = simulateAdjustments(input, before, [{ kind: "DOSE", op: "CHANGE_REPS", phaseIndex: 1, label: "B", slotKey: pulldown.slotKey, exerciseId: "ex-pulldown", patch: { values: { repsMin: 6, repsMax: 8 } } }]);
    if (!reps.ok) throw new Error(reps.message);
    const diff = diffResults(before, reps.result);
    expect(diff.items.every((r) => r.after.doseText.includes("6–8 repetições") && r.after.doseText.includes("RIR 1–3"))).toBe(true);
    const rest = simulateAdjustments(input, before, [{ kind: "DOSE", op: "CHANGE_REST", phaseIndex: 1, label: "B", slotKey: pulldown.slotKey, exerciseId: "ex-pulldown", patch: { values: { restSeconds: 150 } } }]);
    if (!rest.ok) throw new Error(rest.message);
    expect(diffResults(before, rest.result).items[0].after.doseText).toContain("descanso 150 s");
    // longer rest: the session is longer, and "sem aumentar a duração" says so
    const [dur] = evaluateConstraints(before, rest.result, [{ kind: "NO_DURATION_INCREASE" }], catalog, []);
    expect(dur.status).toBe("VIOLATED");
    expect(dur.detail).toMatch(/≈ \d+ min na semana/);
  });

  it("NO_DURATION_INCREASE is UNCHECKABLE when the simulated or the previous duration is only a lower bound", () => {
    const rest = simulateAdjustments(input, before, [{ kind: "DOSE", op: "CHANGE_REST", phaseIndex: 1, label: "B", slotKey: pulldown.slotKey, exerciseId: "ex-pulldown", patch: { values: { restSeconds: 30 } } }]);
    if (!rest.ok) throw new Error(rest.message);
    const partial = { ...rest.result, occurrences: rest.result.occurrences.map((o) => (o.label === "B" ? { ...o, durationComplete: false } : o)) };
    const [dur] = evaluateConstraints(before, partial, [{ kind: "NO_DURATION_INCREASE" }], catalog, []);
    expect(dur.status).toBe("UNCHECKABLE");
  });

  it("noEffect when a weekly ramp overwrites the typed value in every week", () => {
    const ramped = xintusInput(DEFAULT_RULESET, {
      catalog: CATALOG,
      parameters: parameters({ availableMinutes: 60, progressionByPhase: [{ phaseIndex: 1, progression: { model: "LINEAR", ramps: [{ param: "sets", from: 2, to: 4 }] } }] }),
    });
    const base = generate(ramped);
    const item = base.occurrences.find((o) => o.label === "B")!.items.find((i) => i.exerciseId === "ex-pulldown")!;
    const sim = simulateAdjustments(ramped, base, [{ kind: "DOSE", op: "CHANGE_SETS", phaseIndex: 1, label: "B", slotKey: item.slotKey, exerciseId: "ex-pulldown", patch: { values: { sets: 6 } } }]);
    if (!sim.ok) throw new Error(sim.message);
    expect(sim.noEffect).toHaveLength(1);
    expect(diffResults(base, sim.result).items).toEqual([]);
  });

  it("a metric the operation does not fit is refused with the reason (plank has no repetitions)", () => {
    const plank = before.occurrences.flatMap((o) => o.items).find((i) => i.exerciseId === "ex-plank");
    if (!plank) return;
    const out = simulateAdjustments(input, before, [{ kind: "DOSE", op: "CHANGE_REPS", phaseIndex: 1, label: plank.slotKey.includes('"A"') ? "A" : "B", slotKey: plank.slotKey, exerciseId: "ex-plank", patch: { values: { repsMin: 5, repsMax: 8 } } }]);
    expect(out).toMatchObject({ ok: false, code: "DOSE_NOT_APPLICABLE" });
  });

  it("an empty dose cannot be adjusted, and UNCHECKABLE is reported when sets are unknown", () => {
    const empty = xintusInput(DEFAULT_RULESET, { catalog: CATALOG, parameters: parameters({ doseMode: "LEAVE_EMPTY", availableMinutes: 60 }) });
    const base = generate(empty);
    const item = base.occurrences.find((o) => o.label === "B")!.items.find((i) => i.exerciseId === "ex-pulldown")!;
    expect(item.dose).toBeNull();
    expect(simulateAdjustments(empty, base, [{ kind: "DOSE", op: "CHANGE_SETS", phaseIndex: 1, label: "B", slotKey: item.slotKey, exerciseId: "ex-pulldown", patch: { values: { sets: 4 } } }])).toMatchObject({ ok: false, code: "DOSE_NOT_APPLICABLE" });
    const ops = [{ kind: "SUBSTITUTE_EXERCISE", target: { phaseIndex: 1, slotKey: item.slotKey, applies: { kind: "PHASE" } }, fromExerciseId: "ex-pulldown", newExerciseId: "ex-assistpull" }] as const;
    const sim = simulateAdjustments(empty, base, ops);
    if (!sim.ok) throw new Error(sim.message);
    expect(evaluateConstraints(base, sim.result, [BACK], catalog, ops)[0].status).toBe("UNCHECKABLE");
  });

  it("an override of the same item and parameters replaces the previous one", () => {
    const a = { exerciseId: "ex-pulldown", phaseIndex: 1, label: "B", patch: { values: { sets: 3 } } };
    const b = { ...a, patch: { values: { sets: 5 } } };
    expect(mergeDoseOverrides([a], [b])).toEqual([b]);
  });
});
