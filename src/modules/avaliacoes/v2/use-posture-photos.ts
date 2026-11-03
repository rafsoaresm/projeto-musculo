"use client";
import { useRef, useState } from "react";
import { useMountPath } from "@/components/use-mount-path";
import { UPLOAD_LONG_SIDE, photoViewLabel, type PhotoView } from "../photos";
import { withPhoto, withoutPhoto, type PhotoStamp } from "./posture-photos";

/**
 * Re-draws the picture in the browser: the right way up (the camera's orientation flag is applied and dropped), at most 1600 px on the long
 * side, as a JPEG with no metadata. The position and device data of a phone photo never leave the phone, and the upload stays small. The server
 * cleans the file again and refuses anything that is not a JPEG (the same steps as the earlier format's photos).
 */
async function toJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, UPLOAD_LONG_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("CANVAS");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("ENCODE"))), "image/jpeg", 0.85));
}

export interface PosturePhotos {
  photos: PhotoStamp[];
  /** The view being sent or removed, or null. One at a time. */
  busy: PhotoView | null;
  /** What is being done to it. */
  action: "send" | "remove" | null;
  message: { text: string; failed: boolean } | null;
  send: (view: PhotoView, file: File) => Promise<void>;
  remove: (view: PhotoView) => Promise<void>;
  /** Drops the line of a photo that went well (when another view of the posture is shown); a failure stays until the next try. */
  clearNotice: () => void;
}

/** The view in the line that says what happened ("Foto da vista anterior enviada."): "Foto anterior" alone reads as "the previous photo". */
const noticeName = (view: PhotoView) => `Foto da vista ${photoViewLabel(view).toLowerCase()}`;

/**
 * The photos of the posture of an open draft. Each one is sent (or removed) at once, through the private photo route, apart from the autosave of
 * the modules: a photo is not part of a module, so it moves no revision and never conflicts with a save of the text. The state lives in the
 * shell, so a photo being sent keeps going when the step changes, and finalizing waits for it.
 */
export function usePosturePhotos(studentId: string, assessmentId: string, initial: PhotoStamp[]): PosturePhotos {
  const mountPath = useMountPath();
  const [photos, setPhotos] = useState<PhotoStamp[]>(initial);
  const [busy, setBusy] = useState<PhotoView | null>(null);
  const [action, setAction] = useState<"send" | "remove" | null>(null);
  const [message, setMessage] = useState<PosturePhotos["message"]>(null);
  // A second pick while one is being sent is ignored (the buttons are disabled too); a ref, so two quick events never both pass.
  const working = useRef(false);
  // Relative to the mount path, never a fixed "/api": the route lives under the professional's page of the assessment.
  const address = (view: PhotoView) => `${mountPath()}/profissional/alunos/${studentId}/avaliacoes/${assessmentId}/fotos/${view}`;
  const headers = { "x-photo-request": "1" };

  async function run(view: PhotoView, kind: "send" | "remove", task: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(view);
    setAction(kind);
    setMessage(null);
    try {
      await task();
    } finally {
      working.current = false;
      setBusy(null);
      setAction(null);
    }
  }

  const send = (view: PhotoView, file: File) =>
    run(view, "send", async () => {
      try {
        const blob = await toJpeg(file);
        const response = await fetch(address(view), { method: "PUT", headers: { ...headers, "content-type": "image/jpeg" }, body: blob });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? (response.status === 404 ? "GONE" : "SEND"));
        }
        setPhotos((current) => withPhoto(current, view, new Date().toISOString()));
        setMessage({ text: `${noticeName(view)} enviada.`, failed: false });
      } catch (error) {
        const text =
          error instanceof Error && error.message === "GONE"
            ? "Não foi possível guardar a foto: este rascunho não está mais aberto. Recarregue a página."
            : error instanceof Error && error.message === "SEND"
              ? "Não foi possível enviar a foto. Tente novamente."
              : error instanceof Error && error.message && !["CANVAS", "ENCODE"].includes(error.message) && !(error instanceof DOMException)
                ? error.message
                : "Não foi possível ler esta imagem. Use uma foto JPEG, PNG ou WebP.";
        setMessage({ text, failed: true });
      }
    });

  const remove = (view: PhotoView) =>
    run(view, "remove", async () => {
      try {
        const response = await fetch(address(view), { method: "DELETE", headers });
        if (!response.ok) throw new Error("remove");
        setPhotos((current) => withoutPhoto(current, view));
        setMessage({ text: `${noticeName(view)} removida.`, failed: false });
      } catch {
        setMessage({ text: "Não foi possível remover a foto. Tente novamente.", failed: true });
      }
    });

  const clearNotice = () => setMessage((current) => (current && !current.failed ? null : current));

  return { photos, busy, action, message, send, remove, clearNotice };
}
