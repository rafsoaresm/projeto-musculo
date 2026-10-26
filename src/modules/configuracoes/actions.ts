"use server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireWorkspace } from "@/modules/auth/server";
import { workspaceSettingsFor, type RenameOutcome } from "@/db/workspace-settings";
import { NAME_MAX, NAME_MIN } from "./contracts";

export type SettingsResult = { error?: string; saved?: boolean; unchanged?: boolean };

const INVALID = `Use de ${NAME_MIN} a ${NAME_MAX} caracteres, só texto: sem quebras de linha nem caracteres invisíveis.`;

function result(outcome: RenameOutcome, forbidden: string): SettingsResult {
  if (outcome.status === "forbidden") return { error: forbidden };
  revalidatePath("/profissional", "layout");
  return outcome.status === "renamed" ? { saved: true } : { unchanged: true };
}

/** The workspace and the person come from the verified session; the repository checks the owner role again. */
export async function renameWorkspace(name: string): Promise<SettingsResult> {
  const { db, context } = await requireWorkspace();
  try {
    return result(
      await workspaceSettingsFor(db, context).renameWorkspace({ name }),
      "Só o proprietário do espaço pode mudar o nome do espaço.",
    );
  } catch (error) {
    if (error instanceof ZodError) return { error: INVALID };
    return { error: "Não foi possível salvar. Tente novamente." };
  }
}

export async function renameSelf(name: string): Promise<SettingsResult> {
  const { db, context } = await requireWorkspace();
  try {
    return result(
      await workspaceSettingsFor(db, context).renameSelf({ name }),
      "Você não tem um nome de exibição neste espaço para mudar.",
    );
  } catch (error) {
    if (error instanceof ZodError) return { error: INVALID };
    return { error: "Não foi possível salvar. Tente novamente." };
  }
}
