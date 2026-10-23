import { PageHeading, Pill } from "@/components/ui";
import { StudentList } from "@/modules/atendimento/student-list";
import { requireDemo } from "@/modules/demo/guard";
import {
  demoStudents,
  demoWorkspace,
  planStatusLabel,
  planStatusTone,
} from "@/modules/demo/fixtures";

export const dynamic = "force-dynamic";

export default async function DemoStudents() {
  await requireDemo();
  return (
    <>
      <PageHeading
        eyebrow={demoWorkspace.name}
        title="Seus alunos, mais perto."
        description="Acompanhe os cadastros vinculados ao seu atendimento."
        aside={<Pill tone="warning">Dados fictícios</Pill>}
      />
      <StudentList
        students={demoStudents.map((student) => ({
          id: student.id,
          displayName: student.displayName,
          portal: student.portal,
          note: student.note,
          badge:
            student.plan === "NONE"
              ? undefined
              : {
                  tone: planStatusTone[student.plan],
                  label: `Plano: ${planStatusLabel[student.plan]}`,
                },
        }))}
        hrefFor={(student) => `/demonstracao/profissional/alunos/${student.id}`}
      />
    </>
  );
}
