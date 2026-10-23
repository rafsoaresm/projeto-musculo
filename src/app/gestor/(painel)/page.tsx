import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/modules/auth/server";
import { platformFor } from "@/db/platform";
import { ManagerOverview } from "@/modules/gestor/overview";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Visão geral · Gestor" };

export default async function ManagerHome() {
  const { db, context } = await requirePlatformAdmin();
  const repo = platformFor(db, context);
  const [summary, recent] = await Promise.all([
    repo.summary(),
    repo.listOrganizations(5),
  ]);
  return (
    <ManagerOverview
      summary={summary}
      recent={recent}
      organizationsHref="/gestor/organizacoes"
      detailHref={(row) => `/gestor/organizacoes/${row.id}`}
    />
  );
}
