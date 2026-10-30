import { isRedirectError } from "next/dist/client/components/redirect-error";
import { requireWorkspace } from "@/modules/auth/server";
import { builderDocsFor } from "@/db/builder-docs";
import { builderFilesFor } from "@/db/builder-files";
import { getSiteMediaBucket } from "@/db/binding";
import { sitesFor } from "@/db/sites";
import { canEditSite } from "@/modules/meu-site/access";
import { EditorError, call, type Params } from "@/modules/frappe-editor/protocol";
import { standardTemplates } from "@/modules/frappe-editor/standard-templates";
import { UPLOAD_METHODS, handleUpload, mountOf } from "@/modules/frappe-editor/upload";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const MAX_BODY_BYTES = 2_000_000;

const failure = (status: number, excType: string, message: string) =>
  Response.json({ exc_type: excType, exception: message, _server_messages: JSON.stringify([JSON.stringify({ message })]) }, { status, headers: NO_STORE });

const hash = (length: number) => {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => "0123456789abcdefghijklmnopqrstuvwxyz"[byte % 36]).join("");
};

/** `a=1&b={"x":2}` as the editor sends a read: JSON values stay JSON, the rest is text. */
function paramsOf(url: URL): Params {
  const out: Params = {};
  for (const [key, value] of url.searchParams) {
    try {
      out[key] = value.startsWith("{") || value.startsWith("[") ? JSON.parse(value) : value;
    } catch {
      out[key] = value;
    }
  }
  return out;
}

async function answer(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  // The editor sends this header on every call; a form on another site cannot, so a request that lacks it is not the editor's.
  if (request.headers.get("x-site-request") !== "1") return failure(400, "ValidationError", "Pedido não aceito.");
  const { path } = await params;
  // Everything the editor says goes through /api/method/<name>; the rest of Frappe's addresses are not answered.
  if (path.length !== 3 || path[0] !== "api" || path[1] !== "method") return failure(404, "DoesNotExistError", "Endereço desconhecido.");
  const method = decodeURIComponent(path[2]);

  let session;
  try {
    session = await requireWorkspace();
  } catch (error) {
    if (isRedirectError(error)) return failure(401, "AuthenticationError", "Entre de novo para continuar editando.");
    throw error;
  }
  if (!canEditSite(session.workspace.role)) return failure(403, "PermissionError", "Só o proprietário ou a gestão editam o site.");

  // The file picker posts a form, not JSON.
  if (UPLOAD_METHODS.has(method)) {
    if (request.method !== "POST") return failure(405, "ValidationError", "O envio de arquivos é feito por POST.");
    const result = await handleUpload(request, {
      add: async (bytes, name) => builderFilesFor(session.db, await getSiteMediaBucket(), session.context).add(bytes, name),
      slug: await sitesFor(session.db, session.context).slug(),
      mount: mountOf(request),
    });
    return result.ok ? Response.json({ message: result.message }, { headers: NO_STORE }) : failure(result.status, result.excType, result.message);
  }

  let body: Params = {};
  if (request.method === "POST") {
    if (Number(request.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) return failure(413, "ValidationError", "O pedido é grande demais.");
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return failure(413, "ValidationError", "O pedido é grande demais.");
    try {
      body = raw ? (JSON.parse(raw) as Params) : {};
    } catch {
      return failure(400, "ValidationError", "O pedido não é um JSON válido.");
    }
  }
  const params_: Params = { ...paramsOf(new URL(request.url)), ...(body && typeof body === "object" ? body : {}) };

  try {
    const env = {
      store: builderDocsFor(session.db, session.context),
      user: session.user.email,
      now: () => new Date(),
      hash,
      siteReady: async () => (await sitesFor(session.db, session.context).slug()) !== null,
      builtin: (doctype: string) => (doctype === "Block Template" ? standardTemplates(`${mountOf(request)}/frappe-editor/`) : []),
    };
    return Response.json(await call(env, method, params_), { headers: NO_STORE });
  } catch (error) {
    if (error instanceof EditorError) return failure(error.status, error.excType, error.message);
    throw error;
  }
}

export const GET = answer;
export const POST = answer;
