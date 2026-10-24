import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requireWorkspace } from "@/modules/auth/server";
import { exercisesFor, type ExerciseFilters } from "@/db/exercises";
import { PageHeading } from "@/components/ui";
import { CATEGORIES } from "@/modules/biblioteca/contracts";
import { ExerciseTable } from "@/modules/biblioteca/exercise-table";

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
  const rows = await exercisesFor(db, context).list({
    query,
    category,
    scope,
    includeArchived: archived,
  });
  return (
    <>
      <PageHeading
        eyebrow={workspace.name}
        title="Biblioteca de exercícios"
        description="A biblioteca do sistema traz os 64 exercícios do documento mestre. Os vídeos deles são links de busca, não vídeos revisados. Copie um exercício para a sua biblioteca para editá-lo."
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
        <label className="check-row">
          <input name="arquivados" type="checkbox" value="1" defaultChecked={archived} />
          Mostrar arquivados
        </label>
        <button className="button secondary">Filtrar</button>
      </form>
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
          <ExerciseTable rows={rows} />
        </>
      )}
    </>
  );
}
