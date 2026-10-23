import type { Metadata } from "next";
import Link from "next/link";
import { getDatabase } from "@/db/binding";
import { previewStudentInvite } from "@/db/student-access";
import { getOptionalIdentity } from "@/modules/auth/server";
import { AccountForm } from "@/modules/auth/components/account-form";
import { SignOut } from "@/modules/auth/components/sign-out";
import { AcceptInvite } from "@/modules/convites/accept-invite";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Convite",
  // The link is a secret: keep it out of referrers and indexes.
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function Invitation({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ modo?: string }>;
}) {
  const { token } = await params;
  const { modo } = await searchParams;
  const preview = await previewStudentInvite(await getDatabase(), token);
  if (!preview) {
    // One answer for used, expired, cancelled and unknown links.
    return (
      <section className="account-card">
        <p className="eyebrow">CONVITE</p>
        <h1>Convite indisponível.</h1>
        <p>
          Este convite já foi usado, expirou ou foi cancelado. Peça um novo link
          ao seu profissional.
        </p>
        <Link className="account-link" href="/entrar">
          Ir para o acesso
        </Link>
      </section>
    );
  }
  const identity = await getOptionalIdentity();
  const here = `/convite/${token}`;
  const sender = preview.professionalName
    ? `${preview.professionalName} (${preview.organizationName})`
    : preview.organizationName;
  return (
    <>
      <section className="invite-card">
        <p className="eyebrow">CONVITE PARA A ÁREA DO ALUNO</p>
        <h1>{sender} convidou você.</h1>
        <p>
          Com este acesso você vê o treino que seu profissional liberar para
          você. O vínculo é feito somente por este link, que vale uma vez. Seu
          e-mail, sozinho, não vincula você a ninguém.
        </p>
      </section>
      {identity ? (
        <section className="account-card">
          <p className="eyebrow">ACEITAR</p>
          <h1>Entrar como {identity.user.name}.</h1>
          <p>
            Conta conectada: {identity.user.email}. Ao aceitar, o convite é
            consumido e não pode ser usado de novo.
          </p>
          <AcceptInvite token={token} />
          <div className="account-toolbar">
            <SignOut redirectTo={here} />
          </div>
        </section>
      ) : modo === "entrar" ? (
        <AccountForm
          redirectTo={here}
          switchTo={{ href: here, label: "Criar meu acesso" }}
        />
      ) : (
        <AccountForm
          signup
          audience="aluno"
          redirectTo={here}
          switchTo={{ href: `${here}?modo=entrar`, label: "Já tenho uma conta" }}
        />
      )}
    </>
  );
}
