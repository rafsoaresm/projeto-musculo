"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireWorkspace } from "@/modules/auth/server";
import { exercisesFor, type SaveOutcome } from "@/db/exercises";
import {
  exerciseMetadataFor,
  type EnrichOutcome,
  type MetadataWriteOutcome,
  type RelationOutcome,
} from "@/db/exercise-metadata";
import { isMetadataField, valueFromForm } from "./metadata/fields";
import { MAX_ALTERNATIVES } from "./metadata/vocabulary";

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

// ---------- Metadata for the automatic prescription (motor S4) ----------

const METADATA_MESSAGES = {
  saved: "Salvo como revisado por você.",
  pending: "Campo marcado como pendente de curadoria. Ele não será usado na seleção automática até alguém revisá-lo.",
  conflict: "Este campo foi alterado por outra pessoa. Recarregue a página e confira antes de salvar.",
  invalid:
    "Escolha um valor válido para este campo (numa lista, marque ao menos um item ou a opção \"nenhum\"). Se não souber, marque como pendente.",
  not_found: NOT_FOUND,
  failed: "Não foi possível concluir. Tente novamente.",
} as const;

function metadataMessage(outcome: MetadataWriteOutcome, done: string): string {
  return outcome.status === "saved" ? done : METADATA_MESSAGES[outcome.status];
}
/** The version of the organization's row the form was built on ("" when it had none): the compare-and-set token. */
function versionFrom(form: FormData): number | null {
  const raw = form.get("version");
  const value = typeof raw === "string" && /^\d{1,9}$/.test(raw) ? Number(raw) : null;
  return value !== null && value >= 1 ? value : null;
}

/** "Salvar como revisado por mim": the value in the form, in the organization's scope. */
export async function saveExerciseAttribute(
  exerciseId: string,
  field: string,
  _previous: string,
  form: FormData,
): Promise<string> {
  if (!isMetadataField(field)) return METADATA_MESSAGES.invalid;
  const { db, context } = await requireWorkspace();
  try {
    const outcome = await exerciseMetadataFor(db, context).setField(
      exerciseId,
      field,
      valueFromForm(field, form),
      versionFrom(form),
    );
    if (outcome.status === "saved") refresh();
    return metadataMessage(outcome, METADATA_MESSAGES.saved);
  } catch {
    return METADATA_MESSAGES.failed;
  }
}

export async function markExerciseAttributePending(
  exerciseId: string,
  field: string,
  _previous: string,
  form: FormData,
): Promise<string> {
  if (!isMetadataField(field)) return METADATA_MESSAGES.invalid;
  const { db, context } = await requireWorkspace();
  try {
    const outcome = await exerciseMetadataFor(db, context).markPending(exerciseId, field, versionFrom(form));
    if (outcome.status === "saved") refresh();
    return metadataMessage(outcome, METADATA_MESSAGES.pending);
  } catch {
    return METADATA_MESSAGES.failed;
  }
}

export async function addExerciseAlternative(exerciseId: string, _previous: string, form: FormData): Promise<string> {
  const target = form.get("alternativeId");
  if (typeof target !== "string" || !target) return "Escolha o exercício alternativo.";
  const { db, context } = await requireWorkspace();
  let outcome: RelationOutcome;
  try {
    outcome = await exerciseMetadataFor(db, context).addAlternative(exerciseId, target);
  } catch {
    return METADATA_MESSAGES.failed;
  }
  switch (outcome.status) {
    case "saved":
      refresh();
      return "Alternativa adicionada e marcada como revisada por você.";
    case "duplicate":
      return "Este exercício já é uma alternativa.";
    case "too_many":
      return `Limite técnico de ${MAX_ALTERNATIVES} alternativas por exercício.`;
    case "invalid":
      return "Um exercício não pode ser alternativa dele mesmo.";
    default:
      return NOT_FOUND;
  }
}

export async function removeExerciseAlternative(relationId: string): Promise<string> {
  const { db, context } = await requireWorkspace();
  try {
    if (!(await exerciseMetadataFor(db, context).removeAlternative(relationId)))
      return "Alternativa não encontrada (ela pode ter sido removida por outra pessoa).";
  } catch {
    return METADATA_MESSAGES.failed;
  }
  refresh();
  return "Alternativa removida.";
}

/** "Inferir metadados das minhas fichas": the documented name rules on the organization's own exercises. */
export async function enrichLibrary(): Promise<string> {
  const { db, context } = await requireWorkspace();
  let outcome: EnrichOutcome;
  try {
    outcome = await exerciseMetadataFor(db, context).enrichOrganization();
  } catch {
    return METADATA_MESSAGES.failed;
  }
  if (outcome.status !== "done") return "Não foi possível concluir. Tente novamente.";
  refresh();
  if (outcome.exercises === 0)
    return "Sua biblioteca ainda não tem exercícios próprios. Os do sistema já vêm com metadados inferidos.";
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const parts = [
    plural(outcome.inferred, "campo inferido", "campos inferidos"),
    `${outcome.unchanged} sem mudança`,
    plural(
      outcome.keptByPerson,
      "mantido porque alguém revisou ou marcou como pendente",
      "mantidos porque alguém revisou ou marcou como pendente",
    ),
  ];
  if (outcome.cleared) parts.push(plural(outcome.cleared, "voltou a pendente", "voltaram a pendente"));
  return `Inferência concluída em ${plural(outcome.exercises, "exercício", "exercícios")} da sua biblioteca: ${parts.join(", ")}. Os valores inferidos aparecem como "Inferido (não revisado)" até alguém revisá-los.`;
}
