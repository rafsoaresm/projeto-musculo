/**
 * The fonts of a public page. A family a block asks for that ships with the tool (fonts.generated.ts: open fonts carried by this repository)
 * is written as an @font-face from the site's own files, and the browser fetches a face only when text uses it. Any other family is not
 * fetched from anywhere: the page falls back to the next family of the block's own list (`'Bebas Neue', Impact`).
 */
import { FONT_CATALOG, type FontFamily } from "./fonts.generated";
import type { FontUse } from "./render";

const BY_NAME = new Map(FONT_CATALOG.map((family) => [family.family.toLowerCase(), family]));

export const shippedFamily = (name: string): FontFamily | undefined => BY_NAME.get(name.trim().toLowerCase());

/** The @font-face rules for the families that blocks use, with their files written from the page (`mountRoot` goes up to the mount path). */
export function fontFaces(used: Map<string, FontUse>, mountRoot: string): string {
  const rules: string[] = [];
  const done = new Set<string>();
  for (const name of used.keys()) {
    const family = shippedFamily(name);
    if (!family || done.has(family.family)) continue;
    done.add(family.family);
    for (const face of family.faces) {
      rules.push(
        `@font-face { font-family: "${family.family}"; font-style: ${face.style}; font-weight: ${face.weight}; font-display: swap; src: url("${mountRoot}frappe-editor/fonts/${face.file}") format("woff2"); }`,
      );
    }
  }
  return rules.join("\n");
}
