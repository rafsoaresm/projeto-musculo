"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  getAuthSettings,
  requireIdentity,
  requireWorkspace,
} from "@/modules/auth/server";
import { studentsFor } from "@/db/students";
import { acceptStudentInvite, studentAccessFor } from "@/db/student-access";

export interface InviteState {
  link?: string;
  expiresAt?: string;
  error?: string;
}

/** Professional creates the one-use link. The raw token is returned once. */
export async function createInviteLink(
  studentId: string,
): Promise<InviteState> {
  const { db, context } = await requireWorkspace();
  const student = await studentsFor(db, context).findById(studentId);
  if (!student) return { error: "Aluno não encontrado no seu atendimento." };
  try {
    const { token, expiresAt } = await studentAccessFor(
      db,
      context,
    ).createInvite(student.id);
    // The origin is trusted server configuration, never a request header.
    const { origin, basePath } = await getAuthSettings();
    revalidatePath(`/profissional/alunos/${student.id}`);
    return { link: `${origin}${basePath}/convite/${token}`, expiresAt };
  } catch {
    return {
      error:
        "Não foi possível criar o convite. Este aluno pode já ter acesso ativo.",
    };
  }
}

export async function revokeStudentAccess(studentId: string): Promise<string> {
  const { db, context } = await requireWorkspace();
  let revoked: number;
  try {
    revoked = await studentAccessFor(db, context).revoke(studentId);
  } catch {
    return "Não foi possível concluir. Tente novamente.";
  }
  revalidatePath(`/profissional/alunos/${studentId}`);
  revalidatePath("/profissional/alunos");
  return revoked > 0 ? "Acesso revogado." : "Convite cancelado.";
}

/** The signed-in person accepts. The token is the only thing the page supplies. */
export async function acceptInvite(token: string): Promise<string> {
  const { db, user } = await requireIdentity();
  const accepted = await acceptStudentInvite(db, user.id, token);
  if (!accepted)
    return "Este convite não está mais disponível. Peça um novo ao seu profissional.";
  revalidatePath("/aluno");
  redirect("/aluno");
}
