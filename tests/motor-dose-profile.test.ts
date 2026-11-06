/**
 * Política de dose por perfil (Motor V4, PR 3.1; regras gymgital-base@2026.11.6). O que se prova aqui:
 *  - a dose só difere entre exercícios quando um perfil diz por quê (nada decorativo), e cada valor traz perfil e motivos;
 *  - a precedência (linha preservada > ajuste do profissional > perfil > padrão genérico > progressão por último);
 *  - metadado ausente na biblioteca vira incerteza, nunca número chutado; nenhuma carga em quilos, nenhuma série mexida;
 *  - versões anteriores (e o padrão das gerações novas, 2026.11.5) não recebem nada disto.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_RULESET, ENGINE_VERSION, canonicalJson, generate, getRuleSet, renderRulesTable, sha256Hex, validateDose, validateRuleSet,
  type CatalogExercise, type DoseParam, type EngineInput, type ItemOut, type RuleSet,
} from "@/modules/prescricao/motor";
import { RULESETS, OPT_IN_RULESETS, rulesetForNewGeneration, type DoseProfile } from "@/modules/prescricao/motor/rules";
import { RuleLog } from "@/modules/prescricao/motor/trace";
import { resolveDose } from "@/modules/prescricao/motor/dose";
import { classOf, profileFor, profileValues } from "@/modules/prescricao/motor/dose-profile";
import { DOSE_PROFILE_CODES, EXERCISE_CLASSES } from "@/modules/prescricao/motor/types";
import { DOSE_PROFILE_CODES as PLANNER_CODES, EXERCISE_CLASSES as PLANNER_CLASSES } from "@/modules/prescricao/planejador/vocab";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { baseInput, exercise, parameters, structure } from "./helpers/motor-fixtures";
import { xintusInput } from "./helpers/xintus";

const V6 = { id: "gymgital-base", version: "2026.11.6" } as const;
const V5 = { id: "gymgital-base", version: "2026.11.5" } as const;
const rules6 = getRuleSet(V6) as RuleSet;
const profiles = rules6.rules.DOSE_PROFILES!.value;
const byId = (id: string) => profiles.find((p) => p.id === id) as DoseProfile;

const squat = exercise({ id: "t-squat", name: "Agachamento", primaryMuscles: ["QUADRICEPS", "GLUTEUS"], patterns: ["SQUAT"], compound: true, difficulty: 3 });
const press = exercise({ id: "t-press", name: "Supino", primaryMuscles: ["CHEST"], patterns: ["HORIZONTAL_PUSH"], compound: true, difficulty: 2 });
const lunge = exercise({ id: "t-lunge", name: "Afundo", primaryMuscles: ["QUADRICEPS"], patterns: ["LUNGE"], compound: true, difficulty: 2, laterality: "UNILATERAL" });
const curl = exercise({ id: "t-curl", name: "Rosca", primaryMuscles: ["BICEPS"], patterns: ["ELBOW_FLEXION"], compound: false, difficulty: 1 });
const calf = exercise({ id: "t-calf", name: "Panturrilha", primaryMuscles: ["CALVES"], patterns: ["PLANTAR_FLEXION"], compound: false, difficulty: 1 });
const unknownCompound = exercise({ id: "t-unk", name: "Sem metadado", primaryMuscles: ["BICEPS"], patterns: ["ELBOW_FLEXION"], compound: null, difficulty: 1 });

const choose = (e: CatalogExercise, stimulus = "HYPERTROPHY") => profileFor(profiles, e, stimulus, "RESISTANCE", "REPS");

function dose(e: CatalogExercise, over: { stimulus?: string; params?: Partial<EngineInput["parameters"]>; experience?: "BEGINNER" | "INTERMEDIATE" | "ADVANCED" | null; budget?: number | null; rules?: RuleSet; week?: number; progression?: Parameters<typeof resolveDose>[2]["progression"] } = {}) {
  const log = new RuleLog(over.rules ?? rules6);
  return resolveDose(log, parameters(over.params ?? {}), {
    exercise: e, stimulus: over.stimulus ?? "HYPERTROPHY", phaseIndex: 1, label: "A", week: over.week ?? 1, phaseWeeks: 4,
    progression: over.progression ?? null, experience: over.experience ?? null, budgetMinutes: over.budget ?? null,
  });
}

const tupleOf = (i: ItemOut) => {
  const d = i.dose;
  if (!d || d.metric !== "REPS") return "—";
  return `${d.reps.min}-${d.reps.max}|${d.intensity?.kind === "RIR" ? `${d.intensity.range.min}-${d.intensity.range.max}` : ""}|${d.restSeconds}`;
};
const isReps = (i: ItemOut) => i.dose?.metric === "REPS";
const firstWeek = (r: ReturnType<typeof generate>, label: string, phaseIndex = 1) => r.occurrences.find((o) => o.phaseIndex === phaseIndex && o.week === 1 && o.label === label)!.items.filter(isReps);

describe("regras 2026.11.6: o arquivo", () => {
  it("é válido, tem perfis únicos, sem séries, com intervalos coerentes e códigos conhecidos", () => {
    expect(validateRuleSet(rules6)).toEqual([]);
    const ids = profiles.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of profiles) {
      expect(Object.keys(p.values), p.id).not.toContain("sets");
      expect(p.reasons.length, p.id).toBeGreaterThan(0);
      expect(p.changeIf.length, p.id).toBeGreaterThan(20);
      if (p.code) expect(DOSE_PROFILE_CODES).toContain(p.code);
      expect(p.loadInstruction ?? "").not.toMatch(/\bkg\b/i);
    }
    expect(rules6.rules.DOSE_PROFILES!.basis).toBe("HEURISTIC");
    expect(rules6.rules.DOSE_PROFILES!.description).toMatch(/Heurística operacional \(editável\)/);
    expect(rules6.rules.DOSE_PROFILES!.description).toMatch(/Técnico/);
  });

  it("o validador recusa perfil com séries, intervalo invertido, id repetido, exercício em dois perfis e código fora do vocabulário", () => {
    const bad = (mutate: (p: DoseProfile[]) => void): string[] => {
      const clone = JSON.parse(JSON.stringify(rules6)) as RuleSet;
      mutate(clone.rules.DOSE_PROFILES!.value);
      return validateRuleSet(clone);
    };
    expect(bad((p) => { (p[0].values as Record<string, number>).sets = 4; }).join("|")).toMatch(/não define séries/);
    expect(bad((p) => { p[0].values.repsMin = 20; }).join("|")).toMatch(/repsMin > repsMax/);
    expect(bad((p) => { p[1].id = p[0].id; }).join("|")).toMatch(/id repetido/);
    expect(bad((p) => { (p[0].values as Record<string, number>).loadKg = 20; }).join("|")).toMatch(/parâmetro não permitido/);
    expect(bad((p) => { (p[0] as { code: string }).code = "NOPE"; }).join("|")).toMatch(/código desconhecido/);
    expect(bad((p) => { p[0].match.exerciseIds = ["a"]; p[1].match.exerciseIds = ["a"]; }).join("|")).toMatch(/também está no perfil/);
    expect(bad((p) => { p[0].values.rirMax = 11; }).join("|")).toMatch(/acima de 10/);
    expect(bad((p) => { p[0].loadInstruction = "Use 20 kg"; }).join("|")).toMatch(/quilos/);
  });

  it("o hash e a tabela da documentação estão fixados", async () => {
    // Publicada: nunca edite. Mudou um número? Publique a 2026.11.7 e acrescente o hash dela em tests/motor-rules.test.ts.
    expect(await sha256Hex(canonicalJson(rules6))).toBe(HASH_2026_11_6);
    const doc = readFileSync(join(process.cwd(), "docs/MOTOR-PRESCRICAO.md"), "utf8");
    const m = doc.match(/<!-- regras-11-6:inicio -->\n([\s\S]*?)\n<!-- regras-11-6:fim -->/);
    expect(m, "marcadores da tabela 2026.11.6").not.toBeNull();
    expect(m![1].trim()).toBe(renderRulesTable(rules6).trim());
  });

  it("o padrão das gerações novas continua a 2026.11.5; a 2026.11.6 só entra por adesão explícita", () => {
    expect(DEFAULT_RULESET).toEqual(V5);
    expect(OPT_IN_RULESETS).toEqual([V6]);
    expect(rulesetForNewGeneration()).toEqual(V5);
    expect(rulesetForNewGeneration(null)).toEqual(V5);
    expect(rulesetForNewGeneration("2026.11.5")).toEqual(V5);
    expect(rulesetForNewGeneration("2026.11.6")).toEqual(V6);
    for (const old of ["2026.11.1", "2026.11.2", "2026.11.3", "2026.11.4", "2026.11.7", "x"]) expect(rulesetForNewGeneration(old), old).toBeNull();
    expect(Object.keys(RULESETS)).toContain("gymgital-base@2026.11.6");
  });

  it("as listas de classes e códigos do motor são as do planejador", () => {
    expect([...EXERCISE_CLASSES]).toEqual([...PLANNER_CLASSES]);
    expect([...DOSE_PROFILE_CODES]).toEqual([...PLANNER_CODES]);
    const map = rules6.rules.DOSE_CLASS_MAP!.value;
    expect(Object.keys(map).sort()).toEqual([...EXERCISE_CLASSES].sort());
  });

  it("as regras 2026.11.1 a 2026.11.5 não têm a política (o motor segue o caminho antigo)", () => {
    for (const [id, set] of Object.entries(RULESETS)) {
      if (id.endsWith("2026.11.6")) continue;
      expect(set.rules.DOSE_PROFILES, id).toBeUndefined();
      expect(set.rules.DOSE_MODIFIERS, id).toBeUndefined();
    }
    expect(ENGINE_VERSION).toBe("2.4.0");
  });
});

describe("escolha do perfil", () => {
  it.each<[string, CatalogExercise, string, string | null]>([
    ["composto com padrão pesado (agachar)", squat, "HYPERTROPHY", "HYP_COMPOUND_HEAVY"],
    ["composto difícil (dificuldade 3) sem padrão pesado", exercise({ id: "t-row", name: "Remada", patterns: ["HORIZONTAL_PULL"], primaryMuscles: ["LATS"], compound: true, difficulty: 3 }), "HYPERTROPHY", "HYP_COMPOUND_HEAVY"],
    ["composto moderado", press, "HYPERTROPHY", "HYP_COMPOUND_MODERATE"],
    ["composto unilateral", lunge, "HYPERTROPHY", "HYP_UNILATERAL"],
    ["isolamento", curl, "HYPERTROPHY", "HYP_ISOLATION"],
    ["isolamento de região pequena (série mais longa)", calf, "HYPERTROPHY", "HYP_ISOLATION_HIGH_REP"],
    ["força: composto", press, "STRENGTH", "STR_COMPOUND"],
    ["força: acessório", curl, "STRENGTH", "STR_ACCESSORY"],
    ["condicionamento geral: composto", press, "GENERAL_FITNESS", "GF_COMPOUND"],
    ["condicionamento geral: isolamento", curl, "GENERAL_FITNESS", "GF_ISOLATION"],
    ["potência não tem perfil: padrão genérico", press, "POWER", null],
    ["resistência muscular não tem perfil", press, "MUSCULAR_ENDURANCE", null],
  ])("%s", (_name, e, stimulus, expected) => {
    expect(choose(e, stimulus).profile?.id ?? null).toBe(expected);
  });

  it("estímulo sem perfil não é uma incerteza (nada era esperado); cardio e mobilidade ficam fora", () => {
    const power = choose(press, "POWER");
    expect(power.expected).toBe(false);
    expect(power.uncertain).toEqual([]);
    expect(profileFor(profiles, press, "AEROBIC_ENDURANCE", "CARDIO", "CONTINUOUS").expected).toBe(false);
    expect(profileFor(profiles, press, "HYPERTROPHY", "RESISTANCE", "TIME").expected).toBe(false);
  });

  it("mesma classe, mesma dose; classes diferentes, doses diferentes só com perfil diferente", () => {
    const triceps = exercise({ id: "t-tri", name: "Tríceps", primaryMuscles: ["TRICEPS"], patterns: ["ELBOW_EXTENSION"], compound: false, difficulty: 2 });
    expect(dose(curl).dose).toEqual(dose(triceps).dose);
    expect(dose(press).dose).not.toEqual(dose(curl).dose);
    for (const [a, b] of [[press, squat], [curl, calf]] as const) {
      const da = dose(a);
      const db = dose(b);
      if (JSON.stringify(da.dose) !== JSON.stringify(db.dose))
        expect(da.params.find((p) => p.param === "profile")?.value, `${a.id} x ${b.id}`).not.toBe(db.params.find((p) => p.param === "profile")?.value);
    }
  });

  it("especificidade: exercício específico > classe/padrão/músculo > composto/lateralidade; depois mais critérios; depois a ordem", () => {
    const base = (id: string, match: Partial<DoseProfile["match"]>, rest: number): DoseProfile => ({
      id, code: null, match: { stimulus: ["HYPERTROPHY"], modality: "RESISTANCE", metric: "REPS", ...match }, values: { restSeconds: rest }, reasons: ["X"], changeIf: "Muda se o profissional editar a dose.",
    });
    const ordered = [
      base("A_COMPOUND", { compound: true }, 10),
      base("B_COMPOUND_UNI", { compound: true, laterality: "UNILATERAL" }, 20),
      base("C_PATTERN", { patternsAny: ["LUNGE"] }, 30),
      base("D_MUSCLE", { primaryMusclesAny: ["QUADRICEPS"] }, 40),
      base("E_CLASS", { classes: ["COMPOUND_LOWER"] }, 50),
      base("F_ID", { exerciseIds: ["t-lunge"] }, 60),
    ];
    const pick = (list: DoseProfile[], e = lunge) => profileFor(list, e, "HYPERTROPHY", "RESISTANCE", "REPS").profile?.id;
    expect(pick(ordered)).toBe("F_ID");
    expect(pick(ordered.slice(0, 5))).toBe("C_PATTERN"); // padrão, músculo e classe empatam em nível: o de mais critérios é igual; vale a ordem da tabela
    expect(pick([ordered[1], ordered[0]])).toBe("B_COMPOUND_UNI");
    expect(pick([ordered[0], ordered[1]])).toBe("B_COMPOUND_UNI"); // não depende da ordem quando um tem mais critérios
    expect(pick([base("X1", { compound: true }, 1), base("X2", { compound: true }, 2)])).toBe("X1"); // empate total: ordem da tabela
    expect(pick(ordered, press)).toBe("A_COMPOUND");
    expect(pick([base("D", { difficultyMax: 2 }, 1), base("C", { difficultyMin: 3 }, 2)], squat)).toBe("C");
  });

  it("classOf: classes por modalidade, padrão, músculo e composto; composto nulo = OTHER com o metadado que faltou", () => {
    expect(classOf(squat)).toEqual({ cls: "COMPOUND_LOWER", unknown: null });
    expect(classOf(press).cls).toBe("COMPOUND_UPPER_PUSH");
    expect(classOf(exercise({ id: "r", name: "r", patterns: ["VERTICAL_PULL"], primaryMuscles: ["LATS"], compound: true })).cls).toBe("COMPOUND_UPPER_PULL");
    expect(classOf(curl).cls).toBe("ISOLATION_UPPER");
    expect(classOf(calf).cls).toBe("ISOLATION_LOWER");
    expect(classOf(exercise({ id: "p", name: "p", patterns: ["ANTI_EXTENSION"], primaryMuscles: ["ABS"], compound: false })).cls).toBe("CORE");
    expect(classOf(exercise({ id: "c", name: "c", modality: "CARDIO", metric: "CONTINUOUS" })).cls).toBe("CONDITIONING");
    expect(classOf(exercise({ id: "m", name: "m", modality: "MOBILITY" })).cls).toBe("MOBILITY");
    expect(classOf(unknownCompound)).toEqual({ cls: "OTHER", unknown: "compound" });
  });
});

describe("metadado ausente: incerteza, nunca palpite", () => {
  it("composto nulo: padrão genérico, traço METADATA_MISSING e aviso; o número é o do padrão", () => {
    const r = dose(unknownCompound);
    const generic = dose(unknownCompound, { rules: getRuleSet(V5) as RuleSet });
    expect(r.dose).toEqual(generic.dose);
    expect(r.profile).toEqual({ id: null, expected: true, uncertain: ["compound"] });
    expect(r.params.find((p) => p.param === "profile")).toMatchObject({ value: null, reasons: ["METADATA_MISSING:compound"], ruleId: "DOSE_PROFILES" });
    expect(r.params.filter((p) => p.profileId)).toEqual([]);
  });

  it("dificuldade nula num composto sem padrão pesado: usa o perfil confirmado (moderado) e registra o que faltou para o pesado", () => {
    const e = exercise({ id: "t-nd", name: "Sem dificuldade", primaryMuscles: ["CHEST"], patterns: ["HORIZONTAL_PUSH"], compound: true, difficulty: null });
    const c = choose(e);
    expect(c.profile?.id).toBe("HYP_COMPOUND_MODERATE");
    expect(c.uncertain).toEqual(["difficulty"]);
  });

  it("lateralidade nula num composto: o perfil unilateral não é aplicado e o motivo fica registrado", () => {
    const e = exercise({ id: "t-nl", name: "Sem lateralidade", primaryMuscles: ["CHEST"], patterns: ["HORIZONTAL_PUSH"], compound: true, difficulty: 2, laterality: null });
    const c = choose(e);
    expect(c.profile?.id).toBe("HYP_COMPOUND_MODERATE");
    expect(c.uncertain).toEqual(["laterality"]);
  });

  it("sem padrões na biblioteca (lista vazia) não se diz que o exercício não tem o padrão", () => {
    const e = exercise({ id: "t-np", name: "Sem padrão", primaryMuscles: ["CALVES"], patterns: [], compound: false, difficulty: 1 });
    const c = choose(e);
    expect(c.profile?.id).toBe("HYP_ISOLATION");
    expect(c.uncertain).toEqual(["patterns"]);
  });

  it("um aviso por treino, com a contagem de exercícios distintos (e não por semana)", () => {
    const u2 = exercise({ id: "ex-unk2", name: "Sem metadado 2", primaryMuscles: ["TRICEPS"], patterns: ["ELBOW_EXTENSION"], compound: null, difficulty: 1, equipment: [] });
    const u1 = exercise({ id: "ex-unk1", name: "Sem metadado 1", primaryMuscles: ["BICEPS"], patterns: ["ELBOW_FLEXION"], compound: null, difficulty: 1, equipment: [] });
    const input = baseInput({
      rules: V6, catalog: [u1, u2],
      structure: structure("2026-11-09", [{ weeks: 3, sessionsPerWeek: 1, stimulus: "HYPERTROPHY", workouts: [{ label: "A", exerciseTarget: 2 }] }]),
    });
    const r = generate(input);
    const issues = r.issues.filter((i) => i.code === "DOSE_PROFILE_UNCERTAIN");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "INFO", count: 2, label: "A", phaseIndex: 1, path: "phases.1.workouts.A" });
    expect(issues[0].message).toMatch(/Treino A: 2 exercício\(s\) sem metadado/);
    for (const o of r.occurrences) for (const i of o.items) expect(tupleOf(i)).toBe("8-12|1-3|90"); // o padrão genérico, nada inventado
  });
});

describe("precedência", () => {
  it("o padrão genérico fornece as séries; o perfil sobrepõe repetições, RIR e descanso e nunca mexe nas séries", () => {
    const generic = dose(squat, { rules: getRuleSet(V5) as RuleSet });
    const r = dose(squat);
    expect(r.dose).toMatchObject({ metric: "REPS", sets: 3, reps: { min: 6, max: 10 }, restSeconds: 150, intensity: { kind: "RIR", range: { min: 2, max: 3 } } });
    expect(generic.dose).toMatchObject({ sets: 3, reps: { min: 8, max: 12 }, restSeconds: 90 });
    const sets = r.params.find((p) => p.param === "sets")!;
    expect(sets).toMatchObject({ ruleId: "DOSE_DEFAULTS", changeIf: "Muda com a progressão da fase ou se o profissional editar." });
    for (const k of ["repsMin", "repsMax", "rirMin", "rirMax", "restSeconds"] as const)
      expect(r.params.find((p) => p.param === k), k).toMatchObject({ basis: "HEURISTIC", ruleId: "DOSE_PROFILES", profileId: "HYP_COMPOUND_HEAVY", reasons: ["COMPOUND", "HEAVY_PATTERN"], origin: "RULES_HEURISTIC" });
  });

  it("o ajuste do profissional vence o perfil (base PROFESSIONAL), só no parâmetro que ele escreveu", () => {
    const r = dose(squat, { params: { doseOverrides: [{ exerciseId: "t-squat", patch: { values: { restSeconds: 200 } } }] } });
    expect(r.dose).toMatchObject({ restSeconds: 200, reps: { min: 6, max: 10 } });
    expect(r.params.find((p) => p.param === "restSeconds")).toMatchObject({ basis: "PROFESSIONAL" });
    expect(r.params.find((p) => p.param === "repsMin")).toMatchObject({ profileId: "HYP_COMPOUND_HEAVY" });
    // Um ajuste geral (sem exercício) também vence o perfil, e o mais específico vence o geral.
    const both = dose(squat, { params: { doseOverrides: [{ patch: { values: { restSeconds: 100 } } }, { exerciseId: "t-squat", patch: { values: { restSeconds: 70 } } }] } });
    expect(both.dose).toMatchObject({ restSeconds: 70 });
  });

  it("a progressão da fase vence por último, e o traço diz quem definiu o valor final", () => {
    const progression = { value: { model: "STEP" as const, steps: [{ param: "restSeconds" as DoseParam, delta: 15, everyWeeks: 1 }, { param: "sets" as DoseParam, delta: 1, everyWeeks: 2 }] }, source: "STRUCTURE" as const, basis: "PROFESSIONAL" as const };
    const w3 = dose(squat, { progression, week: 3 });
    expect(w3.dose).toMatchObject({ restSeconds: 180, sets: 4 });
    expect(w3.params.find((p) => p.param === "restSeconds")?.profileId).toBeUndefined();
    expect(w3.params.find((p) => p.param === "repsMin")).toMatchObject({ profileId: "HYP_COMPOUND_HEAVY" });
  });

  it("modo 'deixar vazio' do profissional continua vencendo tudo", () => {
    expect(dose(squat, { params: { doseMode: "LEAVE_EMPTY" } }).dose).toBeNull();
  });

  it("linhas preservadas do rascunho e itens travados mantêm a dose gravada (o perfil não as recalcula)", () => {
    const first = generate(baseInput({ rules: V6, structure: structure("2026-11-09", [{ weeks: 2, sessionsPerWeek: 1, stimulus: "HYPERTROPHY", workouts: [{ label: "A", exerciseTarget: 3, focus: { muscles: ["QUADRICEPS"] } }] }]) }));
    const item = first.occurrences[0].items[0];
    const kept = { ...item.dose!, reps: { min: 5, max: 5 } };
    const row = { prescribedExerciseId: "pe-1", phaseIndex: 1, label: "A", exerciseId: item.exerciseId, name: item.exerciseName, position: 1, dose: kept, display: item.display, origin: "PROFESSIONAL" };
    const again = generate(baseInput({ rules: V6, existing: [row], structure: structure("2026-11-09", [{ weeks: 2, sessionsPerWeek: 1, stimulus: "HYPERTROPHY", workouts: [{ label: "A", exerciseTarget: 3, focus: { muscles: ["QUADRICEPS"] } }] }]) }));
    const preserved = again.occurrences[0].items.find((i) => i.existingPrescribedExerciseId === "pe-1")!;
    expect(preserved.dose).toEqual(kept);
    expect(preserved.trace.params).toEqual([]);
  });
});

describe("ajustes por experiência e sessão curta", () => {
  it("iniciante soma 1 ao RIR dos perfis (teto 4) e o traço diz EXPERIENCE_BEGINNER; os demais níveis não mudam", () => {
    const r = dose(press, { experience: "BEGINNER" });
    expect(r.dose).toMatchObject({ intensity: { kind: "RIR", range: { min: 2, max: 4 } } });
    expect(r.params.find((p) => p.param === "rirMin")?.reasons).toEqual(["COMPOUND", "EXPERIENCE_BEGINNER"]);
    expect(r.params.find((p) => p.param === "repsMin")?.reasons).toEqual(["COMPOUND"]);
    expect(dose(press, { experience: "INTERMEDIATE" }).dose).toEqual(dose(press, { experience: null }).dose);
    expect(dose(press, { experience: "ADVANCED" }).dose).toEqual(dose(press).dose);
    // O teto: um perfil já em RIR 3–4 não passa de 4.
    const gf = dose(press, { stimulus: "GENERAL_FITNESS", experience: "BEGINNER" });
    expect(gf.dose).toMatchObject({ intensity: { kind: "RIR", range: { min: 3, max: 4 } } });
  });

  it("o ajuste do iniciante não se aplica ao padrão genérico nem ao que o profissional digitou", () => {
    expect(dose(unknownCompound, { experience: "BEGINNER" }).dose).toEqual(dose(unknownCompound).dose);
    const r = dose(press, { experience: "BEGINNER", params: { doseOverrides: [{ patch: { values: { rirMin: 0, rirMax: 1 } } }] } });
    expect(r.dose).toMatchObject({ intensity: { kind: "RIR", range: { min: 0, max: 1 } } });
  });

  it("sessão curta (≤ 45 min) reduz o descanso do perfil em múltiplos de 5 s com TIME_BUDGET_SHORT; acima disso nada muda", () => {
    const base = dose(squat).dose as { restSeconds: number };
    expect(base.restSeconds).toBe(150);
    const short = dose(squat, { budget: 45 });
    expect((short.dose as { restSeconds: number }).restSeconds).toBe(130);
    expect(short.params.find((p) => p.param === "restSeconds")?.reasons).toEqual(["COMPOUND", "HEAVY_PATTERN", "TIME_BUDGET_SHORT"]);
    for (const e of [squat, press, curl, calf, lunge]) {
      const r = (dose(e, { budget: 30 }).dose as { restSeconds: number }).restSeconds;
      expect(r % 5, e.id).toBe(0);
    }
    expect(dose(squat, { budget: 46 }).dose).toEqual(dose(squat).dose);
    expect(dose(squat, { budget: null }).dose).toEqual(dose(squat).dose);
    expect((dose(squat, { budget: 20, params: { doseOverrides: [{ patch: { values: { restSeconds: 150 } } }] } }).dose as { restSeconds: number }).restSeconds).toBe(150);
  });

  it("profileValues combina os dois ajustes sem tirar o RIR de baixo do mínimo do perfil", () => {
    const { values, reasons } = profileValues(new RuleLog(rules6), byId("HYP_COMPOUND_HEAVY"), { experience: "BEGINNER", budgetMinutes: 40 });
    expect(values).toMatchObject({ rirMin: 3, rirMax: 4, restSeconds: 130 });
    expect(reasons).toEqual({ rirMin: ["EXPERIENCE_BEGINNER"], rirMax: ["EXPERIENCE_BEGINNER"], restSeconds: ["TIME_BUDGET_SHORT"] });
  });
});

describe("proposta completa (Xintus, hipertrofia, 4 sessões de 60 min)", () => {
  const v6 = generate(xintusInput(V6));
  const v5 = generate(xintusInput(V5));

  it("a seleção e as séries são as da 2026.11.5: o perfil só mexe em repetições, RIR e descanso", () => {
    expect(v6.engineVersion).toBe("2.4.0");
    expect(v6.rules).toEqual(V6);
    expect(v6.occurrences).toHaveLength(v5.occurrences.length);
    v6.occurrences.forEach((o, n) => {
      const p = v5.occurrences[n];
      expect(o.items.map((i) => i.exerciseId)).toEqual(p.items.map((i) => i.exerciseId));
      expect(o.items.map((i) => (i.dose && "sets" in i.dose ? i.dose.sets : null))).toEqual(p.items.map((i) => (i.dose && "sets" in i.dose ? i.dose.sets : null)));
    });
  });

  it("a dose difere entre exercícios só quando há perfil diferente; dois exercícios da mesma classe têm a mesma dose", () => {
    for (const o of v6.occurrences) {
      const byProfile = new Map<string, Set<string>>();
      for (const i of o.items.filter(isReps)) {
        const profile = i.trace.params.find((p) => p.param === "profile" && p.profileId)?.profileId ?? "GENERIC";
        (byProfile.get(profile) ?? byProfile.set(profile, new Set()).get(profile)!).add(tupleOf(i));
      }
      for (const [profile, tuples] of byProfile) expect([...tuples], `${profile} em ${o.label}`).toHaveLength(1);
    }
    // E dentro de uma sessão há mais de uma dose diferente (o plano antigo era uniforme).
    const week1 = [...firstWeek(v6, "A"), ...firstWeek(v6, "B")];
    expect(new Set(week1.map(tupleOf)).size).toBeGreaterThanOrEqual(3);
    expect(new Set([...firstWeek(v5, "A"), ...firstWeek(v5, "B")].map(tupleOf))).toEqual(new Set(["8-12|1-3|90"]));
  });

  it("composto pesado descansa 150 s e isolamento 75 s; nenhuma carga em quilos; toda dose é válida e coerente com o texto", () => {
    const heavy = v6.occurrences.flatMap((o) => o.items).filter((i) => i.trace.params.some((p) => p.profileId === "HYP_COMPOUND_HEAVY"));
    const iso = v6.occurrences.flatMap((o) => o.items).filter((i) => i.trace.params.some((p) => p.profileId === "HYP_ISOLATION"));
    expect(heavy.length).toBeGreaterThan(0);
    expect(iso.length).toBeGreaterThan(0);
    for (const i of heavy) expect(tupleOf(i)).toBe("6-10|2-3|150");
    for (const i of iso) expect(tupleOf(i)).toBe("10-15|1-2|75");
    for (const o of v6.occurrences)
      for (const i of o.items) {
        expect(i.dose && "loadKg" in i.dose ? i.dose.loadKg : null).toBeNull();
        expect(validateDose(i.dose!)).toEqual([]);
        if (i.dose?.metric === "REPS") expect(i.display.doseText).toContain(`${i.dose.reps.min}`);
      }
  });

  it("toda dose que difere do padrão genérico tem perfil no traço (nada decorativo) e a duração estimada cabe nos 60 minutos", () => {
    for (const o of v6.occurrences) {
      for (const i of o.items.filter(isReps)) {
        if (tupleOf(i) === "8-12|1-3|90") continue; // igual ao padrão
        expect(i.trace.params.filter((p) => ["repsMin", "repsMax", "rirMin", "rirMax", "restSeconds"].includes(p.param) && p.ruleId === "DOSE_PROFILES").length, `${i.exerciseId} ${tupleOf(i)}`).toBeGreaterThan(0);
      }
      if (o.estimatedMinutes !== null && o.durationComplete) expect(o.estimatedMinutes).toBeLessThanOrEqual(60);
    }
    expect(v6.issues.filter((i) => i.code === "OVER_TIME_BUDGET")).toEqual(v5.issues.filter((i) => i.code === "OVER_TIME_BUDGET"));
  });

  it("a auditoria não ganha achados de dose por causa dos perfis (sem 'dose uniforme' nem 'estímulo fora da faixa')", () => {
    const codes = (r: typeof v6) => (r.audit?.findings ?? []).map((f) => f.code).filter((c) => /DOSE/.test(c));
    expect(codes(v6).filter((c) => c === "AUDIT_DOSE_STIMULUS_MISMATCH")).toEqual([]);
    expect(codes(v6).length).toBeLessThanOrEqual(codes(v5).length);
  });

  it("é determinístico: duas gerações iguais dão o mesmo resultado", () => {
    expect(canonicalJson(generate(xintusInput(V6)))).toBe(canonicalJson(v6));
  });

  it("sem a adesão (padrão), nenhum item recebe perfil nem campo novo no traço", () => {
    const def = generate(xintusInput());
    expect(def.rules).toEqual(V5);
    for (const o of def.occurrences)
      for (const i of o.items) {
        expect(i.trace.params.some((p) => p.param === "profile" || p.profileId || p.reasons || p.changeIf || p.origin)).toBe(false);
        if (isReps(i)) expect(tupleOf(i)).toBe("8-12|1-3|90");
      }
    expect(def.issues.some((i) => i.code === "DOSE_PROFILE_UNCERTAIN")).toBe(false);
  });

  it("o iniciante na 2026.11.6 recebe RIR um ponto acima nos perfis; a sessão curta encurta o descanso", () => {
    const beginner = generate(xintusInput(V6, { student: { ...xintusInput(V6).student, level: { value: "Iniciante", source: "PROFILE", basis: "STUDENT_DATA" } } }));
    const heavy = beginner.occurrences.flatMap((o) => o.items).find((i) => i.trace.params.some((p) => p.profileId === "HYP_COMPOUND_HEAVY"))!;
    expect(tupleOf(heavy)).toBe("6-10|3-4|150");
    const short = generate(xintusInput(V6, { parameters: { ...xintusInput(V6).parameters, availableMinutes: 40 } }));
    const normal = v6.occurrences.flatMap((o) => o.items);
    const shortItems = short.occurrences.flatMap((o) => o.items);
    expect(shortItems.length).toBeGreaterThan(0);
    for (const i of shortItems) {
      const rest = (i.dose as { restSeconds: number }).restSeconds;
      expect(rest % 5).toBe(0);
      if (i.trace.params.some((p) => p.profileId)) expect(i.trace.params.find((p) => p.param === "restSeconds")?.reasons).toContain("TIME_BUDGET_SHORT");
      else expect(rest).toBe(90);
    }
    const maxRest = (list: ItemOut[]) => Math.max(...list.map((i) => (i.dose as { restSeconds: number }).restSeconds));
    expect(maxRest(shortItems)).toBeLessThan(maxRest(normal));
  });
});

const HASH_2026_11_6 = "eb21d47c58c406c878ac90e16995ef5b141acf12c4b8ffcd0cf23db5e2383e0e";
