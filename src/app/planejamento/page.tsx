import type { Metadata } from "next";
import { Planner } from "@/modules/training/components/planner";

export const metadata: Metadata = { title: "Planejamento" };

export default function PlanningPage() {
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">NÚCLEO DE TREINAMENTO</p>
          <h1>Planejamento de ciclos</h1>
          <p className="muted">
            Configure as fases. Visualize a duração e a sequência real dos
            treinos.
          </p>
        </div>
        <span className="pill brand-pill">Rascunho estrutural</span>
      </div>
      <Planner />
    </>
  );
}
