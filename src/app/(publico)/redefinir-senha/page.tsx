import type { Metadata } from "next";
import Link from "next/link";
import { recoveryAvailable } from "@/modules/auth/server";
import { ResetPasswordForm } from "@/modules/auth/components/reset-password-form";

export const dynamic = "force-dynamic";
// The token is in the fragment of the address, which never reaches this server: the page reads it in
// the browser. Nothing from here may be indexed or reveal the address to another site.
export const metadata: Metadata = { title: "Nova senha", referrer: "no-referrer", robots: { index: false, follow: false } };

export default async function ResetPassword() {
  const available = await recoveryAvailable();
  return (
    <section className="account-card">
      <p className="eyebrow">ACESSO</p>
      <h1>Escolha uma nova senha</h1>
      {available ? (
        <ResetPasswordForm />
      ) : (
        <>
          <p>A recuperação de senha por e-mail ainda não está disponível neste ambiente.</p>
          <Link className="account-link" href="/entrar">
            Voltar para entrar
          </Link>
        </>
      )}
    </section>
  );
}
