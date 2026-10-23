import { notFound } from "next/navigation";
import { requireStudent } from "@/modules/auth/server";
import { PlannedModule } from "@/components/planned-module";
import { SURFACES, findPlanned } from "@/modules/platform/surfaces";

export const dynamic = "force-dynamic";

export default async function StudentPlannedModule({
  params,
}: {
  params: Promise<{ modulo: string }>;
}) {
  await requireStudent();
  const { modulo } = await params;
  const item = findPlanned("aluno", modulo);
  if (!item) notFound();
  return <PlannedModule item={item} roleLabel={SURFACES.aluno.label} />;
}
