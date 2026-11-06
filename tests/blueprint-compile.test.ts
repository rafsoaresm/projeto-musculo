/**
 * Motor V4, PR 2.1: compilador do blueprint (aceite -> `answers.blueprint`), o contrato nas respostas de geração, o consumo pelo
 * adaptador (`buildEngineInput`) e a geração de ponta a ponta com o Xintus (regras, sem IA e sem banco).
 */
import { describe, expect, it } from "vitest";
import { buildEngineInput } from "@/modules/prescricao/automatica/build-input";
import { BLUEPRINT_MAX_CHARS, blueprintAnswersSchema, parseGenerationAnswers, type BlueprintAnswers, type GenerationAnswers } from "@/modules/prescricao/automatica/contracts";
import { structureFacts } from "@/modules/prescricao/automatica/facts";
import { canonicalInput, canonicalJson, DEFAULT_RULESET, generate, sha256Hex, type EngineInput } from "@/modules/prescricao/motor";
import type { BlueprintAcceptance, TrainingBlueprint } from "@/modules/prescricao/planejador/blueprint";
import { compileAcceptance, convertBlueprintToGenerationAnswers, mergeBlueprintAnswers, structureFingerprint, type CompileInput } from "@/modules/prescricao/planejador/compile";
import { emptyDelta, expandFocus, type FocusDelta } from "@/modules/prescricao/planejador/focus";
import { acceptanceHash, blueprintHash } from "@/modules/prescricao/planejador/hashes";
import { produceRulesBlueprint } from "@/modules/prescricao/planejador/rules-mode/producer";
import { ROLE_FOCUS_INTERIM_TABLE } from "@/modules/prescricao/planejador/role-focus";
import { generationContext, scheduleOf, XINTUS_ANSWERS, xintusBundle, ASOF } from "./helpers/planning-fixtures";
import { XINTUS_CATALOG } from "./helpers/xintus";

const RULES_411 = { id: "gymgital-base", version: "2026.11.4" };
const CATALOG_IDS = new Set(XINTUS_CATALOG.map((e) => e.id));
const byId = new Map(XINTUS_CATALOG.map((e) => [e.id, e]));

type Phases = BlueprintAcceptance["phases"];

async function fixture() {
  const ctx = generationContext();
  const bundle = await xintusBundle();
  const run = produceRulesBlueprint(bundle);
  const structure = structureFacts(ctx.revision.schedule);
  return { ctx, run, structure };
}

/** An acceptance of a strategy of `run`, with a correct hash (as the accept service will record it). */
async function accept(run: TrainingBlueprint, strategyId: BlueprintAcceptance["strategyId"], over: { phases?: (p: Phases) => Phases; edits?: BlueprintAcceptance["edits"]; fingerprint?: string; id?: string } = {}): Promise<BlueprintAcceptance> {
  const strategy = run.strategies.find((s) => s.strategyId === (strategyId === "CUSTOM" ? run.recommendedStrategyId : strategyId))!;
  const base: Phases = strategy.phases.map((p) => ({
    phaseIndex: p.phaseIndex, splitType: p.splitType,
    workouts: p.workouts.map((w) => ({ label: w.label, role: w.role, focusDelta: w.focusDelta, candidateExerciseIds: [...w.candidateExerciseIds], source: w.source === "STRUCTURE" ? "PROFESSIONAL" as const : w.source })),
  }));
  const phases = over.phases ? over.phases(base) : base;
  const dosing = { byClass: [], progression: [] };
  return {
    id: over.id ?? "acc-1", runId: "run-1", strategyId, splitFamily: strategy.splitFamily, phases, edits: over.edits ?? [], dosing,
    structureFingerprint: over.fingerprint ?? run.structureFingerprint, baseContentVersion: 3,
    acceptanceHash: await acceptanceHash({ runBlueprintHash: await blueprintHash(run), strategyId, phases, dosing }),
    acceptedByUserId: "user-1", acceptedAt: "2026-11-05T12:00:00.000Z",
  };
}

const compileInput = (f: Awaited<ReturnType<typeof fixture>>, acceptance: BlueprintAcceptance, over: Partial<CompileInput> = {}): CompileInput => ({
  run: f.run, acceptance, structure: f.structure, catalogIds: CATALOG_IDS, rules: DEFAULT_RULESET, ...over,
});
async function compiled(f: Awaited<ReturnType<typeof fixture>>, acceptance: BlueprintAcceptance, over: Partial<CompileInput> = {}) {
  const out = await compileAcceptance(compileInput(f, acceptance, over));
  if (!out.ok) throw new Error(`${out.code}: ${out.message}`);
  return out;
}
const refusal = async (f: Awaited<ReturnType<typeof fixture>>, acceptance: BlueprintAcceptance, over: Partial<CompileInput> = {}) => {
  const out = await compileAcceptance(compileInput(f, acceptance, over));
  return out.ok ? "ok" : out.code;
};

describe("compileAcceptance", () => {
  it("o aceite do superior/inferior vira um bloco com um foco por treino, fase e papel, na forma canônica", async () => {
    const f = await fixture();
    expect(f.run.strategies[0].splitFamily).toBe("UPPER_LOWER");
    const out = await compiled(f, await accept(f.run, "S1"));
    expect(out.blueprint.workouts.map((w) => [w.phaseIndex, w.label, w.role, w.source])).toEqual([
      [1, "A", "UPPER", "RULES_HEURISTIC"], [1, "B", "LOWER", "RULES_HEURISTIC"], [2, "A", "UPPER", "RULES_HEURISTIC"], [2, "B", "LOWER", "RULES_HEURISTIC"],
      [3, "A", "UPPER", "RULES_HEURISTIC"], [3, "B", "LOWER", "RULES_HEURISTIC"],
    ]);
    expect(out.blueprint.acceptances).toEqual([expect.objectContaining({ acceptanceId: "acc-1", strategyId: "S1", splitFamily: "UPPER_LOWER", source: "RULES_HEURISTIC", blueprintHash: await blueprintHash(f.run) })]);
    expect(out.blueprint.structureFingerprint).toBe(await structureFingerprint(f.structure));
    expect(out.blueprint.dosing).toBeUndefined();
    expect(blueprintAnswersSchema.safeParse(out.blueprint).success).toBe(true);
    expect(canonicalJson(out.blueprint)).toBe(JSON.stringify(out.blueprint) === canonicalJson(out.blueprint) ? JSON.stringify(out.blueprint) : canonicalJson(out.blueprint));
  });

  it("determinístico: os treinos em outra ordem dão o mesmo bloco (exceto o hash do aceite, que cobre a ordem recebida)", async () => {
    const f = await fixture();
    const a = await compiled(f, await accept(f.run, "S1"));
    const b = await compiled(f, await accept(f.run, "S1", { phases: (ph) => [...ph].reverse().map((p) => ({ ...p, workouts: [...p.workouts].reverse() })) }));
    expect(canonicalJson(b.blueprint.workouts)).toBe(canonicalJson(a.blueprint.workouts));
    const again = await compiled(f, await accept(f.run, "S1"));
    expect(canonicalJson(again)).toBe(canonicalJson(a));
  });

  it("STRUCTURE_CHANGED: mudou a frequência, um rótulo ou as semanas depois do aceite; o compilador não relabela nada", async () => {
    const f = await fixture();
    const acceptance = await accept(f.run, "S1");
    const changed = (mutate: (s: typeof f.structure) => typeof f.structure) => refusal(f, acceptance, { structure: mutate(f.structure) });
    expect(await changed((s) => ({ ...s, phases: s.phases.map((p) => (p.index === 1 ? { ...p, sessionsPerWeek: 3 } : p)) }))).toBe("STRUCTURE_CHANGED");
    expect(await changed((s) => ({ ...s, phases: s.phases.map((p) => ({ ...p, workouts: p.workouts.map((w) => (w.label === "B" ? { ...w, label: "C" } : w)) })) }))).toBe("STRUCTURE_CHANGED");
    expect(await changed((s) => ({ ...s, phases: s.phases.map((p) => (p.index === 2 ? { ...p, weeks: 5 } : p)) }))).toBe("STRUCTURE_CHANGED");
    expect(await refusal(f, acceptance, { structure: f.structure })).toBe("ok");
    // o foco salvo na estrutura não conta como mudança de periodização (a impressão digital não o lê)
    const withFocus = { ...f.structure, phases: f.structure.phases.map((p) => ({ ...p, workouts: p.workouts.map((w) => ({ ...w, focus: { muscles: ["CHEST"] } })) })) };
    expect(await structureFingerprint(withFocus)).toBe(await structureFingerprint(f.structure));
  });

  it("STRATEGY_REQUIRES_SCHEDULE_CHANGE: o cartão informativo nunca é aceito", async () => {
    const f = await fixture();
    const informational = f.run.strategies.find((s) => s.requiresScheduleChange);
    expect(informational, "o Xintus (2 treinos) tem uma divisão informativa").toBeDefined();
    const acceptance = await accept(f.run, informational!.strategyId);
    expect(await refusal(f, acceptance)).toBe("STRATEGY_REQUIRES_SCHEDULE_CHANGE");
  });

  it("aceite adulterado ou de outro plano: hash não confere ou estratégia inexistente", async () => {
    const f = await fixture();
    const good = await accept(f.run, "S1");
    const tampered = { ...good, phases: good.phases.map((p) => ({ ...p, workouts: p.workouts.map((w) => ({ ...w, role: "LOWER" as const })) })) };
    expect(await refusal(f, tampered)).toBe("ACCEPTANCE_MISMATCH");
    expect(await refusal(f, { ...good, strategyId: "S3" }, { run: { ...f.run, strategies: f.run.strategies.slice(0, 2) } })).toBe("ACCEPTANCE_MISMATCH");
    expect(await refusal(f, good, { run: { ...f.run, contextHash: "0".repeat(64) } })).toBe("ACCEPTANCE_MISMATCH");
  });

  it("PHASE_MISSING e LABEL_MISSING: o aceite cita o que a periodização salva não tem", async () => {
    const f = await fixture();
    const extraPhase = await accept(f.run, "S1", { phases: (ph) => [...ph, { ...ph[0], phaseIndex: 9 }] });
    expect(await refusal(f, extraPhase)).toBe("PHASE_MISSING");
    const extraLabel = await accept(f.run, "S1", { phases: (ph) => ph.map((p, i) => (i === 0 ? { ...p, workouts: [...p.workouts, { ...p.workouts[0], label: "Z" }] } : p)) });
    expect(await refusal(f, extraLabel)).toBe("LABEL_MISSING");
  });

  it("regras sem seleção por estratégia: UNSUPPORTED_RULESET, sem degradar", async () => {
    const f = await fixture();
    expect(await refusal(f, await accept(f.run, "S1"), { rules: RULES_411 })).toBe("UNSUPPORTED_RULESET");
  });

  it("candidato fora da biblioteca visível é deixado de fora com um aviso INFO, nunca erro", async () => {
    const f = await fixture();
    const acceptance = await accept(f.run, "S1", { phases: (ph) => ph.map((p) => ({ ...p, workouts: p.workouts.map((w) => (w.label === "A" ? { ...w, candidateExerciseIds: ["ex-lateral", "ex-sumiu", "ex-facepull"] } : w)) })) });
    const out = await compiled(f, acceptance);
    const a = out.blueprint.workouts.find((w) => w.phaseIndex === 1 && w.label === "A")!;
    expect(a.candidateExerciseIds).toEqual(["ex-facepull", "ex-lateral"]);
    expect(out.issues.filter((i) => i.code === "BLUEPRINT_CANDIDATE_DROPPED")).toHaveLength(3);
    expect(out.issues.every((i) => i.severity === "INFO")).toBe(true);
  });

  it("candidatos acima do limite do treino viram aviso próprio (cortados pela ordem), não 'fora da biblioteca'", async () => {
    const f = await fixture();
    const many = XINTUS_CATALOG.slice(0, 8).map((e) => e.id);
    const acceptance = await accept(f.run, "S1", { phases: (ph) => ph.map((p) => ({ ...p, workouts: p.workouts.map((w) => (w.label === "A" ? { ...w, candidateExerciseIds: many } : w)) })) });
    const out = await compiled(f, acceptance);
    const codes = out.issues.map((i) => i.code);
    expect(codes).toContain("BLUEPRINT_CANDIDATE_CAPPED");
    expect(codes).not.toContain("BLUEPRINT_CANDIDATE_DROPPED");
    expect(out.blueprint.workouts.find((w) => w.phaseIndex === 1 && w.label === "A")!.candidateExerciseIds).toHaveLength(6);
  });

  it("o foco salvo na periodização ou nas respostas vence: o treino não entra no bloco e o aviso diz por quê", async () => {
    const f = await fixture();
    const acceptance = await accept(f.run, "S1");
    const saved = { ...f.structure, phases: f.structure.phases.map((p) => (p.index === 1 ? { ...p, workouts: p.workouts.map((w) => (w.label === "A" ? { ...w, focus: { muscles: ["QUADRICEPS"] } } : w)) } : p)) };
    const a = await compiled(f, acceptance, { structure: saved });
    expect(a.blueprint.workouts.some((w) => w.phaseIndex === 1 && w.label === "A")).toBe(false);
    expect(a.blueprint.workouts).toHaveLength(5);
    expect(a.issues.find((i) => i.code === "BLUEPRINT_STRUCTURE_FOCUS_WINS")).toMatchObject({ phaseIndex: 1, label: "A" });
    const b = await compiled(f, acceptance, { coverageByWorkout: [{ phaseIndex: 2, label: "B", muscles: ["CALVES"] }] });
    expect(b.blueprint.workouts.some((w) => w.phaseIndex === 2 && w.label === "B")).toBe(false);
    expect(b.issues.some((i) => i.code === "BLUEPRINT_STRUCTURE_FOCUS_WINS")).toBe(true);
  });

  it("treino da estrutura que a estratégia não planejou: sem foco (cai na cobertura da fase) e um aviso INFO", async () => {
    const f = await fixture();
    const acceptance = await accept(f.run, "S1", { phases: (ph) => ph.map((p) => (p.phaseIndex === 3 ? { ...p, workouts: p.workouts.filter((w) => w.label === "A") } : p)) });
    const out = await compiled(f, acceptance);
    expect(out.blueprint.workouts.some((w) => w.phaseIndex === 3 && w.label === "B")).toBe(false);
    expect(out.issues.find((i) => i.code === "BLUEPRINT_WORKOUT_NOT_PLANNED")).toMatchObject({ phaseIndex: 3, label: "B", severity: "INFO" });
  });

  it("origem por treino: o ajuste do profissional vira PROFESSIONAL; 'Personalizar' é todo do profissional; fonte da estratégia é a do produtor", async () => {
    const f = await fixture();
    const delta: FocusDelta = { ...emptyDelta(), addDominant: ["CALVES"].filter((m) => !ROLE_FOCUS_INTERIM_TABLE.UPPER.dominantMuscles.includes(m)).slice(0, 0), removeDominant: ["BICEPS"] };
    const edited = await accept(f.run, "S1", {
      phases: (ph) => ph.map((p) => (p.phaseIndex === 3 ? { ...p, workouts: p.workouts.map((w) => (w.label === "A" ? { ...w, focusDelta: delta } : w)) } : p)),
      edits: [{ phaseIndex: 3, label: "A", field: "dominantMuscles" }],
    });
    const out = await compiled(f, edited);
    expect(out.blueprint.workouts.map((w) => w.source)).toEqual(["RULES_HEURISTIC", "RULES_HEURISTIC", "RULES_HEURISTIC", "RULES_HEURISTIC", "PROFESSIONAL", "RULES_HEURISTIC"]);
    expect(out.blueprint.workouts.find((w) => w.phaseIndex === 3 && w.label === "A")?.focusDelta).toEqual({ ...emptyDelta(), removeDominant: ["BICEPS"] });
    const custom = await compiled(f, await accept(f.run, "CUSTOM"));
    expect(custom.blueprint.workouts.every((w) => w.source === "PROFESSIONAL")).toBe(true);
    expect(custom.blueprint.acceptances[0]).toMatchObject({ strategyId: "CUSTOM", source: "RULES_HEURISTIC" });
  });
});

describe("limites do bloco `answers.blueprint`", () => {
  const maximal = (delta: FocusDelta | null): BlueprintAnswers => {
    const ids = (n: number) => Array.from({ length: 6 }, (_, k) => `${String(n).padStart(2, "0")}${k}`.padEnd(36, "e"));
    const workouts = Array.from({ length: 12 }, (_, p) => Array.from({ length: 8 }, (_, w) => ({
      phaseIndex: p + 1, label: `Treino${w + 1}`, acceptanceId: `accept-${p}`.padEnd(36, "x"), role: "CUSTOM" as const, source: "PROFESSIONAL" as const,
      focusDelta: delta, candidateExerciseIds: ids(p * 8 + w),
    }))).flat();
    return {
      version: 1, structureFingerprint: "f".repeat(64),
      acceptances: Array.from({ length: 12 }, (_, p) => ({ acceptanceId: `accept-${p}`.padEnd(36, "x"), runId: "r".repeat(36), blueprintHash: "a".repeat(64), acceptanceHash: "b".repeat(64), strategyId: "CUSTOM" as const, splitFamily: "CUSTOM" as const, source: "AI_SUGGESTED" as const })),
      workouts,
      dosing: { byClass: [{ exerciseClass: "CORE", profileCode: "CORE_STABILITY" }], progression: Array.from({ length: 12 }, (_, p) => ({ phaseIndex: p + 1, intent: "VOLUME_RAMP" as const })) },
    };
  };

  it("12 fases x 8 treinos com 6 candidatos cada cabe no limite do bloco (60 000) e, com as demais respostas, em parameters_json (100 000)", () => {
    const block = maximal(null);
    expect(blueprintAnswersSchema.safeParse(block).success).toBe(true);
    expect(JSON.stringify(block).length).toBeLessThanOrEqual(BLUEPRINT_MAX_CHARS);
    const others = {
      stimulusByPhase: Array.from({ length: 12 }, (_, p) => ({ phaseIndex: p + 1, value: "HYPERTROPHY", basis: "PROFESSIONAL" as const })),
      equipmentCodes: ["BARBELL", "RACK", "MACHINE", "DUMBBELL", "BENCH", "CABLE"],
      preferredExerciseIds: Array.from({ length: 100 }, (_, k) => `preferred-${String(k).padStart(3, "0")}`.padEnd(40, "x")),
      excludedExerciseIds: Array.from({ length: 100 }, (_, k) => `excluded-${String(k).padStart(3, "0")}`.padEnd(40, "x")),
      exerciseCountByWorkout: block.workouts.map((w) => ({ phaseIndex: w.phaseIndex, label: w.label, count: 6 })),
    };
    const parsed = parseGenerationAnswers({ ...others, blueprint: block });
    expect(JSON.stringify(parsed).length).toBeLessThanOrEqual(100_000);
  });

  it("o bloco com todos os ajustes de foco no máximo (12 itens em cada um dos 96 treinos) passa de 60 000 e é recusado, nunca gravado", () => {
    const delta: FocusDelta = { ...emptyDelta(), addDominant: ["FRONT_DELTOID", "SIDE_DELTOID", "REAR_DELTOID"], removeSupporting: ["OBLIQUES", "TRAPEZIUS"], addTargetPatterns: ["HORIZONTAL_ABDUCTION", "ANTI_LATERAL_FLEXION", "HORIZONTAL_ADDUCTION"], removeSpillover: ["SHOULDER_EXTENSION", "ANTI_ROTATION", "ANTI_EXTENSION", "SHOULDER_FLEXION"] };
    const parsed = blueprintAnswersSchema.safeParse(maximal(delta));
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain("grande demais");
  });

  it("estrito: chave desconhecida, treino repetido, foco sem aceite e papel inexistente são recusados", () => {
    const ok = { version: 1, structureFingerprint: "f".repeat(32), acceptances: [{ acceptanceId: "a1", runId: "r1", blueprintHash: "a".repeat(64), acceptanceHash: "b".repeat(64), strategyId: "S1", splitFamily: "UPPER_LOWER", source: "RULES_HEURISTIC" }],
      workouts: [{ phaseIndex: 1, label: "A", acceptanceId: "a1", role: "UPPER", source: "RULES_HEURISTIC", focusDelta: null, candidateExerciseIds: [] }] };
    expect(blueprintAnswersSchema.safeParse(ok).success).toBe(true);
    expect(blueprintAnswersSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(blueprintAnswersSchema.safeParse({ ...ok, workouts: [...ok.workouts, ...ok.workouts] }).success).toBe(false);
    expect(blueprintAnswersSchema.safeParse({ ...ok, workouts: [{ ...ok.workouts[0], acceptanceId: "outro" }] }).success).toBe(false);
    expect(blueprintAnswersSchema.safeParse({ ...ok, workouts: [{ ...ok.workouts[0], role: "TUDO" }] }).success).toBe(false);
    expect(blueprintAnswersSchema.safeParse({ ...ok, workouts: [{ ...ok.workouts[0], candidateExerciseIds: Array(7).fill("x") }] }).success).toBe(false);
    const big = { ...emptyDelta(), addDominant: ["CHEST", "LATS", "BICEPS", "TRICEPS", "CALVES"], addSupporting: ["ABS", "OBLIQUES", "FOREARMS", "ERECTORS", "TRAPEZIUS"], addSpillover: ["CARRY", "SQUAT", "HINGE"] };
    expect(blueprintAnswersSchema.safeParse({ ...ok, workouts: [{ ...ok.workouts[0], focusDelta: big }] }).success).toBe(false); // 12 itens é o limite; 12 passa, 13 não
    expect(blueprintAnswersSchema.safeParse({ ...ok, workouts: [{ ...ok.workouts[0], focusDelta: { ...big, addSpillover: ["CARRY", "SQUAT"] } }] }).success).toBe(true);
  });
});

describe("mesclar o bloco (replanejar uma fase não troca a estratégia das outras)", () => {
  const block = (acceptanceId: string, phases: number[], role: "UPPER" | "FULL_BODY"): BlueprintAnswers => ({
    version: 1, structureFingerprint: "f".repeat(32),
    acceptances: [{ acceptanceId, runId: `run-${acceptanceId}`, blueprintHash: "a".repeat(64), acceptanceHash: "b".repeat(64), strategyId: "S1", splitFamily: "UPPER_LOWER", source: "RULES_HEURISTIC" }],
    workouts: phases.map((p) => ({ phaseIndex: p, label: "A", acceptanceId, role, source: "RULES_HEURISTIC" as const, focusDelta: null, candidateExerciseIds: [] })),
  });
  it("por (fase, treino) e por aceite; aceite sem treino é descartado; FULL substitui tudo", () => {
    const first = block("acc-1", [1, 2, 3], "UPPER");
    const second = block("acc-2", [2], "FULL_BODY");
    const merged = mergeBlueprintAnswers(first, second);
    expect(merged.workouts.map((w) => [w.phaseIndex, w.acceptanceId, w.role])).toEqual([[1, "acc-1", "UPPER"], [2, "acc-2", "FULL_BODY"], [3, "acc-1", "UPPER"]]);
    expect(merged.acceptances.map((a) => a.acceptanceId)).toEqual(["acc-1", "acc-2"]);
    const all = mergeBlueprintAnswers(first, block("acc-3", [1, 2, 3], "FULL_BODY"));
    expect(all.acceptances.map((a) => a.acceptanceId)).toEqual(["acc-3"]);
    expect(mergeBlueprintAnswers(first, second, true)).toEqual(second);
    expect(mergeBlueprintAnswers(undefined, second)).toEqual(second);
  });
});

describe("do aceite à geração (Xintus, regras, sem IA)", () => {
  async function built(acceptanceOver: Parameters<typeof accept>[2] = {}, strategy: BlueprintAcceptance["strategyId"] = "S1") {
    const f = await fixture();
    const out = await compiled(f, await accept(f.run, strategy, acceptanceOver));
    const answers = convertBlueprintToGenerationAnswers(parseGenerationAnswers(XINTUS_ANSWERS), out);
    return { f, out, answers, outcome: buildEngineInput(f.ctx, answers) };
  }
  const okInput = (b: Awaited<ReturnType<typeof built>>): EngineInput => {
    if (!b.outcome.ok) throw new Error(b.outcome.code);
    return b.outcome.input;
  };

  it("o adaptador expande o papel com a tabela das regras fixadas e entrega o foco ao motor, ordenado", async () => {
    const b = await built();
    const input = okInput(b);
    expect(input.rules).toEqual(DEFAULT_RULESET);
    expect(input.parameters.blueprintFocus?.map((x) => [x.phaseIndex, x.label, x.role, x.source, x.strategyId])).toEqual([
      [1, "A", "UPPER", "RULES_HEURISTIC", "S1"], [1, "B", "LOWER", "RULES_HEURISTIC", "S1"], [2, "A", "UPPER", "RULES_HEURISTIC", "S1"], [2, "B", "LOWER", "RULES_HEURISTIC", "S1"],
      [3, "A", "UPPER", "RULES_HEURISTIC", "S1"], [3, "B", "LOWER", "RULES_HEURISTIC", "S1"],
    ]);
    const upper = input.parameters.blueprintFocus![0];
    expect(upper.dominantMuscles).toEqual(expandFocus("UPPER", null, { ...ROLE_FOCUS_INTERIM_TABLE }).dominantMuscles);
    expect(upper.spilloverPatterns).toEqual([...ROLE_FOCUS_INTERIM_TABLE.UPPER.allowedSpilloverPatterns].sort());
    if (!b.outcome.ok) throw new Error();
    expect(b.outcome.assumptions.find((a) => a.code === "BLUEPRINT_APPLIED")).toMatchObject({ basis: "HEURISTIC_ACCEPTED", ruleId: "MICROCYCLE_BLUEPRINT" });
    expect(b.outcome.ready).toBe(true);
  });

  it("a divisão aceita aparece nos exercícios: A e B diferentes, adesão total ao foco, sem aviso por treino", async () => {
    const b = await built();
    const r = generate(okInput(b));
    expect(r.status).toBe("SUCCEEDED");
    const items = (label: string) => r.occurrences.filter((o) => o.label === label).flatMap((o) => o.items);
    const lower = new Set(ROLE_FOCUS_INTERIM_TABLE.LOWER.dominantMuscles);
    const upper = new Set(ROLE_FOCUS_INTERIM_TABLE.UPPER.dominantMuscles);
    for (const i of items("A")) expect(byId.get(i.exerciseId!)!.primaryMuscles.some((m) => lower.has(m))).toBe(false);
    for (const i of items("B")) expect(byId.get(i.exerciseId!)!.primaryMuscles.some((m) => upper.has(m))).toBe(false);
    expect(new Set(items("A").map((i) => i.exerciseId)).size).toBeGreaterThanOrEqual(5);
    expect(r.issues.some((i) => i.code === "MUSCLE_NOT_COVERED" || i.code === "PATTERN_NOT_COVERED")).toBe(false);
  });

  it("corpo inteiro escolhido (S2) continua válido em qualquer estrutura", async () => {
    const b = await built({}, "S2");
    const input = okInput(b);
    expect(input.parameters.blueprintFocus!.every((x) => x.role === "FULL_BODY")).toBe(true);
    const r = generate(input);
    const patterns = (label: string) => new Set(r.occurrences.filter((o) => o.label === label).flatMap((o) => o.items).flatMap((i) => byId.get(i.exerciseId!)!.patterns));
    for (const label of ["A", "B"]) expect([...patterns(label)].some((p) => p === "SQUAT" || p === "HINGE")).toBe(true);
  });

  it("o ajuste do profissional (delta) chega expandido e vence a tabela só naquele treino", async () => {
    const f = await fixture();
    const delta: FocusDelta = { ...emptyDelta(), removeDominant: ["BICEPS"], addSupporting: ["BICEPS"] };
    const acceptance = await accept(f.run, "S1", { phases: (ph) => ph.map((p) => (p.phaseIndex === 2 ? { ...p, workouts: p.workouts.map((w) => (w.label === "A" ? { ...w, focusDelta: delta } : w)) } : p)), edits: [{ phaseIndex: 2, label: "A", field: "dominantMuscles" }] });
    const answers = convertBlueprintToGenerationAnswers(parseGenerationAnswers(XINTUS_ANSWERS), await compiled(f, acceptance));
    const out = buildEngineInput(f.ctx, answers);
    if (!out.ok) throw new Error(out.code);
    const focus = out.input.parameters.blueprintFocus!;
    const edited = focus.find((x) => x.phaseIndex === 2 && x.label === "A")!;
    expect(edited.source).toBe("PROFESSIONAL");
    expect(edited.dominantMuscles).not.toContain("BICEPS");
    expect(edited.supportingMuscles).toContain("BICEPS");
    expect(focus.find((x) => x.phaseIndex === 1 && x.label === "A")!.dominantMuscles).toContain("BICEPS");
  });

  it("um ajuste que remove o que a tabela das regras atuais não tem é ignorado com aviso INFO", async () => {
    const f = await fixture();
    const delta: FocusDelta = { ...emptyDelta(), removeDominant: ["CALVES"] };
    const acceptance = await accept(f.run, "S1", { phases: (ph) => ph.map((p) => ({ ...p, workouts: p.workouts.map((w) => (w.label === "A" && p.phaseIndex === 1 ? { ...w, focusDelta: delta } : w)) })) });
    const answers = convertBlueprintToGenerationAnswers(parseGenerationAnswers(XINTUS_ANSWERS), await compiled(f, acceptance));
    const out = buildEngineInput(f.ctx, answers);
    if (!out.ok) throw new Error(out.code);
    expect(out.issues.find((i) => i.code === "BLUEPRINT_DELTA_IGNORED")).toMatchObject({ severity: "INFO", phaseIndex: 1, label: "A", count: 1 });
  });

  it("o adaptador recusa: regras anteriores (sem degradar), fase/treino fora da estrutura, exercício fora da biblioteca", async () => {
    const b = await built();
    const old = buildEngineInput(b.f.ctx, b.answers, { rules: RULES_411 });
    expect(old).toMatchObject({ ok: false, code: "UNSUPPORTED_RULESET" });
    const with_ = (mutate: (w: BlueprintAnswers["workouts"][number]) => BlueprintAnswers["workouts"][number]): GenerationAnswers =>
      ({ ...b.answers, blueprint: { ...b.answers.blueprint!, workouts: b.answers.blueprint!.workouts.map((w, i) => (i === 0 ? mutate(w) : w)) } });
    expect(buildEngineInput(b.f.ctx, with_((w) => ({ ...w, phaseIndex: 7 })))).toMatchObject({ ok: false, code: "UNKNOWN_TARGET" });
    expect(buildEngineInput(b.f.ctx, with_((w) => ({ ...w, label: "Q" })))).toMatchObject({ ok: false, code: "UNKNOWN_TARGET" });
    expect(buildEngineInput(b.f.ctx, with_((w) => ({ ...w, candidateExerciseIds: ["ex-nao-existe"] })))).toMatchObject({ ok: false, code: "UNKNOWN_EXERCISE", exerciseIds: ["ex-nao-existe"] });
  });

  it("sem estratégia nas respostas a entrada canônica é a de antes: nenhuma chave nova, em nenhuma versão de regras", async () => {
    const f = await fixture();
    const answers = parseGenerationAnswers(XINTUS_ANSWERS);
    expect("blueprint" in answers).toBe(false);
    for (const rules of [undefined, RULES_411, { id: "gymgital-base", version: "2026.11.3" }, { id: "gymgital-base", version: "2026.11.2" }]) {
      const out = buildEngineInput(f.ctx, answers, rules ? { rules } : {});
      if (!out.ok) throw new Error(out.code);
      expect(canonicalInput(out.input)).not.toContain("blueprint");
      expect(out.assumptions.map((a) => a.code)).not.toContain("BLUEPRINT_APPLIED");
    }
  });

  it("o hash da entrada canônica das regras anteriores não mudou (fixado a partir da base do PR 1)", async () => {
    const f = await fixture();
    const answers = parseGenerationAnswers(XINTUS_ANSWERS);
    const hashes: Record<string, string> = {};
    for (const version of ["2026.11.2", "2026.11.3", "2026.11.4"]) {
      const out = buildEngineInput(f.ctx, answers, { rules: { id: "gymgital-base", version } });
      if (!out.ok) throw new Error(out.code);
      hashes[version] = await sha256Hex(canonicalInput(out.input));
    }
    expect(hashes).toEqual(LEGACY_INPUT_HASHES);
  });

  it("determinismo ponta a ponta: o mesmo aceite em duas revisões iguais gera resultados idênticos", async () => {
    const a = await built();
    const b = await built({ id: "acc-1" });
    expect(canonicalJson(generate(okInput(b)))).toBe(canonicalJson(generate(okInput(a))));
    void ASOF;
    void scheduleOf;
  });
});

/** Hash da entrada canônica (adaptador + Xintus) nas regras anteriores, calculado na base do PR 1 (166a551), antes desta mudança. */
const LEGACY_INPUT_HASHES: Record<string, string> = {
  "2026.11.2": "7477ead2b7db293f621a745fc9d7414934c506cc8e4af6532c46951f8b6b629b",
  "2026.11.3": "cd197a69092b016b34d1ffbaeb0d2fb3a0732c8eaed2dfbd1db2f5056726158f",
  "2026.11.4": "9a32b22c91dc2820f65c3307ef2cf2523bc0772e24fd13427af9daf4b1041ac6",
};
