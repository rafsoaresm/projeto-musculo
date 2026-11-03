import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { requireStudent } from "@/modules/auth/server";
import { studentExportFor } from "@/db/student-export";
import { PageHeading } from "@/components/ui";
import { EXPORTS_PER_HOUR } from "@/modules/pedidos/export";
import { READABLE_HEALTH_NOTE, READABLE_TITLE, readableDateTime, readableExport } from "@/modules/pedidos/export-readable";
import { ReadableExportView } from "@/modules/pedidos/readable-export-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Cópia dos meus dados · Área do aluno" };

/**
 * "Baixar meus dados" to read on screen (slice 0.91). Opening the page generates the copy like the JSON
 * and the PDF do: one line in the trail and one of the same hourly allowance. The student comes from the
 * verified links of the login, never from the address.
 */
export default async function ReadableCopy() {
  const { db, user } = await requireStudent();
  const outcome = await studentExportFor(db, user.id).generate(new Date());
  if (outcome.status === "not_found") notFound();
  const actions = (
    <div className="student-assessment-actions copy-page-actions">
      <Link className="button secondary small" href="/aluno/conta#baixar">
        <ArrowLeft size={16} /> Voltar à Minha conta
      </Link>
      {outcome.status === "generated" && (
        <>
          <Link className="button primary small" href="/aluno/conta/meus-dados/pdf" download prefetch={false}>
            <Download size={16} /> Baixar em PDF
          </Link>
          <Link className="button secondary small" href="/aluno/conta/meus-dados" download prefetch={false}>
            <Download size={16} /> Baixar em JSON
          </Link>
        </>
      )}
    </div>
  );
  if (outcome.status === "rate_limited")
    return (
      <>
        <PageHeading eyebrow="ÁREA DO ALUNO · SEUS DADOS" title={READABLE_TITLE} />
        {actions}
        <section className="panel" role="status">
          <p>Você já gerou a cópia dos seus dados várias vezes na última hora. Tente de novo daqui a pouco.</p>
          <p className="muted small">
            A página, o PDF e o arquivo JSON contam juntos: no máximo {EXPORTS_PER_HOUR} por hora.
          </p>
        </section>
      </>
    );
  const readable = readableExport(outcome.source);
  return (
    <>
      <PageHeading
        eyebrow="ÁREA DO ALUNO · SEUS DADOS"
        title={READABLE_TITLE}
        description={`Gerada em ${readableDateTime(readable.generatedAt)}. É o mesmo conteúdo do PDF e do arquivo JSON. ${READABLE_HEALTH_NOTE}`}
      />
      {actions}
      <ReadableExportView readable={readable} />
    </>
  );
}
