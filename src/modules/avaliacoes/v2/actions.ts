"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/modules/auth/server";
import { assessmentsFor } from "@/db/assessments";
import { assessmentPhotosFor } from "@/db/assessment-photos";
import { getPhotoBucket } from "@/db/binding";
import { COMPOSITION_MODULE, FIELD_LABEL, SITE_LABEL, compositionSchema, problemsMessage } from "./composition";

export type SaveSectionResult = { saved: true; revision: number } | { conflict: string } | { error: string };

const CONFLICT_MESSAGE = "Esta avaliação foi alterada em outra aba ou por outra pessoa. Recarregue para ver a versão atual.";

/**
 * Opens a draft of the Avaliação Física (the only assessment that can be started: user's decision of 03/11/2026) and goes to it. When the
 * student already has an open draft, goes to that one (one draft per student); an open draft of the earlier format shows how to discard it.
 */
export async function startAssessment(studentId: string): Promise<{ error?: string }> {
  const { db, context } = await requireWorkspace();
  const started = await assessmentsFor(db, context).startDraft(studentId);
  if (started.status === "not_found") return { error: "Aluno não encontrado no seu atendimento." };
  revalidatePath("/profissional", "layout");
  redirect(`/profissional/alunos/${studentId}/avaliacoes/${started.id}`);
}

/**
 * Discards an open draft, of either format, and goes back to the student's assessments, where a new one can be started. Its postural photos
 * (only a draft of the earlier format can have them) are removed from the private storage first; without the storage such a draft stays, and
 * says why. A recorded assessment is never discarded.
 */
export async function discardAssessmentDraft(studentId: string, assessmentId: string): Promise<{ error?: string }> {
  const { db, context } = await requireWorkspace();
  const api = assessmentsFor(db, context);
  let outcome = await api.discardDraft(assessmentId);
  if (outcome.status === "photos_left") {
    try {
      const photos = assessmentPhotosFor(db, await getPhotoBucket(), context);
      for (const photo of await photos.list(assessmentId)) await photos.remove(assessmentId, photo.view);
    } catch (error) {
      if (error instanceof Error && error.message === "PHOTO_STORAGE_UNAVAILABLE")
        return { error: "Este rascunho tem fotos e o armazenamento de fotos não está disponível agora. Tente de novo mais tarde." };
      throw error;
    }
    outcome = await api.discardDraft(assessmentId);
  }
  if (outcome.status !== "discarded") return { error: "Este rascunho não está mais aberto." };
  revalidatePath("/profissional", "layout");
  redirect(`/profissional/alunos/${studentId}/avaliacoes`);
}

/**
 * Saves the "Medidas" step (module "composition") of an open draft, based on the revision the screen read. The payload is checked here with
 * the module's schema: the screen's own check is a convenience, this one is the rule. It stays in progress: a module is done only when the
 * assessment is finalized (a later step).
 */
export async function saveCompositionSection(assessmentId: string, payload: unknown, revision: number): Promise<SaveSectionResult> {
  const { db, context } = await requireWorkspace();
  const parsed = compositionSchema.safeParse(payload);
  if (!parsed.success) {
    const names = new Set<string>();
    for (const issue of parsed.error.issues) {
      const [first, second] = issue.path.map(String);
      if (first === "skinfolds" && second && second in SITE_LABEL) names.add(SITE_LABEL[second as keyof typeof SITE_LABEL]);
      else if (first && first in FIELD_LABEL) names.add(FIELD_LABEL[first as keyof typeof FIELD_LABEL]);
    }
    return { error: names.size > 0 ? problemsMessage([...names]) : "Confira as medidas: algum valor não é aceito." };
  }
  const outcome = await assessmentsFor(db, context).saveSection(assessmentId, {
    module: COMPOSITION_MODULE,
    status: "IN_PROGRESS",
    payload: parsed.data,
    revision,
  });
  if (outcome.status === "saved") return { saved: true, revision: outcome.revision };
  if (outcome.status === "conflict") return { conflict: CONFLICT_MESSAGE };
  if (outcome.status === "invalid") return { error: "Confira as medidas: algum valor não é aceito." };
  return { error: "Este rascunho não está mais aberto para edição." };
}
