import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/modules/auth/server";
import { platformFor } from "@/db/platform";
import { Notice, PageHeading } from "@/components/ui";
import { AuditTable } from "@/modules/gestor/audit-table";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Auditoria · Gestor" };

export default async function Audit() {
  const { db, context } = await requirePlatformAdmin();
  const events = await platformFor(db, context).listAudit(100);
  return (
    <>
      <PageHeading
        eyebrow="PLATAFORMA"
        title="Auditoria"
        description="Ações do gestor sobre acessos. Os registros não podem ser editados por esta tela."
      />
      <Notice>
        <p>
          Esta trilha cobre ativação do gestor e bloqueios. Leituras, logins e
          alterações de dados ainda não são auditados.
        </p>
      </Notice>
      <section className="panel">
        {events.length === 0 ? (
          <div className="empty-inline">
            <h3>Nenhum registro ainda.</h3>
          </div>
        ) : (
          <AuditTable events={events} />
        )}
      </section>
    </>
  );
}
