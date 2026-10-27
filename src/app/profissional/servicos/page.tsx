import type { Metadata } from "next";
import { requireWorkspace } from "@/modules/auth/server";
import { servicesFor } from "@/db/services";
import { Notice, PageHeading } from "@/components/ui";
import { canManageLeads, canWorkLeads } from "@/modules/leads/access";
import { ServicesPanel } from "@/modules/leads/services-panel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Serviços" };

export default async function Services() {
  const { db, context, workspace } = await requireWorkspace();
  if (!canWorkLeads(workspace.role))
    return (
      <>
        <PageHeading eyebrow={workspace.name} title="Serviços" />
        <Notice>
          <p>O seu papel neste espaço não vê os serviços. Eles ficam com o proprietário, a gestão e o comercial.</p>
        </Notice>
      </>
    );
  const services = await servicesFor(db, context).list(true);
  return (
    <>
      <PageHeading
        eyebrow={workspace.name}
        title="Serviços"
        description="O que você oferece: consultoria, pacotes, avaliação, acompanhamento. Eles aparecem como serviço de interesse nos leads. Ainda sem preço: nada aqui cobra ninguém."
      />
      <ServicesPanel services={services} canWrite={canManageLeads(workspace.role)} />
    </>
  );
}
