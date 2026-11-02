import { isRedirectError } from "next/dist/client/components/redirect-error";
import { requireWorkspace } from "@/modules/auth/server";
import { previewBuilderPage } from "@/db/builder-public";
import { sitesFor } from "@/db/sites";
import { canEditSite } from "@/modules/meu-site/access";
import { notFoundDocument, publicDocument, PUBLIC_CSP } from "@/modules/frappe-site/public-page";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/**
 * The page is shown inside the editor's own frame: the only change to the public policy is who may frame it (this app). Browsers follow
 * `frame-ancestors` over the app-wide `X-Frame-Options: DENY` (the frame of the free code works the same way; the browser test frames it).
 */
const PREVIEW_CSP = PUBLIC_CSP.replace("frame-ancestors 'none'", "frame-ancestors 'self'");
const headers = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": PREVIEW_CSP,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex",
};

/**
 * The preview of the Editor Avançado (handoff V4, defect 1, AC19.5): the draft of one page, drawn by the same renderer as the public page, at
 * `/site/<address>/m/previa?page=<name>`, so its images and links resolve like the public page's under any mount path. Only someone who edits
 * the site of their own space sees it; anyone else, another space's address and an unknown page get the same 404. Nothing is published.
 */
export async function GET(request: Request, { params }: Params) {
  const { slug } = await params;
  const notFound = () => new Response(notFoundDocument(), { status: 404, headers });
  let found = null;
  try {
    const session = await requireWorkspace();
    if (!canEditSite(session.workspace.role)) return notFound();
    if ((await sitesFor(session.db, session.context).slug()) !== slug) return notFound();
    found = await previewBuilderPage(session.db, session.context.organizationId, new URL(request.url).searchParams.get("page") ?? "");
  } catch (error) {
    if (isRedirectError(error)) return notFound();
    throw error;
  }
  if (!found) return notFound();
  // Two segments after the address (m/previa): the relative addresses of the page are written from that depth. Forms are not drawn here.
  return new Response(publicDocument(found, 2, null), { headers });
}
