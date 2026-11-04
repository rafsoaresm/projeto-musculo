import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requireWorkspace } from "@/modules/auth/server";
import { exercisesFor, type ExerciseFilters } from "@/db/exercises";
import { PageHeading } from "@/components/ui";
import { CATEGORIES } from "@/modules/biblioteca/contracts";
import { ExerciseTable } from "@/modules/biblioteca/exercise-table";
import { exerciseMetadataFor } from "@/db/exercise-metadata";
import { EnrichLibraryButton } from "@/modules/biblioteca/exercise-metadata-form";
import { SUMMARY_FILTERS } from "@/modules/biblioteca/metadata/view";
import type { MetadataSummary } from "@/modules/biblioteca/metadata/vocabulary";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Biblioteca de exercícios" };

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default async function Library({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { db, context, workspace } = await requireWorkspace();
  const params = await searchParams;
  const query = first(params.q)?.slice(0, 80) ?? "";
  const category = CATEGORIES.find((item) => item === first(params.categoria));
  const scopeParam = first(params.origem);
  const scope: NonNullable<ExerciseFilters["scope"]> =
    scopeParam === "sistema"
      ? "SYSTEM"
      : scopeParam === "minha"
        ? "ORGANIZATION"
        : "ALL";
  const archived = first(params.arquivados) === "1";
  const metadataParam = first(params.metadados);
  const metadataFilter = SUMMARY_FILTERS.find((item) => item.param === metadataParam);
  const listed = await exercisesFor(db, context).list({
    query,
    category,
    scope,
    includeArchived: archived,
  });
  const resolved = await exerciseMetadataFor(db, context).resolve(
    listed.filter((row) => !row.archivedAt).map((row) => row.id),
  );
  const summaries: Record<string, MetadataSummary> = Object.fromEntries(
    [...resolved.values()].map((entry) => [entry.exerciseId, entry.summary]),
  );
  // Archived rows have no metadata in use, so a metadata filter leaves them out.
  const rows = metadataFilter
    ? listed.filter((row) => summaries[row.id] === metadataFilter.summary)
    : listed;
  return (
    <>
      <PageHeading
        eyebrow={workspace.name}
        title="Biblioteca de exercícios"
        description="A biblioteca do sistema traz 64 exercícios. Os vídeos deles são links de busca, não vídeos revisados, e os metadados para a prescrição automática são inferidos pelo nome, não revisados. Copie um exercício para a sua biblioteca para editá-lo."
        aside={
          <Link className="button primary" href="/profissional/biblioteca/novo">
            <Plus size={20} /> Novo exercício
          </Link>
        }
      />
      <form className="panel filter-form" method="get" role="search">
        <label>
          Buscar pelo nome
          <input name="q" defaultValue={query} maxLength={80} />
        </label>
        <label>
          Categoria
          <select name="categoria" defaultValue={category ?? ""}>
            <option value="">Todas</option>
            {CATEGORIES.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          Origem
          <select name="origem" defaultValue={scopeParam ?? ""}>
            <option value="">Todas</option>
            <option value="sistema">Biblioteca do sistema</option>
            <option value="minha">Minha biblioteca</option>
          </select>
        </label>
        <label>
          Metadados
          <select name="metadados" defaultValue={metadataFilter?.param ?? ""}>
            <option value="">Todos</option>
            {SUMMARY_FILTERS.map((item) => (
              <option key={item.param} value={item.param}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="check-row">
          <input name="arquivados" type="checkbox" value="1" defaultChecked={archived} />
          Mostrar arquivados
        </label>
        <button className="button secondary">Filtrar</button>
      </form>
      <section className="panel" aria-labelledby="enrich-title">
        <h2 id="enrich-title">Metadados para a prescrição automática</h2>
        <p className="muted">
          Para os exercícios da sua biblioteca, a ferramenta pode inferir modalidade, músculos, padrão de
          movimento, equipamento e lateralidade pelo nome, com regras documentadas. Tudo o que for inferido fica
          como &quot;Inferido (não revisado)&quot;; o que alguém já revisou ou marcou como pendente não é alterado.
        </p>
        <EnrichLibraryButton />
      </section>
      {rows.length === 0 ? (
        <section className="panel">
          <h2>Nenhum exercício encontrado.</h2>
          <p>Ajuste a busca ou crie um exercício na sua biblioteca.</p>
        </section>
      ) : (
        <>
          <p className="small muted" role="status">
            {rows.length} {rows.length === 1 ? "exercício" : "exercícios"}
          </p>
          <ExerciseTable rows={rows} metadata={summaries} />
        </>
      )}
    </>
  );
}
