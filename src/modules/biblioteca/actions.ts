"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireWorkspace } from "@/modules/auth/server";
import { exercisesFor, type SaveOutcome } from "@/db/exercises";

const DUPLICATE =
  "Já existe um exercício ativo com este nome na sua biblioteca. Use outro nome ou arquive o outro.";
const NOT_FOUND = "Exercício não encontrado na sua biblioteca.";

function fromForm(form: FormData) {
  const text = (key: string) => {
    const value = form.get(key);
    return typeof value === "string" ? value : "";
  };
  return {
    name: text("name"),
    category: text("category"),
    level: text("level"),
    videoUrl: text("videoUrl"),
    videoVerified: form.get("videoVerified") === "on",
    notes: text("notes"),
  };
}
function messageFor(error: unknown): string {
  if (error instanceof ZodError) {
    if (error.issues.some((issue) => issue.path[0] === "videoUrl"))
      return "O vídeo precisa ser um link https do YouTube ou do Vimeo.";
    return "Confira os campos: o nome tem de 1 a 120 caracteres, a categoria é uma das listadas e as notas têm até 1000.";
  }
  return "Não foi possível concluir. Tente novamente.";
}
const refresh = () => revalidatePath("/profissional/biblioteca", "layout");

function outcomeMessage(outcome: SaveOutcome): string | null {
  if (outcome.status === "duplicate") return DUPLICATE;
  if (outcome.status === "conflict")
    return "Este exercício foi alterado por outra pessoa. Recarregue a página e refaça a alteração.";
  if (outcome.status === "not_found") return NOT_FOUND;
  return null;
}

/** Create (id null) or edit one of the organization's own exercises. */
export async function saveExercise(
  id: string | null,
  _previous: string,
  form: FormData,
): Promise<string> {
  const { db, context } = await requireWorkspace();
  const library = exercisesFor(db, context);
  let outcome: SaveOutcome;
  try {
    outcome = id
      ? await library.update(id, fromForm(form))
      : await library.create(fromForm(form));
  } catch (error) {
    return messageFor(error);
  }
  const problem = outcomeMessage(outcome);
  if (problem) return problem;
  refresh();
  if (!id && outcome.status === "saved")
    redirect(`/profissional/biblioteca/${outcome.id}`);
  return "Alterações salvas.";
}

export async function copySystemExercise(systemId: string): Promise<string> {
  const { db, context } = await requireWorkspace();
  let outcome: SaveOutcome;
  try {
    outcome = await exercisesFor(db, context).copyFromSystem(systemId);
  } catch {
    return "Não foi possível concluir. Tente novamente.";
  }
  if (outcome.status === "duplicate")
    return "Você já tem uma cópia deste exercício na sua biblioteca.";
  const problem = outcomeMessage(outcome);
  if (problem) return problem;
  refresh();
  redirect(`/profissional/biblioteca/${(outcome as { id: string }).id}`);
}

export async function archiveExercise(id: string): Promise<string> {
  const { db, context } = await requireWorkspace();
  try {
    if (!(await exercisesFor(db, context).archive(id))) return NOT_FOUND;
  } catch {
    return "Não foi possível concluir. Tente novamente.";
  }
  refresh();
  return "Exercício arquivado. Prescrições já feitas continuam como estavam.";
}

export async function restoreExercise(id: string): Promise<string> {
  const { db, context } = await requireWorkspace();
  let outcome: SaveOutcome;
  try {
    outcome = await exercisesFor(db, context).restore(id);
  } catch {
    return "Não foi possível concluir. Tente novamente.";
  }
  const problem = outcomeMessage(outcome);
  if (problem) return problem;
  refresh();
  return "Exercício restaurado.";
}
