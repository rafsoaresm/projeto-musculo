import { RoleShell } from "@/components/role-shell";
import { requireStudent } from "@/modules/auth/server";
import { surfacesFor } from "@/db/surfaces";
import { areaLinks } from "@/modules/platform/areas";
import { SURFACES, navigationFor } from "@/modules/platform/surfaces";

// Draws the frame only. Each page and action authorizes again: a layout does
// not re-run when the client navigates between pages.
export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { db, user, links } = await requireStudent();
  const surfaces = await surfacesFor(db, user.id);
  const [first] = links;
  return (
    <RoleShell
      surface="aluno"
      prefix="/aluno"
      roleLabel={SURFACES.aluno.label}
      contextTitle={links.length === 1 ? first.studentName : "Seus acompanhamentos"}
      contextText={
        links.length === 1
          ? first.professionalName
            ? `com ${first.professionalName}`
            : first.organizationName
          : `${links.length} profissionais`
      }
      groups={navigationFor("aluno")}
      areas={areaLinks(surfaces, "aluno")}
      userLabel={user.name}
      canSignOut
    >
      {children}
    </RoleShell>
  );
}
