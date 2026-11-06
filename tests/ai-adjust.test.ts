import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  adjustmentApplySchema, adjustmentRequestSchema, constraintText, dosePatchOf, mergeDoseOverrides, modelAdjustmentSchema, overrideKey, requestSentence,
  substitutionTargetOf, SLOT_KEY_RE, type AdjustIntent,
} from "@/modules/prescricao/planejador/adjust";

// Contracts of the assisted adjustments (design V4 §6.2, §8.5): structured-only, no free text anywhere.
const SLOT = '[1,"B","ex-pulldown",0]';
const KEY = "adj-key-0123456789abcdef";
const intent = (over: Partial<AdjustIntent> = {}): AdjustIntent => ({
  op: "SUBSTITUTE_EXERCISE", target: { phaseIndex: 1, label: "B", slotKey: SLOT }, scope: "PHASE", values: null,
  constraints: [{ kind: "EQUIPMENT_CLASS", equipment: "MACHINE" }, { kind: "NO_WEEKLY_SETS_INCREASE", muscles: ["LATS", "UPPER_BACK"] }],
  replacementExerciseId: null, useAi: true, ...over,
});
const request = (over: Partial<AdjustIntent> = {}, extra: Record<string, unknown> = {}) => ({ proposalId: "prop-1", expectedVersion: 3, idempotencyKey: KEY, intent: intent(over), ...extra });
const refused = (value: unknown) => adjustmentRequestSchema.safeParse(value).success === false;

describe("adjustment request", () => {
  it("accepts the three shapes the panel builds: AI substitution, engine pick and a dose change", () => {
    expect(adjustmentRequestSchema.safeParse(request()).success).toBe(true);
    expect(adjustmentRequestSchema.safeParse(request({ useAi: false, replacementExerciseId: "ex-assistpull" })).success).toBe(true);
    expect(adjustmentRequestSchema.safeParse(request({ op: "CHANGE_SETS", values: { sets: 4 }, useAi: false, constraints: [] })).success).toBe(true);
    expect(adjustmentRequestSchema.safeParse(request({ op: "CHANGE_REPS", values: { repsMin: 6, repsMax: 10 }, useAi: false })).success).toBe(true);
  });

  it("refuses an unknown key anywhere (no free-text field can be smuggled in)", () => {
    expect(refused(request({}, { instruction: "trocar a puxada" }))).toBe(true);
    expect(refused({ ...request(), intent: { ...intent(), note: "dor no ombro" } })).toBe(true);
    expect(refused(request({ target: { phaseIndex: 1, label: "B", slotKey: SLOT, nickname: "x" } as never }))).toBe(true);
  });

  it("scope for dose operations must be PHASE; substitutions need the week/session their scope names", () => {
    expect(refused(request({ op: "CHANGE_SETS", values: { sets: 4 }, useAi: false, scope: "FROM_WEEK", target: { phaseIndex: 1, label: "B", slotKey: SLOT, week: 2 } }))).toBe(true);
    expect(refused(request({ scope: "FROM_WEEK" }))).toBe(true);
    expect(refused(request({ scope: "OCCURRENCE", target: { phaseIndex: 1, label: "B", slotKey: SLOT, week: 2 } }))).toBe(true);
    expect(adjustmentRequestSchema.safeParse(request({ scope: "OCCURRENCE", target: { phaseIndex: 1, label: "B", slotKey: SLOT, week: 2, slot: 1 } })).success).toBe(true);
  });

  it("dose values: bounds, pairs and ordering (repsMin>repsMax, rest 601, sets 9, RIR inverted)", () => {
    const dose = (op: AdjustIntent["op"], values: AdjustIntent["values"]) => request({ op, values, useAi: false, constraints: [] });
    expect(refused(dose("CHANGE_REPS", { repsMin: 12, repsMax: 8 }))).toBe(true);
    expect(refused(dose("CHANGE_REST", { restSeconds: 601 }))).toBe(true);
    expect(refused(dose("CHANGE_SETS", { sets: 9 }))).toBe(true);
    expect(refused(dose("CHANGE_SETS", { sets: 0 }))).toBe(true);
    expect(refused(dose("CHANGE_RIR", { rirMin: 3, rirMax: 1 }))).toBe(true);
    expect(refused(dose("CHANGE_REPS", { repsMin: 8 }))).toBe(true);
    expect(refused(dose("CHANGE_SETS", { sets: 3, repsMin: 8 }))).toBe(true);
    expect(refused(dose("CHANGE_SETS", null))).toBe(true);
    expect(refused(request({ values: { sets: 3 } }))).toBe(true);
  });

  it("the AI is only for substitutions, never together with an engine pick", () => {
    expect(refused(request({ op: "CHANGE_SETS", values: { sets: 4 }, useAi: true }))).toBe(true);
    expect(refused(request({ useAi: true, replacementExerciseId: "ex-assistpull" }))).toBe(true);
    expect(refused(request({ op: "CHANGE_SETS", values: { sets: 4 }, useAi: false, replacementExerciseId: "ex-x" }))).toBe(true);
  });

  it("constraints: at most four, closed kinds, known muscles and equipment", () => {
    const c = { kind: "SAME_PATTERN" } as const;
    expect(refused(request({ constraints: [c, c, c, c, c] }))).toBe(true);
    expect(refused(request({ constraints: [{ kind: "NO_WEEKLY_SETS_INCREASE", muscles: ["BRAIN"] } as never] }))).toBe(true);
    expect(refused(request({ constraints: [{ kind: "EQUIPMENT_CLASS", equipment: "LASER" } as never] }))).toBe(true);
    expect(refused(request({ constraints: [{ kind: "MAX_SESSION_MINUTES", minutes: 3 }] }))).toBe(true);
    expect(refused(request({ constraints: [{ kind: "MAX_WEEKLY_SETS", muscles: [], maxWeighted: 10 } as never] }))).toBe(true);
    expect(refused(request({ constraints: [{ kind: "FREE_TEXT", text: "x" } as never] }))).toBe(true);
  });

  it("slot keys and ids are regex-bound", () => {
    expect(SLOT_KEY_RE.test(SLOT)).toBe(true);
    expect(refused(request({ target: { phaseIndex: 1, label: "B", slotKey: "um texto qualquer" } }))).toBe(true);
    expect(refused(request({ target: { phaseIndex: 13, label: "B", slotKey: SLOT } }))).toBe(true);
    expect(refused({ ...request(), proposalId: "x y; DROP" })).toBe(true);
    expect(refused({ ...request(), idempotencyKey: "curta" })).toBe(true);
  });

  it("the apply payload is ids and a version only", () => {
    expect(adjustmentApplySchema.safeParse({ adjustmentId: "adj-1", proposalId: "prop-1", expectedVersion: 3, writeId: KEY, idempotencyKey: KEY, acknowledgeUncheckable: false }).success).toBe(true);
    expect(adjustmentApplySchema.safeParse({ adjustmentId: "adj-1", proposalId: "prop-1", expectedVersion: 3, writeId: KEY, idempotencyKey: KEY, acknowledgeUncheckable: false, diff: {} }).success).toBe(false);
  });
});

describe("model response", () => {
  const good = {
    schemaVersion: 1,
    operations: [{ target: { phase: 1, workout: "T2", item: "X3" }, scope: "PHASE", week: null, slot: null, replacement: "X5" }],
    reasonCodes: ["SAME_PATTERN", "EQUIPMENT_MATCH"], constraintsEcho: ["EQUIPMENT_CLASS"], clarification: null,
  };
  it("accepts aliases, enums and small integers only", () => {
    expect(modelAdjustmentSchema.safeParse(good).success).toBe(true);
    expect(modelAdjustmentSchema.safeParse({ ...good, operations: [], clarification: "NO_ELIGIBLE_ALTERNATIVE" }).success).toBe(true);
  });
  it("refuses prose, extra fields, real ids, more than two operations and unknown codes", () => {
    expect(modelAdjustmentSchema.safeParse({ ...good, explanation: "porque sim" }).success).toBe(false);
    expect(modelAdjustmentSchema.safeParse({ ...good, operations: [{ ...good.operations[0], replacement: "ex-assistpull" }] }).success).toBe(false);
    expect(modelAdjustmentSchema.safeParse({ ...good, operations: [{ ...good.operations[0], reason: "texto" }] }).success).toBe(false);
    expect(modelAdjustmentSchema.safeParse({ ...good, operations: [good.operations[0], good.operations[0], good.operations[0]] }).success).toBe(false);
    expect(modelAdjustmentSchema.safeParse({ ...good, reasonCodes: ["BECAUSE"] }).success).toBe(false);
    expect(modelAdjustmentSchema.safeParse({ ...good, clarification: "Não entendi" }).success).toBe(false);
  });
});

describe("static guard: no unbounded string in the request, response or context contracts", () => {
  /** Walks a zod schema; every string must be an enum/literal or carry a regex (the server-issued key, ids, aliases). */
  function unbounded(schema: z.ZodType, path = "$"): string[] {
    const def = (schema as unknown as { _zod: { def: Record<string, unknown> } })._zod.def;
    const type = def.type as string;
    if (type === "string") {
      const checks = ((def.checks as Array<{ _zod: { def: { check: string } } }> | undefined) ?? []).map((c) => c._zod.def.check);
      return checks.includes("string_format") ? [] : [path];
    }
    if (type === "object") return Object.entries(def.shape as Record<string, z.ZodType>).flatMap(([k, v]) => unbounded(v, `${path}.${k}`));
    if (type === "array") return unbounded(def.element as z.ZodType, `${path}[]`);
    if (type === "union") return (def.options as z.ZodType[]).flatMap((o, i) => unbounded(o, `${path}|${i}`));
    if (type === "optional" || type === "nullable" || type === "default") return unbounded(def.innerType as z.ZodType, path);
    if (type === "pipe") return unbounded(def.in as z.ZodType, path);
    return [];
  }
  it("walks adjustmentRequestSchema, adjustmentApplySchema and modelAdjustmentSchema", () => {
    expect(unbounded(adjustmentRequestSchema)).toEqual([]);
    expect(unbounded(adjustmentApplySchema)).toEqual([]);
    expect(unbounded(modelAdjustmentSchema)).toEqual([]);
    expect(unbounded(z.object({ free: z.string() }))).toEqual(["$.free"]);
  });
  it("the model schema has no oneOf (no union in the wire shape)", () => {
    expect(JSON.stringify(z.toJSONSchema(modelAdjustmentSchema))).not.toMatch(/oneOf/);
  });
});

describe("pure helpers", () => {
  it("substitutionTargetOf maps the three scopes", () => {
    const base = { phaseIndex: 1, label: "B", slotKey: SLOT };
    expect(substitutionTargetOf({ target: base, scope: "PHASE" })).toEqual({ phaseIndex: 1, slotKey: SLOT, applies: { kind: "PHASE" } });
    expect(substitutionTargetOf({ target: { ...base, week: 3 }, scope: "FROM_WEEK" })).toEqual({ phaseIndex: 1, slotKey: SLOT, applies: { kind: "FROM_WEEK", week: 3 } });
    expect(substitutionTargetOf({ target: { ...base, week: 3, slot: 2 }, scope: "OCCURRENCE" })).toEqual({ phaseIndex: 1, slotKey: SLOT, applies: { kind: "OCCURRENCE", week: 3, slot: 2 } });
    expect(substitutionTargetOf({ target: base, scope: "FROM_WEEK" })).toBeNull();
  });
  it("dosePatchOf builds the engine patch from the typed numbers", () => {
    expect(dosePatchOf({ op: "CHANGE_SETS", values: { sets: 4 } })).toEqual({ values: { sets: 4 } });
    expect(dosePatchOf({ op: "CHANGE_REPS", values: { repsMin: 6, repsMax: 10 } })).toEqual({ values: { repsMin: 6, repsMax: 10 } });
    expect(dosePatchOf({ op: "CHANGE_REST", values: { restSeconds: 120 } })).toEqual({ values: { restSeconds: 120 } });
    expect(dosePatchOf({ op: "CHANGE_RIR", values: { rirMin: 1, rirMax: 2 } })).toEqual({ values: { rirMin: 1, rirMax: 2 } });
    expect(dosePatchOf({ op: "CHANGE_REPS", values: { repsMin: 6 } })).toBeNull();
  });
  it("a newer override of the same item and parameters replaces the older one; other parameters stack", () => {
    const a = { exerciseId: "e1", phaseIndex: 1, label: "A", patch: { values: { sets: 3 } } };
    const b = { exerciseId: "e1", phaseIndex: 1, label: "A", patch: { values: { sets: 4 } } };
    const c = { exerciseId: "e1", phaseIndex: 1, label: "A", patch: { values: { restSeconds: 60 } } };
    expect(overrideKey(a)).toBe(overrideKey(b));
    expect(mergeDoseOverrides([a, c], [b])).toEqual([c, b]);
    expect(mergeDoseOverrides([], [a, c])).toEqual([a, c]);
  });
  it("the sentences are built by the server from fixed templates", () => {
    const i = intent();
    expect(requestSentence(i, { item: "Puxada frontal", workout: "B" })).toBe("Trocar Puxada frontal por uma alternativa em máquina · Treino B · sem aumentar o volume semanal de grande dorsal e dorsal alta (romboides e trapézio médio)");
    expect(requestSentence(intent({ op: "CHANGE_SETS", values: { sets: 4 }, constraints: [] }), { item: "Puxada frontal", workout: "B" })).toBe("Ajustar Puxada frontal para 4 séries · Treino B, fase toda");
    expect(requestSentence(i, { item: "Puxada frontal", workout: "B", replacement: "Puxada articulada" })).toContain("por Puxada articulada");
    expect(constraintText({ kind: "MAX_SESSION_MINUTES", minutes: 60 })).toBe("Máximo de 60 min por sessão");
    expect(constraintText({ kind: "NO_DURATION_INCREASE" })).toBe("Sem aumentar a duração");
  });
});
