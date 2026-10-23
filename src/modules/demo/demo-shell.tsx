import type { ReactNode } from "react";
import { RoleShell } from "@/components/role-shell";
import { SURFACES, type SurfaceId } from "@/modules/platform/surfaces";
import { demoAreas, demoNavigation, demoPrefix } from "./navigation";
import { demoClient, demoWorkspace } from "./fixtures";
import { requireDemo } from "./guard";

const context: Record<SurfaceId, { title: string; text: string }> = {
  gestor: { title: "Plataforma", text: "Organizações e profissionais" },
  profissional: { title: demoWorkspace.name, text: demoWorkspace.role },
  aluno: {
    title: demoClient.studentName,
    text: `com ${demoClient.professionalName}`,
  },
};

export async function DemoShell({
  surface,
  children,
}: {
  surface: SurfaceId;
  children: ReactNode;
}) {
  await requireDemo();
  return (
    <RoleShell
      demo
      surface={surface}
      prefix={demoPrefix(surface)}
      roleLabel={SURFACES[surface].label}
      contextTitle={context[surface].title}
      contextText={context[surface].text}
      groups={demoNavigation(surface)}
      areas={demoAreas(surface)}
      userLabel="Demonstração"
    >
      {children}
    </RoleShell>
  );
}
