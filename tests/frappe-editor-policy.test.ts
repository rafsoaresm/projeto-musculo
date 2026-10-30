import { describe, expect, it } from "vitest";
import { editorPolicy, withNonce } from "@/modules/frappe-editor/policy";
import { EDITOR_SHELL } from "@/modules/frappe-editor/shell.generated";

const directives = (policy: string) => Object.fromEntries(policy.split("; ").map((part) => [part.split(" ")[0], part.split(" ").slice(1)]));

describe("what the editor may run and load", () => {
  const policy = directives(editorPolicy("abc123"));

  it("runs scripts only from the app's own files and from the page's inline scripts by nonce: no handler, no javascript: address, no eval", () => {
    expect(policy["script-src"]).toEqual(["'self'", "'nonce-abc123'"]);
    expect(policy["script-src"]).not.toContain("'unsafe-inline'");
    expect(policy["script-src"]).not.toContain("'unsafe-eval'");
    expect(policy["script-src"]).not.toContain("https:");
  });

  it("loads frames, forms, images, fonts, media and requests from the app itself, and nothing of a plugin or a base address", () => {
    for (const name of ["default-src", "connect-src", "form-action"]) expect(policy[name], name).toEqual(["'self'"]);
    expect(policy["frame-src"]).toEqual(["'self'", "blob:"]);
    expect(policy["img-src"]).toEqual(["'self'", "data:", "blob:"]);
    expect(policy["object-src"]).toEqual(["'none'"]);
    expect(policy["base-uri"]).toEqual(["'none'"]);
    expect(policy["frame-ancestors"]).toEqual(["'self'"]);
    for (const [name, sources] of Object.entries(policy)) for (const source of sources) expect(source, name).not.toMatch(/^https?:|^\*$/);
  });

  it("each answer has a nonce of its own, and gives it to every inline script of the page and to no other tag", () => {
    expect(editorPolicy("a")).not.toBe(editorPolicy("b"));
    const page = withNonce('<head><script>one()</script><script type="module" src="x.js"></script><script>two()</script></head>', "n0nce");
    expect(page).toBe('<head><script nonce="n0nce">one()</script><script type="module" src="x.js"></script><script nonce="n0nce">two()</script></head>');
  });

  it("the page of the editor has inline scripts that are all plain tags (so every one of them gets the nonce), and loads nothing from outside", () => {
    expect(EDITOR_SHELL.match(/<script\b[^>]*>/g)).toEqual(["<script>"]);
    expect(withNonce(EDITOR_SHELL, "z").match(/<script\b[^>]*>/g)).toEqual(['<script nonce="z">']);
    expect(EDITOR_SHELL).not.toMatch(/(?:src|href)=["']https?:/i);
    expect(EDITOR_SHELL).not.toMatch(/\son[a-z]+=/i);
  });
});
