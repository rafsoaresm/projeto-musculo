import { PageHeading, Pill } from "@/components/ui";
import { requireDemo } from "@/modules/demo/guard";
import { WorkoutPreview } from "@/modules/demo/workout-preview";

export const dynamic = "force-dynamic";

export default async function DemoWorkout() {
  await requireDemo();
  return (
    <>
      <PageHeading
        eyebrow="MÓDULO PLANEJADO · E4"
        title="Treino atual"
        description="O treino que o seu profissional entregou."
        aside={<Pill tone="warning">Prévia · não existe ainda</Pill>}
      />
      <WorkoutPreview />
    </>
  );
}
