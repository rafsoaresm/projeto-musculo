import Link from "next/link";
import { ArrowRight, UserRoundPlus } from "lucide-react";
import { requireWorkspace } from "@/modules/auth/server";
import { studentsFor } from "@/db/students";
import { SignOut } from "@/modules/auth/components/sign-out";
export const dynamic = "force-dynamic";
export default async function Students() {
  const { db, context, workspace } = await requireWorkspace();
  const students = await studentsFor(db, context).list();
  return (
    <>
      <div className="page-heading private-heading">
        <div>
          <p className="eyebrow">{workspace.name}</p>
          <h1>Seus alunos, mais perto.</h1>
          <p className="muted">
            Acompanhe os cadastros vinculados ao seu atendimento.
          </p>
        </div>
      </div>
      <div className="account-toolbar">
        <Link className="button primary" href="/alunos/novo">
          <UserRoundPlus size={20} />
          Novo aluno
        </Link>
        <SignOut />
      </div>
      {students.length === 0 ? (
        <section className="panel">
          <h2>Seu próximo acompanhamento começa aqui.</h2>
          <p>Cadastre o primeiro aluno para organizar seu atendimento.</p>
        </section>
      ) : (
        <div className="student-list">
          {students.map((student) => (
            <Link
              className="student-row"
              key={student.id}
              href={`/alunos/${student.id}`}
            >
              <div>
                <h2>{student.displayName}</h2>
                <p className="small">Cadastro de atendimento</p>
              </div>
              <ArrowRight size={20} />
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
