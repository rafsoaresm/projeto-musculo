import type { Metadata } from "next";
import Link from "next/link";
import { requireWorkspace } from "@/modules/auth/server";
import { siteInquiriesFor } from "@/db/site-inquiries";
import { Notice, PageHeading } from "@/components/ui";
import { canWorkLeads } from "@/modules/leads/access";
import { InquiryList } from "@/modules/leads/inquiry-list";
import { HEALTH_WARNING } from "@/modules/leads/contracts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Mensagens do site" };

export default async function SiteMessages() {
  const { db, context, workspace } = await requireWorkspace();
  if (!canWorkLeads(workspace.role))
    return (
      <>
        <PageHeading eyebrow={workspace.name} title="Mensagens do site" />
        <Notice>
          <p>O seu papel neste espaço não trabalha os leads. Eles ficam com o proprietário, a gestão e o comercial.</p>
        </Notice>
      </>
    );
  const inquiries = await siteInquiriesFor(db, context).list();
  return (
    <>
      <PageHeading
        eyebrow={workspace.name}
        title="Mensagens do site"
        description="O que quem visitou a sua página escreveu no formulário. Nada disso é um lead ainda: vire lead o que quiser guardar e apague o resto."
        aside={
          <Link className="button secondary" href="/profissional/leads">
            Voltar aos leads
          </Link>
        }
      />
      <p className="small muted">{HEALTH_WARNING}</p>
      <InquiryList inquiries={inquiries} />
    </>
  );
}
