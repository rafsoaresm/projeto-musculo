import Link from "next/link";
import { PageHeading, Pill } from "@/components/ui";
import { PrescriptionPreview } from "@/modules/demo/prescription-preview";
import { requireDemo } from "@/modules/demo/guard";
import { findDemoStudent } from "@/modules/demo/fixtures";

export const dynamic = "force-dynamic";

export default async function DemoPrescription() {
  await requireDemo();
  const student = findDemoStudent("ana");
  if (!student) return null;
  return (
    <>
      <PageHeading
        eyebrow="MÓDULO PLANEJADO · E2"
        title="Prescrição"
        description={`Prévia com ${student.displayName}, um aluno fictício.`}
        aside={<Pill tone="warning">Prévia · não existe ainda</Pill>}
      />
      <section className="panel">
        <PrescriptionPreview student={student} />
      </section>
      <p className="small muted">
        Compare com um plano já entregue:{" "}
        <Link
          className="account-link"
          href="/demonstracao/profissional/alunos/carlos"
        >
          Carlos Almeida
        </Link>
        .
      </p>
    </>
  );
}
