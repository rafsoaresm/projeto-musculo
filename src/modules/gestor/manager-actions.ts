"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAuthSettings, requireIdentity, requirePlatformAdmin } from "@/modules/auth/server";
import { acceptManagerInvite, platformFor } from "@/db/platform";

export interface ManagerInviteState {
  /**
   * The origin is trusted server configuration. The mount path is added by the browser, which is the
   * only side that knows where the app is mounted. The raw link exists only in this answer.
   */
  invite?: { origin: string; path: string };
  expiresAt?: string;
  error?: string;
}

/** A manager issues the one-use link. The raw token is returned once; only its hash is kept. */
export async function inviteManager(label: string): Promise<ManagerInviteState> {
  const { db, context } = await requirePlatformAdmin();
  try {
    const { token, expiresAt } = await platformFor(db, context).inviteManager(label);
    const { origin } = await getAuthSettings();
    revalidatePath("/gestor/gestores");
    return { invite: { origin, path: `/gestor/convite/${token}` }, expiresAt };
  } catch (error) {
    if (error instanceof Error && error.message === "INVITE_LABEL_TOO_LONG")
      return { error: "O lembrete pode ter até 80 caracteres." };
    return { error: "Não foi possível criar o convite. Tente novamente." };
  }
}

export async function revokeManagerInvite(inviteId: string): Promise<string> {
  const { db, context } = await requirePlatformAdmin();
  const done = await platformFor(db, context).revokeManagerInvite(inviteId).catch(() => false);
  revalidatePath("/gestor/gestores");
  return done ? "Convite cancelado." : "Este convite já não está aberto.";
}

/** A manager turns off the second step of another manager who lost the phone and the recovery codes. */
export async function resetManagerTwoFactor(targetUserId: string): Promise<string> {
  const { db, context } = await requirePlatformAdmin();
  const done = await platformFor(db, context).resetTwoFactor(targetUserId).catch(() => false);
  revalidatePath("/gestor/gestores");
  return done
    ? "Verificação em duas etapas redefinida. A pessoa foi desconectada e entra só com a senha."
    : "Não foi possível redefinir. Ela já pode ter desativado a verificação; atualize a página.";
}

export async function revokeManager(targetUserId: string): Promise<string> {
  const { db, context } = await requirePlatformAdmin();
  const done = await platformFor(db, context).revokeManager(targetUserId).catch(() => false);
  revalidatePath("/gestor/gestores");
  return done ? "Acesso de gestor encerrado." : "Não foi possível encerrar este acesso.";
}

/**
 * The signed-in person accepts. The token is the only thing the page supplies: the role comes from
 * the link, never from the e-mail of the account.
 */
export async function acceptManagerInviteAction(token: string): Promise<string> {
  const { db, user } = await requireIdentity();
  const result = await acceptManagerInvite(db, { userId: user.id, token });
  if (result !== "accepted") return "Este convite já foi usado, venceu ou foi cancelado.";
  revalidatePath("/gestor", "layout");
  redirect("/gestor");
}
