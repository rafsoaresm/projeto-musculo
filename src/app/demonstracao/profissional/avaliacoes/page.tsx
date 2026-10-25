import { requireDemo } from "@/modules/demo/guard";
import { ModulePreview } from "@/modules/demo/module-preview";

export const dynamic = "force-dynamic";

export default async function DemoAssessments() {
  await requireDemo();
  return (
    <ModulePreview
      eyebrow="ATENDIMENTO"
      title="Avaliações"
      description="Triagem, indicadores, postura e movimento de cada aluno."
    >
      Na demonstração não há avaliações fictícias: a ferramenta não inventa respostas de triagem nem medidas. Na
      área real, cada avaliação registra a triagem dos seis itens do documento mestre, os indicadores que você
      escolher, a postura e o movimento, e depois de registrada ela não muda. Um item de triagem marcado pede a sua
      revisão antes de aprovar ou entregar um plano.
    </ModulePreview>
  );
}
