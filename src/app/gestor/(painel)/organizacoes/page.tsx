import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/modules/auth/server";
import { platformFor } from "@/db/platform";
import { PageHeading } from "@/components/ui";
import { OrganizationTable } from "@/modules/gestor/organization-table";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Organizações · Gestor" };

export default async function Organizations() {
  const { db, context } = await requirePlatformAdmin();
  const rows = await platformFor(db, context).listOrganizations(200);
  return (
    <>
      <PageHeading
        eyebrow="PLATAFORMA"
        title="Organizações"
        description="Cada organização é um profissional solo, uma equipe ou um estúdio que contratou a ferramenta."
      />
      <section className="panel">
        {rows.length === 0 ? (
          <div className="empty-inline">
            <h3>Nenhuma organização ainda.</h3>
            <p>
              Elas aparecem aqui quando um profissional cria o seu espaço de
              trabalho.
            </p>
          </div>
        ) : (
          <OrganizationTable
            rows={rows}
            hrefFor={(row) => `/gestor/organizacoes/${row.id}`}
            caption="Todas as organizações"
          />
        )}
      </section>
    </>
  );
}
