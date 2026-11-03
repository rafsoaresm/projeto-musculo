import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireWorkspace } from "@/modules/auth/server";
import { assessmentTemplatesFor } from "@/db/assessment-templates";
import { PageHeading } from "@/components/ui";
import { TemplateEditor } from "@/modules/avaliacoes/v2/template-editor";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Modelo de avaliação" };

export default async function EditAssessmentTemplate({ params }: { params: Promise<{ templateId: string }> }) {
  const { db, context, workspace } = await requireWorkspace();
  const { templateId } = await params;
  // Only a model of the organization of the session, read by a technical member; an archived one is reactivated before it is edited.
  const template = await assessmentTemplatesFor(db, context).get(templateId);
  if (!template || template.archivedAt !== null) notFound();
  return (
    <>
      <PageHeading eyebrow={workspace.name} title={`Modelo “${template.name}”`} description={`Versão ${template.version}.`} />
      <div className="av2">
        <TemplateEditor template={template} />
      </div>
      <Link href="/profissional/avaliacoes/modelos" className="button secondary">
        <ArrowLeft size={17} /> Voltar aos modelos
      </Link>
    </>
  );
}
