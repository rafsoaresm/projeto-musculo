/**
 * Circuit breaker rules (design V4 §3.6), pure. The state lives in `ai_circuit_state` per (provider, model) and is moved by
 * compare-and-set statements in `src/db/ai-planning.ts`; the constants and the classification live here so both agree.
 *
 * After 5 consecutive failures with codes in COUNTED_CODES within 120 s the circuit OPENs for 60 s, then HALF_OPEN lets exactly one
 * probe through (a probe older than the stale threshold is considered crashed and can be re-claimed). RATE_LIMIT is deliberately NOT
 * counted (429s are mostly per-key throttling and would let one organization open the circuit for all); invalid JSON, refusal and
 * truncation are model quality, not availability, and do not trip it either.
 */
import type { ProviderErrorCode } from "./provedores/port";

export const CIRCUIT_COUNTED_CODES: readonly ProviderErrorCode[] = ["SERVER_ERROR", "NETWORK", "TIMEOUT"];
export const CIRCUIT_FAILURE_THRESHOLD = 5;
export const CIRCUIT_WINDOW_MS = 120_000;
export const CIRCUIT_OPEN_MS = 60_000;

export const countsForCircuit = (code: ProviderErrorCode): boolean => CIRCUIT_COUNTED_CODES.includes(code);

export interface CircuitRow {
  state: "CLOSED" | "OPEN" | "HALF_OPEN";
  consecutiveFailures: number;
  firstFailureAt: string | null;
  openedAt: string | null;
  probeStartedAt: string | null;
}
export type CircuitDecision = "ALLOW" | "PROBE" | "BLOCK" | "WAIT_PROBE_CLAIM_OPEN" | "WAIT_PROBE_CLAIM_STALE";

/** What a caller may do now. PROBE/…_CLAIM_* mean "try the compare-and-set that claims the single probe". */
export function circuitDecision(row: CircuitRow | null, now: Date, staleMs: number): CircuitDecision {
  if (!row || row.state === "CLOSED") return "ALLOW";
  const t = now.getTime();
  if (row.state === "OPEN") return row.openedAt && t - Date.parse(row.openedAt) >= CIRCUIT_OPEN_MS ? "WAIT_PROBE_CLAIM_OPEN" : "BLOCK";
  return row.probeStartedAt && t - Date.parse(row.probeStartedAt) < staleMs ? "BLOCK" : "WAIT_PROBE_CLAIM_STALE";
}
