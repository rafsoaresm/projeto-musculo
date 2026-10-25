import { Notice, PageHeading, Pill } from "@/components/ui";
import { CHECKIN_URGENCY_NOTICE } from "@/modules/checkin/contracts";
import { requireDemo } from "@/modules/demo/guard";

export const dynamic = "force-dynamic";

/** The demonstration shows no answers: the tool never invents how a person feels. */
export default async function DemoCheckin() {
  await requireDemo();
  return (
    <>
      <PageHeading
        eyebrow="ÁREA DO ALUNO"
        title="Check-in"
        description="Como você está: esforço, recuperação e desconforto. Um por dia, quando quiser."
        aside={<Pill tone="warning">Prévia · sem dados</Pill>}
      />
      <Notice tone="warning">
        <p>{CHECKIN_URGENCY_NOTICE}</p>
      </Notice>
      <Notice>
        <p>
          Na demonstração o aluno fictício não faz check-ins, e a ferramenta não inventa respostas. Na área
          real, esta tela tem um check-in por dia com o esforço percebido (0 a 10), quanto você sente que
          recuperou, um campo para dor ou desconforto e observações. Um relato de desconforto fica registrado
          como foi dito e não pode ser apagado; o profissional lê e decide, e nada muda no seu treino por causa
          do que você respondeu.
        </p>
      </Notice>
    </>
  );
}
