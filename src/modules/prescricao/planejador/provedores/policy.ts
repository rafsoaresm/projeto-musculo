/**
 * Timeouts and bounded retry around one provider call (design V4 §3.6): at most `maxRetries` (0 or 1) extra attempt, only for retryable
 * codes, after a fixed deterministic pause. Usage of failed attempts is summed (a billed attempt that failed is still spent). Pure but
 * for the injected `sleep`; no logging.
 */
import { AI_RETRY_DELAY_MS } from "../quota";
import type { CallSettings, PlannerProvider, ProviderResult, SafeProviderRequest, Usage } from "./port";

export interface PolicyOptions {
  maxRetries: 0 | 1;
  sleep?: (ms: number) => Promise<void>;
}
export interface PolicyOutcome {
  result: ProviderResult;
  attempts: number;
  /** Tokens reported across all attempts (null when no attempt reported any). */
  usage: Usage | null;
}

const add = (a: number | null, b: number | null) => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));
function sum(a: Usage | null, b: Usage | null): Usage | null {
  if (!a) return b;
  if (!b) return a;
  return {
    inputTokens: add(a.inputTokens, b.inputTokens), outputTokens: add(a.outputTokens, b.outputTokens), cachedInputTokens: add(a.cachedInputTokens, b.cachedInputTokens),
    source: a.source === "PROVIDER" && b.source === "PROVIDER" ? "PROVIDER" : "ESTIMATE",
  };
}

export async function callWithPolicy(provider: PlannerProvider, req: SafeProviderRequest, settings: CallSettings, options: PolicyOptions): Promise<PolicyOutcome> {
  const pause = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let usage: Usage | null = null;
  let attempts = 0;
  for (;;) {
    attempts += 1;
    const result = await provider.call(req, settings);
    usage = sum(usage, result.ok ? result.usage : result.usage);
    if (result.ok || !result.retryable || attempts > options.maxRetries) return { result, attempts, usage };
    await pause(AI_RETRY_DELAY_MS);
  }
}
