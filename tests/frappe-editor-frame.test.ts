import { describe, expect, it } from "vitest";
import { withEditorFrame } from "@/modules/frappe-editor/frame";
import { withNonce } from "@/modules/frappe-editor/policy";

const shell = '<!DOCTYPE html><html><head><script>window.builder_path = "/treinador/profissional/meu-site/editor";</script></head><body class="x">\n<div id="app"></div>\n</body></html>';

describe("the frame of the Editor Avançado (Figma 10:218)", () => {
  it("puts the title, the trail with the situation and the way back right after the body, before the editor's root", () => {
    const page = withEditorFrame(shell, false);
    expect(page.indexOf('id="tp-editor-bar"')).toBeGreaterThan(page.indexOf('<body class="x">'));
    expect(page.indexOf('id="tp-editor-bar"')).toBeLessThan(page.indexOf('<div id="app">'));
    expect(page).toContain("<strong>Editor Avançado</strong>");
    expect(page).toContain("Frappe Builder / Site profissional / Rascunho");
    expect(withEditorFrame(shell, true)).toContain("Frappe Builder / Site profissional / Publicado");
    expect(page).toContain('Voltar ao Meu Site</a>');
  });

  it("works the way back out of the mount path in the page, and its script gets the nonce like the shell's own", () => {
    const page = withNonce(withEditorFrame(shell, false), "abc");
    expect(page).toContain('builder_path.replace(/\\/editor$/, "")');
    expect(page.match(/<script>/g)).toBeNull();
    expect(page.match(/<script nonce="abc">/g)).toHaveLength(2);
  });
});

describe("the editor in Portuguese (AC19.4)", () => {
  it("fills the editor's own catalog with the translations, as JSON a text cannot break out of", async () => {
    const { withEditorTranslations } = await import("@/modules/frappe-editor/frame");
    const page = withEditorTranslations('<script>window.translated_messages = {};</script>', { Publish: "Publicar", "</script>": "<b>" });
    expect(page).toContain('"Publish":"Publicar"');
    expect(page).not.toContain("</script>\"");
    expect(page.match(/<\/script>/g)).toHaveLength(1);
  });

  it("covers the screens a person goes through first", async () => {
    const { EDITOR_TRANSLATIONS } = await import("@/modules/frappe-editor/translations.generated");
    for (const text of ["All Pages", "New", "Start from scratch", "Publish", "Layers", "Settings", "Folders", "Filter by title or route"]) expect(EDITOR_TRANSLATIONS[text], text).toBeTruthy();
  });
});
