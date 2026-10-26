import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/modules/auth/server";
import { platformFor } from "@/db/platform";
import { PageHeading } from "@/components/ui";
import { ManagersPanel } from "@/modules/gestor/managers-panel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Gestores · Gestor" };

export default async function Managers() {
  const { db, context } = await requirePlatformAdmin();
  const repo = platformFor(db, context);
  const [managers, invites] = await Promise.all([repo.listManagers(), repo.listManagerInvites(30)]);
  return (
    <>
      <PageHeading
        eyebrow="PLATAFORMA"
        title="Gestores"
        description="Quem opera a plataforma, e como acrescentar mais uma pessoa sem depender do código de ativação."
      />
      <ManagersPanel managers={managers} invites={invites} />
    </>
  );
}
