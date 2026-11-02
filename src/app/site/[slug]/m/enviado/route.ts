import { getCloudflareContext } from "@opennextjs/cloudflare";
import { hasPublishedBuilderPage } from "@/db/builder-public";
import { publicTrackingBySlug } from "@/db/site-tracking";
import { routeFitsInbox } from "@/modules/frappe-site/form";
import { INQUIRY_PAGE_HEADERS, inquiryPageHtml } from "@/modules/meu-site/inquiry-pages";
import { inquiryPageCsp, toolsOf } from "@/modules/meu-site/tracking-csp";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/**
 * What the form of a page made in the new editor answers after a message was received. It says only what is true: it was sent. Whether and when
 * anyone answers is not promised here. An address with no published page answers the same 404 as the other routes of the site.
 */
export async function GET(request: Request, { params }: Params) {
  const { slug } = await params;
  const { env } = await getCloudflareContext({ async: true });
  if (!(await hasPublishedBuilderPage(env.DB, slug))) {
    return new Response("Página não encontrada.", { status: 404, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" } });
  }
  const asked = new URL(request.url).searchParams.get("pagina") ?? "";
  // From `/site/<slug>/m/enviado` the site is one level up; the page the person was on is below it.
  const back = asked !== "" && routeFitsInbox(asked) ? `../${asked.split("/").map(encodeURIComponent).join("/")}` : "../";
  // A site with tagging (0.71): the page loads the site's script, at `/s/<slug>/m/rastreio` (from `/site/<slug>/m/` that is three levels up, then
  // down), which fires the conversion of an accepted message once.
  const tracking = await publicTrackingBySlug(env.DB, slug);
  return new Response(
    inquiryPageHtml({
      title: "Mensagem enviada",
      message: "A sua mensagem foi enviada. Quem cuida deste site vai ler e, se for o caso, responder pelo contato que você deixou.",
      back: { href: back, label: "Voltar ao site" },
      ...(tracking ? { script: `../../../s/${encodeURIComponent(slug)}/m/rastreio` } : {}),
    }),
    { headers: tracking ? { ...INQUIRY_PAGE_HEADERS, "Content-Security-Policy": inquiryPageCsp(toolsOf(tracking)) } : INQUIRY_PAGE_HEADERS },
  );
}
