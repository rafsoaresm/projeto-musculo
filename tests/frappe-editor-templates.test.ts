import { describe, expect, it } from "vitest";
import { STANDARD_TEMPLATES } from "@/modules/frappe-editor/block-templates.generated";
import { standardTemplates } from "@/modules/frappe-editor/standard-templates";
import { renderBlocks } from "@/modules/frappe-site/render";
import { urlContext } from "@/modules/frappe-site/urls";

const url = urlContext("studio", 0);
// The forms of the public pages are drawn only where the site opened them; these are drawn as an open site draws them.
const forms = { route: "contato", send: { action: "../site/studio/m/contato", noticeUrl: "https://example.test/aviso" } };
const draw = (block: string) => renderBlocks({ blocks: block, component: () => null, fontToken: () => null, url, forms, code: { src: (index: number) => `../site/studio/m/codigo/page-1/${index}` } });

describe("the templates that come with the editor", () => {
  it("are the ones of Frappe Builder that a public page can show: navbars, hero sections, footer, testimonial, forms, the basic blocks, and the one that holds free code", () => {
    expect(STANDARD_TEMPLATES.map((template) => template.id)).toEqual([
      "blockquote", "button", "embed", "footer_1", "form_1", "form_2", "form_3", "heading", "hero_1", "hero_2", "label", "navbar_1", "navbar_2", "paragraph", "quick_grid", "quick_stack", "testimonial_1", "text_link",
    ]);
    // the theme switcher needs a script of the page itself, the video points to a file of another site, and the YouTube one gets its address from a script
    // of the block that the public page does not run (the video would play in the editor and be an empty box on the site): not offered
    for (const left of ["video", "theme_switcher", "youtube"]) expect(STANDARD_TEMPLATES.map((template) => template.id)).not.toContain(left);
  });

  it("are listed as the editor reads them, with the picture under the mount path, and each tree of blocks is valid JSON with a root", () => {
    const docs = standardTemplates("/treinador/frappe-editor/");
    expect(docs).toHaveLength(18);
    for (const doc of docs) {
      expect(doc).toMatchObject({ doctype: "Block Template", docstatus: 0 });
      expect(String(doc.name).length).toBeGreaterThan(0);
      expect(doc.preview).toMatch(/^\/treinador\/frappe-editor\/templates\/[a-z0-9_]+\.png$/);
      expect(() => JSON.parse(String(doc.block))).not.toThrow();
    }
    expect(docs.find((doc) => doc.name === "Navbar 1")).toMatchObject({ category: "Structure" });
  });

  it("draw on the public page with their drawings (logos and icons are inline SVG) and without anything that runs or comes from another site", () => {
    for (const template of STANDARD_TEMPLATES) {
      const out = draw(template.block);
      // The newsletter has only an e-mail: nothing to call the person by, so it is not drawn (the panel of Meu Site says what it lacks).
      if (template.id === "form_2") {
        expect(out.body).toBe("<body></body>");
        expect(out.forms[0]!.problems).toEqual(["Falta o campo do nome: um campo de texto."]);
        continue;
      }
      // the "HTML" template holds only the line that asks the person to paste something: that is text, not code, until a script or a style is pasted
      if (template.id === "embed") {
        expect(out.codeBlocks).toEqual([]);
        expect(out.body).not.toContain("<iframe");
        expect(out.body).toContain("Paste HTML or double click to edit");
        continue;
      }
      expect(out.body.length, template.id).toBeGreaterThan(20);
      expect(out.body, template.id).not.toMatch(/<script|<iframe|onclick|onload|javascript:|https?:\/\/[^"' )]*\.(js|css)/i);
      expect(out.truncated, template.id).toBe(false);
    }
    const navbar = draw(STANDARD_TEMPLATES.find((template) => template.id === "navbar_1")!.block).body;
    expect(navbar).toContain("<svg");
    expect(navbar).toContain("<nav");
    const footer = draw(STANDARD_TEMPLATES.find((template) => template.id === "footer_1")!.block).body;
    expect(footer).toContain("<footer");
    // what a person pastes into the "Embed" template is code: the page holds only the box and the address of the frame, and the code is served apart
    const embed = STANDARD_TEMPLATES.find((template) => template.id === "embed")!;
    const pasted = JSON.parse(embed.block) as Record<string, unknown>;
    pasted.innerHTML = '<iframe src="https://www.youtube.com/embed/abc" width="560" height="315"></iframe>';
    const video = draw(JSON.stringify(pasted));
    expect(video.body).toMatch(/<iframe src="\.\.\/site\/studio\/m\/codigo\/page-1\/0" [^>]*sandbox="allow-scripts"/);
    expect(video.body).not.toContain("youtube");
    expect(video.codeBlocks).toHaveLength(1);
    expect(video.codeBlocks[0]!.external).toBe(true);
  });
});
