"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireWorkspace } from "@/modules/auth/server";
import { assessmentsFor } from "@/db/assessments";

export type AssessmentResult = { error?: string; saved?: boolean };

const NOT_FOUND = "Avaliação não encontrada no seu atendimento.";
const refresh = () => revalidatePath("/profissional", "layout");

function messageFor(error: unknown): string {
  if (error instanceof ZodError) {
    const where = new Set(error.issues.map((issue) => String(issue.path[0] ?? "")));
    if (where.has("assessedOn")) return "Confira a data da avaliação: ela não pode estar no futuro.";
    if (where.has("metrics")) {
      const message = error.issues.find((issue) => issue.path[0] === "metrics")?.message;
      if (message === "METRIC_NAME_REQUIRED") return "Dê um nome à medida ou ao teste.";
      return "Confira os indicadores: o valor não bate com o tipo escolhido (por exemplo, pressão como 120/80).";
    }
    return "Confira os campos: algum valor está fora do permitido ou longo demais.";
  }
  if (error instanceof Error && error.message === "REVIEW_BASIS_INVALID")
    return "Descreva em que você se baseou para a revisão, com até 1000 caracteres.";
  return "Não foi possível concluir. Tente novamente.";
}

/** Opens the draft and goes to it. Asking again returns the one that is already open. */
export async function startAssessment(studentId: string): Promise<AssessmentResult> {
  const { db, context } = await requireWorkspace();
  const started = await assessmentsFor(db, context).startDraft(studentId);
  if (started.status === "not_found") return { error: "Aluno não encontrado no seu atendimento." };
  refresh();
  redirect(`/profissional/alunos/${studentId}/avaliacoes/${started.id}`);
}

export async function saveAssessment(
  assessmentId: string,
  payload: unknown,
): Promise<AssessmentResult> {
  const { db, context } = await requireWorkspace();
  try {
    if (!(await assessmentsFor(db, context).saveDraft(assessmentId, payload)))
      return { error: "Este rascunho não está mais aberto para edição." };
  } catch (error) {
    return { error: messageFor(error) };
  }
  refresh();
  return { saved: true };
}

/**
 * Saves what is on the screen and then records it, so the record is exactly what the
 * professional saw. After this the assessment never changes.
 */
export async function recordAssessment(
  assessmentId: string,
  payload: unknown,
  screeningAsked: boolean,
): Promise<AssessmentResult> {
  const { db, context } = await requireWorkspace();
  const api = assessmentsFor(db, context);
  let studentId: string;
  try {
    if (!(await api.saveDraft(assessmentId, payload)))
      return { error: "Este rascunho não está mais aberto para edição." };
    const result = await api.record(assessmentId, { screeningAsked });
    if (result.status === "confirmation_required")
      return { error: "Confirme que os seis itens da triagem foram perguntados ao aluno." };
    if (result.status === "not_found") return { error: NOT_FOUND };
    studentId = (await api.get(assessmentId))?.studentId ?? "";
  } catch (error) {
    return { error: messageFor(error) };
  }
  refresh();
  redirect(`/profissional/alunos/${studentId}/avaliacoes/${assessmentId}`);
}

export async function reviewAssessment(
  assessmentId: string,
  basis: string,
): Promise<AssessmentResult> {
  const { db, context } = await requireWorkspace();
  try {
    if (!(await assessmentsFor(db, context).addReview(assessmentId, basis)))
      return { error: "Esta avaliação não pede revisão ou não está no seu atendimento." };
  } catch (error) {
    return { error: messageFor(error) };
  }
  refresh();
  return { saved: true };
}
