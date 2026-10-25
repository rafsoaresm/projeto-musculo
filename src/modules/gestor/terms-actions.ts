"use server";
import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/modules/auth/server";
import { termsFor } from "@/db/terms";
import type { Audience } from "@/modules/consentimento/terms";
import { termsErrorMessage } from "./terms-errors";

export type PublishTermsResult = { ok: true; version: string } | { ok: false; error: string };

/**
 * Publishes the words typed by the platform manager as the next version of one audience's terms. The
 * manager comes from the verified session; the repository checks it again and the database refuses
 * anyone else. Everyone who accepted another version is asked again at their next access.
 */
export async function publishTerms(audience: Audience, content: unknown, note: string): Promise<PublishTermsResult> {
  const { db, context } = await requirePlatformAdmin();
  if (audience !== "STUDENT" && audience !== "PROFESSIONAL") return { ok: false, error: "Texto não encontrado." };
  try {
    const outcome = await termsFor(db, context).publish(audience, content, note);
    if (outcome.status === "unchanged")
      return { ok: false, error: "Nada mudou em relação ao texto em vigor. Publicar assim pediria um novo aceite sem motivo." };
    if (outcome.status === "conflict") return { ok: false, error: "Outra publicação aconteceu agora mesmo. Atualize a página e tente de novo." };
    revalidatePath("/gestor/termos");
    return { ok: true, version: outcome.version };
  } catch (error) {
    return { ok: false, error: termsErrorMessage(error) };
  }
}
