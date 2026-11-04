import type { Metadata } from "next";
import { requireWorkspace } from "@/modules/auth/server";
import { Planner } from "@/modules/training/components/planner";
import { PageHeading, Pill } from "@/components/ui";
import { canPrescribe } from "@/modules/planos/access";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Simulador de ciclos" };

export default async function PeriodizationPage() {
  const { workspace } = await requireWorkspace();
  const prescribes = canPrescribe(workspace.role);
  return (
    <>
      <PageHeading
        eyebrow="PLANOS E TREINOS"
        title="Simulador de ciclos"
        description={
          prescribes
            ? "Simule as fases e veja a duração e a sequência reais. Nada aqui é salvo: para guardar um plano, use Novo plano em Planos e treinos e escolha o aluno."
            : "Simule as fases e veja a duração e a sequência reais. Nada aqui é salvo."
        }
        aside={<Pill tone="brand">Rascunho estrutural</Pill>}
      />
      <Planner newPlanHref={prescribes ? "/profissional/planos/novo" : undefined} />
    </>
  );
}
