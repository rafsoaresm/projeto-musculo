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
