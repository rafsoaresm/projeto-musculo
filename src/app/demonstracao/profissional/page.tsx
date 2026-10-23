import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Kpi, PageHeading, Pill } from "@/components/ui";
import { requireDemo } from "@/modules/demo/guard";
import {
  demoStudents,
  demoWorkspace,
  planStatusLabel,
} from "@/modules/demo/fixtures";

export const dynamic = "force-dynamic";

export default async function DemoProfessionalHome() {
  await requireDemo();
  const attention = demoStudents.filter(
    (s) => s.screening === "REVIEW_REQUIRED" || s.plan === "DRAFT" || s.portal === "INVITED",
  );
  return (
    <>
      <PageHeading
        eyebrow={demoWorkspace.name}
        title={`Olá, ${demoWorkspace.professional.split(" ")[0]}.`}
        description="Seu atendimento em um só lugar."
        aside={<Pill tone="warning">Dados fictícios</Pill>}
      />
      <div className="kpi-grid">
        <Kpi label="Alunos sob seu atendimento" value={demoStudents.length} />
        <Kpi
          label="Com acesso ao portal"
          value={demoStudents.filter((s) => s.portal === "ACTIVE").length}
        />
        <Kpi
          label="Aguardando sua revisão"
          value={demoStudents.filter((s) => s.screening === "REVIEW_REQUIRED").length}
        />
        <Kpi
          label="Planos entregues"
          value={demoStudents.filter((s) => s.plan === "DELIVERED").length}
        />
      </div>
      <section className="panel">
        <p className="eyebrow">PRECISA DA SUA ATENÇÃO</p>
        <h2>Pendências</h2>
        <ul className="attention-list">
          {attention.map((student) => (
            <li key={student.id}>
              <div>
                <h3>{student.displayName}</h3>
                <p className="small muted">
                  {student.note}
                  {student.plan !== "NONE" && ` · plano: ${planStatusLabel[student.plan]}`}
                </p>
              </div>
              <Link
                className="text-link"
                href={`/demonstracao/profissional/alunos/${student.id}`}
              >
                Abrir <ArrowRight size={15} />
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <p className="small muted">
        As pendências de revisão, plano e avaliação ilustram módulos planejados
        (Avaliações e Prescrição). Na área real, hoje existem cadastro de alunos,
        convite para a área do aluno e periodização.
      </p>
    </>
  );
}
