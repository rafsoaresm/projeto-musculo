"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireIdentity } from "@/modules/auth/server";
import { portalLinksFor } from "@/db/student-access";
import { workspaceFor } from "@/db/workspaces";
import { recordAcceptance } from "@/db/consent";
import { CONSENT_REQUIRED, readConsent } from "./input";
import type { Audience } from "./terms";

const AREAS = {
  aluno: { audience: "STUDENT", home: "/aluno" },
  profissional: { audience: "PROFESSIONAL", home: "/profissional" },
} as const satisfies Record<string, { audience: Audience; home: string }>;

/**
 * The acceptance for someone who already has the area but has not accepted the terms in force (an
 * account from before the terms existed, or a new version of the text). The person must really have
 * that area: the address alone grants nothing.
 */
export async function acceptTerms(
  area: keyof typeof AREAS,
  _previous: string,
  form: FormData,
): Promise<string> {
  const { db, user } = await requireIdentity();
  const target = AREAS[area];
  if (!target) return "Área não encontrada.";
  const entitled =
    target.audience === "STUDENT"
      ? (await portalLinksFor(db, user.id)).length > 0
      : Boolean(await workspaceFor(db, user.id));
  if (!entitled) redirect("/acesso");
  const choice = readConsent(form);
  if (!choice.accepted) return CONSENT_REQUIRED;
  const outcome = await recordAcceptance(db, user.id, target.audience, { photosAuthorized: choice.photos });
  if (outcome.status === "refused") return "Não foi possível registrar o aceite. Tente novamente.";
  revalidatePath(target.home, "layout");
  redirect(target.home);
}
