import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { requireStudent } from "@/modules/auth/server";
import { studentAssessmentsFor } from "@/db/assessment-reports";
import { PageHeading } from "@/components/ui";
import { formatCalendarDate } from "@/modules/training/format";
import { ASSESSMENT_NAME, assessmentTitle } from "@/modules/avaliacoes/names";
import { deliveredByText } from "@/modules/configuracoes/delivered-by";
import { PhotoImage } from "@/modules/avaliacoes/photo-image";
import { photoViewLabel } from "@/modules/avaliacoes/photos";
import {
  noPhotosLine,
  photoName,
  recordedPhotoGroups,
} from "@/modules/avaliacoes/v2/posture-photos";
import {
  REPORT_NOTICE,
  REPORT_PHOTOS_NOTE,
  reportDateTime,
} from "@/modules/avaliacoes/v2/report";
import { ResultsList } from "@/modules/avaliacoes/v2/results-list";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: `${ASSESSMENT_NAME} · Área do aluno`,
};

type Params = { params: Promise<{ studentId: string; assessmentId: string }> };

/**
 * Slice 0.86: one recorded Avaliação Física of the student, read only, with the posture photos (user's decision of 03/11/2026: "o aluno pode ver
 * as próprias fotos"), the results as recorded at finalize and the report in PDF. The student comes from the verified links of the login; a
 * draft, the earlier format, another student's or another organization's assessment is a plain 404, like the student's PDF route. The images
 * go through the student's own route, never the professional's.
 */
export default async function StudentAssessmentPage({ params }: Params) {
  const { db, user, links } = await requireStudent();
  const { studentId, assessmentId } = await params;
  const link = links.find((item) => item.studentId === studentId);
  const source = link
    ? await studentAssessmentsFor(db, user.id, link.studentId).source(
        assessmentId,
      )
    : null;
  if (!link || !source) notFound();
  const { assessment } = source;
  const date = formatCalendarDate(assessment.assessedOn);
  const photos = source.photos ?? [];
  // With no photo, the line says why: left out of the model, not done, or done without photos.
  const noPhotos = noPhotosLine(source.enabled ?? null, source.posture);
  return (
    <>
      <PageHeading
        eyebrow={
          links.length > 1
            ? `ÁREA DO ALUNO · ${link.organizationName} · ${link.studentName}`
            : "ÁREA DO ALUNO"
        }
        title={`${assessmentTitle({ kind: assessment.kind, formatVersion: 2, amendsAssessmentId: assessment.amendsAssessmentId })} de ${date}`}
        description={`Registrada${assessment.recordedAt ? ` em ${reportDateTime(assessment.recordedAt)}` : ""}${
          deliveredByText(assessment.recordedByName, source.organizationName)
        }. Só leitura: o que foi medido e registrado pelo seu profissional.`}
      />
      <div className="student-assessment-actions">
        <Link className="button secondary small" href="/aluno/avaliacoes">
          <ArrowLeft size={16} /> Voltar às avaliações
        </Link>
        <Link
          className="button primary small av2-report-button"
          href={`/aluno/avaliacoes/pdf/${link.studentId}/${assessment.id}`}
          download
          prefetch={false}
        >
          <Download size={16} /> Baixar PDF
        </Link>
      </div>
      {assessment.amendedById && (
        <p className="notice warning" role="note">
          Esta avaliação foi retificada depois. Os dados abaixo são os
          originais, como foram registrados; a retificação aparece na lista das
          avaliações.
        </p>
      )}
      <div className="student-assessment">
        <section className="panel av2-card" aria-labelledby="aluno-fotos">
          <h2 id="aluno-fotos">Fotos da postura</h2>
          {photos.length === 0 ? (
            <p className="muted">{noPhotos}</p>
          ) : (
            <>
              <p className="muted small">{REPORT_PHOTOS_NOTE}</p>
              <div className="av2-grid av2-photo-grid">
                {recordedPhotoGroups(photos).flatMap((group) =>
                  group.photos.map((photo) => (
                    <figure
                      key={photo.view}
                      className="av2-field av2-photo-slot"
                    >
                      <figcaption className="av2-label">
                        {photoViewLabel(photo.view)}
                      </figcaption>
                      <PhotoImage
                        studentId={link.studentId}
                        assessmentId={assessment.id}
                        view={photo.view}
                        stamp={photo.createdAt}
                        erasedAt={photo.erasedAt}
                        path={`/aluno/avaliacoes/fotos/${link.studentId}/${assessment.id}/${photo.view}`}
                        alt={`${photoName(photo.view)} de ${date}`}
                      />
                    </figure>
                  )),
                )}
              </div>
            </>
          )}
        </section>
        <section className="panel av2-card" aria-labelledby="aluno-resultados">
          <h2 id="aluno-resultados">Resultados</h2>
          <p className="muted small">{REPORT_NOTICE}</p>
          {source.results.length === 0 ? (
            <p className="muted">Nenhum resultado calculado nesta avaliação.</p>
          ) : (
            <ResultsList
              results={[...source.results]}
              labelledBy="aluno-resultados"
            />
          )}
        </section>
      </div>
    </>
  );
}
