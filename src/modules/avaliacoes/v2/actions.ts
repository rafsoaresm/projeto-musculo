"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/modules/auth/server";
import { assessmentsFor } from "@/db/assessments";
import { assessmentV2Here } from "./switch";
import { COMPOSITION_MODULE, FIELD_LABEL, SITE_LABEL, compositionSchema, problemsMessage } from "./composition";

export type SaveSectionResult = { saved: true; revision: number } | { conflict: string } | { error: string };

const CONFLICT_MESSAGE = "Esta avaliação foi alterada em outra aba ou por outra pessoa. Recarregue para ver a versão atual.";
const CLOSED = "O formato novo da avaliação não está aberto neste ambiente.";

/**
 * Opens a draft of the new format and goes to it. When the student already has an open draft (of either format), goes to that one: one draft per
 * student. Refused while the new format is closed in this environment.
 */
export async function startAssessmentV2(studentId: string): Promise<{ error?: string }> {
  const { db, context } = await requireWorkspace();
  if (!(await assessmentV2Here())) return { error: CLOSED };
  const started = await assessmentsFor(db, context).startDraft(studentId, new Date(), { format: 2 });
  if (started.status === "not_found") return { error: "Aluno não encontrado no seu atendimento." };
  revalidatePath("/profissional", "layout");
  redirect(`/profissional/alunos/${studentId}/avaliacoes/${started.id}`);
}

/**
 * Saves the "Medidas" step (module "composition") of an open draft of the new format, based on the revision the screen read. The payload is
 * checked here with the module's schema: the screen's own check is a convenience, this one is the rule. It stays in progress: a module is done
 * only when the assessment is finalized (a later step).
 */
export async function saveCompositionSection(assessmentId: string, payload: unknown, revision: number): Promise<SaveSectionResult> {
  const { db, context } = await requireWorkspace();
  if (!(await assessmentV2Here())) return { error: CLOSED };
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
