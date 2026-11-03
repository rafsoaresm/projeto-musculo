"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/modules/auth/server";
import { assessmentTemplatesFor } from "@/db/assessment-templates";

const BASE = "/profissional/avaliacoes/modelos";
const INVALID = "Dê um nome ao modelo (até 80 caracteres) e confira a ordem das etapas.";

/** Creates a model of the Avaliação Física of the organization of the session, then goes back to the list. */
export async function createAssessmentTemplate(input: unknown): Promise<{ error?: string }> {
  const { db, context } = await requireWorkspace();
  const outcome = await assessmentTemplatesFor(db, context).create(input);
  if (outcome.status === "invalid") return { error: INVALID };
  if (outcome.status !== "saved") return { error: "Só o responsável, o gestor ou um profissional técnico do espaço cria modelos." };
  revalidatePath("/profissional", "layout");
  redirect(`${BASE}?salvo=${outcome.id}`);
}

/**
 * Edits a model: a new version, based on the version the screen read. The drafts already started keep the version they started with; the
 * assessments recorded never change.
 */
export async function updateAssessmentTemplate(id: string, input: unknown, version: number): Promise<{ error?: string }> {
  const { db, context } = await requireWorkspace();
  const outcome = await assessmentTemplatesFor(db, context).update(id, input, version);
  if (outcome.status === "invalid") return { error: INVALID };
  if (outcome.status === "conflict") return { error: "Este modelo foi alterado em outra aba ou por outra pessoa. Recarregue para ver a versão atual." };
  if (outcome.status === "not_found") return { error: "Este modelo não pode mais ser editado." };
  revalidatePath("/profissional", "layout");
  redirect(`${BASE}?salvo=${outcome.id}`);
}

/** Archives a model (it is no longer offered when an assessment starts) or brings it back. */
export async function archiveAssessmentTemplate(id: string, archived: boolean): Promise<{ error?: string }> {
  const { db, context } = await requireWorkspace();
  const done = await assessmentTemplatesFor(db, context).setArchived(id, archived);
  if (!done) return { error: "Não foi possível alterar este modelo." };
  revalidatePath("/profissional", "layout");
  return {};
}
