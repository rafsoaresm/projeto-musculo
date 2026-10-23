import Link from "next/link";
import type { ReactNode } from "react";
import { Kpi, Notice, PageHeading } from "@/components/ui";
import type { OrganizationRow, PlatformSummary } from "@/db/platform";
import { OrganizationTable } from "./organization-table";

/** Manager overview. Counts and organizations only: no student records. */
export function ManagerOverview({
  summary,
  recent,
  organizationsHref,
  detailHref,
  aside,
}: {
  summary: PlatformSummary;
  recent: OrganizationRow[];
  organizationsHref: string;
  detailHref?: (row: OrganizationRow) => string;
  aside?: ReactNode;
}) {
  return (
    <>
      <PageHeading
        eyebrow="PLATAFORMA"
        title="Quem contratou a ferramenta."
        description="Acompanhe as organizações e os profissionais da plataforma."
        aside={aside}
      />
      <Notice>
        <p>
          Você vê organizações, profissionais e contagens. Avaliações, treinos e
          nomes de alunos não aparecem nesta área. Planos, cobrança e afiliados
          são módulos planejados: nenhum número aqui representa receita.
        </p>
      </Notice>
      <div className="kpi-grid">
        <Kpi label="Organizações" value={summary.organizations} />
        <Kpi label="Profissionais ativos" value={summary.professionals} />
        <Kpi
          label="Alunos cadastrados"
          value={summary.students}
          hint="Só a contagem"
        />
        <Kpi label="Acessos de aluno ativos" value={summary.portalAccesses} />
        <Kpi
          label="Profissionais bloqueados"
          value={summary.blockedProfessionals}
        />
      </div>
      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">RECENTES</p>
            <h2>Organizações mais novas</h2>
          </div>
          <Link className="text-link" href={organizationsHref}>
            Ver todas
          </Link>
        </div>
        {recent.length === 0 ? (
          <div className="empty-inline">
            <h3>Nenhuma organização ainda.</h3>
            <p>
              Elas aparecem aqui quando um profissional cria o seu espaço de
              trabalho.
            </p>
          </div>
        ) : (
          <OrganizationTable
            rows={recent}
            hrefFor={detailHref}
            caption="Organizações mais recentes"
          />
        )}
      </section>
    </>
  );
}
