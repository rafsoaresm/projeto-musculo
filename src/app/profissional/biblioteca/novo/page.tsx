import type { Metadata } from "next";
import Link from "next/link";
import { requireWorkspace } from "@/modules/auth/server";
import { ExerciseForm } from "@/modules/biblioteca/exercise-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Novo exercício" };

export default async function NewExercise() {
  await requireWorkspace();
  return (
    <section className="account-card">
      <p className="eyebrow">BIBLIOTECA</p>
      <h1>Um exercício seu.</h1>
      <ExerciseForm />
      <Link className="account-link" href="/profissional/biblioteca">
        Voltar à biblioteca
      </Link>
    </section>
  );
}
