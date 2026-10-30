import { getCloudflareContext } from "@opennextjs/cloudflare";
import { hasPublishedBuilderPage } from "@/db/builder-public";
import { routeFitsInbox } from "@/modules/frappe-site/form";
import { INQUIRY_PAGE_HEADERS, inquiryPageHtml } from "@/modules/meu-site/inquiry-pages";

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
  return new Response(
    inquiryPageHtml({
      title: "Mensagem enviada",
      message: "A sua mensagem foi enviada. Quem cuida deste site vai ler e, se for o caso, responder pelo contato que você deixou.",
      back: { href: back, label: "Voltar ao site" },
    }),
    { headers: INQUIRY_PAGE_HEADERS },
  );
}
