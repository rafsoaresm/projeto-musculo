import type { Metadata } from "next";
import Link from "next/link";
import { PublicShell } from "@/components/public-shell";
import { getOperatorSettings } from "@/modules/auth/server";
import { ManagerPasswordForm, ManagerRecoveryForm } from "@/modules/gestor/recovery-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Recuperar o acesso do gestor" };

/**
 * Public on purpose: the person cannot sign in (the second step blocks it). Authorization is the environment
 * secret together with the person's own password, checked on the server (src/db/manager-recovery.ts).
 */
export default async function RecoverManager() {
  const { setupToken } = await getOperatorSettings();
  const available = Boolean(setupToken && setupToken.length >= 32);
  return (
    <PublicShell>
      <section className="account-card">
        <p className="eyebrow">GESTOR DA PLATAFORMA</p>
        <h1>Recuperar o acesso do último gestor.</h1>
        <p>
          Para o gestor que perdeu o celular e os códigos de recuperação e é o único gestor ativo. Esta página desliga
          só a verificação em duas etapas da conta informada e desconecta todos os aparelhos dela. A senha, o e-mail e
          o papel de gestor não mudam, e fica uma linha na auditoria do gestor.
        </p>
        <p>
          Se há outro gestor ativo, é ele quem redefine, em Gestor &gt; Gestores; aqui o pedido é recusado.
        </p>
        {available ? (
          <ManagerRecoveryForm />
        ) : (
          <p role="alert" className="form-error">
            A recuperação não está configurada neste ambiente. Defina PLATFORM_SETUP_TOKEN (32 caracteres ou mais) no
            ambiente privado.
          </p>
        )}
        <h2>Esqueceu a senha?</h2>
        <p>
          Para o único gestor ativo que perdeu a senha. Pede o e-mail da conta, uma senha nova e o código de ativação do
          ambiente. Só muda a senha e desconecta todos os aparelhos da conta; o e-mail, o papel de gestor e a verificação
          em duas etapas continuam como estão, e fica uma linha na auditoria do gestor. Se há outro gestor ativo, o pedido
          é recusado.
        </p>
        {available && <ManagerPasswordForm />}
        {!available && (
          <Link className="account-link" href="/entrar?area=gestor">
            Voltar para entrar
          </Link>
        )}
      </section>
    </PublicShell>
  );
}
