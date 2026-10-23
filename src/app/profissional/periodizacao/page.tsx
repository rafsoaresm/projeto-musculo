import type { Metadata } from "next";
import { requireWorkspace } from "@/modules/auth/server";
import { Planner } from "@/modules/training/components/planner";
import { PageHeading, Pill } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Periodização" };

export default async function PeriodizationPage() {
  await requireWorkspace();
  return (
    <>
      <PageHeading
        eyebrow="NÚCLEO DE TREINAMENTO"
        title="Periodização"
        description="Configure as fases. Visualize a duração e a sequência real dos treinos."
        aside={<Pill tone="brand">Rascunho estrutural</Pill>}
      />
      <Planner />
    </>
  );
}
