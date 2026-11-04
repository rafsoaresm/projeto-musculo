/**
 * Motor V3 S3: seleção por microciclo (regra MICROCYCLE_SELECTION, 2026.11.4). A fase inteira é escolhida sabendo quantas
 * vezes cada treino aparece na semana e quanto falta para os alvos semanais; os conjuntos anteriores seguem iguais.
 */
import { describe, expect, it } from "vitest";
import {
  alternativesFor, canonicalJson, DEFAULT_RULESET, ENGINE_VERSION, generate, getRuleSet, rebase, regenerate, substitute, toDisplayFields,
  type CatalogExercise, type EngineInput, type EngineOutcome, type EngineResult, type ExistingItem, type GenerationParameters, type OccurrenceOut,
  type RuleSet, type RuleSetRef, type StructurePhase,
} from "@/modules/prescricao/motor";
import { prepare } from "@/modules/prescricao/motor/generate";
import { fixedWorkoutFrom, planPhaseMicrocycle } from "@/modules/prescricao/motor/microcycle";
import { targetSuggestion } from "@/modules/prescricao/motor/targets";
import { RuleLog } from "@/modules/prescricao/motor/trace";
import { auditPlan, boundAudit } from "@/modules/prescricao/motor/audit";
import { ruleLogFor } from "@/modules/prescricao/motor/trace";
import { AUDIT_RULES, CATALOG, baseInput, codes, exercise, parameters, structure, type PhaseSeed } from "./helpers/motor-fixtures";
import { XINTUS_CATALOG, xintusInput } from "./helpers/xintus";

const MICRO: RuleSetRef = DEFAULT_RULESET;
const ok = (o: EngineOutcome): EngineResult => {
  if (!o.ok) throw new Error(`${o.code}: ${o.message}`);
  return o.result;
};
const byId = new Map(XINTUS_CATALOG.map((e) => [e.id, e]));
const exOf = (id: string | null) => (id ? byId.get(id) ?? CATALOG.find((e) => e.id === id) : undefined);
const firstOf = (r: EngineResult, phaseIndex: number, label: string) => r.occurrences.find((o) => o.phaseIndex === phaseIndex && o.label === label)!;
const idsOf = (o: OccurrenceOut) => o.items.map((i) => i.exerciseId);
const primaryIn = (o: OccurrenceOut, catalog: CatalogExercise[] = XINTUS_CATALOG) =>
  new Set(o.items.flatMap((i) => catalog.find((e) => e.id === i.exerciseId)?.primaryMuscles ?? []));
const selectionCodes = (r: EngineResult) => new Set(r.occurrences.flatMap((o) => o.items.flatMap((i) => i.trace.selection.map((t) => t.code))));

/** Alvos sugeridos pela regra (aceitos), como o profissional aceitaria no cartão (S4): fase a fase. */
function acceptedSuggestion(input: EngineInput): GenerationParameters["phaseCoverage"] {
  return input.structure.phases.map((ph) => {
    const s = targetSuggestion(MICRO, ph, input);
    if (!s.suggestion) throw new Error(`sem sugestão na fase ${ph.index}`);
    return { phaseIndex: ph.index, muscles: s.suggestion.muscles, patterns: s.suggestion.patterns, weeklySets: s.suggestion.weeklySets, basis: "HEURISTIC_ACCEPTED" as const, ruleId: "MICROCYCLE_TARGET_SUGGESTIONS" };
  });
}
function withCoverage(input: EngineInput, phaseCoverage: GenerationParameters["phaseCoverage"]): EngineInput {
  return { ...input, parameters: { ...input.parameters, phaseCoverage } };
}

/** Medidas de distribuição tiradas da auditoria da própria proposta (S1). */
function distribution(r: EngineResult) {
  const a = r.audit!;
  return a.phases.map((p) => {
    const findings = (code: string) => a.findings.filter((f) => f.phaseIndex === p.phaseIndex && f.code === code).length;
    return {
      direct: p.muscles.filter((m) => m.classification === "DIRECT").length,
      indirectOnly: p.muscles.filter((m) => m.classification === "INDIRECT_ONLY").length,
      patterns: p.patterns.filter((x) => x.sessions.min > 0).length,
      repeatedInSession: findings("AUDIT_PATTERN_REPEATED_IN_SESSION"),
      targetFindings: findings("AUDIT_TARGET_MUSCLE_UNMET") + findings("AUDIT_TARGET_PATTERN_UNMET") + findings("AUDIT_TARGET_MUSCLE_ABOVE"),
      exerciseRepeated: findings("AUDIT_EXERCISE_REPEATED"),
    };
  });
}

describe("microciclo: gate pela regra e reprodução das versões anteriores", () => {
  it("2026.11.4 é o padrão, traz as regras novas e o motor 2.2.0; 2026.11.3 continua com a seleção por treino", () => {
    expect(DEFAULT_RULESET).toEqual({ id: "gymgital-base", version: "2026.11.4" });
    expect(ENGINE_VERSION).toBe("2.2.0");
    const rules = getRuleSet(MICRO)!.rules;
    expect(rules.MICROCYCLE_SELECTION?.basis).toBe("HEURISTIC");
    expect(rules.MICROCYCLE_TARGET_SUGGESTIONS?.basis).toBe("HEURISTIC");
    expect(rules.FINDING_OBSERVATION_MAP?.basis).toBe("HEURISTIC");
    for (const id of ["MICROCYCLE_SELECTION", "MICROCYCLE_TARGET_SUGGESTIONS", "FINDING_OBSERVATION_MAP"] as const)
      expect(getRuleSet(AUDIT_RULES)!.rules[id], id).toBeUndefined();
    const micro = generate(xintusInput());
    const legacy = generate(xintusInput(AUDIT_RULES));
    expect(micro.rulesUsed.map((u) => u.ruleId)).toEqual(expect.arrayContaining(["MICROCYCLE_SELECTION", "FINDING_OBSERVATION_MAP"]));
    expect(legacy.rulesUsed.map((u) => u.ruleId)).not.toContain("MICROCYCLE_SELECTION");
    expect([...selectionCodes(micro)].some((c) => c.startsWith("MICRO_"))).toBe(true);
    expect([...selectionCodes(legacy)].some((c) => c.startsWith("MICRO_"))).toBe(false);
  });
});

describe("microciclo: Xintus (hipertrofia, ABAB, 4 sessões por semana, 3 fases)", () => {
  it("sem alvos: distribuição melhor que a da seleção por treino, medida pela auditoria; 4 sessões por semana", () => {
    const micro = generate(xintusInput());
    const legacy = generate(xintusInput(AUDIT_RULES));
    expect(micro.status).toBe("SUCCEEDED");
    expect(micro.audit!.phases.every((p) => p.occurrencesPerWeek.min === 4 && p.occurrencesPerWeek.max === 4)).toBe(true);
    const m = distribution(micro);
    const l = distribution(legacy);
    for (const [i, p] of m.entries()) {
      expect(p.patterns, `fase ${i + 1}: padrões com sessão`).toBeGreaterThanOrEqual(l[i].patterns);
      expect(p.direct, `fase ${i + 1}: músculos com estímulo direto`).toBeGreaterThanOrEqual(l[i].direct);
      expect(p.indirectOnly, `fase ${i + 1}: só indiretos`).toBeLessThanOrEqual(l[i].indirectOnly);
      expect(p.repeatedInSession).toBeLessThanOrEqual(l[i].repeatedInSession);
    }
    const sum = (xs: typeof m, k: "patterns" | "direct") => xs.reduce((a, x) => a + x[k], 0);
    expect(sum(m, "patterns") + sum(m, "direct")).toBeGreaterThan(sum(l, "patterns") + sum(l, "direct"));
    // Sem alvos, nada puxa para uma lista padrão: o aviso NO_TARGETS traz a sugestão da regra (aceite do profissional).
    const noTargets = micro.issues.filter((i) => i.code === "NO_TARGETS");
    expect(noTargets.length).toBe(6);
    expect(noTargets.every((i) => i.suggestions?.length === 1 && i.suggestions[0].ruleId === "MICROCYCLE_TARGET_SUGGESTIONS" && i.suggestions[0].value === "HYPERTROPHY")).toBe(true);
  });

  it("com os alvos sugeridos aceitos: todo músculo-alvo com estímulo direto em 2 sessões de toda semana e menos achados de alvo", () => {
    const accepted = acceptedSuggestion(xintusInput());
    const micro = generate(withCoverage(xintusInput(), accepted));
    const legacy = generate(withCoverage(xintusInput(AUDIT_RULES), accepted));
    expect(micro.status).toBe("SUCCEEDED");
    const targets = accepted[0].muscles!;
    for (const p of micro.audit!.phases)
      for (const m of targets) {
        const row = p.muscles.find((x) => x.muscle === m)!;
        expect(row.classification, `${p.phaseIndex} ${m}`).toBe("DIRECT");
        expect(row.directSessions.min, `${p.phaseIndex} ${m}`).toBeGreaterThanOrEqual(2);
      }
    const m = distribution(micro);
    const l = distribution(legacy);
    expect(m.reduce((a, x) => a + x.targetFindings, 0)).toBeLessThan(l.reduce((a, x) => a + x.targetFindings, 0));
    expect(m.reduce((a, x) => a + x.repeatedInSession, 0)).toBeLessThanOrEqual(l.reduce((a, x) => a + x.repeatedInSession, 0));
    // Alvos da fase conferidos na fase: nenhum aviso de cobertura por treino.
    expect(codes(micro).filter((c) => c === "MUSCLE_NOT_COVERED" || c === "PATTERN_NOT_COVERED")).toEqual([]);
    // O "Por quê?" cita o déficit semanal com as sessões reais do treino.
    const details = micro.occurrences.flatMap((o) => o.items).flatMap((i) => i.trace.selection.filter((t) => t.code === "MICRO_TARGET_DEFICIT").map((t) => t.detail));
    expect(details.some((d) => /séries ponderadas; este exercício soma \d+ \(2 sessões do treino [AB] × 2 séries\)/.test(d))).toBe(true);
  });

  it("dorsiflexão nível 2 (demais 3): observação com a referência, nunca exclusão; os agachamentos continuam", () => {
    const r = generate(xintusInput());
    const squats = r.occurrences.flatMap((o) => o.items).filter((i) => exOf(i.exerciseId)?.patterns.includes("SQUAT"));
    expect(squats.length).toBeGreaterThan(0);
    for (const i of r.occurrences.flatMap((o) => o.items)) {
      const e = exOf(i.exerciseId)!;
      const obs = i.trace.selection.filter((t) => t.code === "ASSESSMENT_OBSERVATION");
      if (e.patterns.some((p) => p === "SQUAT" || p === "LUNGE")) {
        expect(obs).toHaveLength(1);
        expect(obs[0]).toMatchObject({ basis: "STUDENT_DATA", ruleId: "FINDING_OBSERVATION_MAP" });
        expect(obs[0].detail).toContain("assessment:as-xintus");
        expect(obs[0].detail).toContain("nível 2 (mediana das leituras do aluno: 3)");
        expect(obs[0].detail).toContain("Não é contraindicação");
      } else expect(obs).toEqual([]);
    }
    const flag = r.flags.find((f) => f.code === "ASSESSMENT_OBSERVATION:FLEXITEST:ankle_dorsiflexion")!;
    expect(flag).toMatchObject({ severity: "INFO", source: "ASSESSMENT", ref: "assessment:as-xintus" });
    expect(flag.suggestedDecision).toBeUndefined();
    expect(flag.message).toContain("nenhum exercício foi excluído");
    expect(r.flags.filter((f) => f.code.startsWith("ASSESSMENT_OBSERVATION:"))).toHaveLength(1);
    // A leitura não muda a pontuação: sem as leituras, a mesma seleção (e o mesmo traço, menos a observação).
    const plain = xintusInput();
    const without = generate({ ...plain, student: { ...plain.student, findings: plain.student.findings.map((f) => ({ ...f, readings: undefined })) } });
    const strip = (x: EngineResult) => canonicalJson(x.occurrences.map((o) => o.items.map((i) => [i.exerciseId, i.trace.selection.filter((t) => t.code !== "ASSESSMENT_OBSERVATION")])));
    expect(strip(without)).toBe(strip(r));
    expect(codes(r)).not.toContain("CATALOG_INSUFFICIENT");
  });
});

describe("microciclo: exposições reais por semana e alvos com escopo", () => {
  const twoChest = [exercise({ id: "c-a", name: "Peito A", primaryMuscles: ["CHEST"], patterns: ["HORIZONTAL_PUSH"], equipment: [] })];

  it("rotação A,A,A,B: o alvo vai para o treino que aparece 3 vezes (e o traço cita as 3 sessões)", () => {
    const input = baseInput({
      catalog: CATALOG,
      structure: structure("2026-11-09", [{ weeks: 2, sessionsPerWeek: 4, stimulus: "HYPERTROPHY", rotation: ["A", "A", "A", "B"], workouts: [{ label: "A", exerciseTarget: 3 }, { label: "B", exerciseTarget: 3 }] }]),
      parameters: parameters({ phaseCoverage: [{ phaseIndex: 1, muscles: ["CHEST"], weeklySets: [{ muscle: "CHEST", minWeighted: 9 }], basis: "PROFESSIONAL" }] }),
    });
    const r = generate(input);
    expect(primaryIn(firstOf(r, 1, "A")).has("CHEST")).toBe(true);
    const chestPick = firstOf(r, 1, "A").items.find((i) => exOf(i.exerciseId)?.primaryMuscles.includes("CHEST"))!;
    expect(chestPick.trace.selection.find((t) => t.code === "MICRO_TARGET_DEFICIT")!.detail).toContain("3 sessões do treino A × 3 séries");
    expect(r.audit!.phases[0].workouts.find((w) => w.label === "A")!.exposuresPerWeek).toEqual({ min: 3, max: 3 });
  });

  it("repetir em A e B é permitido quando é o único exercício que cobre o alvo de frequência", () => {
    const catalog = [...CATALOG.filter((e) => !e.primaryMuscles.includes("CHEST")), ...twoChest];
    const input = baseInput({
      catalog,
      structure: structure("2026-11-09", [{ weeks: 2, sessionsPerWeek: 2, stimulus: "HYPERTROPHY", workouts: [{ label: "A", exerciseTarget: 3 }, { label: "B", exerciseTarget: 3 }] }]),
      parameters: parameters({ phaseCoverage: [{ phaseIndex: 1, muscles: ["CHEST"], weeklySets: [{ muscle: "CHEST", minDirectSessions: 2 }], basis: "PROFESSIONAL" }] }),
    });
    const r = generate(input);
    expect(idsOf(firstOf(r, 1, "A"))).toContain("c-a");
    expect(idsOf(firstOf(r, 1, "B"))).toContain("c-a");
    expect(r.audit!.findings.some((f) => f.code === "AUDIT_EXERCISE_REPEATED")).toBe(true);
  });

  it("alvo da fase coberto em treinos diferentes: nenhum aviso por treino; sem exercício nenhum: um aviso da fase", () => {
    const seed: PhaseSeed = { weeks: 2, sessionsPerWeek: 2, stimulus: "HYPERTROPHY", workouts: [{ label: "A", exerciseTarget: 2 }, { label: "B", exerciseTarget: 2 }] };
    const input = baseInput({ structure: structure("2026-11-09", [seed]), parameters: parameters({ phaseCoverage: [{ phaseIndex: 1, muscles: ["CHEST", "QUADRICEPS"], basis: "PROFESSIONAL" }] }) });
    const r = generate(input);
    expect(codes(r).filter((c) => c.endsWith("_NOT_COVERED"))).toEqual([]);
    const noChest = generate({ ...input, catalog: CATALOG.filter((e) => !e.primaryMuscles.includes("CHEST")) });
    const chest = noChest.issues.filter((i) => i.code === "MUSCLE_NOT_COVERED");
    expect(chest).toHaveLength(1);
    expect(chest[0]).toMatchObject({ phaseIndex: 1, path: "phases.1.coverage" });
    expect(chest[0].label).toBeUndefined();
    expect(chest[0].message).toBe("Fase 1: Peitoral sem exercício como músculo principal em nenhum treino.");
    // Alvo do próprio treino (foco) não atendido no treino: o aviso por treino, como antes.
    const focus = generate(baseInput({
      catalog: CATALOG.filter((e) => !e.primaryMuscles.includes("CHEST")),
      structure: structure("2026-11-09", [{ ...seed, workouts: [{ label: "A", exerciseTarget: 2, focus: { muscles: ["CHEST"] } }, { label: "B", exerciseTarget: 2 }] }]),
    }));
    expect(focus.issues.filter((i) => i.code === "MUSCLE_NOT_COVERED").map((i) => i.label)).toEqual(["A"]);
  });
});

describe("microciclo: divisões livres (AB, ABC, ABCD, corpo inteiro, superior e inferior)", () => {
  const UPPER = ["CHEST", "LATS", "UPPER_BACK", "FRONT_DELTOID", "SIDE_DELTOID", "TRICEPS", "BICEPS"];
  const LOWER = ["QUADRICEPS", "HAMSTRINGS", "GLUTEUS", "CALVES"];
  const upperLower = (labels: string[], spw: number, rotation?: string[]): EngineInput => baseInput({
    catalog: XINTUS_CATALOG,
    structure: structure("2026-11-09", [{
      weeks: 3, sessionsPerWeek: spw, stimulus: "HYPERTROPHY", ...(rotation ? { rotation } : {}),
      workouts: labels.map((label, n) => ({ label, exerciseTarget: 4, focus: { muscles: n % 2 === 0 ? UPPER : LOWER } })),
    }]),
    parameters: parameters({ phaseCoverage: [{ phaseIndex: 1, weeklySets: [{ muscle: "CHEST", minDirectSessions: 2 }], basis: "PROFESSIONAL" }] }),
  });

  it("superior/inferior (ABCD, um de cada por semana): o peito só nos dois treinos superiores, nunca nos inferiores", () => {
    const r = generate(upperLower(["A", "B", "C", "D"], 4));
    expect(r.status).toBe("SUCCEEDED");
    for (const label of ["A", "C"]) expect(primaryIn(firstOf(r, 1, label)).has("CHEST"), label).toBe(true);
    for (const label of ["B", "D"]) {
      const prim = primaryIn(firstOf(r, 1, label));
      expect(UPPER.some((m) => prim.has(m)), label).toBe(false);
    }
    for (const label of ["A", "C"]) {
      const prim = primaryIn(firstOf(r, 1, label));
      expect(LOWER.some((m) => prim.has(m)), label).toBe(false);
    }
    expect(r.audit!.phases[0].splitShape).toBe("UPPER_LOWER");
  });

  it("ABAB superior/inferior: nenhum músculo do outro lado onde a biblioteca permite", () => {
    const r = generate(upperLower(["A", "B"], 4, ["A", "B"]));
    expect(LOWER.some((m) => primaryIn(firstOf(r, 1, "A")).has(m))).toBe(false);
    expect(UPPER.some((m) => primaryIn(firstOf(r, 1, "B")).has(m))).toBe(false);
  });

  it("corpo inteiro AB, ABC, um treino só e 1 a 7 sessões por semana: geram, quantidades respeitadas", () => {
    const shapes: Array<[string, PhaseSeed]> = [
      ["AB corpo inteiro", { weeks: 2, sessionsPerWeek: 2, stimulus: "HYPERTROPHY", workouts: [{ label: "A", exerciseTarget: 5 }, { label: "B", exerciseTarget: 5 }] }],
      ["ABC", { weeks: 2, sessionsPerWeek: 3, stimulus: "HYPERTROPHY", workouts: ["A", "B", "C"].map((label) => ({ label, exerciseTarget: 4 })) }],
      ["um treino", { weeks: 2, sessionsPerWeek: 3, stimulus: "HYPERTROPHY", workouts: [{ label: "Full", exerciseTarget: 6 }] }],
      ...[1, 2, 3, 4, 5, 6, 7].map((spw): [string, PhaseSeed] => [`${spw}x`, { weeks: 2, sessionsPerWeek: spw, stimulus: "STRENGTH", workouts: [{ label: "A", exerciseTarget: 3 }, { label: "B", exerciseTarget: 3 }] }]),
    ];
    for (const [name, seed] of shapes) {
      const r = generate(baseInput({ catalog: XINTUS_CATALOG, structure: structure("2026-11-09", [seed]) }));
      expect(r.status, name).toBe("SUCCEEDED");
      for (const w of seed.workouts) expect(firstOf(r, 1, w.label).items.length, `${name} ${w.label}`).toBe(w.exerciseTarget);
    }
    // corpo inteiro sem alvos: cada treino do AB trabalha inferior e superior (nenhuma divisão forçada).
    const ab = generate(baseInput({ catalog: XINTUS_CATALOG, structure: structure("2026-11-09", [shapes[0][1]]) }));
    expect(ab.audit!.phases[0].splitShape).toBe("FULL_BODY");
  });
});

describe("microciclo: treino que não aparece em toda semana (ABCD 3×, ABC 2×, AB 1×)", () => {
  const TARGETS = ["CHEST", "QUADRICEPS", "LATS", "HAMSTRINGS"];
  const rotating = (labels: string[], spw: number, rules?: RuleSetRef) => baseInput({
    ...(rules ? { rules } : {}), catalog: XINTUS_CATALOG,
    structure: structure("2026-11-09", [{ weeks: 4, sessionsPerWeek: spw, stimulus: "HYPERTROPHY", workouts: labels.map((label) => ({ label, exerciseTarget: 4 })) }]),
    parameters: parameters({ phaseCoverage: [{ phaseIndex: 1, muscles: TARGETS, basis: "PROFESSIONAL" }] }),
  });
  const cases: Array<[string, string[], number, number]> = [["ABCD 3×", ["A", "B", "C", "D"], 3, 0.75], ["ABC 2×", ["A", "B", "C"], 2, 0.75], ["AB 1×", ["A", "B"], 1, 0.5]];

  it.each(cases)("%s: exposição pela média (não 0), treinos diferentes entre si e todos os alvos cobertos", (_name, labels, spw, xA) => {
    const r = generate(rotating(labels, spw));
    expect(r.status).toBe("SUCCEEDED");
    // a auditoria segue contando a pior semana (0): é a fração que a seleção usa no lugar dela
    expect(r.audit!.phases[0].workouts.find((w) => w.label === "A")!.exposuresPerWeek.min).toBe(0);
    const sets = labels.map((l) => idsOf(firstOf(r, 1, l)) as string[]);
    for (const [i, a] of sets.entries())
      for (const b of sets.slice(i + 1)) expect(a.filter((id) => b.includes(id)).length, `${a} × ${b}`).toBeLessThanOrEqual(2);
    const primary = new Set(labels.flatMap((l) => [...primaryIn(firstOf(r, 1, l))]));
    for (const m of TARGETS) expect(primary.has(m), m).toBe(true);
    expect(codes(r).filter((c) => c.endsWith("_NOT_COVERED"))).toEqual([]);
    // o traço diz que a exposição é uma média
    const deficit = firstOf(r, 1, "A").items.flatMap((i) => i.trace.selection).find((t) => t.code === "MICRO_TARGET_DEFICIT")!;
    expect(deficit.detail).toContain(`aparece ${String(xA).replace(".", ",")}× por semana em média`);
  });

  it("mesmo exercício em outro treino pesa pela média de exposições; a oferta da sugestão também conta a média", () => {
    const r = generate(rotating(["A", "B", "C", "D"], 3));
    const same = r.occurrences.flatMap((o) => o.items).flatMap((i) => i.trace.selection).filter((t) => t.code === "MICRO_SAME_EXERCISE");
    for (const t of same) expect(t.detail).toMatch(/em média/);
    const phaseOf = (labels: string[], spw: number) => structure("2026-11-09", [{ weeks: 4, sessionsPerWeek: spw, stimulus: "HYPERTROPHY", workouts: labels.map((label) => ({ label })) }]).phases[0];
    const abcd3 = targetSuggestion(MICRO, phaseOf(["A", "B", "C", "D"], 3), baseInput()).suggestion!;
    expect(abcd3.supply).toBe(3);
    expect(abcd3.weeklySets.every((w) => w.minDirectSessions === 2)).toBe(true);
    expect(targetSuggestion(MICRO, phaseOf(["A", "B", "C"], 2), baseInput()).suggestion!.supply).toBe(2);
    const ab1 = targetSuggestion(MICRO, phaseOf(["A", "B"], 1), baseInput()).suggestion!;
    expect(ab1.supply).toBe(1);
    expect(ab1.weeklySets.every((w) => w.minDirectSessions === undefined)).toBe(true);
  });

  it("treino mantido numa regeneração que não aparece em toda semana: conta pela pior sessão × a média", () => {
    const input = rotating(["A", "B", "C", "D"], 3);
    const before = generate(input);
    const fixed = fixedWorkoutFrom(prepare(input)!, input.structure.phases[0], "A", before.occurrences);
    expect(fixed.exposures).toBe(0.75);
    for (const id of idsOf(firstOf(before, 1, "A"))) expect(fixed.exercises[id!]).toBe(0.75);
    const rb = ok(regenerate(input, before, { kind: "WORKOUT", phaseIndex: 1, label: "D" }));
    expect(canonicalJson(rb.occurrences.filter((o) => o.label !== "D"))).toBe(canonicalJson(before.occurrences.filter((o) => o.label !== "D")));
    expect(canonicalJson(rb.occurrences.filter((o) => o.label === "D").map(idsOf))).toBe(canonicalJson(before.occurrences.filter((o) => o.label === "D").map(idsOf)));
  });
});

describe("microciclo: regenerar sem mudar nada devolve o mesmo plano, também em rodízio", () => {
  // Revisão final V3: em rodízio (treino que falta em alguma semana), a semana ou o treino regenerado escolhia diferente da
  // geração com a mesma entrada, porque os treinos mantidos entravam inteiros no estado antes do guloso.
  const shapes: Array<[string, string[], number, boolean, CatalogExercise[] | undefined]> = [
    ["ABCD 3×, sem alvos", ["A", "B", "C", "D"], 3, false, undefined],
    ["ABCD 3×, com alvos", ["A", "B", "C", "D"], 3, true, XINTUS_CATALOG],
    ["ABC 2×, sem alvos", ["A", "B", "C"], 2, false, XINTUS_CATALOG],
    ["ABC 4×, sem alvos", ["A", "B", "C"], 4, false, undefined],
    ["AB 3×, com alvos", ["A", "B"], 3, true, XINTUS_CATALOG],
  ];
  it.each(shapes)("%s: semana, treino (inteiro e a partir da semana 2) e sessão", (_name, labels, spw, targets, catalog) => {
    const input = baseInput({
      ...(catalog ? { catalog } : {}),
      structure: structure("2026-11-09", [{ weeks: 4, sessionsPerWeek: spw, stimulus: "HYPERTROPHY", workouts: labels.map((label) => ({ label, exerciseTarget: 4 })) }]),
      ...(targets ? { parameters: parameters({ phaseCoverage: [{ phaseIndex: 1, muscles: ["QUADRICEPS", "HAMSTRINGS", "GLUTES", "CHEST", "LATS"], basis: "PROFESSIONAL" }] }) } : {}),
    });
    const g = generate(input);
    expect(g.status).toBe("SUCCEEDED");
    const same = canonicalJson(g.occurrences);
    const scopes = [
      ...[1, 2, 3, 4].map((week) => ({ kind: "WEEK" as const, phaseIndex: 1, week })),
      ...labels.flatMap((label) => [{ kind: "WORKOUT" as const, phaseIndex: 1, label }, { kind: "WORKOUT" as const, phaseIndex: 1, label, fromWeek: 2 }]),
      ...g.occurrences.slice(0, 3).map((o) => ({ kind: "OCCURRENCE" as const, phaseIndex: 1, week: o.week, slot: o.slot })),
    ];
    for (const scope of scopes) expect(canonicalJson(ok(regenerate(input, g, scope)).occurrences), JSON.stringify(scope)).toBe(same);
  });
});

describe("microciclo: cardio e mobilidade não recebem alvos de hipertrofia", () => {
  it("fase só de cardio e mobilidade: mesma seleção da 2026.11.3, sem termos de microciclo", () => {
    const seed: PhaseSeed = { weeks: 2, sessionsPerWeek: 3, workouts: [
      { label: "Z2", exerciseTarget: 1, focus: { stimulus: { value: "AEROBIC_ENDURANCE", source: "STRUCTURE", basis: "PROFESSIONAL" } } },
      { label: "HIIT", exerciseTarget: 1, focus: { stimulus: { value: "INTERVALS", source: "STRUCTURE", basis: "PROFESSIONAL" } } },
      { label: "Mob", exerciseTarget: 2, focus: { stimulus: { value: "MOBILITY", source: "STRUCTURE", basis: "PROFESSIONAL" } } },
    ] };
    const input = baseInput({ structure: structure("2026-11-09", [seed]) });
    const micro = generate(input);
    const legacy = generate({ ...input, rules: AUDIT_RULES });
    expect(canonicalJson(micro.occurrences.map((o) => o.items.map((i) => [i.exerciseId, i.trace.selection, i.dose])))).toBe(
      canonicalJson(legacy.occurrences.map((o) => o.items.map((i) => [i.exerciseId, i.trace.selection, i.dose]))));
  });

  it("fase de hipertrofia com A resistido, C cardio e D mobilidade (A,C,A,D): alvos só no resistido", () => {
    const seed: PhaseSeed = { weeks: 2, sessionsPerWeek: 4, stimulus: "HYPERTROPHY", rotation: ["A", "C", "A", "D"], workouts: [
      { label: "A", exerciseTarget: 5 },
      { label: "C", exerciseTarget: 1, focus: { stimulus: { value: "AEROBIC_ENDURANCE", source: "STRUCTURE", basis: "PROFESSIONAL" } } },
      { label: "D", exerciseTarget: 2, focus: { stimulus: { value: "MOBILITY", source: "STRUCTURE", basis: "PROFESSIONAL" } } },
    ] };
    const input = baseInput({ structure: structure("2026-11-09", [seed]), parameters: parameters({ phaseCoverage: [{ phaseIndex: 1, muscles: ["QUADRICEPS", "CHEST"], weeklySets: [{ muscle: "QUADRICEPS", minWeighted: 6 }], basis: "PROFESSIONAL" }] }) });
    const r = generate(input);
    expect(r.status).toBe("SUCCEEDED");
    for (const label of ["C", "D"])
      for (const i of firstOf(r, 1, label).items) expect(i.trace.selection.some((t) => t.code.startsWith("MICRO_")), `${label} ${i.exerciseId}`).toBe(false);
    expect(firstOf(r, 1, "A").items.some((i) => i.trace.selection.some((t) => t.code === "MICRO_TARGET_DEFICIT"))).toBe(true);
    expect(r.audit!.phases[0].workouts.filter((w) => w.volumeWorkout).map((w) => w.label)).toEqual(["A"]);
  });

  it("treino só de cardio numa fase de hipertrofia, sem alvos: NO_TARGETS sem a sugestão de hipertrofia", () => {
    const seed: PhaseSeed = { weeks: 2, sessionsPerWeek: 2, stimulus: "HYPERTROPHY", workouts: [
      { label: "A", exerciseTarget: 4 }, { label: "C", exerciseTarget: 1, focus: { modalities: ["CARDIO"] } },
    ] };
    const r = generate(baseInput({ structure: structure("2026-11-09", [seed]) }));
    const issues = r.issues.filter((i) => i.code === "NO_TARGETS");
    expect(issues.find((i) => i.label === "A")!.suggestions).toEqual([expect.objectContaining({ ruleId: "MICROCYCLE_TARGET_SUGGESTIONS", value: "HYPERTROPHY" })]);
    expect(issues.find((i) => i.label === "C")!.suggestions).toEqual([]);
  });
});

describe("microciclo: doses e auditoria (§8.3.14)", () => {
  it("a auditoria da proposta do microciclo não lê a origem (travar não a muda) e não muda a entrada", () => {
    const r = generate(xintusInput());
    const log = ruleLogFor(MICRO)!;
    const locked = r.occurrences.map((o) => ({ ...o, items: o.items.map((i) => ({ ...i, origin: "LOCKED" as const })) }));
    const copy = JSON.parse(JSON.stringify(locked));
    const deepFreeze = (v: unknown): void => { if (v && typeof v === "object") { Object.values(v).forEach(deepFreeze); Object.freeze(v); } };
    deepFreeze(locked);
    const again = boundAudit(log, auditPlan({ log, phases: r.phases, structure: null, workouts: r.workouts, occurrences: locked, volume: r.volume, byId: new Map(XINTUS_CATALOG.map((e) => [e.id, e])) }));
    expect(canonicalJson(again)).toBe(canonicalJson(r.audit));
    expect(canonicalJson(locked)).toBe(canonicalJson(copy));
  });
});

describe("microciclo: determinismo, desempate e limite de passos", () => {
  it("catálogo embaralhado → mesmos bytes (Xintus e periodização padrão); empates registrados", () => {
    for (const make of [(c?: CatalogExercise[]) => xintusInput(undefined, c ? { catalog: c } : {}), (c?: CatalogExercise[]) => baseInput(c ? { catalog: c } : {})]) {
      const a = generate(make());
      const catalog = [...make().catalog].reverse();
      const shuffled = [...catalog.slice(7), ...catalog.slice(0, 7)];
      expect(canonicalJson(generate(make(shuffled)))).toBe(canonicalJson(a));
      expect(canonicalJson(generate(make()))).toBe(canonicalJson(a));
    }
    const details = generate(baseInput()).occurrences.flatMap((o) => o.items).flatMap((i) => i.trace.selection.filter((t) => t.code === "RANK").map((t) => t.detail));
    expect(details.some((d) => d.includes("empate desfeito pela ordem dos treinos e pelo código do exercício"))).toBe(true);
    expect(details.some((d) => !d.includes("empate"))).toBe(true);
  });

  it("passos ≤ quantidade pedida; com maxSteps 3 (regra de teste) para com MICROCYCLE_STEP_LIMIT, sem CATALOG_INSUFFICIENT", () => {
    const input = xintusInput();
    const ctx = prepare(input)!;
    const phase = input.structure.phases[0];
    const plan = planPhaseMicrocycle(ctx, phase, new Set());
    expect(plan.steps).toBe(12); // 6 + 6 vagas, nenhuma tentativa a mais
    const rules = JSON.parse(JSON.stringify(getRuleSet(MICRO))) as RuleSet;
    rules.rules.MICROCYCLE_SELECTION!.value.maxSteps = 3;
    const limited = planPhaseMicrocycle({ ...ctx, log: new RuleLog(rules) }, phase, new Set());
    expect(limited.steps).toBe(3);
    const issues = limited.plans.flatMap((p) => p.issues);
    expect(issues.filter((i) => i.code === "MICROCYCLE_STEP_LIMIT").map((i) => i.label).sort()).toEqual(["A", "B"]);
    expect(issues.some((i) => i.code === "CATALOG_INSUFFICIENT")).toBe(false);
    expect(issues.find((i) => i.code === "MICROCYCLE_STEP_LIMIT")!.message).toMatch(/limite técnico de passos com \d vaga\(s\) aberta\(s\)/);
  });

  it("biblioteca insuficiente: CATALOG_INSUFFICIENT com os motivos, como antes", () => {
    const tiny = [...CATALOG.filter((e) => e.modality !== "RESISTANCE"), ...CATALOG.filter((e) => e.modality === "RESISTANCE").slice(0, 3)];
    const r = generate(baseInput({ catalog: tiny, structure: structure("2026-11-09", [{ weeks: 1, sessionsPerWeek: 2, stimulus: "HYPERTROPHY", workouts: [{ label: "A", exerciseTarget: 5 }, { label: "B", exerciseTarget: 5 }] }]) }));
    const insufficient = r.issues.filter((i) => i.code === "CATALOG_INSUFFICIENT");
    expect(insufficient.map((i) => i.label)).toEqual(["A", "B"]);
    expect(insufficient[0].message).toMatch(/pedidos 5 exercícios, 3 possíveis\. Fora da seleção: /);
  });

  it("metadados pendentes ficam fora da seleção (e da conta da semana), com o mesmo aviso da seleção por treino", () => {
    const pending = exercise({ id: "ex-pending", name: "Pendente", primaryMuscles: ["CHEST"], patterns: ["HORIZONTAL_PUSH"], metadataStatus: "PENDING", equipment: [] });
    const input = baseInput({ catalog: [...CATALOG, pending] });
    const micro = generate(input);
    const legacy = generate({ ...input, rules: AUDIT_RULES });
    expect(micro.occurrences.some((o) => o.items.some((i) => i.exerciseId === "ex-pending"))).toBe(false);
    expect(micro.workouts.map((w) => w.excluded)).toEqual(legacy.workouts.map((w) => w.excluded));
  });

  it("pelo tempo (BY_TIME): cada treino para no tempo disponível", () => {
    const input = baseInput({
      structure: structure("2026-11-09", [{ weeks: 1, sessionsPerWeek: 2, stimulus: "HYPERTROPHY", workouts: [{ label: "A", exerciseTarget: null }, { label: "B", exerciseTarget: null }] }]),
      parameters: parameters({ availableMinutes: 30, exerciseCountByWorkout: [{ phaseIndex: 1, label: "A", count: "BY_TIME" }, { phaseIndex: 1, label: "B", count: "BY_TIME" }] }),
    });
    const r = generate(input);
    for (const o of r.occurrences) {
      expect(o.items.length).toBeGreaterThan(0);
      expect(o.estimatedMinutes!).toBeLessThanOrEqual(30);
    }
    expect(r.workouts.every((w) => w.count?.ruleId === "COUNT_FROM_TIME")).toBe(true);
  });
});

describe("microciclo: o que o profissional decidiu é soberano (preservados, travados, trocas, doses)", () => {
  const seed: PhaseSeed = { weeks: 4, sessionsPerWeek: 4, stimulus: "HYPERTROPHY", rotation: ["A", "B"], workouts: [{ label: "A", exerciseTarget: 6 }, { label: "B", exerciseTarget: 6 }] };
  const make = (over: Partial<EngineInput> = {}) => baseInput({
    catalog: XINTUS_CATALOG, structure: structure("2026-11-09", [seed]),
    parameters: parameters({ phaseCoverage: [{ phaseIndex: 1, muscles: ["CHEST", "QUADRICEPS", "LATS"], weeklySets: [{ muscle: "CHEST", minWeighted: 6, maxWeighted: 12 }], basis: "PROFESSIONAL" }] }),
    ...over,
  });

  it("linha preservada de peito em A: conta na semana (sem outro peito além do alvo) e fica byte a byte", () => {
    const dose = { metric: "REPS" as const, sets: 3, reps: { min: 6, max: 10 }, restSeconds: 120, loadBasis: "TOTAL" as const, loadKg: null };
    const row: ExistingItem = { prescribedExerciseId: "pe-1", phaseIndex: 1, label: "A", exerciseId: "ex-bench", name: "Supino reto", position: 1, dose, display: { ...toDisplayFields(dose) }, origin: "PROFESSIONAL" };
    const r = generate(make({ existing: [row] }));
    // 3 séries × 2 sessões de A = 6 = o mínimo: nenhuma escolha puxada pelo déficit de peito; o peito não passa do máximo.
    const picks = r.occurrences.flatMap((o) => o.items).filter((i) => i.origin === "ENGINE");
    expect(picks.some((i) => i.trace.selection.some((t) => t.code === "MICRO_TARGET_DEFICIT" && t.detail.startsWith("Peitoral")))).toBe(false);
    expect(firstOf(r, 1, "A").items.filter((i) => exOf(i.exerciseId)?.primaryMuscles.includes("CHEST")).map((i) => i.exerciseId)).toEqual(["ex-bench"]);
    const chest = r.audit!.phases[0].muscles.find((m) => m.muscle === "CHEST")!;
    expect(chest.weighted!.max).toBeLessThanOrEqual(12);
    expect(r.audit!.findings.filter((f) => f.code === "AUDIT_TARGET_MUSCLE_UNMET" && f.muscle === "CHEST")).toEqual([]);
    for (const o of r.occurrences.filter((x) => x.label === "A")) {
      const kept = o.items.find((i) => i.origin === "PRESERVED")!;
      expect(kept.dose).toEqual(dose);
    }
  });

  it("item travado é mantido e contado; doseOverrides e doses manuais iguais depois de regenerar", () => {
    const input = make({ parameters: { ...make().parameters, doseOverrides: [{ exerciseId: "ex-legpress", patch: { values: { sets: 5 } } }] } });
    const before = generate(input);
    // Trava o peito de A (3 séries × 2 sessões = 6 = o mínimo semanal do alvo).
    const lock = firstOf(before, 1, "A").items.find((i) => i.exerciseId === "ex-bench")!;
    expect(lock.trace.selection.find((t) => t.code === "MICRO_TARGET_DEFICIT")!.detail).toContain("faltavam 6 séries ponderadas; este exercício soma 6");
    const locked = { ...input, locked: [{ phaseIndex: 1, slotKey: lock.slotKey }] };
    const after = ok(regenerate(locked, before, { kind: "PHASE", phaseIndex: 1 }));
    const dosesOf = (r: EngineResult) => r.occurrences.filter((o) => o.label === "A").map((o) => o.items.find((i) => i.slotKey === lock.slotKey));
    for (const [n, kept] of dosesOf(after).entries()) {
      expect(kept).toMatchObject({ exerciseId: "ex-bench", origin: "LOCKED" });
      expect(canonicalJson(kept!.dose)).toBe(canonicalJson(dosesOf(before)[n]!.dose));
    }
    // Contado no estado da semana: nenhuma escolha do motor é puxada pelo déficit de peito (já atendido pelo travado).
    const picks = after.occurrences.flatMap((o) => o.items).filter((i) => i.origin === "ENGINE");
    expect(picks.length).toBeGreaterThan(0);
    expect(picks.some((i) => i.trace.selection.some((t) => t.code === "MICRO_TARGET_DEFICIT" && t.detail.startsWith("Peitoral")))).toBe(false);
    // doseOverrides do profissional: o leg press continua com 5 séries em toda sessão (antes e depois).
    for (const r of [before, after]) {
      const legpress = r.occurrences.flatMap((o) => o.items).filter((i) => i.exerciseId === "ex-legpress");
      expect(legpress.length).toBeGreaterThan(0);
      for (const i of legpress) expect(i.dose).toMatchObject({ metric: "REPS", sets: 5 });
    }
  });

  it("troca na fase inteira sobrevive a regenerar o treino (vaga reservada), sem SUBSTITUTION_DROPPED", () => {
    const input = make();
    const before = generate(input);
    const target = firstOf(before, 1, "A").items[0];
    const replacement = target.alternatives[0];
    const sub = ok(substitute(input, before, { phaseIndex: 1, slotKey: target.slotKey, applies: { kind: "PHASE" } }, replacement));
    const r = ok(regenerate(input, sub, { kind: "WORKOUT", phaseIndex: 1, label: "A" }));
    expect(codes(r)).not.toContain("SUBSTITUTION_DROPPED");
    for (const o of r.occurrences.filter((x) => x.label === "A")) {
      expect(o.items.filter((i) => i.exerciseId === replacement && i.origin === "SUBSTITUTED")).toHaveLength(1);
      expect(o.items).toHaveLength(6);
      // o exercício que o profissional tirou não volta pela seleção
      expect(o.items.some((i) => i.exerciseId === target.exerciseId)).toBe(false);
    }
    // B ficou como estava (treino fora do escopo)
    expect(canonicalJson(r.occurrences.filter((o) => o.label === "B"))).toBe(canonicalJson(sub.occurrences.filter((o) => o.label === "B")));
  });

  it("troca a partir da semana 3, depois regenerar o treino: semanas 1–2 com 6 itens, a troca segue nas 3+", () => {
    const input = make();
    const before = generate(input);
    const target = firstOf(before, 1, "A").items[0];
    const replacement = target.alternatives[0];
    const sub = ok(substitute(input, before, { phaseIndex: 1, slotKey: target.slotKey, applies: { kind: "FROM_WEEK", week: 3 } }, replacement));
    const r = ok(regenerate(input, sub, { kind: "WORKOUT", phaseIndex: 1, label: "A" }));
    for (const o of r.occurrences.filter((x) => x.label === "A")) {
      expect(o.items.length, `semana ${o.week}`).toBe(6);
      expect(o.items.some((i) => i.exerciseId === replacement && i.origin === "SUBSTITUTED"), `semana ${o.week}`).toBe(o.week >= 3);
    }
    // Regenerar B com a troca parcial em A: A entra fixo pela pior semana (a troca, só nas semanas 3+, não conta; o
    // exercício trocado, só nas semanas 1–2, também não).
    const fixed = fixedWorkoutFrom(prepare(input)!, input.structure.phases[0], "A", sub.occurrences);
    expect(fixed.exposures).toBe(2);
    expect(fixed.exercises[replacement]).toBe(0);
    expect(fixed.exercises[target.exerciseId!]).toBe(0);
    expect(fixed.weighted.CHEST).toBe(6);
    const rb = ok(regenerate(input, sub, { kind: "WORKOUT", phaseIndex: 1, label: "B" }));
    const bItems = rb.occurrences.filter((o) => o.label === "B").flatMap((o) => o.items);
    // Pelos números do traço: o peito de A na pior semana (6) já atende o mínimo, então nada em B é puxado pelo déficit de
    // peito; e o exercício que A tem só nas semanas 1–2 não pesa como "mesmo exercício em outro treino".
    expect(bItems.some((i) => i.trace.selection.some((t) => t.code === "MICRO_TARGET_DEFICIT" && t.detail.startsWith("Peitoral")))).toBe(false);
    for (const i of bItems.filter((x) => x.exerciseId === target.exerciseId || x.exerciseId === replacement))
      expect(i.trace.selection.some((t) => t.code === "MICRO_SAME_EXERCISE")).toBe(false);
    expect(canonicalJson(rb.occurrences.filter((o) => o.label === "A"))).toBe(canonicalJson(sub.occurrences.filter((o) => o.label === "A")));
    expect(rb.workouts.find((w) => w.label === "A")).toEqual(sub.workouts.find((w) => w.label === "A"));
  });

  it("todos os escopos de regeneração, a continuação fase a fase, o rebase e as alternativas funcionam no microciclo", () => {
    const input = xintusInput();
    const before = generate(input);
    const changed: EngineInput = { ...input, parameters: { ...input.parameters, doseOverrides: [{ patch: { values: { restSeconds: 150 } } }] } };
    const first = before.occurrences[0];
    const scopes: Array<Parameters<typeof regenerate>[2]> = [
      { kind: "ITEM", phaseIndex: 1, week: 1, slot: 1, slotKey: first.items[0].slotKey },
      { kind: "OCCURRENCE", phaseIndex: 1, week: 2, slot: 3 },
      { kind: "WEEK", phaseIndex: 2, week: 3 },
      { kind: "WORKOUT", phaseIndex: 2, label: "B", fromWeek: 2 },
      { kind: "PHASE", phaseIndex: 3 },
      { kind: "FROM_PHASE", phaseIndex: 2 },
    ];
    for (const scope of scopes) {
      const r = ok(regenerate(scope.kind === "ITEM" ? input : changed, before, scope));
      expect(r.status, scope.kind).toBe("SUCCEEDED");
      expect(r.occurrences.length, scope.kind).toBe(before.occurrences.length);
      expect(r.audit!.rules).toEqual(MICRO);
    }
    // Continuar fase a fase (como o serviço): a fase seguinte usa a anterior gravada para a variação.
    let cont = generate({ ...input, scope: { kind: "PHASES", phaseIndexes: [1] } });
    for (const phaseIndex of [2, 3]) cont = ok(regenerate(input, cont, { kind: "PHASE", phaseIndex }));
    expect(canonicalJson(cont.occurrences.map(idsOf))).toBe(canonicalJson(before.occurrences.map(idsOf)));
    const row: ExistingItem = { prescribedExerciseId: "pe-x", phaseIndex: 1, label: "B", exerciseId: "ex-curl", name: "Rosca direta", position: 9, dose: null, display: { ...toDisplayFields(null) }, origin: "PROFESSIONAL" };
    const rebased = ok(rebase({ ...input, existing: [row] }, before));
    expect(firstOf(rebased, 1, "B").items[0]).toMatchObject({ exerciseId: "ex-curl", origin: "PRESERVED" });
    expect(alternativesFor(input, before, { phaseIndex: 1, slotKey: first.items[0].slotKey }, 5).length).toBeGreaterThan(0);
  });
});

describe("microciclo: alvos sugeridos (só com aceite)", () => {
  const phaseOf = (seed: PhaseSeed): StructurePhase => structure("2026-11-09", [seed]).phases[0];
  it("ABCD 4×/semana: ≥ 2 de 4 sessões; AB 2×/semana: minDirectSessions omitido (forçaria todo treino)", () => {
    const abcd = targetSuggestion(MICRO, phaseOf({ weeks: 2, sessionsPerWeek: 4, stimulus: "HYPERTROPHY", workouts: ["A", "B", "C", "D"].map((label) => ({ label })) }), baseInput());
    expect(abcd.suggestion).toMatchObject({ stimulus: "HYPERTROPHY", supply: 4, ruleId: "MICROCYCLE_TARGET_SUGGESTIONS" });
    expect(abcd.suggestion!.weeklySets.every((w) => w.minDirectSessions === 2 && w.minWeighted === 10 && w.maxWeighted === 20)).toBe(true);
    const ab = targetSuggestion(MICRO, phaseOf({ weeks: 2, sessionsPerWeek: 2, stimulus: "HYPERTROPHY", workouts: [{ label: "A" }, { label: "B" }] }), baseInput());
    expect(ab.suggestion!.supply).toBe(2);
    expect(ab.suggestion!.weeklySets.every((w) => w.minDirectSessions === undefined)).toBe(true);
    expect(targetSuggestion(MICRO, phaseOf({ weeks: 2, sessionsPerWeek: 2, stimulus: "STRENGTH", workouts: [{ label: "A" }, { label: "B" }] }), baseInput()).suggestion)
      .toMatchObject({ muscles: [], weeklySets: [], patterns: ["HINGE", "HORIZONTAL_PULL", "HORIZONTAL_PUSH", "SQUAT", "VERTICAL_PULL", "VERTICAL_PUSH"] });
    expect(targetSuggestion(AUDIT_RULES, phaseOf({ weeks: 2, sessionsPerWeek: 2, stimulus: "HYPERTROPHY", workouts: [{ label: "A" }] }), baseInput())).toEqual({ suggestion: null, reason: "NO_RULE" });
  });

  it("estímulos variados na fase: sem sugestão (o profissional define); cardio sozinho: sem entrada", () => {
    const mixed = phaseOf({ weeks: 2, sessionsPerWeek: 2, stimulus: "HYPERTROPHY", workouts: [{ label: "A" }, { label: "B", focus: { stimulus: { value: "STRENGTH", source: "STRUCTURE", basis: "PROFESSIONAL" } } }] });
    expect(targetSuggestion(MICRO, mixed, baseInput())).toEqual({ suggestion: null, reason: "MIXED_STIMULI" });
    const r = generate(baseInput({ structure: { startDate: "2026-11-09", phases: [mixed] } }));
    const issue = r.issues.find((i) => i.code === "NO_TARGETS")!;
    expect(issue.suggestions).toEqual([]);
    expect(issue.message).toContain("Os estímulos variam nesta fase; defina os alvos manualmente.");
    expect(targetSuggestion(MICRO, phaseOf({ weeks: 1, sessionsPerWeek: 1, stimulus: "AEROBIC_ENDURANCE", workouts: [{ label: "Z2" }] }), baseInput())).toEqual({ suggestion: null, reason: "UNKNOWN_STIMULUS" });
  });

  it("aceitos: a cobertura gravada traz HEURISTIC_ACCEPTED com a regra e os alvos semanais", () => {
    const input = withCoverage(xintusInput(), acceptedSuggestion(xintusInput()));
    const r = generate(input);
    const cov = r.workouts[0].coverage!;
    expect(cov).toMatchObject({ basis: "HEURISTIC_ACCEPTED", ruleId: "MICROCYCLE_TARGET_SUGGESTIONS", origin: "PHASE_COVERAGE" });
    expect(cov.weeklySets!.every((w) => w.basis === "HEURISTIC_ACCEPTED" && w.ruleId === "MICROCYCLE_TARGET_SUGGESTIONS")).toBe(true);
    expect(codes(r)).not.toContain("NO_TARGETS");
  });
});

describe("microciclo: medição local (Node, indicativa) do caso grande", () => {
  it("12 fases × 4 semanas × 7 sessões × 7 treinos × 8 itens, 500 exercícios: 2026.11.3 e 2026.11.4", () => {
    const resistance = CATALOG.filter((e) => e.modality === "RESISTANCE");
    const catalog = Array.from({ length: 500 }, (_, i) => ({ ...resistance[i % resistance.length], id: `gen-${String(i).padStart(3, "0")}`, substitutes: [] }));
    const labels = ["A", "B", "C", "D", "E", "F", "G"];
    const st = structure("2026-11-09", Array.from({ length: 12 }, () => ({ weeks: 4, sessionsPerWeek: 7, stimulus: "HYPERTROPHY", workouts: labels.map((label) => ({ label, exerciseTarget: 8 })) })));
    const gc = (globalThis as { gc?: () => void }).gc;
    const rows: Array<Record<string, string | number>> = [];
    const measure = (version: string, op: string, run: () => unknown) => {
      gc?.();
      const heap0 = process.memoryUsage().heapUsed;
      const t = performance.now();
      run();
      const ms = performance.now() - t;
      const heap = (process.memoryUsage().heapUsed - heap0) / 1048576;
      rows.push({ version, op, ms: Math.round(ms), heapDeltaMb: Math.round(heap * 10) / 10 });
      return ms;
    };
    for (const version of ["2026.11.3", "2026.11.4"]) {
      const input: EngineInput = baseInput({ rules: { id: "gymgital-base", version }, catalog, structure: st });
      let full!: EngineResult;
      measure(version, "FULL", () => (full = generate(input)));
      expect(full.status).toBe("SUCCEEDED");
      // A continuação na seleção por treino replaneja todas as fases a cada pedido (≈ 33 s neste caso, medido em 04/11/2026):
      // só com MOTOR_MEASURE_LEGACY=1, para não alongar a suíte.
      if (version === "2026.11.4" || process.env.MOTOR_MEASURE_LEGACY === "1") measure(version, "CONTINUE 12×", () => {
        let r = generate({ ...input, scope: { kind: "PHASES", phaseIndexes: [1] } });
        for (let p = 2; p <= 12; p++) r = ok(regenerate(input, r, { kind: "PHASE", phaseIndex: p }));
      });
      measure(version, "FROM_PHASE 2", () => ok(regenerate(input, full, { kind: "FROM_PHASE", phaseIndex: 2 })));
      measure(version, "WORKOUT", () => ok(regenerate(input, full, { kind: "WORKOUT", phaseIndex: 3, label: "C" })));
      const item = full.occurrences[0].items[0];
      measure(version, "ALTERNATIVES", () => alternativesFor(input, full, { phaseIndex: 1, slotKey: item.slotKey }, 8));
      measure(version, "SUBSTITUTE", () => ok(substitute(input, full, { phaseIndex: 1, slotKey: item.slotKey, applies: { kind: "PHASE" } }, item.alternatives[0])));
      if (version === "2026.11.4") {
        const ctx = prepare(input)!;
        for (const phase of input.structure.phases.slice(0, 2)) expect(planPhaseMicrocycle(ctx, phase, new Set()).steps).toBeLessThanOrEqual(7 * 8);
      }
    }
    console.log(`[motor-microcycle] medição local (Node ${process.version}, gc ${gc ? "exposto" : "não exposto"}):\n${rows.map((r) => `${r.version} ${r.op}: ${r.ms} ms, heap Δ ${r.heapDeltaMb} MB`).join("\n")}`);
    for (const r of rows.filter((x) => x.version === "2026.11.4")) expect(r.ms as number, String(r.op)).toBeLessThan(5000);
  }, 180_000);
});
