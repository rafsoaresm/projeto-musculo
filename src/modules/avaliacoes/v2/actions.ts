"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/modules/auth/server";
import { assessmentsFor } from "@/db/assessments";
import { assessmentPhotosFor } from "@/db/assessment-photos";
import { getPhotoBucket } from "@/db/binding";
import type { AssessmentModule } from "../catalog";
import { COMPOSITION_MODULE, compositionSchema, issueNames, problemsMessage } from "./composition";
import { PROFILE_MODULE, SCREENING_MODULE, draftScreening, profileSchema, screeningSchema } from "./screening";
import { POSTURE_MODULE, issueNames as postureIssueNames, postureProblemsMessage, postureSchema } from "./posture";

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

/** Stores one module of an open draft, already checked by its schema, against the revision the screen read. */
async function storeSection(assessmentId: string, module: AssessmentModule, payload: unknown, revision: number, invalid: string): Promise<SaveSectionResult> {
  const { db, context } = await requireWorkspace();
  const outcome = await assessmentsFor(db, context).saveSection(assessmentId, { module, status: "IN_PROGRESS", payload, revision });
  if (outcome.status === "saved") return { saved: true, revision: outcome.revision };
  if (outcome.status === "conflict") return { conflict: CONFLICT_MESSAGE };
  if (outcome.status === "invalid") return { error: invalid };
  return { error: "Este rascunho não está mais aberto para edição." };
}

/**
 * Saves the "Medidas" step (module "composition") of an open draft, based on the revision the screen read. The payload is checked here with
 * the module's schema: the screen's own check is a convenience, this one is the rule. It stays in progress: a module is done only when the
 * assessment is finalized (a later step).
 */
export async function saveCompositionSection(assessmentId: string, payload: unknown, revision: number): Promise<SaveSectionResult> {
  const parsed = compositionSchema.safeParse(payload);
  if (!parsed.success) {
    const names = issueNames(parsed.error.issues);
    return { error: names.length > 0 ? problemsMessage(names) : "Confira as medidas: algum valor não é aceito." };
  }
  return storeSection(assessmentId, COMPOSITION_MODULE, parsed.data, revision, "Confira as medidas: algum valor não é aceito.");
}

const TRIAGEM_INVALID = "Confira a triagem: alguma resposta não é aceita.";

/** Saves the goals of the "Triagem" step (module "profile"), checked with the module's schema, like "Medidas". */
export async function saveProfileSection(assessmentId: string, payload: unknown, revision: number): Promise<SaveSectionResult> {
  const parsed = profileSchema.safeParse(payload);
  if (!parsed.success) return { error: TRIAGEM_INVALID };
  return storeSection(assessmentId, PROFILE_MODULE, parsed.data, revision, TRIAGEM_INVALID);
}

/**
 * Saves the anamnesis, activity and PAR-Q of the "Triagem" step (module "screening"), checked with the module's schema. The PAR-Q is always
 * stored with its instrument and version; the professional's decision is stored as typed, and who and when are recorded at finalize.
 */
export async function saveScreeningSection(assessmentId: string, payload: unknown, revision: number): Promise<SaveSectionResult> {
  const parsed = screeningSchema.safeParse(payload);
  if (!parsed.success) return { error: TRIAGEM_INVALID };
  return storeSection(assessmentId, SCREENING_MODULE, draftScreening(parsed.data), revision, TRIAGEM_INVALID);
}

/**
 * Saves the posture and the somatotype of the "Movimento" step (module "posture"), checked with the module's schema like the other steps: every
 * finding belongs to its region, a single choice has one, and a measure is a positive number or nothing.
 */
export async function savePostureSection(assessmentId: string, payload: unknown, revision: number): Promise<SaveSectionResult> {
  const parsed = postureSchema.safeParse(payload);
  if (!parsed.success) return { error: postureProblemsMessage(postureIssueNames(parsed.error.issues)) };
  return storeSection(assessmentId, POSTURE_MODULE, parsed.data, revision, postureProblemsMessage([]));
}

export type FinalizeResult = { error: string; pending?: string[]; conflict?: boolean };

/**
 * Finalizes the draft as the screen read it (its revision): the repository checks every module, refuses an incomplete triagem (saying what is
 * missing), writes the results and records the assessment, which never changes afterwards. Then goes to the recorded assessment.
 */
export async function finalizeAssessment(studentId: string, assessmentId: string, revision: number): Promise<FinalizeResult> {
  const { db, context } = await requireWorkspace();
  const outcome = await assessmentsFor(db, context).finalize(assessmentId, revision);
  if (outcome.status === "pending") return { error: "Ainda falta para finalizar:", pending: outcome.pending };
  if (outcome.status === "conflict") return { error: CONFLICT_MESSAGE, conflict: true };
  if (outcome.status === "invalid") return { error: "Algum dado salvo nesta avaliação não é aceito. Confira as etapas e salve de novo antes de finalizar." };
  if (outcome.status === "not_found") return { error: "Este rascunho não está mais aberto." };
  revalidatePath("/profissional", "layout");
  redirect(`/profissional/alunos/${studentId}/avaliacoes/${assessmentId}`);
}

/**
 * Starts an amendment (retificação) of a recorded Avaliação Física, with the reason written, and goes to its draft. The recorded one stays as it
 * is. When the student already has an open draft, says so (one draft per student).
 */
export async function amendAssessment(studentId: string, assessmentId: string, reason: string): Promise<{ error?: string }> {
  const { db, context } = await requireWorkspace();
  const outcome = await assessmentsFor(db, context).amend(assessmentId, reason);
  if (outcome.status === "invalid_reason") return { error: "Escreva o motivo da retificação, com 3 a 1000 caracteres." };
  if (outcome.status === "draft_open") return { error: "Este aluno já tem um rascunho de avaliação aberto: conclua ou descarte esse rascunho antes de retificar." };
  if (outcome.status === "already_amended") return { error: "Esta avaliação já foi retificada: retifique a versão mais recente." };
  if (outcome.status === "not_found") return { error: "Esta avaliação não pode ser retificada." };
  revalidatePath("/profissional", "layout");
  redirect(`/profissional/alunos/${studentId}/avaliacoes/${outcome.id}?etapa=triagem`);
}
