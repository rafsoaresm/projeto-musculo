import { describe, expect, it } from "vitest";
import { plannerResponseSchema } from "@/modules/prescricao/planejador/blueprint";
import { evaluateAiGate, type AiGateState } from "@/modules/prescricao/planejador/gate";
import {
  allowanceIsZero, costMicros, estimatedTokensOf, estimateTokens, fitsAllowance, maximalPlannerResponse, monthKey, outputBudget, remainingTokens, reservationFor,
  staleAfterMs, withinPerRequestCap, worstCaseOutputTokens, AI_CHARS_PER_TOKEN, THINKING_ALLOWANCE_TOKENS, type Allowance, type MonthUse, type TypedPrices,
} from "@/modules/prescricao/planejador/quota";
import { CIRCUIT_OPEN_MS, circuitDecision, countsForCircuit, type CircuitRow } from "@/modules/prescricao/planejador/circuit";
import { xintusBundle } from "./helpers/planning-fixtures";

describe("staleAfterMs", () => {
  it("covers every attempt of a reservation plus the pause and the grace", () => {
    expect(staleAfterMs(25_000, 0)).toBe(40_000);
    expect(staleAfterMs(25_000, 1)).toBe(2 * 25_000 + 400 + 15_000);
  });
});

const ZERO: MonthUse = { usedInput: 0, usedOutput: 0, reservedInput: 0, reservedOutput: 0 };

describe("estimates and cost", () => {
  it("estimates ceil(chars / 3)", () => {
    expect(AI_CHARS_PER_TOKEN).toBe(3);
    expect(estimateTokens(0)).toBe(0);
    expect(estimateTokens(1)).toBe(1);
    expect(estimateTokens(3)).toBe(1);
    expect(estimateTokens(4)).toBe(2);
    expect(estimateTokens(3000)).toBe(1000);
  });

  it("cost is null without typed prices (never 0 for unknown) and exact with them", () => {
    expect(costMicros(1000, 1000, null)).toBeNull();
    const prices: TypedPrices = { currency: "USD", inputMicrosPerMillion: 150_000, outputMicrosPerMillion: 600_000 };
    expect(costMicros(0, 0, prices)).toBe(0);
    expect(costMicros(1_000_000, 1_000_000, prices)).toBe(750_000);
    // ceil per direction: 1 token of input at 0.15 per million is 1 micro, never 0
    expect(costMicros(1, 0, prices)).toBe(1);
    expect(costMicros(10, 10, prices)).toBe(2 + 6);
    expect(costMicros(1000, 2000, { currency: "BRL", inputMicrosPerMillion: 0, outputMicrosPerMillion: 0 })).toBe(0);
  });

  it("the month key is the calendar month in America/Sao_Paulo", () => {
    expect(monthKey(new Date("2026-11-30T23:30:00-03:00"))).toBe("2026-11");
    expect(monthKey(new Date("2026-12-01T01:00:00Z"))).toBe("2026-11");
    expect(monthKey(new Date("2026-12-01T03:00:00Z"))).toBe("2026-12");
  });
});

describe("allowance checks at the boundaries", () => {
  const total: Allowance = { mode: "TOTAL", total: 1000 };
  const split: Allowance = { mode: "SPLIT", input: 600, output: 400 };

  it("TOTAL: input + output together, counting what is reserved", () => {
    expect(fitsAllowance(total, ZERO, { input: 600, output: 400 })).toBe(true);
    expect(fitsAllowance(total, ZERO, { input: 600, output: 401 })).toBe(false);
    expect(fitsAllowance(total, { ...ZERO, usedInput: 500 }, { input: 300, output: 200 })).toBe(true);
    expect(fitsAllowance(total, { ...ZERO, usedInput: 500, reservedOutput: 1 }, { input: 300, output: 200 })).toBe(false);
  });

  it("SPLIT: blocks on output while input still has room, and the other way round", () => {
    expect(fitsAllowance(split, ZERO, { input: 600, output: 400 })).toBe(true);
    expect(fitsAllowance(split, { ...ZERO, usedOutput: 350 }, { input: 10, output: 51 })).toBe(false);
    expect(fitsAllowance(split, { ...ZERO, usedOutput: 350 }, { input: 10, output: 50 })).toBe(true);
    expect(fitsAllowance(split, { ...ZERO, reservedInput: 595 }, { input: 6, output: 1 })).toBe(false);
  });

  it("zero allowance means 'IA não incluída'", () => {
    expect(allowanceIsZero({ mode: "TOTAL", total: 0 })).toBe(true);
    expect(allowanceIsZero({ mode: "SPLIT", input: 100, output: 0 })).toBe(true);
    expect(allowanceIsZero({ mode: "SPLIT", input: 100, output: 1 })).toBe(false);
    expect(fitsAllowance({ mode: "TOTAL", total: 0 }, ZERO, { input: 1, output: 0 })).toBe(false);
  });

  it("remaining tokens never go negative", () => {
    expect(remainingTokens(total, { ...ZERO, usedInput: 900, usedOutput: 300 })).toEqual({ mode: "TOTAL", total: 0 });
    expect(remainingTokens(split, { ...ZERO, usedInput: 100, reservedOutput: 50 })).toEqual({ mode: "SPLIT", input: 500, output: 350 });
  });

  it("the per-request cap is a TOTAL cap on one attempt; 0 means not included", () => {
    expect(withinPerRequestCap(1000, 600, 400)).toBe(true);
    expect(withinPerRequestCap(1000, 600, 401)).toBe(false);
    expect(withinPerRequestCap(0, 0, 0)).toBe(false);
  });
});

describe("the reservation covers every attempt", () => {
  it("(1 + retries) x (input, effective max output); the cap is judged on ONE attempt", () => {
    const none = reservationFor({ estimatedInput: 1000, effectiveMaxOutput: 500, maxRetries: 0, prices: null });
    expect(none).toEqual({ input: 1000, output: 500, costMicros: 0, perAttemptTokens: 1500 });
    const retry = reservationFor({ estimatedInput: 1000, effectiveMaxOutput: 500, maxRetries: 1, prices: null });
    expect(retry).toMatchObject({ input: 2000, output: 1000, perAttemptTokens: 1500 });
  });

  it("is priced (worst case) only when prices are typed; otherwise 0 reserved cost, never an invented one", () => {
    const prices: TypedPrices = { currency: "BRL", inputMicrosPerMillion: 1_000_000, outputMicrosPerMillion: 2_000_000 };
    const priced = reservationFor({ estimatedInput: 1_000_000, effectiveMaxOutput: 500_000, maxRetries: 1, prices });
    expect(priced.costMicros).toBe(2_000_000 + 2_000_000);
    expect(reservationFor({ estimatedInput: 1_000_000, effectiveMaxOutput: 500_000, maxRetries: 1, prices: null }).costMicros).toBe(0);
  });
});

describe("the output budget (worst case) of a planning call", () => {
  const shapes = {
    xintus: { phases: [2, 2, 2].map((workouts) => ({ workouts })) },
    largest: { phases: Array.from({ length: 12 }, () => ({ workouts: 8 })) },
  };

  it.each(Object.entries(shapes))("the maximal response for %s is schema-valid and fits the budget", (_name, shape) => {
    const maximal = maximalPlannerResponse(shape);
    expect(plannerResponseSchema.safeParse(maximal).success).toBe(true);
    for (const kind of ["openai", "anthropic", "google", "mock"]) {
      const worst = worstCaseOutputTokens(shape, kind);
      expect(estimatedTokensOf(maximal)).toBeLessThanOrEqual(worst);
      expect(worst).toBe(Math.ceil(estimatedTokensOf(maximal) * 1.1) + THINKING_ALLOWANCE_TOKENS[kind]);
    }
  });

  it("effectiveMaxOutput = min(hard, max(task, worst case)); a worst case above the hard ceiling is REQUEST_TOO_LARGE", () => {
    const shape = shapes.xintus;
    const worst = worstCaseOutputTokens(shape, "anthropic");
    const roomy = outputBudget(shape, "anthropic", 100, 8192);
    expect(roomy).toEqual({ worstCase: worst, effectiveMaxOutput: Math.min(8192, worst), tooLarge: worst > 8192 });
    expect(outputBudget(shape, "anthropic", worst + 500, worst + 1000).effectiveMaxOutput).toBe(worst + 500);
    const tooLarge = outputBudget(shapes.largest, "openai", 6144, 8192);
    expect(tooLarge.tooLarge).toBe(worstCaseOutputTokens(shapes.largest, "openai") > 8192);
    expect(tooLarge.effectiveMaxOutput).toBeLessThanOrEqual(8192);
  });

  it("grows with the structure (a bigger plan is a bigger budget)", () => {
    expect(worstCaseOutputTokens(shapes.largest, "mock")).toBeGreaterThan(worstCaseOutputTokens(shapes.xintus, "mock"));
  });

  it("works on the real Xintus bundle shape", async () => {
    const bundle = await xintusBundle();
    const shape = { phases: bundle.context.periodization.phases.map((p) => ({ workouts: p.workouts.length })) };
    expect(shape.phases).toHaveLength(3);
    expect(worstCaseOutputTokens(shape, "google")).toBeGreaterThan(1024);
  });
});

describe("the gate returns the FIRST failing reason in a fixed order", () => {
  const ready = (): AiGateState => ({
    envKill: false, panelKill: false, secretsKeyOk: true, mockEnabled: false,
    task: { enabled: true, providerKind: "openai", modelId: "any-model", currency: null, hasPrices: false },
    providerConnected: true, org: { enabled: true },
    plan: { archived: false, allowance: { mode: "TOTAL", total: 100_000 }, perRequestCapPlanning: 20_000, perRequestCapAdjustment: 10_000, costCapMicros: null, costCapCurrency: null },
    month: { ...ZERO, costMicros: 0, reservedCostMicros: 0, costCurrency: null },
    circuitOpen: false,
  });
  const with_ = (patch: Partial<AiGateState>): AiGateState => ({ ...ready(), ...patch });

  it("is READY when everything is in place", () => {
    expect(evaluateAiGate(ready(), "PLANNER")).toBe("READY");
  });

  it.each([
    ["KILL_SWITCH_ENV", with_({ envKill: true, panelKill: true, org: null })],
    ["KILL_SWITCH_PANEL", with_({ panelKill: true, secretsKeyOk: false })],
    ["SECRETS_KEY_MISSING", with_({ secretsKeyOk: false, task: null })],
    ["TASK_NOT_MAPPED", with_({ task: null })],
    ["TASK_NOT_MAPPED", with_({ task: { enabled: false, providerKind: "openai", modelId: "m", currency: null, hasPrices: false } })],
    ["TASK_NOT_MAPPED", with_({ task: { enabled: true, providerKind: null, modelId: null, currency: null, hasPrices: false } })],
    ["PROVIDER_NOT_CONNECTED", with_({ providerConnected: false })],
    ["ORG_DISABLED", with_({ org: { enabled: false } })],
    ["ORG_DISABLED", with_({ org: null })],
    ["NO_QUOTA_PLAN", with_({ plan: null })],
    ["NO_QUOTA_PLAN", with_({ plan: { ...ready().plan!, archived: true } })],
    ["ALLOWANCE_ZERO", with_({ plan: { ...ready().plan!, allowance: { mode: "TOTAL", total: 0 } } })],
    ["ALLOWANCE_ZERO", with_({ plan: { ...ready().plan!, perRequestCapPlanning: 0 } })],
    ["ALLOWANCE_EXHAUSTED", with_({ month: { ...ready().month!, usedInput: 100_000 } })],
    ["CIRCUIT_OPEN", with_({ circuitOpen: true })],
    ["MINOR_BLOCKED", with_({ minor: true })],
    ["REQUEST_TOO_LARGE", with_({ requestTooLarge: true })],
    ["REQUEST_TOO_LARGE", with_({ perAttemptTokens: 20_001 })],
  ] as const)("%s", (expected, state) => {
    expect(evaluateAiGate(state, "PLANNER")).toBe(expected);
  });

  it("the env kill switch wins over every other reason; the panel switch over the rest", () => {
    expect(evaluateAiGate(with_({ envKill: true }), "PLANNER")).toBe("KILL_SWITCH_ENV");
    expect(evaluateAiGate(with_({ panelKill: true, org: { enabled: false } }), "PLANNER")).toBe("KILL_SWITCH_PANEL");
  });

  it("the mock needs neither a key nor a connection, but only where AI_MOCK_ENABLED allows it", () => {
    const mock = with_({ secretsKeyOk: false, providerConnected: false, task: { enabled: true, providerKind: "mock", modelId: "mock-ok", currency: null, hasPrices: false } });
    expect(evaluateAiGate({ ...mock, mockEnabled: true }, "PLANNER")).toBe("READY");
    expect(evaluateAiGate({ ...mock, mockEnabled: false }, "PLANNER")).toBe("TASK_NOT_MAPPED");
  });

  it("the per-request cap of the adjustments task is its own", () => {
    const plan = { ...ready().plan!, perRequestCapAdjustment: 0 };
    expect(evaluateAiGate(with_({ plan }), "ADJUSTMENTS")).toBe("ALLOWANCE_ZERO");
    expect(evaluateAiGate(with_({ plan }), "PLANNER")).toBe("READY");
  });

  it("exhaustion judges the reservation about to be made", () => {
    const month = { ...ready().month!, usedInput: 90_000 };
    expect(evaluateAiGate(with_({ month, need: { input: 5000, output: 5000 } }), "PLANNER")).toBe("READY");
    expect(evaluateAiGate(with_({ month, need: { input: 5000, output: 5001 } }), "PLANNER")).toBe("ALLOWANCE_EXHAUSTED");
  });

  it("a cost cap is ignored without typed prices, enforced with them, and a currency mismatch is its own reason", () => {
    const capped = { ...ready().plan!, costCapMicros: 1_000, costCapCurrency: "USD" as const };
    const spent = { ...ready().month!, costMicros: 1_000 };
    expect(evaluateAiGate(with_({ plan: capped, month: spent }), "PLANNER")).toBe("READY");
    const priced = { enabled: true, providerKind: "openai", modelId: "m", currency: "USD" as const, hasPrices: true };
    expect(evaluateAiGate(with_({ plan: capped, month: spent, task: priced, need: { input: 1, output: 1, costMicros: 1 } }), "PLANNER")).toBe("ALLOWANCE_EXHAUSTED");
    expect(evaluateAiGate(with_({ plan: capped, task: { ...priced, currency: "BRL" } }), "PLANNER")).toBe("COST_CURRENCY_MISMATCH");
    expect(evaluateAiGate(with_({ plan: capped, task: priced, month: { ...ready().month!, costCurrency: "EUR" } }), "PLANNER")).toBe("COST_CURRENCY_MISMATCH");
  });
});

describe("circuit breaker rules", () => {
  const T0 = new Date("2026-11-20T12:00:00Z");
  const row = (patch: Partial<CircuitRow>): CircuitRow => ({ state: "CLOSED", consecutiveFailures: 0, firstFailureAt: null, openedAt: null, probeStartedAt: null, ...patch });

  it("only availability failures count; rate limits and model-quality failures do not", () => {
    for (const code of ["SERVER_ERROR", "NETWORK", "TIMEOUT"] as const) expect(countsForCircuit(code)).toBe(true);
    for (const code of ["RATE_LIMIT", "INVALID_JSON", "TRUNCATED", "REFUSED", "AUTH", "BAD_REQUEST", "PROVIDER_QUOTA", "MODEL_NOT_FOUND", "UNKNOWN"] as const) expect(countsForCircuit(code)).toBe(false);
  });

  it("closed allows; open blocks for 60 s then offers the probe; a half-open probe blocks others until it is stale", () => {
    expect(circuitDecision(null, T0, 40_000)).toBe("ALLOW");
    expect(circuitDecision(row({}), T0, 40_000)).toBe("ALLOW");
    const opened = T0.toISOString();
    expect(circuitDecision(row({ state: "OPEN", openedAt: opened }), new Date(T0.getTime() + CIRCUIT_OPEN_MS - 1), 40_000)).toBe("BLOCK");
    expect(circuitDecision(row({ state: "OPEN", openedAt: opened }), new Date(T0.getTime() + CIRCUIT_OPEN_MS), 40_000)).toBe("WAIT_PROBE_CLAIM_OPEN");
    expect(circuitDecision(row({ state: "HALF_OPEN", probeStartedAt: opened }), new Date(T0.getTime() + 39_999), 40_000)).toBe("BLOCK");
    expect(circuitDecision(row({ state: "HALF_OPEN", probeStartedAt: opened }), new Date(T0.getTime() + 40_000), 40_000)).toBe("WAIT_PROBE_CLAIM_STALE");
  });
});
