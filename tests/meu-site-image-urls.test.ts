import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  editorImageUrl,
  libraryCssImages,
  libraryImages,
  publicCssImages,
  publicImages,
  publicImageUrl,
  publicSheetImageUrl,
  publicStyleUrl,
} from "@/modules/meu-site/image-urls";

// The mount path is decided by the platform ("/app" on Webflow Cloud), when it builds, and the server cannot read it from a
// variable of this repository. What the server writes must therefore land on the right place under ANY mount path.
const MOUNTS = ["", "/app", "/treinador", "/a/b"];
const origin = "https://example.test";
const library = [{ id: "a-1", width: 800, height: 600 }];
const images = { "a-1": { width: 800, height: 600 } };

describe("addresses the server writes for the published page", () => {
  for (const mount of MOUNTS) {
    describe(`mounted at "${mount}"`, () => {
      const page = `${origin}${mount}/s/marina`;
      const sheet = `${origin}${mount}/s/marina/estilo.css`;
      it("an image of the page lands on the image route of the same mount", () => {
        const src = publicImages("marina", images)("a-1")!.src;
        expect(new URL(src, page).href).toBe(`${origin}${mount}/s/marina/m/a-1`);
      });
      it("the stylesheet of the page lands on the stylesheet route of the same mount", () => {
        expect(new URL(publicStyleUrl("marina", 3), page).href).toBe(`${origin}${mount}/s/marina/estilo.css?v=3`);
      });
      it("a background image in the sheet lands on the image route of the same mount", () => {
        const url = publicCssImages(images).imageUrl("a-1")!;
        expect(new URL(url, sheet).href).toBe(`${origin}${mount}/s/marina/m/a-1`);
      });
      it("an image in the preview lands on the editor's image route of the same mount", () => {
        const preview = `${origin}${mount}/profissional/meu-site/previa`;
        expect(new URL(libraryImages(null, library)("a-1")!.src, preview).href).toBe(`${origin}${mount}/profissional/meu-site/imagens/a-1`);
        expect(new URL(libraryCssImages(null, library).imageUrl("a-1")!, preview).href).toBe(`${origin}${mount}/profissional/meu-site/imagens/a-1`);
      });
    });
  }
  it("a slug that looks like the scheme of an address is still a path on the same origin", () => {
    const resolved = new URL(publicImageUrl("javascript:x", "a-1"), `${origin}/app/s/javascript:x`);
    expect(resolved.origin).toBe(origin);
    expect(new URL(publicSheetImageUrl("a-1"), `${origin}/app/s/x/estilo.css`).origin).toBe(origin);
  });
  it("shows nothing for an image that is not there", () => {
    expect(publicImages("marina", images)("gone")).toBeNull();
    expect(publicCssImages(images).imageUrl("gone")).toBeNull();
    expect(libraryImages(null, library)("gone")).toBeNull();
    expect(libraryCssImages(null, library).imageUrl("gone")).toBeNull();
  });
  it("the editor, which runs in the browser, builds absolute addresses from the mount path it reads from the address bar", () => {
    expect(editorImageUrl("/app", "a-1")).toBe("/app/profissional/meu-site/imagens/a-1");
    expect(libraryImages("/app", library)("a-1")!.src).toBe("/app/profissional/meu-site/imagens/a-1");
    expect(libraryCssImages("", library).imageUrl("a-1")).toBe("/profissional/meu-site/imagens/a-1");
  });
});

describe("what the server renders does not depend on the build's own mount variable", () => {
  it("the published page, its stylesheet and the preview never read NEXT_PUBLIC_BASE_PATH", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name)) files.push(path);
      }
    };
    walk("src/app/s");
    walk("src/app/profissional/meu-site/previa");
    walk("src/modules/meu-site");
    const offenders = files.filter((file) => /NEXT_PUBLIC_BASE_PATH|__NEXT_ROUTER_BASEPATH/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
