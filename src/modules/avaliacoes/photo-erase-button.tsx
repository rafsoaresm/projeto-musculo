"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useMountPath } from "@/components/use-mount-path";
import { photoViewLabel, type PhotoView } from "./photos";

/**
 * Deletes the photo of one view of a recorded assessment: the file leaves the private storage and the assessment shows that the photo was
 * erased (its frozen record stays). No request of the student is needed. Two steps, because it has no way back.
 */
export function PhotoEraseButton({ studentId, assessmentId, view }: { studentId: string; assessmentId: string; view: PhotoView }) {
  const router = useRouter();
  const mountPath = useMountPath();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const label = photoViewLabel(view).toLowerCase();

  async function erase() {
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch(`${mountPath()}/profissional/alunos/${studentId}/avaliacoes/${assessmentId}/fotos/${view}`, {
        method: "DELETE",
        headers: { "x-photo-request": "1" },
      });
      if (!response.ok) throw new Error("erase");
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <>
      {confirming ? (
        <span className="persist-actions">
          <button type="button" className="button danger-outline small" disabled={busy} onClick={() => void erase()}>
            <Trash2 size={16} /> Confirmar exclusão <span className="sr-only">da foto {label}</span>
          </button>
          <button type="button" className="button secondary small" disabled={busy} onClick={() => setConfirming(false)}>
            Cancelar
          </button>
        </span>
      ) : (
        <button type="button" className="button danger-outline small" onClick={() => setConfirming(true)}>
          <Trash2 size={16} /> Excluir foto <span className="sr-only">{label}</span>
        </button>
      )}
      {failed && (
        <p role="alert" className="form-error">
          Não foi possível excluir a foto. Tente novamente.
        </p>
      )}
    </>
  );
}
