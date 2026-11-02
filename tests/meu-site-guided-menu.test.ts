import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HOME, MAX_MENU_LINKS, siteContent, type SiteContent } from "@/modules/meu-site/contracts";
import { kitContent } from "@/modules/meu-site/site-kits";
import { addMenuLink, moveMenuLink, pruneMenu, removeMenuLink, withHeaderCta, withMenuAnchor, withMenuLabel } from "@/modules/meu-site/guided-menu";
import { removeSection } from "@/modules/meu-site/guided-sections";
import { SiteRenderer } from "@/modules/meu-site/renderer";
import { siteNav } from "@/modules/meu-site/site-nav";
import { anchorDomId } from "@/modules/meu-site/site-css";

const base = { ...kitContent("personal", "Marina"), pages: [] } as SiteContent;
const [first, second] = base.blocks;
const render = (content: SiteContent, edit = false) =>
  renderToStaticMarkup(
    createElement(SiteRenderer, {
      content,
      images: () => null,
      nav: siteNav(content, HOME, (_id, slug) => (slug ? `/s/x/${slug}` : "/s/x")),
      ...(edit ? { edit: { text: (field: { value: string }) => field.value } as never } : {}),
    }),
  );

describe("the header's links to sections and its WhatsApp button", () => {
  it("adds, renames, points, moves and takes out links, only to sections of the home page, and keeps a name", () => {
    let content = addMenuLink(base, first!.id, "Início");
    content = addMenuLink(content, second!.id, "Como funciona");
    expect(content.menu).toEqual([
      { label: "Início", anchor: first!.id },
      { label: "Como funciona", anchor: second!.id },
    ]);
    expect(addMenuLink(content, "nada", "X")).toBe(content);
    // A name being typed may be empty for a moment: the link stays, and the page leaves it out until it has one.
    const unnamed = withMenuLabel(content, 0, "");
    expect(unnamed.menu![0]!.label).toBe("");
    expect(() => siteContent.parse(unnamed)).not.toThrow();
    expect(render(unnamed)).not.toContain(`>Início</a></li><li><a class="site-menu-link" href="#${anchorDomId(first!.id)}"`);
    expect(withMenuLabel(content, 0, "Topo").menu![0]!.label).toBe("Topo");
    expect(withMenuAnchor(content, 0, second!.id).menu![0]!.anchor).toBe(second!.id);
    expect(withMenuAnchor(content, 0, "nada")).toBe(content);
    expect(moveMenuLink(content, 1, -1).menu!.map((link) => link.label)).toEqual(["Como funciona", "Início"]);
    expect(moveMenuLink(content, 0, -1)).toBe(content);
    expect("menu" in removeMenuLink(removeMenuLink(content, 0), 0)).toBe(false);
    expect(() => siteContent.parse(content)).not.toThrow();
    let full = base;
    for (let i = 0; i < MAX_MENU_LINKS + 2; i++) full = addMenuLink(full, first!.id, `L${i}`);
    expect(full.menu).toHaveLength(MAX_MENU_LINKS);
  });
  it("loses a link when its section is deleted", () => {
    const content = addMenuLink(base, second!.id, "Como funciona");
    expect(removeSection(content, HOME, second!.id).menu).toBeUndefined();
    expect(pruneMenu(content)).toBe(content);
  });
  it("draws the links as anchors of the page and the WhatsApp button with its mark, only with a number on the published page", () => {
    let content = withHeaderCta(addMenuLink(base, second!.id, "Como funciona"), "Falar no WhatsApp");
    let html = render(content);
    expect(html).toContain(`href="#${anchorDomId(second!.id)}"`);
    expect(html).toContain(`id="${anchorDomId(second!.id)}"`);
    expect(html).not.toContain("site-header-cta");
    content = { ...content, contact: { ...content.contact, whatsapp: "(31) 99999-0000" } };
    html = render(content);
    expect(html).toMatch(/class="button site-whatsapp site-header-cta site-has-icon" href="https:\/\/wa\.me\/5531999990000"/);
    expect(html).toContain('<svg class="site-button-icon"');
    expect(withHeaderCta(content, null).headerCta).toBeUndefined();
    expect(render(withHeaderCta(content, ""))).not.toContain("site-header-cta");
    expect(() => siteContent.parse(content)).not.toThrow();
  });
  it("draws the WhatsApp mark before a button's label, in the editor too", () => {
    const button = { id: "b1", type: "button", label: "Falar no WhatsApp", channel: "whatsapp", icon: "whatsapp" } as unknown as SiteContent["blocks"][number];
    const content = { ...base, contact: { ...base.contact, whatsapp: "31999990000" }, blocks: [button] } as SiteContent;
    expect(siteContent.safeParse(content).success).toBe(true);
    expect(siteContent.safeParse({ ...content, blocks: [{ ...button, icon: "phone" }] }).success).toBe(false);
    expect(render(content)).toMatch(/site-has-icon[^>]*><svg class="site-button-icon"/);
    expect(render(content, true)).toContain('<svg class="site-button-icon"');
  });
});

describe("a link to a part with nothing to show", () => {
  it("is left out of the published page with the part (the header's menu and a link of the page)", () => {
    const empty = { id: "vazia", type: "box", tag: "section", children: [{ id: "t", type: "heading", level: 2, text: "" }] } as unknown as SiteContent["blocks"][number];
    const link = { id: "l", type: "link", label: "Ir", anchor: "vazia" } as unknown as SiteContent["blocks"][number];
    const content = addMenuLink({ ...base, blocks: [link, ...base.blocks, empty] } as SiteContent, "vazia", "Vazia");
    const html = render(content);
    expect(html).not.toContain(`#${anchorDomId("vazia")}`);
    expect(html).not.toContain(">Vazia<");
    // While the site is being made it is all there.
    expect(render(content, true)).toContain(">Vazia<");
  });
});
