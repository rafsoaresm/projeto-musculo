import type { StudentConsent } from "@/db/consent";
import { formatCalendarDate } from "@/modules/training/format";

/** What the professional sees about an acceptance of the terms the student recorded earlier. Facts only; nothing depends on it. */
export function ConsentLine({ consent }: { consent: StudentConsent | null }) {
  if (!consent || !consent.hasLogin || !consent.accepted) return null;
  const when = formatCalendarDate((consent.acceptedAt ?? "").slice(0, 10));
  return (
    <p className="small muted">
      Aceite dos termos: registrado em {when}
      {consent.current ? "" : ", de uma versão anterior"}.
    </p>
  );
}
