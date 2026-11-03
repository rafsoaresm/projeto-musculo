"use server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireStudent, requireWorkspace } from "@/modules/auth/server";
import { REPLY_MAX, checkinsFor, studentCheckinsFor } from "@/db/student-checkins";
import { MAX_DAYS_BACK } from "@/modules/execucao/contracts";
import { MAX_OWN_QUESTIONS, QUESTION_MAX } from "./contracts";

export type CheckinResult = {
  error?: string;
  saved?: { id: string; created: boolean; discomfort: boolean };
  removed?: boolean;
};
export type AcknowledgeCheckinResult = { error?: string; recorded?: boolean };
export type CheckinFormResult = { error?: string; saved?: { version: number } | "unchanged" };

const refreshStudent = () => revalidatePath("/aluno", "layout");
const refreshProfessional = () => revalidatePath("/profissional", "layout");

function messageFor(error: unknown): string {
  if (error instanceof ZodError) {
    if (error.issues.some((issue) => issue.message === "CHECKIN_EMPTY"))
      return "Responda pelo menos uma pergunta.";
    return "Confira os campos: o esforço vai de 0 a 10, a recuperação de 1 a 5 e cada resposta tem até 500 caracteres.";
  }
  return "Não foi possível salvar. Tente novamente.";
}

/**
 * Saves the student's check-in of a day (today or one of the last days of the window). The student comes from the verified links of the login,
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
            "O check-in deste dia não pode mais ser alterado: ele tem relato de desconforto, já foi lido ou respondido pelo profissional, ou foi feito em outro dia.",
        };
      case "out_of_range":
        return { error: `Escolha hoje ou um dos últimos ${MAX_DAYS_BACK} dias.` };
      case "conflict":
        return { error: "Já existe um check-in neste dia. Recarregue a página." };
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
        ? "Este check-in não pode mais ser apagado: ele tem relato de desconforto, já foi lido ou respondido pelo profissional, ou foi feito em outro dia."
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

/** The professional's reply to a check-in, in text. The student sees it with who wrote it and when. No e-mail is sent. */
export async function replyToCheckin(checkinId: string, body: string): Promise<AcknowledgeCheckinResult> {
  const { db, context } = await requireWorkspace();
  try {
    const outcome = await checkinsFor(db, context).reply(checkinId, body);
    if (outcome.status === "not_found") return { error: "Check-in não encontrado no seu atendimento." };
  } catch (error) {
    if (error instanceof Error && error.message === "REPLY_EMPTY") return { error: "Escreva a resposta antes de enviar." };
    if (error instanceof Error && error.message === "REPLY_TOO_LONG")
      return { error: `A resposta pode ter até ${REPLY_MAX} caracteres.` };
    return { error: "Não foi possível enviar. Tente novamente." };
  }
  refreshProfessional();
  refreshStudent();
  return { recorded: true };
}

/** What the student's check-in asks. Saved as a new version: past check-ins keep the questions they were answered with. */
export async function saveCheckinForm(studentId: string, payload: unknown): Promise<CheckinFormResult> {
  const { db, context } = await requireWorkspace();
  try {
    const outcome = await checkinsFor(db, context).saveForm(studentId, payload);
    switch (outcome.status) {
      case "saved":
        refreshProfessional();
        refreshStudent();
        return { saved: { version: outcome.version } };
      case "unchanged":
        return { saved: "unchanged" };
      case "conflict":
        return { error: "Outra pessoa salvou as perguntas agora. Recarregue a página." };
      default:
        return { error: "Aluno não encontrado no seu atendimento." };
    }
  } catch (error) {
    if (error instanceof ZodError)
      return {
        error: `Confira as perguntas: até ${MAX_OWN_QUESTIONS}, cada uma com até ${QUESTION_MAX} caracteres e sem ficar em branco.`,
      };
    return { error: "Não foi possível salvar. Tente novamente." };
  }
}

/** The student has seen the professional's replies (the in-app marker). Only for a student the login is linked to. */
export async function markCheckinRepliesSeen(studentId: string): Promise<void> {
  const { db, user, links } = await requireStudent();
  if (!links.some((link) => link.studentId === studentId)) return;
  await studentCheckinsFor(db, user.id).markRepliesSeen(studentId);
}
