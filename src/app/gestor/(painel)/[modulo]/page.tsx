import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/modules/auth/server";
import { PlannedModule } from "@/components/planned-module";
import { SURFACES, findPlanned } from "@/modules/platform/surfaces";

export const dynamic = "force-dynamic";

export default async function ManagerPlannedModule({
  params,
}: {
  params: Promise<{ modulo: string }>;
}) {
  await requirePlatformAdmin();
  const { modulo } = await params;
  const item = findPlanned("gestor", modulo);
  if (!item) notFound();
  return <PlannedModule item={item} roleLabel={SURFACES.gestor.label} />;
}
