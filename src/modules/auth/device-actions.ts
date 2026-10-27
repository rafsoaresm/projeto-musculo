"use server";
import { requireIdentity } from "./server";
import { accountAccessFor } from "@/db/account-access";

/**
 * Disconnects one other device of the person asking. The person and the session making the request come
 * from the verified session, never from the arguments; the repository repeats whose the session is.
 */
export async function disconnectDevice(sessionId: string): Promise<{ outcome: "done" | "gone" | "error"; message: string }> {
  const { db, user, sessionId: current } = await requireIdentity();
  if (typeof sessionId !== "string" || sessionId.length === 0 || sessionId.length > 128)
    return { outcome: "error", message: "Não foi possível desconectar esse aparelho." };
  try {
    const done = await accountAccessFor(db, user.id, current).disconnect(sessionId);
    return done
      ? { outcome: "done", message: "Aparelho desconectado." }
      : { outcome: "gone", message: "Esse aparelho já não está conectado." };
  } catch {
    return { outcome: "error", message: "Não foi possível desconectar. Tente novamente." };
  }
}
