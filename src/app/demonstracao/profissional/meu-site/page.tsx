import { Notice, PageHeading, Pill } from "@/components/ui";
import { requireDemo } from "@/modules/demo/guard";

export const dynamic = "force-dynamic";

/** The demonstration has no organization and publishes nothing: it says what the real page does. */
export default async function DemoSite() {
  await requireDemo();
  return (
    <>
      <PageHeading
        eyebrow="MARKETING E CAPTAÇÃO"
        title="Meu Site"
        description="A página pública do seu trabalho."
        aside={<Pill tone="warning">Prévia · sem espaço real</Pill>}
      />
      <Notice>
        <p>
          Na demonstração não há espaço nem site para publicar. Na área real, o proprietário ou a gestão montam a página com blocos
          (destaque, texto, serviços, perguntas frequentes e chamada para contato), conferem na prévia e publicam. Cada publicação é uma
          versão que não muda depois; dá para tirar o site do ar e voltar a uma versão anterior. A página não tem formulário, imagens nem
          rastreadores, e os botões levam só ao WhatsApp, ao e-mail ou ao Instagram que você informar.
        </p>
      </Notice>
    </>
  );
}
