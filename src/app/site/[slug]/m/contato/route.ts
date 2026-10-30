import { getCloudflareContext } from "@opennextjs/cloudflare";
import { publicBuilderPage } from "@/db/builder-public";
import { receiveInquiry } from "@/db/site-inquiries";
import { FORM_BODY_MAX_BYTES, FORM_FIELD, parseFormSubmission, routeFitsInbox } from "@/modules/frappe-site/form";
import { formsOfPage } from "@/modules/frappe-site/public-page";
import { formsGate, readLimitedBody, senderKey } from "@/modules/meu-site/inquiries";
import { INQUIRY_PAGE_HEADERS, inquiryPageHtml } from "@/modules/meu-site/inquiry-pages";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

const answer = (status: number, page: Parameters<typeof inquiryPageHtml>[0], extra: Record<string, string> = {}) =>
  new Response(inquiryPageHtml(page), { status, headers: { ...INQUIRY_PAGE_HEADERS, ...extra } });

/** Closed, unknown, not a form of the page: they all answer the same, so nobody learns from here which sites exist or have a form on. */
const notFound = () =>
  new Response("Página não encontrada.", { status: 404, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" } });

/** The thank-you page is a sibling of this route; a relative address keeps the mount path of the platform out of the code. */
const thanks = (route: string) =>
  new Response(null, { status: 303, headers: { Location: route ? `./enviado?pagina=${encodeURIComponent(route)}` : "./enviado", "Cache-Control": "no-store" } });

/**
 * The form of a page made in the new editor. No session and no cookie: the organization is the one of the site the address names, and what the
 * form IS (its fields, what each one means, what each may hold) is read here from the published page, never from what the visitor sent; the
 * visitor only supplies values for fields that page really has. Nothing is written unless the environment opened the public forms AND the site
 * opened its own switch AND the site is public. Like the form of the first editor, it is a plain HTML form (no script): every answer is a page,
 * and a program that fills the bait field is thanked and nothing is kept.
 */
export async function POST(request: Request, { params }: Params) {
  const { slug } = await params;
  const { env } = await getCloudflareContext({ async: true });
  const gate = formsGate(env, process.env);
  if (!gate.open) return notFound();
  // From `/site/<slug>/m/contato` the site is one level up.
  const back = { href: "../", label: "Voltar ao site" };

  if (!/^application\/x-www-form-urlencoded\b/i.test(request.headers.get("content-type") ?? "")) {
    return answer(415, { title: "Não foi possível enviar", message: "O formulário não foi enviado do jeito esperado. Volte à página e tente de novo.", back });
  }
  const body = await readLimitedBody(request, FORM_BODY_MAX_BYTES);
  if (body === null) {
    return answer(413, { title: "Mensagem grande demais", message: "O que foi enviado passa do tamanho que o formulário aceita. Encurte os textos e tente de novo.", back });
  }
  const form = new URLSearchParams(body);
  if ((form.get(FORM_FIELD.bait) ?? "") !== "") return thanks("");

  const route = form.get(FORM_FIELD.route) ?? "";
  if (!routeFitsInbox(route)) return notFound();
  const found = await publicBuilderPage(env.DB, slug, route);
  if (!found || !found.inquiriesOpen) return notFound();
  const definition = formsOfPage(found).find((entry) => entry.id === form.get(FORM_FIELD.form));
  const stale = () =>
    answer(409, { title: "A página mudou", message: "A página foi alterada depois que você a abriu. Volte, recarregue a página e envie de novo.", back });
  if (!definition) return stale();
  // A form that cannot receive messages is not drawn, so nobody sends it from the page: only a program sends it, and it learns nothing.
  if (definition.problems.length > 0) return notFound();

  const parsed = parseFormSubmission(definition, form, found.route);
  if (parsed.kind === "bot") return thanks("");
  if (parsed.kind === "changed") return stale();
  if (parsed.kind === "invalid") {
    // The page has no script: the browser's own "back" keeps what was written.
    return answer(400, { title: "Confira o formulário", message: `${parsed.problem} Use o botão Voltar do navegador para corrigir sem perder o que você escreveu.`, back });
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
  return thanks(found.route);
}
