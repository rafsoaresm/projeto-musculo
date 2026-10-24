import type { Metadata } from "next";
import Link from "next/link";
import { requireWorkspace } from "@/modules/auth/server";
import { plansFor } from "@/db/plans";
import { PageHeading } from "@/components/ui";
import { PlanTable } from "@/modules/planos/plan-table";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Prescrição" };

export default async function Prescription() {
  const { db, context, workspace } = await requireWorkspace();
  const rows = await plansFor(db, context).overview();
  const open = rows.filter((row) => row.state === "DRAFT").length;
  return (
    <>
      <PageHeading
        eyebrow={workspace.name}
        title="Prescrição"
        description="A prescrição é feita dentro do plano de cada aluno. Aqui você vê a revisão mais recente de cada plano e onde ainda faltam exercícios em relação ao alvo. Esta lista não aprova nem libera nada ao aluno."
      />
      {rows.length === 0 ? (
        <section className="panel">
          <h2>Nenhum plano ainda.</h2>
          <p>
            Abra um aluno e escolha <strong>Novo plano</strong> para definir o
            ciclo e prescrever os exercícios.
          </p>
          <Link className="button primary" href="/profissional/alunos">
            Ver alunos
          </Link>
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
