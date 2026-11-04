import { describe, expect, it } from "vitest";
import {
  alternativesFor, canonicalJson, generate, parseSlotKey, rebase, regenerate, substitute, toDisplayFields,
  type EngineInput, type EngineOutcome, type EngineResult, type ExistingItem, type OccurrenceOut,
} from "@/modules/prescricao/motor";
import { baseInput, codes, parameters } from "./helpers/motor-fixtures";

const ok = (o: EngineOutcome): EngineResult => {
  if (!o.ok) throw new Error(`${o.code}: ${o.message}`);
  return o.result;
};
const key = (o: OccurrenceOut) => `${o.phaseIndex}|${o.week}|${o.slot}`;
const ids = (o: OccurrenceOut) => o.items.map((i) => i.exerciseId).join(",");
const doses = (o: OccurrenceOut) => canonicalJson(o.items.map((i) => i.dose));

/** Mudança de parâmetro que altera todas as doses: muda só o que estiver no escopo regenerado. */
function changed(input: EngineInput): EngineInput {
  return { ...input, parameters: parameters({ doseOverrides: [{ patch: { values: { restSeconds: 150 } } }] }) };
}

describe("motor: regeneração parcial (tópico 9)", () => {
  const input = baseInput();
  const before = generate(input);
  const after = changed(input);

  const cases: Array<[string, Parameters<typeof regenerate>[2], (o: OccurrenceOut) => boolean]> = [
    ["sessão", { kind: "OCCURRENCE", phaseIndex: 1, week: 2, slot: 3 }, (o) => o.phaseIndex === 1 && o.week === 2 && o.slot === 3],
    ["semana", { kind: "WEEK", phaseIndex: 1, week: 3 }, (o) => o.phaseIndex === 1 && o.week === 3],
    ["treino a partir da semana", { kind: "WORKOUT", phaseIndex: 1, label: "B", fromWeek: 2 }, (o) => o.phaseIndex === 1 && o.label === "B" && o.week >= 2],
    ["fase", { kind: "PHASE", phaseIndex: 2 }, (o) => o.phaseIndex === 2],
    ["desta fase em diante", { kind: "FROM_PHASE", phaseIndex: 1 }, () => true],
  ];

  it.each(cases)("%s: muda só o que está no escopo", (_n, scope, inScope) => {
    const r = ok(regenerate(after, before, scope));
    expect(r.occurrences.map(key)).toEqual(before.occurrences.map(key));
    for (const [i, o] of r.occurrences.entries()) {
      const prev = before.occurrences[i];
      if (inScope(o)) expect(doses(o), key(o)).not.toBe(doses(prev));
      else expect(canonicalJson(o), key(o)).toBe(canonicalJson(prev));
    }
  });

  it("travados ficam como estavam (dose antiga) e preservados não mudam", () => {
    const occ = before.occurrences[0];
    const lockedKey = occ.items[1].slotKey;
    const existing: ExistingItem[] = [{
      prescribedExerciseId: "pe-1", phaseIndex: 1, label: "A", exerciseId: null, name: "Exercício do profissional", position: 1,
      dose: null, display: { ...toDisplayFields(null), sets: "3", reps: "10", doseText: "3 × 10" }, origin: "PROFESSIONAL",
    }];
    const withRows = { ...input, existing };
    const base = generate(withRows);
    const r = ok(regenerate({ ...changed(withRows), locked: [{ phaseIndex: 1, slotKey: lockedKey }] }, base, { kind: "PHASE", phaseIndex: 1 }));
    const first = r.occurrences[0];
    const locked = first.items.find((i) => i.slotKey === lockedKey)!;
    expect(locked.origin).toBe("LOCKED");
    expect(canonicalJson(locked.dose)).toBe(canonicalJson(base.occurrences[0].items.find((i) => i.slotKey === lockedKey)!.dose));
    const preserved = first.items.find((i) => i.origin === "PRESERVED")!;
    expect(preserved).toMatchObject({ existingPrescribedExerciseId: "pe-1", exerciseName: "Exercício do profissional", position: 1 });
    expect(preserved.display.doseText).toBe("3 × 10");
    // a linha preservada conta para a quantidade (4): o motor completa com 3
    expect(first.items).toHaveLength(4);
  });

  it("item: o motor escolhe outro exercício só naquela sessão, com proveniência", () => {
    const occ = before.occurrences[0];
    const old = occ.items[0];
    const r = ok(regenerate(input, before, { kind: "ITEM", phaseIndex: 1, week: 1, slot: 1, slotKey: old.slotKey }));
    const now = r.occurrences[0].items[0];
    expect(now.exerciseId).not.toBe(old.exerciseId);
    expect(now.substitutesSlotKey).toBe(old.slotKey);
    expect(now.position).toBe(old.position);
    expect(new Set(r.occurrences[0].items.map((i) => i.exerciseId)).size).toBe(r.occurrences[0].items.length);
    expect(ids(r.occurrences[3])).toBe(ids(before.occurrences[3])); // mesma sessão na semana 2 não mudou
  });

  it("escopo inexistente devolve motivo, sem lançar", () => {
    expect(regenerate(input, before, { kind: "WEEK", phaseIndex: 1, week: 9 })).toMatchObject({ ok: false, code: "SCOPE_NOT_FOUND" });
    expect(regenerate(input, before, { kind: "PHASE", phaseIndex: 7 })).toMatchObject({ ok: false, code: "SCOPE_NOT_FOUND" });
    expect(regenerate(input, before, { kind: "ITEM", phaseIndex: 1, week: 1, slot: 1, slotKey: "x" })).toMatchObject({ ok: false, code: "TARGET_NOT_FOUND" });
  });

  it("geração em partes (fase a fase) chega ao mesmo resultado da geração completa", () => {
    const p1 = generate({ ...input, scope: { kind: "PHASES", phaseIndexes: [1] } });
    const all = ok(regenerate(input, p1, { kind: "PHASE", phaseIndex: 2 }));
    expect(canonicalJson(all.occurrences)).toBe(canonicalJson(before.occurrences));
  });

  it("avisos são recalculados: um ajuste que cabe no tempo some com o aviso", () => {
    const tight = { ...input, parameters: parameters({ availableMinutes: 25 }) };
    const r1 = generate(tight);
    expect(codes(r1)).toContain("OVER_TIME_BUDGET");
    const fewer = { ...tight, parameters: parameters({ availableMinutes: 25, doseOverrides: [{ patch: { values: { sets: 1, restSeconds: 30 } } }] }) };
    const r2 = ok(regenerate(fewer, r1, { kind: "FROM_PHASE", phaseIndex: 1 }));
    expect(codes(r2)).not.toContain("OVER_TIME_BUDGET");
  });
});

describe("motor: substituição de exercícios (tópico 10)", () => {
  const input = baseInput();
  const before = generate(input);
  const a1 = before.occurrences.find((o) => o.phaseIndex === 1 && o.label === "A")!;
  const target = a1.items.find((i) => i.exerciseId === "ex-legpress")!;

  it("na sessão: troca só aquela, nova chave com proveniência, dose recalculada", () => {
    const r = ok(substitute(input, before, { phaseIndex: 1, slotKey: target.slotKey, applies: { kind: "OCCURRENCE", week: 1, slot: 1 } }, "ex-goblet"));
    const now = r.occurrences[0].items.find((i) => i.exerciseId === "ex-goblet")!;
    expect(now).toMatchObject({ origin: "SUBSTITUTED", substitutesSlotKey: target.slotKey, position: target.position });
    expect(parseSlotKey(now.slotKey)).toMatchObject({ phaseIndex: 1, label: "A", exerciseId: "ex-goblet" });
    expect(now.trace.selection[0]).toMatchObject({ code: "PROFESSIONAL_SUBSTITUTION", basis: "PROFESSIONAL" });
    expect(now.dose).not.toBeNull();
    const other = r.occurrences.find((o) => o.phaseIndex === 1 && o.label === "A" && o.week === 2)!;
    expect(other.items.some((i) => i.exerciseId === "ex-legpress")).toBe(true);
  });

  it("a partir da semana 3 e na fase inteira", () => {
    const from = ok(substitute(input, before, { phaseIndex: 1, slotKey: target.slotKey, applies: { kind: "FROM_WEEK", week: 3 } }, "ex-goblet"));
    const a = from.occurrences.filter((o) => o.phaseIndex === 1 && o.label === "A");
    expect(a.map((o) => o.items.some((i) => i.exerciseId === "ex-goblet"))).toEqual([false, false, true, true]);
    const phase = ok(substitute(input, before, { phaseIndex: 1, slotKey: target.slotKey, applies: { kind: "PHASE" } }, "ex-goblet"));
    expect(phase.occurrences.filter((o) => o.phaseIndex === 1 && o.label === "A").every((o) => o.items.some((i) => i.exerciseId === "ex-goblet"))).toBe(true);
    expect(phase.occurrences.filter((o) => o.phaseIndex === 2).map(ids)).toEqual(before.occurrences.filter((o) => o.phaseIndex === 2).map(ids));
  });

  it("troca para outra métrica recalcula o formato da dose (repetições → distância)", () => {
    const r = ok(substitute(input, before, { phaseIndex: 1, slotKey: target.slotKey, applies: { kind: "PHASE" } }, "ex-sled"));
    const sled = r.occurrences[0].items.find((i) => i.exerciseId === "ex-sled")!;
    expect(sled.dose?.metric).toBe("DISTANCE");
    expect(sled.display.doseText).toMatch(/× 20–40 m/);
    expect(codes(r)).toContain("DURATION_UNKNOWN"); // distância sem ritmo: duração não suposta
  });

  it("recusa: exercício fora da biblioteca, inelegível, repetido na sessão, item inexistente", () => {
    const t = { phaseIndex: 1, slotKey: target.slotKey, applies: { kind: "PHASE" as const } };
    expect(substitute(input, before, t, "ex-de-outra-org")).toMatchObject({ ok: false, code: "EXERCISE_NOT_IN_CATALOG" });
    expect(substitute(input, before, t, "ex-bike")).toMatchObject({ ok: false, code: "REPLACEMENT_INELIGIBLE" });
    const noBar = { ...input, parameters: parameters({ availableEquipment: ["MACHINE"] }) };
    expect(substitute(noBar, before, t, "ex-squat")).toMatchObject({ ok: false, code: "REPLACEMENT_INELIGIBLE" });
    const sibling = a1.items.find((i) => i.exerciseId !== "ex-legpress")!.exerciseId!;
    expect(substitute(input, before, t, sibling)).toMatchObject({ ok: false, code: "REPLACEMENT_DUPLICATE" });
    expect(substitute(input, before, { ...t, slotKey: JSON.stringify([1, "A", "ex-nada", 0]) }, "ex-goblet")).toMatchObject({ ok: false, code: "TARGET_NOT_FOUND" });
  });

  it("alternativas excluem o que já está na sessão e vêm ordenadas, com motivos", () => {
    const alts = alternativesFor(input, before, { phaseIndex: 1, slotKey: target.slotKey, week: 1, slot: 1 }, 10);
    const inSession = new Set(a1.items.map((i) => i.exerciseId));
    expect(alts.length).toBeGreaterThan(0);
    for (const a of alts) {
      expect(inSession.has(a.exerciseId)).toBe(false);
      expect(a.reasons.length).toBeGreaterThan(0);
    }
    const scores = alts.map((a) => a.score);
    expect([...scores].sort((x, y) => y - x)).toEqual(scores);
  });

  it("substituir uma linha preservada avisa que aplicar exige confirmação", () => {
    const existing: ExistingItem[] = [{ prescribedExerciseId: "pe-9", phaseIndex: 1, label: "A", exerciseId: "ex-legpress", name: "Leg press", position: 1, dose: null, display: toDisplayFields(null), origin: "PROFESSIONAL" }];
    const withRows = { ...input, existing };
    const base = generate(withRows);
    const row = base.occurrences[0].items.find((i) => i.origin === "PRESERVED")!;
    const r = ok(substitute(withRows, base, { phaseIndex: 1, slotKey: row.slotKey, applies: { kind: "PHASE" } }, "ex-goblet"));
    expect(codes(r)).toContain("EXISTING_ROW_REPLACED");
  });

  it("rebase traz as linhas atuais da revisão e remove repetições do motor", () => {
    const existing: ExistingItem[] = [{ prescribedExerciseId: "pe-2", phaseIndex: 1, label: "A", exerciseId: "ex-legpress", name: "Leg press (ajustado)", position: 1, dose: null, display: { ...toDisplayFields(null), doseText: "4 × 6" }, origin: "PROFESSIONAL" }];
    const r = ok(rebase({ ...input, existing }, before));
    const a = r.occurrences[0];
    expect(a.items[0]).toMatchObject({ origin: "PRESERVED", existingPrescribedExerciseId: "pe-2", position: 1 });
    expect(a.items.filter((i) => i.exerciseId === "ex-legpress")).toHaveLength(1);
    expect(a.items.map((i) => i.position)).toEqual(a.items.map((_, n) => n + 1));
  });
});
