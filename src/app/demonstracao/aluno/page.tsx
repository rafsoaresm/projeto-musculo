import { PortalHome } from "@/modules/portal/portal-home";
import { requireDemo } from "@/modules/demo/guard";
import { demoClient } from "@/modules/demo/fixtures";

export const dynamic = "force-dynamic";

export default async function DemoStudentHome() {
  await requireDemo();
  return (
    <PortalHome
      links={[
        {
          studentId: "carlos",
          studentName: demoClient.studentName,
          organizationName: demoClient.organizationName,
          professionalName: demoClient.professionalName,
          since: demoClient.since,
        },
      ]}
      currentPlan={demoClient.plan}
      trainingHref="/demonstracao/aluno/treino"
      trainingLinkLabel="Abrir o treino de hoje (prévia)"
    />
  );
}
