import { styleAssetIds, type Style } from "./style";

/**
 * The three screen sizes of a page, as in the builders people know: the computer is the base, the tablet and the phone
 * are changes laid over it, in that order (the phone has the computer's style, then the tablet's changes, then its own).
 * A node keeps the style of the computer in `style` and only what is different in `styleTablet` and `styleMobile`.
 *
 * The widths are the ones of the frames in the editor; the limits are where the published page changes size: up to
 * `TABLET_MAX` wide it takes the tablet's changes, up to `MOBILE_MAX` the phone's too. They are the editor's numbers on
 * purpose: a frame of 800 wide is a tablet and one of 420 is a phone, whatever the window of the editor measures.
 */
export const SCREENS = ["desktop", "tablet", "mobile"] as const;
export type Screen = (typeof SCREENS)[number];
export const SCREEN_LABEL: Record<Screen, string> = { desktop: "Computador", tablet: "Tablet", mobile: "Celular" };
/** How wide the frame of each size is in the editor, in CSS pixels. */
export const SCREEN_WIDTH: Record<Screen, number> = { desktop: 1400, tablet: 800, mobile: 420 };
/** The widest page (in CSS pixels) that takes the changes of the tablet, and of the phone. Wider than the first is the computer. */
export const TABLET_MAX = 1023;
export const MOBILE_MAX = 576;

/** What a node needs to have to be styled: the three styles it may keep. */
export interface Styled {
  style?: Style;
  styleTablet?: Style;
  styleMobile?: Style;
}
export const SCREEN_KEY = { desktop: "style", tablet: "styleTablet", mobile: "styleMobile" } as const satisfies Record<Screen, keyof Styled>;

/** What a size keeps of its own: for the computer its whole style, for the others only what differs. */
export const ownStyle = (node: Styled, screen: Screen): Style | undefined => node[SCREEN_KEY[screen]];

const SIDED = ["padding", "margin"] as const;
/** `over` laid on `under`: a property of `over` wins; padding and margin merge side by side (each side is a property of its own in CSS). */
export function layer(under: Style | undefined, over: Style | undefined): Style {
  const out: Record<string, unknown> = { ...under, ...over };
  for (const group of SIDED) if (under?.[group] || over?.[group]) out[group] = { ...under?.[group], ...over?.[group] };
  return out as Style;
}

/** The style a node really has at a size: the computer's, then the tablet's changes, then the phone's. */
export function resolveStyle(node: Styled, screen: Screen): Style {
  if (screen === "desktop") return node.style ?? {};
  const tablet = layer(node.style, node.styleTablet);
  return screen === "tablet" ? tablet : layer(tablet, node.styleMobile);
}

/** Whether a node is hidden at a size: the computer's `hidden` carries down to the smaller sizes until one of them says otherwise. */
export const isHiddenAt = (node: Styled, screen: Screen): boolean => resolveStyle(node, screen).hidden === true;

/** Whether a size has changes of its own (always false for the computer, which is the base). */
export const hasOverrides = (node: Styled, screen: Screen): boolean => screen !== "desktop" && Object.keys(ownStyle(node, screen) ?? {}).length > 0;

/** Whether the node has any style at any size: then it carries the class its rules are written for. */
export const hasAnyStyle = (node: Styled): boolean => SCREENS.some((screen) => Object.keys(ownStyle(node, screen) ?? {}).length > 0);

/** The images of the library that the node's styles use, at any size. */
export const nodeAssetIds = (node: Styled): string[] => [...new Set(SCREENS.flatMap((screen) => styleAssetIds(ownStyle(node, screen))))];
