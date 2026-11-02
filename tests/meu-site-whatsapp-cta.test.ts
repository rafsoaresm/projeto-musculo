import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WHATSAPP_MESSAGE_MAX, publishIssues, safeParseContent, whatsappUrl, type SiteContent } from "@/modules/meu-site/contracts";
import { WHATSAPP_CTA_NONE, withWhatsAppCta } from "@/modules/meu-site/guided-menu";
import { MOBILE_PATTERN, parseWhatsAppLead, readMobile } from "@/modules/meu-site/inquiries";
import { SITE_MODELS_V1 } from "@/modules/meu-site/models";
import { SiteRenderer, whatsappDestination, type PublicForm } from "@/modules/meu-site/renderer";

const NOTICE = "https://example.test/aviso-de-privacidade";
const MESSAGE = "Olá! Gostaria de conhecer seus treinos.";
const LIVE: PublicForm = { action: "./marina/m/contato", whatsappAction: "./marina/m/whatsapp", page: "", noticeUrl: NOTICE };
const form = (fields: Record<string, string>) => new URLSearchParams(fields);
const GOOD = { nome: "Ana Souza", celular: "(11) 98765-4321", objetivo: "Ganhar força", aceite: "on" };

const site = (cta: SiteContent["whatsappCta"] | null = { message: MESSAGE, askFirst: true, askGoal: true }, whatsapp = "(11) 91234-5678"): SiteContent => ({
  schemaVersion: 3,
  title: "Marina Treinos",
  description: "",
  contact: { whatsapp, email: "", instagram: "" },
  theme: { accent: "blue", mode: "light", width: "narrow" },
  blocks: [
    { id: "b1", type: "button", label: "Falar no WhatsApp", channel: "whatsapp", icon: "whatsapp" },
    { id: "b2", type: "button", label: "Escrever um e-mail", channel: "email" },
  ],
  headerCta: { label: "Falar no WhatsApp" },
  ...(cta ? { whatsappCta: cta } : {}),
});
const render = (content: SiteContent, forms?: PublicForm | null) => renderToStaticMarkup(createElement(SiteRenderer, { content, forms }));

describe("the WhatsApp address", () => {
  it("carries the professional's opening message, encoded whole, and nothing when there is none", () => {
    expect(whatsappUrl("(11) 91234-5678")).toBe("https://wa.me/5511912345678");
    expect(whatsappUrl("(11) 91234-5678", "  ")).toBe("https://wa.me/5511912345678");
    expect(whatsappUrl("(11) 91234-5678", MESSAGE)).toBe(`https://wa.me/5511912345678?text=${encodeURIComponent(MESSAGE)}`);
    expect(whatsappUrl("11912345678", "a&b=c #d?e")).toBe("https://wa.me/5511912345678?text=a%26b%3Dc%20%23d%3Fe");
    expect(whatsappUrl("123", MESSAGE)).toBeNull();
  });
  it("is part of the document only as a short plain text, with the two switches", () => {
    expect(safeParseContent(site()).success).toBe(true);
    expect(safeParseContent({ ...site(), whatsappCta: { message: "x".repeat(WHATSAPP_MESSAGE_MAX + 1), askFirst: true, askGoal: true } }).success).toBe(false);
    expect(safeParseContent({ ...site(), whatsappCta: { message: "", askFirst: true } }).success).toBe(false);
    expect(safeParseContent({ ...site(), whatsappCta: { message: "", askFirst: true, askGoal: false, extra: 1 } }).success).toBe(false);
    expect(safeParseContent(site(null)).success).toBe(true);
  });
});

describe("what the form before WhatsApp takes", () => {
  it("a name, a mobile with its DDD and, when the site asks, a goal; the box of the notice must be ticked", () => {
    expect(parseWhatsAppLead(form(GOOD), true)).toEqual({ kind: "ok", value: { name: "Ana Souza", phone: "(11) 98765-4321", goal: "Ganhar força", page: "" } });
    expect(parseWhatsAppLead(form({ ...GOOD, objetivo: "  " }), true)).toMatchObject({ kind: "ok", value: { goal: null } });
    expect(parseWhatsAppLead(form({ ...GOOD, objetivo: "x".repeat(500) }), false)).toMatchObject({ kind: "ok", value: { goal: null } });
    expect(parseWhatsAppLead(form({ ...GOOD, pagina: "planos" }), true)).toMatchObject({ kind: "ok", value: { page: "planos" } });
    expect(parseWhatsAppLead(form({ ...GOOD, pagina: "../x" }), true)).toMatchObject({ kind: "ok", value: { page: "" } });
  });
  it("says the first thing wrong", () => {
    expect(parseWhatsAppLead(form({ ...GOOD, nome: "A" }), true)).toEqual({ kind: "invalid", field: "name" });
    expect(parseWhatsAppLead(form({ ...GOOD, nome: "a".repeat(101) }), true)).toEqual({ kind: "invalid", field: "name" });
    expect(parseWhatsAppLead(form({ ...GOOD, celular: "ana@example.test" }), true)).toEqual({ kind: "invalid", field: "phone" });
    expect(parseWhatsAppLead(form({ ...GOOD, objetivo: "x".repeat(161) }), true)).toEqual({ kind: "invalid", field: "goal" });
    expect(parseWhatsAppLead(form({ ...GOOD, objetivo: "a​b" }), true)).toEqual({ kind: "invalid", field: "goal" });
    expect(parseWhatsAppLead(form({ ...GOOD, aceite: "" }), true)).toEqual({ kind: "invalid", field: "consent" });
    expect(parseWhatsAppLead(form({ ...GOOD, aceite: "true" }), true)).toEqual({ kind: "invalid", field: "consent" });
  });
  it("is a program when the bait is filled", () => {
    expect(parseWhatsAppLead(form({ ...GOOD, empresa_extra: "x" }), true)).toEqual({ kind: "bot" });
  });
  it("takes a Brazilian mobile only: 11 digits with the DDD and the 9, with or without the 55", () => {
    for (const ok of ["(11) 98765-4321", "11987654321", "+55 11 98765-4321", "5521987654321", "(99) 91234-5678"]) expect(readMobile(ok), ok).toBe(ok);
    for (const bad of ["(11) 3456-7890", "1187654321", "(01) 98765-4321", "(10) 98765-4321", "98765-4321", "11 98765-43210", "(11) 88765-4321", "abc", "", "11 9876​5-4321"]) expect(readMobile(bad), bad).toBeNull();
  });
});

describe("where the WhatsApp buttons go", () => {
  it("to the form of the page when the site asks first and the page's forms are open; straight to WhatsApp anywhere else", () => {
    const direct = `https://wa.me/5511912345678?text=${encodeURIComponent(MESSAGE)}`;
    expect(whatsappDestination(site(), LIVE, "")).toEqual({ href: "#site-whatsapp-form", external: false });
    expect(whatsappDestination(site(), LIVE, "f1-")).toEqual({ href: "#f1-site-whatsapp-form", external: false });
    expect(whatsappDestination(site(), null, "")).toEqual({ href: direct, external: true });
    expect(whatsappDestination(site(), undefined, "")).toEqual({ href: direct, external: true });
    expect(whatsappDestination(site({ message: MESSAGE, askFirst: false, askGoal: false }), LIVE, "")).toEqual({ href: direct, external: true });
    expect(whatsappDestination(site(null), LIVE, "")).toEqual({ href: "https://wa.me/5511912345678", external: true });
    expect(whatsappDestination(site(undefined, ""), LIVE, "")).toBeNull();
  });
  it("on a published page that asks: every WhatsApp link opens the form, which is on the page once, sent to this app, with no script", () => {
    const html = render(site(), LIVE);
    expect(html.match(/href="#site-whatsapp-form"/g)).toHaveLength(3); // the button, the header's and the footer's
    expect(html).not.toContain("wa.me");
    expect(html.match(/id="site-whatsapp-form"/g)).toHaveLength(1);
    expect(html).toMatch(/<form class="site-form" action="\.\/marina\/m\/whatsapp" method="post">/);
    expect(html).toContain('name="nome"');
    expect(html).toContain('name="celular"');
    expect(html).toContain('name="objetivo"');
    expect(html).toContain('name="empresa_extra"');
    expect(html).toMatch(/<input type="checkbox" required="" name="aceite"\/>/);
    expect(html).toContain(`<a href="${NOTICE}" target="_blank" rel="noopener noreferrer">aviso de privacidade</a>`);
    // Modal for a screen reader only once the script puts the page behind out of reach (it is not on the page without it).
    expect(html).toMatch(/role="dialog" aria-labelledby="site-whatsapp-form-title"/);
    expect(html).not.toContain("aria-modal");
    // The consent says what is kept, the goal included when it is asked; the goal field says not to write health data.
    expect(html).toContain("concordo que o meu nome, o meu celular e o objetivo, se eu escrever, fiquem com este profissional");
    expect(html).toContain("Não escreva dados de saúde aqui.");
    expect(html).toContain(`pattern="${MOBILE_PATTERN.replace(/&/g, "&amp;")}"`);
    expect(html).not.toContain("<script");
  });
  it("without the goal when the site does not ask it, and the consent says only the name and the mobile", () => {
    const html = render(site({ message: MESSAGE, askFirst: true, askGoal: false }), LIVE);
    expect(html).not.toContain('name="objetivo"');
    expect(html).toContain("concordo que o meu nome, o meu celular fiquem com este profissional");
  });
  it("makes the contact form of a site that asks first that same form, sent to the WhatsApp address with its own button text", () => {
    const content: SiteContent = { ...site(), blocks: [...site().blocks, { id: "f1", type: "contactForm", eyebrow: "", heading: "Fale comigo", text: "", buttonLabel: "Quero começar" }] };
    const html = render(content, LIVE);
    expect(html.match(/action="\.\/marina\/m\/whatsapp"/g)).toHaveLength(2);
    expect(html).not.toContain('action="./marina/m/contato"');
    expect(html).toContain('id="f1-celular"');
    expect(html).toMatch(/class="button site-whatsapp site-has-icon"><svg[^]*?<\/svg>Quero começar<\/button>/);
    // A site that does not ask keeps the contact form as it was.
    const plain = render({ ...content, whatsappCta: { message: MESSAGE, askFirst: false, askGoal: false } }, LIVE);
    expect(plain).toContain('action="./marina/m/contato"');
    expect(plain).not.toContain("m/whatsapp");
  });
  it("checks the mobile in the browser with the same rule as the server", () => {
    const browser = new RegExp(`^(?:${MOBILE_PATTERN})$`, "v");
    for (const value of ["(11) 98765-4321", "11987654321", "+55 11 98765-4321", "5521987654321", "(99) 91234-5678", "(55) 99999-9999", "55 55 99999-9999", "(11) 3456-7890", "1187654321", "(01) 98765-4321", "(10) 98765-4321", "98765-4321", "11 98765-43210", "(11) 88765-4321", "abc", "31.98888.7777"])
      expect(browser.test(value), value).toBe(readMobile(value) !== null);
  });
  it("on a page whose forms are closed, or a site that does not ask: straight to WhatsApp in a new tab, and no form", () => {
    for (const html of [render(site(), null), render(site({ message: MESSAGE, askFirst: false, askGoal: false }), LIVE), render(site())]) {
      expect(html).not.toContain("site-whatsapp-form");
      expect(html).toContain(`href="https://wa.me/5511912345678?text=${encodeURIComponent(MESSAGE).replace(/'/g, "&#x27;")}" target="_blank" rel="noopener noreferrer"`);
    }
  });
});

describe("in the Editor Guiado", () => {
  it("changes the message and the two switches; the goal goes with the form; back to nothing drops the field", () => {
    const base = site(null);
    const asked = withWhatsAppCta(base, { askFirst: true });
    expect(asked.whatsappCta).toEqual({ message: "", askFirst: true, askGoal: false });
    expect(withWhatsAppCta(asked, { askFirst: true })).toBe(asked);
    const goal = withWhatsAppCta(asked, { askGoal: true });
    expect(goal.whatsappCta).toEqual({ message: "", askFirst: true, askGoal: true });
    expect(withWhatsAppCta(goal, { askFirst: false })).not.toHaveProperty("whatsappCta");
    const written = withWhatsAppCta(base, { message: "Oi!" });
    expect(written.whatsappCta).toEqual({ message: "Oi!", askFirst: false, askGoal: false });
    expect(withWhatsAppCta(written, { askGoal: true }).whatsappCta).toEqual({ message: "Oi!", askFirst: false, askGoal: false });
    expect(withWhatsAppCta(base, {})).toBe(base);
    expect(WHATSAPP_CTA_NONE).toEqual({ message: "", askFirst: false, askGoal: false });
  });
  it("starts the four models asking first, with the handoff's opening message and the goal", () => {
    for (const model of SITE_MODELS_V1) {
      for (const mode of ["site", "preview"] as const) {
        const built = model.build("Marina Treinos", mode);
        expect(built.whatsappCta, `${model.key} ${mode}`).toEqual({ message: MESSAGE, askFirst: true, askGoal: true });
        expect(safeParseContent(built).success).toBe(true);
      }
    }
  });
  it("warns before publishing when the header's WhatsApp button has no number to go to", () => {
    const issue = (content: SiteContent) => publishIssues(content, new Set()).filter((entry) => /cabeçalho/.test(entry.message));
    expect(issue(site(undefined, ""))).toHaveLength(1);
    expect(issue(site(undefined, ""))[0]!.severity).toBe("warning");
    expect(issue(site())).toHaveLength(0);
    expect(issue({ ...site(undefined, ""), headerCta: { label: " " } })).toHaveLength(0);
    const form = (content: SiteContent) => publishIssues(content, new Set()).filter((entry) => /formulário antes do WhatsApp/.test(entry.message));
    expect(form({ ...site(undefined, ""), headerCta: undefined })).toHaveLength(1);
    expect(form({ ...site({ message: MESSAGE, askFirst: false, askGoal: false }, ""), headerCta: undefined })).toHaveLength(0);
  });
});
