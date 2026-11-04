import { Notice, PageHeading, Pill } from "@/components/ui";
import { requireDemo } from "@/modules/demo/guard";
import { ASSESSMENT_NAME } from "@/modules/avaliacoes/names";

export const dynamic = "force-dynamic";

/** The demonstration never invents an assessment: it says what the real page shows. */
export default async function DemoStudentAssessments() {
  await requireDemo();
  return (
    <>
      <PageHeading
        eyebrow="ÁREA DO ALUNO"
        title={ASSESSMENT_NAME}
        description="As avaliações que o seu profissional registrou, com o relatório em PDF."
        aside={<Pill tone="warning">Prévia · sem dados</Pill>}
      />
      <Notice>
        <p>
          Na demonstração o aluno fictício não tem avaliação registrada, e a ferramenta não inventa medidas nem resultados. Na área real, esta
          tela lista as avaliações físicas que o seu profissional finalizou, cada uma com o relatório em PDF: o que foi medido, os resultados
          com o método de cada um, a classificação pelas tabelas de referência quando há e as considerações do profissional. O que não foi medido aparece como não realizado,
          nunca como zero.
        </p>
      </Notice>
    </>
  );
}
