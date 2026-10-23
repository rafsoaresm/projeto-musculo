import type { Metadata } from "next";
import Link from "next/link";
import { UserRoundPlus } from "lucide-react";
import { requireWorkspace } from "@/modules/auth/server";
import { studentsFor } from "@/db/students";
import { studentAccessFor } from "@/db/student-access";
import { PageHeading } from "@/components/ui";
import { StudentList } from "@/modules/atendimento/student-list";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Alunos" };

export default async function Students() {
  const { db, context, workspace } = await requireWorkspace();
  const [students, access] = await Promise.all([
    studentsFor(db, context).list(),
    studentAccessFor(db, context).statuses(),
  ]);
  const portal = new Map(access.map((status) => [status.studentId, status]));
  return (
    <>
      <PageHeading
        eyebrow={workspace.name}
        title="Seus alunos, mais perto."
        description="Acompanhe os cadastros vinculados ao seu atendimento."
        aside={
          <Link className="button primary" href="/profissional/alunos/novo">
            <UserRoundPlus size={20} />
            Novo aluno
          </Link>
        }
      />
      {students.length === 0 ? (
        <section className="panel">
          <h2>Seu próximo acompanhamento começa aqui.</h2>
          <p>Cadastre o primeiro aluno para organizar seu atendimento.</p>
        </section>
      ) : (
        <StudentList
          students={students.map((student) => ({
            id: student.id,
            displayName: student.displayName,
            portal: portal.get(student.id)?.access ?? "NONE",
          }))}
          hrefFor={(student) => `/profissional/alunos/${student.id}`}
        />
      )}
    </>
  );
}
