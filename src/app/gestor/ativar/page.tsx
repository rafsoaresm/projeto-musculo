import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PublicShell } from "@/components/public-shell";
import { getOperatorSettings, getOptionalIdentity } from "@/modules/auth/server";
import { isPlatformAdmin } from "@/db/platform";
import { ActivationForm } from "@/modules/gestor/activation-form";
import { SignOut } from "@/modules/auth/components/sign-out";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ativar gestor" };

export default async function ActivateManager() {
  const identity = await getOptionalIdentity();
  if (!identity) redirect("/entrar?area=gestor");
  if (await isPlatformAdmin(identity.db, identity.user.id)) redirect("/gestor");
  const { setupToken } = await getOperatorSettings();
  const available = Boolean(setupToken && setupToken.length >= 32);
  return (
    <PublicShell>
      <section className="account-card">
        <p className="eyebrow">PRIMEIRO ACESSO DO GESTOR</p>
        <h1>Ative a gestão da plataforma.</h1>
        <p>
          Entrou como {identity.user.email}. O código de ativação é o valor
          <code> PLATFORM_SETUP_TOKEN</code> configurado no ambiente privado.
          Ele funciona só enquanto não houver um gestor ativo; depois disso fica
          inerte. O e-mail, sozinho, nunca concede este acesso.
        </p>
        {available ? (
          <ActivationForm />
        ) : (
          <p role="alert" className="form-error">
            A ativação não está configurada neste ambiente. Defina
            PLATFORM_SETUP_TOKEN (32 caracteres ou mais) no ambiente privado.
          </p>
        )}
        <div className="account-toolbar">
          <SignOut />
        </div>
      </section>
    </PublicShell>
  );
}
