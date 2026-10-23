import { PageHeading, Pill } from "@/components/ui";
import { requireDemo } from "@/modules/demo/guard";
import { Planner } from "@/modules/training/components/planner";

export const dynamic = "force-dynamic";

export default async function DemoPeriodization() {
  await requireDemo();
  return (
    <>
      <PageHeading
        eyebrow="NÚCLEO DE TREINAMENTO"
        title="Periodização"
        description="Esta é a mesma tela da área real: o cálculo é de verdade e nada é salvo."
        aside={<Pill tone="brand">Rascunho estrutural</Pill>}
      />
      <Planner />
    </>
  );
}
