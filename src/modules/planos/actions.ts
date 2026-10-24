"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireWorkspace } from "@/modules/auth/server";
import { plansFor } from "@/db/plans";

/** What the browser gets back. A message is shown as is, so it holds no plan data. */
export type PlanActionResult = { error?: string } | void;

const NOT_FOUND = "Plano não encontrado no seu atendimento.";
const NOT_DRAFT =
  "Esta revisão não está mais em rascunho. Crie uma nova revisão para alterar.";

function messageFor(error: unknown): string {
  if (error instanceof Error && error.message === "PLAN_TITLE_INVALID")
    return "Dê um nome ao plano, com até 120 caracteres.";
  if (error instanceof Error && error.message === "PRESCRIPTION_WOULD_BE_LOST")
    return "Esta mudança remove treinos que já têm exercícios. Remova ou mova esses exercícios antes de alterar o número de fases ou a divisão.";
  if (error instanceof ZodError)
    return "Confira a data inicial e os limites de cada fase.";
  return "Não foi possível concluir. Tente novamente.";
}
const refresh = () => revalidatePath("/profissional/alunos", "layout");

/** The student comes from the page; access is still checked in the repository. */
export async function createPlan(
  studentId: string,
  payload: { title?: string; input: unknown },
): Promise<PlanActionResult> {
  const { db, context } = await requireWorkspace();
  let created: { planId: string; revisionId: string } | null;
  try {
    created = await plansFor(db, context).create(studentId, {
      title: payload.title,
      input: payload.input,
    });
  } catch (error) {
    return { error: messageFor(error) };
  }
  if (!created) return { error: "Aluno não encontrado no seu atendimento." };
  refresh();
  // The student id was just verified by the insert above, so the address is a real one.
  redirect(
    `/profissional/alunos/${studentId}/planos/${created.planId}/${created.revisionId}`,
  );
}

export async function saveDraft(
  planId: string,
  revisionId: string,
  payload: { input: unknown },
): Promise<PlanActionResult> {
  const { db, context } = await requireWorkspace();
  try {
    if (!(await plansFor(db, context).saveDraft(planId, revisionId, payload.input)))
      return { error: NOT_DRAFT };
  } catch (error) {
    return { error: messageFor(error) };
  }
  refresh();
}

export async function markReady(
  planId: string,
  revisionId: string,
): Promise<PlanActionResult> {
  const { db, context } = await requireWorkspace();
  try {
    if (!(await plansFor(db, context).markReady(planId, revisionId)))
      return { error: NOT_DRAFT };
  } catch (error) {
    return { error: messageFor(error) };
  }
  refresh();
}

export async function createRevision(
  planId: string,
  sourceRevisionId: string,
): Promise<PlanActionResult> {
  const { db, context } = await requireWorkspace();
  const plans = plansFor(db, context);
  let revisionId: string;
  try {
    const result = await plans.newRevisionFrom(planId, sourceRevisionId);
    if (result.status === "draft_open")
      return { error: "Já existe um rascunho aberto neste plano." };
    if (result.status === "not_found") return { error: NOT_FOUND };
    revisionId = result.revisionId;
  } catch (error) {
    return { error: messageFor(error) };
  }
  const created = await plans.findRevision(planId, revisionId);
  if (!created) return { error: NOT_FOUND };
  refresh();
  redirect(
    `/profissional/alunos/${created.plan.studentId}/planos/${planId}/${revisionId}`,
  );
}

/**
 * Approval is the professional's act. The checkbox is the acknowledgement that no screening is
 * registered for this student; it is stored as what was known, never as a clearance.
 */
export async function approveRevision(
  planId: string,
  revisionId: string,
  screeningNotRecorded: boolean,
): Promise<PlanActionResult> {
  const { db, context } = await requireWorkspace();
  try {
    const result = await plansFor(db, context).approve(planId, revisionId, {
      screeningNotRecorded,
    });
    if (result.status === "below_target")
      return {
        error: `Há ${result.below} ${result.below === 1 ? "treino abaixo do alvo" : "treinos abaixo do alvo"}. Crie uma nova revisão para completar os exercícios ou ajustar o alvo.`,
      };
    if (result.status === "screening_acknowledgement_required")
      return { error: "Confirme o aviso sobre a triagem para aprovar." };
    if (result.status === "not_found")
      return { error: "Esta revisão não está pronta para aprovação." };
  } catch (error) {
    return { error: messageFor(error) };
  }
  refresh();
}

export async function deliverRevision(
  planId: string,
  revisionId: string,
): Promise<PlanActionResult> {
  const { db, context } = await requireWorkspace();
  try {
    if (!(await plansFor(db, context).deliver(planId, revisionId)))
      return { error: "Esta revisão não está aprovada para entrega." };
  } catch (error) {
    return { error: messageFor(error) };
  }
  refresh();
}
