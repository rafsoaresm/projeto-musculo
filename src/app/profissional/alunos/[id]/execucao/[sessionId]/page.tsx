import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireWorkspace } from "@/modules/auth/server";
import { studentsFor } from "@/db/students";
import { executionFor } from "@/db/workout-sessions";
import { Notice, PageHeading, Pill, formatDateTime } from "@/components/ui";
import { describeDose } from "@/modules/prescricao/describe";
import { formatCalendarDate } from "@/modules/training/format";
import { AcknowledgeForm } from "@/modules/execucao/acknowledge-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Registro de treino" };

const kg = (value: number) => String(value).replace(".", ",");

export default async function SessionDetail({
  params,
}: {
  params: Promise<{ id: string; sessionId: string }>;
}) {
  const { db, context, workspace } = await requireWorkspace();
  const { id, sessionId } = await params;
  const student = await studentsFor(db, context).findById(id);
  if (!student) notFound();
  const detail = await executionFor(db, context).detail(sessionId);
  // A log of another student is not found under this student's address.
  if (!detail || detail.studentId !== student.id) notFound();
  return (
    <>
      <PageHeading
        eyebrow={workspace.name}
        title={`Treino ${detail.workoutLabel} de ${formatCalendarDate(detail.performedOn)}`}
        description={`${student.displayName} · ${detail.planTitle}, revisão ${detail.revisionNumber}, fase ${detail.phaseIndex}`}
      />
      {detail.painReported && (
        <Notice tone="warning">
          <p>
            <strong>O aluno relatou dor ou desconforto neste treino.</strong> O relato é mantido como foi
            registrado e não é interpretado pela ferramenta. A conduta é sua.
          </p>
        </Notice>
      )}
      <section className="panel" aria-labelledby="execucao-resumo">
        <h2 id="execucao-resumo">Resumo</h2>
        <p>
          Esforço percebido: {detail.effort === null ? "não informado" : `${detail.effort} de 10`} · exercícios
          feitos: {detail.exercisesDone} de {detail.exercisesPlanned} · séries registradas: {detail.setsLogged}
        </p>
        {detail.notes && <p>Observações do aluno: {detail.notes}</p>}
        <p className="small muted">
          Registrado em {formatDateTime(detail.createdAt)}.{" "}
          {detail.acknowledgedAt ? <Pill tone="success">Lido</Pill> : <Pill>Não lido</Pill>}
        </p>
      </section>
      <section className="panel" aria-labelledby="execucao-comparacao">
        <h2 id="execucao-comparacao">Prescrito e executado</h2>
        {detail.exercises.length === 0 ? (
          <p>O aluno não registrou exercícios neste dia.</p>
        ) : (
          <div className="execution-scroll">
            <table className="execution-table">
              <thead>
                <tr>
                  <th scope="col">Exercício</th>
                  <th scope="col">Prescrito</th>
                  <th scope="col">Executado</th>
                  <th scope="col">Observações</th>
                </tr>
              </thead>
              <tbody>
                {detail.exercises.map((exercise) => (
                  <tr key={exercise.prescribedExerciseId}>
                    <td>
                      <strong>{exercise.name}</strong>
                      {exercise.pain && (
                        <>
                          {" "}
                          <Pill tone="warning">Dor ou desconforto</Pill>
                        </>
                      )}
                    </td>
                    <td>{describeDose(exercise.planned) || "Sem parâmetros"}</td>
                    <td>
                      {!exercise.done ? (
                        "Não feito"
                      ) : exercise.sets.length === 0 ? (
                        "Feito, sem séries anotadas"
                      ) : (
                        <ol>
                          {exercise.sets.map((set) => (
                            <li key={set.setNumber}>
                              Série {set.setNumber}: {set.reps === null ? "—" : `${set.reps} rep.`}
                              {set.loadKg === null ? "" : ` × ${kg(set.loadKg)} kg`}
                            </li>
                          ))}
                        </ol>
                      )}
                      {exercise.rir !== null && <p className="small muted">RIR informado: {exercise.rir}</p>}
                    </td>
                    <td>{exercise.notes ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {detail.notLogged.length > 0 && (
          <p className="small muted">
            Sem registro: {detail.notLogged.join(", ")}. Sem registro não quer dizer que não foi feito.
          </p>
        )}
      </section>
      <section className="panel" aria-labelledby="execucao-leituras">
        <h2 id="execucao-leituras">Leituras do profissional</h2>
        {detail.acknowledgements.length === 0 ? (
          <p className="muted">Nenhuma leitura registrada ainda.</p>
        ) : (
          <ul className="review-list">
            {detail.acknowledgements.map((reading, index) => (
              <li key={index}>
                <p>
                  <strong>{reading.reviewerName ?? "Profissional"}</strong> · {formatDateTime(reading.createdAt)}
                </p>
                {reading.note && <p>{reading.note}</p>}
              </li>
            ))}
          </ul>
        )}
        <AcknowledgeForm sessionId={detail.id} />
      </section>
      <Link href={`/profissional/alunos/${student.id}/execucao`} className="button secondary">
        <ArrowLeft size={17} /> Voltar aos registros
      </Link>
    </>
  );
}
