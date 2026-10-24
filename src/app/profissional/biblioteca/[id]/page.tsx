import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireWorkspace } from "@/modules/auth/server";
import { exercisesFor } from "@/db/exercises";
import { PageHeading, Pill } from "@/components/ui";
import { ExerciseForm } from "@/modules/biblioteca/exercise-form";
import { ExerciseAction } from "@/modules/biblioteca/exercise-actions";
import { videoLabel } from "@/modules/biblioteca/labels";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Exercício" };

export default async function Exercise({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { db, context, workspace } = await requireWorkspace();
  const { id } = await params;
  const exercise = await exercisesFor(db, context).find(id);
  if (!exercise) notFound();
  const own = exercise.scope === "ORGANIZATION";
  const video = videoLabel(exercise.videoStatus);
  return (
    <>
      <PageHeading
        eyebrow={`${workspace.name} · ${own ? "Minha biblioteca" : "Biblioteca do sistema"}`}
        title={exercise.name}
        description={
          own
            ? "Editar aqui não altera prescrições já feitas: cada prescrição guarda o nome e o vídeo do momento."
            : "Exercício do sistema, somente leitura. Copie para a sua biblioteca para poder editá-lo."
        }
        aside={exercise.archivedAt ? <Pill>Arquivado</Pill> : undefined}
      />
      {own && !exercise.archivedAt ? (
        <section className="panel">
          <ExerciseForm exercise={exercise} />
        </section>
      ) : (
        <section className="panel">
          <dl className="detail-list">
            <div>
              <dt>Categoria</dt>
              <dd>{exercise.category}</dd>
            </div>
            <div>
              <dt>Nível</dt>
              <dd>{exercise.level ?? "—"}</dd>
            </div>
            <div>
              <dt>Vídeo</dt>
              <dd>
                <Pill tone={video.tone}>{video.text}</Pill>{" "}
                {exercise.videoUrl && (
                  <a
                    className="account-link"
                    href={exercise.videoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Abrir o link
                  </a>
                )}
              </dd>
            </div>
            {exercise.notes && (
              <div>
                <dt>Observações</dt>
                <dd>{exercise.notes}</dd>
              </div>
            )}
          </dl>
          {!own && (
            <ExerciseAction kind="copy" id={exercise.id} label="Copiar para minha biblioteca" />
          )}
          {own && exercise.archivedAt && (
            <ExerciseAction kind="restore" id={exercise.id} label="Restaurar exercício" />
          )}
        </section>
      )}
      {own && !exercise.archivedAt && (
        <section className="panel">
          <h2>Arquivar</h2>
          <p className="muted">
            Um exercício arquivado some das buscas, mas as prescrições que já o
            usaram continuam como estavam.
          </p>
          <ExerciseAction kind="archive" id={exercise.id} label="Arquivar exercício" />
        </section>
      )}
      <Link href="/profissional/biblioteca" className="button secondary">
        <ArrowLeft size={17} /> Voltar à biblioteca
      </Link>
    </>
  );
}
