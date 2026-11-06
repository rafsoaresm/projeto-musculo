/**
 * Versions and technical bounds of the V4 planner contracts (design V4 §2.1). Pure: no `server-only`, database, network or clock.
 * Every number below is a technical bound or a HEURISTIC operational constant, not a training rule; the ones marked HEURISTIC
 * are for the Técnico to confirm (docs/PENDENCIAS.md).
 */
export const PLANNING_CONTEXT_VERSION = 1 as const;
/** Wire response + stored blueprint shape. */
export const BLUEPRINT_VERSION = 1 as const;
/** `answers.blueprint` shape (PR 2). */
export const COMPILE_VERSION = 1 as const;
/** Distinct from `automatica/ai` AI_PROMPT_VERSION (the disabled post-proposal review). */
export const PLANNER_PROMPT_VERSION = "planner-2026.11.1";
export const ADJUST_PROMPT_VERSION = "adjust-2026.11.1";
/** Rules-mode producer tables while they live in code (PR 1.3); "2026.11.5" once they move into the ruleset. */
export const RULES_TEMPLATES_INTERIM = "interim-1";
/** Table of role -> focus the deltas are relative to, while it lives in code. */
export const ROLE_FOCUS_INTERIM = "interim-1";

export const PLANNER_MAX_PHASES = 12;
export const PLANNER_MAX_WORKOUTS_PER_PHASE = 8;
export const PLANNER_MAX_CANDIDATES_PER_WORKOUT = 6;
/** Shortlist of library exercises (aliases X1..Xn) a request may carry. */
export const PLANNER_MAX_CANDIDATES = 48;
/** Total items across the eight delta lists of one workout. */
export const FOCUS_DELTA_MAX_ITEMS = 12;
/** HEURISTIC: share of a role's default dominant muscles / target patterns a delta may NOT remove (otherwise the role must be CUSTOM). */
export const ROLE_DRIFT_MIN_KEPT = 0.5;
/** Largest response (JSON characters) the validator takes. */
export const PLANNER_MAX_RESPONSE_CHARS = 60_000;
/** HEURISTIC history bands: NONE = 0, FEW = 1..9, MANY >= 10. */
export const HISTORY_BAND_FEW_MAX = 9;
/** Technical cap on `sessionMinutes` in the context. */
export const CONTEXT_MAX_SESSION_MINUTES = 180;
