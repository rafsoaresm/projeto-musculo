/**
 * The fonts that ship with the site editor. The editor of Frappe Builder offers the whole Google Fonts catalog and loads each font from Google
 * while the page is made and while it is read: a visitor's address would go to a third party. Here the fonts a person can choose are a
 * curated set of open fonts (SIL Open Font License 1.1) carried by this repository, served from the site itself, latin subset (Portuguese
 * included): condensed display fonts for headlines, text fonts, serif and mono. Taken from the Fontsource packages (pinned below) with
 * `npm pack`, so what is committed can be reproduced and checked.
 *
 * Writes public/frappe-editor/fonts/<id>/ (the files and the license of each) and src/modules/frappe-site/fonts.generated.ts (the catalog:
 * the public page writes its @font-face from it, and the editor's page lists the same families). Run by build.mjs; alone:
 * `node scripts/frappe-editor/fonts.mjs`.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = path.join(ROOT, "public", "frappe-editor", "fonts");
const CATALOG_TS = path.join(ROOT, "src", "modules", "frappe-site", "fonts.generated.ts");
const VERSION = "5.3.0";

/** weights: static faces, one file each; range: a variable font, one file for the whole range of weights; italic: its italic file too. */
const FONTS = [
  { id: "bebas-neue", pkg: "@fontsource/bebas-neue", family: "Bebas Neue", group: "Destaque", weights: [400] },
  { id: "anton", pkg: "@fontsource/anton", family: "Anton", group: "Destaque", weights: [400] },
  { id: "oswald", pkg: "@fontsource-variable/oswald", family: "Oswald", group: "Destaque", range: [200, 700] },
  { id: "barlow-condensed", pkg: "@fontsource/barlow-condensed", family: "Barlow Condensed", group: "Destaque", weights: [400, 500, 600, 700, 800] },
  { id: "poppins", pkg: "@fontsource/poppins", family: "Poppins", group: "Texto", weights: [400, 500, 600, 700] },
  { id: "montserrat", pkg: "@fontsource-variable/montserrat", family: "Montserrat", group: "Texto", range: [100, 900] },
  { id: "dm-sans", pkg: "@fontsource-variable/dm-sans", family: "DM Sans", group: "Texto", range: [100, 1000] },
  { id: "roboto", pkg: "@fontsource-variable/roboto", family: "Roboto", group: "Texto", range: [100, 900] },
  { id: "open-sans", pkg: "@fontsource-variable/open-sans", family: "Open Sans", group: "Texto", range: [300, 800] },
  { id: "space-grotesk", pkg: "@fontsource-variable/space-grotesk", family: "Space Grotesk", group: "Texto", range: [300, 700] },
  { id: "manrope", pkg: "@fontsource-variable/manrope", family: "Manrope", group: "Texto", range: [200, 800] },
  { id: "playfair-display", pkg: "@fontsource-variable/playfair-display", family: "Playfair Display", group: "Serifada", range: [400, 900], italic: true },
  { id: "lora", pkg: "@fontsource-variable/lora", family: "Lora", group: "Serifada", range: [400, 700], italic: true },
  { id: "merriweather", pkg: "@fontsource/merriweather", family: "Merriweather", group: "Serifada", weights: [400, 700] },
  { id: "jetbrains-mono", pkg: "@fontsource-variable/jetbrains-mono", family: "JetBrains Mono", group: "Monoespaçada", range: [100, 800] },
];

/** Inter comes with the editor (its own file, kept by build.mjs), as a variable font with its italic. */
const INTER = {
  family: "Inter",
  group: "Texto",
  faces: [
    { weight: "100 900", style: "normal", file: "Inter/Inter.var.woff2" },
    { weight: "100 900", style: "italic", file: "Inter/Inter-Italic.var.woff2" },
  ],
  variants: ["100", "200", "300", "regular", "500", "600", "700", "800", "900", "italic", "700italic"],
};

const variantsOf = (weights, italic) => {
  const names = weights.map((weight) => (weight === 400 ? "regular" : String(weight)));
  return italic ? [...names, ...weights.map((weight) => (weight === 400 ? "italic" : `${weight}italic`))] : names;
};

function fetchPackage(pkg, tmp) {
  const name = execFileSync("npm", ["pack", `${pkg}@${VERSION}`, "--silent"], { cwd: tmp, encoding: "utf8" }).trim().split("\n").pop();
  const dir = path.join(tmp, pkg.replace(/[@/]/g, "_"));
  fs.mkdirSync(dir, { recursive: true });
  execFileSync("tar", ["-xzf", path.join(tmp, name), "-C", dir]);
  return path.join(dir, "package");
}

export function writeFonts() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frappe-fonts-"));
  const catalog = [];
  try {
    for (const font of FONTS) {
      const source = fetchPackage(font.pkg, tmp);
      const target = path.join(OUT, font.id);
      fs.rmSync(target, { recursive: true, force: true });
      fs.mkdirSync(target, { recursive: true });
      const faces = [];
      const take = (name, weight, style) => {
        const from = path.join(source, "files", name);
        if (!fs.existsSync(from)) throw new Error(`${font.pkg}@${VERSION} has no ${name}`);
        fs.copyFileSync(from, path.join(target, name));
        faces.push({ weight, style, file: `${font.id}/${name}` });
      };
      if (font.range) {
        take(`${font.id}-latin-wght-normal.woff2`, `${font.range[0]} ${font.range[1]}`, "normal");
        if (font.italic) take(`${font.id}-latin-wght-italic.woff2`, `${font.range[0]} ${font.range[1]}`, "italic");
      } else for (const weight of font.weights) take(`${font.id}-latin-${weight}-normal.woff2`, String(weight), "normal");
      const license = path.join(source, "LICENSE");
      if (fs.existsSync(license)) fs.copyFileSync(license, path.join(target, "LICENSE"));
      const weights = font.range ? Array.from({ length: (font.range[1] - font.range[0]) / 100 + 1 }, (_, index) => font.range[0] + index * 100) : font.weights;
      catalog.push({ family: font.family, group: font.group, faces, variants: variantsOf(weights, Boolean(font.italic)) });
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  catalog.push(INTER);
  catalog.sort((a, b) => a.family.localeCompare(b.family));
  fs.mkdirSync(path.dirname(CATALOG_TS), { recursive: true });
  fs.writeFileSync(
    CATALOG_TS,
    `// Written by scripts/frappe-editor/fonts.mjs; do not edit.\n` +
      `/** The fonts that ship with the site editor (open fonts, latin subset), by the files in public/frappe-editor/fonts. */\n` +
      `export interface FontFace {\n  /** A weight, or a range of weights for a variable font ("200 700"). */\n  weight: string;\n  style: "normal" | "italic";\n  /** Under public/frappe-editor/fonts. */\n  file: string;\n}\n` +
      `export interface FontFamily {\n  family: string;\n  group: string;\n  faces: FontFace[];\n  /** The variants the editor's font picker lists ("regular", "700", "italic" ...). */\n  variants: string[];\n}\n` +
      `export const FONT_CATALOG: FontFamily[] = ${JSON.stringify(catalog, null, 2)};\n`,
  );
  return { catalog, ts: path.relative(ROOT, CATALOG_TS) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { catalog, ts } = writeFonts();
  console.log(`written: ${catalog.length} families in ${path.relative(ROOT, OUT)} and ${ts}`);
}
