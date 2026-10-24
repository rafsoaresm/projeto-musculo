import type { Metadata } from "next";
import Link from "next/link";
import { requireWorkspace } from "@/modules/auth/server";
import { assessmentsFor } from "@/db/assessments";
import { PageHeading } from "@/components/ui";
import { AssessmentTable } from "@/modules/avaliacoes/assessment-table";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Avaliações" };

export default async function Assessments() {
  const { db, context, workspace } = await requireWorkspace();
  const rows = await assessmentsFor(db, context).overview();
  const waiting = rows.filter((row) => row.riskStatus === "REVIEW_REQUIRED" && !row.reviewed).length;
  return (
    <>
      <PageHeading
        eyebrow={workspace.name}
        title="Avaliações"
        description="A triagem e os indicadores de cada aluno, como registros com data. Alertas sem revisão aparecem primeiro. A ferramenta descreve o que foi relatado e medido; não diagnostica nem libera ninguém para treinar."
      />
      {rows.length === 0 ? (
        <section className="panel">
          <h2>Nenhum aluno ainda.</h2>
          <p>Cadastre um aluno para registrar a primeira avaliação.</p>
          <Link className="button primary" href="/profissional/alunos">
            Ver alunos
          </Link>
        </section>
      ) : (
        <>
          <p className="small muted" role="status">
            {waiting > 0
              ? `${waiting} ${waiting === 1 ? "aluno com revisão obrigatória pendente" : "alunos com revisão obrigatória pendente"}`
              : "Nenhuma revisão obrigatória pendente"}
          </p>
          <AssessmentTable rows={rows} />
        </>
      )}
    </>
  );
}
