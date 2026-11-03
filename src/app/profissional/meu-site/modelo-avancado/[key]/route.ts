import { isRedirectError } from "next/dist/client/components/redirect-error";
import { requireWorkspace } from "@/modules/auth/server";
import { canEditSite } from "@/modules/meu-site/access";
import { SITE_MODELS_V1 } from "@/modules/meu-site/models";
import { siteModelPage } from "@/modules/frappe-editor/site-model-blocks";
import { buildDocument, PUBLIC_CSP } from "@/modules/frappe-site/document";
import { fontFaces } from "@/modules/frappe-site/fonts";
import { renderBlocks } from "@/modules/frappe-site/render";
import { urlContext } from "@/modules/frappe-site/urls";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ key: string }> };

/**
 * A model of the Editor Avançado's "Novo" gallery, drawn as the page it becomes (the "Pré-visualizar" of the gallery shows it in a frame of
 * the editor). The same converter as the page that is made, with the same renderer and policy as a published page, except that the editor
 * may frame it. Only for those who edit the site; nothing of the organization is read (the contact buttons say what is missing here).
 */
export async function GET(_request: Request, { params }: Params) {
  const { key } = await params;
  let session;
  try {
    session = await requireWorkspace();
  } catch (error) {
    if (isRedirectError(error)) return new Response("Entre para ver o modelo.", { status: 401, headers: { "Cache-Control": "no-store" } });
    throw error;
  }
  const model = SITE_MODELS_V1.find((entry) => entry.key === key);
  if (!model || !canEditSite(session.workspace.role)) return new Response("Modelo não encontrado.", { status: 404, headers: { "Cache-Control": "no-store" } });
  // This address is three levels under the mount (`profissional/meu-site/modelo-avancado/<key>`): the fonts are found from there.
  const mountRoot = "../../../";
  const url = urlContext("modelo", 3);
  const rendered = renderBlocks({
    blocks: [siteModelPage(model, session.workspace.name, { whatsapp: null })],
    component: () => null,
    fontToken: () => null,
    url,
    // A sample: the contact form is drawn as it will be once the site receives messages, and is sent nowhere (this address answers no POST).
    forms: { route: "", send: { action: "#", noticeUrl: null } },
  });
  const html = buildDocument({
    rendered,
    meta: { title: model.label, description: model.hint, image: null, favicon: null, language: "pt-BR", noindex: true },
    tokens: [],
    freeStyles: [],
    fontFaces: fontFaces(rendered.fonts, mountRoot),
    keepLight: true,
    asset: url.asset,
  });
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": PUBLIC_CSP.replace("frame-ancestors 'none'", "frame-ancestors 'self'"),
    },
  });
}
