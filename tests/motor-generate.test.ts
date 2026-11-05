import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalInput, canonicalJson, generate, sha256Hex, type EngineInput, type ItemOut } from "@/modules/prescricao/motor";
import { AUDIT_RULES, baseInput, CATALOG, codes, exercise, parameters, structure } from "./helpers/motor-fixtures";

const items = (r: ReturnType<typeof generate>): ItemOut[] => r.occurrences.flatMap((o) => o.items);

describe("motor: geração completa a partir de uma periodização (tópico 1)", () => {
  const input = baseInput();
  const r = generate(input);

  it("gera todas as ocorrências de todas as fases, com dose e texto", () => {
    expect(r.status).toBe("SUCCEEDED");
    expect(r.requiresProfessionalReview).toBe(true);
    // fase 1: 4 semanas × 3 sessões; fase 2: 3 × 2
    expect(r.occurrences).toHaveLength(12 + 6);
    expect(r.occurrences.filter((o) => o.phaseIndex === 1).map((o) => o.label).slice(0, 3)).toEqual(["A", "B", "C"]);
    for (const o of r.occurrences) {
      const w = input.structure.phases.find((p) => p.index === o.phaseIndex)!.workouts.find((x) => x.label === o.label)!;
      expect(o.items).toHaveLength(w.exerciseTarget!);
      expect(o.plannedDate).not.toBeNull();
      expect(o.estimatedMinutes).toBeGreaterThan(0);
      expect(o.budgetMinutes).toBe(90);
    }
    for (const i of items(r)) {
      expect(i.dose).not.toBeNull();
      expect(i.display.doseText.length).toBeGreaterThan(5);
      if (i.dose?.metric === "REPS") expect(i.dose.loadKg).toBeNull();
      expect(i.origin).toBe("ENGINE");
      expect(input.catalog.some((e) => e.id === i.exerciseId)).toBe(true);
    }
  });

  it("datas previstas seguem os dias de treino da estrutura", () => {
    const first = r.occurrences.filter((o) => o.phaseIndex === 1 && o.week === 1).map((o) => o.plannedDate);
    expect(first).toEqual(["2026-11-09", "2026-11-11", "2026-11-13"]);
    const p2 = r.occurrences.find((o) => o.phaseIndex === 2 && o.week === 1 && o.slot === 1)!;
    expect(p2.weekStart).toBe("2026-12-07");
    expect(p2.plannedDate).toBe("2026-12-08");
  });

  it("estímulo de cada fase e doses por estímulo vêm das regras (HEURISTIC) e da estrutura (PROFESSIONAL)", () => {
    const p1 = r.occurrences.find((o) => o.phaseIndex === 1)!;
    const p2 = r.occurrences.find((o) => o.phaseIndex === 2)!;
    expect(p1.stimulus).toMatchObject({ value: "HYPERTROPHY", basis: "PROFESSIONAL" });
    expect(p2.stimulus?.value).toBe("STRENGTH");
    const d1 = p1.items.find((i) => i.dose?.metric === "REPS")!.dose!;
    const d2 = p2.items.find((i) => i.dose?.metric === "REPS")!.dose!;
    expect(d1.metric === "REPS" && d1.reps).toEqual({ min: 8, max: 12 });
    expect(d2.metric === "REPS" && d2.reps).toEqual({ min: 3, max: 6 });
    const sets = p1.items[0].trace.params.find((p) => p.param === "sets")!;
    expect(sets).toMatchObject({ basis: "HEURISTIC", ruleId: "DOSE_DEFAULTS" });
  });

  it("cobre os músculos-alvo do treino e mantém uma seleção por treino na fase", () => {
    const a = r.occurrences.filter((o) => o.phaseIndex === 1 && o.label === "A");
    const ids = a.map((o) => o.items.map((i) => i.exerciseId).join(","));
    expect(new Set(ids).size).toBe(1);
    const prim = a[0].items.flatMap((i) => CATALOG.find((e) => e.id === i.exerciseId)!.primaryMuscles);
    for (const m of ["QUADRICEPS", "HAMSTRINGS", "GLUTEUS"]) expect(prim).toContain(m);
    expect(codes(r)).not.toContain("MUSCLE_NOT_COVERED");
  });

  it("volume semanal por músculo separa séries diretas e indiretas", () => {
    const chest = r.volume.find((v) => v.phaseIndex === 1 && v.week === 1 && v.muscle === "CHEST")!;
    expect(chest.directSets).toBeGreaterThan(0);
    const triceps = r.volume.find((v) => v.phaseIndex === 1 && v.week === 1 && v.muscle === "TRICEPS")!;
    expect(triceps.weightedSets).toBe(triceps.directSets + triceps.indirectSets * 0.5);
  });

  it("declara as premissas usadas, incluindo que os padrões não são recomendação universal", () => {
    const a = r.assumptions.map((x) => x.code);
    expect(a).toContain("DEFAULTS_NOT_UNIVERSAL");
    expect(a).toContain("DOSE_FROM_POLICY");
    expect(a).toContain("NO_LOAD_KG");
    expect(a).toContain("NO_HISTORY");
    expect(r.assumptions.find((x) => x.code === "DEFAULTS_NOT_UNIVERSAL")!.text).toBe("Os valores padrão desta ferramenta não são recomendação universal.");
  });
});

describe("motor: objetivos, divisões e frequências (tópico 2)", () => {
  it("divisão livre com rótulos próprios e rotação definida pelo profissional", () => {
    const input = baseInput({
      structure: structure("2026-11-09", [{
        weeks: 2, sessionsPerWeek: 4, stimulus: "HYPERTROPHY", rotation: ["Superior", "Inferior", "Superior", "Inferior"],
        workouts: [
          { label: "Superior", exerciseTarget: 5, focus: { patterns: ["HORIZONTAL_PUSH", "HORIZONTAL_PULL", "VERTICAL_PUSH", "VERTICAL_PULL"] } },
          { label: "Inferior", exerciseTarget: 4, focus: { patterns: ["SQUAT", "HINGE", "LUNGE"] } },
        ],
      }]),
    });
    const r = generate(input);
    expect(r.status).toBe("SUCCEEDED");
    expect(r.occurrences.map((o) => o.label)).toEqual(["Superior", "Inferior", "Superior", "Inferior", "Superior", "Inferior", "Superior", "Inferior"]);
    expect(r.occurrences[0].items).toHaveLength(5);
    expect(r.occurrences[1].items).toHaveLength(4);
  });

  it("corpo inteiro 1×/semana, força: mesma lógica com outra frequência e outra dose", () => {
    const r = generate(baseInput({
      structure: structure("2026-11-09", [{ weeks: 3, sessionsPerWeek: 1, stimulus: "STRENGTH", workouts: [{ label: "FB", exerciseTarget: 6 }] }]),
    }));
    expect(r.occurrences).toHaveLength(3);
    expect(codes(r)).toContain("NO_TARGETS");
    const d = r.occurrences[0].items[0].dose!;
    expect(d.metric === "REPS" && d.sets).toBe(4);
  });

  it("objetivo aeróbio: modalidade cardio, dose contínua e intervalada (sem séries × repetições)", () => {
    const r = generate(baseInput({
      structure: structure("2026-11-09", [{
        weeks: 2, sessionsPerWeek: 2,
        workouts: [
          { label: "Z2", exerciseTarget: 1, focus: { stimulus: { value: "AEROBIC_ENDURANCE", source: "STRUCTURE", basis: "PROFESSIONAL" } } },
          { label: "HIIT", exerciseTarget: 1, focus: { stimulus: { value: "INTERVALS", source: "STRUCTURE", basis: "PROFESSIONAL" } } },
        ],
      }]),
    }));
    const z2 = r.occurrences.find((o) => o.label === "Z2")!.items[0];
    const hiit = r.occurrences.find((o) => o.label === "HIIT")!.items[0];
    expect(z2.modality).toBe("CARDIO");
    expect(z2.dose?.metric).toBe("CONTINUOUS");
    expect(hiit.exerciseId).toBe("ex-run-int");
    expect(hiit.dose).toMatchObject({ metric: "INTERVALS", blocks: 1, repeats: 6, recovery: { mode: "ACTIVE" } });
    expect(hiit.display.doseText).toContain("recuperação ativa");
    // intensidade de cardio nunca é inventada
    expect(hiit.dose?.metric === "INTERVALS" && hiit.dose.work.intensity).toBeUndefined();
  });

  it("mobilidade e objetivo próprio do profissional (estímulo livre + modalidades + dose dele)", () => {
    const r = generate(baseInput({
      parameters: parameters({
        modalitiesByWorkout: [{ phaseIndex: 1, label: "Mob", modalities: ["MOBILITY"] }],
        doseOverrides: [{ stimulus: "Reabilitação leve", modality: "MOBILITY", patch: { values: { sets: 1, durationMin: 60, durationMax: 60, restSeconds: 0, repsMin: 10, repsMax: 10 } } }],
      }),
      structure: structure("2026-11-09", [{ weeks: 1, sessionsPerWeek: 1, stimulus: "Reabilitação leve", workouts: [{ label: "Mob", exerciseTarget: 2 }] }]),
    }));
    expect(r.status).toBe("SUCCEEDED");
    const its = r.occurrences[0].items;
    expect(its.map((i) => i.modality)).toEqual(["MOBILITY", "MOBILITY"]);
    for (const i of its) {
      expect(i.trace.params.find((p) => p.param === "sets")!.basis).toBe("PROFESSIONAL");
    }
    expect(r.occurrences[0].stimulus?.value).toBe("REABILITACAO_LEVE");
  });

  it("estímulo livre sem modalidade padrão vira pergunta, não palpite", () => {
    const r = generate(baseInput({
      structure: structure("2026-11-09", [{ weeks: 1, sessionsPerWeek: 1, stimulus: "Preparação para escalada", workouts: [{ label: "A" }] }]),
    }));
    expect(codes(r)).toContain("MODALITY_MISSING");
    expect(r.status).toBe("INFEASIBLE");
    expect(r.occurrences[0].items).toHaveLength(0);
  });

  it("quantidade pelo tempo disponível (HEURISTIC_ACCEPTED) respeita o tempo", () => {
    const input = baseInput({
      parameters: parameters({ availableMinutes: 30, exerciseCountByWorkout: [{ phaseIndex: 1, label: "A", count: "BY_TIME" }] }),
      structure: structure("2026-11-09", [{ weeks: 1, sessionsPerWeek: 1, stimulus: "HYPERTROPHY", workouts: [{ label: "A", exerciseTarget: null }] }]),
    });
    const r = generate(input);
    expect(r.workouts[0].count).toMatchObject({ basis: "HEURISTIC_ACCEPTED", ruleId: "COUNT_FROM_TIME" });
    expect(r.occurrences[0].estimatedMinutes!).toBeLessThanOrEqual(30);
    expect(r.occurrences[0].items.length).toBeGreaterThanOrEqual(1);
    expect(codes(r)).not.toContain("OVER_TIME_BUDGET");
  });
});

describe("motor: fases e semanas em quantidades variáveis (tópico 3)", () => {
  it.each([
    [[1], [1]],
    [[2, 3, 7, 1, 4], [2, 1, 5, 3, 6]],
    [[12], [2]],
  ])("semanas %j × sessões %j", (weeks, sessions) => {
    const r = generate(baseInput({
      structure: structure("2026-11-09", weeks.map((w, i) => ({ weeks: w, sessionsPerWeek: sessions[i], stimulus: "GENERAL_FITNESS", workouts: [{ label: "A", exerciseTarget: 3 }, { label: "B", exerciseTarget: 3 }] }))),
    }));
    expect(r.occurrences).toHaveLength(weeks.reduce((a, w, i) => a + w * sessions[i], 0));
    expect(r.phases.map((p) => p.weeks)).toEqual(weeks);
    for (const [i, w] of weeks.entries()) {
      const ph = r.occurrences.filter((o) => o.phaseIndex === i + 1);
      expect(Math.max(...ph.map((o) => o.week))).toBe(w);
    }
  });

  it("12 fases cabem; a 13ª passa do limite técnico de gravação (com o motivo)", () => {
    const make = (n: number) => baseInput({ structure: structure("2026-11-09", Array.from({ length: n }, () => ({ weeks: 1, sessionsPerWeek: 1, stimulus: "STRENGTH", workouts: [{ label: "A", exerciseTarget: 2 }] }))) });
    expect(generate(make(12)).status).toBe("SUCCEEDED");
    const r = generate(make(13));
    expect(r.status).toBe("INFEASIBLE");
    expect(r.issues.find((i) => i.code === "PHASES_OVER_TECHNICAL_LIMIT")!.message).toContain("limite técnico");
  });

  it("sessões por semana acima de 14 são limite técnico; fase sem calendário é erro", () => {
    const bad = baseInput({ structure: structure("2026-11-09", [{ weeks: 1, sessionsPerWeek: 15, stimulus: "STRENGTH", workouts: [{ label: "A" }] }]) });
    expect(codes(generate(bad))).toContain("SESSIONS_OVER_TECHNICAL_LIMIT");
    const s = structure("2026-11-09", [{ weeks: 2, sessionsPerWeek: 2, stimulus: "STRENGTH", workouts: [{ label: "A" }] }]);
    s.phases[0].occurrences = [];
    expect(codes(generate(baseInput({ structure: s })))).toContain("OCCURRENCES_MISSING");
  });

  it("escopo PHASES gera só as fases pedidas, com a mesma seleção da geração completa", () => {
    // Seleção por treino: o escopo replaneja todas as fases e devolve só as pedidas.
    const full = generate(baseInput({ rules: AUDIT_RULES }));
    const part = generate(baseInput({ rules: AUDIT_RULES, scope: { kind: "PHASES", phaseIndexes: [2] } }));
    expect(new Set(part.occurrences.map((o) => o.phaseIndex))).toEqual(new Set([2]));
    expect(canonicalJson(part.occurrences)).toBe(canonicalJson(full.occurrences.filter((o) => o.phaseIndex === 2)));
    // Microciclo (padrão): só a fase pedida é planejada; a variação vem da fase anterior gravada (aqui, a da geração completa).
    const fullMicro = generate(baseInput());
    const previousPhaseExercises = new Map([[1, [...new Set(fullMicro.occurrences.filter((o) => o.phaseIndex === 1).flatMap((o) => o.items.map((i) => i.exerciseId!)))]]]);
    const partMicro = generate(baseInput({ scope: { kind: "PHASES", phaseIndexes: [2] } }), { previousPhaseExercises });
    expect(new Set(partMicro.occurrences.map((o) => o.phaseIndex))).toEqual(new Set([2]));
    expect(canonicalJson(partMicro.occurrences)).toBe(canonicalJson(fullMicro.occurrences.filter((o) => o.phaseIndex === 2)));
    expect(partMicro.workouts.every((w) => w.phaseIndex === 2)).toBe(true);
  });
});

describe("motor: determinismo e auditoria", () => {
  it("mesma entrada → mesmos bytes e mesmo SHA-256; catálogo embaralhado → mesma saída", async () => {
    const a = generate(baseInput());
    const b = generate(baseInput());
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    const shuffled = [...CATALOG].reverse();
    const s = baseInput({ catalog: [...shuffled.slice(5), ...shuffled.slice(0, 5)] });
    const c = generate(s);
    expect(canonicalJson(c)).toBe(canonicalJson(a));
    expect(canonicalInput(s)).toBe(canonicalInput(baseInput()));
    const h1 = await sha256Hex(canonicalJson(a));
    const h2 = await sha256Hex(canonicalJson(c));
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).toBe(h2);
  });

  it("o motor não usa acaso nem relógio", () => {
    const dir = join(process.cwd(), "src/modules/prescricao/motor");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src, f).not.toMatch(/Math\.random|Date\.now|new Date\(\)|performance\.now/);
      expect(src, f).not.toMatch(/from "@\/db|server-only|fetch\(/);
    }
  });

  it("entrada inválida nunca lança: vira aviso", () => {
    const input: EngineInput = baseInput({ asOf: "2026-02-31", catalog: [...CATALOG, exercise({ id: "ex-squat", name: "Duplicado" })] });
    const r = generate(input);
    expect(r.status).toBe("INFEASIBLE");
    expect(codes(r)).toContain("INPUT_INVALID");
    expect(r.occurrences.length).toBeGreaterThan(0); // rascunho completo devolvido mesmo assim
  });

  it("regras desconhecidas: resultado vazio e explicado", () => {
    const r = generate(baseInput({ rules: { id: "gymgital-base", version: "0000" } }));
    expect(codes(r)).toEqual(["RULESET_UNKNOWN"]);
  });
});
