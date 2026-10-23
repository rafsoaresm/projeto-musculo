import { notFound } from "next/navigation";
import { requireWorkspace } from "@/modules/auth/server";
import { PlannedModule } from "@/components/planned-module";
import { SURFACES, findPlanned } from "@/modules/platform/surfaces";

export const dynamic = "force-dynamic";

export default async function ProfessionalPlannedModule({
  params,
}: {
  params: Promise<{ modulo: string }>;
}) {
  await requireWorkspace();
  const { modulo } = await params;
  const item = findPlanned("profissional", modulo);
  if (!item) notFound();
  return <PlannedModule item={item} roleLabel={SURFACES.profissional.label} />;
}
