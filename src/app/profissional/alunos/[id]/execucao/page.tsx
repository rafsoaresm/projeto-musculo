import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireWorkspace } from "@/modules/auth/server";
import { studentsFor } from "@/db/students";
import { executionFor } from "@/db/workout-sessions";
import { PageHeading, Pill } from "@/components/ui";
import { formatCalendarDate } from "@/modules/training/format";
import { ProgressView } from "@/modules/execucao/progress-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Execução dos treinos" };

export default async function StudentExecution({ params }: { params: Promise<{ id: string }> }) {
  const { db, context, workspace } = await requireWorkspace();
  const { id } = await params;
  const student = await studentsFor(db, context).findById(id);
  if (!student) notFound();
  const execution = executionFor(db, context);
  const [rows, progress] = await Promise.all([execution.list(student.id, 100), execution.progress(student.id)]);
  return (
    <>
      <PageHeading
        eyebrow={workspace.name}
        title={`Execução dos treinos de ${student.displayName}`}
        description="O que o aluno registrou depois de treinar, do mais recente para o mais antigo."
      />
      <ProgressView progress={progress} />
      <section className="panel" aria-labelledby="execucao-lista">
        <h2 id="execucao-lista">Registros do aluno</h2>
        {rows.length === 0 ? (
          <p>O aluno ainda não registrou nenhum treino.</p>
        ) : (
          <div className="execution-scroll">
            <table className="execution-table">
              <thead>
                <tr>
                  <th scope="col">Data</th>
                  <th scope="col">Treino</th>
                  <th scope="col">Exercícios feitos</th>
                  <th scope="col">Séries</th>
                  <th scope="col">Esforço</th>
                  <th scope="col">Situação</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link className="account-link" href={`/profissional/alunos/${student.id}/execucao/${row.id}`}>
                        {formatCalendarDate(row.performedOn)}
                      </Link>
                    </td>
                    <td>
                      {row.workoutLabel}, fase {row.phaseIndex} · {row.planTitle}
                    </td>
                    <td>
                      {row.exercisesDone} de {row.exercisesPlanned}
                    </td>
                    <td>{row.setsLogged}</td>
                    <td>{row.effort === null ? "Não informado" : `${row.effort} de 10`}</td>
                    <td>
                      {row.painReported && <Pill tone="warning">Relato de dor</Pill>}{" "}
                      {row.acknowledgedAt ? <Pill tone="success">Lido</Pill> : <Pill>Não lido</Pill>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <Link href={`/profissional/alunos/${student.id}`} className="button secondary">
        <ArrowLeft size={17} /> Voltar ao aluno
      </Link>
    </>
  );
}
