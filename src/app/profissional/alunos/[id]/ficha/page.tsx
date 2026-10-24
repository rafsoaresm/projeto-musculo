import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireWorkspace } from "@/modules/auth/server";
import { studentsFor } from "@/db/students";
import { profilesFor } from "@/db/student-profile";
import { PageHeading } from "@/components/ui";
import { ProfileForm } from "@/modules/ficha/profile-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ficha do aluno" };

export default async function StudentProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { db, context, workspace } = await requireWorkspace();
  const { id } = await params;
  const student = await studentsFor(db, context).findById(id);
  if (!student) notFound();
  const profile = await profilesFor(db, context).get(student.id);
  return (
    <>
      <PageHeading
        eyebrow={workspace.name}
        title={`Ficha de ${student.displayName}`}
        description="Identificação, contexto de treino, histórico e preferências. Tudo é opcional: preencha o que o aluno relatou."
      />
      <section className="panel">
        <ProfileForm studentId={student.id} profile={profile} />
      </section>
      <Link href={`/profissional/alunos/${student.id}`} className="button secondary">
        <ArrowLeft size={17} /> Voltar ao aluno
      </Link>
    </>
  );
}
