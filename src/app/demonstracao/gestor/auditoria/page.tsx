import { PageHeading, Pill } from "@/components/ui";
import { AuditTable } from "@/modules/gestor/audit-table";
import { requireDemo } from "@/modules/demo/guard";
import { demoAudit } from "@/modules/demo/fixtures";

export const dynamic = "force-dynamic";

export default async function DemoAudit() {
  await requireDemo();
  return (
    <>
      <PageHeading
        eyebrow="PLATAFORMA"
        title="Auditoria"
        description="Ações do gestor sobre acessos. Os registros não podem ser editados por esta tela."
        aside={<Pill tone="warning">Dados fictícios</Pill>}
      />
      <section className="panel">
        <AuditTable events={demoAudit} />
      </section>
    </>
  );
}
