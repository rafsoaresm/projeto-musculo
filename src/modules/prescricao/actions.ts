"use server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireWorkspace } from "@/modules/auth/server";
import { prescriptionFor, type ItemOutcome, type Target } from "@/db/prescription";

/** What the browser gets back. A message is shown as is, so it holds no plan data. */
export type PrescriptionResult = { error?: string; notice?: string } | void;

const NOT_OPEN =
  "Não foi possível alterar. A revisão pode já estar fechada ou o exercício não está mais disponível.";

function messageFor(error: unknown): string {
  if (error instanceof ZodError) {
    const paths = error.issues.map((issue) => String(issue.path[0] ?? ""));
    if (paths.includes("videoUrl"))
      return "O vídeo precisa ser um link https do YouTube ou do Vimeo.";
    if (paths.includes("rirMin"))
      return "O RIR mínimo não pode ser maior que o máximo.";
    return "Confira os campos: texto curto nas séries, repetições, carga, cadência e descanso, e números inteiros no RIR (0 a 10) e no descanso em segundos.";
  }
  return "Não foi possível concluir. Tente novamente.";
}
function outcome(result: ItemOutcome): PrescriptionResult {
  if (result.status === "saved") return;
  if (result.status === "full")
    return { error: "Este treino já tem o máximo de exercícios." };
  if (result.status === "conflict")
    return { error: "O treino mudou enquanto você editava. Tente de novo." };
  if (result.status === "invalid_target")
    return { error: "Esse treino não existe na estrutura salva." };
  return { error: NOT_OPEN };
}
const refresh = () => revalidatePath("/profissional/alunos", "layout");

export async function addExercise(
  planId: string,
  revisionId: string,
  target: Target,
  source: { exerciseId: string } | { customName: string },
): Promise<PrescriptionResult> {
  const { db, context } = await requireWorkspace();
  try {
    const result = outcome(
      await prescriptionFor(db, context).add(planId, revisionId, target, source),
    );
    if (!result) refresh();
    return result;
  } catch (error) {
    return { error: messageFor(error) };
  }
}

export async function updateItem(
  planId: string,
  revisionId: string,
  itemId: string,
  fields: unknown,
  customName?: string,
): Promise<PrescriptionResult> {
  const { db, context } = await requireWorkspace();
  try {
    if (
      !(await prescriptionFor(db, context).update(
        planId,
        revisionId,
        itemId,
        fields,
        customName,
      ))
    )
      return { error: NOT_OPEN };
  } catch (error) {
    return { error: messageFor(error) };
  }
  refresh();
}

export async function removeItem(
  planId: string,
  revisionId: string,
  itemId: string,
): Promise<PrescriptionResult> {
  const { db, context } = await requireWorkspace();
  try {
    if (!(await prescriptionFor(db, context).remove(planId, revisionId, itemId)))
      return { error: NOT_OPEN };
  } catch (error) {
    return { error: messageFor(error) };
  }
  refresh();
}

export async function moveItems(
  planId: string,
  revisionId: string,
  target: Target,
  orderedIds: string[],
): Promise<PrescriptionResult> {
  const { db, context } = await requireWorkspace();
  try {
    if (
      !(await prescriptionFor(db, context).reorder(
        planId,
        revisionId,
        target,
        orderedIds,
      ))
    )
      return { error: "A ordem não pôde ser alterada. Recarregue a página." };
  } catch (error) {
    return { error: messageFor(error) };
  }
  refresh();
}

export async function duplicateItem(
  planId: string,
  revisionId: string,
  itemId: string,
): Promise<PrescriptionResult> {
  const { db, context } = await requireWorkspace();
  try {
    const result = outcome(
      await prescriptionFor(db, context).duplicate(planId, revisionId, itemId),
    );
    if (!result) refresh();
    return result;
  } catch (error) {
    return { error: messageFor(error) };
  }
}

export async function replaceItem(
  planId: string,
  revisionId: string,
  itemId: string,
  exerciseId: string,
): Promise<PrescriptionResult> {
  const { db, context } = await requireWorkspace();
  try {
    if (
      !(await prescriptionFor(db, context).replaceExercise(
        planId,
        revisionId,
        itemId,
        exerciseId,
      ))
    )
      return { error: NOT_OPEN };
  } catch (error) {
    return { error: messageFor(error) };
  }
  refresh();
}

export async function copyWorkout(
  planId: string,
  revisionId: string,
  from: Target,
  to: Target,
): Promise<PrescriptionResult> {
  const { db, context } = await requireWorkspace();
  try {
    const result = await prescriptionFor(db, context).copyWorkout(
      planId,
      revisionId,
      from,
      to,
    );
    if (result.status === "saved") {
      refresh();
      return;
    }
    if (result.status === "destination_not_empty")
      return { error: "O treino de destino já tem exercícios. Remova-os antes de copiar." };
    if (result.status === "empty_source")
      return { error: "O treino de origem não tem exercícios." };
    if (result.status === "invalid_target")
      return { error: "Esse treino não existe na estrutura salva." };
    return { error: NOT_OPEN };
  } catch (error) {
    return { error: messageFor(error) };
  }
}

export async function copyMesocycle(
  planId: string,
  revisionId: string,
  fromPhase: number,
  toPhase: number,
): Promise<PrescriptionResult> {
  const { db, context } = await requireWorkspace();
  try {
    const result = await prescriptionFor(db, context).copyPhase(
      planId,
      revisionId,
      fromPhase,
      toPhase,
    );
    if (result.status === "saved") {
      refresh();
      return result.skipped.length
        ? {
            notice: `Copiado. Não há treino ${result.skipped.join(", ")} na fase de destino, então esses exercícios não foram copiados.`,
          }
        : { notice: "Mesociclo copiado." };
    }
    if (result.status === "destination_not_empty")
      return { error: "A fase de destino já tem exercícios. Remova-os antes de copiar." };
    if (result.status === "empty_source")
      return { error: "A fase de origem não tem exercícios." };
    if (result.status === "no_common_workouts")
      return { error: "A fase de destino não tem nenhum dos treinos da origem." };
    if (result.status === "invalid_target")
      return { error: "Essa fase não existe na estrutura salva." };
    return { error: NOT_OPEN };
  } catch (error) {
    return { error: messageFor(error) };
  }
}
