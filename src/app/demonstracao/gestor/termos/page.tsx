import { Notice, PageHeading, Pill } from "@/components/ui";
import { TermsBlock } from "@/modules/consentimento/terms-block";
import { BASELINE, BASELINE_VERSION } from "@/modules/consentimento/terms";
import { requireDemo } from "@/modules/demo/guard";

export const dynamic = "force-dynamic";

/** The demonstration edits nothing: it shows the text as people read it and says what the real page does. */
export default async function DemoTerms() {
  await requireDemo();
  return (
    <>
      <PageHeading
        eyebrow="PLATAFORMA"
        title="Termos"
        description="O texto que profissionais e alunos leem e aceitam ao entrar. Edite aqui quando for preciso."
        aside={<Pill tone="warning">Prévia · sem edição</Pill>}
      />
      <Notice>
        <p>
          Na demonstração o texto não é editado nem publicado. Na área real, o gestor muda as palavras, vê o que
          mudou e como a pessoa vai ler, e publica uma nova versão: todos aceitam de novo no próximo acesso, e as
          versões publicadas ficam no histórico, sem poder ser editadas ou apagadas.
        </p>
      </Notice>
      <section className="panel">
        <h2>Texto do aluno em vigor</h2>
        <TermsBlock terms={{ audience: "STUDENT", version: BASELINE_VERSION, content: BASELINE.STUDENT }} />
      </section>
    </>
  );
}
