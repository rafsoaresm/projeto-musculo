import Link from "next/link";
import { Pill } from "@/components/ui";
import type { ExerciseRecord } from "@/db/exercises";
import { videoLabel } from "./labels";

export function ExerciseTable({ rows }: { rows: ExerciseRecord[] }) {
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
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
