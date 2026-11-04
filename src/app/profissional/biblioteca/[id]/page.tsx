import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireWorkspace } from "@/modules/auth/server";
import { exercisesFor } from "@/db/exercises";
import { HISTORY_LIMIT, exerciseMetadataFor } from "@/db/exercise-metadata";
import { PageHeading, Pill } from "@/components/ui";
import { ExerciseForm } from "@/modules/biblioteca/exercise-form";
import { ExerciseAction } from "@/modules/biblioteca/exercise-actions";
import { videoLabel } from "@/modules/biblioteca/labels";
import {
  ExerciseAlternatives,
  ExerciseMetadataFields,
  type MetadataFieldView,
} from "@/modules/biblioteca/exercise-metadata-form";
import { REQUIRED_FIELDS } from "@/modules/biblioteca/metadata/vocabulary";
import {
  controlFor,
  fieldTitle,
  historyText,
  provenancePill,
  ruleText,
  summaryPill,
  valueText,
} from "@/modules/biblioteca/metadata/view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Exercício" };

export default async function Exercise({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { db, context, workspace } = await requireWorkspace();
  const { id } = await params;
  const library = exercisesFor(db, context);
  const exercise = await library.find(id);
  if (!exercise) notFound();
  const metadata = await exerciseMetadataFor(db, context).detail(exercise.id);
  if (!metadata) notFound();
  const editable = !metadata.archived;
  const fields: MetadataFieldView[] = metadata.fields.map((entry) => {
    const hidden = entry.system && entry.effective?.scope === "ORGANIZATION";
    return {
      field: entry.field,
      label: fieldTitle(entry.field),
      valueText: valueText(entry.field, entry.effective?.value ?? null),
      value: entry.effective?.value ?? null,
      pill: provenancePill(entry.effective),
      ruleText: ruleText(entry.effective),
      systemText: hidden
        ? `Na biblioteca do sistema: ${valueText(entry.field, entry.system!.value)} (${provenancePill({ ...entry.system!, scope: "SYSTEM", value: entry.system!.value }).text.toLowerCase()}). O ajuste da sua organização vale só para ela.`
        : null,
      version: entry.organization?.version ?? null,
      control: controlFor(entry.field),
      required: REQUIRED_FIELDS.includes(entry.field),
    };
  });
  const taken = new Set([exercise.id, ...metadata.alternatives.map((item) => item.exerciseId)]);
  const candidates = editable
    ? (await library.list()).filter((row) => !taken.has(row.id)).map((row) => ({ id: row.id, name: row.name }))
    : [];
  const summary = summaryPill(metadata.summary);
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
            : "Exercício do sistema, somente leitura. Copie para a sua biblioteca para poder editá-lo. Os metadados abaixo aceitam um ajuste só da sua organização."
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
      <section className="panel" aria-labelledby="metadata-title">
        <h2 id="metadata-title">Metadados para a prescrição automática</h2>
        <p>
          <Pill tone={summary.tone}>{summary.text}</Pill>
        </p>
        <p className="muted">
          A ferramenta usa estes dados para escolher exercícios. Valores inferidos vêm de uma regra pelo nome do
          exercício e aparecem como &quot;Inferido (não revisado)&quot;: não são biomecânica validada. O que você
          salvar fica como revisado por você e sempre vence o inferido.
          {own ? "" : " Num exercício do sistema, o que você salvar é um ajuste só da sua organização."}
        </p>
        <ExerciseMetadataFields
          exerciseId={exercise.id}
          fields={fields}
          editable={editable}
          systemExercise={!own}
        />
        <h3>Alternativas (substituições)</h3>
        <ExerciseAlternatives
          exerciseId={exercise.id}
          editable={editable}
          candidates={candidates}
          alternatives={metadata.alternatives.map((item) => ({
            relationId: item.relationId,
            exerciseId: item.exerciseId,
            name: item.name,
            removable: item.removable,
            pill:
              item.provenance === "REVIEWED"
                ? { text: item.scope === "ORGANIZATION" ? "Revisada pela sua organização" : "Revisada (biblioteca do sistema)", tone: "success" }
                : provenancePill({ value: null, provenance: item.provenance, scope: item.scope, ruleId: null, rulesVersion: null, reviewedAt: null }),
          }))}
        />
        {metadata.history.length > 0 && (
          <details className="metadata-history">
            <summary>Histórico dos metadados</summary>
            <ul>
              {metadata.history.map((event, index) => (
                <li key={index} className="small">
                  {historyText(event)}
                </li>
              ))}
            </ul>
            {metadata.history.length >= HISTORY_LIMIT && (
              <p className="small muted">
                Mostrando as {HISTORY_LIMIT} alterações mais recentes. As anteriores continuam guardadas.
              </p>
            )}
          </details>
        )}
      </section>
      <Link href="/profissional/biblioteca" className="button secondary">
        <ArrowLeft size={17} /> Voltar à biblioteca
      </Link>
    </>
  );
}
