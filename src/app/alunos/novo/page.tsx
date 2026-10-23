import Link from "next/link";
import { requireWorkspace } from "@/modules/auth/server";
import { StudentForm } from "@/modules/onboarding/forms";
export const dynamic = "force-dynamic";
export default async function NewStudent() {
  await requireWorkspace();
  return (
    <section className="account-card">
      <p className="eyebrow">ATENDIMENTO</p>
      <h1>Conheça seu próximo aluno.</h1>
      <StudentForm />
      <Link className="account-link" href="/alunos">
        Voltar aos alunos
      </Link>
    </section>
  );
}
