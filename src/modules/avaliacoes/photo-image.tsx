"use client";
import { useSyncExternalStore } from "react";
import { formatDate } from "@/components/ui";
import { useMountPath } from "@/components/use-mount-path";

/**
 * A postural photo, read through the authenticated route. The address is built in the browser
 * from the mount path, like the other addresses the browser makes itself, and carries the time
 * of the upload so a replaced photo is not shown from memory. No other site can load it: the
 * route needs the professional's own session, or (slice 0.86, `path`) the student's route needs
 * the verified link of the student's own login.
 */
export function PhotoImage({
  studentId,
  assessmentId,
  view,
  stamp,
  alt,
  erasedAt = null,
  path = null,
}: {
  studentId: string;
  assessmentId: string;
  view: string;
  stamp: string;
  alt: string;
  /** When the photo was erased (by the professional, or on the student's request). The image is not asked for again. */
  erasedAt?: string | null;
  /** The address of the image under the mount path, when it is not the professional's route (the student's page, slice 0.86). */
  path?: string | null;
}) {
  const mountPath = useMountPath();
  // The mount path is read in the browser only; the server renders the placeholder, so the two
  // never disagree. It does not change while the page is open.
  const prefix = useSyncExternalStore(
    () => () => undefined,
    () => mountPath(),
    () => null,
  );
  if (erasedAt)
    return (
      <p className="posture-photo placeholder erased" role="img" aria-label={`${alt}: apagada`}>
        Foto apagada em {formatDate(erasedAt)}.
      </p>
    );
  const src =
    prefix === null
      ? undefined
      : `${prefix}${path ?? `/profissional/alunos/${studentId}/avaliacoes/${assessmentId}/fotos/${view}`}?v=${encodeURIComponent(stamp)}`;
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt={alt} className="posture-photo" loading="lazy" /> : <div className="posture-photo placeholder" role="img" aria-label={alt} />;
}
