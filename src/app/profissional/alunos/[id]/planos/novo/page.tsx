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
        description="Defina as fases, calcule o calendário e salve o rascunho no cadastro do aluno."
        aside={<Pill tone="brand">Rascunho estrutural</Pill>}
      />
      <Planner
        persist={{
          askTitle: true,
          saveLabel: "Salvar rascunho",
          save: createPlan.bind(null, student.id),
        }}
      />
      <Link href={`/profissional/alunos/${student.id}`} className="button secondary">
        <ArrowLeft size={17} /> Voltar ao aluno
      </Link>
    </>
  );
}
