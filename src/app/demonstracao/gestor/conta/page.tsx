import { Notice, PageHeading, Pill } from "@/components/ui";
import { requireDemo } from "@/modules/demo/guard";

export const dynamic = "force-dynamic";

/** The demonstration has no account to change: it says what the real page offers. */
export default async function DemoManagerAccount() {
  await requireDemo();
  return (
    <>
      <PageHeading
        eyebrow="PLATAFORMA"
        title="Minha conta"
        description="Seus dados de acesso e a segurança da conta."
        aside={<Pill tone="warning">Prévia · sem conta</Pill>}
      />
      <Notice>
        <p>
          Na demonstração não há conta nem senha para alterar. Na área real, esta tela mostra o nome e o e-mail de
          acesso, permite trocar a senha e ativar a verificação em duas etapas, com um aplicativo autenticador e
          códigos de recuperação.
        </p>
      </Notice>
    </>
  );
}
