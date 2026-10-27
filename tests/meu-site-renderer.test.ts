import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { SiteRenderer } from "@/modules/meu-site/renderer";
import { starterContent, type SiteContent } from "@/modules/meu-site/contracts";

const render = (content: SiteContent) => renderToStaticMarkup(createElement(SiteRenderer, { content }));

const page = (over: Partial<SiteContent> = {}): SiteContent => ({
  schemaVersion: 1,
  title: "Marina Treinos",
  description: "",
  contact: { whatsapp: "(11) 91234-5678", email: "marina@example.test", instagram: "@marina.treinos" },
  blocks: [
    { id: "h", type: "hero", heading: "Treino sob medida", subheading: "Com acompanhamento", buttonLabel: "Falar comigo", buttonChannel: "whatsapp" },
    { id: "t", type: "text", heading: "Sobre", text: "Primeira linha\nSegunda linha" },
    { id: "s", type: "services", heading: "Serviços", intro: "", serviceIds: ["x"], items: [{ name: "Consultoria online", description: "Plano mensal", delivery: "ONLINE" }] },
    { id: "f", type: "faq", heading: "Dúvidas", items: [{ question: "Atende online?", answer: "Sim." }, { question: "", answer: "sem pergunta" }] },
    { id: "c", type: "cta", heading: "Vamos conversar", text: "", buttonLabel: "Escrever por e-mail", buttonChannel: "email" },
  ],
  ...over,
});

describe("the public page", () => {
  it("shows the blocks as text, with one h1, the services written into the release and the questions that are complete", () => {
    const html = render(page());
    expect(html).toContain("<h1>Treino sob medida</h1>");
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain("<h3>Consultoria online</h3>");
    expect(html).toContain('<p class="site-delivery">Online</p>');
    expect(html).not.toContain("Presencial");
    expect(html).toContain("<summary>Atende online?</summary>");
    expect(html).not.toContain("sem pergunta");
  });
  it("makes the links only from the contact fields: wa.me, mailto and instagram, with no opener on the external ones", () => {
    const html = render(page());
    expect(html).toContain('href="https://wa.me/5511912345678"');
    expect(html).toContain('href="mailto:marina@example.test"');
    expect(html).toContain('href="https://www.instagram.com/marina.treinos/"');
    for (const tag of html.match(/<a [^>]*href="https:[^>]*>/g) ?? []) expect(tag).toContain('rel="noopener noreferrer"');
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    expect(hrefs.every((h) => h.startsWith("https://wa.me/") || h.startsWith("https://www.instagram.com/") || h.startsWith("mailto:"))).toBe(true);
  });
  it("prints markup, scripts and event handlers typed into any field as plain, escaped text", () => {
    const evil = `<script>alert(1)</script><img src=x onerror="alert(2)">`;
    const html = render(
      page({
        title: evil,
        blocks: [
          { id: "h", type: "hero", heading: evil, subheading: evil, buttonLabel: evil, buttonChannel: "whatsapp" },
          { id: "t", type: "text", heading: evil, text: evil },
          { id: "s", type: "services", heading: evil, intro: evil, serviceIds: [], items: [{ name: evil, description: evil, delivery: "HYBRID" }] },
          { id: "f", type: "faq", heading: evil, items: [{ question: evil, answer: evil }] },
          { id: "c", type: "cta", heading: evil, text: evil, buttonLabel: evil, buttonChannel: "email" },
        ],
      }),
    );
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/\sonerror\s*=\s*"/i);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
  it("makes no link out of a contact that is not a phone number, an address or a handle", () => {
    const html = render(page({ contact: { whatsapp: "javascript:alert(1)", email: "https://evil.test", instagram: "https://evil.test/x" } }));
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("evil.test");
    expect(html).not.toContain("<footer");
    expect(html).not.toContain("Falar comigo");
    expect(html).not.toContain("Escrever por e-mail");
  });
  it("has nothing that runs or loads from elsewhere: no script, no iframe, no form, no image, no style tag", () => {
    const html = render(page());
    for (const forbidden of ["<script", "<iframe", "<form", "<img", "<style", "<link", "<video", "<audio", "<object", "<embed"]) expect(html, forbidden).not.toContain(forbidden);
  });
  it("falls back to the title as the h1 when there is no highlight, and shows a starter page without inventing anything", () => {
    const noHero = render(page({ blocks: [{ id: "t", type: "text", heading: "", text: "Só um texto" }] }));
    expect(noHero).toContain('<h1 class="site-brand">Marina Treinos</h1>');
    const starter = render(starterContent("Marina"));
    expect(starter).toContain("<h1>Marina</h1>");
    expect(starter).not.toContain("<a ");
  });
});
