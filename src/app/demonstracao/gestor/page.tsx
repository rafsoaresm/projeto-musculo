import { Pill } from "@/components/ui";
import { ManagerOverview } from "@/modules/gestor/overview";
import { requireDemo } from "@/modules/demo/guard";
import { demoOrganizations, demoSummary } from "@/modules/demo/fixtures";

export const dynamic = "force-dynamic";

export default async function DemoManagerHome() {
  await requireDemo();
  return (
    <ManagerOverview
      summary={demoSummary}
      recent={[...demoOrganizations].reverse().slice(0, 4)}
      organizationsHref="/demonstracao/gestor/organizacoes"
      aside={<Pill tone="warning">Dados fictícios</Pill>}
    />
  );
}
