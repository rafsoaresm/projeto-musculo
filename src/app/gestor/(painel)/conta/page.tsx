import type { Metadata } from "next";
import { requirePlatformAdmin, recoveryAvailable } from "@/modules/auth/server";
import { PageHeading } from "@/components/ui";
import { SecurityPanel } from "@/modules/auth/components/security-panel";
import { TwoFactorPanel } from "@/modules/auth/components/two-factor-panel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Minha conta · Gestor" };

export default async function ManagerAccount() {
  const { user } = await requirePlatformAdmin();
  const recovery = await recoveryAvailable();
  return (
    <>
      <PageHeading eyebrow="PLATAFORMA" title="Minha conta" description="Seus dados de acesso e a segurança da conta." />
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
          {recovery
            ? "Você precisa da senha atual. Se um dia esquecer a senha, use “Esqueci minha senha” na tela de entrada: enviamos um link para o seu e-mail."
            : "Você precisa da senha atual. A recuperação de senha por e-mail ainda não está disponível: guarde a nova senha em um lugar seguro."}
        </p>
        <SecurityPanel />
      </section>
      <section className="panel" aria-labelledby="duas-etapas">
        <p className="eyebrow">SEGURANÇA</p>
        <h2 id="duas-etapas">Verificação em duas etapas</h2>
        <p className="muted">
          Além da senha, entrar pede um código de 6 dígitos que só o seu celular gera, em um aplicativo autenticador. É
          opcional, mas recomendada com força para quem é gestor: esta conta bloqueia acessos, publica os termos
          que todos aceitam e convida outros gestores. Outro gestor da plataforma pode redefinir a verificação de quem
          perdeu o celular e os códigos de recuperação.
        </p>
        <TwoFactorPanel enabled={Boolean(user.twoFactorEnabled)} />
      </section>
    </>
  );
}
