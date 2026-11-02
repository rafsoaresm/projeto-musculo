/**
 * The content column of the site models (0.70): every section of every model, the header and the footer included, puts its content at the same
 * left edge at every width. A section pads its sides by the gutter of its size, and what is in it sits in a column as wide as the container at most,
 * centred, so the edge is max(gutter, (width - container) / 2) wherever the section is. The header has no node: it reads the same numbers from the
 * page's stylesheet (`--site-container`, `--site-gutter` on `.site`, globals.css), which change at the same sizes (screens.ts).
 */
import type { SiteNode } from "../contracts";
import type { Style } from "../style";
import { box, sides, type Sizes } from "./bricks";

/** The widest the content of a section gets (Figma: 1280 of 1440). */
export const CONTAINER = "1280px";
/** The space on each side of a section, at each size of the screen (Figma: 80 at 1440 and 22 at 390; the tablet is in between). */
export const GUTTER = { desktop: "80px", tablet: "40px", mobile: "22px" } as const;

/** The column of a section: the whole width up to the container, centred; `style` lays out what is in it. */
export const column = (style: Style, children: SiteNode[], sizes?: Sizes, name = "Conteúdo"): SiteNode =>
  box(name, "div", { width: "100%", maxWidth: CONTAINER, margin: sides("0px", "auto"), ...style }, children, sizes);
