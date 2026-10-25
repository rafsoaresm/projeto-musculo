import { Notice, PageHeading, Pill } from "@/components/ui";
import { requireDemo } from "@/modules/demo/guard";

export const dynamic = "force-dynamic";

/** The demonstration never invents a load or a count: it says what the real page shows. */
export default async function DemoProgress() {
  await requireDemo();
  return (
    <>
      <PageHeading
        eyebrow="ÁREA DO ALUNO"
        title="Evolução"
        description="O que você registrou nos seus treinos."
        aside={<Pill tone="warning">Prévia · sem dados</Pill>}
      />
      <Notice>
        <p>
          Na demonstração o aluno fictício não tem registros, e a ferramenta não inventa cargas nem contagens.
          Na área real, esta tela mostra os treinos que você registrou em cada semana ao lado dos previstos pelo
          seu ciclo, a maior carga que você anotou em cada exercício e os seus últimos registros. Semana sem
          registro não quer dizer que você não treinou, e dado ausente continua ausente: nunca vira zero.
        </p>
      </Notice>
    </>
  );
}
