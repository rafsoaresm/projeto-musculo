import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireIdentity } from "@/modules/auth/server";
import { portalLinksFor } from "@/db/student-access";
import { workspaceFor } from "@/db/workspaces";
import { hasCurrentAcceptance } from "@/db/consent";
import { shownTerms } from "@/db/terms";
import { SignOut } from "@/modules/auth/components/sign-out";
import { ConsentForm } from "@/modules/consentimento/consent-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Termos", robots: { index: false, follow: false } };

/**
 * Where someone lands when they have an area but have not accepted the terms in force. The area comes
 * from the address only as a request: it is checked against what this login really has.
 */
export default async function AcceptTerms({
  searchParams,
}: {
  searchParams: Promise<{ area?: string }>;
}) {
  const { area } = await searchParams;
  const { db, user } = await requireIdentity();
  if (area !== "aluno" && area !== "profissional") redirect("/acesso");
  const audience = area === "aluno" ? "STUDENT" : "PROFESSIONAL";
  const entitled =
    area === "aluno" ? (await portalLinksFor(db, user.id)).length > 0 : Boolean(await workspaceFor(db, user.id));
  if (!entitled) redirect("/acesso");
  if (await hasCurrentAcceptance(db, user.id, audience)) redirect(area === "aluno" ? "/aluno" : "/profissional");
  return (
    <section className="account-card consent-card">
      <p className="eyebrow">ANTES DE CONTINUAR</p>
      <h1>Leia e aceite os termos.</h1>
      <p>Você aceita uma única vez. Se o texto mudar, será pedido de novo.</p>
      <ConsentForm area={area} terms={await shownTerms(db, audience)} />
      <div className="account-toolbar">
        <SignOut />
      </div>
    </section>
  );
}
