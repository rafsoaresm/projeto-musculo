import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeading, Pill } from "@/components/ui";
import { PortalPill } from "@/modules/atendimento/student-list";
import { requireDemo } from "@/modules/demo/guard";
import { findDemoStudent, demoWorkspace } from "@/modules/demo/fixtures";
import { PrescriptionPreview } from "@/modules/demo/prescription-preview";

export const dynamic = "force-dynamic";

export default async function DemoStudent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireDemo();
  const { id } = await params;
  const student = findDemoStudent(id);
  if (!student) notFound();
  return (
    <>
      <PageHeading
        eyebrow={demoWorkspace.name}
        title={student.displayName}
        description="Cadastro salvo no seu espaço de atendimento."
        aside={<Pill tone="warning">Dados fictícios</Pill>}
      />
      <section className="panel">
        <p className="eyebrow">ÁREA DO ALUNO</p>
        <h2>Acesso do aluno</h2>
        <p>
          <PortalPill state={student.portal} /> {student.portalNote}
        </p>
      </section>
      <section className="panel" aria-labelledby="prescricao">
        <p className="eyebrow">PRESCRIÇÃO · PRÉVIA</p>
        <h2 id="prescricao">Plano de treino</h2>
        <PrescriptionPreview student={student} />
      </section>
      <Link href="/demonstracao/profissional/alunos" className="button secondary">
        <ArrowLeft size={17} /> Voltar aos alunos
      </Link>
    </>
  );
}
