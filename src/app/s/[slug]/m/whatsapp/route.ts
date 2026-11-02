import { getCloudflareContext } from "@opennextjs/cloudflare";
import { receiveInquiry } from "@/db/site-inquiries";
import { publishedSiteBySlug, siteEngineBySlug } from "@/db/sites";
import { whatsappUrl } from "@/modules/meu-site/contracts";
import { WHATSAPP_FIELD_PROBLEM, formsGate, parseWhatsAppLead, readLimitedBody, senderKey } from "@/modules/meu-site/inquiries";
import { INQUIRY_PAGE_HEADERS, inquiryPageHtml } from "@/modules/meu-site/inquiry-pages";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

const answer = (status: number, page: Parameters<typeof inquiryPageHtml>[0], extra: Record<string, string> = {}) =>
  new Response(inquiryPageHtml(page), { status, headers: { ...INQUIRY_PAGE_HEADERS, ...extra } });

/** Closed, unknown, taken offline, not asking: they all answer the same, so nobody learns from here which sites exist or have the form on. */
const notFound = () =>
  new Response("Página não encontrada.", { status: 404, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" } });

/** To the professional's WhatsApp, in the same tab (a new one would be stopped as a pop-up). */
const toWhatsApp = (address: string) => new Response(null, { status: 303, headers: { Location: address, "Cache-Control": "no-store" } });

/**
 * The form before WhatsApp of a published page (handoff V1.1, "Fluxo A"). No session and no cookie: the organization, the number and the opening
 * message are the ones of the site the address names, as it is published, never anything the visitor sent. Nothing is written unless the
 * environment opened the public forms AND the site opened its own switch AND the published site asks for the form AND it is public; the visitor
 * is taken to WhatsApp only after the message is kept. A program that fills the bait field is sent on as if it had worked, and nothing is kept.
 */
export async function POST(request: Request, { params }: Params) {
  const { slug } = await params;
  const { env } = await getCloudflareContext({ async: true });
  const gate = formsGate(env, process.env);
  if (!gate.open) return notFound();
  // A site moved to the new editor shows its pages, not the published guided one, so this form is not on any page of it.
  if ((await siteEngineBySlug(env.DB, slug)) === "frappe") return notFound();
  const site = await publishedSiteBySlug(env.DB, slug);
  const cta = site?.content.whatsappCta;
  if (!site || !site.inquiriesOpen || !cta?.askFirst) return notFound();
  const target = whatsappUrl(site.content.contact.whatsapp, cta.message);
  if (!target) return notFound();
  // The way back is the site, two levels up from here (`/s/<slug>/m/whatsapp`): a relative address, so the mount path of the platform comes along.
  const back = { href: `../../${encodeURIComponent(slug)}`, label: "Voltar ao site" };

  if (!/^application\/x-www-form-urlencoded\b/i.test(request.headers.get("content-type") ?? "")) {
    return answer(415, { title: "Não foi possível continuar", message: "O formulário não foi enviado do jeito esperado. Volte à página e tente de novo.", back });
  }
  const body = await readLimitedBody(request);
  if (body === null) {
    return answer(413, { title: "Envio grande demais", message: "O que foi enviado passa do tamanho que o formulário aceita. Volte à página e tente de novo.", back });
  }
  const parsed = parseWhatsAppLead(new URLSearchParams(body), cta.askGoal);
  if (parsed.kind === "bot") return toWhatsApp(target);
  if (parsed.kind === "invalid") {
    // The page has no script: the browser's own "back" keeps what was written, and the form is still open there.
    return answer(400, { title: "Confira o formulário", message: `${WHATSAPP_FIELD_PROBLEM[parsed.field]} Use o botão Voltar do navegador para corrigir sem perder o que você escreveu.`, back });
  }

  const secret = env.AUTH_SECRET || process.env.AUTH_SECRET;
  const address = request.headers.get("cf-connecting-ip");
  const sender = secret && address ? await senderKey(secret, address) : null;
  const { name, phone, goal, page } = parsed.value;
  const outcome = await receiveInquiry(env.DB, {
    slug,
    value: { name, email: null, phone, message: goal, page },
    noticeUrl: gate.noticeUrl,
    sender,
    via: "WHATSAPP",
  });
  if (outcome.status === "closed") return notFound();
  if (outcome.status === "limited") {
    // Not kept: the visitor is not sent on as if it had been (handoff: never open WhatsApp after a failed save), but may go by choice.
    return answer(
      429,
      {
        title: "Tente de novo mais tarde",
        message: "O formulário não está recebendo mais contatos agora, e por isso o seu nome e o seu celular não foram guardados. Tente de novo mais tarde, ou fale direto no WhatsApp.",
        back,
        // Never opened by itself (the handoff): the visitor chooses to go, and nothing of what was typed goes with it.
        also: { href: target, label: "Falar no WhatsApp mesmo assim" },
      },
      { "Retry-After": "3600" },
    );
  }
  return toWhatsApp(target);
}
