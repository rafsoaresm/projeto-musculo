"use server";
import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/modules/auth/server";
import { assessmentsFor } from "@/db/assessments";

export type AssessmentResult = { error?: string; saved?: boolean };

const refresh = () => revalidatePath("/profissional", "layout");

/**
 * The professional's documented review of an alert of a recorded assessment of the earlier format (it still holds a plan approval until it
 * is reviewed). The earlier format can no longer be started, filled or recorded (user's decision of 03/11/2026): those actions are gone.
 */
export async function reviewAssessment(
  assessmentId: string,
  basis: string,
): Promise<AssessmentResult> {
  const { db, context } = await requireWorkspace();
  try {
    if (!(await assessmentsFor(db, context).addReview(assessmentId, basis)))
      return { error: "Esta avaliação não pede revisão ou não está no seu atendimento." };
  } catch (error) {
    if (error instanceof Error && error.message === "REVIEW_BASIS_INVALID")
      return { error: "Descreva em que você se baseou para a revisão, com até 1000 caracteres." };
    return { error: "Não foi possível concluir. Tente novamente." };
  }
  refresh();
  return { saved: true };
}
