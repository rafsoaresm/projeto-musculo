/**
 * Motor V4, PR 2.2: aderência à estratégia aceita na auditoria (design V4 §4.8). Puro: sem banco, sem rede, sem IA.
 * Os planos são montados à mão (músculos e padrões conhecidos), para conferir os números exatos; o Xintus mostra o fluxo real.
 */
import { describe, expect, it } from "vitest";
import {
  AUDIT_VERSION, auditPlan, canonicalJson, DEFAULT_RULESET, generate, getRuleSet, regenerate, revalidate, substitute,
  type AuditFinding, type BlueprintRole, type BlueprintSource, type CoverageTargets, type EngineInput, type EngineOutcome, type EngineResult, type ItemOut,
} from "@/modules/prescricao/motor";
import { AUDIT_VERSION_STRATEGY } from "@/modules/prescricao/motor/audit";
import { classifyFocus, auditOriginOf } from "@/modules/prescricao/motor/audit-strategy";
import { ruleLogFor } from "@/modules/prescricao/motor/trace";
import { roleFocusFromRuleSet } from "@/modules/prescricao/planejador/rules-mode/ruleset-templates";
import { expandFocus } from "@/modules/prescricao/planejador/focus";
import { roleFocusTableOf } from "@/modules/prescricao/automatica/build-input";
import { baseInput, structure, type PhaseSeed } from "./helpers/motor-fixtures";
import { XINTUS_CATALOG, repsDose, resultFrom, xintusInput, type PlanItemSeed } from "./helpers/xintus";

const NEW = getRuleSet(DEFAULT_RULESET)!;
const TABLE = roleFocusTableOf(NEW.rules.BLUEPRINT_ROLE_FOCUS!.value);

const ok = (o: EngineOutcome): EngineResult => {
  if (!o.ok) throw new Error(`${o.code}: ${o.message}`);
  return o.result;
};
const audit = (r: EngineResult) => {
  expect(r.audit, "auditoria").toBeDefined();
  return r.audit!;
};
const of = (r: EngineResult, code: string, phaseIndex?: number): AuditFinding[] =>
  audit(r).findings.filter((f) => f.code === code && (phaseIndex === undefined || f.phaseIndex === phaseIndex));

/** O foco que o motor grava no resumo do treino (origin BLUEPRINT_FOCUS), a partir do papel e da tabela das regras. */
function bpCoverage(role: BlueprintRole, source: BlueprintSource = "RULES_HEURISTIC"): CoverageTargets {
  const f = expandFocus(role, null, TABLE);
  return {
    muscles: f.dominantMuscles, patterns: f.targetPatterns, basis: source === "PROFESSIONAL" ? "PROFESSIONAL" : "HEURISTIC_ACCEPTED", ruleId: "MICROCYCLE_BLUEPRINT",
    origin: "BLUEPRINT_FOCUS", blueprint: { role, source, strategyId: "S1", supporting: f.supportingMuscles, spillover: f.allowedSpilloverPatterns, candidates: [] },
  };
}

type Plan = Record<string, Array<string | PlanItemSeed>>;
/** Plano à mão: `roles` dá o papel de cada treino; `plan`, os exercícios por treino (ids do catálogo do Xintus). */
function built(phases: PhaseSeed[], roles: Record<string, BlueprintRole>, plan: Plan, source: BlueprintSource = "RULES_HEURISTIC") {
  const input = baseInput({ catalog: XINTUS_CATALOG, structure: structure("2026-11-09", phases) });
  const result = resultFrom(
    input,
    (o) => (plan[o.label] ?? []).map((x) => (typeof x === "string" ? { exerciseId: x, dose: x === "ex-plank" ? null : repsDose(3) } : x)),
    (_p, label) => (roles[label] ? bpCoverage(roles[label], source) : null),
  );
  return { input, result };
}
const phase = (over: Partial<PhaseSeed> = {}): PhaseSeed => ({
  weeks: 4, sessionsPerWeek: 2, stimulus: "HYPERTROPHY", workouts: [{ label: "A" }, { label: "B" }], rotation: ["A", "B"], ...over,
});
const row = (r: EngineResult, label: string, week: number, p = 1) => audit(r).strategy!.workouts.find((w) => w.phaseIndex === p && w.label === label)!.weeks.find((x) => x.week === week)!;

describe("classificação do item frente ao foco", () => {
  const f = expandFocus("UPPER", null, TABLE);
  const focus = { dominant: new Set(f.dominantMuscles), supporting: new Set(f.supportingMuscles), targetPatterns: new Set(f.targetPatterns), spillover: new Set(f.allowedSpilloverPatterns), open: false };
  it("dominante > apoio > transbordo > fora, na mesma partição do desconto do motor", () => {
    expect(classifyFocus(focus, ["CHEST"], ["HORIZONTAL_PUSH"])).toBe("ON_FOCUS");
    expect(classifyFocus(focus, ["ABS"], ["ANTI_EXTENSION"])).toBe("SUPPORTING");
    expect(classifyFocus(focus, ["CALVES"], ["CARRY"])).toBe("SPILLOVER");
    expect(classifyFocus(focus, ["QUADRICEPS"], ["SQUAT"])).toBe("OFF_FOCUS");
    expect(classifyFocus({ ...focus, open: true }, ["QUADRICEPS"], ["SQUAT"])).toBe("ON_FOCUS");
  });
  it("a origem para a auditoria não muda ao travar: item travado do motor segue ENGINE; troca do profissional e linha existente contam", () => {
    const trace = (code: string): ItemOut["trace"] => ({ selection: [{ code, basis: "PROFESSIONAL", detail: "" }], params: [] });
    expect(auditOriginOf({ origin: "ENGINE", trace: trace("RANK") })).toBe("ENGINE");
    expect(auditOriginOf({ origin: "LOCKED", trace: trace("RANK") })).toBe("ENGINE");
    expect(auditOriginOf({ origin: "LOCKED", trace: trace("PROFESSIONAL_SUBSTITUTION") })).toBe("SUBSTITUTED");
    expect(auditOriginOf({ origin: "SUBSTITUTED", trace: trace("RANK") })).toBe("SUBSTITUTED");
    expect(auditOriginOf({ origin: "PRESERVED", trace: trace("RANK") })).toBe("PRESERVED");
  });
});

describe("aderência: números exatos num plano montado à mão", () => {
  // A (superior): supino e rosca no foco, prancha de apoio, afundo e goblet fora. B (inferior): tudo no foco.
  const plan: Plan = { A: ["ex-bench", "ex-curl", "ex-plank", "ex-lunge", "ex-goblet"], B: ["ex-squat", "ex-rdl", "ex-legcurl", "ex-legpress"] };
  const { result } = built([phase()], { A: "UPPER", B: "LOWER" }, plan);
  const a = audit(result);

  it("conta no foco, apoio, transbordo e fora, por treino e semana, e a aderência", () => {
    expect(a.auditVersion).toBe(AUDIT_VERSION_STRATEGY);
    expect(a.auditVersion).toBe("1.1.0");
    expect(a.strategy!.strategyIds).toEqual(["S1"]);
    expect(a.strategy!.sources).toEqual(["RULES_HEURISTIC"]);
    expect(row(result, "A", 1)).toEqual({ week: 1, items: 5, onFocus: 2, supporting: 1, spillover: 0, offFocus: 2, adherence: 0.6, offFocusByOrigin: { ENGINE: 2, PRESERVED: 0, SUBSTITUTED: 0 } });
    expect(row(result, "B", 3)).toMatchObject({ items: 4, onFocus: 4, offFocus: 0, adherence: 1 });
    expect(a.strategy!.workouts.map((w) => [w.label, w.role, w.adherenceMin])).toEqual([["A", "UPPER", 0.6], ["B", "LOWER", 1]]);
  });

  it("abaixo do mínimo das regras (0,7) é WARNING OPEN com alvo da heurística; acima não há aviso", () => {
    const low = of(result, "AUDIT_STRATEGY_ADHERENCE_LOW");
    expect(low).toHaveLength(1);
    expect(low[0]).toMatchObject({
      severity: "WARNING", status: "OPEN", phaseIndex: 1, label: "A", measured: { unit: "SHARE", value: 0.6 },
      target: { unit: "SHARE", min: 0.7, basis: "HEURISTIC_ACCEPTED", ruleId: "AUDIT_STRATEGY", origin: "BLUEPRINT_FOCUS" },
    });
    expect(low[0].rationale).toMatch(/3 de 5/);
    expect(of(result, "AUDIT_STRATEGY_SUPPLY_LOW")).toHaveLength(1);
  });

  it("BY_DESIGN quando todo item fora do foco é troca ou linha do profissional; um item do motor reabre", () => {
    const swapped: Plan = { ...plan, A: ["ex-bench", "ex-curl", "ex-plank", { exerciseId: "ex-lunge", dose: repsDose(3), origin: "SUBSTITUTED" }, { exerciseId: "ex-goblet", dose: repsDose(3), origin: "PRESERVED" }] };
    const r = built([phase()], { A: "UPPER", B: "LOWER" }, swapped).result;
    expect(row(r, "A", 1).offFocusByOrigin).toEqual({ ENGINE: 0, PRESERVED: 1, SUBSTITUTED: 1 });
    expect(of(r, "AUDIT_STRATEGY_ADHERENCE_LOW")[0]).toMatchObject({ status: "BY_DESIGN", suggestedAction: null });
    expect(of(r, "AUDIT_STRATEGY_SUPPLY_LOW")).toHaveLength(0);
    const mixed: Plan = { ...plan, A: ["ex-bench", "ex-curl", "ex-plank", { exerciseId: "ex-lunge", dose: repsDose(3), origin: "SUBSTITUTED" }, "ex-goblet"] };
    expect(of(built([phase()], { A: "UPPER", B: "LOWER" }, mixed).result, "AUDIT_STRATEGY_ADHERENCE_LOW")[0].status).toBe("OPEN");
  });

  it("fora do foco por escolha do profissional, mas acima do mínimo: só uma observação BY_DESIGN", () => {
    const some: Plan = { ...plan, A: ["ex-bench", "ex-curl", "ex-ohp", "ex-row", { exerciseId: "ex-lunge", dose: repsDose(3), origin: "SUBSTITUTED" }] };
    const r = built([phase()], { A: "UPPER", B: "LOWER" }, some).result;
    expect(row(r, "A", 2).adherence).toBe(0.8);
    expect(of(r, "AUDIT_STRATEGY_ADHERENCE_LOW")).toHaveLength(0);
    expect(of(r, "AUDIT_STRATEGY_OFF_FOCUS_ITEMS")).toMatchObject([{ severity: "INFO", status: "BY_DESIGN", measured: { unit: "ITEMS", value: 4 } }]);
  });

  it("travar não muda a auditoria; e a auditoria gravada é a que o motor calcularia agora (nenhum achado velho sobrevive)", () => {
    const locked = built([phase()], { A: "UPPER", B: "LOWER" }, { ...plan, A: plan.A.map((x) => (x === "ex-lunge" ? { exerciseId: "ex-lunge", dose: repsDose(3), origin: "LOCKED" as const } : x)) }).result;
    expect(canonicalJson(audit(locked))).toBe(canonicalJson(audit(result)));
    expect(canonicalJson(audit(revalidate(built([phase()], { A: "UPPER", B: "LOWER" }, plan).input, result)))).toBe(canonicalJson(audit(result)));
  });

  it("corpo inteiro nunca tem fora do foco, e a sobreposição com ele é BY_DESIGN", () => {
    const fb = built([phase()], { A: "FULL_BODY", B: "UPPER" }, { A: ["ex-squat", "ex-bench", "ex-row", "ex-curl"], B: ["ex-bench", "ex-row", "ex-ohp", "ex-curl"] }).result;
    expect(row(fb, "A", 1)).toMatchObject({ offFocus: 0, adherence: 1 });
    expect(of(fb, "AUDIT_STRATEGY_ADHERENCE_LOW")).toHaveLength(0);
    const overlap = audit(fb).strategy!.overlaps;
    expect(overlap).toHaveLength(1);
    expect(overlap[0]).toMatchObject({ phaseIndex: 1, a: "A", b: "B", byDesign: true });
    const note = of(fb, "AUDIT_STRATEGY_OVERLAP");
    expect(note.every((f) => f.severity === "INFO" && f.status === "BY_DESIGN")).toBe(true);
  });
});

describe("sobreposição é diagnóstico, nunca objetivo", () => {
  it("papéis diferentes com os mesmos músculos: INFO descritivo (jaccard exato), nunca WARNING; papéis iguais não entram", () => {
    const same = ["ex-bench", "ex-row", "ex-ohp", "ex-curl"];
    const r = built([phase()], { A: "UPPER", B: "LOWER" }, { A: same, B: [...same.slice(0, 3), "ex-squat"] }).result;
    const o = audit(r).strategy!.overlaps;
    expect(o).toHaveLength(1);
    // A: CHEST, UPPER_BACK, LATS, FRONT_DELTOID, BICEPS; B: CHEST, UPPER_BACK, LATS, FRONT_DELTOID, QUADRICEPS, GLUTEUS -> 4 / 7
    expect(o[0].jaccard).toBe(0.57);
    expect(o[0].byDesign).toBe(false);
    const f = of(r, "AUDIT_STRATEGY_OVERLAP");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ severity: "INFO", status: "DESCRIPTIVE", measured: { unit: "RATIO", value: 0.57 } });
    expect(f[0].rationale).toMatch(/não é meta nem erro/);
    const twoUpper = built([phase()], { A: "UPPER", B: "UPPER" }, { A: same, B: same }).result;
    expect(audit(twoUpper).strategy!.overlaps).toEqual([]);
  });

  it("Xintus A/B por regras: sobreposição baixa, sem aviso", () => {
    const r = generate(ulInput());
    const o = audit(r).strategy!.overlaps;
    expect(o.length).toBe(3);
    expect(o.every((x) => x.jaccard <= 0.15)).toBe(true);
    expect(of(r, "AUDIT_STRATEGY_OVERLAP")).toHaveLength(0);
  });
});

describe("exposições do calendário real", () => {
  // ABC com 2 sessões por semana: A,B / C,A / B,C / A,B ... A e C são superior; B é inferior.
  const three = () => built([phase({ weeks: 4, sessionsPerWeek: 2, workouts: [{ label: "A" }, { label: "B" }, { label: "C" }], rotation: ["A", "B", "C"] })], { A: "UPPER", B: "LOWER", C: "UPPER" }, {
    A: ["ex-bench", "ex-row", "ex-curl"], B: ["ex-squat", "ex-rdl", "ex-legcurl"], C: ["ex-ohp", "ex-pulldown", "ex-triceps"],
  });

  it("o calendário dá a ordem A,B / C,A / B,C / A,B", () => {
    const { result } = three();
    const labels = (w: number) => result.occurrences.filter((o) => o.week === w).map((o) => o.label);
    expect([1, 2, 3, 4].map(labels)).toEqual([["A", "B"], ["C", "A"], ["B", "C"], ["A", "B"]]);
  });

  it("conta as sessões que de fato existem: ABC em 2 dias nunca mostra 3 exposições e a região inferior some em uma semana", () => {
    const { result } = three();
    const ex = audit(result).strategy!.exposures;
    expect(ex.length).toBeGreaterThan(0);
    expect(Math.max(...ex.map((e) => e.perWeek.max))).toBeLessThanOrEqual(2);
    expect(ex.find((e) => e.region === "LOWER")).toEqual({ phaseIndex: 1, region: "LOWER", perWeek: { min: 0, max: 1 }, weeksCounted: 4 });
    expect(ex.find((e) => e.region === "UPPER_PUSH")).toMatchObject({ perWeek: { min: 1, max: 2 } });
    const warn = of(result, "AUDIT_STRATEGY_EXPOSURE");
    expect(warn).toHaveLength(1);
    expect(warn[0]).toMatchObject({ severity: "WARNING", status: "OPEN", week: 2, measured: { unit: "SESSIONS", value: 0 }, target: { unit: "SESSIONS", min: 1, ruleId: "AUDIT_STRATEGY" } });
  });

  it("quando o calendário dá uma sessão de cada região por semana, não há aviso de exposição", () => {
    const r = built([phase()], { A: "UPPER", B: "LOWER" }, { A: ["ex-bench", "ex-row", "ex-curl"], B: ["ex-squat", "ex-rdl", "ex-legcurl"] }).result;
    expect(of(r, "AUDIT_STRATEGY_EXPOSURE")).toHaveLength(0);
    expect(audit(r).strategy!.exposures.find((e) => e.region === "LOWER")).toMatchObject({ perWeek: { min: 1, max: 1 } });
  });
});

describe("alvo aceito da fase que nenhum treino lista", () => {
  it("um único INFO por fase, espelho do aviso do motor", () => {
    const base = ulInput();
    const input = { ...base, parameters: { ...base.parameters, phaseCoverage: [{ phaseIndex: 1, muscles: ["ADDUCTORS"], patterns: ["CYCLICAL"], basis: "PROFESSIONAL" as const }] } };
    // ADDUCTORS está em LOWER; CYCLICAL em nenhum papel
    const r = generate(input);
    const f = of(r, "AUDIT_STRATEGY_PHASE_TARGET_OUTSIDE", 1);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ severity: "INFO", status: "DESCRIPTIVE", measured: { unit: "ITEMS", value: 1 } });
    expect(r.issues.filter((i) => i.code === "BLUEPRINT_PHASE_TARGET_OUTSIDE_LANES" && i.phaseIndex === 1)).toHaveLength(1);
  });
});

// ---------- Xintus: o fluxo real do motor ----------

function ulInput(): EngineInput {
  const focus = (p: number) => [
    ["A", "UPPER"], ["B", "LOWER"],
  ].map(([label, role]) => {
    const f = expandFocus(role as BlueprintRole, null, TABLE);
    return {
      phaseIndex: p, label, role: role as BlueprintRole, source: "RULES_HEURISTIC" as const, strategyId: "S1", dominantMuscles: f.dominantMuscles, supportingMuscles: f.supportingMuscles,
      targetPatterns: f.targetPatterns, spilloverPatterns: f.allowedSpilloverPatterns, candidateExerciseIds: [],
    };
  });
  const input = xintusInput();
  return { ...input, parameters: { ...input.parameters, blueprintFocus: [1, 2, 3].flatMap(focus) } };
}

describe("Xintus por regras (superior / inferior)", () => {
  const input = ulInput();
  const r = generate(input);

  it("tem o bloco da estratégia, versão 1.1.0, e a aderência de cada treino atinge o mínimo", () => {
    const a = audit(r);
    expect(a.auditVersion).toBe("1.1.0");
    expect(a.strategy!.workouts).toHaveLength(6);
    for (const w of a.strategy!.workouts) {
      expect(w.weeks).toHaveLength(4);
      expect(w.adherenceMin!).toBeGreaterThanOrEqual(0.7);
    }
    expect(of(r, "AUDIT_STRATEGY_ADHERENCE_LOW")).toHaveLength(0);
  });

  it("não inunda: nenhum 'alvo não atingido' tem origem no foco da estratégia", () => {
    const flood = audit(r).findings.filter((f) => (f.code === "AUDIT_TARGET_MUSCLE_UNMET" || f.code === "AUDIT_TARGET_PATTERN_UNMET") && f.target?.origin === "BLUEPRINT_FOCUS");
    expect(flood).toEqual([]);
  });

  it("substituir recalcula: a aderência cai e a auditoria gravada é igual à de uma revalidação", () => {
    const before = row(r, "A", 1).adherence!;
    const first = r.occurrences.find((o) => o.label === "A")!.items.find((i) => i.origin === "ENGINE")!;
    const swapped = ok(substitute(input, r, { phaseIndex: 1, slotKey: first.slotKey, applies: { kind: "PHASE" } }, "ex-legext"));
    expect(row(swapped, "A", 1).adherence!).toBeLessThan(before);
    expect(row(swapped, "A", 1).offFocusByOrigin.SUBSTITUTED).toBeGreaterThan(0);
    expect(canonicalJson(audit(swapped))).toBe(canonicalJson(audit(revalidate(input, swapped))));
    // o achado de aderência baixa, se houver, é BY_DESIGN: o item fora do foco é escolha do profissional
    for (const f of of(swapped, "AUDIT_STRATEGY_ADHERENCE_LOW")) expect(f.status).toBe("BY_DESIGN");
  });

  it("regenerar refaz a auditoria: nenhum achado da troca sobrevive à fase refeita", () => {
    const first = r.occurrences.find((o) => o.label === "A")!.items.find((i) => i.origin === "ENGINE")!;
    const swapped = ok(substitute(input, r, { phaseIndex: 1, slotKey: first.slotKey, applies: { kind: "PHASE" } }, "ex-legext"));
    const again = ok(regenerate(input, swapped, { kind: "PHASE", phaseIndex: 2 }));
    expect(canonicalJson(audit(again))).toBe(canonicalJson(audit(revalidate(input, again))));
    expect(row(again, "A", 1, 2).adherence!).toBeGreaterThanOrEqual(0.7);
  });
});

describe("sem estratégia nada muda", () => {
  it("regras 2026.11.5 sem foco, e regras anteriores, têm auditoria 1.0.0 e nenhuma chave `strategy`", () => {
    const plain = generate(xintusInput());
    expect(audit(plain).auditVersion).toBe(AUDIT_VERSION);
    expect("strategy" in audit(plain)).toBe(false);
    expect(plain.rulesUsed.map((u) => u.ruleId)).not.toContain("AUDIT_STRATEGY");
    const old = generate(xintusInput({ id: "gymgital-base", version: "2026.11.4" }));
    expect(audit(old).auditVersion).toBe("1.0.0");
    expect("strategy" in audit(old)).toBe(false);
  });

  it("auditPlan sem treinos de estratégia devolve o relatório de sempre", () => {
    const { result, input } = built([phase()], {}, { A: ["ex-bench"], B: ["ex-squat"] });
    const log = ruleLogFor(DEFAULT_RULESET)!;
    const a = auditPlan({ log, phases: result.phases, structure: input.structure.phases, workouts: result.workouts, occurrences: result.occurrences, volume: result.volume, byId: new Map(XINTUS_CATALOG.map((e) => [e.id, e])) });
    expect(a.auditVersion).toBe("1.0.0");
    expect(a.strategy).toBeUndefined();
  });

  it("o papel do treino na estratégia lido de tabelas das regras é o da tabela interina do planejador", () => {
    const fromRules = roleFocusFromRuleSet()!;
    expect(fromRules.UPPER.dominantMuscles).toEqual(TABLE.UPPER.dominantMuscles);
  });
});

describe("limite técnico do bloco de auditoria (summary_json ≤ 500000)", () => {
  it("num plano muito longo mantém por treino só as semanas de menor aderência, avisa quantas ficaram de fora e não muda o mínimo", () => {
    const plan: Plan = { A: ["ex-bench", "ex-curl", "ex-plank", "ex-lunge", "ex-goblet"], B: ["ex-squat", "ex-rdl", "ex-legcurl", "ex-legpress"] };
    const { result } = built([phase({ weeks: 400 })], { A: "UPPER", B: "LOWER" }, plan);
    const s = audit(result).strategy!;
    for (const w of s.workouts) {
      expect(w.weeks).toHaveLength(300);
      expect(w.weeksOmitted).toBe(100);
      expect(w.weeks.map((x) => x.week)).toEqual([...w.weeks.map((x) => x.week)].sort((x, y) => x - y));
    }
    expect(s.workouts.find((w) => w.label === "A")!.adherenceMin).toBe(0.6);
    expect(JSON.stringify(s).length).toBeLessThan(150000);
  });
});
