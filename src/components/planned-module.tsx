import { Hourglass } from "lucide-react";
import type { NavItem } from "@/modules/platform/surfaces";
import { PageHeading, Pill } from "./ui";

/**
 * Honest placeholder for a module that is in the product structure but not built yet: it says, in the words of the product, what the module
 * will do and that it is not available. No roadmap codes, documents or storage names reach the screen (handoff V4, T17 and A14); those live in
 * `PlannedInfo` for the docs and the tests. It never simulates data or behavior.
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
        eyebrow="EM DESENVOLVIMENTO"
        title={item.label}
        description={`Parte da área ${roleLabel}. Nenhuma função deste módulo está ativa ainda.`}
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

    </>
  );
}
