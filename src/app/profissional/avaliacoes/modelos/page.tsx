import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { requireWorkspace } from "@/modules/auth/server";
import { assessmentTemplatesFor } from "@/db/assessment-templates";
import { Notice, PageHeading, Pill, formatDateTime } from "@/components/ui";
import { ORDERABLE_STEP_LABEL, PART_LABEL, TEMPLATE_PARTS, partsCountText, stepOrderOf } from "@/modules/avaliacoes/v2/template";
import { TemplateArchiveButton } from "@/modules/avaliacoes/v2/template-archive-button";
import { canManageTemplates } from "@/modules/avaliacoes/v2/template-access";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Modelos de avaliação" };

/**
 * The models of the Avaliação Física of the organization (handoff V2 section 2: activate or reorder the optional modules per template; slice 0.85).
 * Without a model, an assessment has every module, as before.
 */
export default async function AssessmentTemplates({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const { db, context, workspace } = await requireWorkspace();
  const back = (
    <Link href="/profissional/avaliacoes" className="button secondary">
      <ArrowLeft size={17} /> Voltar à avaliação física
    </Link>
  );
  if (!canManageTemplates(workspace.role))
    return (
      <>
        <PageHeading eyebrow={workspace.name} title="Modelos de avaliação" />
        <Notice tone="warning">
          <p>Os modelos de avaliação são criados pelo responsável, pelo gestor ou por um profissional técnico do espaço.</p>
        </Notice>
        {back}
      </>
    );
  const templates = await assessmentTemplatesFor(db, context).list({ includeArchived: true });
  const { salvo } = await searchParams;
  const saved = typeof salvo === "string" ? templates.find((item) => item.id === salvo) : undefined;
  return (
    <>
      <PageHeading
        eyebrow={workspace.name}
        title="Modelos de avaliação"
        description="Um modelo diz quais partes opcionais da avaliação física entram e em que ordem vêm as etapas do meio. A triagem com o PAR-Q sempre entra. Editar um modelo cria uma nova versão; os rascunhos já iniciados e as avaliações registradas não mudam."
      />
      {saved && (
        <div role="status">
          <Notice>
            <p>
              Modelo “{saved.name}” salvo na versão {saved.version}.
            </p>
          </Notice>
        </div>
      )}
      <div className="assessment-start">
        <Link className="button primary small" href="/profissional/avaliacoes/modelos/novo">
          <Plus size={16} /> Novo modelo
        </Link>
      </div>
      {templates.length === 0 ? (
        <section className="panel">
          <h2>Nenhum modelo ainda.</h2>
          <p>Sem modelo, cada avaliação física tem todas as partes, como hoje. Crie um modelo para avaliações que usam só algumas delas.</p>
        </section>
      ) : (
        <div className="table-wrap">
          <table className="data-table stack">
            <caption className="sr-only">Modelos de avaliação física</caption>
            <thead>
              <tr>
                <th scope="col">Modelo</th>
                <th scope="col">Partes</th>
                <th scope="col">Ordem das etapas</th>
                <th scope="col">Uso</th>
                <th scope="col">Ações</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((item) => {
                const off = TEMPLATE_PARTS.filter((part) => !item.enabled.includes(part));
                return (
                  <tr key={item.id}>
                    <th scope="row" data-label="Modelo">
                      {item.archivedAt ? (
                        <span>{item.name}</span>
                      ) : (
                        <Link className="row-link" href={`/profissional/avaliacoes/modelos/${item.id}`}>
                          {item.name}
                        </Link>
                      )}{" "}
                      <span className="small muted">
                        versão {item.version} · {formatDateTime(item.updatedAt)}
                      </span>{" "}
                      {item.archivedAt && <Pill tone="neutral">Arquivado</Pill>}
                    </th>
                    <td data-label="Partes">
                      {partsCountText(item.enabled)}
                      {off.length > 0 && <span className="small muted"> · fora: {off.map((part) => PART_LABEL[part]).join(", ")}</span>}
                    </td>
                    <td data-label="Ordem das etapas">Triagem, {stepOrderOf(item.enabled).map((step) => ORDERABLE_STEP_LABEL[step]).join(", ")}, Revisão</td>
                    <td data-label="Uso">{item.assessments === 0 ? "Nenhuma avaliação" : `${item.assessments} ${item.assessments === 1 ? "avaliação" : "avaliações"}`}</td>
                    <td data-label="Ações">
                      <TemplateArchiveButton id={item.id} name={item.name} archived={item.archivedAt !== null} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {back}
    </>
  );
}
