import { PageHeading, Pill } from "@/components/ui";
import { OrganizationTable } from "@/modules/gestor/organization-table";
import { requireDemo } from "@/modules/demo/guard";
import { demoOrganizations } from "@/modules/demo/fixtures";

export const dynamic = "force-dynamic";

export default async function DemoOrganizations() {
  await requireDemo();
  return (
    <>
      <PageHeading
        eyebrow="PLATAFORMA"
        title="Organizações"
        description="Cada organização é um profissional solo, uma equipe ou um estúdio que contratou a ferramenta."
        aside={<Pill tone="warning">Dados fictícios</Pill>}
      />
      <section className="panel">
        <OrganizationTable
          rows={[...demoOrganizations].reverse()}
          caption="Organizações de demonstração"
        />
      </section>
    </>
  );
}
