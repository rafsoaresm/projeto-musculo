import { Notice, PageHeading, Pill } from "@/components/ui";
import { requireDemo } from "@/modules/demo/guard";

export const dynamic = "force-dynamic";

export default async function DemoServices() {
  await requireDemo();
  return (
    <>
      <PageHeading
        eyebrow="MARKETING E CAPTAÇÃO"
        title="Serviços"
        description="O que você oferece aos seus leads."
        aside={<Pill tone="warning">Prévia · sem espaço real</Pill>}
      />
      <Notice>
        <p>
          Na demonstração não há espaço para cadastrar serviços. Na área real, o proprietário e a gestão cadastram
          consultoria, pacotes, avaliação e acompanhamento (presencial, online ou os dois), tiram da oferta o que não
          vendem mais e veem quantos leads escolheram cada um. Ainda não há preço: nada aqui cobra ninguém.
        </p>
      </Notice>
    </>
  );
}
