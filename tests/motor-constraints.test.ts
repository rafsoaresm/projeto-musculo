import { describe, expect, it } from "vitest";
import { generate, type CatalogExercise } from "@/modules/prescricao/motor";
import { baseInput, CATALOG, codes, exercise, parameters, structure } from "./helpers/motor-fixtures";

const chosenIds = (r: ReturnType<typeof generate>) => new Set(r.occurrences.flatMap((o) => o.items.map((i) => i.exerciseId)));
const byId = new Map(CATALOG.map((e) => [e.id, e]));

describe("motor: equipamentos indisponíveis (tópico 4)", () => {
  it("só halteres e banco: nada que exija barra, máquina ou polia; conjunto alternativo vale", () => {
    const r = generate(baseInput({ parameters: parameters({ availableEquipment: ["DUMBBELL", "BENCH"] }) }));
    for (const id of chosenIds(r)) {
      const e = byId.get(id!)!;
      const ok = e.equipment.every((x) => ["DUMBBELL", "BENCH"].includes(x)) || e.equipmentAlternatives.some((s) => s.every((x) => ["DUMBBELL", "BENCH"].includes(x)));
      expect(ok, e.name).toBe(true);
    }
    expect(chosenIds(r).has("ex-rdl")).toBe(true); // barra OU halteres
  });

  it("biblioteca não cobre o pedido: INFEASIBLE com o rascunho inteiro e o motivo, sem inventar exercício", () => {
    const st = structure("2026-11-09", [{ weeks: 2, sessionsPerWeek: 2, stimulus: "HYPERTROPHY", workouts: [{ label: "A", exerciseTarget: 6 }, { label: "B", exerciseTarget: 3 }] }]);
    const r = generate(baseInput({ structure: st, parameters: parameters({ availableEquipment: [] }) }));
    expect(r.status).toBe("INFEASIBLE");
    expect(r.validation).toBe("BLOCKED");
    const issue = r.issues.find((i) => i.code === "CATALOG_INSUFFICIENT")!;
    expect(issue.message).toMatch(/equipamento indisponível/);
    expect(r.occurrences).toHaveLength(4);
    expect(r.occurrences.find((o) => o.label === "A")!.items).toHaveLength(4); // os 4 sem equipamento
    for (const id of chosenIds(r)) expect(byId.get(id!)!.equipment).toEqual([]);
  });

  it("equipamentos não informados: aviso, só exercícios sem equipamento, nunca suposição", () => {
    const r = generate(baseInput({ parameters: parameters({ availableEquipment: null }) }));
    expect(codes(r)).toContain("EQUIPMENT_UNKNOWN");
    expect(r.assumptions.map((a) => a.code)).toContain("EQUIPMENT_NOT_INFORMED");
    for (const id of chosenIds(r)) expect(byId.get(id!)!.equipment).toEqual([]);
  });

  it("tempo: SOFT avisa com os dois números; HARD torna INFEASIBLE; exercícios não mudam para caber", () => {
    const soft = generate(baseInput({ parameters: parameters({ availableMinutes: 20, timeBudget: "SOFT" }) }));
    const hard = generate(baseInput({ parameters: parameters({ availableMinutes: 20, timeBudget: "HARD" }) }));
    const s = soft.issues.find((i) => i.code === "OVER_TIME_BUDGET")!;
    expect(s.severity).toBe("WARNING");
    expect(s.message).toMatch(/≈ \d+ min de 20 min/);
    expect(hard.status).toBe("INFEASIBLE");
    expect(hard.issues.find((i) => i.code === "OVER_TIME_BUDGET")!.severity).toBe("ERROR");
    expect(hard.occurrences.map((o) => o.items.map((i) => i.exerciseId))).toEqual(soft.occurrences.map((o) => o.items.map((i) => i.exerciseId)));
  });

  it("tempo do treino vence o da geração, que vence o do perfil", () => {
    const st = structure("2026-11-09", [{ weeks: 1, sessionsPerWeek: 2, stimulus: "HYPERTROPHY", workouts: [{ label: "A", focus: { minutes: 45 } }, { label: "B" }] }]);
    const r = generate(baseInput({ structure: st, parameters: parameters({ availableMinutes: null }) }));
    expect(r.occurrences.map((o) => [o.budgetMinutes, o.budgetSource])).toEqual([[45, "WORKOUT"], [60, "PROFILE"]]);
  });
});

describe("motor: biblioteca incompleta (tópico 5)", () => {
  it("PENDING nunca é selecionado; INFERRED só quando o profissional confia neles, sempre marcado", () => {
    const catalog: CatalogExercise[] = CATALOG.map((e) =>
      e.id === "ex-legpress" ? { ...e, metadataStatus: "INFERRED" } : e.id === "ex-squat" ? { ...e, metadataStatus: "PENDING" } : e);
    const both = generate(baseInput({ catalog }));
    expect(chosenIds(both).has("ex-squat")).toBe(false);
    const inferred = both.occurrences.flatMap((o) => o.items).find((i) => i.exerciseId === "ex-legpress");
    expect(inferred?.metadata).toBe("INCLUDES_INFERRED");
    const reviewed = generate(baseInput({ catalog, parameters: parameters({ metadataTrust: "REVIEWED_ONLY" }) }));
    expect(chosenIds(reviewed).has("ex-legpress")).toBe(false);
    expect(reviewed.workouts[0].excluded).toMatchObject({ METADATA_PENDING: 1, METADATA_INFERRED: 1 });
  });

  it("exercício sem métrica: entra, mas a dose fica vazia com aviso (nada é suposto)", () => {
    const catalog = CATALOG.map((e) => (e.id === "ex-legpress" ? { ...e, metric: null } : e));
    const r = generate(baseInput({ catalog }));
    const item = r.occurrences.flatMap((o) => o.items).find((i) => i.exerciseId === "ex-legpress")!;
    expect(item.dose).toBeNull();
    expect(item.display.doseText).toBe("Dose a definir pelo profissional");
    expect(codes(r)).toContain("METRIC_MISSING");
    expect(codes(r)).toContain("DURATION_UNKNOWN");
  });

  it("sem regra de dose para a combinação: DOSE_POLICY_MISSING, dose vazia", () => {
    const catalog = [...CATALOG, exercise({ id: "ex-swim", name: "Natação", modality: "SWIMMING", metric: "DISTANCE", equipment: [] })];
    const r = generate(baseInput({
      catalog,
      parameters: parameters({ modalitiesByWorkout: [{ phaseIndex: 1, label: "N", modalities: ["SWIMMING"] }] }),
      structure: structure("2026-11-09", [{ weeks: 1, sessionsPerWeek: 1, stimulus: "AEROBIC_ENDURANCE", workouts: [{ label: "N", exerciseTarget: 1 }] }]),
    }));
    expect(r.occurrences[0].items[0].exerciseId).toBe("ex-swim");
    expect(r.occurrences[0].items[0].dose).toBeNull();
    expect(codes(r)).toContain("DOSE_POLICY_MISSING");
  });

  it("biblioteca vazia e exercício arquivado", () => {
    const empty = generate(baseInput({ catalog: [] }));
    expect(empty.status).toBe("INFEASIBLE");
    expect(empty.issues.find((i) => i.code === "CATALOG_INSUFFICIENT")!.message).toMatch(/nenhum exercício/);
    const archived = generate(baseInput({ catalog: CATALOG.map((e) => (e.id === "ex-legpress" ? { ...e, archived: true } : e)) }));
    expect(chosenIds(archived).has("ex-legpress")).toBe(false);
  });

  it("alternativas só com algo em comum (músculo, padrão ou curadoria)", () => {
    const r = generate(baseInput());
    const bench = r.occurrences.flatMap((o) => o.items).find((i) => i.exerciseId === "ex-bench");
    for (const alt of bench?.alternatives ?? []) {
      const e = byId.get(alt)!;
      expect(e.primaryMuscles.includes("CHEST") || e.patterns.includes("HORIZONTAL_PUSH")).toBe(true);
    }
  });
});

describe("motor: triagem com alertas (tópico 6)", () => {
  const flagged = baseInput({
    student: {
      ...baseInput().student,
      screening: { parq: "POSITIVE", professionalDecision: null, medicalClearanceRecorded: true, ref: "assessment:a1" },
      findings: [
        { kind: "MOVEMENT", code: "SQUAT", grade: "STOPPED_BY_PAIN", label: "Agachamento (teste de movimento)", ref: "assessment:a1" },
        { kind: "POSTURE", code: "KNEE_VALGUS", label: "Valgo de joelho observado" },
        { kind: "FLEXIBILITY", code: "HAMSTRINGS_LOW", label: "Flexiteste baixo em posteriores" },
      ],
    },
  });

  it("alertas são só saída: a seleção não muda e nada é contraindicado sozinho", () => {
    const plain = generate(baseInput());
    const r = generate(flagged);
    const f = r.flags.map((x) => x.code);
    expect(f).toContain("SCREENING_REVIEW_REQUIRED");
    expect(f).toContain("MEDICAL_CLEARANCE_RECORDED");
    expect(f).toContain("MOVEMENT_FINDING:SQUAT:SQUAT");
    expect(f).toContain("ASSESSMENT:POSTURE:KNEE_VALGUS");
    expect(r.flags.find((x) => x.code === "MEDICAL_CLEARANCE_RECORDED")!.severity).toBe("INFO");
    expect(r.flags.find((x) => x.code === "ASSESSMENT:POSTURE:KNEE_VALGUS")!.suggestedDecision).toBeUndefined();
    expect(r.occurrences.map((o) => o.items.map((i) => i.exerciseId))).toEqual(plain.occurrences.map((o) => o.items.map((i) => i.exerciseId)));
    expect(r.status).toBe(plain.status);
  });

  it("a decisão sugerida só vale depois do clique do profissional", () => {
    const flag = generate(flagged).flags.find((x) => x.code === "MOVEMENT_FINDING:SQUAT:SQUAT")!;
    expect(flag.suggestedDecision).toEqual({ kind: "EXCLUDE_PATTERN", pattern: "SQUAT" });
    const decided = generate({ ...flagged, parameters: parameters({ acceptedFlagDecisions: [{ flagCode: flag.code, decision: flag.suggestedDecision! }] }) });
    expect(decided.flags.find((x) => x.code === flag.code)!.decided).toEqual({ kind: "EXCLUDE_PATTERN", pattern: "SQUAT" });
    for (const id of chosenIds(decided)) expect(byId.get(id!)!.patterns).not.toContain("SQUAT");
  });

  it("dor no histórico vira alerta com sugestão e pesa contra o exercício", () => {
    const r = generate(baseInput({
      history: [{ exerciseId: "ex-legpress", date: "2026-10-20", equipmentKey: null, metric: "REPS", sets: [], pain: true }],
    }));
    expect(r.flags.find((f) => f.code === "HISTORY_PAIN:ex-legpress")!.suggestedDecision).toEqual({ kind: "EXCLUDE_EXERCISE", exerciseId: "ex-legpress" });
    expect(chosenIds(r).has("ex-legpress")).toBe(false);
  });
});

describe("motor: dados ausentes (tópico 7)", () => {
  it("sem estímulo: erro com sugestões do objetivo, nenhuma pré-selecionada", () => {
    const r = generate(baseInput({ structure: structure("2026-11-09", [{ weeks: 2, sessionsPerWeek: 2, workouts: [{ label: "A" }, { label: "B" }] }]) }));
    const issue = r.issues.find((i) => i.code === "STIMULUS_MISSING")!;
    expect(issue.severity).toBe("ERROR");
    expect(issue.suggestions!.map((s) => s.value)).toEqual(expect.arrayContaining(["HYPERTROPHY", "GENERAL_FITNESS"]));
    expect(r.occurrences.every((o) => o.stimulus === null)).toBe(true);
    expect(r.occurrences.flatMap((o) => o.items)).toHaveLength(0);
  });

  it("estímulo aceito de uma sugestão fica registrado como HEURISTIC_ACCEPTED com a regra", () => {
    const r = generate(baseInput({
      parameters: parameters({ stimulusByPhase: [{ phaseIndex: 1, value: "HYPERTROPHY", basis: "HEURISTIC_ACCEPTED", ruleId: "GOAL_STIMULUS_HINTS" }] }),
      structure: structure("2026-11-09", [{ weeks: 1, sessionsPerWeek: 1, workouts: [{ label: "A" }] }]),
    }));
    expect(r.occurrences[0].stimulus).toMatchObject({ value: "HYPERTROPHY", basis: "HEURISTIC_ACCEPTED", ruleId: "GOAL_STIMULUS_HINTS" });
    expect(r.occurrences[0].items[0].trace.params[0]).toMatchObject({ param: "stimulus", basis: "HEURISTIC_ACCEPTED" });
  });

  it("sem quantidade de exercícios: pergunta obrigatória com a opção pelo tempo", () => {
    const r = generate(baseInput({ structure: structure("2026-11-09", [{ weeks: 1, sessionsPerWeek: 1, stimulus: "STRENGTH", workouts: [{ label: "A", exerciseTarget: null }] }]) }));
    const issue = r.issues.find((i) => i.code === "EXERCISE_COUNT_MISSING")!;
    expect(issue.suggestions?.[0].value).toBe("BY_TIME");
    expect(r.status).toBe("INFEASIBLE");
  });

  it("pelo tempo sem tempo informado: erro, nada estimado", () => {
    const r = generate(baseInput({
      student: { ...baseInput().student, sessionMinutes: null },
      parameters: parameters({ availableMinutes: null, exerciseCountByWorkout: [{ phaseIndex: 1, label: "A", count: "BY_TIME" }] }),
      structure: structure("2026-11-09", [{ weeks: 1, sessionsPerWeek: 1, stimulus: "STRENGTH", workouts: [{ label: "A", exerciseTarget: null }] }]),
    }));
    expect(codes(r)).toContain("COUNT_BY_TIME_NEEDS_BUDGET");
    expect(r.assumptions.map((a) => a.code)).toContain("BUDGET_UNKNOWN");
    expect(r.occurrences[0].budgetMinutes).toBeNull();
  });

  it("doses deixadas vazias pelo profissional; nível e dias ausentes viram premissas", () => {
    const r = generate(baseInput({
      parameters: parameters({ doseMode: "LEAVE_EMPTY" }),
      student: { ...baseInput().student, level: null },
      structure: structure("2026-11-09", [{ weeks: 1, sessionsPerWeek: 2, stimulus: "HYPERTROPHY", workouts: [{ label: "A" }, { label: "B" }] }]),
    }));
    expect(r.occurrences.flatMap((o) => o.items).every((i) => i.dose === null)).toBe(true);
    expect(r.occurrences.every((o) => o.plannedDate === null)).toBe(true);
    const a = r.assumptions.map((x) => x.code);
    expect(a).toEqual(expect.arrayContaining(["DOSE_LEFT_EMPTY", "EXPERIENCE_UNKNOWN", "DATES_NOT_PLANNED"]));
    expect(a).not.toContain("DOSE_FROM_POLICY");
  });

  it("vazio nunca vira 0: sem descanso informado a duração fica parcial", () => {
    const r = generate(baseInput({
      parameters: parameters({ doseOverrides: [{ exerciseId: "ex-legpress", patch: { values: { sets: 3 } } }] }),
      catalog: CATALOG.map((e) => (e.id === "ex-legpress" ? { ...e, modality: "CUSTOM_MOD" } : e)),
      structure: structure("2026-11-09", [{ weeks: 1, sessionsPerWeek: 1, stimulus: "HYPERTROPHY", workouts: [{ label: "A", exerciseTarget: 1, focus: { modalities: ["CUSTOM_MOD"] } }] }]),
    }));
    const item = r.occurrences[0].items[0];
    expect(item.exerciseId).toBe("ex-legpress");
    expect(item.dose).toBeNull(); // só séries: falta faixa de repetições
    expect(codes(r)).toContain("DOSE_POLICY_MISSING");
  });
});
