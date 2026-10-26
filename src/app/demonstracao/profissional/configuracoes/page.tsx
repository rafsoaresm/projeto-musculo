import { Notice, PageHeading, Pill } from "@/components/ui";
import { requireDemo } from "@/modules/demo/guard";

export const dynamic = "force-dynamic";

/** The demonstration has no workspace to rename: it says what the real page offers. */
export default async function DemoSettings() {
  await requireDemo();
  return (
    <>
      <PageHeading
        eyebrow="ESPAÇO"
        title="Configurações"
        description="Os nomes que os seus alunos veem e quem tem acesso ao espaço."
        aside={<Pill tone="warning">Prévia · sem espaço real</Pill>}
      />
      <Notice>
        <p>
          Na demonstração não há espaço nem conta para alterar. Na área real, esta tela permite ao proprietário mudar
          o nome do espaço, a cada profissional corrigir o próprio nome de exibição e mostra quem tem acesso ao espaço.
          Convidar outras pessoas e dar papéis diferentes ainda não está disponível.
        </p>
      </Notice>
    </>
  );
}
