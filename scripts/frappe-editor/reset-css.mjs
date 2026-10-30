/**
 * The base styles of the pages of Frappe Builder (its reset.css), written as a module of this repository so that the public page carries them
 * inline. Its font faces are left out: the fonts a page may use are the ones that ship with the tool (see src/modules/frappe-site/fonts.ts).
 * Run by build.mjs; alone: `node scripts/frappe-editor/reset-css.mjs <checkout of the builder repository>`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const TARGET = path.join(ROOT, "src", "modules", "frappe-site", "reset.generated.ts");

export function writeResetCss(builderDir) {
  const css = fs.readFileSync(path.join(builderDir, "builder", "public", "reset.css"), "utf8").replace(/@font-face\{[^}]*\}/g, "");
  fs.mkdirSync(path.dirname(TARGET), { recursive: true });
  fs.writeFileSync(
    TARGET,
    `// Written by scripts/frappe-editor/reset-css.mjs; do not edit.\n/** The base styles of the editor's pages (its reset.css, without its font faces). */\nexport const RESET_CSS = ${JSON.stringify(css)};\n`,
  );
  return path.relative(ROOT, TARGET);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) throw new Error("usage: node scripts/frappe-editor/reset-css.mjs <checkout of the builder repository>");
  console.log(`written: ${writeResetCss(path.resolve(dir))}`);
}
