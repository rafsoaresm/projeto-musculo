/**
 * Motor V4, PR 2.2: estratégias do modo "Por regras" lidas do conjunto de regras 2026.11.5 (design V4 §3.11, §4.5).
 * Puro. Os modelos e a tabela de recomendação são heurística operacional editável: o Técnico valida (docs/PENDENCIAS.md).
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_RULESET, getRuleSet, RULESETS } from "@/modules/prescricao/motor";
import type { TrainingBlueprint } from "@/modules/prescricao/planejador/blueprint";
import { familySupportedBy } from "@/modules/prescricao/planejador/blueprint-validate";
import { currentTemplates, chooseFamilies, produceRulesBlueprint } from "@/modules/prescricao/planejador/rules-mode/producer";
import { preferenceFromRecommend, rulesTemplatesFromRuleSet, roleFocusFromRuleSet, supportsFromTemplates } from "@/modules/prescricao/planejador/rules-mode/ruleset-templates";
import { FAMILY_MIN_SESSIONS, FAMILY_ROLE_CYCLE, preferenceFor, RULES_TEMPLATES } from "@/modules/prescricao/planejador/rules-mode/templates";
import { ROLE_FOCUS_INTERIM_TABLE } from "@/modules/prescricao/planejador/role-focus";
import { WORKOUT_ROLES } from "@/modules/prescricao/planejador/vocab";
import { synth, type PhaseSpec, type Spec } from "./helpers/planning-fixtures";

type Exp = "BEGINNER" | "INTERMEDIATE" | "ADVANCED" | null;
const EXPERIENCES: Exp[] = ["BEGINNER", "INTERMEDIATE", "ADVANCED", null];
const phasesOf = (n: number, sessionsPerWeek: number, labels: Spec[]): PhaseSpec[] => Array.from({ length: n }, () => ({ sessionsPerWeek, labels }));
const L = (n: number) => "ABCDEFGH".slice(0, n).split("");
const rules = (b: TrainingBlueprint, id: "S1" | "S2" | "S3", phase = 1) =>
  Object.fromEntries(b.strategies.find((s) => s.strategyId === id)!.phases.find((p) => p.phaseIndex === phase)!.workouts.map((w) => [w.label, w.role]));

describe("os modelos do modo por regras vêm do conjunto de regras 2026.11.5", () => {
  const templates = rulesTemplatesFromRuleSet()!;

  it("o modo por regras usa o conjunto padrão, com a referência gravada no blueprint", async () => {
    expect(templates.version).toBe("gymgital-base@2026.11.5");
    expect(currentTemplates().version).toBe("gymgital-base@2026.11.5");
    const b = produceRulesBlueprint(await synth(phasesOf(1, 4, ["A", "B"])));
    expect(b.producer).toEqual({ kind: "RULES", templatesVersion: "gymgital-base@2026.11.5" });
    expect(b.roleFocusRef).toBe("gymgital-base@2026.11.5");
    expect(b.label).toBe("Heurística operacional (editável)");
    expect(b.strategies.every((s) => s.provenance === "RULES_HEURISTIC")).toBe(true);
    // a mesma entrada, o mesmo blueprint, byte a byte
    expect(JSON.stringify(produceRulesBlueprint(await synth(phasesOf(1, 4, ["A", "B"]))))).toBe(JSON.stringify(b));
  });

  it("regras anteriores à 2026.11.5 não têm modelos (o produtor cai nas constantes interinas só se faltar)", () => {
    expect(rulesTemplatesFromRuleSet({ id: "gymgital-base", version: "2026.11.4" })).toBeNull();
    expect(roleFocusFromRuleSet({ id: "gymgital-base", version: "2026.11.4" })).toBeNull();
  });

  it("os ciclos de papéis e a frequência mínima das regras são os das constantes interinas (até elas saírem)", () => {
    expect(templates.cycle).toEqual(FAMILY_ROLE_CYCLE);
    expect(templates.minSessions).toEqual(FAMILY_MIN_SESSIONS);
    expect(templates.maxStrategies).toBe(3);
  });

  it("a tabela de papéis das regras é a tabela interina (os desvios do modelo são relativos a ela)", () => {
    const fromRules = roleFocusFromRuleSet()!;
    for (const role of WORKOUT_ROLES) expect(fromRules[role], role).toEqual(ROLE_FOCUS_INTERIM_TABLE[role]);
  });

  it("a ordem de recomendação das regras dá, para toda frequência e experiência, a mesma escolha da tabela da 1.3", () => {
    const recommend = getRuleSet(DEFAULT_RULESET)!.rules.BLUEPRINT_STRATEGY_TEMPLATES!.value.recommend;
    for (const S of [1, 2, 3, 4, 5, 6, 7])
      for (const e of EXPERIENCES) {
        const fromRules = preferenceFromRecommend(recommend, S, e);
        const interim = preferenceFor(S, e);
        // a primeira família e a lista (sem repetir) coincidem; as regras podem listar mais famílias depois da recomendada
        expect(fromRules[0], `S=${S} ${e}`).toBe(interim[0]);
        expect(fromRules.slice(0, interim.length), `S=${S} ${e}`).toEqual(interim.length === 1 ? [interim[0]] : interim);
      }
  });

  it("o que cada divisão aceita (nº de treinos distintos) é o da validação, exceto 8 treinos em superior/inferior, que as regras publicadas não listam", () => {
    const t = getRuleSet(DEFAULT_RULESET)!.rules.BLUEPRINT_STRATEGY_TEMPLATES!.value;
    for (const family of ["FULL_BODY", "UPPER_LOWER", "PUSH_PULL_LEGS", "BODY_PART"] as const)
      for (let k = 0; k <= 8; k++) {
        const fromRules = supportsFromTemplates(t, family, k);
        const fromValidation = familySupportedBy(family, k);
        if (family === "UPPER_LOWER" && k === 8) {
          // documentado: a validação do blueprint da IA aceita 8; o conjunto publicado lista 2, 4 e 6. Nunca editamos regra publicada.
          expect([fromRules, fromValidation]).toEqual([false, true]);
        } else expect(fromRules, `${family} K=${k}`).toBe(fromValidation);
      }
  });

  it("o conjunto publicado é imutável: o produtor lê, não escreve", () => {
    const before = JSON.stringify(RULESETS["gymgital-base@2026.11.5"]);
    rulesTemplatesFromRuleSet();
    roleFocusFromRuleSet();
    expect(JSON.stringify(RULESETS["gymgital-base@2026.11.5"])).toBe(before);
    expect(() => {
      (RULESETS["gymgital-base@2026.11.5"].rules.BLUEPRINT_STRATEGY_TEMPLATES!.value as { maxStrategies: number }).maxStrategies = 9;
    }).toThrow();
  });
});

describe("as mesmas escolhas das constantes e das regras (matriz de estruturas, frequências e experiências)", () => {
  const labelSets: Spec[][] = [L(1), L(2), L(3), L(4), L(5), L(6)];
  it("chooseFamilies com as regras = chooseFamilies com as constantes", async () => {
    const t = rulesTemplatesFromRuleSet()!;
    for (const labels of labelSets)
      for (const S of [2, 3, 4, 5, 6])
        for (const e of EXPERIENCES) {
          const { context } = await synth(phasesOf(2, S, labels), e);
          expect(chooseFamilies(context, t), `S=${S} K=${labels.length} ${e}`).toEqual(chooseFamilies(context, RULES_TEMPLATES));
        }
  });
});

describe("as estratégias por regras: estrutura salva, frequência e experiência", () => {
  const first = async (S: number, labels: Spec[], e: Exp = "INTERMEDIATE", phases = 1) => produceRulesBlueprint(await synth(phasesOf(phases, S, labels), e)).strategies[0];

  it("FULL_BODY: qualquer estrutura, todo treino de corpo inteiro", async () => {
    const b = produceRulesBlueprint(await synth(phasesOf(1, 2, ["A", "B"])));
    expect(b.strategies[0]).toMatchObject({ splitFamily: "FULL_BODY", requiresScheduleChange: false, supportedByContext: "YES" });
    expect(rules(b, "S1")).toEqual({ A: "FULL_BODY", B: "FULL_BODY" });
  });

  it("UPPER_LOWER: alterna superior e inferior na ordem da estrutura (A,C superior; B,D inferior)", async () => {
    const s = await first(4, L(4));
    expect(s.splitFamily).toBe("UPPER_LOWER");
    expect(Object.fromEntries(s.phases[0].workouts.map((w) => [w.label, w.role]))).toEqual({ A: "UPPER", B: "LOWER", C: "UPPER", D: "LOWER" });
  });

  it("PUSH_PULL_LEGS: 3 treinos (e 6 duas vezes); BODY_PART: 5+ treinos em 5+ sessões, ciclo de 5 papéis", async () => {
    const ppl = produceRulesBlueprint(await synth(phasesOf(1, 3, L(3))));
    expect(ppl.strategies[0].splitFamily).toBe("PUSH_PULL_LEGS");
    expect(rules(ppl, "S1")).toEqual({ A: "PUSH", B: "PULL", C: "LEGS" });
    const six = await first(6, L(6));
    expect(Object.fromEntries(six.phases[0].workouts.map((w) => [w.label, w.role]))).toEqual({ A: "PUSH", B: "PULL", C: "LEGS", D: "PUSH", E: "PULL", F: "LEGS" });
    const five = produceRulesBlueprint(await synth(phasesOf(1, 5, L(5)), "ADVANCED"));
    expect(five.strategies.map((s) => s.splitFamily)).toContain("BODY_PART");
    const bp = five.strategies.find((s) => s.splitFamily === "BODY_PART")!;
    expect(Object.fromEntries(bp.phases[0].workouts.map((w) => [w.label, w.role]))).toEqual({ A: "CHEST_TRICEPS", B: "BACK_BICEPS", C: "LEGS", D: "SHOULDERS_ARMS", E: "LEGS" });
  });

  it("a experiência e a frequência decidem a recomendada; a meta do aluno não muda a divisão (só fica registrada)", async () => {
    expect((await first(4, L(2), "BEGINNER")).splitFamily).toBe("FULL_BODY");
    expect((await first(4, L(2), "INTERMEDIATE")).splitFamily).toBe("UPPER_LOWER");
    expect((await first(3, L(3), null)).splitFamily).toBe("FULL_BODY");
    expect((await first(3, L(3), "ADVANCED")).splitFamily).toBe("PUSH_PULL_LEGS");
    const b = produceRulesBlueprint(await synth(phasesOf(1, 4, L(2))));
    expect(b.global.goalCodes.length).toBeGreaterThan(0);
    expect(JSON.stringify(b.global)).not.toMatch(/hipertrofia|emagrec/i);
  });

  it("uma divisão que a estrutura salva não carrega é só um cartão informativo, nunca recomendada nem aceitável", async () => {
    const b = produceRulesBlueprint(await synth(phasesOf(1, 5, L(3)), "ADVANCED"));
    expect(b.strategies[0].requiresScheduleChange).toBe(false);
    const cards = b.strategies.filter((s) => s.requiresScheduleChange);
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) expect(c.strategyId).not.toBe(b.recommendedStrategyId);
  });

  it("no máximo 3 estratégias, a recomendada primeiro, sem número, dose ou referência inventada nos textos", async () => {
    for (const S of [2, 3, 4, 5, 6])
      for (const K of [1, 2, 3, 4, 5, 6]) {
        const b = produceRulesBlueprint(await synth(phasesOf(2, S, L(K))));
        expect(b.strategies.length).toBeLessThanOrEqual(3);
        expect(b.recommendedStrategyId).toBe("S1");
        expect(JSON.stringify(b)).not.toMatch(/\d+\s*(séries|repetições|kg|%)|estudo|pesquisa|evidência/i);
      }
  });
});
