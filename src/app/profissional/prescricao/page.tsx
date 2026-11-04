import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requireWorkspace } from "@/modules/auth/server";
import { plansFor } from "@/db/plans";
import { PageHeading } from "@/components/ui";
import { PlanTable } from "@/modules/planos/plan-table";
import { canPrescribe } from "@/modules/planos/access";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Planos e treinos" };

export default async function Prescription() {
  const { db, context, workspace } = await requireWorkspace();
  const rows = await plansFor(db, context).overview();
  const open = rows.filter((row) => row.state === "DRAFT").length;
  // 0.93: "Novo plano" starts here and asks for the student; only the roles that prescribe see it.
  const prescribes = canPrescribe(workspace.role);
  const newPlan = prescribes && (
    <Link className="button primary" href="/profissional/planos/novo">
      <Plus size={20} /> Novo plano
    </Link>
  );
  return (
    <>
      <PageHeading
        eyebrow={workspace.name}
        title="Planos e treinos"
        description="A revisão mais recente do plano de cada aluno. A prescrição é feita dentro do plano; esta lista não aprova nem libera nada ao aluno."
        aside={
          <div className="heading-actions">
            <Link className="button secondary" href="/profissional/periodizacao">
              Simulador de ciclos
            </Link>
            {newPlan}
          </div>
        }
      />
      {rows.length === 0 ? (
        <section className="panel">
          <h2>Nenhum plano ainda.</h2>
          <p>
            {prescribes
              ? "Escolha Novo plano, selecione o aluno, defina o ciclo e prescreva os exercícios."
              : "Os planos são feitos pela equipe técnica, no cadastro de cada aluno."}
          </p>
          <div className="heading-actions empty-actions">
            {newPlan}
            <Link className="button secondary" href="/profissional/alunos">
              Ver alunos
            </Link>
          </div>
        </section>
      ) : (
        <>
          <p className="small muted" role="status">
            {rows.length} {rows.length === 1 ? "plano" : "planos"}
            {open > 0
              ? `, ${open} em rascunho`
              : ", nenhum em rascunho"}
          </p>
          <PlanTable rows={rows} />
        </>
      )}
    </>
  );
}
