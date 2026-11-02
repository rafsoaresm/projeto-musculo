/**
 * The switch of the new format of the assessment (handoff "Avaliação Física V2"). While it is being built it stays closed: it opens only when
 * the environment says exactly "true". A variable declared on the Worker wins; one created in the Webflow dashboard reaches `process.env`
 * instead (the same two roads as the photos and the public forms). Absent means closed, so production is unchanged until it is opened on purpose.
 */
export type AssessmentV2Env = { ASSESSMENT_V2_ENABLED?: string };

export function assessmentV2Open(env: AssessmentV2Env, processEnv: Record<string, string | undefined>): boolean {
  return (env.ASSESSMENT_V2_ENABLED || processEnv.ASSESSMENT_V2_ENABLED) === "true";
}
