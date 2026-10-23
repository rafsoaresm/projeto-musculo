import { RoleShell } from "@/components/role-shell";
import { requireWorkspace } from "@/modules/auth/server";
import { surfacesFor } from "@/db/surfaces";
import { MEMBERSHIP_ROLE_LABEL, areaLinks } from "@/modules/platform/areas";
import { SURFACES, navigationFor } from "@/modules/platform/surfaces";

// Draws the frame only. Each page and action authorizes again: a layout does
// not re-run when the client navigates between pages.
export default async function ProfessionalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { db, user, workspace } = await requireWorkspace();
  const surfaces = await surfacesFor(db, user.id);
  return (
    <RoleShell
      surface="profissional"
      prefix="/profissional"
      roleLabel={SURFACES.profissional.label}
      contextTitle={workspace.name}
      contextText={MEMBERSHIP_ROLE_LABEL[workspace.role] ?? workspace.role}
      groups={navigationFor("profissional")}
      areas={areaLinks(surfaces, "profissional")}
      userLabel={user.name}
      canSignOut
    >
      {children}
    </RoleShell>
  );
}
