import type { Doc } from "./doc-query";
import { STANDARD_TEMPLATES } from "./block-templates.generated";

/**
 * The block templates that come with the editor, as the documents the editor reads (`Block Template`). They are the same for every
 * organization and nobody changes them: a person who wants another version saves a copy under a name of their own. The picture of each is a
 * file of the app, written from the mount path of the request (`files`: where the editor's files are, e.g. `/treinador/frappe-editor/`).
 */
export function standardTemplates(files: string): Doc[] {
  return STANDARD_TEMPLATES.map((template) => ({
    doctype: "Block Template",
    name: template.name,
    template_name: template.template_name,
    category: template.category,
    sort_order: template.sort_order,
    preview: template.preview ? `${files}${template.preview}` : "",
    preview_width: template.preview_width,
    preview_height: template.preview_height,
    block: template.block,
    owner: "Administrator",
    modified_by: "Administrator",
    creation: "2024-01-01 00:00:00.000000",
    modified: "2024-01-01 00:00:00.000000",
    docstatus: 0,
    idx: 0,
  }));
}
