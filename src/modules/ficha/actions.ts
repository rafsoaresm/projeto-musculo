"use server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireWorkspace } from "@/modules/auth/server";
import { profilesFor } from "@/db/student-profile";

export type ProfileResult = { error?: string; saved?: boolean };

function messageFor(error: unknown): string {
  if (error instanceof ZodError) {
    const where = new Set(error.issues.map((issue) => String(issue.path[0] ?? "")));
    if (where.has("birthDate")) return "Confira a data de nascimento: ela não pode estar no futuro.";
    if (where.has("bodyMeasuredOn")) return "Confira a data das medidas: ela não pode estar no futuro.";
    if (where.has("email")) return "Confira o e-mail.";
    if (where.has("phone")) return "Confira o telefone: use só números, espaços e + ( ) - . .";
    if (where.has("heightCm") || where.has("weightKg"))
      return "Confira a altura (50 a 260 cm) e o peso (10 a 500 kg).";
    return "Confira os campos: algum valor está fora do permitido ou longo demais.";
  }
  return "Não foi possível salvar. Tente novamente.";
}

/** The student comes from the page; access is checked again in the repository. */
export async function saveProfile(
  studentId: string,
  payload: unknown,
): Promise<ProfileResult> {
  const { db, context } = await requireWorkspace();
  try {
    if (!(await profilesFor(db, context).save(studentId, payload)))
      return { error: "Aluno não encontrado no seu atendimento." };
  } catch (error) {
    return { error: messageFor(error) };
  }
  revalidatePath("/profissional/alunos", "layout");
  return { saved: true };
}
