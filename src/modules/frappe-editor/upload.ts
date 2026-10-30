import type { AddFileOutcome } from "@/db/builder-files";
import { IMAGE_REFUSAL_MESSAGE, MAX_IMAGE_BYTES } from "@/modules/meu-site/images";

/**
 * The upload of an image from the editor: the editor's file picker posts a form (`file`, `is_private`, `folder` ...) and takes the
 * address of the file from the answer, which it then writes into the block. Here the address is the one the public route serves
 * (`<mount>/s/<address of the site>/m/<id>`); a page that is published writes it again relative to itself (frappe-site/urls.ts), so the mount
 * path of the moment is not kept in what is published. Nothing here decides who may upload: the repository does, from the session.
 */
export const UPLOAD_METHODS = new Set(["builder.api.upload_builder_asset", "upload_file"]);

export interface UploadDeps {
  add(bytes: Uint8Array, fileName: string): Promise<AddFileOutcome>;
  /** The address of the organization's site, or null while it has none. */
  slug: string | null;
  /** The mount path of the app in front of its own addresses ("" at the root). */
  mount: string;
}

export type UploadResult =
  | { ok: true; message: { name: string; file_name: string; file_url: string; file_size: number; is_private: 0; folder: string } }
  | { ok: false; status: number; excType: string; message: string };

const refuse = (status: number, excType: string, message: string): UploadResult => ({ ok: false, status, excType, message });

/** What a mount path looks like: nothing (the root), or a few segments of letters, digits, hyphens and underscores. */
const MOUNT = /^(?:\/[A-Za-z0-9_-]{1,40}){0,4}$/;

/**
 * The mount path of the app (`/app`, `/treinador` or nothing), to write the addresses of its own files for the editor. The editor says it itself
 * (`X-Editor-Mount`, from the address it was loaded at): the platform may hand the app a request without the mount path, so the address of the
 * request cannot be trusted to have it. What the header says must look like a mount path and is only ever used to write addresses back to the
 * same editor; without it, the part of the address before the editor's own is used.
 */
export function mountOf(request: Request): string {
  const said = request.headers.get("x-editor-mount");
  if (said !== null && MOUNT.test(said)) return said;
  const path = new URL(request.url).pathname;
  const at = path.indexOf("/api/builder-editor/");
  return at > 0 ? path.slice(0, at) : "";
}

export async function handleUpload(request: Request, deps: UploadDeps): Promise<UploadResult> {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) return refuse(400, "ValidationError", "O envio precisa ser um formulário com o arquivo.");
  // A little over the limit of the image: the form carries its own fields too.
  if (Number(request.headers.get("content-length") ?? "0") > MAX_IMAGE_BYTES + 100_000) return refuse(413, "ValidationError", IMAGE_REFUSAL_MESSAGE.TOO_LARGE);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return refuse(400, "ValidationError", "O envio não pôde ser lido.");
  }
  const file = form.get("file");
  if (!file || typeof file === "string") return refuse(400, "ValidationError", "Nenhum arquivo foi enviado.");
  if (file.size > MAX_IMAGE_BYTES) return refuse(413, "ValidationError", IMAGE_REFUSAL_MESSAGE.TOO_LARGE);
  if (!deps.slug) return refuse(417, "ValidationError", "Defina o endereço do site em Meu Site antes de enviar imagens.");
  const outcome = await deps.add(new Uint8Array(await file.arrayBuffer()), file.name);
  switch (outcome.status) {
    case "stored":
      return {
        ok: true,
        message: {
          name: outcome.file.id,
          file_name: outcome.file.fileName,
          file_url: `${deps.mount}/s/${deps.slug}/m/${outcome.file.id}`,
          file_size: outcome.file.bytes,
          is_private: 0,
          folder: "Home/Builder Uploads",
        },
      };
    case "invalid":
      return refuse(417, "ValidationError", IMAGE_REFUSAL_MESSAGE[outcome.reason]);
    case "limit":
      return refuse(417, "ValidationError", "O limite de 300 imagens foi atingido. Remova o que não usa mais.");
    case "unavailable":
      return refuse(503, "ValidationError", "O armazenamento de imagens não está ligado neste ambiente.");
    case "forbidden":
      return refuse(403, "PermissionError", "Só o proprietário ou a gestão enviam imagens.");
  }
}
