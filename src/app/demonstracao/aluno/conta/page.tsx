import { Notice, PageHeading, Pill } from "@/components/ui";
import { requireDemo } from "@/modules/demo/guard";

export const dynamic = "force-dynamic";

/** The demonstration has no account to change: it says what the real page offers. */
export default async function DemoAccount() {
  await requireDemo();
  return (
    <>
      <PageHeading
        eyebrow="CONTA"
        title="Minha conta"
        description="Seus dados de acesso e a segurança da conta."
        aside={<Pill tone="warning">Prévia · sem conta</Pill>}
      />
      <Notice>
        <p>
          Na demonstração não há conta nem senha para alterar. Na área real, esta tela mostra o nome e o e-mail de
          acesso e permite trocar a senha, desconectando os outros aparelhos se você quiser, escolher sobre as fotos e fazer pedidos sobre os seus dados (cópia, correção, apagar as fotos, exclusão), com prazo de resposta de 15 dias.
        </p>
      </Notice>
    </>
  );
}
