/**
 * The Portuguese of the embedded editor (handoff V4, AC19.4), through the editor's own mechanism: its `__()` reads `window.translated_messages`.
 * The catalog is the editor's official translations (builder/locale/pt.po, then pt_BR.po over it) plus vendor/frappe-builder/pt-BR-extra.json,
 * which covers the strings of the essential screens that the official catalog leaves empty. No line of the editor is changed for this.
 *
 * Writes src/modules/frappe-editor/translations.generated.ts. Run by build.mjs; alone: `node scripts/frappe-editor/translations.mjs <builder dir>`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_TS = path.join(ROOT, "src", "modules", "frappe-editor", "translations.generated.ts");
const EXTRA = path.join(ROOT, "vendor", "frappe-builder", "pt-BR-extra.json");

const unquote = (lines) => lines.map((line) => JSON.parse(line)).join("");

/** msgid → msgstr of a .po file (with `msgctxt`, the key is `msgid:context`, as the editor looks it up); empty translations are left out. */
export function readPo(file) {
  const out = {};
  for (const entry of fs.readFileSync(file, "utf8").split(/\n\s*\n/)) {
    const field = (name) => {
      const match = new RegExp(`^${name} ("(?:[^"\\\\]|\\\\.)*")((?:\\n"(?:[^"\\\\]|\\\\.)*")*)`, "m").exec(entry);
      return match ? unquote([match[1], ...match[2].split("\n").filter(Boolean)]) : null;
    };
    const id = field("msgid");
    const str = field("msgstr");
    if (!id || !str) continue;
    const context = field("msgctxt");
    out[context ? `${id}:${context}` : id] = str;
  }
  return out;
}

export function writeTranslations(builderDir) {
  const locale = path.join(builderDir, "builder", "locale");
  const catalog = { ...readPo(path.join(locale, "pt.po")), ...readPo(path.join(locale, "pt_BR.po")), ...JSON.parse(fs.readFileSync(EXTRA, "utf8")) };
  const sorted = Object.fromEntries(Object.entries(catalog).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  fs.writeFileSync(
    OUT_TS,
    `// Written by scripts/frappe-editor/translations.mjs; do not edit.\n/** The Portuguese of the embedded editor: the official catalog of Frappe Builder and the app's supplement (${Object.keys(sorted).length} strings). */\nexport const EDITOR_TRANSLATIONS: Record<string, string> = ${JSON.stringify(sorted, null, 1)};\n`,
  );
  return path.relative(ROOT, OUT_TS);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(writeTranslations(path.resolve(process.argv[2] ?? path.join(ROOT, "..", "frappe-editor-src", "builder"))));
