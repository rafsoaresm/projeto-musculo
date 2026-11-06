/**
 * Environment of the AI layer (design V4 §3.4), resolved from an injected reader so it is pure and testable. The server reader is
 * `env.ts` (Worker env, then `process.env`). Only `AI_PLANNER_DISABLED` and `AI_SECRETS_KEY*` decide anything about gates and keys;
 * the rest are ceilings. There is deliberately no "enabled" variable: the gates are database driven (gestor panel). No variable is `NEXT_PUBLIC_*`.
 */
import { AI_CACHE_TTL_DEFAULT_DAYS, AI_CACHE_TTL_MAX_DAYS, AI_HARD_MAX_OUTPUT_DEFAULT, AI_HARD_TIMEOUT_DEFAULT_MS } from "./quota";
import { secretsConfigFrom, type SecretsConfig } from "./secrets";

export interface AiEnv {
  /** `AI_PLANNER_DISABLED` is any non-empty value except false/0/no/off (fail closed): wins over everything and blocks every provider call, panel tests included. */
  killSwitch: boolean;
  secrets: SecretsConfig | null;
  mockEnabled: boolean;
  hardTimeoutMs: number;
  hardMaxOutputTokens: number;
  cacheTtlDays: number;
}

export const AI_ENV_NAMES = [
  "AI_PLANNER_DISABLED", "AI_SECRETS_KEY", "AI_SECRETS_KEY_ID", "AI_SECRETS_KEY_PREVIOUS", "AI_SECRETS_KEY_PREVIOUS_ID", "AI_MOCK_ENABLED",
  "AI_HARD_TIMEOUT_MS", "AI_HARD_MAX_OUTPUT_TOKENS", "AI_CACHE_TTL_DAYS",
] as const;

function intIn(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

/** Fails closed: any non-empty value turns the emergency switch ON, except the explicit negatives. */
function killSwitchOn(raw: string | undefined): boolean {
  const v = raw?.trim().toLowerCase();
  if (!v) return false;
  return !["false", "0", "no", "off"].includes(v);
}

export function resolveAiEnv(read: (name: string) => string | undefined): AiEnv {
  return {
    killSwitch: killSwitchOn(read("AI_PLANNER_DISABLED")),
    secrets: secretsConfigFrom(read),
    mockEnabled: read("AI_MOCK_ENABLED")?.trim() === "true",
    hardTimeoutMs: intIn(read("AI_HARD_TIMEOUT_MS"), AI_HARD_TIMEOUT_DEFAULT_MS, 2000, 120_000),
    hardMaxOutputTokens: intIn(read("AI_HARD_MAX_OUTPUT_TOKENS"), AI_HARD_MAX_OUTPUT_DEFAULT, 100, 32_000),
    cacheTtlDays: intIn(read("AI_CACHE_TTL_DAYS"), AI_CACHE_TTL_DEFAULT_DAYS, 1, AI_CACHE_TTL_MAX_DAYS),
  };
}
