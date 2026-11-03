/**
 * The names the screens give an assessment. There is one assessment, the "Avaliação Física" (user's decision of 03/11/2026); the records of the
 * earlier format (format_version NULL) stay readable in the history under their own name, so nobody takes them for the new one.
 */
export const ASSESSMENT_NAME = "Avaliação Física";

export type AssessmentNaming = { kind: "INITIAL" | "REASSESSMENT"; formatVersion: number | null };

/** "Avaliação física", "Reavaliação física" or "Avaliação (formato anterior)". */
export function assessmentTitle(assessment: AssessmentNaming): string {
  if (assessment.formatVersion === null) return "Avaliação (formato anterior)";
  return assessment.kind === "INITIAL" ? "Avaliação física" : "Reavaliação física";
}
