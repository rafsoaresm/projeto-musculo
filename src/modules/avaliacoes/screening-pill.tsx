import { Pill } from "@/components/ui";
import type { RiskStatus } from "./contracts";

/**
 * How an assessment reads at a glance. "Sem sinais" only says that no item was marked by the
 * instrument; it is never worded as a clearance.
 */
export function ScreeningPill({
  risk,
  reviewed,
}: {
  risk: RiskStatus;
  reviewed: boolean;
}) {
  if (risk === "CLEAR") return <Pill tone="neutral">Nenhum sinal marcado</Pill>;
  return reviewed ? (
    <Pill tone="brand">Alerta com revisão registrada</Pill>
  ) : (
    <Pill tone="warning">Revisão obrigatória</Pill>
  );
}
