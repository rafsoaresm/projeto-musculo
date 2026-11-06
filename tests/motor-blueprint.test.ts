/**
 * Motor V4, PR 2.1: ruleset 2026.11.5 (seleção por estratégia), foco dominante por treino no motor e compilador do blueprint.
 * Puro: sem banco, sem rede, sem IA. Nomes, ids e números são fictícios.
 */
import { describe, expect, it } from "vitest";
import {
  canonicalInput, canonicalJson, DEFAULT_RULESET, generate, getRuleSet, rebase, regenerate, RULESETS, substitute, validateRuleSet,
  type BlueprintFocusFact, type BlueprintRole, type CatalogExercise, type EngineInput, type EngineOutcome, type EngineResult, type ItemOut, type RuleSet, type RuleSetRef,
} from "@/modules/prescricao/motor";
import { ROLE_FOCUS_INTERIM_TABLE } from "@/modules/prescricao/planejador/role-focus";
import { WORKOUT_ROLES } from "@/modules/prescricao/planejador/vocab";
import { expandFocus } from "@/modules/prescricao/planejador/focus";
import { roleFocusTableOf } from "@/modules/prescricao/automatica/build-input";
import { baseInput, exercise, FULL_GYM, parameters, structure } from "./helpers/motor-fixtures";
import { XINTUS_CATALOG, xintusInput } from "./helpers/xintus";

const RULES_411: RuleSetRef = { id: "gymgital-base", version: "2026.11.4" };
const NEW = getRuleSet(DEFAULT_RULESET)!;
const TABLE = roleFocusTableOf(NEW.rules.BLUEPRINT_ROLE_FOCUS!.value);

const ok = (o: EngineOutcome): EngineResult => {
  if (!o.ok) throw new Error(`${o.code}: ${o.message}`);
  return o.result;
};
const masked = (r: EngineResult) => canonicalJson({ ...r, engineVersion: "<any>", rules: "<any>", ...(r.audit ? { audit: { ...r.audit, rules: "<any>" } } : {}) });
const summaries = (r: EngineResult, phaseIndex: number) => r.workouts.filter((w) => w.phaseIndex === phaseIndex);
const byId = new Map(XINTUS_CATALOG.map((e) => [e.id, e]));
const exOf = (id: string | null) => byId.get(id ?? "")!;

function fact(phaseIndex: number, label: string, role: BlueprintRole, over: Partial<BlueprintFocusFact> = {}, delta = null): BlueprintFocusFact {
  const f = expandFocus(role, delta, TABLE);
  return {
    phaseIndex, label, role, source: "RULES_HEURISTIC", strategyId: "S1", dominantMuscles: f.dominantMuscles, supportingMuscles: f.supportingMuscles,
    targetPatterns: f.targetPatterns, spilloverPatterns: f.allowedSpilloverPatterns, candidateExerciseIds: [], ...over,
  };
}
const withFocus = (input: EngineInput, focus: BlueprintFocusFact[]): EngineInput => ({ ...input, parameters: { ...input.parameters, blueprintFocus: focus } });
const upperLower = (input: EngineInput = xintusInput(), phases = [1, 2, 3]) => withFocus(input, phases.flatMap((p) => [fact(p, "A", "UPPER"), fact(p, "B", "LOWER")]));

const itemsOf = (r: EngineResult, phaseIndex: number, label: string): ItemOut[] =>
  r.occurrences.filter((o) => o.phaseIndex === phaseIndex && o.label === label).flatMap((o) => o.items);
const firstOccurrence = (r: EngineResult, phaseIndex: number, label: string): ItemOut[] =>
  r.occurrences.find((o) => o.phaseIndex === phaseIndex && o.label === label)?.items ?? [];
const primaries = (items: ItemOut[]) => new Set(items.flatMap((i) => (i.exerciseId ? exOf(i.exerciseId).primaryMuscles : [])));
const jaccard = (a: Set<string>, b: Set<string>) => [...a].filter((x) => b.has(x)).length / new Set([...a, ...b]).size;
const LOWER_DOM = new Set(TABLE.LOWER.dominantMuscles);
const UPPER_DOM = new Set(TABLE.UPPER.dominantMuscles);

describe("ruleset gymgital-base@2026.11.5", () => {
  it("é o padrão das gerações novas, válido, e traz as regras da 2026.11.4 sem mudar nenhuma", () => {
    expect(DEFAULT_RULESET).toEqual({ id: "gymgital-base", version: "2026.11.5" });
    expect(validateRuleSet(NEW)).toEqual([]);
    const old = RULESETS["gymgital-base@2026.11.4"];
    for (const [id, entry] of Object.entries(old.rules)) expect(NEW.rules[id as keyof typeof NEW.rules], id).toEqual(entry);
    expect(Object.keys(NEW.rules).filter((k) => !(k in old.rules)).sort()).toEqual(["AUDIT_STRATEGY", "BLUEPRINT_ROLE_FOCUS", "BLUEPRINT_STRATEGY_TEMPLATES", "MICROCYCLE_BLUEPRINT"]);
    expect(NEW.rules.AUDIT_THRESHOLDS).toEqual(old.rules.AUDIT_THRESHOLDS);
    expect(NEW.rules.MICROCYCLE_BLUEPRINT).toMatchObject({ basis: "HEURISTIC", value: { offFocus: -18, supportingBonus: 4, candidateBonus: 6, fullBodyPatternRepeat: -20, maxCandidatesPerWorkout: 6 } });
  });

  it("a tabela de papéis das regras é a tabela interina do planejador (até a constante sair)", () => {
    for (const role of WORKOUT_ROLES) {
      const r = NEW.rules.BLUEPRINT_ROLE_FOCUS!.value[role];
      const i = ROLE_FOCUS_INTERIM_TABLE[role];
      expect({ d: r.dominantMuscles, s: r.supportingMuscles, t: r.targetPatterns, o: r.spilloverPatterns }).toEqual({
        d: [...i.dominantMuscles], s: [...i.supportingMuscles], t: [...i.targetPatterns], o: [...i.allowedSpilloverPatterns],
      });
    }
  });

  it("rejeita regras malformadas (desconto positivo, bônus negativo, papel sem foco, músculo nos dois lados, modelo com papel inexistente)", () => {
    const clone = (): RuleSet => JSON.parse(JSON.stringify(NEW)) as RuleSet;
    const bad = (mutate: (r: RuleSet) => void) => { const r = clone(); mutate(r); return validateRuleSet(r).join(" | "); };
    expect(bad((r) => { r.rules.MICROCYCLE_BLUEPRINT!.value.offFocus = 5; })).toContain("offFocus");
    expect(bad((r) => { r.rules.MICROCYCLE_BLUEPRINT!.value.supportingBonus = -1; })).toContain("supportingBonus");
    expect(bad((r) => { r.rules.MICROCYCLE_BLUEPRINT!.value.maxCandidatesPerWorkout = 7; })).toContain("maxCandidatesPerWorkout");
    expect(bad((r) => { delete (r.rules as Record<string, unknown>).MICROCYCLE_SELECTION; })).toContain("exige MICROCYCLE_SELECTION");
    expect(bad((r) => { r.rules.BLUEPRINT_ROLE_FOCUS!.value.UPPER.dominantMuscles = []; r.rules.BLUEPRINT_ROLE_FOCUS!.value.UPPER.targetPatterns = []; })).toContain("papel de volume sem foco");
    expect(bad((r) => { r.rules.BLUEPRINT_ROLE_FOCUS!.value.UPPER.supportingMuscles.push("CHEST"); })).toContain("dominante e de apoio");
    expect(bad((r) => { r.rules.BLUEPRINT_ROLE_FOCUS!.value.CARDIO.targetPatterns = ["SQUAT"]; })).toContain("sem volume deve ficar vazio");
    expect(bad((r) => { r.rules.BLUEPRINT_ROLE_FOCUS!.value.UPPER.dominantMuscles.push("NAO_EXISTE"); })).toContain("músculo desconhecido");
    expect(bad((r) => { r.rules.BLUEPRINT_STRATEGY_TEMPLATES!.value.families[1].roleCycle = ["INEXISTENTE" as BlueprintRole]; })).toContain("papel desconhecido");
    expect(bad((r) => { r.rules.AUDIT_STRATEGY!.value.adherenceMin = 1.5; })).toContain("adherenceMin");
  });
});

describe("vocabulário", () => {
  it("a união de papéis do motor é a do planejador (o motor não importa o planejador)", () => {
    const motorRoles: Record<BlueprintRole, true> = {
      FULL_BODY: true, UPPER: true, LOWER: true, PUSH: true, PULL: true, LEGS: true, CHEST_TRICEPS: true, BACK_BICEPS: true, SHOULDERS_ARMS: true,
      CORE: true, CUSTOM: true, CARDIO: true, MOBILITY: true, BALANCE: true, SKILL: true,
    };
    expect(Object.keys(motorRoles).sort()).toEqual([...WORKOUT_ROLES].sort());
  });
});

describe("regras anteriores intactas (reprodução bit a bit)", () => {
  const inputs: Array<[string, (r: RuleSetRef) => EngineInput]> = [
    ["base", (rules) => baseInput({ rules })],
    ["xintus", (rules) => xintusInput(rules)],
  ];
  it.each(inputs)("2026.11.5 sem estratégia na entrada dá o resultado da 2026.11.4 (%s)", (_n, make) => {
    const a = generate(make(RULES_411));
    const b = generate(make(DEFAULT_RULESET));
    expect(masked(b)).toBe(masked(a));
    expect(b.rulesUsed.map((u) => u.ruleId)).not.toContain("MICROCYCLE_BLUEPRINT");
    expect(canonicalJson(b.occurrences)).not.toMatch(/BLUEPRINT|MICRO_OFF_FOCUS|"origin":"(AI|RULES|PROF)/);
  });

  it.each(["2026.11.1", "2026.11.2", "2026.11.3", "2026.11.4"])("%s ignora blueprintFocus: mesmo resultado e mesma entrada canônica (a chave nem existe)", (version) => {
    const rules = { id: "gymgital-base", version };
    const plain = xintusInput(rules);
    const guided = upperLower(xintusInput(rules));
    expect(canonicalJson(generate(guided))).toBe(canonicalJson(generate(plain)));
    expect(canonicalInput(plain)).not.toContain("blueprintFocus");
    const r = generate(guided);
    expect(r.occurrences.flatMap((o) => o.items).every((i) => !i.trace.selection.some((t) => t.ruleId === "MICROCYCLE_BLUEPRINT"))).toBe(true);
    expect(r.workouts.every((w) => w.coverage?.origin !== "BLUEPRINT_FOCUS")).toBe(true);
  });

  it("o resultado de uma proposta 2026.11.4 regenera sem diferença quando as regras da proposta são fixadas", () => {
    const input = xintusInput(RULES_411);
    const first = ok({ ok: true, result: generate(input) });
    const again = ok(regenerate(input, first, { kind: "PHASE", phaseIndex: 2 }));
    expect(canonicalJson(again.occurrences)).toBe(canonicalJson(first.occurrences));
    expect(again.rules).toEqual(RULES_411);
  });
});

describe("foco dominante por treino (Xintus, hipertrofia, 4 sessões, ABAB, academia completa)", () => {
  const guided = generate(upperLower());
  const plain = generate(xintusInput());

  it("superior/inferior: A e B ficam diferentes de verdade, em todas as ocorrências e fases", () => {
    expect(guided.status).toBe("SUCCEEDED");
    for (const phase of [1, 2, 3]) {
      const a = itemsOf(guided, phase, "A");
      const b = itemsOf(guided, phase, "B");
      expect(a.length).toBeGreaterThanOrEqual(12);
      for (const i of a) {
        const e = exOf(i.exerciseId);
        expect(e.primaryMuscles.some((m) => LOWER_DOM.has(m)), `A fase ${phase}: ${e.name}`).toBe(false);
      }
      for (const i of b) {
        const e = exOf(i.exerciseId);
        expect(e.primaryMuscles.some((m) => UPPER_DOM.has(m)), `B fase ${phase}: ${e.name}`).toBe(false);
      }
      expect(jaccard(primaries(a), primaries(b))).toBeLessThanOrEqual(0.15);
      const upperPatterns = new Set(a.flatMap((i) => exOf(i.exerciseId).patterns).filter((p) => ["HORIZONTAL_PUSH", "HORIZONTAL_PULL", "VERTICAL_PUSH", "VERTICAL_PULL"].includes(p)));
      expect(upperPatterns.size).toBeGreaterThanOrEqual(3);
      const lowerPatterns = new Set(b.flatMap((i) => exOf(i.exerciseId).patterns));
      for (const p of ["SQUAT", "HINGE"]) expect(lowerPatterns.has(p), `B fase ${phase}: ${p}`).toBe(true);
      expect(["KNEE_EXTENSION", "KNEE_FLEXION"].some((p) => lowerPatterns.has(p))).toBe(true);
    }
    for (const w of guided.workouts) expect(w.coverage).toMatchObject({ origin: "BLUEPRINT_FOCUS", ruleId: "MICROCYCLE_BLUEPRINT", basis: "HEURISTIC_ACCEPTED" });
    expect(summaries(guided, 1).map((w) => w.coverage?.blueprint?.role)).toEqual(["UPPER", "LOWER"]);
  });

  it("sem a estratégia os dois treinos se parecem (a causa), e o supino/hack não vazam de lado", () => {
    expect(jaccard(primaries(itemsOf(plain, 1, "A")), primaries(itemsOf(plain, 1, "B")))).toBeGreaterThan(0.5);
    expect(itemsOf(guided, 1, "A").some((i) => i.exerciseId === "ex-hackslide")).toBe(false);
    expect(itemsOf(guided, 1, "B").some((i) => i.exerciseId === "ex-bench")).toBe(false);
  });

  it("o foco dominante não gera aviso de 'não coberto' por treino nem finge ser meta na auditoria", () => {
    expect(guided.issues.map((i) => i.code).filter((c) => c === "MUSCLE_NOT_COVERED" || c === "PATTERN_NOT_COVERED")).toEqual([]);
    const unmet = (guided.audit?.findings ?? []).filter((f) => f.code === "AUDIT_TARGET_MUSCLE_UNMET" || f.code === "AUDIT_TARGET_PATTERN_UNMET");
    expect(unmet).toEqual([]);
    expect(guided.audit?.findings.every((f) => (f.target?.origin as string) !== "BLUEPRINT_FOCUS")).toBe(true);
  });

  it("os termos novos entram no traço com origem e regra (candidato nomeado e apoio), e o 'Por quê?' mostra o valor", () => {
    const r = generate(withFocus(xintusInput(), [1, 2, 3].flatMap((p) => [fact(p, "A", "UPPER", { candidateExerciseIds: ["ex-lateral", "ex-facepull"] }), fact(p, "B", "LOWER", { source: "PROFESSIONAL" })])));
    const terms = r.occurrences.flatMap((o) => o.items).flatMap((i) => i.trace.selection).filter((t) => t.ruleId === "MICROCYCLE_BLUEPRINT");
    expect(terms.some((t) => t.code === "MICRO_CANDIDATE")).toBe(true);
    for (const t of terms) expect(t).toMatchObject({ basis: "HEURISTIC", origin: expect.stringMatching(/^(RULES_HEURISTIC|PROFESSIONAL)$/) });
    expect(terms.find((t) => t.code === "MICRO_CANDIDATE")?.detail).toMatch(/\(\+6\)$/);
    expect(r.rulesUsed.map((u) => u.ruleId)).toContain("MICROCYCLE_BLUEPRINT");
    expect(r.assumptions.map((a) => a.code)).not.toContain("BLUEPRINT_APPLIED"); // a premissa é do adaptador, não do motor
  });

  it("dorsiflexão nível 2: os agachamentos continuam disponíveis no treino inferior, com a observação, sem exclusão", () => {
    const b = itemsOf(guided, 1, "B");
    const squats = b.filter((i) => exOf(i.exerciseId).patterns.includes("SQUAT"));
    expect(squats.length).toBeGreaterThan(0);
    for (const i of squats) {
      const obs = i.trace.selection.filter((t) => t.code === "ASSESSMENT_OBSERVATION");
      expect(obs).toHaveLength(1);
      expect(obs[0].basis).toBe("STUDENT_DATA");
    }
    expect(guided.flags.find((f) => f.code === "ASSESSMENT_OBSERVATION:FLEXITEST:ankle_dorsiflexion")?.message).toContain("nenhum exercício foi excluído");
  });

  it("determinístico: a mesma entrada guiada gera o mesmo resultado", () => {
    expect(canonicalJson(generate(upperLower()))).toBe(canonicalJson(guided));
  });

  it("corpo inteiro escolhido explicitamente é respeitado: A e B têm agachar e empurrar, sem termo de foco", () => {
    const r = generate(withFocus(xintusInput(), [1, 2, 3].flatMap((p) => [fact(p, "A", "FULL_BODY"), fact(p, "B", "FULL_BODY")])));
    for (const label of ["A", "B"]) {
      const patterns = new Set(itemsOf(r, 1, label).flatMap((i) => exOf(i.exerciseId).patterns));
      expect(patterns.has("SQUAT") || patterns.has("HINGE"), label).toBe(true);
      expect(patterns.has("HORIZONTAL_PUSH") || patterns.has("VERTICAL_PUSH"), label).toBe(true);
    }
    const codes = r.occurrences.flatMap((o) => o.items).flatMap((i) => i.trace.selection.map((t) => t.code));
    expect(codes).not.toContain("MICRO_OFF_FOCUS");
    expect(codes).not.toContain("MICRO_SUPPORTING");
    expect(r.issues.map((i) => i.code)).not.toContain("MUSCLE_NOT_COVERED");
    expect(r.issues.map((i) => i.code)).not.toContain("BLUEPRINT_FOCUS_SUPPLY_LOW");
  });

  it("fases com divisões diferentes: cada fase segue o seu papel", () => {
    const focus = [
      fact(1, "A", "UPPER"), fact(1, "B", "LOWER"),
      fact(2, "A", "FULL_BODY"), fact(2, "B", "FULL_BODY"),
      fact(3, "A", "PUSH"), fact(3, "B", "PULL"),
    ];
    const r = generate(withFocus(xintusInput(), focus));
    expect(itemsOf(r, 1, "B").every((i) => !exOf(i.exerciseId).primaryMuscles.some((m) => UPPER_DOM.has(m)))).toBe(true);
    const push = itemsOf(r, 3, "A");
    const pull = itemsOf(r, 3, "B");
    expect(push.some((i) => exOf(i.exerciseId).patterns.some((p) => p === "HORIZONTAL_PUSH" || p === "VERTICAL_PUSH"))).toBe(true);
    expect(pull.some((i) => exOf(i.exerciseId).patterns.some((p) => p === "HORIZONTAL_PULL" || p === "VERTICAL_PULL"))).toBe(true);
    expect(push.every((i) => !exOf(i.exerciseId).primaryMuscles.some((m) => TABLE.PULL.dominantMuscles.includes(m) && !TABLE.PUSH.dominantMuscles.includes(m)))).toBe(true);
    expect([1, 2, 3].map((p) => summaries(r, p).map((w) => w.coverage?.blueprint?.role))).toEqual([["UPPER", "LOWER"], ["FULL_BODY", "FULL_BODY"], ["PUSH", "PULL"]]);
  });
});

describe("pesos, não proibições: transbordo, apoio, candidatos e a escolha do profissional", () => {
  const upperLane = (input: EngineInput) => itemsOf(generate(input), 1, "A");
  const small = (catalog: CatalogExercise[], over: Partial<EngineInput["parameters"]> = {}, count = 4): EngineInput => {
    const base = xintusInput();
    return {
      ...upperLower(base, [1]),
      catalog,
      structure: structure("2026-11-09", [{ weeks: 4, sessionsPerWeek: 4, stimulus: "HYPERTROPHY", rotation: ["A", "B"], trainingDays: [0, 1, 3, 4], workouts: [{ label: "A", exerciseTarget: count }, { label: "B", exerciseTarget: count }] }]),
      parameters: { ...base.parameters, blueprintFocus: [fact(1, "A", "UPPER"), fact(1, "B", "LOWER")], ...over },
    };
  };
  const traceOf = (i: ItemOut) => i.trace.selection;

  it("trabalho de core (transbordo) no treino superior não recebe desconto de foco e nada o proíbe", () => {
    const cat = XINTUS_CATALOG.filter((e) => ["ex-bench", "ex-row", "ex-ohp", "ex-plank", "ex-crunch", "ex-squat"].includes(e.id));
    const items = upperLane(small(cat, {}, 5));
    const plank = items.find((i) => i.exerciseId === "ex-plank");
    expect(plank, "prancha (ANTI_EXTENSION) entra no treino superior").toBeDefined();
    expect(traceOf(plank!).some((t) => t.code === "MICRO_OFF_FOCUS")).toBe(false);
  });

  it("transbordo não é neutro em tudo: uma segunda rosca no superior ainda paga a redundância do padrão (pinado)", () => {
    const curl2 = exercise({ id: "ex-hammer", name: "Rosca martelo", primaryMuscles: ["BICEPS"], patterns: ["ELBOW_FLEXION"], equipment: ["DUMBBELL"], compound: false, difficulty: 1 });
    const cat = [...XINTUS_CATALOG.filter((e) => ["ex-bench", "ex-row", "ex-ohp", "ex-curl"].includes(e.id)), curl2];
    const items = firstOccurrence(generate(small(cat, {}, 5)), 1, "A");
    const curls = items.filter((i) => i.exerciseId === "ex-curl" || i.exerciseId === "ex-hammer");
    expect(curls.length).toBeGreaterThan(0);
    expect(curls.length).toBeGreaterThan(1);
    expect(curls.some((c) => traceOf(c).some((t) => t.code === "MICRO_REDUNDANCY"))).toBe(true);
    for (const c of curls) expect(traceOf(c).some((t) => t.code === "MICRO_OFF_FOCUS")).toBe(false);
  });

  it("o bônus de candidato desempata a favor do exercício nomeado, sem obrigar", () => {
    const twinA = exercise({ id: "ex-a-twin", name: "Remada A", primaryMuscles: ["UPPER_BACK"], patterns: ["HORIZONTAL_PULL"], equipment: ["CABLE"], compound: true, difficulty: 1 });
    const twinB = exercise({ id: "ex-b-twin", name: "Remada B", primaryMuscles: ["UPPER_BACK"], patterns: ["HORIZONTAL_PULL"], equipment: ["CABLE"], compound: true, difficulty: 1 });
    const cat = [twinA, twinB, ...XINTUS_CATALOG.filter((e) => ["ex-bench", "ex-ohp"].includes(e.id))];
    const plainPick = upperLane(small(cat, {}, 1))[0].exerciseId;
    expect(plainPick).toBe("ex-a-twin");
    const nominated = upperLane({ ...small(cat, {}, 1), parameters: { ...small(cat).parameters, blueprintFocus: [fact(1, "A", "UPPER", { candidateExerciseIds: ["ex-b-twin"] }), fact(1, "B", "LOWER")] } });
    expect(nominated[0].exerciseId).toBe("ex-b-twin");
    expect(traceOf(nominated[0]).some((t) => t.code === "MICRO_CANDIDATE")).toBe(true);
  });

  it("o exercício preferido do profissional (+20) vence o desconto de fora do foco: ele preenche a vaga que sobra", () => {
    const cat = XINTUS_CATALOG.filter((e) => ["ex-bench", "ex-row", "ex-ohp", "ex-legext", "ex-legpress"].includes(e.id));
    const plain = firstOccurrence(generate(small(cat, {}, 4)), 1, "A").map((i) => i.exerciseId);
    expect(plain).toContain("ex-legpress");
    expect(plain).not.toContain("ex-legext");
    const preferred = firstOccurrence(generate(small(cat, { preferredExerciseIds: ["ex-legext"] }, 4)), 1, "A");
    expect(preferred.map((i) => i.exerciseId)).toContain("ex-legext");
    expect(traceOf(preferred.find((i) => i.exerciseId === "ex-legext")!).some((t) => t.code === "MICRO_OFF_FOCUS")).toBe(true);
  });

  it("oferta curta: o treino completa com itens fora do foco e diz isso (INFO), nunca em silêncio e nunca vazio", () => {
    const cat = XINTUS_CATALOG.filter((e) => ["ex-bench", "ex-row", "ex-squat", "ex-legpress", "ex-rdl"].includes(e.id));
    const r = generate(small(cat, {}, 4));
    const a = firstOccurrence(r, 1, "A");
    expect(a).toHaveLength(4);
    const supply = r.issues.find((i) => i.code === "BLUEPRINT_FOCUS_SUPPLY_LOW" && i.label === "A");
    expect(supply).toMatchObject({ severity: "INFO", phaseIndex: 1, count: 2 });
    // o treino inferior também tem só 3 exercícios no foco para 4 vagas: 1 fora, dito
    expect(r.issues.find((i) => i.code === "BLUEPRINT_FOCUS_SUPPLY_LOW" && i.label === "B")).toMatchObject({ count: 1 });
  });

  it("papel personalizado sem foco nenhum não apaga o alvo da fase aceito pelo profissional", () => {
    const base = xintusInput();
    const input = withFocus(
      { ...base, parameters: { ...base.parameters, phaseCoverage: [{ phaseIndex: 1, basis: "PROFESSIONAL", muscles: ["CHEST", "QUADRICEPS"], patterns: ["SQUAT", "HORIZONTAL_PUSH"] }] } },
      [fact(1, "A", "CUSTOM"), fact(1, "B", "CUSTOM")],
    );
    const r = generate(input);
    for (const label of ["A", "B"]) {
      const cov = summaries(r, 1).find((w) => w.label === label)?.coverage;
      expect(cov, label).toMatchObject({ origin: "PHASE_COVERAGE", basis: "PROFESSIONAL" });
      expect(cov?.muscles).toEqual(expect.arrayContaining(["CHEST", "QUADRICEPS"]));
    }
  });

  it("o aviso de oferta fora do foco é refeito depois da troca do profissional (não fica velho)", () => {
    const ids = ["ex-bench", "ex-row", "ex-lateral", "ex-squat"];
    const cat = XINTUS_CATALOG.filter((e) => ids.includes(e.id));
    const input = small(cat, {}, 4);
    const r = generate(input);
    const warn = r.issues.find((i) => i.code === "BLUEPRINT_FOCUS_SUPPLY_LOW" && i.label === "A");
    expect(warn).toMatchObject({ count: 1 });
    const off = firstOccurrence(r, 1, "A").find((i) => i.exerciseId === "ex-squat")!;
    // a biblioteca ganhou um exercício do foco; o profissional troca o item fora do foco por ele
    const richer = { ...input, catalog: XINTUS_CATALOG.filter((e) => [...ids, "ex-facepull"].includes(e.id)) };
    const swapped = ok(substitute(richer, r, { phaseIndex: 1, slotKey: off.slotKey, applies: { kind: "PHASE" } }, "ex-facepull"));
    expect(itemsOf(swapped, 1, "A").some((i) => i.exerciseId === "ex-facepull" && i.origin === "SUBSTITUTED")).toBe(true);
    expect(swapped.issues.some((i) => i.code === "BLUEPRINT_FOCUS_SUPPLY_LOW" && i.label === "A")).toBe(false);
    // o aviso do outro treino não é tocado
    expect(swapped.issues.find((i) => i.code === "BLUEPRINT_FOCUS_SUPPLY_LOW" && i.label === "B")).toEqual(r.issues.find((i) => i.code === "BLUEPRINT_FOCUS_SUPPLY_LOW" && i.label === "B"));
  });

  it("alvo semanal fica global: o músculo do alvo que nenhum treino lista vale em todos e um aviso INFO o diz", () => {
    const base = upperLower(xintusInput(), [1]);
    const input = withFocus(
      { ...base, parameters: { ...base.parameters, phaseCoverage: [{ phaseIndex: 1, basis: "PROFESSIONAL", weeklySets: [{ muscle: "ABDUCTORS", minDirectSessions: 1 }, { muscle: "CHEST", minWeighted: 8, maxWeighted: 20 }] }] } },
      [fact(1, "A", "UPPER", { supportingMuscles: ["ABS"] }), fact(1, "B", "LOWER", { dominantMuscles: ["QUADRICEPS", "HAMSTRINGS", "GLUTEUS"], supportingMuscles: [] })],
    );
    const r = generate(input);
    const issue = r.issues.find((i) => i.code === "BLUEPRINT_PHASE_TARGET_OUTSIDE_LANES");
    expect(issue).toMatchObject({ severity: "INFO", phaseIndex: 1 });
    expect(issue?.message).toContain("Abdutores");
    // o alvo de peito (dominante só no treino A) puxa só o A: nenhum exercício de peito no B
    expect(itemsOf(r, 1, "B").every((i) => !exOf(i.exerciseId).primaryMuscles.includes("CHEST"))).toBe(true);
    expect(itemsOf(r, 1, "A").some((i) => exOf(i.exerciseId).primaryMuscles.includes("CHEST"))).toBe(true);
  });

  it("alvo próprio do treino (foco salvo na estrutura) vence a estratégia nesse treino", () => {
    const base = upperLower(xintusInput(), [1]);
    const withSaved: EngineInput = {
      ...base,
      structure: { ...base.structure, phases: base.structure.phases.map((p) => ({ ...p, workouts: p.workouts.map((w) => (w.label === "A" ? { ...w, focus: { muscles: ["QUADRICEPS"] } } : w)) })) },
    };
    const r = generate(withSaved);
    expect(summaries(r, 1).find((w) => w.label === "A")?.coverage).toMatchObject({ origin: "WORKOUT_FOCUS", basis: "PROFESSIONAL" });
    expect(summaries(r, 1).find((w) => w.label === "B")?.coverage?.origin).toBe("BLUEPRINT_FOCUS");
  });

  it("papéis sem volume (cardio, mobilidade) não ganham cobertura da estratégia e seguem a seleção antiga", () => {
    const input = {
      ...baseInput({
        structure: structure("2026-11-09", [{ weeks: 2, sessionsPerWeek: 3, stimulus: "HYPERTROPHY", workouts: [
          { label: "A", exerciseTarget: 3 }, { label: "B", exerciseTarget: 3 },
          { label: "Z2", exerciseTarget: 1, focus: { stimulus: { value: "AEROBIC_ENDURANCE", source: "STRUCTURE", basis: "PROFESSIONAL" } } },
        ] }]),
      }),
    };
    const r = generate(withFocus(input, [fact(1, "A", "UPPER"), fact(1, "B", "LOWER"), fact(1, "Z2", "CARDIO")]));
    const z2 = summaries(r, 1).find((w) => w.label === "Z2");
    expect(z2?.coverage?.origin).not.toBe("BLUEPRINT_FOCUS");
    expect(itemsOf(r, 1, "Z2").length).toBeGreaterThan(0);
    expect(summaries(r, 1).find((w) => w.label === "A")?.coverage?.origin).toBe("BLUEPRINT_FOCUS");
  });
});

describe("travas, preservados, trocas, regeneração e rebase com a estratégia", () => {
  const input = upperLower();
  const first = generate(input);

  it("regenerar sem mudar nada devolve o mesmo plano (fase, treino, semana, sessão)", () => {
    for (const scope of [
      { kind: "PHASE", phaseIndex: 1 }, { kind: "FROM_PHASE", phaseIndex: 2 }, { kind: "WORKOUT", phaseIndex: 2, label: "B" }, { kind: "WEEK", phaseIndex: 1, week: 2 },
      { kind: "OCCURRENCE", phaseIndex: 3, week: 1, slot: 2 },
    ] as const) {
      const again = ok(regenerate(input, first, scope));
      expect(canonicalJson(again.occurrences), JSON.stringify(scope)).toBe(canonicalJson(first.occurrences));
    }
  });

  it("item travado fora do foco fica e é do profissional; o resto do treino segue o foco", () => {
    const a1 = itemsOf(first, 1, "A")[0];
    const lock = { phaseIndex: 1, slotKey: a1.slotKey };
    const swapped = ok(substitute(input, first, { phaseIndex: 1, slotKey: a1.slotKey, applies: { kind: "PHASE" } }, "ex-legext"));
    expect(itemsOf(swapped, 1, "A").some((i) => i.exerciseId === "ex-legext" && i.origin === "SUBSTITUTED")).toBe(true);
    const lockedSwap = ok(regenerate({ ...input, locked: [{ phaseIndex: 1, slotKey: itemsOf(swapped, 1, "A").find((i) => i.exerciseId === "ex-legext")!.slotKey }] }, swapped, { kind: "PHASE", phaseIndex: 1 }));
    expect(itemsOf(lockedSwap, 1, "A").some((i) => i.exerciseId === "ex-legext")).toBe(true);
    void lock;
    const others = itemsOf(lockedSwap, 1, "A").filter((i) => i.exerciseId !== "ex-legext");
    expect(others.every((i) => !exOf(i.exerciseId).primaryMuscles.some((m) => LOWER_DOM.has(m)))).toBe(true);
  });

  it("a troca do profissional sobrevive à regeneração da fase com a estratégia e continua classificada como troca", () => {
    const target = itemsOf(first, 2, "B")[0];
    const swapped = ok(substitute(input, first, { phaseIndex: 2, slotKey: target.slotKey, applies: { kind: "PHASE" } }, "ex-bench"));
    const again = ok(regenerate(input, swapped, { kind: "PHASE", phaseIndex: 2 }));
    expect(itemsOf(again, 2, "B").some((i) => i.exerciseId === "ex-bench" && i.origin === "SUBSTITUTED")).toBe(true);
    expect(summaries(again, 2).find((w) => w.label === "B")?.coverage?.blueprint?.role).toBe("LOWER");
    expect(summaries(again, 1).every((w) => w.coverage?.origin === "BLUEPRINT_FOCUS")).toBe(true);
  });

  it("linhas preservadas mantêm a dose e a vaga, contam no treino e a seleção só completa o que falta", () => {
    const row = {
      prescribedExerciseId: "pe-keep", phaseIndex: 1, label: "A", exerciseId: "ex-squat", name: "Agachamento livre", position: 1,
      dose: null, display: { sets: "5", reps: "5", loadInstruction: null, cadence: null, restSeconds: 120, restText: null, rirMin: null, rirMax: null, doseText: "5 × 5" }, origin: "PROFESSIONAL",
    } as unknown as EngineInput["existing"][number];
    const r = generate({ ...input, existing: [row] });
    const a = itemsOf(r, 1, "A");
    expect(a.some((i) => i.origin === "PRESERVED" && i.exerciseId === "ex-squat")).toBe(true);
    expect(a.filter((i) => i.origin === "ENGINE").every((i) => !exOf(i.exerciseId).primaryMuscles.some((m) => LOWER_DOM.has(m)))).toBe(true);
  });

  it("rebase mantém o foco gravado da estratégia (coverage.blueprint) nos treinos", () => {
    const re = ok(rebase(input, first));
    expect(re.workouts.map((w) => w.coverage?.origin)).toEqual(first.workouts.map((w) => w.coverage?.origin));
    expect(re.workouts.map((w) => w.coverage?.blueprint?.role)).toEqual(first.workouts.map((w) => w.coverage?.blueprint?.role));
  });
});

describe("invariante em catálogos aleatórios (semente fixa)", () => {
  function prng(seed: number) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const POOL = XINTUS_CATALOG.filter((e) => e.modality === "RESISTANCE" && e.metric === "REPS");
  const ROLES: BlueprintRole[] = ["UPPER", "LOWER", "PUSH", "PULL", "LEGS"];

  it("com oferta no foco nenhum item do motor fica fora; com oferta curta o aviso traz a contagem certa; nada inelegível; determinístico", () => {
    const rnd = prng(20261105);
    let checked = 0;
    let enough = 0;
    let short = 0;
    for (let n = 0; n < 40; n++) {
      const catalog = POOL.filter(() => rnd() < 0.7).map((e) => ({ ...e, difficulty: 1 + Math.floor(rnd() * 3), compound: rnd() < 0.5 }));
      const equipment = FULL_GYM.filter(() => rnd() < 0.8);
      const eligible = catalog.filter((e) => [e.equipment, ...e.equipmentAlternatives].some((set) => set.every((q) => equipment.includes(q))));
      for (const role of ROLES) for (const count of [3, 4, 6, 8]) {
        const other: BlueprintRole = role === "LOWER" || role === "LEGS" ? "UPPER" : "LOWER";
        const base = baseInput({
          catalog,
          structure: structure("2026-11-09", [{ weeks: 2, sessionsPerWeek: 2, stimulus: "HYPERTROPHY", rotation: ["A", "B"], workouts: [{ label: "A", exerciseTarget: count }, { label: "B", exerciseTarget: count }] }]),
          parameters: parameters({ availableEquipment: equipment, availableMinutes: 600 }),
        });
        const input = withFocus(base, [fact(1, "A", role), fact(1, "B", other)]);
        const r = generate(input);
        const again = generate(input);
        expect(canonicalJson(again)).toBe(canonicalJson(r));
        const offFocus = (id: string | null) => {
          const e = exOf(id) ?? catalog.find((c) => c.id === id)!;
          const f = expandFocus(role, null, TABLE);
          const dom = new Set([...f.dominantMuscles, ...f.supportingMuscles]);
          const pat = new Set([...f.targetPatterns, ...f.allowedSpilloverPatterns]);
          return !e.primaryMuscles.some((m) => dom.has(m)) && !e.patterns.some((p) => pat.has(p));
        };
        const supply = eligible.filter((e) => !offFocus(e.id)).length;
        const picks = firstOccurrence(r, 1, "A");
        for (const i of picks) expect(eligible.some((e) => e.id === i.exerciseId), `${i.exerciseId} inelegível`).toBe(true);
        const off = picks.filter((i) => offFocus(i.exerciseId)).length;
        const warn = r.issues.find((i) => i.code === "BLUEPRINT_FOCUS_SUPPLY_LOW" && i.label === "A" && i.phaseIndex === 1);
        if (supply >= count) enough++; else short++;
        if (supply >= count) expect(off, `n=${n} ${role} x${count}`).toBe(0);
        expect(warn?.count ?? 0, `n=${n} ${role} x${count}`).toBe(off);
        checked++;
      }
    }
    expect(checked).toBe(40 * ROLES.length * 4);
    expect(enough).toBeGreaterThan(100); // os dois ramos são exercitados de verdade
    expect(short).toBeGreaterThan(20);
  });
});
