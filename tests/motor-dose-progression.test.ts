/**
 * Motor V4, PR 3.2 (regras gymgital-base@2026.11.6): intenção de dose e de progressão da estratégia aceita, progressão
 * condicionada ao histórico real, auditoria de saltos de dose e o "por quê" de séries, repetições, RIR e descanso. O que se prova:
 *  - o pedido de perfil da estratégia só vale quando a política o admite e o exercício o confirma; senão há aviso explicado;
 *  - a intenção de progressão entra por último (profissional > estrutura > intenção), nunca em `progressionByPhase`, e a descarga
 *    nunca é gerada;
 *  - o histórico só gera REVIEW/sugestão, a partir de registros reais, e nunca escreve dose;
 *  - versões anteriores não recebem nada disto.
 */
import { describe, expect, it } from "vitest";
import {
  canonicalJson, generate, getRuleSet, proposeProgression, revalidate,
  type Dose, type EngineInput, type EngineResult, type ExposureLog, type ItemOut, type RuleSet, type WeeklyProgression,
} from "@/modules/prescricao/motor";
import { RuleLog } from "@/modules/prescricao/motor/trace";
import { resolveDose } from "@/modules/prescricao/motor/dose";
import { phaseSummaries } from "@/modules/prescricao/motor/generate";
import { classOf, profileFor } from "@/modules/prescricao/motor/dose-profile";
import { doseIntentsOf } from "@/modules/prescricao/automatica/build-input";
import type { GenerationAnswers } from "@/modules/prescricao/automatica/contracts";
import { baseInput, exercise, parameters, structure } from "./helpers/motor-fixtures";
import { xintusInput } from "./helpers/xintus";

const V6 = { id: "gymgital-base", version: "2026.11.6" } as const;
const V5 = { id: "gymgital-base", version: "2026.11.5" } as const;
const rules6 = getRuleSet(V6) as RuleSet;
const rules5 = getRuleSet(V5) as RuleSet;
const profiles = rules6.rules.DOSE_PROFILES!.value;
const classMap = rules6.rules.DOSE_CLASS_MAP!.value;

const press = exercise({ id: "t-press", name: "Supino", primaryMuscles: ["CHEST"], patterns: ["HORIZONTAL_PUSH"], compound: true, difficulty: 2 });
const calf = exercise({ id: "t-calf", name: "Panturrilha", primaryMuscles: ["CALVES"], patterns: ["PLANTAR_FLEXION"], compound: false, difficulty: 1 });
const curl = exercise({ id: "t-curl", name: "Rosca", primaryMuscles: ["BICEPS"], patterns: ["ELBOW_FLEXION"], compound: false, difficulty: 1 });
const unknownCompound = exercise({ id: "t-unk", name: "Sem metadado", primaryMuscles: ["BICEPS"], patterns: ["ELBOW_FLEXION"], compound: null, difficulty: 1 });

const reps = (d: Dose | null) => (d?.metric === "REPS" ? d : null);
const tuple = (d: Dose | null) => {
  const r = reps(d);
  return r ? `${r.reps.min}-${r.reps.max}|${r.intensity?.kind === "RIR" ? `${r.intensity.range.min}-${r.intensity.range.max}` : ""}|${r.restSeconds}` : "—";
};

function dose(e: ReturnType<typeof exercise>, params: Partial<EngineInput["parameters"]> = {}, over: { stimulus?: string; rules?: RuleSet; week?: number; progression?: Parameters<typeof resolveDose>[2]["progression"] } = {}) {
  return resolveDose(new RuleLog(over.rules ?? rules6), parameters(params), {
    exercise: e, stimulus: over.stimulus ?? "HYPERTROPHY", phaseIndex: 1, label: "A", week: over.week ?? 1, phaseWeeks: 8, progression: over.progression ?? null,
    experience: null, budgetMinutes: null,
  });
}
const ask = (exerciseClass: string, profileCode: string, origin: "AI_SUGGESTED" | "RULES_HEURISTIC" = "AI_SUGGESTED") =>
  ({ doseIntentByClass: [{ exerciseClass, profileCode, origin }] }) as unknown as Partial<EngineInput["parameters"]>;

describe("intenção de dose da estratégia: só vale dentro da política", () => {
  it("pedido que o exercício confirma troca o perfil, e o traço diz de quem foi a escolha e o que a desfaria", () => {
    const base = dose(calf);
    expect(base.params.find((p) => p.param === "profile")?.profileId).toBe("HYP_ISOLATION_HIGH_REP");
    const r = dose(calf, ask("ISOLATION_LOWER", "ISOLATION_STANDARD"));
    expect(tuple(r.dose)).toBe("10-15|1-2|75");
    expect(r.profile?.intent).toEqual({ exerciseClass: "ISOLATION_LOWER", code: "ISOLATION_STANDARD", outcome: "HONOURED" });
    const rest = r.params.find((p) => p.param === "restSeconds")!;
    expect(rest).toMatchObject({ profileId: "HYP_ISOLATION", ruleId: "DOSE_PROFILES", origin: "AI_SUGGESTED" });
    expect(rest.reasons).toContain("BLUEPRINT_INTENT");
    expect(rest.changeIf).toMatch(/pedido de perfil/);
    // O pedido nunca mexe nas séries nem inventa carga.
    expect(reps(r.dose)!.sets).toBe(reps(base.dose)!.sets);
    expect(reps(r.dose)!.loadKg).toBeNull();
  });

  it("a origem do pedido (IA ou heurística por regras) vai para o traço", () => {
    const r = dose(calf, ask("ISOLATION_LOWER", "ISOLATION_STANDARD", "RULES_HEURISTIC"));
    expect(r.params.find((p) => p.param === "repsMin")?.origin).toBe("RULES_HEURISTIC");
  });

  it("pedido igual ao que a especificidade já escolheria não muda nada (SAME) e não gera aviso", () => {
    const r = dose(curl, ask("ISOLATION_UPPER", "ISOLATION_STANDARD"));
    expect(r.profile?.intent?.outcome).toBe("SAME");
    expect(r.params.find((p) => p.param === "repsMin")?.reasons).not.toContain("BLUEPRINT_INTENT");
    expect(tuple(r.dose)).toBe(tuple(dose(curl).dose));
  });

  it("perfil que a classe não admite é recusado com a explicação; vale o perfil da política", () => {
    const r = dose(press, ask("COMPOUND_UPPER_PUSH", "ISOLATION_STANDARD"));
    expect(r.profile?.intent).toMatchObject({ outcome: "REJECTED", why: "NOT_IN_CLASS_MAP" });
    expect(r.params.find((p) => p.param === "profile")?.profileId).toBe("HYP_COMPOUND_MODERATE");
    expect(tuple(r.dose)).toBe(tuple(dose(press).dose));
  });

  it("perfil admitido pela classe mas sem perfil deste estímulo/exercício é recusado (NO_MATCHING_PROFILE)", () => {
    // Potência não tem perfil: nada para trocar.
    const power = dose(press, ask("COMPOUND_UPPER_PUSH", "COMPOUND_HEAVY"), { stimulus: "POWER" });
    expect(power.profile?.intent).toMatchObject({ outcome: "REJECTED", why: "NO_MATCHING_PROFILE" });
    // Há perfil COMPOUND_HEAVY em hipertrofia, mas o supino de dificuldade 2 sem padrão pesado não o confirma.
    const light = dose(press, ask("COMPOUND_UPPER_PUSH", "COMPOUND_HEAVY"));
    expect(light.profile?.intent).toMatchObject({ outcome: "REJECTED", why: "NO_MATCHING_PROFILE" });
    expect(light.params.find((p) => p.param === "profile")?.profileId).toBe("HYP_COMPOUND_MODERATE");
  });

  it("metadado ausente: o pedido não vale (o perfil dependeria de um palpite) e a incerteza continua registrada", () => {
    const r = dose(unknownCompound, ask("ISOLATION_UPPER", "ISOLATION_STANDARD"));
    // compound nulo = classe OTHER: o pedido para outra classe nem é consultado.
    expect(classOf(unknownCompound).cls).toBe("OTHER");
    expect(r.profile?.intent).toBeUndefined();
    expect(r.profile?.uncertain).toContain("compound");
    const other = dose(unknownCompound, ask("OTHER", "ISOLATION_STANDARD"));
    expect(other.profile?.intent).toMatchObject({ outcome: "REJECTED", why: "NOT_IN_CLASS_MAP" });
  });

  it("pedido para outra classe não afeta o exercício", () => {
    const r = dose(curl, ask("COMPOUND_LOWER", "COMPOUND_MODERATE"));
    expect(r.profile?.intent).toBeUndefined();
    expect(tuple(r.dose)).toBe(tuple(dose(curl).dose));
  });

  it("condicionamento não admite perfil de força: recusa explicada na escolha do perfil", () => {
    const choice = profileFor(profiles, curl, "HYPERTROPHY", "CARDIO", "CONTINUOUS", { exerciseClass: "CONDITIONING", code: "COMPOUND_HEAVY", origin: "AI_SUGGESTED", classMap });
    expect(choice.profile).toBeNull();
    expect(choice.intent).toMatchObject({ outcome: "REJECTED", why: "NOT_IN_CLASS_MAP" });
  });

  it("regras sem a política de dose (2026.11.5 e anteriores) ignoram o pedido por completo", () => {
    const r = dose(calf, ask("ISOLATION_LOWER", "ISOLATION_STANDARD"), { rules: rules5 });
    expect(r.profile).toBeUndefined();
    expect(tuple(r.dose)).toBe("8-12|1-3|90");
  });

  it("na proposta, o aviso de recusa sai uma vez por classe, código e fase, com o texto explicado", () => {
    const input = xintusInput(V6);
    const r = generate({ ...input, parameters: { ...input.parameters, ...ask("COMPOUND_UPPER_PUSH", "ISOLATION_STANDARD") } });
    const rejected = r.issues.filter((i) => i.code === "DOSE_INTENT_REJECTED");
    expect(rejected.map((i) => i.phaseIndex)).toEqual([1, 2, 3]);
    expect(rejected[0].severity).toBe("INFO");
    expect(rejected[0].message).toMatch(/pediu o perfil "isolado padrão" para exercícios multiarticulares de empurrar/);
    expect(rejected[0].message).toMatch(/não admite/);
    expect(new Set(rejected.map((i) => i.path)).size).toBe(3);
  });

  it("pedido honrado muda só repetições, RIR e descanso: seleção e séries são as mesmas", () => {
    const input = xintusInput(V6);
    const plain = generate(input);
    const asked = generate({ ...input, parameters: { ...input.parameters, ...ask("ISOLATION_UPPER", "ISOLATION_STANDARD") } });
    expect(asked.occurrences.map((o) => o.items.map((i) => i.exerciseId))).toEqual(plain.occurrences.map((o) => o.items.map((i) => i.exerciseId)));
    const sets = (r: EngineResult) => r.occurrences.map((o) => o.items.map((i) => reps(i.dose)?.sets ?? null));
    expect(sets(asked)).toEqual(sets(plain));
    const changed = asked.occurrences.flatMap((o) => o.items).filter((i) => i.trace.params.some((p) => p.reasons?.includes("BLUEPRINT_INTENT")));
    expect(changed.length).toBeGreaterThan(0);
    for (const i of changed) expect(tuple(i.dose)).toBe("10-15|1-2|75");
  });
});

describe("intenção de progressão da estratégia", () => {
  const withProgression = (input: EngineInput, progressions: Record<number, WeeklyProgression>): EngineInput => ({
    ...input, structure: { ...input.structure, phases: input.structure.phases.map((p) => (progressions[p.index] ? { ...p, progression: { value: progressions[p.index], source: "STRUCTURE", basis: "PROFESSIONAL" } } : p)) },
  });
  const ramp = { phaseIndex: 1, intent: "VOLUME_RAMP", origin: "AI_SUGGESTED" as const, progression: rules6.rules.PROGRESSION_TEMPLATES!.value.VOLUME_RAMP.progression! };
  const intentInput = (over: Partial<EngineInput["parameters"]> = {}, rules: EngineInput["rules"] = V6) => {
    const base = baseInput({
      rules,
      structure: structure("2026-11-09", [{ weeks: 6, sessionsPerWeek: 1, stimulus: "HYPERTROPHY", workouts: [{ label: "A", exerciseTarget: 3, focus: { patterns: ["SQUAT", "HORIZONTAL_PUSH", "ELBOW_FLEXION"] } }] }]),
    });
    return { ...base, parameters: { ...base.parameters, progressionIntentByPhase: [ramp], ...over } };
  };
  const setsByWeek = (r: EngineResult) => r.occurrences.map((o) => reps(o.items[0].dose)!.sets);

  it("VOLUME_RAMP soma 1 série a cada 2 semanas (limite 6) e o traço diz regra, origem, motivo e o que mudaria", () => {
    const r = generate(intentInput());
    expect(setsByWeek(r)).toEqual([3, 3, 4, 4, 5, 5]);
    const t = r.occurrences[2].items[0].trace.params.find((p) => p.param === "sets")!;
    expect(t).toMatchObject({ basis: "HEURISTIC_ACCEPTED", ruleId: "PROGRESSION_TEMPLATES", origin: "AI_SUGGESTED", reasons: ["PROGRESSION_INTENT:VOLUME_RAMP"] });
    expect(t.changeIf).toMatch(/progressão da fase/);
    expect(r.status).toBe("SUCCEEDED");
  });

  it("a intenção vira o resumo da fase, mas só pelo caminho da intenção", () => {
    const input = intentInput();
    const summary = phaseSummaries(input)[0].progression!;
    expect(summary).toMatchObject({ source: "RULES", basis: "HEURISTIC_ACCEPTED", ruleId: "PROGRESSION_TEMPLATES", ref: "VOLUME_RAMP", origin: "AI_SUGGESTED" });
    expect(input.parameters.progressionByPhase).toEqual([]);
  });

  it("precedência: o profissional desta geração > a gravada na estrutura > a intenção", () => {
    const own: WeeklyProgression = { model: "STEP", steps: [{ param: "sets", delta: 2, everyWeeks: 1, limit: 8 }] };
    const saved: WeeklyProgression = { model: "NONE" };
    const professional = generate(intentInput({ progressionByPhase: [{ phaseIndex: 1, progression: own }] }));
    expect(setsByWeek(professional)).toEqual([3, 5, 7, 8, 8, 8]);
    expect(professional.occurrences[1].items[0].trace.params.find((p) => p.param === "sets")?.basis).toBe("PROFESSIONAL");
    const stored = generate(withProgression(intentInput(), { 1: saved }));
    expect(setsByWeek(stored)).toEqual([3, 3, 3, 3, 3, 3]);
    expect(stored.occurrences[3].items[0].trace.params.find((p) => p.param === "sets")?.ruleId).not.toBe("PROGRESSION_TEMPLATES");
  });

  it("sem a intenção, a fase sem progressão fica como sempre (nenhuma série sobe)", () => {
    const i = intentInput();
    const r = generate({ ...i, parameters: { ...i.parameters, progressionIntentByPhase: undefined } });
    expect(setsByWeek(r)).toEqual([3, 3, 3, 3, 3, 3]);
  });

  it("LOAD_FIRST e REPS_THEN_LOAD só escrevem o texto de carga; séries e faixas ficam; o texto do profissional vence", () => {
    const t = rules6.rules.PROGRESSION_TEMPLATES!.value;
    const text = (name: "LOAD_FIRST" | "REPS_THEN_LOAD") => ({ phaseIndex: 1, intent: name, origin: "RULES_HEURISTIC" as const, progression: t[name].progression!, loadInstruction: t[name].loadInstruction! });
    const r = generate(intentInput({ progressionIntentByPhase: [text("LOAD_FIRST")] }));
    expect(setsByWeek(r)).toEqual([3, 3, 3, 3, 3, 3]);
    for (const o of r.occurrences)
      for (const i of o.items) {
        const d = reps(i.dose)!;
        expect(d.loadInstruction).toBe("Mantenha as repetições e aumente a carga só quando o esforço indicado permitir.");
        expect(d.loadKg).toBeNull();
        expect(i.trace.params.find((p) => p.param === "loadInstruction")).toMatchObject({ ruleId: "PROGRESSION_TEMPLATES", origin: "RULES_HEURISTIC", reasons: ["PROGRESSION_INTENT:LOAD_FIRST"] });
      }
    const second = generate(intentInput({ progressionIntentByPhase: [text("REPS_THEN_LOAD")] }));
    expect(reps(second.occurrences[0].items[0].dose)!.loadInstruction).toMatch(/Suba as repetições dentro da faixa/);
    const mine = generate(intentInput({
      progressionIntentByPhase: [text("LOAD_FIRST")],
      doseOverrides: [{ patch: { loadInstruction: "Use a carga combinada na avaliação." } }],
    }));
    expect(reps(mine.occurrences[0].items[0].dose)!.loadInstruction).toBe("Use a carga combinada na avaliação.");
  });

  it("HOLD não muda nada; UNDULATING e BLOCKS não são aplicáveis; a descarga nunca existe", () => {
    const t = rules6.rules.PROGRESSION_TEMPLATES!.value;
    expect(t.HOLD.progression).toEqual({ model: "NONE" });
    expect(t.UNDULATING.applied).toBe(false);
    expect(t.BLOCKS.applied).toBe(false);
    for (const [name, template] of Object.entries(t)) expect(template.progression?.deload, name).toBeUndefined();
    const hold = generate(intentInput({ progressionIntentByPhase: [{ phaseIndex: 1, intent: "HOLD", origin: "AI_SUGGESTED", progression: t.HOLD.progression! }] }));
    expect(setsByWeek(hold)).toEqual([3, 3, 3, 3, 3, 3]);
    // Nenhuma semana de uma proposta com intenção chega a zero série (descarga automática seria isto).
    expect(setsByWeek(generate(intentInput())).every((s) => s >= 3)).toBe(true);
  });

  it("regras sem PROGRESSION_TEMPLATES (2026.11.5) ignoram a intenção e a entrada fica igual", () => {
    const withIntent = generate(intentInput({}, V5));
    const i = intentInput({}, V5);
    const without = generate({ ...i, parameters: { ...i.parameters, progressionIntentByPhase: undefined } });
    expect(setsByWeek(withIntent)).toEqual(setsByWeek(without));
  });

  it("2026.11.5 continua igual: nada do 3.2 aparece no traço nem na auditoria", () => {
    const r = generate(xintusInput(V5));
    for (const o of r.occurrences)
      for (const i of o.items) expect(i.trace.params.some((p) => p.changeIf || p.reasons || p.origin || p.profileId)).toBe(false);
    expect(r.audit?.auditVersion).not.toBe("1.2.0");
    expect((r.audit?.findings ?? []).some((f) => /AUDIT_DOSE_(EXERCISE_JUMP|PROFILE_FALLBACK)/.test(f.code))).toBe(false);
  });
});

describe("adaptador: só o que o profissional marcou e a política admite chega ao motor", () => {
  const structureWith = (saved?: WeeklyProgression) => ({
    startDate: "2026-11-09",
    phases: [1, 2, 3].map((index) => ({
      index, name: `Fase ${index}`, weeks: 4, sessionsPerWeek: 2, workouts: [], occurrences: [],
      ...(saved && index === 3 ? { progression: { value: saved, source: "STRUCTURE" as const, basis: "PROFESSIONAL" as const } } : {}),
    })),
  }) as unknown as EngineInput["structure"];
  const answers = (dosing: unknown, over: Record<string, unknown> = {}, source = "AI_SUGGESTED") =>
    ({ progressionByPhase: [], blueprint: { acceptances: [{ source }], workouts: [], dosing }, ...over }) as unknown as GenerationAnswers;
  const dosing = {
    byClass: [{ exerciseClass: "ISOLATION_UPPER", profileCode: "ISOLATION_HIGH_REP" }, { exerciseClass: "CONDITIONING", profileCode: "COMPOUND_HEAVY" }],
    progression: [{ phaseIndex: 1, intent: "VOLUME_RAMP" }, { phaseIndex: 2, intent: "UNDULATING" }, { phaseIndex: 3, intent: "HOLD" }],
  };

  it("sem itens marcados nada chega ao motor", () => {
    expect(doseIntentsOf(answers({ byClass: [], progression: [] }), rules6, structureWith())).toEqual({ doseIntentByClass: [], progressionIntentByPhase: [], issues: [] });
    expect(doseIntentsOf({ progressionByPhase: [] } as unknown as GenerationAnswers, rules6, structureWith()).doseIntentByClass).toEqual([]);
  });

  it("perfil fora da política, intenção só informativa e fase com progressão própria viram aviso explicado; o resto passa", () => {
    const out = doseIntentsOf(answers(dosing, { progressionByPhase: [{ phaseIndex: 3, progression: { model: "NONE" } }] }), rules6, structureWith());
    expect(out.doseIntentByClass).toEqual([{ exerciseClass: "ISOLATION_UPPER", profileCode: "ISOLATION_HIGH_REP", origin: "AI_SUGGESTED" }]);
    expect(out.progressionIntentByPhase.map((p) => [p.phaseIndex, p.intent, p.origin])).toEqual([[1, "VOLUME_RAMP", "AI_SUGGESTED"]]);
    expect(out.progressionIntentByPhase[0].progression).toEqual(rules6.rules.PROGRESSION_TEMPLATES!.value.VOLUME_RAMP.progression);
    const byCode = Object.fromEntries(out.issues.map((i) => [i.code, i]));
    expect(byCode.DOSE_INTENT_REJECTED.message).toMatch(/condicionamento.*não admite/);
    expect(byCode.PROGRESSION_INTENT_NOT_APPLIED.message).toMatch(/Sugestão informativa; defina a progressão da fase para aplicar/);
    expect(byCode.PROGRESSION_INTENT_SUPERSEDED.message).toMatch(/definida por você nesta geração/);
    expect(out.issues.every((i) => i.severity === "INFO" && i.stage === "INPUT")).toBe(true);
  });

  it("progressão gravada na estrutura também vence a intenção", () => {
    const out = doseIntentsOf(answers({ byClass: [], progression: [{ phaseIndex: 3, intent: "VOLUME_RAMP" }] }), rules6, structureWith({ model: "NONE" }));
    expect(out.progressionIntentByPhase).toEqual([]);
    expect(out.issues[0].message).toMatch(/gravada na periodização/);
  });

  it("a origem é da IA só quando o aceite veio da IA; por regras fica como heurística", () => {
    const one = { byClass: [{ exerciseClass: "ISOLATION_UPPER", profileCode: "ISOLATION_HIGH_REP" }], progression: [] };
    expect(doseIntentsOf(answers(one, {}, "RULES_HEURISTIC"), rules6, structureWith()).doseIntentByClass[0].origin).toBe("RULES_HEURISTIC");
  });

  it("regras sem a política (2026.11.5) recusam o pedido de perfil e tratam a progressão como informativa, sem erro", () => {
    const out = doseIntentsOf(answers(dosing), rules5, structureWith());
    expect(out.doseIntentByClass).toEqual([]);
    expect(out.progressionIntentByPhase).toEqual([]);
    expect(out.issues.filter((i) => i.code === "DOSE_INTENT_REJECTED")).toHaveLength(2);
    expect(out.issues.filter((i) => i.code === "PROGRESSION_INTENT_NOT_APPLIED")).toHaveLength(3);
  });
});

describe("histórico real: a progressão só sugere e manda revisar", () => {
  const prescribed: Dose = {
    metric: "REPS", sets: 3, reps: { min: 8, max: 12 }, restSeconds: 90, loadKg: null, loadBasis: "TOTAL", loadInstruction: "",
    intensity: { kind: "RIR", range: { min: 1, max: 3 } },
  } as unknown as Dose;
  const ex = exercise({ id: "ex-1", name: "Supino", primaryMuscles: ["CHEST"], patterns: ["HORIZONTAL_PUSH"], compound: true });
  const log = (date: string, sets: Array<{ reps: number; rir: number }>): ExposureLog => ({
    exerciseId: "ex-1", date, equipmentKey: "bar", metric: "REPS", pain: false,
    sets: sets.map((s) => ({ reps: s.reps, durationSeconds: null, loadKg: 40, loadBasis: "TOTAL", rir: s.rir, completed: true })),
  });
  const settings = { consecutiveSuccesses: 2, maximumIncrementFraction: 0.1, incrementKg: 2, windowDays: 60 };
  const run = (history: ExposureLog[], conditional: boolean) => proposeProgression(history, ex, prescribed, { ...settings, ...(conditional ? { conditional } : {}) }, "2026-11-20");
  const three = (reps: number, rir: number) => [{ reps, rir }, { reps, rir }, { reps, rir }];

  it("RIR registrado abaixo do prescrito em todas as séries: REVIEW com a explicação (com a política)", () => {
    const history = [log("2026-11-10", three(12, 0)), log("2026-11-13", three(12, 0))];
    const r = run(history, true);
    expect(r.action).toBe("REVIEW");
    expect(r.explanation).toMatch(/esforço registrado ficou acima do indicado/);
    expect(r.explanation).toMatch(/RIR menor que o prescrito/);
    expect(r.suggestedLoadKg).toBeNull();
    // Sem a política (regras anteriores) o resultado é o de sempre.
    expect(run(history, false).action).toBe("MAINTAIN");
  });

  it("repetições abaixo da faixa em todas as séries: REVIEW", () => {
    const history = [log("2026-11-10", three(5, 2)), log("2026-11-13", three(6, 2))];
    const r = run(history, true);
    expect(r.action).toBe("REVIEW");
    expect(r.explanation).toMatch(/repetições registradas ficaram abaixo da faixa prescrita \(8–12\)/);
    expect(run(history, false).action).toBe("MAINTAIN");
  });

  it("topo da faixa com o esforço indicado continua sugerindo aumento, e só com o incremento informado", () => {
    const history = [log("2026-11-10", three(12, 2)), log("2026-11-13", three(12, 2))];
    expect(run(history, true)).toMatchObject({ action: "INCREASE", suggestedLoadKg: 42 });
    const noIncrement = proposeProgression(history, ex, prescribed, { ...settings, incrementKg: null, conditional: true }, "2026-11-20");
    expect(noIncrement.action).toBe("MAINTAIN");
    expect(noIncrement.suggestedLoadKg).toBe(40);
  });

  it("dor continua mandando revisar, antes de qualquer outra regra", () => {
    const history = [{ ...log("2026-11-10", three(12, 0)), pain: true }, log("2026-11-13", three(12, 0))];
    expect(run(history, true)).toMatchObject({ action: "REVIEW", explanation: expect.stringMatching(/Dor relatada/) });
  });

  it("sem registros ou com RIR vazio nada é inventado: dados insuficientes", () => {
    expect(run([], true).action).toBe("INSUFFICIENT_DATA");
    const noRir = [log("2026-11-10", three(12, 2)), { ...log("2026-11-13", three(12, 2)), sets: log("2026-11-13", three(12, 2)).sets.map((s) => ({ ...s, rir: null })) }];
    expect(run(noRir, true).action).toBe("INSUFFICIENT_DATA");
  });

  it("na proposta: a sugestão do histórico é só sugestão e nenhuma dose é reescrita", () => {
    const input = baseInput({
      rules: V6,
      structure: structure("2026-11-09", [{ weeks: 2, sessionsPerWeek: 1, stimulus: "HYPERTROPHY", workouts: [{ label: "A", exerciseTarget: 1, focus: { patterns: ["HORIZONTAL_PUSH"] } }] }]),
      history: [
        { ...log("2026-11-01", three(12, 0)), exerciseId: "ex-bench" },
        { ...log("2026-11-03", three(12, 0)), exerciseId: "ex-bench" },
      ],
    });
    const without = generate({ ...input, history: [] });
    const r = generate(input);
    expect(r.historySuggestions?.some((s) => s.proposal.action === "REVIEW")).toBe(true);
    expect(canonicalJson(r.occurrences.map((o) => o.items.map((i) => i.dose)))).toBe(canonicalJson(without.occurrences.map((o) => o.items.map((i) => i.dose))));
  });
});

describe("auditoria de doses por exercício (regras 2026.11.6)", () => {
  const base = (progression?: WeeklyProgression, weeks = 4) => {
    const input = baseInput({
      rules: V6,
      structure: structure("2026-11-09", [{ weeks, sessionsPerWeek: 1, stimulus: "HYPERTROPHY", workouts: [{ label: "A", exerciseTarget: 3, focus: { patterns: ["SQUAT", "HORIZONTAL_PUSH", "ELBOW_FLEXION"] } }] }]),
    });
    return progression ? { ...input, parameters: { ...input.parameters, progressionByPhase: [{ phaseIndex: 1, progression }] } } : input;
  };
  const found = (r: EngineResult, code: string) => (r.audit?.findings ?? []).filter((f) => f.code === code);

  it("a versão da auditoria é 1.2.0 só com as regras que têm AUDIT_DOSE", () => {
    expect(generate(base()).audit?.auditVersion).toBe("1.2.0");
    expect(generate(baseInput({ rules: V5 })).audit?.auditVersion).not.toBe("1.2.0");
  });

  it("salto de +3 séries entre semanas seguidas gera AUDIT_DOSE_EXERCISE_JUMP; do profissional é BY_DESIGN", () => {
    const jump: WeeklyProgression = { model: "CUSTOM", weekOverrides: [{ week: 3, patch: { values: { sets: 6 } } }] };
    const f = found(generate(base(jump)), "AUDIT_DOSE_EXERCISE_JUMP");
    expect(f.length).toBeGreaterThan(0);
    expect(f.every((x) => x.status === "BY_DESIGN" && x.severity === "WARNING")).toBe(true);
    expect(f[0].rationale).toMatch(/3 → 6 séries da semana 2 para a 3/);
    expect(f[0].sourceRefs).toContain("rule:AUDIT_DOSE");
    expect(f[0].suggestedAction).toBeNull();
  });

  it("passo de 1 série não é salto; o mesmo salto vindo de dose sem o profissional é OPEN", () => {
    const calm = generate(base({ model: "STEP", steps: [{ param: "sets", delta: 1, everyWeeks: 1 }] }));
    expect(found(calm, "AUDIT_DOSE_EXERCISE_JUMP")).toEqual([]);
    // Dose que não veio do profissional: o traço do item da semana seguinte não é PROFESSIONAL.
    const input = base();
    const r = generate(input);
    const edited: EngineResult = {
      ...r,
      occurrences: r.occurrences.map((o) => o.week < 3 ? o : {
        ...o, items: o.items.map((i): ItemOut => {
          const d = i.dose as Extract<Dose, { metric: "REPS" }>;
          return { ...i, dose: { ...d, sets: d.sets + 3 } };
        }),
      }),
    };
    const open = found(revalidate(input, edited), "AUDIT_DOSE_EXERCISE_JUMP");
    expect(open.map((f) => f.status)).toEqual(["OPEN"]);
    expect(open[0].suggestedAction).toMatch(/salto é intencional/);
  });

  it("salto grande no descanso (acima da fração) também é reportado", () => {
    const jump: WeeklyProgression = { model: "CUSTOM", weekOverrides: [{ week: 2, patch: { values: { restSeconds: 200 } } }] };
    const f = found(generate(base(jump)), "AUDIT_DOSE_EXERCISE_JUMP");
    expect(f[0].measured?.detail).toMatchObject({ rest: expect.any(Number), limitRest: 0.5 });
    expect(f[0].rationale).toMatch(/s de descanso/);
  });

  it("exercício sem perfil por falta de metadado conta no AUDIT_DOSE_PROFILE_FALLBACK (descritivo)", () => {
    const input = baseInput({
      rules: V6, catalog: [unknownCompound, curl, press],
      structure: structure("2026-11-09", [{ weeks: 2, sessionsPerWeek: 1, stimulus: "HYPERTROPHY", workouts: [{ label: "A", exerciseTarget: 3, focus: { muscles: ["BICEPS", "CHEST"] } }] }]),
    });
    const r = generate(input);
    const ids = r.occurrences[0].items.map((i) => i.exerciseId);
    expect(ids).toContain("t-unk");
    const f = found(r, "AUDIT_DOSE_PROFILE_FALLBACK");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ severity: "INFO", status: "DESCRIPTIVE" });
    expect(f[0].measured?.value).toBe(1);
    expect(f[0].sourceRefs).toEqual(expect.arrayContaining(["rule:DOSE_PROFILES", "rule:AUDIT_DOSE"]));
  });

  it("com perfil em todos os itens não há achado de fallback", () => {
    expect(found(generate(xintusInput(V6)), "AUDIT_DOSE_PROFILE_FALLBACK")).toEqual([]);
  });
});

describe("Xintus: o padrão uniforme antigo não aparece quando há diferença justificada", () => {
  const v5 = generate(xintusInput(V5));
  const v6 = generate(xintusInput(V6));
  const tuples = (r: EngineResult) => new Set(r.occurrences.flatMap((o) => o.items).filter((i) => i.dose?.metric === "REPS").map((i) => tuple(i.dose)));
  const found = (r: EngineResult, code: string) => (r.audit?.findings ?? []).filter((f) => f.code === code);

  it("antes: tudo 8-12 / RIR 1-3 / 90 s; agora: várias doses, cada uma com perfil e motivo", () => {
    expect([...tuples(v5)]).toEqual(["8-12|1-3|90"]);
    expect(tuples(v6).size).toBeGreaterThanOrEqual(3);
    for (const o of v6.occurrences)
      for (const i of o.items.filter((x) => x.dose?.metric === "REPS"))
        for (const param of ["repsMin", "restSeconds"]) {
          const t = i.trace.params.find((p) => p.param === param)!;
          expect(t.ruleId, `${i.exerciseId} ${param}`).toBe("DOSE_PROFILES");
          expect(t.reasons?.length).toBeGreaterThan(0);
          expect(t.changeIf?.length).toBeGreaterThan(10);
        }
  });

  it("a auditoria deixa de apontar dose uniforme em exercícios diferentes", () => {
    expect(found(v5, "AUDIT_DOSE_UNIFORM").length).toBeGreaterThan(0);
    expect(found(v6, "AUDIT_DOSE_UNIFORM")).toEqual([]);
    expect(found(v6, "AUDIT_DOSE_STIMULUS_MISMATCH")).toEqual([]);
  });

  it("os 2→3 séries do Xintus vêm do profissional (progressão da fase 1), não de uma regra uniforme do motor", () => {
    const sets = (r: EngineResult, w: number) => r.occurrences.filter((o) => o.phaseIndex === 1 && o.week === w && o.label === "A").flatMap((o) => o.items.map((i) => reps(i.dose)?.sets));
    expect(new Set(sets(v6, 1))).toEqual(new Set([2]));
    expect(new Set(sets(v6, 3))).toEqual(new Set([3]));
    for (const o of v6.occurrences.filter((x) => x.phaseIndex === 1 && x.week <= 2))
      for (const i of o.items) expect(i.trace.params.find((p) => p.param === "sets")).toMatchObject({ basis: "PROFESSIONAL", changeIf: expect.stringMatching(/profissional/) });
    // As fases 2 e 3 não têm progressão do profissional: nenhuma série sobe sem intenção aceita.
    expect(v6.occurrences.filter((o) => o.phaseIndex > 1).every((o) => o.items.filter((i) => reps(i.dose)).every((i) => reps(i.dose)!.sets === 3))).toBe(true);
  });

  it("com a intenção VOLUME_RAMP aceita nas fases 2 e 3 o degrau vem rotulado como sugestão da estratégia", () => {
    const input = xintusInput(V6);
    const ramp = rules6.rules.PROGRESSION_TEMPLATES!.value.VOLUME_RAMP.progression!;
    const r = generate({
      ...input,
      parameters: { ...input.parameters, progressionIntentByPhase: [2, 3].map((phaseIndex) => ({ phaseIndex, intent: "VOLUME_RAMP", origin: "AI_SUGGESTED" as const, progression: ramp })) },
    });
    const phase2 = r.occurrences.filter((o) => o.phaseIndex === 2 && o.label === "A");
    const first = (w: number) => phase2.find((o) => o.week === w)!.items.find((i) => reps(i.dose))!;
    const setsOf = (w: number) => reps(first(w).dose)!.sets;
    expect([setsOf(1), setsOf(2), setsOf(3), setsOf(4)]).toEqual([3, 3, 4, 4]);
    expect(first(3).trace.params.find((p) => p.param === "sets")).toMatchObject({ origin: "AI_SUGGESTED", ruleId: "PROGRESSION_TEMPLATES" });
    // A fase 1 tem progressão do profissional e não é tocada.
    expect(r.occurrences.filter((o) => o.phaseIndex === 1).map((o) => o.items.map((i) => reps(i.dose)?.sets))).toEqual(v6.occurrences.filter((o) => o.phaseIndex === 1).map((o) => o.items.map((i) => reps(i.dose)?.sets)));
  });

  it("é determinístico e o 'por quê' das quatro perguntas está no traço de cada item", () => {
    expect(canonicalJson(generate(xintusInput(V6)))).toBe(canonicalJson(v6));
    const item = v6.occurrences.find((o) => o.phaseIndex === 2)!.items.find((i) => i.dose?.metric === "REPS")!;
    for (const param of ["sets", "repsMin", "rirMin", "restSeconds"]) {
      const t = item.trace.params.find((p) => p.param === param)!;
      expect(t.ruleId, param).toBeTruthy();
      expect(t.changeIf, param).toBeTruthy();
      expect(t.origin, param).toBeTruthy();
    }
  });
});
