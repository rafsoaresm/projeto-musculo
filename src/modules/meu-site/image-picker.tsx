"use client";
import { useRef, useState } from "react";
import { Trash2, Upload } from "lucide-react";
import type { AssetRow } from "@/db/site-assets";

export type UploadResult = { ok: true; asset: AssetRow } | { ok: false; message: string };
export type RemoveResult = { ok: boolean; message: string };

/**
 * Chooses an image of the site's library, and adds to it or removes from it. The library is the site's, not the block's:
 * the same image can be used in many places, and one that is used (in the page being edited) is not removed from here.
 * Sending is immediate and goes to the server; choosing only changes the document, which is saved with the rest.
 */
export function ImagePicker({
  legend,
  name,
  library,
  value,
  onChange,
  allowNone = false,
  noneLabel = "Nenhuma",
  usedIds,
  available,
  src,
  onUpload,
  onRemove,
}: {
  legend: string;
  name: string;
  library: AssetRow[];
  value: string;
  onChange: (assetId: string) => void;
  allowNone?: boolean;
  noneLabel?: string;
  usedIds: ReadonlySet<string>;
  available: boolean;
  src: (assetId: string) => string;
  onUpload: (file: File) => Promise<UploadResult>;
  onRemove: (assetId: string) => Promise<RemoveResult>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; failed: boolean } | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setNote(null);
    const result = await onUpload(file);
    setBusy(false);
    if (result.ok) {
      onChange(result.asset.id);
      setNote({ text: "Imagem enviada.", failed: false });
    } else {
      setNote({ text: result.message, failed: true });
    }
    if (input.current) input.current.value = "";
  }
  async function remove(assetId: string) {
    setBusy(true);
    const result = await onRemove(assetId);
    setBusy(false);
    setConfirming(null);
    setNote({ text: result.message, failed: !result.ok });
  }

  return (
    <fieldset className="ve-choice">
      <legend>{legend}</legend>
      {!available && <p className="small muted">Imagens indisponíveis neste ambiente.</p>}
      <div className="ve-thumbs">
        {allowNone && (
          <label className="ve-thumb ve-thumb-none">
            <input type="radio" name={name} checked={value === ""} onChange={() => onChange("")} />
            <span>{noneLabel}</span>
          </label>
        )}
        {library.map((asset, index) => (
          <div className="ve-thumb" key={asset.id}>
            <label>
              <input type="radio" name={name} checked={value === asset.id} onChange={() => onChange(asset.id)} />
              {/* eslint-disable-next-line @next/next/no-img-element -- the editor's own address, with the session */}
              <img src={src(asset.id)} alt="" width={asset.width} height={asset.height} loading="lazy" />
              <span className="sr-only">
                Imagem {index + 1}, {asset.width} por {asset.height} pixels
              </span>
            </label>
            <button
              type="button"
              className="ve-thumb-remove"
              aria-label={`Remover a imagem ${index + 1} da biblioteca`}
              title={usedIds.has(asset.id) ? "Está em uso nesta página" : "Remover da biblioteca"}
              disabled={busy || usedIds.has(asset.id)}
              onClick={() => setConfirming(asset.id)}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      {confirming && (
        <div className="ve-confirm" role="group" aria-label="Confirmar a remoção da imagem">
          <p className="small">Remover esta imagem da biblioteca? O arquivo é apagado (se uma versão publicada a usou, ela fica).</p>
          <div className="persist-actions">
            <button type="button" className="button small danger-outline" disabled={busy} onClick={() => remove(confirming)}>
              Remover
            </button>
            <button type="button" className="button small secondary" onClick={() => setConfirming(null)}>
              Voltar
            </button>
          </div>
        </div>
      )}
      <div className="persist-actions">
        <button type="button" className="button small secondary" disabled={busy || !available} onClick={() => input.current?.click()}>
          <Upload size={16} /> {busy ? "Aguarde…" : "Enviar imagem"}
        </button>
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
          hidden
          aria-label="Escolher o arquivo da imagem"
          onChange={(event) => void pick(event.target.files?.[0])}
        />
      </div>
      <p className="small muted">JPEG ou PNG; a imagem é reduzida e limpa dos dados da câmera antes de ser guardada. Não use fotos de alunos.</p>
      {note && (
        <p role={note.failed ? "alert" : "status"} className={note.failed ? "form-error" : "small muted"}>
          {note.text}
        </p>
      )}
    </fieldset>
  );
}
