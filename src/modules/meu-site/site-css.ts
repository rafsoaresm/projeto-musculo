import { allNodes, type SiteContent } from "./contracts";
import { cssDeclarations, isEmptyStyle, type CssContext } from "./style";

/**
 * The stylesheet of a page, made from the typed styles of its nodes and from nothing else. A node is found by a class
 * that is its own identifier (`s-<id>`; the identifier is `[a-z0-9-]`, nothing else gets through the schema), so the page
 * needs no `style` attribute, and the public page links to this sheet from its own address instead of carrying it.
 * The rule repeats the class three times to outweigh the page's own rules (a primary button has its own background):
 * a value the person chose is not undone by a default.
 */
export const nodeClass = (id: string) => `s-${id}`;
/** The DOM id of a node that a link or a button of the page goes to. */
export const anchorDomId = (id: string) => `s-${id}`;

const SAFE_ID = /^[a-z0-9-]{1,40}$/;

export function buildSiteCss(content: SiteContent, context: CssContext): string {
  const rules: string[] = [];
  for (const entry of allNodes(content.blocks)) {
    if (!SAFE_ID.test(entry.id) || isEmptyStyle(entry.style)) continue;
    const declarations = cssDeclarations(entry.style, context);
    if (declarations.length === 0) continue;
    const own = nodeClass(entry.id);
    rules.push(`.site .${own}.${own}.${own}{${declarations.join(";")}}`);
  }
  return rules.join("\n");
}
