import { describe, expect, it } from "vitest";
import { generate, proposeProgression, type Dose, type ExposureLog, type WeeklyProgression } from "@/modules/prescricao/motor";
import { baseInput, CATALOG, codes, parameters, structure } from "./helpers/motor-fixtures";

const oneWorkout = (weeks: number, sessions = 1, stimulus?: string) =>
  structure("2026-11-09", [{ weeks, sessionsPerWeek: sessions, ...(stimulus ? { stimulus } : {}), workouts: [{ label: "A", exerciseTarget: 2, focus: { patterns: ["SQUAT", "HORIZONTAL_PUSH"] } }] }]);

function run(progression: WeeklyProgression, weeks = 4, sessions = 1, stimulus: string | undefined = "HYPERTROPHY") {
  return generate(baseInput({ structure: oneWorkout(weeks, sessions, stimulus), parameters: parameters({ progressionByPhase: [{ phaseIndex: 1, progression }] }) }));
}
const firstDose = (r: ReturnType<typeof generate>, week: number, slot = 1) => r.occurrences.find((o) => o.week === week && o.slot === slot)!.items[0].dose!;

describe("motor: progressões semanais (tópico 8)", () => {
  it("LINEAR: rampa de séries e repetições da semana 1 à última, com base do profissional", () => {
    const r = run({ model: "LINEAR", ramps: [{ param: "sets", from: 2, to: 5 }, { param: "repsMin", from: 12, to: 6 }, { param: "repsMax", from: 15, to: 8 }] });
    const sets = [1, 2, 3, 4].map((w) => { const d = firstDose(r, w); return d.metric === "REPS" ? [d.sets, d.reps.min, d.reps.max] : null; });
    expect(sets).toEqual([[2, 12, 15], [3, 10, 13], [4, 8, 10], [5, 6, 8]]);
    const trace = r.occurrences[3].items[0].trace.params.find((p) => p.param === "sets")!;
    expect(trace.basis).toBe("PROFESSIONAL");
    expect(r.rulesUsed.map((u) => u.ruleId)).toContain("LINEAR_ROUNDING");
    expect(r.status).toBe("SUCCEEDED");
  });

  it("STEP com limite e descarga (séries × 0 → 0, regra citada)", () => {
    const r = run({ model: "STEP", steps: [{ param: "sets", delta: 1, everyWeeks: 1, limit: 5 }], deload: { weeks: [4], setsMultiplier: 0 } }, 4);
    const s = [1, 2, 3, 4].map((w) => { const d = firstDose(r, w); return d.metric === "REPS" ? d.sets : -1; });
    expect(s).toEqual([3, 4, 5, 0]);
    const t = r.occurrences[3].items[0].trace.params.find((p) => p.param === "sets")!;
    expect(t.ruleId).toBe("DELOAD_ROUNDING");
    expect(r.occurrences[3].items[0].display.sets).toBe("0");
  });

  it("descarga com multiplicador: arredonda e mantém o resto", () => {
    const r = run({ model: "NONE", deload: { weeks: [3], setsMultiplier: 0.5, patch: { values: { rirMin: 3, rirMax: 4 } } } }, 3);
    const d = firstDose(r, 3);
    expect(d.metric === "REPS" && [d.sets, d.intensity]).toEqual([2, { kind: "RIR", range: { min: 3, max: 4 } }]);
  });

  it("SEQUENCE por semana alterna estímulos e as doses mudam com eles", () => {
    const r = run({ model: "SEQUENCE", sequence: { per: "WEEK", stimuli: ["STRENGTH", "HYPERTROPHY"] } }, 4, 1, undefined);
    expect(r.occurrences.map((o) => o.stimulus?.value)).toEqual(["STRENGTH", "HYPERTROPHY", "STRENGTH", "HYPERTROPHY"]);
    const reps = [1, 2].map((w) => { const d = firstDose(r, w); return d.metric === "REPS" ? d.reps : null; });
    expect(reps).toEqual([{ min: 3, max: 6 }, { min: 8, max: 12 }]);
  });

  it("SEQUENCE dentro da semana (ondulatória diária) para o mesmo treino", () => {
    const r = run({ model: "SEQUENCE", sequence: { per: "OCCURRENCE_IN_WEEK", stimuli: ["STRENGTH", "HYPERTROPHY", "POWER"] } }, 2, 3, undefined);
    expect(r.occurrences.filter((o) => o.week === 1).map((o) => o.stimulus?.value)).toEqual(["STRENGTH", "HYPERTROPHY", "POWER"]);
  });

  it("BLOCK: blocos somam as semanas; soma errada bloqueia", () => {
    const ok = run({ model: "BLOCK", blocks: [{ weeks: 2, stimulus: "HYPERTROPHY" }, { weeks: 2, stimulus: "STRENGTH" }] }, 4, 1, undefined);
    expect(ok.occurrences.map((o) => o.stimulus?.value)).toEqual(["HYPERTROPHY", "HYPERTROPHY", "STRENGTH", "STRENGTH"]);
    const bad = run({ model: "BLOCK", blocks: [{ weeks: 3, stimulus: "HYPERTROPHY" }] }, 4, 1);
    expect(codes(bad)).toContain("PROGRESSION_INVALID");
    expect(bad.validation).toBe("BLOCKED");
  });

  it("CUSTOM: ajuste de uma semana específica (inclusive intensidade e método)", () => {
    const r = run({ model: "CUSTOM", weekOverrides: [{ week: 2, patch: { values: { restSeconds: 120 }, tempo: "3-1-1", method: { kind: "DROP_SET" } } }] }, 3);
    const d2 = firstDose(r, 2);
    expect(d2.metric === "REPS" && [d2.restSeconds, d2.tempo, d2.method?.kind]).toEqual([120, "3-1-1", "DROP_SET"]);
    expect(r.occurrences[1].items[0].display.doseText).toContain("Drop-set");
    expect(firstDose(r, 1).metric === "REPS" && (firstDose(r, 1) as { restSeconds: number }).restSeconds).toBe(90);
  });

  it.each([
    [{ model: "LINEAR", ramps: [{ param: "sets", from: Number.NaN, to: 4 }] }],
    [{ model: "LINEAR" }],
    [{ model: "SEQUENCE", sequence: { per: "WEEK", stimuli: [] } }],
    [{ model: "STEP", steps: [{ param: "sets", delta: 1, everyWeeks: 0 }] }],
    [{ model: "NONE", deload: { weeks: [9], setsMultiplier: 0.5 } }],
    [{ model: "NONE", deload: { weeks: [1], setsMultiplier: 2 } }],
  ] as Array<[WeeklyProgression]>)("progressão inválida vira PROGRESSION_INVALID (BLOCKED), sem lançar: %j", (p) => {
    const r = run(p);
    expect(codes(r)).toContain("PROGRESSION_INVALID");
    expect(r.status).toBe("INFEASIBLE");
  });

  it("rampa que cruza mínimo e máximo produz dose inválida, não um número silencioso", () => {
    const r = run({ model: "LINEAR", ramps: [{ param: "repsMin", from: 8, to: 20 }] }, 3);
    expect(codes(r)).toContain("DOSE_INVALID");
    expect(r.validation).toBe("BLOCKED");
  });

  it("progressão só sobre uma métrica (rampa com metric) não mexe em exercícios de tempo", () => {
    const st = structure("2026-11-09", [{ weeks: 2, sessionsPerWeek: 1, stimulus: "HYPERTROPHY", workouts: [{ label: "A", exerciseTarget: 2, focus: { patterns: ["ANTI_EXTENSION", "HORIZONTAL_PUSH"] } }] }]);
    const r = generate(baseInput({ structure: st, parameters: parameters({ progressionByPhase: [{ phaseIndex: 1, progression: { model: "LINEAR", ramps: [{ param: "sets", from: 3, to: 6, metric: "REPS" }] } }] }) }));
    const plank = r.occurrences[1].items.find((i) => i.exerciseId === "ex-plank")!;
    expect(plank.dose?.metric === "TIME" && plank.dose.sets).toBe(3);
  });
});

describe("motor: ajuste pelo histórico (sugestão, nunca valor)", () => {
  const legpress = CATALOG.find((e) => e.id === "ex-legpress")!;
  const dose: Dose = { metric: "REPS", sets: 2, reps: { min: 8, max: 12 }, intensity: { kind: "RIR", range: { min: 1, max: 3 } }, restSeconds: 90, loadBasis: "TOTAL", loadKg: null };
  const log = (date: string, reps: number, rir: number | null, load: number | null = 100, extra: Partial<ExposureLog> = {}): ExposureLog => ({
    exerciseId: "ex-legpress", date, equipmentKey: "m1", metric: "REPS", pain: false,
    sets: [1, 2].map(() => ({ reps, durationSeconds: null, loadKg: load, loadBasis: "TOTAL", rir, completed: true })), ...extra,
  });
  const settings = { consecutiveSuccesses: 2, maximumIncrementFraction: 0.1, incrementKg: 5 as number | null, windowDays: 180 };

  it("guarda-corpos: dor → REVIEW; poucos dados → INSUFFICIENT_DATA; sem RIR → INSUFFICIENT_DATA", () => {
    expect(proposeProgression([log("2026-10-01", 12, 2, 100, { pain: true })], legpress, dose, settings, "2026-11-04").action).toBe("REVIEW");
    expect(proposeProgression([log("2026-10-01", 12, 2)], legpress, dose, settings, "2026-11-04").action).toBe("INSUFFICIENT_DATA");
    expect(proposeProgression([log("2026-10-01", 12, null), log("2026-10-05", 12, null)], legpress, dose, settings, "2026-11-04").action).toBe("INSUFFICIENT_DATA");
    expect(proposeProgression([], legpress, dose, settings, "2026-11-04").action).toBe("INSUFFICIENT_DATA");
  });

  it("topo da faixa com esforço → INCREASE só com incremento informado e dentro do teto", () => {
    const top = [log("2026-10-01", 12, 2), log("2026-10-05", 12, 2)];
    expect(proposeProgression(top, legpress, dose, settings, "2026-11-04")).toMatchObject({ action: "INCREASE", suggestedLoadKg: 105 });
    expect(proposeProgression(top, legpress, dose, { ...settings, incrementKg: null }, "2026-11-04")).toMatchObject({ action: "MAINTAIN", suggestedLoadKg: 100, basis: "STUDENT_DATA" });
    expect(proposeProgression(top, legpress, dose, { ...settings, incrementKg: 20 }, "2026-11-04").action).toBe("MAINTAIN");
    expect(proposeProgression([log("2026-10-01", 10, 2), log("2026-10-05", 12, 2)], legpress, dose, settings, "2026-11-04").action).toBe("MAINTAIN");
  });

  it("registros fora da janela ou depois da data de referência não contam", () => {
    const top = [log("2025-01-01", 12, 2), log("2025-01-05", 12, 2)];
    expect(proposeProgression(top, legpress, dose, settings, "2026-11-04").action).toBe("INSUFFICIENT_DATA");
    expect(proposeProgression([log("2026-12-01", 12, 2), log("2026-12-05", 12, 2)], legpress, dose, settings, "2026-11-04").action).toBe("INSUFFICIENT_DATA");
  });

  it("na geração: continuidade pesa na seleção e a sugestão aparece sem mudar a dose", () => {
    const three = (date: string) => log(date, 12, 2, 100, { sets: [1, 2, 3].map(() => ({ reps: 12, durationSeconds: null, loadKg: 100, loadBasis: "TOTAL" as const, rir: 2, completed: true })) });
    const history = [three("2026-10-01"), three("2026-10-05")];
    const r = generate(baseInput({ history }));
    const s = r.historySuggestions.find((h) => h.exerciseId === "ex-legpress")!;
    expect(s.proposal.action).toBe("MAINTAIN"); // incremento do equipamento não informado
    const item = r.occurrences.flatMap((o) => o.items).find((i) => i.exerciseId === "ex-legpress")!;
    expect(item.dose?.metric === "REPS" && item.dose.loadKg).toBeNull();
    expect(item.trace.selection.map((t) => t.code)).toContain("HISTORY_CONTINUITY");
    expect(item.trace.selection.find((t) => t.code === "HISTORY_CONTINUITY")!.basis).toBe("STUDENT_DATA");
  });
});
