import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireWorkspace } from "@/modules/auth/server";
import { studentsFor } from "@/db/students";
import { PageHeading, Pill } from "@/components/ui";
import { Planner } from "@/modules/training/components/planner";
import { createPlan } from "@/modules/planos/actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Novo plano" };

export default async function NewPlan({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { db, context } = await requireWorkspace();
  const { id } = await params;
  const student = await studentsFor(db, context).findById(id);
  if (!student) notFound();
  return (
    <>
      <PageHeading
        eyebrow={student.displayName}
        title="Novo plano de periodização"
        description="Defina o ciclo e cada fase; ao salvar, você vai direto para a prescrição dos exercícios."
        aside={<Pill tone="brand">Rascunho estrutural</Pill>}
      />
      <ol className="plan-steps" aria-label="Etapas do novo plano">
        <li>
          <span className="mini-number">1</span> Estrutura do ciclo
        </li>
        <li>
          <span className="mini-number">2</span> Configurar cada fase
        </li>
        <li>
          <span className="mini-number">3</span> Prescrever exercícios
        </li>
      </ol>
      <Planner
        persist={{
          askTitle: true,
          // 0.93: the same save as before, named for where it leads (the action redirects to the prescription).
          saveLabel: "Salvar e prescrever exercícios",
          prescribeNext: true,
          save: createPlan.bind(null, student.id),
        }}
      />
      <Link href={`/profissional/alunos/${student.id}?aba=periodizacao`} className="button secondary">
        <ArrowLeft size={17} /> Voltar ao aluno
      </Link>
    </>
  );
}
