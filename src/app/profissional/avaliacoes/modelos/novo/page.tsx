import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireWorkspace } from "@/modules/auth/server";
import { PageHeading } from "@/components/ui";
import { TemplateEditor } from "@/modules/avaliacoes/v2/template-editor";
import { canManageTemplates } from "@/modules/avaliacoes/v2/template-access";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Novo modelo de avaliação" };

export default async function NewAssessmentTemplate() {
  const { workspace } = await requireWorkspace();
  if (!canManageTemplates(workspace.role)) notFound();
  return (
    <>
      <PageHeading eyebrow={workspace.name} title="Novo modelo de avaliação" description="Comece com todas as partes e desmarque o que este modelo não usa." />
      <div className="av2">
        <TemplateEditor />
      </div>
      <Link href="/profissional/avaliacoes/modelos" className="button secondary">
        <ArrowLeft size={17} /> Voltar aos modelos
      </Link>
    </>
  );
}
