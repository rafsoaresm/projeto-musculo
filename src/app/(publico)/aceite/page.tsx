import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireIdentity } from "@/modules/auth/server";
import { portalLinksFor } from "@/db/student-access";
import { workspaceFor } from "@/db/workspaces";
import { latestAcceptance } from "@/db/consent";
import { shownTerms } from "@/db/terms";
import { TermsBlock } from "@/modules/consentimento/terms-block";
import { formatCalendarDate } from "@/modules/training/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Termos", robots: { index: false, follow: false } };

/**
 * The terms in force for an area, to read. Nothing is gated on them: entering the area does not depend on an acceptance. An acceptance
 * recorded earlier stays readable here. The area comes from the address only as a request: it is checked against what this login really has.
 */
export default async function ReadTerms({
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
  const [terms, accepted] = await Promise.all([shownTerms(db, audience), latestAcceptance(db, user.id, audience)]);
  return (
    <section className="account-card consent-card">
      <p className="eyebrow">TERMOS</p>
      <h1>Termos de uso</h1>
      {accepted && (
        <p className="muted">
          Você registrou o aceite da versão {accepted.version} em {formatCalendarDate(accepted.termsAcceptedAt.slice(0, 10))}.
        </p>
      )}
      <TermsBlock terms={terms} />
      <div className="account-toolbar">
        <Link className="button secondary" href={area === "aluno" ? "/aluno" : "/profissional"}>
          Voltar
        </Link>
      </div>
    </section>
  );
}
