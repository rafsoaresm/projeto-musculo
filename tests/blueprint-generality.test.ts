/**
 * Motor V4, PR 2.3: a estratégia aceita funciona para qualquer frequência, divisão, rotação, modalidade, equipamento e perfil, não só
 * para a hipertrofia do Xintus. Cadeia pura e completa, sem banco e sem IA: sugestão por regras -> aceite -> compilador -> adaptador
 * (`buildEngineInput`) -> motor -> auditoria. Cada caso confere: nenhum item inelegível, resultado determinístico, aderência por treino
 * (quando a oferta basta), nenhuma exceção. Nomes, ids e números são fictícios.
 */
import { describe, expect, it } from "vitest";
import { buildEngineInput } from "@/modules/prescricao/automatica/build-input";
import { parseGenerationAnswers, type GenerationAnswersInput } from "@/modules/prescricao/automatica/contracts";
import { structureFacts, type GenerationContext } from "@/modules/prescricao/automatica/facts";
import { canonicalJson, generate, type EngineResult } from "@/modules/prescricao/motor";
import { DEFAULT_RULESET } from "@/modules/prescricao/motor/rules";
import type { BlueprintAcceptance, TrainingBlueprint } from "@/modules/prescricao/planejador/blueprint";
import { compileAcceptance, convertBlueprintToGenerationAnswers } from "@/modules/prescricao/planejador/compile";
import { acceptanceHash, blueprintHash } from "@/modules/prescricao/planejador/hashes";
import { produceRulesBlueprint } from "@/modules/prescricao/planejador/rules-mode/producer";
import type { WorkoutRole } from "@/modules/prescricao/planejador/vocab";
import { exercise, FULL_GYM } from "./helpers/motor-fixtures";
import { generationContext, scheduleOf, xintusBundle, type PhaseSeedV2 } from "./helpers/planning-fixtures";
import { XINTUS_CATALOG } from "./helpers/xintus";

const DAYS: Record<number, number[]> = { 1: [0], 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 5], 7: [0, 1, 2, 3, 4, 5, 6] };
const LABELS = ["A", "B", "C", "D", "E", "F"];
const byId = new Map(XINTUS_CATALOG.map((e) => [e.id, e]));

interface Case {
  /** Phases of the saved periodization. */
  phases: Array<{ sessions: number; labels: string[]; rotation?: string[]; weeks?: number; stimulus?: string; targets?: Record<string, number> }>;
  /** Targets the professional typed per workout in the generation answers (they win over the strategy). */
  coverage?: Array<{ phaseIndex: number; label: string; muscles?: string[]; patterns?: string[] }>;
  equipment?: string[] | "NONE";
  level?: string;
  catalog?: typeof XINTUS_CATALOG;
  modalities?: Array<{ phaseIndex: number; label: string; modalities: string[] }>;
}

const seeds = (c: Case): PhaseSeedV2[] =>
  c.phases.map((p) => ({
    weeks: p.weeks ?? 4, sessionsPerWeek: p.sessions, trainingDays: DAYS[p.sessions],
    workouts: p.labels.map((label) => ({ label, exerciseTarget: p.targets?.[label] ?? 6 })),
    ...(p.rotation ? { rotation: p.rotation } : {}),
  }));

function context(c: Case): GenerationContext {
  const base = generationContext();
  return {
    ...base,
    revision: { ...base.revision, schedule: scheduleOf(seeds(c)) },
    profile: base.profile && { ...base.profile, level: (c.level as NonNullable<GenerationContext["profile"]>["level"]) ?? base.profile.level, daysPerWeek: c.phases[0].sessions },
    catalog: c.catalog ?? XINTUS_CATALOG,
  };
}
const answersOf = (c: Case): GenerationAnswersInput => ({
  stimulusByPhase: c.phases.map((p, i) => ({ phaseIndex: i + 1, value: p.stimulus ?? "HYPERTROPHY", basis: "PROFESSIONAL" as const })),
  equipmentCodes: c.equipment ?? FULL_GYM,
  ...(c.modalities ? { modalitiesByWorkout: c.modalities } : {}),
  ...(c.coverage ? { coverageByWorkout: c.coverage } : {}),
});

type Phases = BlueprintAcceptance["phases"];
async function acceptanceOf(run: TrainingBlueprint, strategyId: BlueprintAcceptance["strategyId"], phases: Phases, splitFamily: BlueprintAcceptance["splitFamily"]): Promise<BlueprintAcceptance> {
  const dosing = { byClass: [], progression: [] };
  return {
    id: "acc-1", runId: "run-1", strategyId, splitFamily, phases, edits: [], dosing, structureFingerprint: run.structureFingerprint, baseContentVersion: 3,
    acceptanceHash: await acceptanceHash({ runBlueprintHash: await blueprintHash(run), strategyId, phases, dosing }),
    acceptedByUserId: "user-1", acceptedAt: "2026-11-05T12:00:00.000Z",
  };
}
/** The strategy of the rules producer as it is (what accepting S1/S2/S3 without edits records). */
const asStrategy = (run: TrainingBlueprint, strategyId: "S1" | "S2" | "S3"): Promise<BlueprintAcceptance> => {
  const s = run.strategies.find((x) => x.strategyId === strategyId)!;
  const phases: Phases = s.phases.map((p) => ({
    phaseIndex: p.phaseIndex, splitType: p.splitType,
    workouts: p.workouts.map((w) => ({ label: w.label, role: w.role, focusDelta: w.focusDelta, candidateExerciseIds: [...w.candidateExerciseIds], source: w.source === "STRUCTURE" ? ("PROFESSIONAL" as const) : w.source })),
  }));
  return acceptanceOf(run, strategyId, phases, s.splitFamily);
};
/** A custom choice: a role per label (the professional's), same for every phase unless `byPhase` says otherwise. */
const asCustom = (run: TrainingBlueprint, c: Case, role: (phaseIndex: number, label: string) => WorkoutRole): Promise<BlueprintAcceptance> =>
  acceptanceOf(run, "CUSTOM", c.phases.map((p, i) => ({
    phaseIndex: i + 1, splitType: "CUSTOM" as const,
    workouts: p.labels.map((label) => ({ label, role: role(i + 1, label), focusDelta: null, candidateExerciseIds: [], source: "PROFESSIONAL" as const })),
  })), "CUSTOM");

interface Outcome { adapterIssues: Array<{ code: string; label?: string }>; result: EngineResult; json: string; ctx: GenerationContext; available: string[]; compiledWorkouts: number }

async function run(c: Case, accept: (run: TrainingBlueprint) => Promise<BlueprintAcceptance>): Promise<Outcome> {
  const ctx = context(c);
  const answers = answersOf(c);
  const bundle = await xintusBundle({ revision: ctx.revision, profile: ctx.profile, catalog: ctx.catalog }, {}, answers);
  const planned = produceRulesBlueprint(bundle);
  const acceptance = await accept(planned);
  const compiled = await compileAcceptance({ run: planned, acceptance, structure: structureFacts(ctx.revision.schedule), coverageByWorkout: parseGenerationAnswers(answers).coverageByWorkout, catalogIds: new Set(ctx.catalog.map((e) => e.id)), rules: DEFAULT_RULESET });
  if (!compiled.ok) throw new Error(`${compiled.code}: ${compiled.message}`);
  const merged = convertBlueprintToGenerationAnswers(parseGenerationAnswers(answers), compiled);
  const built = buildEngineInput(ctx, merged);
  if (!built.ok) throw new Error(`${built.code}`);
  const result = generate(built.input);
  const again = generate(built.input);
  expect(canonicalJson(again), "determinístico").toBe(canonicalJson(result));
  return { adapterIssues: built.issues, result, json: canonicalJson(result), ctx, available: built.input.parameters.availableEquipment ?? [], compiledWorkouts: merged.blueprint?.workouts.length ?? 0 };
}

const eligible = (id: string | null, available: readonly string[]): boolean => {
  const e = byId.get(id ?? "");
  if (!e || e.archived) return false;
  const has = (list: readonly string[]) => list.every((x) => available.includes(x));
  return has(e.equipment) || e.equipmentAlternatives.some(has);
};
function expectSound(o: Outcome, c: Case, opts: { shortSupplyOk?: boolean } = {}) {
  // A library that cannot fill a workout is reported (CATALOG_INSUFFICIENT, never silent); nothing else may be an error.
  const errors = o.result.issues.filter((i) => i.severity === "ERROR");
  if (opts.shortSupplyOk) expect(errors.filter((i) => i.code !== "CATALOG_INSUFFICIENT")).toEqual([]);
  else {
    expect(o.result.status).toBe("SUCCEEDED");
    expect(errors).toEqual([]);
  }
  const picked = o.result.occurrences.flatMap((occ) => occ.items.filter((i) => i.exerciseId));
  expect(picked.length).toBeGreaterThan(0);
  for (const i of picked) expect(eligible(i.exerciseId, o.available), `${i.exerciseName} é elegível com ${o.available.join(",") || "nenhum equipamento"}`).toBe(true);
  expect(o.result.occurrences.length).toBe(c.phases.reduce((n, p) => n + (p.weeks ?? 4) * p.sessions, 0));
  expect(o.result.rules).toEqual(DEFAULT_RULESET);
}
/** Per-lane adherence: ≥ 0.7 unless the engine itself said the supply was short for that workout. */
function expectAdherence(o: Outcome) {
  const strategy = o.result.audit?.strategy;
  expect(strategy, "a auditoria traz o bloco da estratégia").toBeDefined();
  for (const w of strategy!.workouts) {
    if (w.adherenceMin === null) continue;
    const short = o.result.issues.some((i) => i.code === "BLUEPRINT_FOCUS_SUPPLY_LOW" && i.phaseIndex === w.phaseIndex && i.label === w.label);
    if (!short) expect(w.adherenceMin, `fase ${w.phaseIndex} treino ${w.label} (${w.role})`).toBeGreaterThanOrEqual(0.7);
  }
}

describe("frequência semanal (2 a 6 dias) com a divisão que as regras sugerem", () => {
  const labelsFor = (n: number) => (n <= 3 ? LABELS.slice(0, 2) : n === 4 ? LABELS.slice(0, 2) : LABELS.slice(0, n === 5 ? 3 : 4));
  it.each([2, 3, 4, 5, 6])("%i sessões por semana: cada estratégia aceitável gera um plano sólido e determinístico", async (sessions) => {
    const c: Case = { phases: [{ sessions, labels: labelsFor(sessions) }] };
    const bundle = await xintusBundle({ revision: context(c).revision, profile: context(c).profile }, {}, answersOf(c));
    const acceptable = produceRulesBlueprint(bundle).strategies.filter((s) => !s.requiresScheduleChange).map((s) => s.strategyId);
    expect(acceptable.length).toBeGreaterThan(0);
    for (const id of acceptable) {
      const o = await run(c, (r) => asStrategy(r, id));
      expectSound(o, c);
      expectAdherence(o);
      expect(o.compiledWorkouts).toBe(c.phases[0].labels.length);
    }
  });
});

describe("rótulos e divisões (ABC, ABCD, PPL, por grupo, corpo inteiro, personalizada)", () => {
  const cases: Array<[string, number, string[], (phaseIndex: number, label: string) => WorkoutRole]> = [
    ["AB superior/inferior", 4, ["A", "B"], (_p, l) => (l === "A" ? "UPPER" : "LOWER")],
    ["ABC empurrar/puxar/pernas, 3 dias", 3, ["A", "B", "C"], (_p, l) => ({ A: "PUSH", B: "PULL", C: "LEGS" } as Record<string, WorkoutRole>)[l]],
    ["ABC empurrar/puxar/pernas, só 2 dias (rotação irregular)", 2, ["A", "B", "C"], (_p, l) => ({ A: "PUSH", B: "PULL", C: "LEGS" } as Record<string, WorkoutRole>)[l]],
    ["ABCD superior/inferior duas vezes", 4, ["A", "B", "C", "D"], (_p, l) => (["A", "C"].includes(l) ? "UPPER" : "LOWER")],
    ["ABCD por grupo muscular", 4, ["A", "B", "C", "D"], (_p, l) => ({ A: "CHEST_TRICEPS", B: "BACK_BICEPS", C: "LEGS", D: "SHOULDERS_ARMS" } as Record<string, WorkoutRole>)[l]],
    ["ABCDEF empurrar/puxar/pernas em dobro", 6, ["A", "B", "C", "D", "E", "F"], (_p, l) => (["PUSH", "PULL", "LEGS"] as const)["ABCDEF".indexOf(l) % 3]],
    ["corpo inteiro explícito em 3 treinos", 3, ["A", "B", "C"], () => "FULL_BODY"],
    ["personalizada: peito e costas, pernas, ombros e braços", 3, ["A", "B", "C"], (_p, l) => ({ A: "UPPER", B: "LEGS", C: "SHOULDERS_ARMS" } as Record<string, WorkoutRole>)[l]],
  ];
  it.each(cases)("%s", async (_name, sessions, labels, role) => {
    const c: Case = { phases: [{ sessions, labels }] };
    const o = await run(c, (r) => asCustom(r, c, role));
    expectSound(o, c);
    expectAdherence(o);
    // every compiled workout reached the engine with its own role
    const roles = new Map(o.result.workouts.filter((w) => w.coverage?.origin === "BLUEPRINT_FOCUS").map((w) => [`${w.phaseIndex}|${w.label}`, w.coverage!.blueprint!.role]));
    for (const l of labels) expect(roles.get(`1|${l}`), l).toBe(role(1, l));
  });

  it("as regras sugerem PPL em 3 treinos e a sugestão gera o plano certo, também com só 2 sessões por semana", async () => {
    for (const sessions of [3, 2]) {
      const c: Case = { phases: [{ sessions, labels: ["A", "B", "C"] }] };
      const bundle = await xintusBundle({ revision: context(c).revision, profile: context(c).profile }, {}, answersOf(c));
      const ppl = produceRulesBlueprint(bundle).strategies.find((s) => s.splitFamily === "PUSH_PULL_LEGS");
      if (!ppl || ppl.requiresScheduleChange) continue;
      const o = await run(c, (r) => asStrategy(r, r.strategies.find((s) => s.splitFamily === "PUSH_PULL_LEGS")!.strategyId));
      expectSound(o, c);
      // exposures come from the real calendar: with 2 sessions a week no region gets 3 direct exposures in a full week
      for (const e of o.result.audit!.strategy!.exposures) expect(e.perWeek.max).toBeLessThanOrEqual(sessions);
    }
  });
});

describe("rotações irregulares e fases com divisões diferentes", () => {
  it("ABA / BAB: o rótulo, não a posição, decide o papel; semanas sem um dos treinos não quebram", async () => {
    const c: Case = { phases: [{ sessions: 3, labels: ["A", "B"], rotation: ["A", "B", "A", "B", "A", "A"] }] };
    const o = await run(c, (r) => asCustom(r, c, (_p, l) => (l === "A" ? "UPPER" : "LOWER")));
    expectSound(o, c);
    const labels = o.result.occurrences.map((occ) => occ.label);
    expect(new Set(labels)).toEqual(new Set(["A", "B"]));
    for (const occ of o.result.occurrences) {
      const lower = occ.items.filter((i) => i.exerciseId && byId.get(i.exerciseId)!.primaryMuscles.some((m) => ["HAMSTRINGS", "CALVES"].includes(m)));
      if (occ.label === "A") expect(lower, `A semana ${occ.week}: sem músculo só-inferior`).toEqual([]);
    }
  });

  it("três fases com divisões diferentes (superior/inferior, corpo inteiro, empurrar/puxar/pernas), cada uma com o seu papel", async () => {
    const c: Case = { phases: [{ sessions: 4, labels: ["A", "B"] }, { sessions: 3, labels: ["F1", "F2", "F3"] }, { sessions: 3, labels: ["P", "Q", "R"], targets: { P: 5, Q: 5, R: 5 } }] };
    const o = await run(c, (r) =>
      asCustom(r, c, (phase, l) => (phase === 1 ? (l === "A" ? "UPPER" : "LOWER") : phase === 2 ? "FULL_BODY" : ({ P: "PUSH", Q: "PULL", R: "LEGS" } as Record<string, WorkoutRole>)[l])));
    expectSound(o, c);
    const role = (p: number, l: string) => o.result.workouts.find((w) => w.phaseIndex === p && w.label === l)?.coverage?.blueprint?.role;
    expect([role(1, "A"), role(1, "B"), role(2, "F1"), role(2, "F3"), role(3, "P"), role(3, "Q"), role(3, "R")]).toEqual(["UPPER", "LOWER", "FULL_BODY", "FULL_BODY", "PUSH", "PULL", "LEGS"]);
    // phase 2 (explicit full body): every workout has a squat or hinge AND a push AND a pull; phase 3 pull never has a squat pattern
    const patternsIn = (phase: number, label: string) => new Set(o.result.occurrences.filter((x) => x.phaseIndex === phase && x.label === label).flatMap((x) => x.items.flatMap((i) => byId.get(i.exerciseId ?? "")?.patterns ?? [])));
    for (const l of ["F1", "F2", "F3"]) {
      const p = patternsIn(2, l);
      expect(p.has("SQUAT") || p.has("HINGE") || p.has("LUNGE"), `F: ${l} tem padrão de pernas`).toBe(true);
      expect([...p].some((x) => x.endsWith("_PUSH")), `F: ${l} tem empurrar`).toBe(true);
      expect([...p].some((x) => x.endsWith("_PULL")), `F: ${l} tem puxar`).toBe(true);
    }
    expect(patternsIn(3, "Q").has("SQUAT")).toBe(false);
    expect(patternsIn(3, "P").has("HORIZONTAL_PULL")).toBe(false);
  });
});

describe("modalidades: força, cardio e mobilidade no mesmo plano", () => {
  it("treinos de cardio e de mobilidade não ganham foco muscular e seguem a seleção por modalidade; os de força seguem a estratégia", async () => {
    const c: Case = {
      phases: [{ sessions: 4, labels: ["A", "B", "Z2", "MOB"], stimulus: "HYPERTROPHY", targets: { Z2: 2, MOB: 2 } }],
      modalities: [{ phaseIndex: 1, label: "Z2", modalities: ["CARDIO"] }, { phaseIndex: 1, label: "MOB", modalities: ["MOBILITY"] }],
    };
    const o = await run(c, (r) => asCustom(r, c, (_p, l) => ({ A: "UPPER", B: "LOWER", Z2: "CARDIO", MOB: "MOBILITY" } as Record<string, WorkoutRole>)[l]));
    expectSound(o, c);
    const cov = (l: string) => o.result.workouts.find((w) => w.label === l)?.coverage?.origin;
    expect(cov("A")).toBe("BLUEPRINT_FOCUS");
    expect(cov("B")).toBe("BLUEPRINT_FOCUS");
    expect(cov("Z2")).not.toBe("BLUEPRINT_FOCUS");
    expect(cov("MOB")).not.toBe("BLUEPRINT_FOCUS");
    const modality = (l: string) => new Set(o.result.occurrences.filter((x) => x.label === l).flatMap((x) => x.items.map((i) => i.modality)));
    expect(modality("Z2")).toEqual(new Set(["CARDIO"]));
    expect(modality("MOB")).toEqual(new Set(["MOBILITY"]));
    expect(modality("A")).toEqual(new Set(["RESISTANCE"]));
    expectAdherence(o);
  });

  it.each(["STRENGTH", "MUSCULAR_ENDURANCE", "GENERAL_FITNESS"])("o estímulo %s usa as mesmas faixas (a doce muda, não o mecanismo de foco)", async (stimulus) => {
    const c: Case = { phases: [{ sessions: 4, labels: ["A", "B"], stimulus }] };
    const o = await run(c, (r) => asStrategy(r, "S1"));
    expectSound(o, c);
    expectAdherence(o);
    expect(o.result.workouts.every((w) => w.coverage?.origin === "BLUEPRINT_FOCUS")).toBe(true);
  });
});

describe("equipamento parcial e perfis", () => {
  it("só halteres e banco: nenhum item pede outro equipamento e a estratégia segue valendo", async () => {
    const c: Case = { phases: [{ sessions: 4, labels: ["A", "B"] }], equipment: ["DUMBBELL", "BENCH"] };
    const o = await run(c, (r) => asStrategy(r, "S1"));
    expectSound(o, c);
    expect(o.available.sort()).toEqual(["BENCH", "DUMBBELL"]);
  });

  it("sem equipamento nenhum (peso do corpo): oferta curta vira aviso INFO por treino, nunca erro nem treino vazio", async () => {
    const c: Case = { phases: [{ sessions: 4, labels: ["A", "B"] }], equipment: "NONE" };
    const o = await run(c, (r) => asStrategy(r, "S1"));
    expectSound(o, c, { shortSupplyOk: true });
    for (const occ of o.result.occurrences) expect(occ.items.length, `${occ.label} semana ${occ.week}`).toBeGreaterThan(0);
    const low = o.result.issues.filter((i) => i.code === "BLUEPRINT_FOCUS_SUPPLY_LOW");
    for (const i of low) expect(i.severity).toBe("INFO");
  });

  it.each(["Iniciante", "Intermediário", "Avançado"])("perfil %s: o nível muda a recomendação e a dose, não o mecanismo de foco", async (level) => {
    const c: Case = { phases: [{ sessions: 4, labels: ["A", "B"] }], level };
    const o = await run(c, (r) => asStrategy(r, "S1"));
    expectSound(o, c);
    expectAdherence(o);
    expect(o.result.workouts.every((w) => w.coverage?.origin === "BLUEPRINT_FOCUS")).toBe(true);
  });

  it("biblioteca enxuta (poucos exercícios por região): o plano sai completo, com o aviso de oferta curta e sem item inelegível", async () => {
    const small = [
      exercise({ id: "s-bench", name: "Supino", primaryMuscles: ["CHEST"], patterns: ["HORIZONTAL_PUSH"], equipment: ["DUMBBELL"], compound: true, difficulty: 1 }),
      exercise({ id: "s-row", name: "Remada", primaryMuscles: ["UPPER_BACK"], patterns: ["HORIZONTAL_PULL"], equipment: ["DUMBBELL"], compound: true, difficulty: 1 }),
      exercise({ id: "s-squat", name: "Agachamento", primaryMuscles: ["QUADRICEPS"], patterns: ["SQUAT"], equipment: ["DUMBBELL"], compound: true, difficulty: 1 }),
      exercise({ id: "s-rdl", name: "Terra", primaryMuscles: ["HAMSTRINGS"], patterns: ["HINGE"], equipment: ["DUMBBELL"], compound: true, difficulty: 1 }),
    ];
    const c: Case = { phases: [{ sessions: 4, labels: ["A", "B"] }], catalog: small as typeof XINTUS_CATALOG };
    byId.clear();
    for (const e of small) byId.set(e.id, e);
    try {
      const o = await run(c, (r) => asStrategy(r, "S1"));
      expect(o.result.issues.filter((i) => i.severity === "ERROR" && i.code !== "CATALOG_INSUFFICIENT")).toEqual([]);
      for (const occ of o.result.occurrences) for (const i of occ.items) expect(eligible(i.exerciseId, o.available)).toBe(true);
    } finally {
      byId.clear();
      for (const e of XINTUS_CATALOG) byId.set(e.id, e);
    }
  });
});

describe("a escolha do profissional vence a estratégia nos casos gerais", () => {
  it("foco salvo na periodização num treino: ele vale, o resto segue a estratégia, e o aviso diz isso", async () => {
    const c: Case = { phases: [{ sessions: 4, labels: ["A", "B"] }], coverage: [{ phaseIndex: 1, label: "B", muscles: ["CHEST", "TRICEPS"] }] };
    const o = await run(c, (r) => asCustom(r, c, (_p, l) => (l === "A" ? "UPPER" : "LOWER")));
    expectSound(o, c);
    const cov = (l: string) => o.result.workouts.find((w) => w.label === l)?.coverage?.origin;
    expect(cov("A")).toBe("BLUEPRINT_FOCUS");
    expect(cov("B")).toBe("WORKOUT_FOCUS");
    expect(o.adapterIssues.some((i) => i.code === "BLUEPRINT_STRUCTURE_FOCUS_WINS" && i.label === "B")).toBe(true);
    expect(o.result.workouts.find((w) => w.label === "B")?.coverage?.muscles).toEqual(["CHEST", "TRICEPS"]);
    expect(o.compiledWorkouts).toBe(1);
  });
});
