import type { StudentConsent } from "@/db/consent";
import { formatCalendarDate } from "@/modules/training/format";

/** What the professional sees about the student's acceptance of the terms. Facts, never a verdict. */
export function ConsentLine({ consent }: { consent: StudentConsent | null }) {
  if (!consent) return null;
  if (!consent.hasLogin)
    return (
      <p className="small muted">
        Aceite dos termos: o aluno ainda não tem acesso. Ele lê e aceita os termos ao aceitar o convite.
      </p>
    );
  if (!consent.accepted)
    return (
      <p className="small muted">
        Aceite dos termos: o aluno entrou antes de existirem os termos. O aceite será pedido no próximo acesso dele.
      </p>
    );
  const when = formatCalendarDate((consent.acceptedAt ?? "").slice(0, 10));
  return (
    <p className="small muted">
      Aceite dos termos: feito em {when}
      {consent.current ? "" : ", de uma versão anterior; será pedido de novo no próximo acesso"}. Fotos da postura:{" "}
      {consent.photosAuthorized ? "autorizadas" : "não autorizadas"} pelo aluno.
    </p>
  );
}
