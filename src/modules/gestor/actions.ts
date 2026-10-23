"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  getOperatorSettings,
  requireIdentity,
  requirePlatformAdmin,
} from "@/modules/auth/server";
import { activatePlatformAdmin, platformFor } from "@/db/platform";

const activationMessages = {
  invalid_token: "Código inválido. Confira o valor configurado no ambiente.",
  already_configured:
    "Já existe um gestor ativo. Peça a ele para conceder o acesso.",
  unavailable:
    "A ativação não está configurada neste ambiente. Defina PLATFORM_SETUP_TOKEN no ambiente privado.",
} as const;

export async function activateManager(
  _previous: string,
  form: FormData,
): Promise<string> {
  // Identity comes from the session; the form only carries the secret.
  const { db, user } = await requireIdentity();
  const supplied = form.get("token");
  const { setupToken } = await getOperatorSettings();
  const result = await activatePlatformAdmin(db, {
    userId: user.id,
    supplied: typeof supplied === "string" ? supplied.trim() : "",
    configured: setupToken,
  });
  if (result === "activated") {
    revalidatePath("/gestor");
    redirect("/gestor");
  }
  return activationMessages[result];
}

export async function setMemberAccess(
  organizationId: string,
  targetUserId: string,
  blocked: boolean,
): Promise<string> {
  const { db, context } = await requirePlatformAdmin();
  try {
    await platformFor(db, context).setMemberBlocked(
      organizationId,
      targetUserId,
      blocked,
    );
  } catch {
    return "Não foi possível alterar o acesso. Atualize a página e tente novamente.";
  }
  revalidatePath(`/gestor/organizacoes/${organizationId}`);
  revalidatePath("/gestor");
  return blocked ? "Acesso bloqueado." : "Acesso restabelecido.";
}
