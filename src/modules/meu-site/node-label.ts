import { BLOCK_LABEL, type SiteNode } from "./contracts";

/** How a node is called in the layers and in the lists of blocks: the name the person gave it, or what kind it is. */
export const nodeTitle = (entry: SiteNode): string => entry.name || BLOCK_LABEL[entry.type];

/** A few words of what a node says, to tell two of a kind apart. Empty for a container. */
export function nodeText(entry: SiteNode): string {
  let text = "";
  switch (entry.type) {
    case "hero":
    case "services":
    case "about":
    case "stats":
    case "faq":
    case "cta":
      text = entry.heading;
      break;
    case "text":
      text = entry.heading || entry.text;
      break;
    case "quote":
      text = entry.quote;
      break;
    case "heading":
    case "paragraph":
      text = entry.text;
      break;
    case "button":
    case "link":
      text = entry.label;
      break;
    case "image":
      text = entry.alt || entry.caption;
      break;
    case "box":
      text = "";
      break;
  }
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 28 ? `${flat.slice(0, 27)}…` : flat;
}
