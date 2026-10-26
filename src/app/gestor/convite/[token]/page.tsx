import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PublicShell } from "@/components/public-shell";
import { getDatabase } from "@/db/binding";
import { isPlatformAdmin, previewManagerInvite } from "@/db/platform";
import { getOptionalIdentity } from "@/modules/auth/server";
import { AccountForm } from "@/modules/auth/components/account-form";
import { SignOut } from "@/modules/auth/components/sign-out";
import { AcceptManagerInvite } from "@/modules/gestor/accept-manager-invite";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Convite de gestor",
  // The link is a secret: keep it out of referrers and indexes.
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function ManagerInvitation({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ modo?: string }>;
}) {
  const { token } = await params;
  const { modo } = await searchParams;
  const identity = await getOptionalIdentity();
  if (identity && (await isPlatformAdmin(identity.db, identity.user.id))) redirect("/gestor");
  const preview = await previewManagerInvite(await getDatabase(), token);
  if (!preview) {
    // One answer for used, expired, cancelled, from a former manager, and unknown links.
    return (
      <PublicShell>
        <section className="account-card">
          <p className="eyebrow">CONVITE DE GESTOR</p>
          <h1>Convite indisponível.</h1>
          <p>Este convite já foi usado, venceu ou foi cancelado. Peça um novo link a um gestor.</p>
          <Link className="account-link" href="/entrar">
            Ir para o acesso
          </Link>
        </section>
      </PublicShell>
    );
  }
  const here = `/gestor/convite/${token}`;
  return (
    <PublicShell>
      <section className="invite-card">
        <p className="eyebrow">CONVITE PARA SER GESTOR DA PLATAFORMA</p>
        <h1>{preview.issuerName} convidou você.</h1>
        <p>
          Quem é gestor vê as organizações e os profissionais, bloqueia acessos e publica os termos. Não vê alunos,
          avaliações nem treinos. O acesso vem deste link e da conta com que você o aceitar: o seu e-mail, sozinho, não
          dá acesso a ninguém. O link vale uma vez.
        </p>
      </section>
      {identity ? (
        <section className="account-card">
          <p className="eyebrow">ACEITAR</p>
          <h1>Aceitar como {identity.user.name}.</h1>
          <p>
            Conta conectada: {identity.user.email}. Se não for a conta que deve gerir a plataforma, saia e entre com a
            certa antes de aceitar.
          </p>
          <AcceptManagerInvite token={token} />
          <div className="account-toolbar">
            <SignOut redirectTo={here} />
          </div>
        </section>
      ) : modo === "entrar" ? (
        <AccountForm redirectTo={here} switchTo={{ href: here, label: "Criar a minha conta" }} />
      ) : (
        <AccountForm
          signup
          audience="gestor"
          redirectTo={here}
          switchTo={{ href: `${here}?modo=entrar`, label: "Já tenho uma conta" }}
        />
      )}
    </PublicShell>
  );
}
