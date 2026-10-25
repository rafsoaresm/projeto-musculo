"use server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireStudent, requireWorkspace } from "@/modules/auth/server";
import { checkinsFor, studentCheckinsFor } from "@/db/student-checkins";

export type CheckinResult = {
  error?: string;
  saved?: { id: string; created: boolean; discomfort: boolean };
  removed?: boolean;
};
export type AcknowledgeCheckinResult = { error?: string; recorded?: boolean };

const refreshStudent = () => revalidatePath("/aluno", "layout");
const refreshProfessional = () => revalidatePath("/profissional", "layout");

function messageFor(error: unknown): string {
  if (error instanceof ZodError) {
    if (error.issues.some((issue) => issue.message === "CHECKIN_EMPTY"))
      return "Responda pelo menos uma pergunta: esforço, recuperação, desconforto ou uma observação.";
    return "Confira os campos: o esforço vai de 0 a 10 e a recuperação de 1 a 5.";
  }
  return "Não foi possível salvar. Tente novamente.";
}

/**
 * Saves the student's check-in of today. The student comes from the verified links of the login,
 * never from the payload; the repository checks the link again.
 */
export async function saveCheckin(studentId: string, payload: unknown): Promise<CheckinResult> {
  const { db, user, links } = await requireStudent();
  if (!links.some((link) => link.studentId === studentId))
    return { error: "Check-in não encontrado no seu acompanhamento." };
  try {
    const outcome = await studentCheckinsFor(db, user.id).save(studentId, payload);
    switch (outcome.status) {
      case "saved":
        refreshStudent();
        refreshProfessional();
        return { saved: { id: outcome.id, created: outcome.created, discomfort: outcome.discomfort } };
      case "locked":
        return {
          error:
            "O check-in de hoje não pode mais ser alterado: ele tem relato de desconforto ou já foi lido pelo profissional.",
        };
      case "conflict":
        return { error: "Já existe um check-in de hoje. Recarregue a página." };
      default:
        return { error: "Check-in não encontrado no seu acompanhamento." };
    }
  } catch (error) {
    return { error: messageFor(error) };
  }
}

export async function deleteCheckin(studentId: string, checkinId: string): Promise<CheckinResult> {
  const { db, user, links } = await requireStudent();
  if (!links.some((link) => link.studentId === studentId))
    return { error: "Check-in não encontrado no seu acompanhamento." };
  const outcome = await studentCheckinsFor(db, user.id).remove(checkinId);
  if (outcome.status === "removed") {
    refreshStudent();
    refreshProfessional();
    return { removed: true };
  }
  return {
    error:
      outcome.status === "locked"
        ? "Este check-in não pode mais ser apagado: ele tem relato de desconforto, já foi lido pelo profissional ou é de outro dia."
        : "Check-in não encontrado no seu acompanhamento.",
  };
}

/** The professional's reading of a check-in. It records who read it and when, and changes nothing else. */
export async function acknowledgeCheckin(checkinId: string, note: string): Promise<AcknowledgeCheckinResult> {
  const { db, context } = await requireWorkspace();
  try {
    const outcome = await checkinsFor(db, context).acknowledge(checkinId, note);
    if (outcome.status === "not_found") return { error: "Check-in não encontrado no seu atendimento." };
  } catch (error) {
    if (error instanceof Error && error.message === "ACKNOWLEDGEMENT_NOTE_TOO_LONG")
      return { error: "A anotação pode ter até 500 caracteres." };
    return { error: "Não foi possível concluir. Tente novamente." };
  }
  refreshProfessional();
  refreshStudent();
  return { recorded: true };
}
