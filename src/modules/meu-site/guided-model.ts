/**
 * The Editor Guiado (handoff V4, Figma `10:162`; the user's decision of 01/11/2026: the guided editor is the simple one, by sections with a
 * form). Pure: the sections of the home page, the fields of one section, and a change to one field. It edits only what a section says (texts,
 * buttons, images and their descriptions) and the page's title and description for search engines; the layout and the style stay as they are.
 */
import { ALT_MAX } from "./images";
import {
  ANSWER_MAX,
  AUTHOR_MAX,
  BUTTON_MAX,
  DESCRIPTION_MAX,
  EYEBROW_MAX,
  HEADING_MAX,
  QUESTION_MAX,
  QUOTE_MAX,
  STAT_LABEL_MAX,
  STAT_VALUE_MAX,
  SUBHEADING_MAX,
  TEXT_MAX,
  TITLE_MAX,
  HOME,
  pageContent,
  swapPage,
  type SiteContent,
  type SiteNode,
} from "./contracts";
import { nodeTitle } from "./node-label";

export interface Section {
  id: string;
  label: string;
}

export type FieldKind = "text" | "multiline" | "image" | "check";

export interface Field {
  /** `<node id>.<property>` or `<node id>.items.<n>.<property>`; `page.title` and `page.description` for the page itself. */
  key: string;
  label: string;
  kind: FieldKind;
  max: number;
  value: string;
  /** An image of a model: the drawing shown while no photo is chosen. */
  illustration?: string;
}

/** The sections of a page (the home page by default), in order: what the list shows. A box with the header or footer tag is called so. */
export function sectionsOf(content: SiteContent, pageId: string = HOME): Section[] {
  return pageContent(content, pageId).blocks.map((entry) => ({
    id: entry.id,
    label: entry.name || (entry.type === "box" && entry.tag === "header" ? "Cabeçalho" : entry.type === "box" && entry.tag === "footer" ? "Rodapé" : nodeTitle(entry)),
  }));
}

const own = (entry: SiteNode, property: string, label: string, kind: FieldKind, max: number): Field => ({
  key: `${entry.id}.${property}`,
  label,
  kind,
  max,
  value: String((entry as unknown as Record<string, unknown>)[property] ?? ""),
});

/** The fields of one node and of what is inside it, numbered when there are more of a kind ("Título 2"). */
export function fieldsOf(section: SiteNode): Field[] {
  const out: Field[] = [];
  const count = new Map<string, number>();
  const numbered = (label: string) => {
    const n = (count.get(label) ?? 0) + 1;
    count.set(label, n);
    return n === 1 ? label : `${label} ${n}`;
  };
  const visit = (entry: SiteNode) => {
    switch (entry.type) {
      case "hero":
        out.push(own(entry, "eyebrow", "Sobretítulo", "text", EYEBROW_MAX), own(entry, "heading", "Título", "text", HEADING_MAX), own(entry, "subheading", "Descrição", "multiline", SUBHEADING_MAX), own(entry, "buttonLabel", "Botão principal", "text", BUTTON_MAX));
        break;
      case "text":
        out.push(own(entry, "eyebrow", "Sobretítulo", "text", EYEBROW_MAX), own(entry, "heading", "Título", "text", HEADING_MAX), own(entry, "text", "Texto", "multiline", TEXT_MAX));
        break;
      case "services":
        out.push(own(entry, "eyebrow", "Sobretítulo", "text", EYEBROW_MAX), own(entry, "heading", "Título", "text", HEADING_MAX), own(entry, "intro", "Descrição", "multiline", SUBHEADING_MAX));
        break;
      case "about":
        out.push(
          own(entry, "eyebrow", "Sobretítulo", "text", EYEBROW_MAX),
          own(entry, "heading", "Título", "text", HEADING_MAX),
          own(entry, "text", "Texto", "multiline", TEXT_MAX),
          own(entry, "stat", "Destaque (número)", "text", STAT_VALUE_MAX),
          own(entry, "statLabel", "Legenda do destaque", "text", STAT_LABEL_MAX),
        );
        break;
      case "quote":
        out.push(
          own(entry, "eyebrow", "Sobretítulo", "text", EYEBROW_MAX),
          own(entry, "quote", "Depoimento", "multiline", QUOTE_MAX),
          own(entry, "author", "Autor", "text", AUTHOR_MAX),
          // A testimony is published only with the person's authorization, confirmed here ("true" or "").
          { key: `${entry.id}.authorized`, label: "A pessoa autorizou o uso deste depoimento no site", kind: "check", max: 4, value: entry.authorized ? "true" : "" },
        );
        break;
      case "stats":
        out.push(own(entry, "eyebrow", "Sobretítulo", "text", EYEBROW_MAX), own(entry, "heading", "Título", "text", HEADING_MAX));
        entry.items.forEach((item, n) => {
          out.push({ key: `${entry.id}.items.${n}.value`, label: `Número ${n + 1}`, kind: "text", max: STAT_VALUE_MAX, value: item.value });
          out.push({ key: `${entry.id}.items.${n}.label`, label: `Legenda ${n + 1}`, kind: "text", max: STAT_LABEL_MAX, value: item.label });
        });
        break;
      case "faq":
        out.push(own(entry, "eyebrow", "Sobretítulo", "text", EYEBROW_MAX), own(entry, "heading", "Título", "text", HEADING_MAX));
        entry.items.forEach((item, n) => {
          out.push({ key: `${entry.id}.items.${n}.question`, label: `Pergunta ${n + 1}`, kind: "text", max: QUESTION_MAX, value: item.question });
          out.push({ key: `${entry.id}.items.${n}.answer`, label: `Resposta ${n + 1}`, kind: "multiline", max: ANSWER_MAX, value: item.answer });
        });
        break;
      case "cta":
        out.push(own(entry, "eyebrow", "Sobretítulo", "text", EYEBROW_MAX), own(entry, "heading", "Título", "text", HEADING_MAX), own(entry, "text", "Descrição", "multiline", SUBHEADING_MAX), own(entry, "buttonLabel", "Botão principal", "text", BUTTON_MAX));
        break;
      case "contactForm":
        out.push(own(entry, "eyebrow", "Sobretítulo", "text", EYEBROW_MAX), own(entry, "heading", "Título", "text", HEADING_MAX), own(entry, "text", "Descrição", "multiline", SUBHEADING_MAX), own(entry, "buttonLabel", "Texto do botão", "text", BUTTON_MAX));
        break;
      case "heading":
        out.push({ ...own(entry, "text", "", "text", HEADING_MAX), label: numbered("Título") });
        break;
      case "paragraph":
        out.push({ ...own(entry, "text", "", "multiline", TEXT_MAX), label: numbered("Texto") });
        break;
      case "button":
      case "link":
        out.push({ ...own(entry, "label", "", "text", BUTTON_MAX), label: numbered(entry.type === "button" ? "Botão" : "Link") });
        break;
      case "image": {
        const label = numbered("Imagem");
        out.push(
          { ...own(entry, "assetId", "", "image", 64), label, ...(entry.illustration ? { illustration: entry.illustration } : null) },
          { ...own(entry, "alt", "", "text", ALT_MAX), label: `Descrição da ${label.toLowerCase()}` },
        );
        break;
      }
      case "box":
        entry.children.forEach(visit);
        break;
      case "component":
        // A component is edited where it is defined; its texts are the same everywhere it is used.
        break;
    }
  };
  visit(section);
  return out;
}

/** The page's own fields: what search engines and shared links show ("SEO da página"). */
export function pageFields(content: SiteContent): Field[] {
  return [
    { key: "page.title", label: "Título da página (SEO)", kind: "text", max: TITLE_MAX, value: content.title },
    { key: "page.description", label: "Descrição da página (SEO)", kind: "multiline", max: DESCRIPTION_MAX, value: content.description },
  ];
}

function replaceIn(nodes: SiteNode[], id: string, change: (entry: SiteNode) => SiteNode): SiteNode[] {
  let touched = false;
  const next = nodes.map((entry) => {
    if (entry.id === id) {
      const changed = change(entry);
      if (changed !== entry) touched = true;
      return changed;
    }
    if (entry.type === "box") {
      const children = replaceIn(entry.children, id, change);
      if (children !== entry.children) {
        touched = true;
        return { ...entry, children };
      }
    }
    return entry;
  });
  return touched ? next : nodes;
}

/**
 * The content with one field changed, cut to the field's size. A key that names nothing, or a property the guided editor does not offer,
 * leaves the content as it was (the same object), so nothing else is ever changed by this editor.
 */
export function withField(content: SiteContent, key: string, raw: string): SiteContent {
  if (key === "page.title") return { ...content, title: raw.slice(0, TITLE_MAX) };
  if (key === "page.description") return { ...content, description: raw.slice(0, DESCRIPTION_MAX) };
  const [id, property, n, itemProperty] = key.split(".");
  if (!id || !property) return content;
  let result = content;
  const blocks = replaceIn(content.blocks, id, (entry) => {
    // Only a field this node offers by itself: the key starts with its own identifier (its children have theirs).
    const field = fieldsOf(entry).find((candidate) => candidate.key === key);
    if (!field) return entry;
    if (field.kind === "check") return { ...entry, [property]: raw === "true" } as SiteNode;
    const value = raw.slice(0, field.max);
    if (property === "items" && n !== undefined && itemProperty) {
      const items = (entry as unknown as { items: Array<Record<string, string>> }).items.map((item, at) => (at === Number(n) ? { ...item, [itemProperty]: value } : item));
      return { ...entry, items } as SiteNode;
    }
    return { ...entry, [property]: value } as SiteNode;
  });
  if (blocks !== content.blocks) result = { ...content, blocks };
  return result;
}

/** The fields of one section of a page; none when the page or the section is not there. */
export function sectionFields(content: SiteContent, pageId: string, sectionId: string): Field[] {
  const section = pageContent(content, pageId).blocks.find((entry) => entry.id === sectionId);
  return section ? fieldsOf(section) : [];
}

/** `withField` on any page: the page's blocks are edited in the place of the home page's and put back. The same object when nothing changes. */
export function withPageField(content: SiteContent, pageId: string, key: string, raw: string): SiteContent {
  const swapped = swapPage(content, pageId);
  const changed = withField(swapped, key, raw);
  return changed === swapped ? content : swapPage(changed, pageId);
}
