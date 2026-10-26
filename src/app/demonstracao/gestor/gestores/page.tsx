import { Notice, PageHeading, Pill } from "@/components/ui";
import { requireDemo } from "@/modules/demo/guard";

export const dynamic = "force-dynamic";

/** The demonstration invites nobody: it says what the real page does. */
export default async function DemoManagers() {
  await requireDemo();
  return (
    <>
      <PageHeading
        eyebrow="PLATAFORMA"
        title="Gestores"
        description="Quem opera a plataforma, e como acrescentar mais uma pessoa sem depender do código de ativação."
        aside={<Pill tone="warning">Prévia · sem convites</Pill>}
      />
      <Notice>
        <p>
          Na demonstração ninguém é convidado. Na área real, um gestor gera um link de uso único, válido por 48 horas,
          e quem o abrir com a própria conta passa a ser gestor. O acesso vem do link, nunca do e-mail digitado. O
          gestor pode encerrar o acesso de outro, nunca o próprio, então a plataforma nunca fica sem ninguém.
        </p>
      </Notice>
    </>
  );
}
