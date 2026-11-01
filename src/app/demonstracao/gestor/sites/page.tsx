import { PageHeading, Pill } from "@/components/ui";
import { requireDemo } from "@/modules/demo/guard";

export const dynamic = "force-dynamic";

/** The demonstration has no site: the page says so instead of drawing invented rows. */
export default async function DemoSiteEditors() {
  await requireDemo();
  return (
    <>
      <PageHeading
        eyebrow="PLATAFORMA"
        title="Sites e editores"
        description="Qual editor cada site usa e onde ele tem conteúdo. Só contagens: nada do conteúdo é aberto aqui."
        aside={<Pill tone="warning">Dados fictícios</Pill>}
      />
      <section className="panel">
        <div className="empty-inline">
          <h3>A demonstração não tem sites.</h3>
        </div>
      </section>
    </>
  );
}
