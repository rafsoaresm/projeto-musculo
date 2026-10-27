import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireWorkspace } from "@/modules/auth/server";
import { servicesFor } from "@/db/services";
import { Notice, PageHeading } from "@/components/ui";
import { canWorkLeads } from "@/modules/leads/access";
import { LeadForm } from "@/modules/leads/lead-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Novo lead" };

export default async function NewLead() {
  const { db, context, workspace } = await requireWorkspace();
  const allowed = canWorkLeads(workspace.role);
  const services = allowed ? (await servicesFor(db, context).list(false)).map((s) => ({ id: s.id, name: s.name })) : [];
  return (
    <>
      <PageHeading
        eyebrow="Leads"
        title="Novo lead"
        description="Registre quem demonstrou interesse. Só o necessário para responder."
        aside={
          <Link className="button secondary" href="/profissional/leads">
            <ArrowLeft size={20} />
            Voltar aos leads
          </Link>
        }
      />
      {allowed ? (
        <section className="panel">
          <LeadForm services={services} />
        </section>
      ) : (
        <Notice>
          <p>O seu papel neste espaço não trabalha os leads.</p>
        </Notice>
      )}
    </>
  );
}
