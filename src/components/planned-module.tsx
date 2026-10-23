import { Hourglass } from "lucide-react";
import type { NavItem } from "@/modules/platform/surfaces";
import { PageHeading, Pill } from "./ui";

/**
 * Honest placeholder for a module that is in the product structure but not
 * built yet. It shows where the module lives, what it will do and what blocks
 * it. It never simulates data or behavior.
 */
export function PlannedModule({
  item,
  roleLabel,
}: {
  item: NavItem;
  roleLabel: string;
}) {
  const info = item.planned;
  if (!info) return null;
  return (
    <>
      <PageHeading
        eyebrow={`MÓDULO PLANEJADO · ${info.epic}`}
        title={item.label}
        description={`Parte da área ${roleLabel}.`}
        aside={<Pill tone="warning">Ainda não disponível</Pill>}
      />
      <section className="panel planned-panel">
        <span className="icon-tile">
          <Hourglass size={24} />
        </span>
        <div>
          <h2>O que este módulo fará</h2>
          <p>{info.summary}</p>
        </div>
      </section>
      <section className="panel">
        <h2>O que falta para ele existir</h2>
        <p>{info.needs}</p>
      </section>
      <p className="small muted">
        Referência: {info.reference}. Esta página mostra o lugar do módulo na
        estrutura da ferramenta; nenhuma função dele está ativa.
      </p>
    </>
  );
}
