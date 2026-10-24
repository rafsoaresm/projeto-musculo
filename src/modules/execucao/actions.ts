"use server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireStudent, requireWorkspace } from "@/modules/auth/server";
import { executionFor, studentSessionsFor } from "@/db/workout-sessions";

export type SessionResult = {
  error?: string;
  saved?: { id: string; created: boolean; painReported: boolean };
  removed?: boolean;
};
export type AcknowledgeResult = { error?: string; recorded?: boolean };

const refreshStudent = () => revalidatePath("/aluno", "layout");
const refreshProfessional = () => revalidatePath("/profissional", "layout");

function messageFor(error: unknown): string {
  if (error instanceof ZodError) {
    const where = new Set(error.issues.map((issue) => String(issue.path[0] ?? "")));
    const custom = error.issues.map((issue) => issue.message);
    if (custom.includes("DATE_OUT_OF_RANGE") || where.has("performedOn"))
      return "Confira a data: use hoje ou um dos últimos 14 dias.";
    if (custom.includes("EXERCISE_DUPLICATE")) return "Um exercício apareceu duas vezes. Recarregue a página.";
    return "Confira os números: repetições, carga, esforço e RIR precisam estar dentro do permitido.";
  }
  return "Não foi possível salvar. Tente novamente.";
}

/**
 * Saves the student's log of one workout. The student comes from the verified links of the
 * login, never from the payload; the repository checks the link again.
 */
export async function saveSession(studentId: string, payload: unknown): Promise<SessionResult> {
  const { db, user, links } = await requireStudent();
  if (!links.some((link) => link.studentId === studentId))
    return { error: "Registro não encontrado no seu acompanhamento." };
  try {
    const outcome = await studentSessionsFor(db, user.id).save(studentId, payload);
    switch (outcome.status) {
      case "saved":
        refreshStudent();
        refreshProfessional();
        return { saved: { id: outcome.id, created: outcome.created, painReported: outcome.painReported } };
      case "locked":
        return {
          error:
            "Este registro não pode mais ser alterado: ele tem relato de dor, já foi lido pelo profissional ou passou de 24 horas.",
        };
      case "conflict":
        return { error: "Já existe um registro deste treino nesta data. Recarregue a página." };
      case "invalid":
        return { error: "Há exercícios que não fazem parte deste treino. Recarregue a página." };
      default:
        return { error: "Este treino não está disponível para registro. Fale com o seu profissional." };
    }
  } catch (error) {
    return { error: messageFor(error) };
  }
}

export async function deleteSession(studentId: string, sessionId: string): Promise<SessionResult> {
  const { db, user, links } = await requireStudent();
  if (!links.some((link) => link.studentId === studentId))
    return { error: "Registro não encontrado no seu acompanhamento." };
  const outcome = await studentSessionsFor(db, user.id).remove(sessionId);
  if (outcome.status === "removed") {
    refreshStudent();
    refreshProfessional();
    return { removed: true };
  }
  return {
    error:
      outcome.status === "locked"
        ? "Este registro não pode mais ser apagado: ele tem relato de dor, já foi lido ou passou de 24 horas."
        : "Registro não encontrado no seu acompanhamento.",
  };
}

/** The professional's reading of a log. It records who read it and when, and changes nothing else. */
export async function acknowledgeSession(sessionId: string, note: string): Promise<AcknowledgeResult> {
  const { db, context } = await requireWorkspace();
  try {
    const outcome = await executionFor(db, context).acknowledge(sessionId, note);
    if (outcome.status === "not_found") return { error: "Registro não encontrado no seu atendimento." };
  } catch (error) {
    if (error instanceof Error && error.message === "ACKNOWLEDGEMENT_NOTE_TOO_LONG")
      return { error: "A anotação pode ter até 500 caracteres." };
    return { error: "Não foi possível concluir. Tente novamente." };
  }
  refreshProfessional();
  refreshStudent();
  return { recorded: true };
}
