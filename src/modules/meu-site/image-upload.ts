import { MAX_IMAGE_BYTES, UPLOAD_LONG_SIDE } from "./images";

/** What a person may pick; the browser re-draws it, so formats the server does not take (WebP, GIF, AVIF) still work. */
export const PICK_LIMIT_BYTES = 40 * 1024 * 1024;

const encode = (canvas: HTMLCanvasElement, type: "image/jpeg" | "image/png") =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("ENCODE"))), type, type === "image/jpeg" ? 0.86 : undefined),
  );

/**
 * Re-draws the picture in the browser before it is sent: the right way up (the camera's orientation flag is applied and
 * dropped), at most 2000 px on the long side, as a PNG when it was a PNG (a logo keeps its transparency) and as a JPEG
 * otherwise, with no metadata at all: the position and device of a phone photo never leave the phone. A PNG too large to
 * send is made smaller, and in the end a JPEG. The server checks the file again and cleans it; this keeps the upload small.
 */
export async function prepareImage(file: File): Promise<Blob> {
  if (file.size > PICK_LIMIT_BYTES) throw new Error("PICK_TOO_LARGE");
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const wantPng = file.type === "image/png";
    for (const factor of wantPng ? [1, 0.7, 0.5] : [1]) {
      const scale = Math.min(1, UPLOAD_LONG_SIDE / Math.max(bitmap.width, bitmap.height)) * factor;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("CANVAS");
      if (!wantPng) {
        // A JPEG has no transparency: what was see-through becomes white, not black.
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await encode(canvas, wantPng ? "image/png" : "image/jpeg");
      if (blob.size <= MAX_IMAGE_BYTES) return blob;
    }
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, UPLOAD_LONG_SIDE / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("CANVAS");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await encode(canvas, "image/jpeg");
    if (blob.size > MAX_IMAGE_BYTES) throw new Error("STILL_TOO_LARGE");
    return blob;
  } finally {
    bitmap.close();
  }
}

export const PREPARE_MESSAGE: Record<string, string> = {
  PICK_TOO_LARGE: "O arquivo é grande demais (até 40 MB).",
  STILL_TOO_LARGE: "Não foi possível reduzir a imagem para menos de 5 MB.",
};
