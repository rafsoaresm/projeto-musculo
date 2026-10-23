import { notFound } from "next/navigation";
import { PlannedModule } from "@/components/planned-module";
import { requireDemo } from "@/modules/demo/guard";
import { SURFACES, findPlanned } from "@/modules/platform/surfaces";

export const dynamic = "force-dynamic";

export default async function DemoAlunoPlanned({
  params,
}: {
  params: Promise<{ modulo: string }>;
}) {
  await requireDemo();
  const { modulo } = await params;
  const item = findPlanned("aluno", modulo);
  if (!item) notFound();
  return <PlannedModule item={item} roleLabel={SURFACES.aluno.label} />;
}
