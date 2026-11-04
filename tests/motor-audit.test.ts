import { describe, expect, it } from "vitest";
import {
  auditPlan, boundAudit, canonicalJson, DEFAULT_RULESET, generate, getRuleSet, rebase, regenerate, revalidate, substitute, AUDIT_VERSION,
  type AuditFinding, type AuditReport, type CoverageTargets, type EngineInput, type EngineOutcome, type EngineResult, type RuleSet,
} from "@/modules/prescricao/motor";
import { RuleLog, ruleLogFor } from "@/modules/prescricao/motor/trace";
import { AUDIT_RULES, CATALOG, FULL_GYM, LEGACY_RULES, baseInput, exercise, parameters, structure, type PhaseSeed } from "./helpers/motor-fixtures";
import {
  XINTUS_CATALOG, XINTUS_PREVIOUS_PLAN, repsDose, resultFrom, xintusInput, xintusPreviousDose, xintusPreviousResult, type PlanItemSeed,
} from "./helpers/xintus";


const ok = (o: EngineOutcome): EngineResult => {
  if (!o.ok) throw new Error(`${o.code}: ${o.message}`);
  return o.result;
};
const audit = (r: EngineResult): AuditReport => {
  expect(r.audit, "auditoria").toBeDefined();
  return r.audit!;
};
const of = (r: EngineResult, code: string, phaseIndex?: number) => audit(r).findings.filter((f) => f.code === code && (phaseIndex === undefined || f.phaseIndex === phaseIndex));
const text = (f: AuditFinding) => `${f.rationale} ${f.suggestedAction ?? ""}`;
const phaseCov = (muscles: string[], patterns: string[] = [], extra: Partial<CoverageTargets> = {}): CoverageTargets => ({ muscles, patterns, basis: "PROFESSIONAL", origin: "PHASE_COVERAGE", ...extra });

/** Plano montado à mão para uma estrutura simples (treinos fixos por rótulo, doses da função). */
function planned(phases: PhaseSeed[], plan: Record<string, Array<string | PlanItemSeed>>, opts: { coverage?: (p: number, l: string) => CoverageTargets | null; sets?: (p: number, w: number) => number; over?: Partial<EngineInput> } = {}) {
  const input = baseInput({ catalog: XINTUS_CATALOG, structure: structure("2026-11-09", phases), ...opts.over });
  const byId = new Map(input.catalog.map((e) => [e.id, e]));
  const result = resultFrom(input, (o) => (plan[o.label] ?? []).map((x) => {
    if (typeof x !== "string") return x;
    const e = byId.get(x)!;
    const sets = opts.sets?.(o.phaseIndex, o.week) ?? 3;
    return { exerciseId: x, dose: e.metric === "TIME" ? { metric: "TIME", sets, durationSeconds: { min: 30, max: 45 }, restSeconds: 60 } : e.metric === "REPS" ? repsDose(sets) : e.metric === "CONTINUOUS" ? { metric: "CONTINUOUS", durationSeconds: { min: 1200, max: 1800 } } : null };
  }), opts.coverage);
  return { input, result };
}

describe("auditoria: Xintus, plano anterior (ABAB, 4 sessões por semana)", () => {
  const r = xintusPreviousResult();
  const a = audit(r);

  it("conta as sessões reais de cada semana e as exposições de cada treino", () => {
    expect(a.auditVersion).toBe(AUDIT_VERSION);
    expect(a.rules).toEqual(DEFAULT_RULESET);
    expect(a.phasesAudited).toEqual([1, 2, 3]);
    expect(a.occurrences).toBe(48);
    for (const p of a.phases) {
      expect(p.occurrencesPerWeek).toEqual({ min: 4, max: 4 });
      expect(p.partialWeeks).toEqual([]);
      expect(p.workouts.map((w) => [w.label, w.exposuresPerWeek])).toEqual([["A", { min: 2, max: 2 }], ["B", { min: 2, max: 2 }]]);
      expect(p.splitShape).toBe("FULL_BODY");
    }
    // Quadríceps na semana 3: (agachamento + leg press + extensora) × 3 séries × 2 sessões de A = 18, igual ao volume
    const quad = r.volume.find((v) => v.phaseIndex === 1 && v.week === 3 && v.muscle === "QUADRICEPS")!;
    expect(quad.directSets).toBe(18);
    expect(a.phases[0].weekRows[2].directSessions.QUADRICEPS).toBe(2);
    expect(a.phases[0].muscles.find((m) => m.muscle === "QUADRICEPS")).toMatchObject({ direct: { min: 12, max: 18 }, classification: "DIRECT", isTarget: false });
    // os rótulos do profissional não mudam
    expect(r.occurrences.slice(0, 4).map((o) => o.label)).toEqual(["A", "B", "A", "B"]);
  });

  it("2 → 3 séries em todos os exercícios: salto de volume e passo uniforme, com os dados", () => {
    const [jump] = of(r, "AUDIT_WEEK_VOLUME_JUMP");
    expect(of(r, "AUDIT_WEEK_VOLUME_JUMP")).toHaveLength(1);
    expect(jump).toMatchObject({ severity: "WARNING", status: "OPEN", phaseIndex: 1, week: 2, toWeek: 3, measured: { unit: "WEIGHTED_SETS", from: 80, value: 120, detail: { fraction: 0.5 } } });
    expect(a.phases[0].weekRows.map((w) => w.weighted)).toEqual([80, 80, 120, 120]);
    const [step] = of(r, "AUDIT_UNIFORM_SET_STEP");
    expect(of(r, "AUDIT_UNIFORM_SET_STEP")).toHaveLength(1);
    expect(step).toMatchObject({ phaseIndex: 1, week: 2, toWeek: 3, measured: { value: 1, detail: { delta: 1, from: 2, to: 3, items: 12 } } });
    // as doses não mudaram
    expect(r.occurrences.filter((o) => o.phaseIndex === 1 && o.week <= 2).every((o) => o.items.every((i) => i.dose && "sets" in i.dose && i.dose.sets === 2))).toBe(true);
  });

  it("8–12 / RIR 1–3 / 90 s em exercícios muito diferentes: observação em cada fase, dizendo que veio da política padrão", () => {
    for (const p of [1, 2, 3]) {
      const [f] = of(r, "AUDIT_DOSE_UNIFORM", p);
      expect(f).toMatchObject({ severity: "INFO", status: "OPEN", measured: { unit: "SHARE", value: 1 } });
      expect(f.measured!.detail!.profiles).toBeGreaterThanOrEqual(2);
      expect(f.rationale).toMatch(/política padrão de doses/);
      expect(f.sourceRefs).toContain("rule:DOSE_DEFAULTS");
    }
  });

  it("sem alvos: descreve sem recomendar; panturrilha, bíceps e abdominais só aparecem na descrição", () => {
    for (const p of [1, 2, 3]) {
      expect(of(r, "AUDIT_NO_TARGETS", p)).toHaveLength(1);
      // 2026.11.4 (padrão): aponta para a mesma sugestão do aviso NO_TARGETS; 2026.11.3: sem referência à sugestão.
      expect(of(r, "AUDIT_NO_TARGETS", p)[0]).toMatchObject({
        suggestedAction: "Aceitar os alvos sugeridos (heurística operacional, editável) e regenerar a fase",
        sourceRefs: ["rule:AUDIT_COMPREHENSIVE_STIMULI", "rule:MICROCYCLE_TARGET_SUGGESTIONS"],
      });
      const [old] = xintusPreviousResult(AUDIT_RULES).audit!.findings.filter((f) => f.code === "AUDIT_NO_TARGETS" && f.phaseIndex === p);
      expect(old.suggestedAction).not.toMatch(/sugerid/i);
      expect(old.sourceRefs).toEqual(["rule:AUDIT_COMPREHENSIVE_STIMULI"]);
      const [d] = of(r, "AUDIT_NO_DIRECT_STIMULUS", p);
      expect(d.status).toBe("DESCRIPTIVE");
      expect(Object.keys(d.measured!.detail!)).toContain("CALVES");
    }
    for (const f of a.findings) expect(text(f)).not.toMatch(/acrescent|adicion/i);
    for (const f of a.findings.filter((x) => x.code !== "AUDIT_NO_DIRECT_STIMULUS")) {
      const keys = [f.code, f.muscle ?? "", ...Object.keys(f.measured?.detail ?? {})].join(" ");
      expect(keys, f.code).not.toMatch(/CALVES|BICEPS|\bABS\b/);
      expect(f.rationale, f.code).not.toMatch(/Panturrilha|Bíceps|Abdominais/);
    }
  });

  it("(a) só indireto: um achado por fase, aberto sem alvos", () => {
    for (const p of [1, 2, 3]) {
      const list = of(r, "AUDIT_INDIRECT_ONLY", p);
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ status: "OPEN", measured: { unit: "INDIRECT_SETS" } });
      expect(Object.keys(list[0].measured!.detail!).sort()).toEqual(["ADDUCTORS", "ERECTORS"]);
    }
  });

  it("joelho × quadril desequilibrado (18 × 6 por semana) e a ausência de flexão de joelho visível, sem mandar acrescentar", () => {
    const f = of(r, "AUDIT_PATTERN_IMBALANCE", 1).find((x) => x.pattern === "KNEE_HIP")!;
    expect(f).toMatchObject({ week: 3, measured: { unit: "RATIO", value: 3, detail: { a: 18, b: 6 } } });
    expect(of(r, "AUDIT_PATTERN_IMBALANCE").filter((x) => x.pattern === "PUSH_PULL")).toEqual([]); // 18 × 12 = 1,5
    const p2 = a.phases[1];
    expect(p2.muscles.find((m) => m.muscle === "HAMSTRINGS")).toMatchObject({ classification: "DIRECT", direct: { min: 6, max: 6 }, directSessions: { min: 2, max: 2 } });
    expect(p2.patterns.find((x) => x.pattern === "KNEE_FLEXION")).toMatchObject({ sessions: { min: 0, max: 0 }, sets: { min: 0, max: 0 } });
    for (const x of a.findings) expect(x.suggestedAction ?? "").not.toMatch(/Flexão de joelho|flexora/i);
  });

  it("a avaliação chega à saída como observação: a leitura da dorsiflexão está no alerta, sem excluir agachamentos", () => {
    const g = generate(xintusInput());
    const flag = g.flags.find((x) => x.code === "ASSESSMENT:FLEXIBILITY:FLEXITEST")!;
    expect(flag).toMatchObject({ severity: "INFO", ref: "assessment:as-xintus" });
    expect(flag.message).toMatch(/Dorsiflexão[^;]*: nível 2/i);
    expect(flag.suggestedDecision).toBeUndefined();
    expect(g.occurrences.some((o) => o.items.some((i) => ["ex-squat", "ex-legpress", "ex-goblet", "ex-hackslide", "ex-airsquat"].includes(i.exerciseId ?? "")))).toBe(true);
    expect(audit(g).occurrences).toBe(48);
    expect(audit(g).phases.every((p) => p.occurrencesPerWeek.min === 4 && p.occurrencesPerWeek.max === 4)).toBe(true);
  });
});

describe("auditoria: alvos (b), escolha (c) e escopo do alvo", () => {
  const phase: PhaseSeed = { weeks: 4, sessionsPerWeek: 4, stimulus: "HYPERTROPHY", rotation: ["A", "B"], workouts: [{ label: "A", exerciseTarget: 6 }, { label: "B", exerciseTarget: 6 }] };
  const sets = (p: number, w: number) => (w <= 2 ? 2 : 3);
  const noHamstrings = { A: XINTUS_PREVIOUS_PLAN.A, B: ["ex-hipthrust", "ex-row", "ex-pulldown", "ex-curl", "ex-triceps", "ex-plank"] };

  it("(b) alvo de músculo sem item direto numa semana completa: medido 0, alvo ≥ 1, decisão do profissional", () => {
    const { result } = planned([phase], noHamstrings, { sets, coverage: () => phaseCov(["HAMSTRINGS"]) });
    const [f] = of(result, "AUDIT_TARGET_MUSCLE_UNMET");
    expect(f).toMatchObject({ severity: "WARNING", status: "OPEN", muscle: "HAMSTRINGS", week: 1, measured: { unit: "SESSIONS", value: 0 }, target: { unit: "SESSIONS", min: 1, basis: "PROFESSIONAL", origin: "PHASE_COVERAGE" } });
    expect(f.label).toBeUndefined();
    // (a) com alvos vira escolha
    expect(of(result, "AUDIT_INDIRECT_ONLY")[0].status).toBe("BY_DESIGN");
  });

  it("(b) alvo semanal de séries ponderadas: abaixo do mínimo e acima do máximo, com medido × alvo", () => {
    const cov = phaseCov([], [], { weeklySets: [{ muscle: "QUADRICEPS", minWeighted: 14, maxWeighted: 16, basis: "PROFESSIONAL" }] });
    const { result } = planned([phase], XINTUS_PREVIOUS_PLAN, { sets, coverage: () => cov });
    expect(of(result, "AUDIT_TARGET_MUSCLE_UNMET")).toEqual([expect.objectContaining({ muscle: "QUADRICEPS", week: 1, measured: { unit: "WEIGHTED_SETS", value: 12 }, target: expect.objectContaining({ min: 14, max: 16 }) })]);
    expect(of(result, "AUDIT_TARGET_MUSCLE_ABOVE")).toEqual([expect.objectContaining({ severity: "INFO", muscle: "QUADRICEPS", week: 3, measured: { unit: "WEIGHTED_SETS", value: 18 } })]);
    expect(audit(result).phases[0].muscles.find((m) => m.muscle === "QUADRICEPS")).toMatchObject({ isTarget: true, target: { unit: "WEIGHTED_SETS", min: 14, max: 16 } });
  });

  it("(c) músculo fora dos alvos e sem estímulo: escolha do profissional, nunca recomendação", () => {
    const { result } = planned([phase], XINTUS_PREVIOUS_PLAN, { sets, coverage: () => phaseCov(["QUADRICEPS", "CHEST"]) });
    const [f] = of(result, "AUDIT_NON_TARGET_OMITTED");
    expect(f).toMatchObject({ severity: "INFO", status: "BY_DESIGN" });
    expect(Object.keys(f.measured!.detail!)).toContain("CALVES");
    expect(of(result, "AUDIT_NO_DIRECT_STIMULUS")).toEqual([]);
    expect(of(result, "AUDIT_NO_TARGETS")).toEqual([]);
    expect(of(result, "AUDIT_TARGET_MUSCLE_UNMET")).toEqual([]);
  });

  it("alvo do treino vale nas sessões dele; alvo da fase vale na fase", () => {
    const focusA = (p: number, l: string) => (l === "A" ? phaseCov(["LATS"], [], { origin: "WORKOUT_FOCUS" }) : null);
    const r1 = planned([phase], XINTUS_PREVIOUS_PLAN, { sets, coverage: focusA }).result;
    expect(of(r1, "AUDIT_TARGET_MUSCLE_UNMET")).toEqual([expect.objectContaining({ muscle: "LATS", label: "A", target: expect.objectContaining({ origin: "WORKOUT_FOCUS" }) })]);
    const r2 = planned([phase], XINTUS_PREVIOUS_PLAN, { sets, coverage: () => phaseCov(["LATS"]) }).result;
    expect(of(r2, "AUDIT_TARGET_MUSCLE_UNMET")).toEqual([]);
    // sem `origin` gravado (proposta anterior): o mesmo alvo em todos os treinos é lido como alvo da fase
    const r3 = planned([phase], XINTUS_PREVIOUS_PLAN, { sets, coverage: () => ({ muscles: ["LATS"], patterns: [], basis: "PROFESSIONAL" }) }).result;
    expect(of(r3, "AUDIT_TARGET_MUSCLE_UNMET")).toEqual([]);
  });

  it("padrão-alvo sem sessão numa semana completa", () => {
    const { result } = planned([phase], XINTUS_PREVIOUS_PLAN, { sets, coverage: () => phaseCov([], ["KNEE_FLEXION", "SQUAT"]) });
    expect(of(result, "AUDIT_TARGET_PATTERN_UNMET")).toEqual([expect.objectContaining({ pattern: "KNEE_FLEXION", severity: "WARNING", measured: { unit: "SESSIONS", value: 0 } })]);
  });

  it("alvo do treino em rotação irregular: só as semanas em que o treino tem sessão (ABC em 2 por semana)", () => {
    // semanas: 1 = A B, 2 = C A, 3 = B C; o treino C não tem sessão na semana 1
    const seed: PhaseSeed = { weeks: 3, sessionsPerWeek: 2, stimulus: "HYPERTROPHY", rotation: ["A", "B", "C"], workouts: [{ label: "A" }, { label: "B" }, { label: "C" }] };
    const focusC = (_p: number, l: string) => (l === "C" ? phaseCov(["CALVES"], [], { origin: "WORKOUT_FOCUS" }) : null);
    const met = planned([seed], { A: ["ex-squat", "ex-bench"], B: ["ex-rdl", "ex-row"], C: ["ex-calf", "ex-ohp"] }, { coverage: focusC }).result;
    expect(audit(met).phases[0].workouts.find((w) => w.label === "C")!.exposuresPerWeek).toEqual({ min: 0, max: 1 });
    expect(of(met, "AUDIT_TARGET_MUSCLE_UNMET")).toEqual([]);
    const unmet = planned([seed], { A: ["ex-squat", "ex-bench"], B: ["ex-rdl", "ex-row"], C: ["ex-lunge", "ex-ohp"] }, { coverage: focusC }).result;
    expect(of(unmet, "AUDIT_TARGET_MUSCLE_UNMET")).toEqual([expect.objectContaining({ muscle: "CALVES", label: "C", week: 2, measured: { unit: "SESSIONS", value: 0 } })]);
  });

  it("sem `origin` gravado, a estrutura diz a origem: foco do treino A e alvo da fase no B não viram alvos por treino", () => {
    const seed: PhaseSeed = { ...phase, workouts: [{ label: "A", focus: { muscles: ["CHEST"] } }, { label: "B" }] };
    const cov = (_p: number, l: string): CoverageTargets => (l === "A" ? { muscles: ["CHEST"], patterns: [], basis: "PROFESSIONAL" } : { muscles: ["QUADRICEPS"], patterns: [], basis: "PROFESSIONAL" });
    // quadríceps só no treino A: alvo da fase atendido na fase; lido como alvo do treino B, seria um falso "0 sessões"
    const { result } = planned([seed], XINTUS_PREVIOUS_PLAN, { sets, coverage: cov });
    expect(of(result, "AUDIT_TARGET_MUSCLE_UNMET")).toEqual([]);
    expect(audit(result).phases[0].muscles.find((m) => m.muscle === "QUADRICEPS")!.target).toMatchObject({ origin: "PHASE_COVERAGE" });
    expect(audit(result).phases[0].muscles.find((m) => m.muscle === "CHEST")!.target).toMatchObject({ origin: "WORKOUT_FOCUS" });
  });

  it("generate: só weeklySets (sem músculos nem padrões) não some com o aviso NO_TARGETS do motor", () => {
    const params = parameters({ phaseCoverage: [{ phaseIndex: 1, weeklySets: [{ muscle: "CALVES", minWeighted: 6 }], basis: "PROFESSIONAL" }] });
    const r = generate(baseInput({ catalog: XINTUS_CATALOG, structure: structure("2026-11-09", [phase]), parameters: params }));
    expect(r.issues.filter((i) => i.code === "NO_TARGETS").length).toBe(2);
    expect(r.validation).not.toBe("PASSED");
  });

  it("generate: weeklySets e origin entram nos alvos gravados só com as regras da auditoria", () => {
    const params = parameters({ phaseCoverage: [{ phaseIndex: 1, muscles: ["QUADRICEPS"], weeklySets: [{ muscle: "QUADRICEPS", minWeighted: 10, maxWeighted: 20 }], basis: "PROFESSIONAL" }] });
    const st = structure("2026-11-09", [phase]);
    // Mesma seleção da 2026.11.2: comparar com a auditoria sobre a seleção antiga (2026.11.3).
    const now = generate(baseInput({ rules: AUDIT_RULES, catalog: XINTUS_CATALOG, structure: st, parameters: params }));
    expect(now.workouts[0].coverage).toEqual({ muscles: ["QUADRICEPS"], patterns: [], basis: "PROFESSIONAL", origin: "PHASE_COVERAGE", weeklySets: [{ muscle: "QUADRICEPS", minWeighted: 10, maxWeighted: 20, basis: "PROFESSIONAL" }] });
    const legacy = generate(baseInput({ rules: LEGACY_RULES, catalog: XINTUS_CATALOG, structure: st, parameters: params }));
    expect(legacy.workouts[0].coverage).toEqual({ muscles: ["QUADRICEPS"], patterns: [], basis: "PROFESSIONAL" });
    expect(canonicalJson(legacy.occurrences.map((o) => o.items.map((i) => i.exerciseId)))).toBe(canonicalJson(now.occurrences.map((o) => o.items.map((i) => i.exerciseId))));
  });
});

describe("auditoria: equilíbrio pertinente ao objetivo e à estrutura", () => {
  const phase: PhaseSeed = { weeks: 2, sessionsPerWeek: 2, stimulus: "HYPERTROPHY", workouts: [{ label: "A" }, { label: "B" }] };
  const plan = { A: ["ex-squat", "ex-bench", "ex-dbpress"], B: ["ex-rdl", "ex-ohp", "ex-pushup"] };

  it("só empurrar no superior: PUSH_PULL sem estímulo do outro lado", () => {
    const { result } = planned([phase], plan);
    const f = of(result, "AUDIT_PATTERN_IMBALANCE").find((x) => x.pattern === "PUSH_PULL")!;
    expect(f.measured).toMatchObject({ detail: { a: 12, b: 0 } });
    expect(f.rationale).toMatch(/sem estímulo do outro lado/);
  });

  it("com alvo explícito só de empurrar, o desequilíbrio é a intenção: sem achado", () => {
    const { result } = planned([phase], plan, { coverage: () => phaseCov([], ["HORIZONTAL_PUSH", "VERTICAL_PUSH"]) });
    expect(of(result, "AUDIT_PATTERN_IMBALANCE").filter((x) => x.pattern === "PUSH_PULL")).toEqual([]);
  });
});

describe("auditoria: generalidade (força, cardio, mobilidade, várias divisões)", () => {
  const MUSCLE_CODES = ["AUDIT_INDIRECT_ONLY", "AUDIT_NON_TARGET_OMITTED", "AUDIT_NO_DIRECT_STIMULUS", "AUDIT_NO_TARGETS", "AUDIT_TARGET_MUSCLE_UNMET", "AUDIT_TARGET_MUSCLE_ABOVE", "AUDIT_REGION_CONCENTRATION"];

  it("força, cardio e mobilidade sem alvos: nenhum achado muscular nem alvo de hipertrofia", () => {
    const strength = generate(baseInput({ structure: structure("2026-11-09", [{ weeks: 3, sessionsPerWeek: 3, stimulus: "STRENGTH", workouts: [{ label: "A", exerciseTarget: 4 }, { label: "B", exerciseTarget: 4 }] }]) }));
    const cardio = generate(baseInput({
      structure: structure("2026-11-09", [{ weeks: 2, sessionsPerWeek: 3, workouts: [
        { label: "Z2", exerciseTarget: 1, focus: { stimulus: { value: "AEROBIC_ENDURANCE", source: "STRUCTURE", basis: "PROFESSIONAL" } } },
        { label: "HIIT", exerciseTarget: 1, focus: { stimulus: { value: "INTERVALS", source: "STRUCTURE", basis: "PROFESSIONAL" } } },
        { label: "Mob", exerciseTarget: 2, focus: { stimulus: { value: "MOBILITY", source: "STRUCTURE", basis: "PROFESSIONAL" } } },
      ] }]),
    }));
    for (const r of [strength, cardio]) {
      const a = audit(r);
      expect(a.findings.filter((f) => MUSCLE_CODES.includes(f.code))).toEqual([]);
      expect(a.phases.every((p) => !p.comprehensive && !p.hasTargets)).toBe(true);
      expect(a.findings.every((f) => f.target === undefined || f.target.origin === "AVAILABILITY")).toBe(true);
    }
    const c = audit(cardio).phases[0];
    expect(c.workouts.every((w) => !w.volumeWorkout && w.weightedShare === null)).toBe(true);
    expect(c.splitShape).toBeNull();
    expect(c.patterns.find((p) => p.pattern === "CYCLICAL")!.sessions.min).toBeGreaterThan(0);
  });

  it("tempo pouco usado só com estimativas completas", () => {
    const st = structure("2026-11-09", [{ weeks: 2, sessionsPerWeek: 2, stimulus: "STRENGTH", workouts: [{ label: "A", exerciseTarget: 1 }, { label: "B", exerciseTarget: 1 }] }]);
    const full = generate(baseInput({ structure: st, parameters: parameters({ availableMinutes: 60 }) }));
    const under = of(full, "AUDIT_DURATION_UNDERUSED");
    expect(under.length).toBe(2);
    // faixa de uso esperada: do limiar (60% de 60 min, heurística) ao tempo disponível; nunca "alvo ≤ 60" sozinho
    expect(under[0]).toMatchObject({ target: { unit: "MINUTES", min: 36, max: 60, basis: "PROFESSIONAL", ruleId: "AUDIT_THRESHOLDS", origin: "AVAILABILITY" } });
    expect(under[0].measured!.value).toBeLessThan(36);
    const empty = generate(baseInput({ structure: st, parameters: parameters({ availableMinutes: 60, doseMode: "LEAVE_EMPTY" }) }));
    expect(of(empty, "AUDIT_DURATION_UNDERUSED")).toEqual([]);
  });

  it.each([
    ["AB corpo inteiro", ["A", "B"], 2],
    ["ABC", ["A", "B", "C"], 3],
    ["ABCD", ["A", "B", "C", "D"], 4],
    ["um treino", ["A"], 1],
    ["superior/inferior 4x", ["U", "L"], 4],
    ["7 sessões ABC", ["A", "B", "C"], 7],
  ])("%s: auditoria completa, sessões reais por semana", (_n, labels, spw) => {
    const r = generate(baseInput({ catalog: XINTUS_CATALOG, structure: structure("2026-11-09", [{ weeks: 2, sessionsPerWeek: spw, stimulus: "HYPERTROPHY", workouts: labels.map((label) => ({ label, exerciseTarget: 4 })) }]) }));
    const p = audit(r).phases[0];
    expect(p.occurrencesPerWeek).toEqual({ min: spw, max: spw });
    expect(p.workouts.reduce((s, w) => s + w.exposuresPerWeek.min, 0)).toBeLessThanOrEqual(spw);
    expect(p.workouts.reduce((s, w) => s + w.exposuresPerWeek.max, 0)).toBeGreaterThanOrEqual(spw);
    expect(r.status).toBe("SUCCEEDED");
  });

  it("superior/inferior declarado nos exercícios: formato observado superior e inferior", () => {
    const { result } = planned([{ weeks: 1, sessionsPerWeek: 4, stimulus: "HYPERTROPHY", rotation: ["U", "L"], workouts: [{ label: "U" }, { label: "L" }] }],
      { U: ["ex-bench", "ex-row", "ex-ohp", "ex-pulldown"], L: ["ex-squat", "ex-rdl", "ex-legcurl", "ex-calf"] });
    expect(audit(result).phases[0].splitShape).toBe("UPPER_LOWER");
    expect(audit(result).phases[0].workouts.map((w) => w.label)).toEqual(["U", "L"]);
  });
});

describe("auditoria: ocorrências reais (rotação irregular, datas vazias, semanas parciais)", () => {
  it("ABC em 4 sessões por semana: 4 sessões em cada semana, exposições inteiras por treino", () => {
    const { result } = planned([{ weeks: 3, sessionsPerWeek: 4, stimulus: "HYPERTROPHY", rotation: ["A", "B", "C"], workouts: [{ label: "A" }, { label: "B" }, { label: "C" }] }],
      { A: ["ex-squat", "ex-bench"], B: ["ex-rdl", "ex-row"], C: ["ex-lunge", "ex-ohp"] });
    const p = audit(result).phases[0];
    expect(p.weekRows.map((w) => w.occurrences)).toEqual([4, 4, 4]);
    // semana 1: A B C A; semana 2: B C A B; semana 3: C A B C
    expect(Object.fromEntries(p.workouts.map((w) => [w.label, w.exposuresPerWeek]))).toEqual({ A: { min: 1, max: 2 }, B: { min: 1, max: 2 }, C: { min: 1, max: 2 } });
  });

  it("semana parcial: aviso próprio e nenhum salto contra ela", () => {
    const seed: PhaseSeed = { weeks: 4, sessionsPerWeek: 4, stimulus: "HYPERTROPHY", rotation: ["A", "B"], workouts: [{ label: "A" }, { label: "B" }] };
    const sets = (_p: number, w: number) => (w === 4 ? 5 : 2);
    const plan = { A: ["ex-squat", "ex-bench", "ex-legext"], B: ["ex-rdl", "ex-row", "ex-curl"] };
    const fullRun = planned([seed], plan, { sets }).result;
    expect(of(fullRun, "AUDIT_WEEK_VOLUME_JUMP")).toEqual([expect.objectContaining({ week: 3, toWeek: 4 })]);
    const st = structure("2026-11-09", [seed]);
    st.phases[0].occurrences = st.phases[0].occurrences.filter((o) => !(o.week === 4 && o.slot > 2));
    const input = baseInput({ catalog: XINTUS_CATALOG, structure: st });
    const partial = resultFrom(input, (o) => plan[o.label as "A" | "B"].map((id) => ({ exerciseId: id, dose: repsDose(sets(o.phaseIndex, o.week)) })));
    expect(of(partial, "AUDIT_PARTIAL_WEEK")).toEqual([expect.objectContaining({ week: 4, measured: { unit: "SESSIONS", value: 2, detail: { sessionsPerWeek: 4 } } })]);
    expect(of(partial, "AUDIT_WEEK_VOLUME_JUMP")).toEqual([]);
    expect(audit(partial).phases[0].occurrencesPerWeek).toEqual({ min: 2, max: 4 });
  });

  it("rotação irregular não é salto de volume: semanas com treinos diferentes não se comparam", () => {
    // ABC em 4 por semana, A com 8 exercícios e B, C com 3; semana 3 = C A B C, semana 4 = A B C A; séries constantes
    const seed: PhaseSeed = { weeks: 4, sessionsPerWeek: 4, stimulus: "HYPERTROPHY", rotation: ["A", "B", "C"], workouts: [{ label: "A" }, { label: "B" }, { label: "C" }] };
    const plan = {
      A: ["ex-squat", "ex-bench", "ex-legext", "ex-row", "ex-ohp", "ex-curl", "ex-triceps", "ex-calf"],
      B: ["ex-rdl", "ex-pulldown", "ex-lateral"], C: ["ex-lunge", "ex-dbpress", "ex-facepull"],
    };
    const { result } = planned([seed], plan);
    expect(audit(result).phases[0].weekRows.map((w) => w.weighted).filter((x, i, a) => a.indexOf(x) === i).length).toBeGreaterThan(1);
    expect(of(result, "AUDIT_WEEK_VOLUME_JUMP")).toEqual([]);
  });

  it("datas vazias: contadas, e nada mais muda", () => {
    const seed = (trainingDays: number[] | null): PhaseSeed => ({ weeks: 2, sessionsPerWeek: 4, stimulus: "HYPERTROPHY", rotation: ["A", "B"], trainingDays, workouts: [{ label: "A" }, { label: "B" }] });
    const plan = { A: ["ex-squat", "ex-bench"], B: ["ex-rdl", "ex-row"] };
    const dated = audit(planned([seed([0, 1, 3, 4])], plan).result);
    const undated = audit(planned([seed(null)], plan).result);
    expect(dated.datesMissing).toBe(0);
    expect(undated.datesMissing).toBe(8);
    expect(canonicalJson({ ...undated, datesMissing: 0 })).toBe(canonicalJson(dated));
  });

  it("fases ainda não geradas (continuar a geração): listadas, as geradas auditadas", () => {
    const r = generate(xintusInput(undefined, { scope: { kind: "PHASES", phaseIndexes: [1] } }));
    expect(audit(r).phasesAudited).toEqual([1]);
    expect(audit(r).phasesMissing).toEqual([2, 3]);
    expect(of(r, "AUDIT_PHASES_NOT_GENERATED")).toHaveLength(1);
  });
});

describe("auditoria: vazio nunca é 0", () => {
  it("LEAVE_EMPTY: séries desconhecidas, presença continua, checagens por séries puladas", () => {
    const r = generate(xintusInput(undefined, { parameters: parameters({ doseMode: "LEAVE_EMPTY", availableEquipment: FULL_GYM, availableMinutes: 60 }) }));
    const a = audit(r);
    for (const p of a.phases) {
      expect(p.weekRows.every((w) => w.unknownSetItems > 0 && w.weighted === null)).toBe(true);
      expect(p.muscles.every((m) => m.direct === null && m.indirect === null && m.weighted === null)).toBe(true);
      expect(p.muscles.find((m) => m.muscle === "QUADRICEPS")!.classification).toBe("DIRECT");
      expect(p.workouts.every((w) => w.weightedShare === null)).toBe(true);
    }
    for (const code of ["AUDIT_TARGET_MUSCLE_UNMET", "AUDIT_WEEK_VOLUME_JUMP", "AUDIT_PHASE_VOLUME_JUMP", "AUDIT_UNIFORM_SET_STEP", "AUDIT_WORKOUT_SHARE", "AUDIT_REGION_CONCENTRATION", "AUDIT_DOSE_UNIFORM"])
      expect(of(r, code), code).toEqual([]);
    for (const f of of(r, "AUDIT_PATTERN_IMBALANCE")) expect(f.measured!.unit).toBe("SESSIONS");
    for (const p of [1, 2, 3]) {
      const u = of(r, "AUDIT_UNCOUNTED_ITEMS", p);
      expect(u).toHaveLength(1);
      expect(u[0].status).toBe("DESCRIPTIVE");
      expect(u[0].rationale).toMatch(/séries não definidas/);
    }
  });

  it("LEAVE_EMPTY com alvo presente por item: nada de 'medido 0'", () => {
    const phase: PhaseSeed = { weeks: 2, sessionsPerWeek: 2, stimulus: "HYPERTROPHY", workouts: [{ label: "A" }, { label: "B" }] };
    const nul = (id: string): PlanItemSeed => ({ exerciseId: id, dose: null });
    const { result } = planned([phase], { A: [nul("ex-squat"), nul("ex-bench")], B: [nul("ex-rdl"), nul("ex-row")] }, {
      coverage: () => phaseCov(["HAMSTRINGS"], [], { weeklySets: [{ muscle: "HAMSTRINGS", minWeighted: 10, basis: "PROFESSIONAL" }] }),
    });
    expect(of(result, "AUDIT_TARGET_MUSCLE_UNMET")).toEqual([]);
    expect(audit(result).phases[0].muscles.find((m) => m.muscle === "HAMSTRINGS")).toMatchObject({ weighted: null, classification: "DIRECT", directSessions: { min: 1, max: 1 } });
  });

  it("linha personalizada preservada (sem exercício da biblioteca): não contada, e ausências viram desconhecidas", () => {
    const phase: PhaseSeed = { weeks: 2, sessionsPerWeek: 4, stimulus: "HYPERTROPHY", rotation: ["A", "B"], workouts: [{ label: "A" }, { label: "B" }] };
    const custom: PlanItemSeed = { exerciseId: null, name: "Exercício do profissional", dose: repsDose(3), doseBasis: "PROFESSIONAL", origin: "PRESERVED" };
    const emptyCalf: PlanItemSeed = { exerciseId: "ex-calf", dose: null, origin: "PRESERVED" };
    const { result } = planned([phase], { A: ["ex-squat", "ex-bench", custom], B: ["ex-rdl", "ex-row", emptyCalf] });
    const p = audit(result).phases[0];
    expect(p.weekRows.map((w) => w.uncountedItems)).toEqual([2, 2]);
    expect(p.weekRows.map((w) => w.unknownSetItems)).toEqual([2, 2]);
    expect(p.muscles.find((m) => m.muscle === "TRAPEZIUS")!.classification).toBe("UNKNOWN");
    expect(p.muscles.find((m) => m.muscle === "CALVES")).toMatchObject({ classification: "DIRECT", directSessions: { min: 2, max: 2 } });
    expect(of(result, "AUDIT_NO_DIRECT_STIMULUS")).toEqual([]);
    expect(of(result, "AUDIT_NON_TARGET_OMITTED")).toEqual([]);
    expect(of(result, "AUDIT_UNCOUNTED_ITEMS")[0].rationale).toMatch(/não foram contados/);
  });
});

describe("auditoria: item não contado com alvo", () => {
  it("linha personalizada no treino A e alvo de posteriores: nada de 'medido 0', séries e equilíbrio pulados", () => {
    const phase: PhaseSeed = { weeks: 2, sessionsPerWeek: 4, stimulus: "HYPERTROPHY", rotation: ["A", "B"], workouts: [{ label: "A" }, { label: "B" }] };
    const custom: PlanItemSeed = { exerciseId: null, name: "Flexora do aluno", dose: repsDose(3), doseBasis: "PROFESSIONAL", origin: "PRESERVED" };
    const { result } = planned([phase], { A: ["ex-squat", "ex-legext", "ex-bench", custom], B: ["ex-hipthrust", "ex-row", "ex-pulldown"] }, {
      coverage: () => phaseCov(["HAMSTRINGS"], [], { weeklySets: [{ muscle: "QUADRICEPS", minWeighted: 30, basis: "PROFESSIONAL" }] }),
    });
    const p = audit(result).phases[0];
    expect(p.weekRows.every((w) => w.uncountedItems === 2 && w.weighted === null)).toBe(true);
    expect(p.muscles.find((m) => m.muscle === "HAMSTRINGS")).toMatchObject({ classification: "UNKNOWN", direct: null, indirect: null, weighted: null });
    expect(p.patterns.every((x) => x.sets === null)).toBe(true);
    for (const code of ["AUDIT_TARGET_MUSCLE_UNMET", "AUDIT_PATTERN_IMBALANCE", "AUDIT_WEEK_VOLUME_JUMP", "AUDIT_WORKOUT_SHARE"]) expect(of(result, code), code).toEqual([]);
    expect(of(result, "AUDIT_UNCOUNTED_ITEMS")[0].rationale).toMatch(/não é dado como 0/);
  });

  it("item não contado só no treino A: alvo do treino B continua checado", () => {
    const phase: PhaseSeed = { weeks: 2, sessionsPerWeek: 4, stimulus: "HYPERTROPHY", rotation: ["A", "B"], workouts: [{ label: "A" }, { label: "B" }] };
    const custom: PlanItemSeed = { exerciseId: null, name: "Flexora do aluno", dose: repsDose(3), origin: "PRESERVED" };
    const focusB = (_p: number, l: string) => (l === "B" ? phaseCov(["HAMSTRINGS"], [], { origin: "WORKOUT_FOCUS" }) : null);
    const { result } = planned([phase], { A: ["ex-squat", custom], B: ["ex-hipthrust", "ex-row"] }, { coverage: focusB });
    expect(of(result, "AUDIT_TARGET_MUSCLE_UNMET")).toEqual([expect.objectContaining({ muscle: "HAMSTRINGS", label: "B", week: 1 })]);
  });
});

describe("auditoria: revisão final V3 (rodízio, bíceps, ação da proposta antiga)", () => {
  const plan = { A: ["ex-squat", "ex-legext", "ex-bench"], B: ["ex-rdl", "ex-row", "ex-pulldown"] };

  it("AB 1×/semana: cada semana tem um treino só; divisão entre treinos e equilíbrio medidos na soma das semanas", () => {
    const phase: PhaseSeed = { weeks: 4, sessionsPerWeek: 1, stimulus: "HYPERTROPHY", workouts: [{ label: "A" }, { label: "B" }] };
    const { result } = planned([phase], plan);
    expect(audit(result).phases[0].workouts.map((w) => w.exposuresPerWeek.min)).toEqual([0, 0]);
    expect(of(result, "AUDIT_WORKOUT_SHARE")).toEqual([]);
    for (const f of of(result, "AUDIT_PATTERN_IMBALANCE")) {
      expect(f.week).toBeUndefined();
      expect(f.rationale).not.toMatch(/sem estímulo do outro lado/);
    }
  });

  it("AB 1×/semana com um treino muito maior: a concentração aparece, por sessão e sem semana", () => {
    const phase: PhaseSeed = { weeks: 4, sessionsPerWeek: 1, stimulus: "HYPERTROPHY", workouts: [{ label: "A" }, { label: "B" }] };
    const { result } = planned([phase], { A: ["ex-squat", "ex-legext", "ex-bench", "ex-row", "ex-pulldown", "ex-rdl", "ex-legpress"], B: ["ex-legext"] });
    const [f] = of(result, "AUDIT_WORKOUT_SHARE");
    expect(f).toMatchObject({ label: "A", measured: { unit: "SHARE" } });
    expect(f.week).toBeUndefined();
    expect(f.rationale).toMatch(/uma sessão do treino A/);
  });

  it("AB 3×/semana (A, B, A / B, A, B): o treino que aparece mais vezes na semana não vira concentração", () => {
    const phase: PhaseSeed = { weeks: 4, sessionsPerWeek: 3, stimulus: "MUSCULAR_ENDURANCE", workouts: [{ label: "A" }, { label: "B" }] };
    const { result } = planned([phase], plan);
    expect(of(result, "AUDIT_WORKOUT_SHARE")).toEqual([]);
  });

  it("sem alvos e sem rosca: bíceps (só indireto, por remadas e puxadas) fica fora da observação aberta", () => {
    const phase: PhaseSeed = { weeks: 2, sessionsPerWeek: 4, stimulus: "HYPERTROPHY", rotation: ["A", "B"], workouts: [{ label: "A" }, { label: "B" }] };
    const { result } = planned([phase], plan);
    const p = audit(result).phases[0];
    expect(p.muscles.find((m) => m.muscle === "BICEPS")!.classification).toBe("INDIRECT_ONLY");
    const [f] = of(result, "AUDIT_INDIRECT_ONLY");
    expect(f.status).toBe("OPEN");
    for (const x of audit(result).findings.filter((y) => y.code !== "AUDIT_NO_DIRECT_STIMULUS")) {
      expect([x.muscle ?? "", ...Object.keys(x.measured?.detail ?? {})].join(" "), x.code).not.toMatch(/CALVES|BICEPS|\bABS\b/);
      expect(x.rationale, x.code).not.toMatch(/Panturrilha|Bíceps|Abdominais/);
    }
    // com alvos (BY_DESIGN, "lido como escolha"), o músculo continua listado: não é recomendação
    const withTargets = planned([phase], plan, { coverage: () => phaseCov(["QUADRICEPS", "CHEST"]) }).result;
    expect(Object.keys(of(withTargets, "AUDIT_INDIRECT_ONLY")[0].measured!.detail!)).toContain("BICEPS");
  });

  it("auditoria calculada na tela de uma proposta 2026.11.2: AUDIT_NO_TARGETS sem a ação de aceitar sugestão", async () => {
    const { auditOfStored } = await import("@/modules/prescricao/automatica/service");
    const legacy = auditOfStored(xintusPreviousResult(LEGACY_RULES), XINTUS_CATALOG)!;
    const current = auditOfStored(xintusPreviousResult(), XINTUS_CATALOG)!;
    for (const p of [1, 2, 3]) {
      const old = legacy.findings.find((f) => f.code === "AUDIT_NO_TARGETS" && f.phaseIndex === p)!;
      expect(old.suggestedAction).not.toMatch(/sugerid/i);
      expect(old.sourceRefs).toEqual(["rule:AUDIT_COMPREHENSIVE_STIMULI"]);
      expect(current.findings.find((f) => f.code === "AUDIT_NO_TARGETS" && f.phaseIndex === p)!.suggestedAction).toMatch(/sugeridos/);
    }
  });
});

describe("auditoria: fase mista (resistido, cardio, mobilidade)", () => {
  it("só os treinos com volume entram na divisão e na redundância de padrão", () => {
    const catalog = [...XINTUS_CATALOG, exercise({ id: "ex-ankmob", name: "Mobilidade de tornozelo", modality: "MOBILITY", metric: "TIME", patterns: ["MOBILITY"] })];
    const phase: PhaseSeed = { weeks: 2, sessionsPerWeek: 4, stimulus: "HYPERTROPHY", rotation: ["A", "C", "A", "D"], workouts: [{ label: "A" }, { label: "C" }, { label: "D" }] };
    const { result } = planned([phase], { A: ["ex-squat", "ex-bench", "ex-row", "ex-rdl"], C: ["ex-bike"], D: ["ex-hipmob", "ex-tspine", "ex-ankmob"] }, { over: { catalog } });
    const p = audit(result).phases[0];
    const w = Object.fromEntries(p.workouts.map((x) => [x.label, x]));
    expect([w.C.volumeWorkout, w.C.weightedShare, w.D.volumeWorkout, w.D.weightedShare]).toEqual([false, null, false, null]);
    expect(w.A.weightedShare).toBe(1);
    expect(of(result, "AUDIT_WORKOUT_SHARE")).toEqual([]);
    expect(of(result, "AUDIT_PATTERN_REPEATED_IN_SESSION")).toEqual([]);
    expect(p.splitShape).toBe("SINGLE");
    expect(p.weekRows.every((x) => x.uncountedItems === 0)).toBe(true);
  });
});

describe("auditoria: dose × estímulo (DOSE_DEFAULTS da própria versão)", () => {
  const phase: PhaseSeed = { weeks: 1, sessionsPerWeek: 2, stimulus: "STRENGTH", workouts: [{ label: "A" }, { label: "B" }] };
  const run = (dose: ReturnType<typeof repsDose>, doseBasis: "POLICY" | "PROFESSIONAL", stimulus = "STRENGTH") =>
    planned([{ ...phase, stimulus }], { A: [{ exerciseId: "ex-squat", dose, doseBasis }, "ex-bench"], B: ["ex-rdl"] }, { sets: () => 4 }).result;
  const high = repsDose(4, { reps: { min: 15, max: 15 }, restSeconds: 45 });
  const strengthDose = (r: EngineResult) => of(r, "AUDIT_DOSE_STIMULUS_MISMATCH").filter((f) => f.rationale.includes("15–15"));

  it("15 repetições / 45 s sob Força: BY_DESIGN quando a dose é do profissional, aberto quando vem da política", () => {
    expect(strengthDose(run(high, "PROFESSIONAL"))).toEqual([expect.objectContaining({ status: "BY_DESIGN", severity: "INFO", measured: expect.objectContaining({ detail: expect.objectContaining({ repsMin: 15, bandMin: 3, bandMax: 6, bandRest: 180, items: 1 }) }) })]);
    expect(strengthDose(run(high, "POLICY"))).toEqual([expect.objectContaining({ status: "OPEN" })]);
  });

  it("6–8 repetições / 150 s não é sinalizado; estímulo sem linha de dose também não", () => {
    expect(strengthDose(run(repsDose(4, { reps: { min: 6, max: 8 }, restSeconds: 150 }), "POLICY"))).toEqual([]);
    expect(of(run(high, "POLICY", "BALANCE"), "AUDIT_DOSE_STIMULUS_MISMATCH")).toEqual([]);
  });
});

describe("auditoria: limites, determinismo, separação e reprodução", () => {
  it("não muda status, validação, avisos nem volume; ausente nas versões sem auditoria", () => {
    // A auditoria sobre a seleção antiga (2026.11.3) contra a 2026.11.2: só o campo `audit` (e as regras dele) muda.
    const now = generate(xintusInput(AUDIT_RULES));
    const legacy = generate(xintusInput(LEGACY_RULES));
    expect("audit" in legacy).toBe(false);
    expect([now.status, now.validation]).toEqual([legacy.status, legacy.validation]);
    expect(canonicalJson(now.issues)).toBe(canonicalJson(legacy.issues));
    expect(canonicalJson(now.volume)).toBe(canonicalJson(legacy.volume));
    expect(canonicalJson(now.occurrences.map((o) => o.items.map((i) => [i.exerciseId, i.dose])))).toBe(canonicalJson(legacy.occurrences.map((o) => o.items.map((i) => [i.exerciseId, i.dose]))));
    expect(now.rulesUsed.map((u) => u.ruleId)).toEqual(expect.arrayContaining(["AUDIT_THRESHOLDS", "AUDIT_COMPREHENSIVE_STIMULI", "AUDIT_BALANCE_PAIRS", "AUDIT_REGIONS"]));
    expect(now.audit!.findings.every((f) => f.severity !== ("ERROR" as never) && f.stage === "VALIDATION")).toBe(true);
  });

  it("limite técnico: acima de maxFindings, agrupados com contagem", () => {
    const base = getRuleSet({ id: "gymgital-base", version: "2026.11.3" })!;
    const rules = JSON.parse(JSON.stringify(base)) as RuleSet;
    rules.rules.AUDIT_THRESHOLDS!.value.maxFindings = 5;
    const log = new RuleLog(rules);
    const r = xintusPreviousResult();
    const raw = auditPlan({ log, phases: r.phases, structure: null, workouts: r.workouts, occurrences: r.occurrences, volume: r.volume, byId: new Map(XINTUS_CATALOG.map((e) => [e.id, e])) });
    expect(raw.findings.length).toBeGreaterThan(5);
    const bounded = boundAudit(log, raw);
    const kept = bounded.findings.filter((f) => f.count === undefined);
    expect(kept).toHaveLength(5);
    const agg = bounded.findings.at(-1)!;
    expect(agg).toMatchObject({ code: "AUDIT_AGGREGATED", count: raw.findings.length - 5 });
    expect(bounded.findings.filter((f) => f.count !== undefined && f.code !== "AUDIT_AGGREGATED").reduce((s, f) => s + f.count!, 0)).toBe(raw.findings.length - 5);
    for (const f of bounded.findings) {
      expect(f.rationale.length).toBeLessThanOrEqual(300);
      expect(f.sourceRefs.length).toBeLessThanOrEqual(12);
    }
  });

  it("caso grande: 12 fases × 4 semanas × 7 sessões, resumo abaixo do limite de summary_json", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ ...XINTUS_CATALOG[i % XINTUS_CATALOG.length], id: `gen-${String(i).padStart(3, "0")}` }));
    const input = baseInput({
      catalog: many,
      structure: structure("2026-11-09", Array.from({ length: 12 }, () => ({ weeks: 4, sessionsPerWeek: 7, stimulus: "HYPERTROPHY", workouts: ["A", "B", "C", "D", "E", "F", "G"].map((label) => ({ label, exerciseTarget: 8 })) }))),
    });
    const t0 = performance.now();
    const r = generate(input);
    const ms = performance.now() - t0;
    expect(r.occurrences).toHaveLength(12 * 4 * 7);
    expect(ms).toBeLessThan(5000);
    expect(r.audit!.findings.filter((f) => f.count === undefined).length).toBeLessThanOrEqual(150);
    const { occurrences, ...summary } = r;
    void occurrences;
    expect(canonicalJson(summary).length).toBeLessThan(500000);
    expect(canonicalJson(r.audit).length).toBeLessThan(200000);
  });

  it("determinismo: catálogo embaralhado → mesmos bytes", () => {
    const input = xintusInput();
    const shuffled = { ...input, catalog: [...input.catalog].reverse() };
    expect(canonicalJson(generate(shuffled))).toBe(canonicalJson(generate(input)));
    const a = xintusPreviousResult();
    const b = resultFrom({ ...xintusInput(), catalog: [...XINTUS_CATALOG].reverse() }, (o) => XINTUS_PREVIOUS_PLAN[o.label].map((id) => ({ exerciseId: id, dose: xintusPreviousDose(id, o.phaseIndex, o.week) })));
    expect(canonicalJson(b.audit)).toBe(canonicalJson(a.audit));
  });

  it("a auditoria não lê a origem dos itens (travar não a deixa velha) e não muda a entrada", () => {
    const r = xintusPreviousResult(AUDIT_RULES);
    const log = ruleLogFor(AUDIT_RULES)!;
    const byId = new Map(XINTUS_CATALOG.map((e) => [e.id, e]));
    const locked = r.occurrences.map((o) => ({ ...o, items: o.items.map((i) => ({ ...i, origin: "LOCKED" as const })) }));
    const frozen = JSON.parse(JSON.stringify(locked));
    const deepFreeze = (v: unknown): void => { if (v && typeof v === "object") { Object.values(v).forEach(deepFreeze); Object.freeze(v); } };
    deepFreeze(locked);
    const again = boundAudit(log, auditPlan({ log, phases: r.phases, structure: null, workouts: r.workouts, occurrences: locked, volume: r.volume, byId }));
    expect(canonicalJson(again)).toBe(canonicalJson(r.audit));
    expect(canonicalJson(locked)).toBe(canonicalJson(frozen));
  });

  it("recalculada em toda operação: nenhum achado velho sobrevive (substituir, regenerar, rebase, revalidar)", () => {
    const input = xintusInput();
    const before = generate(input);
    const stale: EngineResult = { ...before, audit: { ...before.audit!, findings: [{ code: "AUDIT_AGGREGATED", severity: "INFO", status: "OPEN", stage: "VALIDATION", sourceRefs: [], rationale: "velho", suggestedAction: null }] } };
    const fresh = (r: EngineResult) => canonicalJson(revalidate(input, r).audit);
    const first = before.occurrences[0];
    const outcomes = [
      revalidate(input, stale),
      ok(substitute(input, stale, { phaseIndex: 1, slotKey: first.items[0].slotKey, applies: { kind: "PHASE" } }, first.items[0].alternatives[0])),
      ok(regenerate(input, stale, { kind: "WORKOUT", phaseIndex: 1, label: "B" })),
      ok(regenerate(input, stale, { kind: "PHASE", phaseIndex: 2 })),
      ok(rebase({ ...input, existing: [] }, stale)),
    ];
    for (const r of outcomes) {
      expect(r.audit!.findings.some((f) => f.rationale === "velho")).toBe(false);
      expect(canonicalJson(r.audit)).toBe(fresh(r));
    }
  });
});

describe("rastreabilidade: contribuição semanal do item (só números do item)", () => {
  it("séries × sessões do treino na semana; ausente sem as regras da auditoria", () => {
    const r = generate(xintusInput());
    for (const o of r.occurrences.slice(0, 8))
      for (const i of o.items) {
        const e = XINTUS_CATALOG.find((x) => x.id === i.exerciseId)!;
        const entries = i.trace.selection.filter((t) => t.code === "WEEKLY_CONTRIBUTION");
        if (e.modality !== "RESISTANCE" || (!e.primaryMuscles.length && !e.secondaryMuscles.length)) {
          expect(entries).toEqual([]);
          continue;
        }
        expect(entries).toHaveLength(1);
        const sets = i.dose && "sets" in i.dose ? i.dose.sets : null;
        expect(entries[0].detail).toContain(`Semana ${o.week}: 2 sessões do treino ${o.label} × ${sets} séries = ${sets! * 2} séries`);
        expect(entries[0].detail).not.toMatch(/ de \d+ na semana/);
        // derivados depois da seleção: a contribuição e, com FINDING_OBSERVATION_MAP (2026.11.4+), as observações da avaliação
        expect(i.trace.selection.filter((t) => t.code !== "ASSESSMENT_OBSERVATION").at(-1)!.code).toBe("WEEKLY_CONTRIBUTION");
      }
    expect(generate(xintusInput(LEGACY_RULES)).occurrences.every((o) => o.items.every((i) => i.trace.selection.every((t) => t.code !== "WEEKLY_CONTRIBUTION")))).toBe(true);
  });

  it("sem séries: 'contribuição não calculada', nunca 0; recalculada após substituir", () => {
    const empty = generate(xintusInput(undefined, { parameters: parameters({ doseMode: "LEAVE_EMPTY", availableEquipment: FULL_GYM }) }));
    const entry = empty.occurrences[0].items[0].trace.selection.find((t) => t.code === "WEEKLY_CONTRIBUTION")!;
    expect(entry.detail).toMatch(/séries não definidas; contribuição no volume não calculada/);
    const input = xintusInput();
    const before = generate(input);
    const target = before.occurrences[0].items[0];
    const after = ok(substitute(input, before, { phaseIndex: 1, slotKey: target.slotKey, applies: { kind: "PHASE" } }, target.alternatives[0]));
    const item = after.occurrences[0].items[0];
    expect(item.exerciseId).toBe(target.alternatives[0]);
    expect(item.trace.selection.filter((t) => t.code === "WEEKLY_CONTRIBUTION")).toHaveLength(1);
    // os itens de B não mudam (nem o traço): nada é reescrito fora do treino substituído
    const bBefore = before.occurrences.filter((o) => o.label === "B").map((o) => canonicalJson(o.items));
    const bAfter = after.occurrences.filter((o) => o.label === "B").map((o) => canonicalJson(o.items));
    expect(bAfter).toEqual(bBefore);
  });
});

describe("regras 2026.11.3", () => {
  it("só acrescenta as regras da auditoria à 2026.11.2", () => {
    const v2 = getRuleSet(LEGACY_RULES)!;
    const v3 = getRuleSet({ id: "gymgital-base", version: "2026.11.3" })!;
    const added = Object.keys(v3.rules).filter((k) => !(k in v2.rules));
    expect(added.sort()).toEqual(["AUDIT_BALANCE_PAIRS", "AUDIT_COMPREHENSIVE_STIMULI", "AUDIT_REGIONS", "AUDIT_THRESHOLDS"]);
    for (const k of Object.keys(v2.rules)) expect(canonicalJson((v3.rules as Record<string, unknown>)[k]), k).toBe(canonicalJson((v2.rules as Record<string, unknown>)[k]));
    for (const k of added) expect((v3.rules as Record<string, { basis: string }>)[k].basis).toBe("HEURISTIC");
  });

  it("CATALOG da fixture comum continua válido sob a auditoria", () => {
    expect(generate(baseInput({ catalog: CATALOG })).audit).toBeDefined();
  });
});
