import { requireDemo } from "@/modules/demo/guard";
import { ModulePreview } from "@/modules/demo/module-preview";

export const dynamic = "force-dynamic";

export default async function DemoLibrary() {
  await requireDemo();
  return (
    <ModulePreview
      eyebrow="CONHECIMENTO"
      title="Biblioteca de exercícios"
      description="Os exercícios do documento mestre e os do seu espaço."
    >
      Na demonstração a biblioteca não é aberta. Na área real, ela traz os 64 exercícios do documento mestre e
      permite cadastrar os do seu espaço, com vídeo e observações que só você vê. Os exercícios que você usa na
      prescrição vêm daqui ou são digitados com nome próprio.
    </ModulePreview>
  );
}
