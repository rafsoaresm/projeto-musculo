import { getCloudflareContext } from "@opennextjs/cloudflare";
import { publishedSiteBySlug } from "@/db/sites";
import { pageSlug } from "@/modules/meu-site/contracts";
import { INQUIRY_PAGE_HEADERS, inquiryPageHtml } from "@/modules/meu-site/inquiry-pages";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/**
 * What the contact form answers after a message was received. It says only what is true: it was sent. Whether and when anyone answers is not
 * promised here. An address that is not a published site answers the same 404 as the other routes of the site.
 */
export async function GET(request: Request, { params }: Params) {
  const { slug } = await params;
  const { env } = await getCloudflareContext({ async: true });
  const site = await publishedSiteBySlug(env.DB, slug);
  if (!site) {
    return new Response("Página não encontrada.", { status: 404, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" } });
  }
  const asked = pageSlug.safeParse(new URL(request.url).searchParams.get("pagina") ?? "");
  // From `/s/<slug>/m/enviado` the site is two levels up.
  const back = asked.success ? `../../${site.slug}/${asked.data}` : `../../${site.slug}`;
  return new Response(
    inquiryPageHtml({
      title: "Mensagem enviada",
      message: "A sua mensagem foi enviada. Quem cuida deste site vai ler e, se for o caso, responder pelo contato que você deixou.",
      back: { href: back, label: "Voltar ao site" },
    }),
    { headers: INQUIRY_PAGE_HEADERS },
  );
}
