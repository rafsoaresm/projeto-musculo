"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Camera, Trash2 } from "lucide-react";
import { Notice } from "@/components/ui";
import { useMountPath } from "@/components/use-mount-path";
import type { PhotoIndexRow } from "@/db/assessments";
import { PhotoImage } from "./photo-image";
import { PHOTO_VIEWS, UPLOAD_LONG_SIDE, photoViewLabel, type PhotoView } from "./photos";

/**
 * Re-draws the picture in the browser: the right way up (the camera's orientation flag is
 * applied and dropped), at most 1600 px on the long side, as a JPEG with no metadata. That keeps
 * the position and device data of a phone photo from leaving the phone, and keeps the upload
 * small. The server cleans the file again and refuses anything that is not a JPEG.
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
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("ENCODE"))), "image/jpeg", 0.85),
  );
}

/** The four views of the master document, for an open draft. Each upload is immediate. */
export function PhotosFieldset({
  studentId,
  assessmentId,
  photos,
  minor,
}: {
  studentId: string;
  assessmentId: string;
  photos: PhotoIndexRow[];
  minor: boolean;
}) {
  const router = useRouter();
  const mountPath = useMountPath();
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<PhotoView | null>(null);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const inputs = useRef<Partial<Record<PhotoView, HTMLInputElement | null>>>({});
  const address = (view: PhotoView) =>
    `${mountPath()}/profissional/alunos/${studentId}/avaliacoes/${assessmentId}/fotos/${view}`;
  const headers = { "x-photo-request": "1" };

  async function send(view: PhotoView, file: File) {
    setBusy(view);
    setMessage("");
    try {
      const blob = await toJpeg(file);
      const response = await fetch(address(view), {
        method: "PUT",
        headers: { ...headers, "x-consent": "confirmed", "content-type": "image/jpeg" },
        body: blob,
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Não foi possível enviar a foto. Tente novamente.");
      }
      setFailed(false);
      setMessage(`Foto ${photoViewLabel(view).toLowerCase()} enviada.`);
      router.refresh();
    } catch (error) {
      setFailed(true);
      setMessage(
        error instanceof Error && error.message && !["CANVAS", "ENCODE"].includes(error.message) && !(error instanceof DOMException)
          ? error.message
          : "Não foi possível ler esta imagem. Use uma foto JPEG, PNG ou WebP.",
      );
    } finally {
      setBusy(null);
      const input = inputs.current[view];
      if (input) input.value = "";
    }
  }

  async function remove(view: PhotoView) {
    setBusy(view);
    setMessage("");
    try {
      const response = await fetch(address(view), { method: "DELETE", headers });
      if (!response.ok) throw new Error("remove");
      setFailed(false);
      setMessage(`Foto ${photoViewLabel(view).toLowerCase()} removida.`);
      router.refresh();
    } catch {
      setFailed(true);
      setMessage("Não foi possível remover a foto. Tente novamente.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <fieldset>
      <legend>Fotos da postura</legend>
      <p className="small muted">
        Registro visual, não diagnóstico. As fotos ficam no armazenamento privado
        da ferramenta e só você as vê, enquanto tiver o aluno sob o seu
        atendimento. Depois que a avaliação for registrada, as fotos não mudam.
        A ferramenta remove os dados do aparelho (posição, data e modelo) antes de guardar.
      </p>
      {minor ? (
        <Notice tone="warning">
          <p>
            <strong>Menor de idade.</strong> Pela data de nascimento da ficha, este aluno tem menos de 18
            anos. A ferramenta ainda não suporta responsável, permissões e consentimentos próprios
            para menores, então não aceita fotos dele.
          </p>
        </Notice>
      ) : (
        <>
          <label className="check-row">
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
            O aluno autorizou o registro destas fotos para o acompanhamento dele.
          </label>
          <p className="small muted">
            Esta confirmação fica registrada. A base legal e o texto do consentimento para imagens
            de saúde ainda não estão definidos na ferramenta.
          </p>
        </>
      )}
      <div className="photo-grid">
        {PHOTO_VIEWS.map((view) => {
          const stored = photos.find((photo) => photo.view === view.key);
          return (
            <div key={view.key} className="photo-slot" role="group" aria-label={`Foto ${view.label.toLowerCase()}`}>
              <strong>{view.label}</strong>
              {stored ? (
                <PhotoImage
                  studentId={studentId}
                  assessmentId={assessmentId}
                  view={view.key}
                  stamp={stored.createdAt}
                  alt={`Foto ${view.label.toLowerCase()} do aluno`}
                />
              ) : (
                <div className="posture-photo empty">Sem foto</div>
              )}
              {!minor && (
                <>
                  <input
                    ref={(element) => {
                      inputs.current[view.key] = element;
                    }}
                    id={`foto-${view.key}`}
                    className="sr-only"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={!consent || busy !== null}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void send(view.key, file);
                    }}
                  />
                  <label
                    htmlFor={`foto-${view.key}`}
                    className={`button secondary small${!consent || busy !== null ? " disabled" : ""}`}
                    aria-disabled={!consent || busy !== null}
                  >
                    <Camera size={16} /> {stored ? "Substituir foto" : "Enviar foto"}
                    <span className="sr-only"> {view.label.toLowerCase()}</span>
                  </label>
                </>
              )}
              {stored && (
                <button
                  type="button"
                  className="button danger-outline small"
                  disabled={busy !== null}
                  onClick={() => void remove(view.key)}
                >
                  <Trash2 size={16} /> Remover foto <span className="sr-only">{view.label.toLowerCase()}</span>
                </button>
              )}
            </div>
          );
        })}
      </div>
      {busy && (
        <p className="small muted" role="status">
          Enviando…
        </p>
      )}
      {message && (
        <p role={failed ? "alert" : "status"} className={failed ? "form-error" : "small muted"}>
          {message}
        </p>
      )}
    </fieldset>
  );
}
