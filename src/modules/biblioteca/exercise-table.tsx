import Link from "next/link";
import { Pill } from "@/components/ui";
import type { ExerciseRecord } from "@/db/exercises";
import { videoLabel } from "./labels";
import type { MetadataSummary } from "./metadata/vocabulary";
import { summaryPill } from "./metadata/view";

export function ExerciseTable({
  rows,
  metadata,
}: {
  rows: ExerciseRecord[];
  /** Per exercise, the provenance of its metadata (absent for archived rows). */
  metadata?: Record<string, MetadataSummary>;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table stack">
        <caption className="sr-only">Exercícios da biblioteca</caption>
        <thead>
          <tr>
            <th scope="col">Exercício</th>
            <th scope="col">Categoria</th>
            <th scope="col">Nível</th>
            <th scope="col">Vídeo</th>
            <th scope="col">Origem</th>
            {metadata && <th scope="col">Metadados</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const video = videoLabel(row.videoStatus);
            return (
              <tr key={row.id}>
                <th scope="row" data-label="Exercício">
                  <Link
                    className="row-link"
                    href={`/profissional/biblioteca/${row.id}`}
                  >
                    {row.name}
                  </Link>
                  {row.archivedAt && <Pill>Arquivado</Pill>}
                </th>
                <td data-label="Categoria">{row.category}</td>
                <td data-label="Nível">{row.level ?? "—"}</td>
                <td data-label="Vídeo">
                  <Pill tone={video.tone}>{video.text}</Pill>
                </td>
                <td data-label="Origem">
                  {row.scope === "SYSTEM" ? (
                    <Pill>Biblioteca do sistema</Pill>
                  ) : (
                    <Pill tone="brand">Minha biblioteca</Pill>
                  )}
                </td>
                {metadata && (
                  <td data-label="Metadados">
                    {metadata[row.id] ? (
                      <Pill tone={summaryPill(metadata[row.id]).tone}>{summaryPill(metadata[row.id]).text}</Pill>
                    ) : (
                      "—"
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
