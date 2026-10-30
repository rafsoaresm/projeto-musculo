/**
 * The block templates that come with Frappe Builder (navbars, hero sections, footer, testimonial, forms, headings, buttons ...), carried by this
 * repository so that the editor's library of blocks is not empty: the editor lists them next to the ones a person saves. Each is a tree of blocks
 * with its own styles, which a person edits freely after inserting it. Written as a module (src/modules/frappe-editor/block-templates.generated.ts)
 * with the preview pictures copied to public/frappe-editor/templates. Run by build.mjs; alone:
 * `node scripts/frappe-editor/block-templates.mjs <checkout of the builder repository>`.
 *
 * Left out for now, because they need what this app does not run on a public page yet: the one that switches the theme with a script, and the ones
 * that embed another site's player or free code (embed, video, YouTube). They come back with the isolated code block.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const TARGET = path.join(ROOT, "src", "modules", "frappe-editor", "block-templates.generated.ts");
const PREVIEWS = path.join(ROOT, "public", "frappe-editor", "templates");
const LEFT_OUT = new Set(["embed", "theme_switcher", "video", "youtube"]);

export function writeBlockTemplates(builderDir) {
  const source = path.join(builderDir, "builder", "builder", "builder_block_template");
  const pictures = path.join(builderDir, "builder", "www", "builder_assets");
  fs.rmSync(PREVIEWS, { recursive: true, force: true });
  fs.mkdirSync(PREVIEWS, { recursive: true });
  const templates = [];
  for (const id of fs.readdirSync(source).sort()) {
    const file = path.join(source, id, `${id}.json`);
    if (LEFT_OUT.has(id) || !fs.existsSync(file)) continue;
    const doc = JSON.parse(fs.readFileSync(file, "utf8"));
    const block = typeof doc.block === "string" ? doc.block : JSON.stringify(doc.block);
    JSON.parse(block);
    let preview = "";
    const folder = path.join(pictures, doc.name);
    const picture = fs.existsSync(folder) ? fs.readdirSync(folder).find((name) => name.endsWith(".png")) : undefined;
    if (picture) {
      fs.copyFileSync(path.join(folder, picture), path.join(PREVIEWS, `${id}.png`));
      preview = `templates/${id}.png`;
    }
    templates.push({
      id,
      name: doc.name,
      template_name: doc.template_name || doc.name,
      category: doc.category || "Basic",
      sort_order: Number(doc.sort_order) || 0,
      preview,
      preview_width: Number(doc.preview_width) || 1,
      preview_height: Number(doc.preview_height) || 1,
      block,
    });
  }
  fs.mkdirSync(path.dirname(TARGET), { recursive: true });
  fs.writeFileSync(
    TARGET,
    `// Written by scripts/frappe-editor/block-templates.mjs; do not edit.\n` +
      `/** The block templates that come with the editor, by the files in public/frappe-editor/templates. */\n` +
      `export interface StandardTemplate {\n  id: string;\n  name: string;\n  template_name: string;\n  category: string;\n  sort_order: number;\n  /** Under public/frappe-editor, or empty. */\n  preview: string;\n  preview_width: number;\n  preview_height: number;\n  /** The tree of blocks, as JSON text. */\n  block: string;\n}\n` +
      `export const STANDARD_TEMPLATES: StandardTemplate[] = ${JSON.stringify(templates, null, 1)};\n`,
  );
  return { count: templates.length, ts: path.relative(ROOT, TARGET) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) throw new Error("usage: node scripts/frappe-editor/block-templates.mjs <checkout of the builder repository>");
  const { count, ts } = writeBlockTemplates(path.resolve(dir));
  console.log(`written: ${count} templates in ${ts}`);
}
