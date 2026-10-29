import { getCloudflareContext } from "@opennextjs/cloudflare";
import { receiveInquiry } from "@/db/site-inquiries";
import { INQUIRY_FIELD_PROBLEM, formsGate, parseInquiry, readLimitedBody, senderKey } from "@/modules/meu-site/inquiries";
import { INQUIRY_PAGE_HEADERS, inquiryPageHtml } from "@/modules/meu-site/inquiry-pages";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

const answer = (status: number, page: Parameters<typeof inquiryPageHtml>[0], extra: Record<string, string> = {}) =>
  new Response(inquiryPageHtml(page), { status, headers: { ...INQUIRY_PAGE_HEADERS, ...extra } });

/** Closed, unknown, taken offline: they all answer the same, so nobody learns from here which sites exist or have the form on. */
const notFound = () =>
  new Response("Página não encontrada.", { status: 404, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" } });

/** The thank-you page is a sibling of this route; a relative address keeps the mount path of the platform out of the code. */
const thanks = (page: string) =>
  new Response(null, { status: 303, headers: { Location: page ? `./enviado?pagina=${encodeURIComponent(page)}` : "./enviado", "Cache-Control": "no-store" } });

/**
 * The contact form of a published page. No session and no cookie: the organization is the one of the site the address names, never anything the
 * visitor sent, and nothing is written unless the environment opened the public forms AND the site opened its own switch AND the site is public.
 * The form is a plain HTML form (no script), so every answer is a page; a program that fills the bait field is thanked and nothing is kept.
 */
export async function POST(request: Request, { params }: Params) {
  const { slug } = await params;
  const { env } = await getCloudflareContext({ async: true });
  const gate = formsGate(env, process.env);
  if (!gate.open) return notFound();
  // The way back is the site, two levels up from here (`/s/<slug>/m/contato`): a relative address, so the mount path of the platform comes along.
  const back = { href: `../../${encodeURIComponent(slug)}`, label: "Voltar ao site" };

  if (!/^application\/x-www-form-urlencoded\b/i.test(request.headers.get("content-type") ?? "")) {
    return answer(415, { title: "Não foi possível enviar", message: "O formulário não foi enviado do jeito esperado. Volte à página e tente de novo.", back });
  }
  const body = await readLimitedBody(request);
  if (body === null) {
    return answer(413, { title: "Mensagem grande demais", message: "O que foi enviado passa do tamanho que o formulário aceita. Encurte a mensagem e tente de novo.", back });
  }
  const parsed = parseInquiry(new URLSearchParams(body));
  if (parsed.kind === "bot") return thanks("");
  if (parsed.kind === "invalid") {
    // The page has no script: the browser's own "back" keeps what was written.
    return answer(400, { title: "Confira o formulário", message: `${INQUIRY_FIELD_PROBLEM[parsed.field]} Use o botão Voltar do navegador para corrigir sem perder o que você escreveu.`, back });
  }

  const secret = env.AUTH_SECRET || process.env.AUTH_SECRET;
  const address = request.headers.get("cf-connecting-ip");
  const sender = secret && address ? await senderKey(secret, address) : null;
  const outcome = await receiveInquiry(env.DB, { slug, value: parsed.value, noticeUrl: gate.noticeUrl, sender });
  if (outcome.status === "closed") return notFound();
  if (outcome.status === "limited") {
    return answer(
      429,
      { title: "Tente de novo mais tarde", message: "O formulário não está recebendo mais mensagens agora. Tente de novo mais tarde, ou use outro contato do site.", back },
      { "Retry-After": "3600" },
    );
  }
  return thanks(parsed.value.page);
}
