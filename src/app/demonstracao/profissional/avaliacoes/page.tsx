import { requireDemo } from "@/modules/demo/guard";
import { ModulePreview } from "@/modules/demo/module-preview";

export const dynamic = "force-dynamic";

export default async function DemoAssessments() {
  await requireDemo();
  return (
    <ModulePreview
      eyebrow="PRINCIPAL"
      title="Avaliação Física"
      description="Triagem, medidas, movimento e revisão de cada aluno."
    >
      Na demonstração não há avaliações fictícias: a ferramenta não inventa respostas de triagem nem medidas. Na
      área real, a avaliação física é guiada em etapas (triagem, medidas, movimento e revisão), salva como rascunho e,
      depois de registrada, não muda.
    </ModulePreview>
  );
}
