import { documentNodes, type SiteContent } from "./contracts";
import { MOBILE_MAX, SCREENS, TABLET_MAX, hasAnyStyle, isHiddenAt, resolveStyle } from "./screens";
import { brandRules } from "./brand-color";
import { cssDeclarations, type CssContext } from "./style";

/**
 * The stylesheet of a page, made from the typed styles of its nodes and from nothing else. A node is found by a class
 * that is its own identifier (`s-<id>`; the identifier is `[a-z0-9-]`, nothing else gets through the schema), so the page
 * needs no `style` attribute, and the public page links to this sheet from its own address instead of carrying it.
 * The rule repeats the class three times to outweigh the page's own rules (a primary button has its own background):
 * a value the person chose is not undone by a default.
 *
 * The sizes of the screen are laid over each other in the order of the cascade: first every rule of the computer, then
 * what the tablet changes (up to `TABLET_MAX` wide), then what the phone changes (up to `MOBILE_MAX`), and last the rules
 * that hide a block at a size, which have to win over a `display` set above. A size writes only what differs from the one
 * below it, found by comparing the declarations of the styles as they really are at each size, so a property that depends
 * on another (the size of a background image, the color of a border) follows the one it depends on.
 *
 * On the published page the sizes are media queries on the window. In the editor (`context.container`) they are container
 * queries on the frame, so three frames of three widths can show three sizes at once in one window.
 */
export const nodeClass = (id: string) => `s-${id}`;
/** The DOM id of a node that a link or a button of the page goes to. */
export const anchorDomId = (id: string) => `s-${id}`;
/** The name of the container of a frame of the editor: its width is what the container queries read. */
export const FRAME_CONTAINER = "site-frame";

const SAFE_ID = /^[a-z0-9-]{1,40}$/;

// A hair above the limit of the size below, so a window of a fractional width (a zoomed browser) is never between two sizes.
const above = (limit: number) => `${limit + 0.02}px`;

const query = (condition: string, context: CssContext) => (context.container ? `@container ${FRAME_CONTAINER} ${condition}` : `@media ${condition}`);

/** The conditions under which a block that is hidden at some of the sizes is hidden; null is "always". */
function hiddenWhere(computer: boolean, tablet: boolean, phone: boolean): Array<string | null> {
  if (computer && tablet && phone) return [null];
  if (computer && tablet) return [`(min-width:${above(MOBILE_MAX)})`];
  if (tablet && phone) return [`(max-width:${TABLET_MAX}px)`];
  const out: string[] = [];
  if (computer) out.push(`(min-width:${above(TABLET_MAX)})`);
  if (tablet) out.push(`(min-width:${above(MOBILE_MAX)}) and (max-width:${TABLET_MAX}px)`);
  if (phone) out.push(`(max-width:${MOBILE_MAX}px)`);
  return out;
}

const IMAGE = "background-image:";
/**
 * The declarations of `next` that `previous` (the size below) does not already have. A size cannot take a property away, only
 * change it, with one exception that has a value for it: a size that says "no image" ends the image of the size below.
 */
const changed = (next: string[], previous: string[]) => {
  const had = new Set(previous);
  const out = next.filter((declaration) => !had.has(declaration));
  if (previous.some((declaration) => declaration.startsWith(IMAGE)) && !next.some((declaration) => declaration.startsWith(IMAGE))) out.push(`${IMAGE}none`);
  return out;
};

export function buildSiteCss(content: SiteContent, context: CssContext): string {
  const base: string[] = [];
  const tablet: string[] = [];
  const phone: string[] = [];
  const hidden = new Map<string, string[]>();
  // The nodes of a component are written once, whatever the number of its instances: they are all drawn with the same classes.
  for (const entry of documentNodes(content)) {
    if (!SAFE_ID.test(entry.id) || !hasAnyStyle(entry)) continue;
    const own = nodeClass(entry.id);
    const selector = `.site .${own}.${own}.${own}`;
    const [computer, onTablet, onPhone] = SCREENS.map((screen) => cssDeclarations(resolveStyle(entry, screen), context));
    if (computer.length > 0) base.push(`${selector}{${computer.join(";")}}`);
    const tabletChanges = changed(onTablet, computer);
    if (tabletChanges.length > 0) tablet.push(`${selector}{${tabletChanges.join(";")}}`);
    const phoneChanges = changed(onPhone, onTablet);
    if (phoneChanges.length > 0) phone.push(`${selector}{${phoneChanges.join(";")}}`);
    const [hideComputer, hideTablet, hidePhone] = SCREENS.map((screen) => isHiddenAt(entry, screen));
    for (const where of hiddenWhere(hideComputer, hideTablet, hidePhone)) {
      const key = where ?? "";
      hidden.set(key, [...(hidden.get(key) ?? []), selector]);
    }
  }
  // The palette of the person's brand color, when there is one: it depends on the color, so it is here and not in the page's own stylesheet.
  const rules = [...(content.theme.brand ? brandRules(content.theme.brand) : []), ...base];
  if (tablet.length > 0) rules.push(`${query(`(max-width:${TABLET_MAX}px)`, context)}{${tablet.join("")}}`);
  if (phone.length > 0) rules.push(`${query(`(max-width:${MOBILE_MAX}px)`, context)}{${phone.join("")}}`);
  for (const [where, selectors] of hidden) {
    const rule = `${selectors.join(",")}{display:none}`;
    rules.push(where === "" ? rule : `${query(where, context)}{${rule}}`);
  }
  return rules.join("\n");
}
