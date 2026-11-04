/**
 * Input adapter of the automatic prescription (motor S5, design §2). Server only: it reads the student's records through the
 * gated repositories and builds the engine input. Server actions (S6) import from here, never from `context.ts` directly.
 */
import "server-only";

export { loadGenerationContext, type LoadOutcome } from "./context";
export { buildEngineInput, goalSuggestions, type BuildOptions } from "./build-input";
export type { GenerationContext, AssessmentRecord } from "./facts";
export {
  parseGenerationAnswers,
  type BuildOutcome,
  type GenerationAnswers,
  type GenerationFactRefs,
  type GenerationQuestion,
} from "./contracts";
