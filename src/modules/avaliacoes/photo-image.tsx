"use client";
import { useSyncExternalStore } from "react";
import { useMountPath } from "@/components/use-mount-path";

/**
 * A postural photo, read through the authenticated route. The address is built in the browser
 * from the mount path, like the other addresses the browser makes itself, and carries the time
 * of the upload so a replaced photo is not shown from memory. No other site can load it: the
 * route needs the professional's own session.
 */
export function PhotoImage({
  studentId,
  assessmentId,
  view,
  stamp,
  alt,
}: {
  studentId: string;
  assessmentId: string;
  view: string;
  stamp: string;
  alt: string;
}) {
  const mountPath = useMountPath();
  // The mount path is read in the browser only; the server renders the placeholder, so the two
  // never disagree. It does not change while the page is open.
  const prefix = useSyncExternalStore(
    () => () => undefined,
    () => mountPath(),
    () => null,
  );
  const src =
    prefix === null
      ? undefined
      : `${prefix}/profissional/alunos/${studentId}/avaliacoes/${assessmentId}/fotos/${view}?v=${encodeURIComponent(stamp)}`;
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt={alt} className="posture-photo" loading="lazy" /> : <div className="posture-photo placeholder" role="img" aria-label={alt} />;
}
