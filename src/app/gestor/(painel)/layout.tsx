import { RoleShell } from "@/components/role-shell";
import { requirePlatformAdmin } from "@/modules/auth/server";
import { surfacesFor } from "@/db/surfaces";
import { areaLinks } from "@/modules/platform/areas";
import { SURFACES, navigationFor } from "@/modules/platform/surfaces";

// Draws the frame only. Each page and action authorizes again: a layout does
// not re-run when the client navigates between pages.
export default async function ManagerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { db, user } = await requirePlatformAdmin();
  const surfaces = await surfacesFor(db, user.id);
  return (
    <RoleShell
      surface="gestor"
      prefix="/gestor"
      roleLabel={SURFACES.gestor.label}
      contextTitle="Plataforma"
      contextText="Organizações e profissionais"
      groups={navigationFor("gestor")}
      areas={areaLinks(surfaces, "gestor")}
      userLabel={user.email}
      canSignOut
    >
      {children}
    </RoleShell>
  );
}
