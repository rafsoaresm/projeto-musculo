/**
 * Motor V4, PR 3.3: o que o profissional decidiu sobrevive a trocar, regenerar e trazer a revisão (rebase) com os perfis de dose
 * (regras 2026.11.6), e o tempo disponível continua sendo só informado (o motor não corta descanso nem exercício).
 *  - troca: a dose do exercício novo vem do perfil dele; ajuste do profissional que vale para ele é reaplicado, o que nomeia o exercício
 *    trocado não acompanha outro exercício;
 *  - regenerar/continuar/rebase: ajustes, linhas travadas e preservadas mantêm as decisões; fora do escopo nada muda;
 *  - tempo: perfis alongam o descanso, então `OVER_TIME_BUDGET` pode aparecer onde o padrão genérico cabia; a decisão fica com o profissional.
 */
import { describe, expect, it } from "vitest";
import {
  generate, rebase, regenerate, substitute, toDisplayFields, type Dose, type DoseOverride, type EngineInput, type EngineResult, type ExistingItem, type ItemOut, type OccurrenceOut,
} from "@/modules/prescricao/motor";
import { baseInput, exercise, parameters, structure } from "./helpers/motor-fixtures";
import { xintusInput } from "./helpers/xintus";

const V6 = { id: "gymgital-base", version: "2026.11.6" } as const;
const V5 = { id: "gymgital-base", version: "2026.11.5" } as const;

const restOf = (i: ItemOut) => (i.dose?.metric === "REPS" ? i.dose.restSeconds : null);
const repsOf = (i: ItemOut) => (i.dose?.metric === "REPS" ? `${i.dose.reps.min}-${i.dose.reps.max}` : null);
const profileOf = (i: ItemOut) => i.trace.params.find((p) => p.profileId)?.profileId ?? null;
const traceOf = (i: ItemOut, param: string) => i.trace.params.find((p) => p.param === param);
const occ = (r: EngineResult, phaseIndex: number, week: number, slot: number): OccurrenceOut => r.occurrences.find((o) => o.phaseIndex === phaseIndex && o.week === week && o.slot === slot)!;
const must = (out: ReturnType<typeof substitute>): EngineResult => {
  if (!out.ok) throw new Error(`${out.code}: ${out.message}`);
  return out.result;
};

// Quatro exercícios com perfis diferentes (pesado, moderado, isolamento, região pequena) numa sessão por semana.
const squat = exercise({ id: "e-squat", name: "Agachamento", primaryMuscles: ["QUADRICEPS", "GLUTEUS"], patterns: ["SQUAT"], compound: true, difficulty: 3, equipment: [] });
const press = exercise({ id: "e-press", name: "Supino", primaryMuscles: ["CHEST"], patterns: ["HORIZONTAL_PUSH"], compound: true, difficulty: 2, equipment: [] });
const curl = exercise({ id: "e-curl", name: "Rosca", primaryMuscles: ["BICEPS"], patterns: ["ELBOW_FLEXION"], compound: false, difficulty: 1, equipment: [] });
const curl2 = exercise({ id: "e-curl2", name: "Rosca martelo", primaryMuscles: ["BICEPS"], patterns: ["ELBOW_FLEXION"], compound: false, difficulty: 1, equipment: [] });
const calf = exercise({ id: "e-calf", name: "Panturrilha", primaryMuscles: ["CALVES"], patterns: ["PLANTAR_FLEXION"], compound: false, difficulty: 1, equipment: [] });
const CATALOG = [squat, press, curl, curl2, calf];

const small = (over: Partial<EngineInput> = {}) => baseInput({
  rules: V6, catalog: CATALOG,
  structure: structure("2026-11-09", [{ weeks: 4, sessionsPerWeek: 2, stimulus: "HYPERTROPHY", rotation: ["A", "B"], workouts: [{ label: "A", exerciseTarget: 3 }, { label: "B", exerciseTarget: 3 }] }]),
  ...over,
});
/** Dose esperada do perfil de cada isolamento do catálogo (perfil, repetições, descanso). */
const ISOLATION: Record<string, { profile: string; reps: string; rest: number }> = {
  "e-calf": { profile: "HYP_ISOLATION_HIGH_REP", reps: "12-20", rest: 60 },
  "e-curl": { profile: "HYP_ISOLATION", reps: "10-15", rest: 75 },
  "e-curl2": { profile: "HYP_ISOLATION", reps: "10-15", rest: 75 },
};
/** Um isolamento que o treino A não usa em nenhuma semana (a troca na fase toda não pode repetir exercício). */
const spareFor = (r: EngineResult): string => {
  const used = new Set(r.occurrences.filter((o) => o.label === "A").flatMap((o) => o.items.map((i) => i.exerciseId)));
  const spare = Object.keys(ISOLATION).find((id) => !used.has(id));
  if (!spare) throw new Error("o treino A usa todos os isolamentos do catálogo");
  return spare;
};

describe("troca de exercício com perfis de dose", () => {
  const input = small();
  const first = generate(input);
  const a1 = occ(first, 1, 1, 1);
  const swapTarget = (it: ItemOut) => ({ phaseIndex: 1, slotKey: it.slotKey, applies: { kind: "PHASE" } as const });

  it("a dose do exercício novo vem do perfil dele, não do que foi trocado", () => {
    const heavy = a1.items.find((i) => i.exerciseId === "e-squat");
    expect(heavy, "a sessão A tem o agachamento").toBeTruthy();
    expect(restOf(heavy!)).toBe(150);
    const spare = spareFor(first);
    const want = ISOLATION[spare];
    const now = must(substitute(input, first, swapTarget(heavy!), spare));
    for (const week of [1, 2, 3, 4]) {
      const item = occ(now, 1, week, 1).items.find((i) => i.exerciseId === spare)!;
      expect(item.origin).toBe("SUBSTITUTED");
      expect(profileOf(item)).toBe(want.profile);
      expect(restOf(item)).toBe(want.rest);
      expect(repsOf(item)).toBe(want.reps);
      expect(item.dose && "loadKg" in item.dose ? item.dose.loadKg : null).toBeNull();
      expect(item.trace.params.filter((p) => p.profileId).every((p) => p.basis === "HEURISTIC")).toBe(true);
    }
  });

  it("o ajuste do profissional que vale para o exercício novo é reaplicado (por especificidade), só no parâmetro que ele escreveu", () => {
    const override: DoseOverride = { stimulus: "HYPERTROPHY", patch: { values: { restSeconds: 100 } } };
    const withOverride = small({ parameters: parameters({ doseOverrides: [override] }) });
    const base = generate(withOverride);
    const heavy = occ(base, 1, 1, 1).items.find((i) => i.exerciseId === "e-squat")!;
    expect(restOf(heavy)).toBe(100);
    expect(traceOf(heavy, "restSeconds")).toMatchObject({ basis: "PROFESSIONAL" });
    const spare = spareFor(base);
    const now = must(substitute(withOverride, base, swapTarget(heavy), spare));
    const item = occ(now, 1, 2, 1).items.find((i) => i.exerciseId === spare)!;
    expect(restOf(item)).toBe(100);
    expect(traceOf(item, "restSeconds")).toMatchObject({ basis: "PROFESSIONAL" });
    expect(repsOf(item)).toBe(ISOLATION[spare].reps);
    expect(traceOf(item, "repsMin")).toMatchObject({ basis: "HEURISTIC", profileId: ISOLATION[spare].profile });
  });

  it("o ajuste que nomeia o exercício trocado não acompanha o exercício novo (e volta se o antigo voltar)", () => {
    const named: DoseOverride = { exerciseId: "e-squat", patch: { values: { restSeconds: 200 } } };
    const inp = small({ parameters: parameters({ doseOverrides: [named] }) });
    const base = generate(inp);
    const heavy = occ(base, 1, 1, 1).items.find((i) => i.exerciseId === "e-squat")!;
    expect(restOf(heavy)).toBe(200);
    const spare = spareFor(base);
    const swapped = must(substitute(inp, base, swapTarget(heavy), spare));
    const spareItem = occ(swapped, 1, 1, 1).items.find((i) => i.exerciseId === spare)!;
    expect(restOf(spareItem)).toBe(ISOLATION[spare].rest);
    expect(traceOf(spareItem, "restSeconds")?.basis).toBe("HEURISTIC");
    const back = must(substitute(inp, swapped, { phaseIndex: 1, slotKey: spareItem.slotKey, applies: { kind: "PHASE" } }, "e-squat"));
    expect(restOf(occ(back, 1, 1, 1).items.find((i) => i.exerciseId === "e-squat")!)).toBe(200);
  });

  it("a troca por um exercício sem metadado cai no padrão genérico, com o aviso refeito (sem número chutado)", () => {
    const unknown = exercise({ id: "e-unk", name: "Sem metadado", primaryMuscles: ["TRICEPS"], patterns: ["ELBOW_EXTENSION"], compound: null, difficulty: 1, equipment: [] });
    const inp = small({ catalog: [...CATALOG, unknown] });
    const base = generate(inp);
    const heavy = occ(base, 1, 1, 1).items.find((i) => i.exerciseId === "e-squat")!;
    const now = must(substitute(inp, base, swapTarget(heavy), "e-unk"));
    const item = occ(now, 1, 1, 1).items.find((i) => i.exerciseId === "e-unk")!;
    expect(profileOf(item)).toBeNull();
    expect(restOf(item)).toBe(90);
    expect(repsOf(item)).toBe("8-12");
    expect(traceOf(item, "profile")?.reasons).toEqual(["METADATA_MISSING:compound"]);
    expect(now.issues.filter((i) => i.code === "DOSE_PROFILE_UNCERTAIN" && i.label === "A")).toHaveLength(1);
  });
});

describe("regenerar, continuar e trazer a revisão mantêm as decisões do profissional", () => {
  const override: DoseOverride = { stimulus: "HYPERTROPHY", patch: { values: { restSeconds: 100 } } };
  const lockedInput = (first: EngineResult, slotKey: string): EngineInput => ({ ...small({ parameters: parameters({ doseOverrides: [override] }) }), locked: [{ phaseIndex: 1, slotKey }] , ...(first ? {} : {}) });

  it("ajustes do profissional valem para tudo o que o escopo refaz; fora do escopo a dose gravada fica como estava", () => {
    const plain = small();
    const first = generate(plain);
    expect(first.occurrences.flatMap((o) => o.items).some((i) => restOf(i) === 100)).toBe(false);
    const edited = small({ parameters: parameters({ doseOverrides: [override] }) });
    const week = must(regenerate(edited, first, { kind: "WEEK", phaseIndex: 1, week: 2 }));
    for (const o of week.occurrences) {
      const inScope = o.week === 2;
      for (const i of o.items.filter((x) => x.dose?.metric === "REPS")) {
        if (inScope) {
          expect(restOf(i)).toBe(100);
          expect(traceOf(i, "restSeconds")?.basis).toBe("PROFESSIONAL");
        } else {
          const before = first.occurrences.find((x) => x.week === o.week && x.slot === o.slot)!.items.find((x) => x.slotKey === i.slotKey)!;
          expect(i.dose).toEqual(before.dose);
        }
      }
    }
    const phase = must(regenerate(edited, first, { kind: "PHASE", phaseIndex: 1 }));
    expect(phase.occurrences.flatMap((o) => o.items).filter((i) => i.dose?.metric === "REPS").every((i) => restOf(i) === 100)).toBe(true);
    // O ajuste é só do descanso: repetições e RIR seguem o perfil de cada exercício.
    expect(new Set(phase.occurrences[0].items.map(repsOf)).size).toBeGreaterThan(1);
  });

  it("linha travada mantém a dose gravada ao regenerar; a destravada recebe o ajuste", () => {
    const first = generate(small());
    const target = occ(first, 1, 1, 1).items.find((i) => i.exerciseId === "e-squat")!;
    const input = lockedInput(first, target.slotKey);
    const out = must(regenerate(input, first, { kind: "PHASE", phaseIndex: 1 }));
    const kept = occ(out, 1, 1, 1).items.find((i) => i.slotKey === target.slotKey)!;
    expect(kept.origin).toBe("LOCKED");
    expect(kept.dose).toEqual(target.dose);
    expect(restOf(kept)).toBe(150);
    const others = occ(out, 1, 1, 1).items.filter((i) => i.slotKey !== target.slotKey && i.dose?.metric === "REPS");
    expect(others.length).toBeGreaterThan(0);
    expect(others.every((i) => restOf(i) === 100)).toBe(true);
  });

  it("a troca do profissional sobrevive à regeneração com a dose do perfil dele e o ajuste vigente", () => {
    const inp = small();
    const first = generate(inp);
    const heavy = occ(first, 1, 1, 1).items.find((i) => i.exerciseId === "e-squat")!;
    const spare = spareFor(first);
    const swapped = must(substitute(inp, first, { phaseIndex: 1, slotKey: heavy.slotKey, applies: { kind: "PHASE" } }, spare));
    const edited = small({ parameters: parameters({ doseOverrides: [override] }) });
    for (const scope of [{ kind: "PHASE", phaseIndex: 1 }, { kind: "WORKOUT", phaseIndex: 1, label: "A" }, { kind: "WEEK", phaseIndex: 1, week: 3 }] as const) {
      const out = must(regenerate(edited, swapped, scope));
      const touched = out.occurrences.filter((o) => o.label === "A" && (scope.kind !== "WEEK" || o.week === 3));
      expect(touched.length).toBeGreaterThan(0);
      for (const o of touched) {
        const item = o.items.find((i) => i.exerciseId === spare)!;
        expect(item.origin).toBe("SUBSTITUTED");
        expect(profileOf(item)).toBe(ISOLATION[spare].profile);
        expect(repsOf(item)).toBe(ISOLATION[spare].reps);
        expect(restOf(item)).toBe(100);
      }
    }
  });

  it("rebase: linhas atuais da revisão entram com a dose que têm; o que não é delas mantém a dose e o ajuste gravados", () => {
    const edited = small({ parameters: parameters({ doseOverrides: [override] }) });
    const first = generate(edited);
    const keptDoses = first.occurrences.map((o) => o.items.map((i) => i.dose));
    const dose: Dose = { metric: "REPS", sets: 5, reps: { min: 5, max: 5 }, restSeconds: 240, loadBasis: "TOTAL", loadKg: null };
    const existing: ExistingItem[] = [{
      phaseIndex: 1, label: "A", exerciseId: "e-press", name: "Supino", nameKey: "supino", prescribedExerciseId: "pe-1", position: 1, origin: "MANUAL",
      dose, display: toDisplayFields(dose),
    }];
    const out = must(rebase({ ...edited, existing }, first));
    const a = occ(out, 1, 1, 1);
    const pressItem = a.items.find((i) => i.exerciseId === "e-press")!;
    expect(pressItem.origin).toBe("PRESERVED");
    expect(restOf(pressItem)).toBe(240);
    for (const o of out.occurrences.filter((x) => x.label === "B"))
      expect(o.items.map((i) => i.dose)).toEqual(keptDoses[first.occurrences.findIndex((x) => x.week === o.week && x.slot === o.slot)]);
  });
});

describe("tempo disponível, duração e dose", () => {
  const at = (rules: typeof V5 | typeof V6, minutes: number, budget: "SOFT" | "HARD" = "SOFT") => {
    const inp = xintusInput(rules);
    return generate({ ...inp, parameters: { ...inp.parameters, availableMinutes: minutes, timeBudget: budget } });
  };
  const over = (r: EngineResult) => r.issues.filter((i) => i.code === "OVER_TIME_BUDGET");
  const maxMinutes = (r: EngineResult) => Math.max(...r.occurrences.map((o) => o.estimatedMinutes ?? 0));

  it("60 min: a sessão de 6 exercícios com descansos de perfil cabe no tempo, sem aviso", () => {
    const r = at(V6, 60);
    expect(maxMinutes(r)).toBeLessThanOrEqual(60);
    expect(over(r)).toEqual([]);
  });

  it("os perfis alongam a sessão frente ao padrão genérico (descanso do pesado e do moderado) sem mudar a seleção", () => {
    const v5 = at(V5, 60);
    const v6 = at(V6, 60);
    expect(maxMinutes(v6)).toBeGreaterThan(maxMinutes(v5));
    expect(v6.occurrences.map((o) => o.items.map((i) => i.exerciseId))).toEqual(v5.occurrences.map((o) => o.items.map((i) => i.exerciseId)));
  });

  it("sessão de até 45 min: o descanso do perfil encurta (TIME_BUDGET_SHORT, múltiplo de 5 s); o motor só avisa quando ainda passa e não corta nada", () => {
    const r = at(V6, 45);
    const reps = r.occurrences.flatMap((o) => o.items).filter((i) => i.dose?.metric === "REPS");
    expect(reps.every((i) => (restOf(i) as number) % 5 === 0)).toBe(true);
    expect(reps.some((i) => traceOf(i, "restSeconds")?.reasons?.includes("TIME_BUDGET_SHORT"))).toBe(true);
    const long = at(V6, 60);
    expect(Math.max(...reps.map((i) => restOf(i) as number))).toBeLessThan(Math.max(...long.occurrences.flatMap((o) => o.items).map((i) => restOf(i) ?? 0)));
    // Nenhum exercício foi tirado nem descanso zerado para caber; o que passa vira aviso (atenção), nunca erro no modo flexível.
    expect(r.occurrences.every((o) => o.items.length === 6)).toBe(true);
    for (const issue of over(r)) expect(issue.severity).toBe("WARNING");
    expect(over(r).length).toBeGreaterThan(0);
    // No padrão genérico a mesma sessão cabia: a diferença é causada pelos perfis e está dita no aviso.
    expect(over(at(V5, 45))).toEqual([]);
  });

  it("modo rígido (HARD): o que passa do tempo é erro, também com perfis", () => {
    const r = at(V6, 45, "HARD");
    expect(over(r).length).toBeGreaterThan(0);
    expect(over(r).every((i) => i.severity === "ERROR")).toBe(true);
  });

  it("o tempo do treino na estrutura vale mais que o do aluno: o encurtamento segue o tempo do treino", () => {
    const base = xintusInput(V6);
    const phase = (minutes?: number) => ({ ...base.structure.phases[0], workouts: base.structure.phases[0].workouts.map((w) => ({ ...w, focus: { ...w.focus, ...(minutes ? { minutes } : {}) } })) });
    const withMinutes = (minutes: number) => generate({ ...base, structure: { ...base.structure, phases: [phase(minutes), ...base.structure.phases.slice(1)] } });
    const short = withMinutes(40).occurrences.find((o) => o.phaseIndex === 1)!;
    const normal = generate(base).occurrences.find((o) => o.phaseIndex === 1)!;
    expect(short.budgetSource).toBe("WORKOUT");
    expect(normal.budgetMinutes).toBe(60);
    const rests = (o: OccurrenceOut) => o.items.map(restOf);
    expect(Math.max(...(rests(short) as number[]))).toBeLessThan(Math.max(...(rests(normal) as number[])));
  });
});
