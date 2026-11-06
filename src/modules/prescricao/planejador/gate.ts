/**
 * The AI gate (design V4 §3.4): the FIRST failing reason, in a fixed order, else READY. Pure. Advisory UX for professionals: the
 * authoritative checks are repeated inside the conditional reserve statement (`src/db/ai-planning.ts`), so a switch flipped
 * between the gate and the reserve still wins. The gate never reveals provider, model or key detail to professionals.
 */
import { allowanceIsZero, fitsAllowance, withinPerRequestCap, type Allowance, type Currency, type MonthUse, type Need } from "./quota";
import type { AiTask } from "./provedores/port";

export const GATE_REASONS = [
  "KILL_SWITCH_ENV", "KILL_SWITCH_PANEL", "SECRETS_KEY_MISSING", "TASK_NOT_MAPPED", "PROVIDER_NOT_CONNECTED", "ORG_DISABLED", "NO_QUOTA_PLAN",
  "ALLOWANCE_ZERO", "ALLOWANCE_EXHAUSTED", "COST_CURRENCY_MISMATCH", "CIRCUIT_OPEN", "MINOR_BLOCKED", "REQUEST_TOO_LARGE",
] as const;
export type GateReason = (typeof GATE_REASONS)[number];

export interface AiGateState {
  envKill: boolean;
  panelKill: boolean;
  /** The server secret that encrypts provider keys is configured (needed to READ a stored key). */
  secretsKeyOk: boolean;
  mockEnabled: boolean;
  /** The task row; null when missing. */
  task: { enabled: boolean; providerKind: string | null; modelId: string | null; currency: Currency | null; hasPrices: boolean } | null;
  /** A connection row exists for the task's provider (irrelevant for `mock`). */
  providerConnected: boolean;
  org: { enabled: boolean } | null;
  plan: {
    archived: boolean;
    allowance: Allowance;
    perRequestCapPlanning: number;
    perRequestCapAdjustment: number;
    costCapMicros: number | null;
    costCapCurrency: Currency | null;
  } | null;
  month: (MonthUse & { costMicros: number; reservedCostMicros: number; costCurrency: Currency | null }) | null;
  circuitOpen: boolean;
  /** Known age under 18 (checked after the context is built). */
  minor?: boolean;
  /** The reservation about to be made (omitted: "exhausted" means nothing is left at all). */
  need?: Need & { costMicros?: number };
  /** The worst-case output does not fit the hard ceiling. */
  requestTooLarge?: boolean;
  /** Input estimate + effective max output of ONE attempt: judged against the plan's per-request cap. */
  perAttemptTokens?: number;
}

const ZERO_MONTH: MonthUse & { costMicros: number; reservedCostMicros: number; costCurrency: Currency | null } = {
  usedInput: 0, usedOutput: 0, reservedInput: 0, reservedOutput: 0, costMicros: 0, reservedCostMicros: 0, costCurrency: null,
};

export function evaluateAiGate(state: AiGateState, task: AiTask): "READY" | GateReason {
  if (state.envKill) return "KILL_SWITCH_ENV";
  if (state.panelKill) return "KILL_SWITCH_PANEL";
  const mapped = state.task && state.task.enabled && state.task.providerKind && state.task.modelId ? state.task : null;
  const usesMock = mapped?.providerKind === "mock";
  if (!usesMock && !state.secretsKeyOk) return "SECRETS_KEY_MISSING";
  if (!mapped || (usesMock && !state.mockEnabled)) return "TASK_NOT_MAPPED";
  if (!usesMock && !state.providerConnected) return "PROVIDER_NOT_CONNECTED";
  if (!state.org?.enabled) return "ORG_DISABLED";
  if (!state.plan || state.plan.archived) return "NO_QUOTA_PLAN";
  const cap = task === "PLANNER" ? state.plan.perRequestCapPlanning : state.plan.perRequestCapAdjustment;
  if (allowanceIsZero(state.plan.allowance) || cap <= 0) return "ALLOWANCE_ZERO";
  const month = state.month ?? ZERO_MONTH;
  const need = state.need ?? { input: 0, output: 1 };
  if (!fitsAllowance(state.plan.allowance, month, need)) return "ALLOWANCE_EXHAUSTED";
  if (state.plan.costCapMicros !== null && mapped.hasPrices) {
    const currencies = [state.plan.costCapCurrency, mapped.currency, month.costCurrency].filter((c): c is Currency => c !== null);
    if (state.plan.costCapCurrency !== mapped.currency || (month.costCurrency !== null && month.costCurrency !== state.plan.costCapCurrency) || new Set(currencies).size > 1) {
      return "COST_CURRENCY_MISMATCH";
    }
    if (month.costMicros + month.reservedCostMicros + (state.need?.costMicros ?? 0) > state.plan.costCapMicros) return "ALLOWANCE_EXHAUSTED";
  }
  if (state.circuitOpen) return "CIRCUIT_OPEN";
  if (state.minor) return "MINOR_BLOCKED";
  if (state.requestTooLarge) return "REQUEST_TOO_LARGE";
  if (state.perAttemptTokens !== undefined && !withinPerRequestCap(cap, state.perAttemptTokens, 0)) return "REQUEST_TOO_LARGE";
  return "READY";
}
