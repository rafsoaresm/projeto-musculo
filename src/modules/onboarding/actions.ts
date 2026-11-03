"use server";
import { requireIdentity, requireWorkspace } from "@/modules/auth/server";
import { provisionWorkspace, workspaceInput } from "@/db/workspaces";
import { createStudent, studentInput } from "@/db/create-student";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

export async function setupWorkspace(
  _previous: string,
  form: FormData,
): Promise<string> {
  const { db, user } = await requireIdentity();
  const parsed = workspaceInput.safeParse({
    name: form.get("name"),
    professionalName: form.get("professionalName"),
  });
  if (!parsed.success) return "Preencha os nomes com 2 a 160 caracteres.";
  try {
    await provisionWorkspace(db, user.id, parsed.data);
  } catch {
    return "Não foi possível criar o espaço. Atualize a página e tente novamente.";
  }
  revalidatePath("/profissional");
  redirect("/profissional");
}
export async function addStudent(
  _previous: string,
  form: FormData,
): Promise<string> {
  const { db, context } = await requireWorkspace();
  const parsed = studentInput.safeParse({
    displayName: form.get("displayName"),
  });
  if (!parsed.success) return "Informe um nome com 2 a 160 caracteres.";
  let id: string;
  try {
    id = await createStudent(db, context, parsed.data);
  } catch {
    return "Não foi possível cadastrar. Verifique seu vínculo de atendimento e tente novamente.";
  }
  revalidatePath("/profissional/alunos");
  redirect(`/profissional/alunos/${id}`);
}
