import type { Metadata } from "next";
import { requireWorkspace } from "@/modules/auth/server";
import { Planner } from "@/modules/training/components/planner";
import { PageHeading, Pill } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Simulador de ciclos" };

export default async function PeriodizationPage() {
  await requireWorkspace();
  return (
    <>
      <PageHeading
        eyebrow="PLANOS E TREINOS"
        title="Simulador de ciclos"
        description="Simule as fases e veja a duração e a sequência reais. Nada aqui é salvo: para guardar um plano, abra o aluno e escolha Novo plano."
        aside={<Pill tone="brand">Rascunho estrutural</Pill>}
      />
      <Planner />
    </>
  );
}
