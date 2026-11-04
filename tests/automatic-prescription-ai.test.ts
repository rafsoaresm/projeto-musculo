import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// `server-only` lança fora de um componente de servidor; aqui só o neutraliza (o arquivo continua marcado para o bundle).
vi.mock("server-only", () => ({}));

import {
  AI_PROMPT_VERSION, aiCacheKey, validateAiResponse, workoutKey, type AiAllowedRefs, type AiReviewResponse,
} from "@/modules/prescricao/automatica/ai/contracts";
import { AI_CHARS_PER_TOKEN, AI_REVIEW_DEFAULTS, aiReviewUsable, aiSummaryLimits, resolveAiReviewConfig, type AiReviewConfig } from "@/modules/prescricao/automatica/ai/config";
import { buildAiSummary } from "@/modules/prescricao/automatica/ai/summary";
import { disabledReviewer, requestAiReview, type ProposalReviewer } from "@/modules/prescricao/automatica/ai/reviewer";
import { canonicalJson, generate, type CatalogExercise, type EngineInput, type EngineResult } from "@/modules/prescricao/motor";
import { XINTUS_CATALOG, xintusInput } from "./helpers/xintus";
import { LEGACY_RULES } from "./helpers/motor-fixtures";

/** Dados de identificação fictícios espalhados pela entrada: nenhum pode chegar ao resumo. */
const SECRETS = ["Maria Fictícia", "123.456.789-00", "as-secreta-77", "casamento", "Treino da Maria", "Joelho dói ao subir escada", "2026-11-09", "2026-11-04"];

function secretInput(over: Partial<EngineInput> = {}): EngineInput {
  const base = xintusInput();
  return {
    ...base,
    student: {
      ...base.student,
      goal: { value: "Ficar forte para o casamento, Maria Fictícia", source: "PROFILE", basis: "STUDENT_DATA" },
      findings: [
        ...base.student.findings.map((f) => ({ ...f, ref: "assessment:as-secreta-77" })),
        { kind: "ANAMNESIS", code: "KNEE_PAIN", label: "Anamnese: Joelho dói ao subir escada (Maria Fictícia, CPF 123.456.789-00)", ref: "assessment:as-secreta-77" },
        { kind: "POSTURE", code: "Maria Fictícia 123.456.789-00", label: "texto livre no código", ref: "assessment:as-secreta-77" },
      ],
    },
    structure: {
      ...base.structure,
      phases: base.structure.phases.map((p) => ({ ...p, name: "Fase da Maria Fictícia", workouts: p.workouts.map((w) => ({ ...w, name: "Treino da Maria" })) })),
    },
    ...over,
  };
}

// Nomes da biblioteca da organização são digitados pelo profissional: aqui carregam dados de identificação.
const catalog = new Map<string, CatalogExercise>(XINTUS_CATALOG.map((e) => [e.id, { ...e, name: `${e.name} (Maria Fictícia CPF 123.456.789-00)` }]));
const resultOf = (input: EngineInput): EngineResult => generate(input);
const BIG = { maxChars: 1_000_000 };

function build(maxChars = BIG.maxChars, input = secretInput()) {
  return buildAiSummary(resultOf(input), input.student, catalog, { maxChars });
}

describe("resumo para a revisão por IA", () => {
  it("não leva nome, CPF, ids, datas nem texto livre; exercícios e treinos vão por apelido", () => {
    const { summary, allowed } = build();
    const text = canonicalJson(summary);
    for (const s of SECRETS) expect(text, s).not.toContain(s);
    for (const e of XINTUS_CATALOG) {
      expect(text, e.id).not.toContain(`"${e.id}"`);
      expect(text, e.name).not.toContain(e.name);
    }
    expect(text).not.toMatch(/"name"/);
    expect(text).not.toMatch(/assessment:|"ref"|"name":"Fase|"plannedDate"|"weekStart"|Hipertrofia e/);
    expect(summary.exercises.every((e) => /^X\d+$/.test(e.alias))).toBe(true);
    expect(summary.phases.flatMap((p) => p.workouts.map((w) => w.label))).toEqual(["T1", "T2", "T1", "T2", "T1", "T2"]);
    expect(allowed.workoutLabels).toEqual({ T1: "A", T2: "B" });
    // o achado com texto livre no código fica de fora; o da anamnese só como código
    expect(summary.findings.map((f) => f.code)).toEqual(["FLEXITEST", "KNEE_PAIN"]);
    expect(summary.findings[0].readings?.find((r) => r.code === "ankle_dorsiflexion")?.level).toBe(2);
    // o que o motor mediu chega como números e códigos
    expect(summary.student).toEqual({ experience: "INTERMEDIATE", sessionMinutes: 60 });
    expect(summary.phases[0].stimuli).toEqual(["HYPERTROPHY"]);
    expect(summary.phases[0].muscles.length).toBeGreaterThan(0);
    // sem estímulo e fora dos alvos: só o código, numa lista à parte (medido, não desconhecido)
    expect(summary.phases[0].muscles.some((m) => m.classification === "NONE" && !m.isTarget)).toBe(false);
    expect(summary.phases[0].musclesWithoutStimulus.length).toBeGreaterThan(0);
    expect(summary.phases[0].musclesWithoutStimulus.some((m) => summary.phases[0].muscles.some((r) => r.muscle === m))).toBe(false);
    expect(summary.phases[0].workouts[0].exposuresPerWeek).toEqual({ min: 2, max: 2 });
    expect(summary.audit.length).toBeGreaterThan(0);
    expect(summary.auditVersion).not.toBeNull();
    // o resumo não lista as sessões uma a uma
    expect(text).not.toMatch(/"week":\d+,"slot"/);
    // tradução de volta: só o servidor conhece o id real
    for (const [a, id] of Object.entries(allowed.exerciseIds))
      expect(catalog.get(id)?.primaryMuscles).toEqual(summary.exercises.find((e) => e.alias === a)?.primaryMuscles);
  });

  it("é determinístico e respeita maxChars cortando alternativas, depois INFO, depois padrões", () => {
    const full = build();
    expect(canonicalJson(build().summary)).toBe(canonicalJson(full.summary));
    expect(full.fits).toBe(true);
    expect(full.summary.omitted).toEqual({ alternatives: 0, infoFindings: 0, patternRows: 0 });
    expect(full.summary.phases.some((p) => p.workouts.some((w) => w.alternatives.length > 0))).toBe(true);

    // Um caractere a menos: só alternativas saem (são as primeiras a sair e há várias).
    const a = build(full.chars - 1);
    expect(a.fits).toBe(true);
    expect(a.chars).toBeLessThanOrEqual(full.chars - 1);
    expect(a.summary.omitted.alternatives).toBeGreaterThan(0);
    expect(a.summary.omitted).toMatchObject({ infoFindings: 0, patternRows: 0 });

    // Sem nenhuma alternativa nem achado INFO: o próximo corte só pode ser de linhas de padrão.
    const totalAlternatives = full.summary.phases.flatMap((p) => p.workouts).reduce((n, w) => n + w.alternatives.length, 0);
    const totalInfo = full.summary.audit.filter((f) => f.severity === "INFO").length;
    expect(totalInfo).toBeGreaterThan(0);
    const stripped = {
      ...full.summary,
      phases: full.summary.phases.map((p) => ({ ...p, workouts: p.workouts.map((w) => ({ ...w, alternatives: [] })) })),
      audit: full.summary.audit.filter((f) => f.severity !== "INFO"),
      exercises: full.summary.exercises.filter((e) => full.summary.phases.some((p) => p.workouts.some((w) => w.exercises.includes(e.alias)))),
      omitted: { alternatives: totalAlternatives, infoFindings: totalInfo, patternRows: 0 },
    };
    const tightLimit = canonicalJson(stripped).length - 1;
    const tight = build(tightLimit);
    expect(tight.fits).toBe(true);
    expect(tight.chars).toBeLessThanOrEqual(tightLimit);
    expect(tight.summary.omitted).toMatchObject({ alternatives: totalAlternatives, infoFindings: totalInfo });
    expect(tight.summary.omitted.patternRows).toBeGreaterThan(0);
    expect(tight.summary.phases.every((p) => p.workouts.every((w) => w.alternatives.length === 0))).toBe(true);
    expect(tight.summary.audit.every((f) => f.severity !== "INFO")).toBe(true);
    // o que foi cortado deixa de ser citável
    const cutAliases = full.allowed.refs.filter((r) => !tight.allowed.refs.includes(r));
    expect(cutAliases.length).toBeGreaterThan(0);

    const impossible = build(200);
    expect(impossible.fits).toBe(false);
    expect(impossible.chars).toBeGreaterThan(200);
  });

  it("proposta sem auditoria (regras antigas) também resume, sem faixas", () => {
    const input = secretInput({ rules: LEGACY_RULES });
    const { summary } = buildAiSummary(resultOf(input), input.student, catalog, BIG);
    expect(summary.auditVersion).toBeNull();
    expect(summary.audit).toEqual([]);
    expect(summary.phases.every((p) => p.muscles.length === 0 && p.patterns.length === 0)).toBe(true);
    expect(summary.phases[0].workouts[0].exercises.length).toBeGreaterThan(0);
  });
});

describe("itens do profissional (preservados, travados, substituídos)", () => {
  it("vão marcados em fixed e nenhuma sugestão pode apontar para eles", () => {
    const input = secretInput();
    const result = resultOf(input);
    // Marca como travado o primeiro exercício do treino A da fase 1 (em todas as sessões) e como substituído o segundo, numa sessão só.
    const occ = result.occurrences.filter((o) => o.phaseIndex === 1 && o.label === "A");
    const [lockedId, substitutedId] = [...occ[0].items].sort((x, y) => x.position - y.position).map((i) => i.exerciseId!);
    const marked: EngineResult = {
      ...result,
      occurrences: result.occurrences.map((o) =>
        o.phaseIndex !== 1 || o.label !== "A"
          ? o
          : {
              ...o,
              items: o.items.map((i) =>
                i.exerciseId === lockedId ? { ...i, origin: "LOCKED" as const } : i.exerciseId === substitutedId && o === occ[0] ? { ...i, origin: "SUBSTITUTED" as const } : i,
              ),
            },
      ),
    };
    const { summary, allowed } = buildAiSummary(marked, input.student, catalog, BIG);
    const aliasOf = (id: string) => Object.entries(allowed.exerciseIds).find(([, v]) => v === id)![0];
    const t1 = summary.phases.find((p) => p.phaseIndex === 1)!.workouts.find((w) => w.label === "T1")!;
    expect(t1.fixed).toEqual([aliasOf(lockedId), aliasOf(substitutedId)]);
    expect(allowed.fixedByWorkout[workoutKey(1, "T1")]).toEqual(t1.fixed);
    expect(allowed.eligibleByWorkout[workoutKey(1, "T1")]).not.toContain(aliasOf(lockedId));
    // o mesmo exercício em outra fase, escolhido pelo motor, continua elegível lá
    const other = summary.phases.find((p) => p.phaseIndex !== 1 && p.workouts.some((w) => w.exercises.includes(aliasOf(lockedId))));
    if (other) {
      const w = other.workouts.find((x) => x.exercises.includes(aliasOf(lockedId)))!;
      expect(w.fixed).toEqual([]);
      expect(allowed.eligibleByWorkout[workoutKey(other.phaseIndex, w.label)]).toContain(aliasOf(lockedId));
    }
    for (const action of ["REVIEW_ITEM", "CONSIDER_SUBSTITUTION", "NOTE"] as const) {
      const r = validateAiResponse(
        { observations: [], suggestions: [{ action, exerciseId: aliasOf(lockedId), phaseIndex: 1, workoutLabel: "T1", reason: "Trocar este item.", sourceRefs: [] }] },
        allowed,
      );
      expect(r.ok ? [] : r.problems, action).toEqual([expect.stringMatching(/decisão do profissional/)]);
    }
  });
});

describe("validação da resposta", () => {
  const { allowed } = build();
  const a1 = allowed.refs.find((r) => r.startsWith("A"))!;
  const planned = allowed.eligibleByWorkout[workoutKey(1, "T1")][0];
  const notInB = Object.keys(allowed.exerciseIds).find((x) => !allowed.eligibleByWorkout[workoutKey(1, "T2")].includes(x))!;
  const valid = (): AiReviewResponse => ({
    observations: [{ code: "LOW_POSTERIOR_CHAIN", target: { phaseIndex: 1, workoutLabel: "T1", muscle: "HAMSTRINGS" }, message: "Pouco estímulo direto nos posteriores da coxa na fase.", evidenceRefs: [a1], uncertainty: "MEDIUM" }],
    suggestions: [{ action: "REVIEW_ITEM", exerciseId: planned, phaseIndex: 1, workoutLabel: "T1", reason: "Conferir se este exercício cobre o alvo da fase.", sourceRefs: [a1, planned] }],
  });
  const problems = (raw: unknown, refs: AiAllowedRefs = allowed) => {
    const r = validateAiResponse(raw, refs);
    return r.ok ? [] : r.problems;
  };

  it("aceita uma resposta mínima válida", () => {
    expect(validateAiResponse(valid(), allowed)).toEqual({ ok: true, response: valid() });
    expect(validateAiResponse({ observations: [], suggestions: [] }, allowed).ok).toBe(true);
  });

  it("recusa campos desconhecidos, inclusive de dose", () => {
    expect(problems({ ...valid(), approve: true }).length).toBeGreaterThan(0);
    const r = valid();
    expect(problems({ ...r, suggestions: [{ ...r.suggestions[0], sets: 4, reps: "8-12" }] }).length).toBeGreaterThan(0);
    expect(problems({ ...r, observations: [{ ...r.observations[0], target: { ...r.observations[0].target, week: 2 } }] }).length).toBeGreaterThan(0);
    expect(problems({ observations: [] }).length).toBeGreaterThan(0);
  });

  it("recusa exercício desconhecido ou fora do treino, fase e treino inexistentes, refs fora do resumo", () => {
    const r = valid();
    const s = r.suggestions[0];
    expect(problems({ ...r, suggestions: [{ ...s, exerciseId: "ex-squat" }] })).toEqual([expect.stringMatching(/não é elegível/)]);
    expect(problems({ ...r, suggestions: [{ ...s, action: "CONSIDER_SUBSTITUTION", exerciseId: notInB, workoutLabel: "T2" }] })).toEqual([expect.stringMatching(/não é elegível/)]);
    expect(problems({ ...r, suggestions: [{ ...s, phaseIndex: undefined }] })).toEqual(expect.arrayContaining([expect.stringMatching(/sem fase/)]));
    expect(problems({ ...r, suggestions: [{ ...s, exerciseId: undefined }] })).toEqual([expect.stringMatching(/REVIEW_ITEM sem exercício/)]);
    expect(problems({ ...r, observations: [{ ...r.observations[0], target: { phaseIndex: 9 } }] })).toEqual([expect.stringMatching(/fase 9/)]);
    expect(problems({ ...r, observations: [{ ...r.observations[0], target: { phaseIndex: 1, workoutLabel: "A" } }] })).toEqual([expect.stringMatching(/treino A/)]);
    expect(problems({ ...r, observations: [{ ...r.observations[0], evidenceRefs: ["A9999"] }] })).toEqual([expect.stringMatching(/A9999/)]);
    expect(problems({ ...r, observations: [{ ...r.observations[0], target: { muscle: "PINKY" } }] }).length).toBeGreaterThan(0);
  });

  it("recusa referências inventadas e números de dose no texto", () => {
    const r = valid();
    const say = (message: string) => problems({ ...r, observations: [{ ...r.observations[0], message }] });
    for (const m of ["Ver https://exemplo.org/estudo", "Segundo Schoenfeld et al., mais volume", "doi 10.1519/JSC.0000", "PMID 12345678", "Estudo de Silva (2019)"])
      expect(say(m), m).toEqual([expect.stringMatching(/referência bibliográfica/)]);
    for (const m of [
      "Fazer 4x10 no agachamento", "Fazer 4 X 10", "Subir para 4 séries", "Usar 80% de 1RM", "Manter RIR 2", "Manter 2 RIR", "RPE 8",
      "Carga de 40 kg", "8 a 12 repetições", "8-12 reps", "1 série", "3 sets por semana", "Fazer três séries", "Descanso de 90 s", "60 segundos de pausa",
    ])
      expect(say(m), m).toEqual([expect.stringMatching(/dose/)]);
    // os apelidos do próprio resumo (T1, X3, A2) e números que não são dose passam
    for (const m of [
      "A fase 2 repete a fase 1 com pouca variação", "No T1 X3 cobre pouco o alvo.", "Conferir X1 X2 juntos.", "T2 x X4 se sobrepõem.",
      "A1 e A2 mostram salto entre semanas.", "Sessões de 60 min nas 12 semanas.", "Fazer uma série de ajustes no T2.",
    ])
      expect(say(m), m).toEqual([]);
  });

  it("recusa textos longos e listas acima do limite", () => {
    const r = valid();
    expect(problems({ ...r, observations: [{ ...r.observations[0], message: "a".repeat(401) }] }).length).toBeGreaterThan(0);
    expect(problems({ ...r, observations: Array.from({ length: 21 }, () => r.observations[0]) }).length).toBeGreaterThan(0);
    expect(problems({ ...r, observations: [{ ...r.observations[0], evidenceRefs: Array(9).fill(a1) }] }).length).toBeGreaterThan(0);
    expect(problems({ ...r, observations: [{ ...r.observations[0], code: "texto livre" }] }).length).toBeGreaterThan(0);
  });
});

describe("chave de cache, configuração e revisor desligado", () => {
  it("a chave é estável para o mesmo resumo e muda com modelo, versão do prompt e conteúdo", async () => {
    const one = build().summary;
    const two = build().summary;
    const k = await aiCacheKey(one, "modelo-x", AI_PROMPT_VERSION);
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(await aiCacheKey(two, "modelo-x", AI_PROMPT_VERSION)).toBe(k);
    // mesma informação, chaves em outra ordem: mesma chave (JSON canônico)
    const reverse = (v: unknown): unknown =>
      Array.isArray(v) ? v.map(reverse) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).reverse().map(([x, y]) => [x, reverse(y)])) : v;
    const reordered = reverse(one) as typeof one;
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(one));
    expect(await aiCacheKey(reordered, "modelo-x", AI_PROMPT_VERSION)).toBe(k);
    expect(await aiCacheKey(one, "modelo-y", AI_PROMPT_VERSION)).not.toBe(k);
    expect(await aiCacheKey(one, "modelo-x", "2099.01.1")).not.toBe(k);
    expect(await aiCacheKey({ ...one, student: { ...one.student, sessionMinutes: 45 } }, "modelo-x", AI_PROMPT_VERSION)).not.toBe(k);
  });

  it("a configuração é desligada, sem modelo e sem orçamento", () => {
    const c = resolveAiReviewConfig();
    expect(c).toEqual({ ...AI_REVIEW_DEFAULTS });
    expect(c.enabled).toBe(false);
    expect(c.modelId).toBeNull();
    expect(c.monthlyBudgetCents).toBe(0);
    expect(c.promptVersion).toBe(AI_PROMPT_VERSION);
    expect(aiReviewUsable(c)).toBe(false);
    expect(Object.isFrozen(AI_REVIEW_DEFAULTS)).toBe(true);
  });

  it("sem IA configurada tudo responde 'IA não configurada' sem chamar o revisor", async () => {
    expect(await disabledReviewer.review({ summary: build().summary, cacheKey: "k", config: resolveAiReviewConfig() })).toEqual({ status: "NOT_CONFIGURED", message: "IA não configurada" });
    const spy: ProposalReviewer = { review: vi.fn() };
    expect(await requestAiReview(build(), resolveAiReviewConfig(), spy)).toEqual({ status: "NOT_CONFIGURED", message: "IA não configurada" });
    expect(await requestAiReview(build(), { ...resolveAiReviewConfig(), enabled: true, modelId: "m" }, spy)).toMatchObject({ status: "NOT_CONFIGURED" }); // orçamento 0
    expect(spy.review).not.toHaveBeenCalled();
    expect(await requestAiReview(build(), resolveAiReviewConfig())).toMatchObject({ status: "NOT_CONFIGURED" });
  });

  it("um revisor ligado (falso, em teste) só tem a resposta aceita depois da validação no servidor", async () => {
    const config: AiReviewConfig = { ...AI_REVIEW_DEFAULTS, enabled: true, modelId: "modelo-teste", monthlyBudgetCents: 100, maxInputTokens: 10_000 };
    const b = build(aiSummaryLimits(config).maxChars);
    expect(b.fits).toBe(true);
    const usage = { inputTokens: 1, outputTokens: 1, latencyMs: 1 };
    const fake = (raw: unknown): ProposalReviewer => ({ review: vi.fn(async () => ({ status: "OK" as const, raw, usage })) });
    const good = { observations: [], suggestions: [{ action: "NOTE", reason: "Plano coerente com os alvos.", sourceRefs: [] }] };
    const ok = await requestAiReview(b, config, fake(good));
    expect(ok).toMatchObject({ status: "OK", usage, cacheKey: await aiCacheKey(b.summary, "modelo-teste", AI_PROMPT_VERSION) });
    expect(await requestAiReview(b, config, fake({ ...good, approve: true }))).toMatchObject({ status: "FAILED", reason: "INVALID_RESPONSE" });
    expect(await requestAiReview(b, config, { review: async () => { throw new Error("rede"); } })).toEqual({ status: "FAILED", reason: "PROVIDER" });
    expect(await requestAiReview(build(200), config, fake(good))).toEqual({ status: "FAILED", reason: "INPUT_TOO_LARGE" });
  });

  it("o teto de entrada vem da configuração: um resumo montado com maxChars maior não passa", async () => {
    expect(aiSummaryLimits(AI_REVIEW_DEFAULTS)).toEqual({ maxChars: AI_REVIEW_DEFAULTS.maxInputTokens * AI_CHARS_PER_TOKEN });
    const config: AiReviewConfig = { ...AI_REVIEW_DEFAULTS, enabled: true, modelId: "modelo-teste", monthlyBudgetCents: 100, maxInputTokens: 10 };
    const spy: ProposalReviewer = { review: vi.fn() };
    const huge = build(); // montado com 1.000.000 de caracteres: "cabe" no próprio limite
    expect(huge.fits).toBe(true);
    expect(huge.chars).toBeGreaterThan(aiSummaryLimits(config).maxChars);
    expect(await requestAiReview(huge, config, spy)).toEqual({ status: "FAILED", reason: "INPUT_TOO_LARGE" });
    expect(spy.review).not.toHaveBeenCalled();
  });

  it("o motor não importa a revisão por IA", () => {
    const motor = join(process.cwd(), "src/modules/prescricao/motor");
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts")) files.push(p);
      }
    };
    walk(motor);
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(/automatica\/ai|from "\.\.?\/ai|\/ai\//);
    for (const f of ["generate.ts", "select.ts", "dose.ts", "volume.ts", "flags.ts"]) {
      const p = join(motor, f);
      expect(existsSync(p), f).toBe(true);
      expect(readFileSync(p, "utf8"), f).not.toMatch(/\bai\//);
    }
    // nenhum fornecedor, credencial ou rede nos contratos
    const ai = join(process.cwd(), "src/modules/prescricao/automatica/ai");
    for (const f of readdirSync(ai)) expect(readFileSync(join(ai, f), "utf8"), f).not.toMatch(/fetch\(|process\.env|getCloudflareContext|env\.DB|apiKey|api_key/i);
  });
});
