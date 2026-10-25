import type { StudentConsent } from "@/db/consent";

/**
 * Why photos of a student cannot be taken yet. The authorization is the student's own, recorded when
 * they joined; the professional can see it but cannot give it for them.
 */
export type PhotoDenial = "NO_LOGIN" | "NOT_ACCEPTED" | "OUTDATED" | "DECLINED";

export const PHOTO_DENIAL_MESSAGE: Record<PhotoDenial, string> = {
  NO_LOGIN:
    "O aluno ainda não tem acesso. Ele autoriza ou não as fotos ao aceitar o convite, e só depois disso a ferramenta aceita fotos.",
  NOT_ACCEPTED: "O aluno ainda não aceitou os termos, e a autorização das fotos faz parte desse aceite.",
  OUTDATED:
    "O aluno aceitou uma versão anterior dos termos. O aceite será pedido de novo no próximo acesso dele, e as fotos ficam fechadas até lá.",
  DECLINED:
    "O aluno não autorizou as fotos ao aceitar os termos. Só ele pode mudar isso, e a ferramenta ainda não tem uma tela para isso.",
};

/** What the professional's screen shows: `null` when the student's own authorization stands. */
export function photoDenialOf(consent: StudentConsent | null): PhotoDenial | null {
  if (!consent || !consent.hasLogin) return "NO_LOGIN";
  if (!consent.accepted) return "NOT_ACCEPTED";
  if (!consent.current) return "OUTDATED";
  return consent.photosAuthorized ? null : "DECLINED";
}
