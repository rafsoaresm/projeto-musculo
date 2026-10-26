import type { Metadata } from "next";
import Link from "next/link";
import { recoveryAvailable } from "@/modules/auth/server";
import { ForgotPasswordForm } from "@/modules/auth/components/forgot-password-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Esqueci minha senha" };

export default async function ForgotPassword() {
  const available = await recoveryAvailable();
  return (
    <section className="account-card">
      <p className="eyebrow">ACESSO</p>
      <h1>Esqueci minha senha</h1>
      {available ? (
        <>
          <p>Informe o e-mail da sua conta. Enviaremos um link para você escolher uma nova senha.</p>
          <ForgotPasswordForm />
        </>
      ) : (
        <>
          <p>
            A recuperação de senha por e-mail ainda não está disponível neste ambiente. Se você perdeu a senha,
            fale com o responsável pelo seu atendimento.
          </p>
          <Link className="account-link" href="/entrar">
            Voltar para entrar
          </Link>
        </>
      )}
    </section>
  );
}
