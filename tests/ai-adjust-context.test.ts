import { beforeAll, describe, expect, it } from "vitest";
import { alternativesFor, DEFAULT_RULESET, generate, type EngineInput, type EngineResult, type ItemOut } from "@/modules/prescricao/motor";
import type { AdjustIntent } from "@/modules/prescricao/planejador/adjust";
import { buildAdjustContext, validateModelAdjustment, type AdjustContextBundle } from "@/modules/prescricao/planejador/adjust-context";
import { buildProviderPayload, PrivacyBlockedError, scanPatterns } from "@/modules/prescricao/planejador/privacy";
import { ADJUST_SCHEMA_NAME, ADJUST_SYSTEM_PROMPT, adjustUserMessage } from "@/modules/prescricao/planejador/prompt";
import { mockAdjustment } from "@/modules/prescricao/planejador/provedores/mock";
import { toWireSchema } from "@/modules/prescricao/planejador/provedores/wire-schema";
import { modelAdjustmentSchema } from "@/modules/prescricao/planejador/adjust";
import { PROVIDER_KINDS } from "@/modules/prescricao/planejador/provedores/port";
import { exercise } from "./helpers/motor-fixtures";
import { XINTUS_CATALOG, xintusInput } from "./helpers/xintus";

// The compact context of an adjustment and the binding of the model's answer (design V4 §6.3, §6.4, §8.5 "Privacy"): coded fields only,
// no exercise or workout name, the same choke point as the planner over the three adapters' bytes, and a hostile answer refused whole.
const ASSIST = exercise({ id: "ex-assistpull", name: "Puxada articulada da Zélia", primaryMuscles: ["LATS"], secondaryMuscles: ["BICEPS"], patterns: ["VERTICAL_PULL"], equipment: ["MACHINE"], compound: true, difficulty: 1 });
const CATALOG = [...XINTUS_CATALOG, ASSIST];
const catalog = new Map(CATALOG.map((e) => [e.id, e]));
let input: EngineInput;
let result: EngineResult;
let pulldown: ItemOut;
let bundle: AdjustContextBundle;
const intent = (over: Partial<AdjustIntent> = {}): AdjustIntent => ({
  op: "SUBSTITUTE_EXERCISE", target: { phaseIndex: 1, label: "B", slotKey: pulldown.slotKey }, scope: "PHASE", values: null,
  constraints: [{ kind: "EQUIPMENT_CLASS", equipment: "MACHINE" }, { kind: "NO_WEEKLY_SETS_INCREASE", muscles: ["LATS", "UPPER_BACK"] }], replacementExerciseId: null, useAi: true, ...over,
});

beforeAll(async () => {
  input = xintusInput(DEFAULT_RULESET, { catalog: CATALOG });
  result = generate(input);
  pulldown = result.occurrences.find((o) => o.label === "B")!.items.find((i) => i.exerciseId === "ex-pulldown")!;
  const alts = alternativesFor(input, result, { phaseIndex: 1, slotKey: pulldown.slotKey }, 8);
  const built = await buildAdjustContext({ input, result, catalog, intent: intent(), alternativeIds: alts.map((a) => a.exerciseId), proposalVersion: 4 });
  if (!built.ok) throw new Error(built.code);
  bundle = built.bundle;
});

describe("compact context", () => {
  it("is the focus phase as codes: aliases, vocabulary, small integers; the requested item carries the engine-ranked alternatives", () => {
    const c = bundle.context;
    expect(c).toMatchObject({ contextVersion: 1, experience: "INTERMEDIATE", proposalVersion: 4 });
    expect(c.request).toMatchObject({ op: "SUBSTITUTE_EXERCISE", scope: "PHASE", week: null, slot: null, target: { phase: 1, workout: bundle.workoutAlias, item: bundle.targetAlias } });
    expect(c.request.constraints).toEqual(intent().constraints);
    expect(c.phases).toHaveLength(1);
    const items = c.phases[0].workouts.flatMap((w) => w.items);
    const target = items.find((i) => i.alias === bundle.targetAlias)!;
    expect(target.alternatives).toEqual(bundle.allowed);
    expect(target.alternatives.length).toBeGreaterThan(0);
    expect(items.filter((i) => i.alternatives.length > 0)).toHaveLength(1);
    expect(target).toMatchObject({ primary: ["LATS"], patterns: ["VERTICAL_PULL"], origin: "ENGINE", locked: false });
    expect(target.sets).toBeGreaterThan(0);
    // weekly volume only for the muscles in play, only the focus phase, capped
    expect(c.weeklyVolume.length).toBeGreaterThan(0);
    expect(c.weeklyVolume.length).toBeLessThanOrEqual(40);
    expect(c.weeklyVolume.every((v) => v.phase === 1)).toBe(true);
    // the library rows are the target and the offered alternatives only
    expect(c.library.map((l) => l.alias).sort()).toEqual([bundle.targetAlias, ...bundle.allowed].sort());
  });

  it("carries no name, id, date, slot key or free text (key whitelist + value scan)", () => {
    const json = JSON.stringify(bundle.context);
    for (const secret of ["Puxada", "Zélia", "ex-pulldown", "ex-assistpull", "Treino", "Fase 1", "2026", pulldown.slotKey]) expect(json, secret).not.toContain(secret);
    expect(scanPatterns(json)).toEqual([]);
    const keys = new Set<string>();
    const walk = (v: unknown) => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (keys.add(k), walk(x));
    };
    walk(bundle.context);
    const WHITELIST = new Set([
      "alias", "alternatives", "compound", "constraints", "contextVersion", "difficulty", "equipment", "experience", "item", "items", "kind", "library", "locked", "max", "maxWeighted", "min",
      "minutes", "modality", "muscle", "muscles", "op", "origin", "patterns", "phase", "phases", "primary", "proposalVersion", "repsMax", "repsMin", "request", "rest", "rirMax", "rirMin",
      "scope", "secondary", "sets", "slot", "target", "week", "weeklyVolume", "weighted", "workout", "workouts",
    ]);
    expect([...keys].filter((k) => !WHITELIST.has(k))).toEqual([]);
    // exercise ids and workout labels are only reachable through the server-side alias table
    expect([...bundle.aliases.exercises.values()]).toContain("ex-pulldown");
    expect([...bundle.aliases.workouts.values()]).toContain("B");
    expect(bundle.aliases.aliasMapHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic: same proposal, same request, same bytes and hash", async () => {
    const again = await buildAdjustContext({ input, result, catalog, intent: intent(), alternativeIds: bundle.allowed.map((a) => bundle.aliases.exercises.get(a) as string), proposalVersion: 4 });
    if (!again.ok) throw new Error(again.code);
    expect(JSON.stringify(again.bundle.context)).toBe(JSON.stringify(bundle.context));
    expect(again.bundle.aliases.aliasMapHash).toBe(bundle.aliases.aliasMapHash);
  });

  it("refuses a dose operation and an item that is not in the proposal", async () => {
    const dose = await buildAdjustContext({ input, result, catalog, intent: intent({ op: "CHANGE_SETS", values: { sets: 4 }, useAi: false }), alternativeIds: [], proposalVersion: 4 });
    expect(dose).toEqual({ ok: false, code: "NOT_A_SUBSTITUTION" });
    const gone = await buildAdjustContext({ input, result, catalog, intent: intent({ target: { phaseIndex: 1, label: "B", slotKey: '[1,"B","ex-nope",0]' } }), alternativeIds: [], proposalVersion: 4 });
    expect(gone).toEqual({ ok: false, code: "TARGET_NOT_FOUND" });
  });
});

describe("the choke point over the three adapters' bytes", () => {
  const deny = { values: ["zelia quintanilha braga", "zelia.quintanilha@exemplo.test", "puxada frontal", "puxada articulada da zelia"], tokens: ["zelia", "quintanilha", "puxada"], prose: [] };

  it.each(PROVIDER_KINDS)("%s: the adjustment request passes with the student's real values in the deny list, and the bytes carry none of them", async (kind) => {
    const schema = toWireSchema(modelAdjustmentSchema, kind);
    const request = await buildProviderPayload("ADJUSTMENTS", { kind, system: ADJUST_SYSTEM_PROMPT, user: adjustUserMessage(bundle.context), schema, schemaName: ADJUST_SCHEMA_NAME, vocabularySchemas: [schema] }, deny);
    const bytes = `${request.system}\n${JSON.stringify(request.schema)}\n${request.user}`;
    for (const secret of ["Zélia", "Quintanilha", "zelia.quintanilha", "Puxada", "puxada", "ex-pulldown", "ex-assistpull"]) expect(bytes, secret).not.toContain(secret);
    expect(request.task).toBe("ADJUSTMENTS");
    expect(request.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("fails closed when a name reaches the user message by mistake (nothing is built)", async () => {
    const schema = toWireSchema(modelAdjustmentSchema, "mock");
    await expect(
      buildProviderPayload("ADJUSTMENTS", { kind: "mock", system: ADJUST_SYSTEM_PROMPT, user: { ...adjustUserMessage(bundle.context), note: "trocar a Puxada articulada da Zélia" }, schema, schemaName: ADJUST_SCHEMA_NAME }, deny),
    ).rejects.toBeInstanceOf(PrivacyBlockedError);
    await expect(
      buildProviderPayload("ADJUSTMENTS", { kind: "mock", system: ADJUST_SYSTEM_PROMPT, user: { ...adjustUserMessage(bundle.context), contact: "zelia.quintanilha@exemplo.test" }, schema, schemaName: ADJUST_SCHEMA_NAME }, deny),
    ).rejects.toBeInstanceOf(PrivacyBlockedError);
  });

  it("the system prompt is a constant with no pattern the scanner would flag", () => {
    expect(scanPatterns(ADJUST_SYSTEM_PROMPT)).toEqual([]);
    expect(ADJUST_SYSTEM_PROMPT).not.toMatch(/Zélia|zelia|@/);
  });
});

describe("the model's answer is bound to what was offered", () => {
  const good = () => mockAdjustment(bundle.context, "mock-ok");

  it("accepts an offered alternative and maps it back to the real id on the server", () => {
    const checked = validateModelAdjustment(good(), bundle);
    expect(checked).toMatchObject({ ok: true, clarification: null });
    if (!checked.ok) return;
    expect(checked.replacements).toEqual(["ex-assistpull"]);
    expect(checked.reasonCodes).toContain("EQUIPMENT_MATCH");
    expect(checked.constraintsEcho).toEqual(["EQUIPMENT_CLASS", "NO_WEEKLY_SETS_INCREASE"]);
  });

  it("an informational answer (no operation) is accepted only with a clarification", () => {
    expect(validateModelAdjustment(mockAdjustment(bundle.context, "mock-none"), bundle)).toMatchObject({ ok: true, replacements: [], clarification: "NO_ELIGIBLE_ALTERNATIVE" });
    expect(validateModelAdjustment({ ...good(), operations: [], clarification: null }, bundle)).toEqual({ ok: false, code: "EMPTY" });
    expect(validateModelAdjustment({ ...good(), clarification: "OUT_OF_SCOPE" }, bundle)).toEqual({ ok: false, code: "CLARIFICATION_WITH_OPERATIONS" });
  });

  it("refuses the whole answer for: an alias that was not offered, another item, another scope, two replacements, extra fields, prose, oversize", () => {
    const op = good().operations[0];
    const alias = bundle.allowed;
    const swap = (over: Record<string, unknown>) => ({ ...good(), operations: [{ ...op, ...over }] });
    expect(validateModelAdjustment(mockAdjustment(bundle.context, "mock-hostile"), bundle)).toEqual({ ok: false, code: "REPLACEMENT_NOT_OFFERED" });
    expect(validateModelAdjustment(swap({ replacement: bundle.targetAlias }), bundle)).toEqual({ ok: false, code: "REPLACEMENT_NOT_OFFERED" });
    expect(validateModelAdjustment(swap({ target: { ...op.target, item: alias[0] } }), bundle)).toEqual({ ok: false, code: "TARGET_MISMATCH" });
    expect(validateModelAdjustment(swap({ target: { ...op.target, phase: 2 } }), bundle)).toEqual({ ok: false, code: "TARGET_MISMATCH" });
    expect(validateModelAdjustment(swap({ scope: "FROM_WEEK", week: 2 }), bundle)).toEqual({ ok: false, code: "TARGET_MISMATCH" });
    expect(validateModelAdjustment({ ...good(), operations: [op, { ...op, replacement: alias[alias.length - 1] }] }, bundle)).toMatchObject({ ok: false });
    expect(validateModelAdjustment({ ...good(), explanation: "porque sim" }, bundle)).toEqual({ ok: false, code: "SCHEMA" });
    expect(validateModelAdjustment(swap({ reason: "texto livre" }), bundle)).toEqual({ ok: false, code: "SCHEMA" });
    expect(validateModelAdjustment("not json", bundle)).toEqual({ ok: false, code: "SCHEMA" });
    expect(validateModelAdjustment({ ...good(), reasonCodes: Array.from({ length: 4000 }, () => "OTHER") }, bundle)).toEqual({ ok: false, code: "TOO_LARGE" });
  });

  it("the mock model respects the catalog-level constraints it can see, and 'last' picks the last offered alternative", () => {
    const last = mockAdjustment(bundle.context, "mock-last");
    expect(last.operations[0].replacement).toBe(bundle.allowed[bundle.allowed.length - 1]);
  });
});
