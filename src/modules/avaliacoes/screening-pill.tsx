import { Pill } from "@/components/ui";
import type { RiskStatus } from "./contracts";

/**
 * How an assessment reads at a glance. "Sem sinais" only says that no item was marked by the
 * instrument; it is never worded as a clearance. For the Avaliação Física (`parq`), the instrument is
 * the PAR-Q and the answer to a "Sim" is the professional's recorded decision.
 */
export function ScreeningPill({
  risk,
  reviewed,
  parq = false,
}: {
  risk: RiskStatus;
  reviewed: boolean;
  parq?: boolean;
}) {
  if (parq) {
    if (risk === "CLEAR") return <Pill tone="neutral">PAR-Q sem “Sim”</Pill>;
    return reviewed ? <Pill tone="brand">PAR-Q com “Sim”, decisão registrada</Pill> : <Pill tone="warning">PAR-Q com “Sim”, sem decisão</Pill>;
  }
  if (risk === "CLEAR") return <Pill tone="neutral">Nenhum sinal marcado</Pill>;
  return reviewed ? (
    <Pill tone="brand">Alerta com revisão registrada</Pill>
  ) : (
    <Pill tone="warning">Revisão obrigatória</Pill>
  );
}
