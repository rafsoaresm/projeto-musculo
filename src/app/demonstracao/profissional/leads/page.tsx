import { Notice, PageHeading, Pill } from "@/components/ui";
import { requireDemo } from "@/modules/demo/guard";

export const dynamic = "force-dynamic";

/** The demonstration has no organization and stores nothing: it says what the real page does. */
export default async function DemoLeads() {
  await requireDemo();
  return (
    <>
      <PageHeading
        eyebrow="MARKETING E CAPTAÇÃO"
        title="Leads"
        description="Quem se interessou pelo seu trabalho e ainda não é aluno."
        aside={<Pill tone="warning">Prévia · sem espaço real</Pill>}
      />
      <Notice>
        <p>
          Na demonstração não há espaço nem leads. Na área real, cada interessado entra com nome, um contato, a origem
          (Instagram, WhatsApp, indicação, presencial) e o serviço que pediu, e anda pelo funil: novo, em contato,
          avaliação ou conversa, proposta, contratado ou perdido (com o motivo). Um lead contratado vira aluno sem
          duplicar quem já é aluno. Não se registram dados de saúde em um lead.
        </p>
      </Notice>
    </>
  );
}
