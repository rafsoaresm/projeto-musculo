/**
 * The new format of the assessment (handoff "Avaliação Física V2") is open by default (user's decision of 03/11/2026: the assessment is not hidden
 * behind a switch). The environment can still close it with exactly "false" (a variable on the Worker wins; one created in the Webflow dashboard
 * reaches `process.env`), as a way back if something goes wrong in production.
 */
export type AssessmentV2Env = { ASSESSMENT_V2_ENABLED?: string };

export function assessmentV2Open(env: AssessmentV2Env, processEnv: Record<string, string | undefined>): boolean {
  return (env.ASSESSMENT_V2_ENABLED || processEnv.ASSESSMENT_V2_ENABLED) !== "false";
}
