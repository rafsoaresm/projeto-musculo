import { isRedirectError } from "next/dist/client/components/redirect-error";
import { getURLFromRedirectError } from "next/dist/client/components/redirect";
import { requireWorkspace } from "@/modules/auth/server";
import { canEditSite } from "@/modules/meu-site/access";
import { EDITOR_SHELL } from "@/modules/frappe-editor/shell.generated";

export const dynamic = "force-dynamic";

const HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

/**
 * Where a person goes who is not signed in, or has not accepted the terms: the address the session guard names, under the mount path.
 * A route handler does not add the mount path to a redirect by itself, and this app only knows it from the address of the request, so the
 * page works it out in the browser (everything before `/profissional/meu-site/editor`).
 */
function goTo(target: string) {
  const to = JSON.stringify(target);
  const page = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Entrando…</title><meta name="robots" content="noindex"></head><body>
<script>var marker = "/profissional/meu-site/editor"; var at = location.pathname.indexOf(marker); location.replace((at > 0 ? location.pathname.slice(0, at) : "") + ${to.replace(/</g, "\\u003c")});</script>
<noscript><p>Entre na sua conta para continuar.</p></noscript></body></html>`;
  return new Response(page, { headers: HEADERS });
}

/**
 * The editor of the site (Frappe Builder, compiled into public/frappe-editor). This address answers with the page that loads it, for every
 * path under it (the editor has routes of its own); the files themselves are static and hold nothing of anyone. Only a login that edits
 * the site gets the page; what the editor then reads and writes is answered by /api/builder-editor, which checks the session again.
 */
export async function GET() {
  let role: string;
  try {
    role = (await requireWorkspace()).workspace.role;
  } catch (error) {
    if (isRedirectError(error)) return goTo(getURLFromRedirectError(error) ?? "/entrar");
    throw error;
  }
  if (!canEditSite(role)) return new Response("Só o proprietário ou a gestão editam o site.", { status: 403, headers: { ...HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
  return new Response(EDITOR_SHELL, { headers: HEADERS });
}
