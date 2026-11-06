import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CALENDARS, EQUIPMENT, HISTORIES, LEVELS, ROTATIONS, SCREENINGS, SESSIONS, STIMULI, TEST_PRICES,
  DOSE_PROFILES_RULESET, buildCases, measureBigCase, renderMatrix, runCase, type BenchCase, type CaseMetrics,
} from "./helpers/benchmark-matrix";

/**
 * Motor V4, PR 5.2: matriz de regressão. Afirmações duras (elegibilidade 100%, nenhuma exceção, determinismo, aderência >= 0,7 quando a oferta
 * basta, nenhum erro do motor fora a oferta curta) e números que só se registram (tempo, CPU, heap, custo simulado). Com `MOTOR_BENCH_OUT`
 * grava a tabela em Markdown (é o que `scripts/benchmark-motor-v4.mjs` imprime). Local, Node: não é Workers.
 */
const RUNS = Number(process.env.MOTOR_BENCH_RUNS ?? 1);

describe("matriz de regressão do motor V4", { timeout: 600_000 }, () => {
  const cases = buildCases();
  let results: CaseMetrics[] = [];
  let doseResults: CaseMetrics[] = [];

  it("a amostra é determinística e cobre cada valor de cada dimensão pelo menos duas vezes", () => {
    expect(buildCases().map((c) => c.id)).toEqual(cases.map((c) => c.id));
    expect(JSON.stringify(buildCases())).toBe(JSON.stringify(cases));
    expect(cases[0].id).toBe("xintus");
    const count = <K extends keyof BenchCase>(key: K, value: BenchCase[K]) => cases.filter((c) => c[key] === value).length;
    const dims: Array<[keyof BenchCase, readonly unknown[]]> = [
      ["sessions", SESSIONS], ["stimulus", STIMULI], ["level", LEVELS], ["rotation", ROTATIONS], ["equipment", EQUIPMENT], ["calendar", CALENDARS], ["screening", SCREENINGS], ["history", HISTORIES],
    ];
    for (const [key, values] of dims) for (const v of values) expect(count(key, v as never), `${String(key)}=${String(v)}`).toBeGreaterThanOrEqual(2);
    // pairs that matter for the fix of "everything is full body": every rotation meets every frequency
    for (const r of ROTATIONS) for (const s of SESSIONS) expect(cases.some((c) => c.rotation === r && c.sessions === s), `${r} x ${s}`).toBe(true);
    expect(cases.some((c) => c.phases === 3)).toBe(true);
  });

  it("todos os casos rodam sem exceção, com elegibilidade total, estáveis e aderentes quando a oferta basta", async () => {
    results = [];
    for (const c of cases) results.push(await runCase(c));
    for (const m of results) {
      expect(m.error, `${m.id} (${JSON.stringify(m.spec)})`).toBeNull();
      expect(m.items, `${m.id}: o plano tem itens`).toBeGreaterThan(0);
      expect(m.eligibility, `${m.id}: elegibilidade`).toBe(1);
      expect(m.stable, `${m.id}: duas cadeias completas dão os mesmos bytes`).toBe(true);
      expect(m.adherenceBreaches, `${m.id}: treino abaixo de 70% sem oferta curta`).toBe(0);
      // a library that cannot fill a workout is reported (CATALOG_INSUFFICIENT, never silent); nothing else may be an engine error
      expect(m.otherErrors, `${m.id}: erros do motor além de biblioteca insuficiente`).toBe(0);
      if (m.spec.equipment === "FULL") expect(m.errors, `${m.id}: academia completa não deixa treino sem exercício`).toBe(0);
    }
  });

  it("o controle da dor: sem a dor no histórico os mesmos exercícios seriam escolhidos, então o zero com a dor não é acaso", () => {
    const withPain = results.filter((m) => m.painControlPicks !== null);
    expect(withPain.length).toBeGreaterThan(0);
    expect(withPain.reduce((n, m) => n + (m.painControlPicks ?? 0), 0)).toBeGreaterThan(0);
    // with pain in the history, an exercise with a reported pain is not picked while the weight (-40) and the supply allow it
    expect(withPain.reduce((n, m) => n + m.painExercisesPicked, 0)).toBeLessThan(withPain.reduce((n, m) => n + (m.painControlPicks ?? 0), 0));
  });

  it("a mesma amostra com a política de doses opt-in (2026.11.6) também roda sem exceção, elegível, estável e aderente", async () => {
    doseResults = [];
    for (const c of cases) doseResults.push(await runCase(c, DOSE_PROFILES_RULESET));
    for (const m of doseResults) {
      expect(m.error, `${m.id} (2026.11.6)`).toBeNull();
      expect(m.eligibility, `${m.id}: elegibilidade`).toBe(1);
      expect(m.stable, `${m.id}: estável`).toBe(true);
      expect(m.adherenceBreaches, `${m.id}: aderência`).toBe(0);
      expect(m.otherErrors, `${m.id}: erros além de biblioteca insuficiente`).toBe(0);
      if (m.spec.equipment === "FULL") expect(m.errors, `${m.id}: academia completa`).toBe(0);
    }
  });

  it("o Xintus (4 x 60 min, ABAB, 3 fases) mantém a divisão: A e B aderentes, nenhum erro", () => {
    const x = results.find((m) => m.id === "xintus")!;
    expect(x.ok).toBe(true);
    expect(x.errors).toBe(0);
    expect(x.adherenceMin).not.toBeNull();
    expect(x.adherenceMin!).toBeGreaterThanOrEqual(0.7);
    expect(x.mockCostMicros).not.toBeNull();
  });

  it("o custo simulado vem só dos preços de teste e não é negativo; o caminho por regras não gasta token", () => {
    expect(TEST_PRICES.inputMicrosPerMillion).toBeGreaterThan(0);
    for (const m of results) {
      expect(m.mockInputTokens, m.id).toBeGreaterThan(0);
      expect(m.mockCostMicros!, m.id).toBeGreaterThan(0);
    }
  });

  it("caso grande com e sem blueprint: mede e registra (sem teto de CPU), as duas variantes geram todas as sessões", async () => {
    const big = await measureBigCase(RUNS);
    expect(big.measures.map((m) => `${m.rulesVersion} ${m.variant}`)).toEqual(["2026.11.5 SEM_BLUEPRINT", "2026.11.5 COM_BLUEPRINT", "2026.11.6 SEM_BLUEPRINT", "2026.11.6 COM_BLUEPRINT"]);
    for (const m of big.measures) {
      expect(m.occurrences, m.variant).toBe(12 * 4 * 7);
      // the stored summary has a ceiling (summary_json, 500 000 characters): the biggest variant must still be under it
      expect(m.summaryKb, `${m.rulesVersion} ${m.variant}`).toBeLessThan(488);
      expect(m.wallMs).toBeGreaterThan(0);
    }
    // ordem de grandeza contra regressão (não é orçamento de CPU: no CI os arquivos rodam em paralelo)
    for (const m of big.measures) expect(m.wallMs, m.variant).toBeLessThan(60_000);
    const text = renderMatrix(results, big, doseResults);
    console.log(`[benchmark-matrix]\n${text}`);
    if (process.env.MOTOR_BENCH_OUT) writeFileSync(process.env.MOTOR_BENCH_OUT, `${text}\n`);
    expect(text).toContain("Caso grande");
  }, 300_000);
});
