"use server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireStudent, requireWorkspace } from "@/modules/auth/server";
import { getPhotoBucketBinding } from "@/db/binding";
import { dataRequestsFor, studentRequestsFor } from "@/db/data-requests";

export type OpenRequestResult = { error?: string; opened?: { id: string; dueAt: string } };
export type CancelRequestResult = { error?: string; cancelled?: boolean };
export type AnswerRequestResult = { error?: string; answered?: boolean };
export type ErasePhotosResult = { error?: string; erased?: { count: number } };

const refreshStudent = () => revalidatePath("/aluno", "layout");
const refreshProfessional = () => revalidatePath("/profissional", "layout");

/** The student comes from the verified links of the login, never from the payload. */
export async function openDataRequest(studentId: string, payload: unknown): Promise<OpenRequestResult> {
  const { db, user, links } = await requireStudent();
  if (!links.some((link) => link.studentId === studentId))
    return { error: "Acompanhamento não encontrado na sua conta." };
  try {
    const outcome = await studentRequestsFor(db, user.id).open(studentId, payload);
    if (outcome.status === "already_open")
      return { error: "Você já tem um pedido deste tipo em andamento. Aguarde a resposta ou cancele-o." };
    if (outcome.status === "not_found") return { error: "Acompanhamento não encontrado na sua conta." };
    refreshStudent();
    refreshProfessional();
    return { opened: { id: outcome.id, dueAt: outcome.dueAt } };
  } catch (error) {
    if (error instanceof ZodError) {
      if (error.issues.some((issue) => issue.message === "REQUEST_MESSAGE_REQUIRED"))
        return { error: "Conte o que você precisa neste pedido." };
      return { error: "Confira o pedido: o texto pode ter até 1.000 caracteres." };
    }
    return { error: "Não foi possível registrar o pedido. Tente novamente." };
  }
}

export async function cancelDataRequest(studentId: string, requestId: string): Promise<CancelRequestResult> {
  const { db, user, links } = await requireStudent();
  if (!links.some((link) => link.studentId === studentId))
    return { error: "Pedido não encontrado na sua conta." };
  const outcome = await studentRequestsFor(db, user.id).cancel(requestId);
  if (outcome.status !== "cancelled") return { error: "Este pedido não está mais em andamento." };
  refreshStudent();
  refreshProfessional();
  return { cancelled: true };
}

/** The professional's answer. Erasing photos is a separate action: it is the only thing the tool carries out. */
export async function answerDataRequest(requestId: string, payload: unknown): Promise<AnswerRequestResult> {
  const { db, context } = await requireWorkspace();
  try {
    const outcome = await dataRequestsFor(db, context).answer(requestId, payload);
    if (outcome.status === "use_erasure")
      return { error: "Para atender este pedido, use “Apagar as fotos”. Você só pode recusá-lo por aqui, com o motivo." };
    if (outcome.status === "not_found") return { error: "Pedido não encontrado ou já respondido." };
  } catch (error) {
    if (error instanceof ZodError) {
      if (error.issues.some((issue) => issue.message === "ANSWER_NOTE_REQUIRED"))
        return { error: "Explique a resposta: o aluno vai ler o motivo ou o que ficou de fora." };
      return { error: "Confira a resposta: a explicação pode ter até 2.000 caracteres." };
    }
    return { error: "Não foi possível registrar a resposta. Tente novamente." };
  }
  refreshProfessional();
  refreshStudent();
  return { answered: true };
}

export async function erasePhotosForRequest(requestId: string): Promise<ErasePhotosResult> {
  const { db, context } = await requireWorkspace();
  try {
    const bucket = await getPhotoBucketBinding();
    const outcome = await dataRequestsFor(db, context, bucket).erasePhotos(requestId);
    if (outcome.status === "not_found") return { error: "Pedido não encontrado, de outro tipo ou já respondido." };
    if (outcome.status === "storage_unavailable")
      return { error: "O armazenamento de fotos não está disponível neste ambiente. O pedido continua aberto." };
    if (outcome.status === "photos_remain")
      return { error: "Chegou uma foto nova enquanto as outras eram apagadas. Tente de novo." };
    refreshProfessional();
    refreshStudent();
    return { erased: { count: outcome.count } };
  } catch {
    // Anything erased before the failure stays erased; the request is still open and can be tried again.
    return { error: "Não foi possível apagar todas as fotos. O pedido continua aberto: tente de novo." };
  }
}
