import type { Metadata } from "next";
import { requireWorkspace } from "@/modules/auth/server";
import { PageHeading } from "@/components/ui";
import { SecurityPanel } from "@/modules/auth/components/security-panel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Minha conta" };

export default async function ProfessionalAccount() {
  const { user, workspace } = await requireWorkspace();
  return (
    <>
      <PageHeading eyebrow={workspace.name} title="Minha conta" description="Seus dados de acesso e a segurança da conta." />
      <section className="panel" aria-labelledby="dados-conta">
        <h2 id="dados-conta">Seus dados de acesso</h2>
        <dl className="detail-list">
          <div>
            <dt>Nome</dt>
            <dd>{user.name}</dd>
          </div>
          <div>
            <dt>E-mail de acesso</dt>
            <dd>{user.email}</dd>
          </div>
        </dl>
      </section>
      <section className="panel" aria-labelledby="seguranca-conta">
        <p className="eyebrow">SEGURANÇA</p>
        <h2 id="seguranca-conta">Alterar a senha</h2>
        <p className="muted">
          Você precisa da senha atual. A recuperação de senha por e-mail ainda não está disponível: guarde a nova
          senha em um lugar seguro.
        </p>
        <SecurityPanel />
      </section>
    </>
  );
}
