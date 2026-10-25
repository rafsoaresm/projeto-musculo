"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireIdentity, requireStudent } from "@/modules/auth/server";
import { portalLinksFor } from "@/db/student-access";
import { workspaceFor } from "@/db/workspaces";
import { recordAcceptance } from "@/db/consent";
import { CONSENT_FAILED, CONSENT_REQUIRED, TERMS_OUTDATED, readConsent } from "./input";
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
  const outcome = await recordAcceptance(db, user.id, target.audience, {
    photosAuthorized: choice.photos,
    shownVersion: choice.shownVersion,
  });
  if (outcome.status === "outdated") return TERMS_OUTDATED;
  if (outcome.status === "refused") return CONSENT_FAILED;
  revalidatePath(target.home, "layout");
  redirect(target.home);
}

export type PhotosChoiceResult = { ok: boolean; message: string } | null;

/**
 * The student changing, after joining, the photos choice they made with the acceptance: authorizing or
 * withdrawing. It is a new row of the same version, never a change of an old one, so the history of
 * what they chose and when stays. Only the student's own session can do it; the professional sees the
 * result and cannot give or take it. Withdrawing stops new photos; what is already stored is not
 * removed by this: that destiny is a decision still open (see docs/REVISAO-JURIDICA.md).
 */
export async function setPhotosChoice(_previous: PhotosChoiceResult, form: FormData): Promise<PhotosChoiceResult> {
  const { db, user } = await requireStudent();
  const { photos: authorize, shownVersion } = readConsent(form);
  const outcome = await recordAcceptance(db, user.id, "STUDENT", { photosAuthorized: authorize, shownVersion });
  if (outcome.status === "outdated") return { ok: false, message: TERMS_OUTDATED };
  if (outcome.status === "refused") return { ok: false, message: "Não foi possível registrar a sua escolha. Tente novamente." };
  revalidatePath("/aluno/conta");
  return {
    ok: true,
    message:
      outcome.status === "already"
        ? "Nada mudou: esta já era a sua escolha."
        : authorize
          ? "Escolha registrada: você autorizou as fotos da sua postura."
          : "Escolha registrada: você não autoriza mais fotos. Fotos novas não serão aceitas.",
  };
}
