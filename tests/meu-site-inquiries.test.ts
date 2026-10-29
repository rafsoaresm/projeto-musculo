import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  FIELD,
  INQUIRY_BODY_MAX_BYTES,
  INQUIRY_FIELD_PROBLEM,
  contactKeys,
  formsGate,
  noticeAddress,
  parseInquiry,
  readLimitedBody,
  senderKey,
} from "@/modules/meu-site/inquiries";
import { inquiryPageHtml } from "@/modules/meu-site/inquiry-pages";
import { SiteRenderer, type EditHooks, type PublicForm } from "@/modules/meu-site/renderer";
import { publicFormUrl } from "@/modules/meu-site/image-urls";
import { BLOCK_LABEL, emptyBlock, publishIssues, safeParseContent, type BlockOf, type SiteContent } from "@/modules/meu-site/contracts";
import { catalogueItem } from "@/modules/meu-site/presets";
import { nodeText } from "@/modules/meu-site/node-label";
import { publicFormOf } from "@/modules/meu-site/public-site";
import type { PublicSite } from "@/db/sites";

const NOTICE = "https://example.test/aviso-de-privacidade";
const form = (fields: Record<string, string>) => new URLSearchParams(fields);
const good = { nome: "Ana Souza", contato: "ana@example.test", mensagem: "Quero saber dos planos", aceite: "on" };

describe("when the public forms are open", () => {
  it("is never open unless the environment says exactly true on purpose, and there is a notice to point to", () => {
    expect(formsGate({}, {})).toEqual({ open: false, why: "off" });
    for (const value of ["", "TRUE", "True", "1", "yes", "false", " true"]) expect(formsGate({ PUBLIC_FORMS_ENABLED: value, PRIVACY_NOTICE_URL: NOTICE }, {}), value).toEqual({ open: false, why: "off" });
    expect(formsGate({ PUBLIC_FORMS_ENABLED: "true" }, {})).toEqual({ open: false, why: "no-notice" });
    expect(formsGate({ PUBLIC_FORMS_ENABLED: "true", PRIVACY_NOTICE_URL: "não é um endereço" }, {})).toEqual({ open: false, why: "no-notice" });
    expect(formsGate({ PUBLIC_FORMS_ENABLED: "true", PRIVACY_NOTICE_URL: NOTICE }, {})).toEqual({ open: true, noticeUrl: NOTICE });
  });
  it("takes the variable from the Worker or from the dashboard, the Worker's first", () => {
    expect(formsGate({}, { PUBLIC_FORMS_ENABLED: "true", PRIVACY_NOTICE_URL: NOTICE })).toEqual({ open: true, noticeUrl: NOTICE });
    expect(formsGate({ PUBLIC_FORMS_ENABLED: "true", PRIVACY_NOTICE_URL: NOTICE }, { PUBLIC_FORMS_ENABLED: "false" })).toMatchObject({ open: true });
    expect(formsGate({ PRIVACY_NOTICE_URL: "https://worker.test/aviso" }, { PUBLIC_FORMS_ENABLED: "true", PRIVACY_NOTICE_URL: NOTICE })).toEqual({ open: true, noticeUrl: "https://worker.test/aviso" });
  });
  it("points only to a page a visitor can open: https, or http on this very machine, and short", () => {
    expect(noticeAddress("https://example.test/aviso")).toBe("https://example.test/aviso");
    expect(noticeAddress("http://127.0.0.1:8787/aviso")).toBe("http://127.0.0.1:8787/aviso");
    expect(noticeAddress("http://localhost:3000/aviso")).toBe("http://localhost:3000/aviso");
    for (const bad of [undefined, "", "   ", "http://example.test/aviso", "javascript:alert(1)", "ftp://example.test/a", "//example.test/a", `https://example.test/${"a".repeat(300)}`]) expect(noticeAddress(bad), String(bad)).toBeNull();
  });
});

describe("what a visitor sends", () => {
  it("is a name, an e-mail or a phone, an optional message and the box that says the notice was read", () => {
    expect(parseInquiry(form(good))).toEqual({ kind: "ok", value: { name: "Ana Souza", email: "ana@example.test", phone: null, message: "Quero saber dos planos", page: "" } });
    expect(parseInquiry(form({ ...good, contato: "(11) 91234-5678", mensagem: "" }))).toEqual({
      kind: "ok",
      value: { name: "Ana Souza", email: null, phone: "(11) 91234-5678", message: null, page: "" },
    });
    expect(parseInquiry(form({ ...good, contato: "+55 11 91234-5678" }))).toMatchObject({ kind: "ok", value: { phone: "+55 11 91234-5678" } });
  });
  it("tidies what it keeps: the spaces around, the line breaks of the browser, and the address of the page only if it is one", () => {
    expect(parseInquiry(form({ ...good, nome: "  Ana Souza  ", mensagem: " linha 1\r\nlinha 2 ", pagina: "planos" }))).toMatchObject({ kind: "ok", value: { name: "Ana Souza", message: "linha 1\nlinha 2", page: "planos" } });
    for (const page of ["m", "Planos Caros", "../x", "a".repeat(41), "a--b"]) expect(parseInquiry(form({ ...good, pagina: page })), page).toMatchObject({ kind: "ok", value: { page: "" } });
  });
  it("says what is wrong, field by field, and nothing is accepted without the box ticked", () => {
    const wrong = (over: Record<string, string>) => parseInquiry(form({ ...good, ...over }));
    expect(wrong({ nome: "A" })).toEqual({ kind: "invalid", field: "name" });
    expect(wrong({ nome: "A".repeat(161) })).toEqual({ kind: "invalid", field: "name" });
    expect(wrong({ nome: "Ana\u0000Souza" })).toEqual({ kind: "invalid", field: "name" });
    expect(wrong({ nome: "Ana​Souza" })).toEqual({ kind: "invalid", field: "name" });
    expect(wrong({ nome: "" })).toEqual({ kind: "invalid", field: "name" });
    for (const contact of ["", "ab", "ana@", "ana@example", "@example.test", "ana example@test.com", "abc", "12345", "1".repeat(31), "11 91234-5678 ramal 3"]) {
      expect(wrong({ contato: contact }), contact).toEqual({ kind: "invalid", field: "contact" });
    }
    expect(wrong({ mensagem: "x".repeat(1001) })).toEqual({ kind: "invalid", field: "message" });
    expect(wrong({ mensagem: "oi\u0007" })).toEqual({ kind: "invalid", field: "message" });
    expect(wrong({ aceite: "" })).toEqual({ kind: "invalid", field: "consent" });
    expect(wrong({ aceite: "true" })).toEqual({ kind: "invalid", field: "consent" });
    const { aceite, ...without } = good;
    void aceite;
    expect(parseInquiry(form(without))).toEqual({ kind: "invalid", field: "consent" });
    for (const field of ["name", "contact", "message", "consent"] as const) expect(INQUIRY_FIELD_PROBLEM[field].length).toBeGreaterThan(10);
  });
  it("accepts a message of exactly 1000 letters and a name of exactly 160", () => {
    expect(parseInquiry(form({ ...good, mensagem: "x".repeat(1000), nome: "N".repeat(160) }))).toMatchObject({ kind: "ok" });
  });
  it("treats a filled bait field as a program: it is told so, whatever else is in the form (and a form that is wrong is still a program)", () => {
    expect(parseInquiry(form({ ...good, [FIELD.bait]: "http://spam.example" }))).toEqual({ kind: "bot" });
    expect(parseInquiry(form({ [FIELD.bait]: "x" }))).toEqual({ kind: "bot" });
    expect(parseInquiry(form({ ...good, [FIELD.bait]: "" }))).toMatchObject({ kind: "ok" });
  });
  it("is searched in the leads by the same keys the leads have", () => {
    expect(contactKeys({ email: "ANA@Example.test ", phone: null })).toEqual({ emailKey: "ana@example.test", phoneKey: null });
    expect(contactKeys({ email: null, phone: "+55 (11) 91234-5678" })).toEqual({ emailKey: null, phoneKey: "11912345678" });
  });
});

describe("the hash of the address of the sender", () => {
  it("is 32 hex characters, always the same for the same address and secret, and another for another one", async () => {
    const one = await senderKey("segredo-de-teste-com-mais-de-32-caracteres", "203.0.113.7");
    expect(one).toMatch(/^[0-9a-f]{32}$/);
    expect(await senderKey("segredo-de-teste-com-mais-de-32-caracteres", "203.0.113.7")).toBe(one);
    expect(await senderKey("segredo-de-teste-com-mais-de-32-caracteres", "203.0.113.8")).not.toBe(one);
    expect(await senderKey("outro-segredo-de-teste-com-mais-de-32", "203.0.113.7")).not.toBe(one);
    expect(one).not.toContain("203");
  });
});

describe("the body of the form", () => {
  const request = (body: BodyInit | null, headers: Record<string, string> = {}) => new Request("https://example.test/s/marina/m/contato", { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded", ...headers } });
  it("is read when it is small, and not when it is larger than a form of this kind is", async () => {
    expect(await readLimitedBody(request("nome=Ana"))).toBe("nome=Ana");
    expect(await readLimitedBody(request(null))).toBe("");
    expect(await readLimitedBody(request("x".repeat(INQUIRY_BODY_MAX_BYTES)))).toBe("x".repeat(INQUIRY_BODY_MAX_BYTES));
    expect(await readLimitedBody(request("x".repeat(INQUIRY_BODY_MAX_BYTES + 1)))).toBeNull();
  });
  it("is refused before it is read when it says how large it is, and while it is read when it does not", async () => {
    const declared = request("pequeno", { "content-length": String(INQUIRY_BODY_MAX_BYTES + 1) });
    expect(await readLimitedBody(declared)).toBeNull();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let n = 0; n < 40; n++) controller.enqueue(new TextEncoder().encode("x".repeat(1000)));
        controller.close();
      },
    });
    expect(await readLimitedBody(new Request("https://example.test/x", { method: "POST", body: stream, duplex: "half" } as RequestInit))).toBeNull();
  });
  it("keeps the accents of what was written", async () => {
    expect(await readLimitedBody(request("mensagem=Olá, preciso de ajuda"))).toBe("mensagem=Olá, preciso de ajuda");
  });
});

describe("the answer pages", () => {
  it("are a whole page, with what is said escaped and a link back", () => {
    const html = inquiryPageHtml({ title: "Confira <o formulário>", message: 'Escreva "tudo" & mais', back: { href: "../../x?a=1&b=2", label: "Voltar" } });
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("&lt;o formulário&gt;");
    expect(html).toContain("&quot;tudo&quot; &amp; mais");
    expect(html).toContain('href="../../x?a=1&amp;b=2"');
    expect(html).not.toContain("<script");
    expect(html).toContain('name="robots" content="noindex"');
  });
});

describe("the contact form block", () => {
  const node = (over: Partial<BlockOf<"contactForm">> = {}) => ({ ...(emptyBlock("contactForm", "f1") as BlockOf<"contactForm">), ...over });
  const site = (blocks: SiteContent["blocks"]): SiteContent => ({
    schemaVersion: 3,
    title: "Marina Treinos",
    description: "",
    contact: { whatsapp: "(11) 91234-5678", email: "", instagram: "" },
    theme: { accent: "blue", mode: "light", width: "narrow" },
    blocks,
  });
  it("is a block of the library with a title, a line above the fields and a button, and it is named", () => {
    expect(emptyBlock("contactForm", "f1")).toEqual({ id: "f1", type: "contactForm", eyebrow: "", heading: "", text: "", buttonLabel: "Enviar mensagem" });
    expect(BLOCK_LABEL.contactForm).toBe("Formulário de contato");
    expect(catalogueItem("contactForm")).toMatchObject({ group: "section", label: "Formulário de contato" });
    expect(catalogueItem("contactForm")!.create().type).toBe("contactForm");
    expect(nodeText(node({ heading: "Escreva para mim" }))).toBe("Escreva para mim");
  });
  it("is part of a document the server accepts, with no field of its own beyond those, and not with an unknown one", () => {
    expect(safeParseContent(site([node()])).success).toBe(true);
    expect(safeParseContent(site([{ ...node(), channel: "whatsapp" } as never])).success).toBe(false);
    expect(safeParseContent(site([{ ...node(), buttonLabel: "x".repeat(41) } as never])).success).toBe(false);
  });
  it("warns, when publishing, about a button with no text and about a site that does not receive messages, and never stops the publication", () => {
    expect(publishIssues(site([node()]), new Set())).toEqual([]);
    expect(publishIssues(site([node()]), new Set(), null, { inquiriesOpen: true })).toEqual([]);
    const off = publishIssues(site([node()]), new Set(), null, { inquiriesOpen: false });
    expect(off).toHaveLength(1);
    expect(off[0]).toMatchObject({ severity: "warning", blockId: "f1" });
    expect(off[0].message).toMatch(/desligado/);
    const noButton = publishIssues(site([node({ buttonLabel: "" })]), new Set());
    expect(noButton).toHaveLength(1);
    expect(noButton[0].message).toMatch(/botão de enviar/);
    expect(publishIssues(site([node({ buttonLabel: "" })]), new Set(), null, { inquiriesOpen: false }).every((issue) => issue.severity === "warning")).toBe(true);
  });
  it("has an address to be sent to that depends on the page it is on", () => {
    expect(publicFormUrl("marina", "home")).toBe("./marina/m/contato");
    expect(publicFormUrl("marina", "page")).toBe("./m/contato");
  });

  const open: PublicForm = { action: "./marina/m/contato", page: "planos", noticeUrl: NOTICE };
  const render = (content: SiteContent, forms?: PublicForm | null, edit?: EditHooks) => renderToStaticMarkup(createElement(SiteRenderer, { content, forms, edit }));
  it("is a plain form on an open page: the fields of the tool, the bait out of reach, the notice linked, the page it is on and no script", () => {
    const html = render(site([node({ heading: "Escreva para mim", text: "Respondo em breve" })]), open);
    expect(html).toMatch(/<form class="site-form" action="\.\/marina\/m\/contato" method="post">/);
    expect(html).toContain('name="nome"');
    expect(html).toContain('name="contato"');
    expect(html).toContain('name="mensagem"');
    expect(html).toContain('name="aceite"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('name="pagina" value="planos"');
    expect(html).toContain('name="empresa_extra"');
    expect(html).toMatch(/class="site-form-bait"[^>]*aria-hidden="true"/);
    // The link to the notice itself (the footer of the page has its own links with the same attribute).
    expect(html).toContain(`<a href="${NOTICE}" target="_blank" rel="noopener noreferrer">aviso de privacidade</a>`);
    expect(html).toContain("Escreva para mim");
    expect(html).toContain("Enviar mensagem");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("disabled");
    expect(html).not.toMatch(/<fieldset[^>]*disabled/);
    expect(html).not.toContain("Amostra");
  });
  it("is not on a published page whose form is closed", () => {
    const html = render(site([node({ heading: "Escreva para mim" })]), null);
    expect(html).not.toContain("<form");
    expect(html).not.toContain("Escreva para mim");
    expect(html).not.toContain('name="nome"');
  });
  it("is a sample with the fields turned off in the preview and in the editor: nothing is sent from there", () => {
    const preview = render(site([node({ heading: "Escreva para mim" })]));
    expect(preview).toMatch(/<fieldset class="site-form-fields" disabled="">/);
    expect(preview).toMatch(/<button type="submit" class="button primary" disabled="">/);
    expect(preview).toContain("Amostra");
    expect(preview).not.toContain('action="');
    expect(preview).not.toContain('name="pagina"');
    expect(preview).not.toContain('name="empresa_extra"');
    expect(preview).not.toContain(NOTICE);
    const editing = render(site([node()]), undefined, { text: (field) => createElement("span", null, field.value || field.placeholder) });
    expect(editing).toContain("Amostra");
    expect(editing).toContain("site-button-stand-in");
    expect(editing).not.toContain("type=\"submit\"");
  });
  it("escapes what the page says", () => {
    const html = render(site([node({ heading: "<img src=x onerror=alert(1)>", text: "a & b" })]), open);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});

describe("the form of a published page", () => {
  const document = (): SiteContent => ({
    schemaVersion: 3,
    title: "Marina Treinos",
    description: "",
    contact: { whatsapp: "", email: "", instagram: "" },
    theme: { accent: "blue", mode: "light", width: "narrow" },
    blocks: [{ ...(emptyBlock("contactForm", "f1") as BlockOf<"contactForm">) }],
    pages: [{ id: "p1", slug: "planos", title: "Planos", description: "", blocks: [{ ...(emptyBlock("contactForm", "f2") as BlockOf<"contactForm">) }] }],
  });
  const site = (over: Partial<PublicSite> = {}): PublicSite => ({ slug: "marina", number: 1, publishedAt: "2026-10-29T12:00:00.000Z", content: document(), images: {}, inquiriesOpen: true, ...over });
  const OPEN = { open: true, noticeUrl: NOTICE } as const;
  const CLOSED = { open: false, why: "off" } as const;
  it("is open only when the environment opened the public forms AND the site turned on its own switch", () => {
    expect(publicFormOf(site(), "home", OPEN)).not.toBeNull();
    expect(publicFormOf(site({ inquiriesOpen: false }), "home", OPEN)).toBeNull();
    expect(publicFormOf(site(), "home", CLOSED)).toBeNull();
    expect(publicFormOf(site(), "home", { open: false, why: "no-notice" })).toBeNull();
    expect(publicFormOf(site({ inquiriesOpen: false }), "home", CLOSED)).toBeNull();
  });
  it("is sent from the home page and from another page by the address that works from there, and says which page it is on", () => {
    expect(publicFormOf(site(), "home", OPEN)).toEqual({ action: "./marina/m/contato", page: "", noticeUrl: NOTICE });
    expect(publicFormOf(site(), "p1", OPEN)).toEqual({ action: "./m/contato", page: "planos", noticeUrl: NOTICE });
  });
});
