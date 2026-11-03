"use client";
import { useRef } from "react";
import { Camera, Trash2 } from "lucide-react";
import { Notice } from "@/components/ui";
import { PhotoImage } from "../photo-image";
import { photoViewLabel, type PhotoView } from "../photos";
import { POSTURE_VIEW_SHORT, type PostureView } from "../catalog";
import { POSTURE_PHOTO_VIEWS, photoOf, photoName } from "./posture-photos";
import type { PosturePhotos } from "./use-posture-photos";

/**
 * The optional photos of one view of the posture (handoff 3.3), under its findings and notes: one slot per stored view (the lateral view has the
 * two sides). Each slot is a column of the card's grid (the .av2-grid rule: the card picks its columns by its own width) with three rows that line
 * up across the slots: the name, the picture, the buttons.
 */
export function PosturePhotosField({
  studentId,
  assessmentId,
  view,
  photos,
  storageReady,
  amendment = false,
}: {
  studentId: string;
  assessmentId: string;
  view: PostureView;
  photos: PosturePhotos;
  storageReady: boolean;
  /** A retificação starts without photos: the ones of the assessment it corrects stay with that one. */
  amendment?: boolean;
}) {
  const inputs = useRef<Partial<Record<PhotoView, HTMLInputElement | null>>>({});
  const headingId = `av2-fotos-${view}`;
  return (
    <div className="av2-photos">
      <h4 className="av2-subtitle" id={headingId}>
        Fotos da vista {POSTURE_VIEW_SHORT[view].toLowerCase()} (opcional)
      </h4>
      <p className="muted small av2-card-note">
        Registro visual, não diagnóstico. A ferramenta tira da foto os dados do aparelho (posição, data e modelo) antes de guardar, e só quem atende
        o aluno a vê. Ao finalizar, as fotos ficam com a avaliação e não mudam mais; cada uma ainda pode ser excluída.
        {amendment && " Esta retificação começa sem fotos: as da avaliação retificada continuam nela."}
      </p>
      {!storageReady && (
        <Notice tone="warning">
          <p>
            <strong>Fotos indisponíveis neste ambiente.</strong> O armazenamento de fotos não está ligado aqui. O resto da avaliação funciona
            normalmente.
          </p>
        </Notice>
      )}
      <div className="av2-grid av2-photo-grid" role="group" aria-labelledby={headingId}>
        {POSTURE_PHOTO_VIEWS[view].map((item) => {
          const stored = photoOf(photos.photos, item);
          const label = photoViewLabel(item);
          const inputId = `av2-foto-${item}`;
          const disabled = photos.busy !== null;
          return (
            <div key={item} className="av2-field av2-photo-slot" role="group" aria-label={photoName(item)}>
              <span className="av2-label">{label}</span>
              {stored ? (
                <PhotoImage studentId={studentId} assessmentId={assessmentId} view={item} stamp={stored.stamp} alt={`${photoName(item)} do aluno`} />
              ) : (
                <div className="posture-photo empty">{photos.busy === item && photos.action === "send" ? "Enviando…" : "Sem foto"}</div>
              )}
              <div className="av2-photo-actions">
                {storageReady && (
                  <>
                    <input
                      ref={(element) => {
                        inputs.current[item] = element;
                      }}
                      id={inputId}
                      className="sr-only"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      disabled={disabled}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) void photos.send(item, file);
                      }}
                    />
                    <label htmlFor={inputId} className="button secondary small" aria-disabled={disabled || undefined}>
                      <Camera size={16} /> {stored ? "Substituir foto" : "Enviar foto"}
                      <span className="sr-only"> {label.toLowerCase()}</span>
                    </label>
                  </>
                )}
                {stored && storageReady && (
                  <button type="button" className="button danger-outline small" disabled={disabled} onClick={() => void photos.remove(item)}>
                    <Trash2 size={16} /> Remover foto <span className="sr-only">{label.toLowerCase()}</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The one line that says what happened to the last photo sent or removed (outside the tab panels, so it is said once). */
export function PosturePhotosStatus({ photos }: { photos: PosturePhotos }) {
  return (
    <div className="av2-photo-status">
      <p role="status" className="small muted">
        {photos.action === "send" ? "Enviando a foto…" : photos.action === "remove" ? "Removendo a foto…" : photos.message && !photos.message.failed ? photos.message.text : ""}
      </p>
      <div role="alert">{photos.message?.failed && <p className="form-error">{photos.message.text}</p>}</div>
    </div>
  );
}
