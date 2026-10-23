import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/modules/auth/server";
import { studentsFor } from "@/db/students";
export const dynamic = "force-dynamic";
export default async function Student({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { db, context, workspace } = await requireWorkspace();
  const { id } = await params;
  const student = await studentsFor(db, context).findById(id);
  if (!student) notFound();
  return (
    <>
      <div className="page-heading private-heading">
        <div>
          <p className="eyebrow">{workspace.name}</p>
          <h1>{student.displayName}</h1>
          <p className="muted">Cadastro salvo no seu espaço de atendimento.</p>
        </div>
      </div>
      <section className="panel">
        <h2>O primeiro passo está dado.</h2>
        <p>
          Avaliações, prescrição vinculada e entrega de treinos serão integradas
          nas próximas etapas.
        </p>
        <Link href="/planejamento" className="account-link">
          Explorar o planejador de ciclos
        </Link>
      </section>
      <Link href="/alunos" className="button secondary">
        Voltar aos alunos
      </Link>
    </>
  );
}
