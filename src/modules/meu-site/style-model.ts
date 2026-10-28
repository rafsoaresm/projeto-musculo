import { SCREEN_KEY, SCREENS, isHiddenAt, ownStyle, type Screen, type Styled } from "./screens";
import { styleSchema, type Style } from "./style";

/**
 * Changes to a style, as functions: the panel only says "this property is now this" (or "back to nothing"), and what the
 * document holds stays as small as what was really changed. A property that is cleared leaves no key; a group of sides
 * (padding, margin) that has no side left leaves no key either, and a style with nothing left is no style at all.
 *
 * A node keeps a style for each size of the screen (see screens.ts). A change is always to one size: the computer's
 * style, or only what the tablet or the phone does differently.
 */
const SIDES = ["top", "right", "bottom", "left"] as const;

function clean(style: Style): Style | undefined {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(style)) {
    if (value === undefined) continue;
    if (key === "padding" || key === "margin") {
      const sides = Object.fromEntries(SIDES.flatMap((side) => ((value as Record<string, string | undefined>)[side] !== undefined ? [[side, (value as Record<string, string>)[side]]] : [])));
      if (Object.keys(sides).length > 0) out[key] = sides;
      continue;
    }
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? (out as Style) : undefined;
}

/** The style with `patch` applied: a key set to undefined is removed. */
export const patchStyle = (style: Style | undefined, patch: Partial<Record<keyof Style, unknown>>): Style | undefined => clean({ ...style, ...patch } as Style);

/** One side of padding or margin changed (or cleared with undefined). */
export function patchSide(style: Style | undefined, group: "padding" | "margin", side: (typeof SIDES)[number], value: string | undefined): Style | undefined {
  return patchStyle(style, { [group]: { ...style?.[group], [side]: value } });
}

/** Whether a style would be accepted by the server. */
export const isValidStyle = (style: unknown): boolean => styleSchema.safeParse(style).success;

// ---- a size of the screen ----

/** The node with the style of a size replaced, or taken away when `style` is undefined. */
export function withScreenStyle<T extends Styled>(node: T, screen: Screen, style: Style | undefined): T {
  const key = SCREEN_KEY[screen];
  const { [key]: previous, ...rest } = node;
  void previous;
  return (style ? { ...rest, [key]: style } : rest) as T;
}

/** The node with a size's own changes undone: it goes back to what the size below gives it. The computer is the base and has none. */
export const resetScreen = <T extends Styled>(node: T, screen: Screen): T => (screen === "desktop" ? node : withScreenStyle(node, screen, undefined));

/** The node without any style at any size. */
export const clearStyles = <T extends Styled>(node: T): T => SCREENS.reduce((current, screen) => withScreenStyle(current, screen, undefined), node);

/** Whether the block is hidden at a size, or shown, set for that size alone: saying what the size already inherits leaves nothing behind. */
export function setHidden<T extends Styled>(node: T, screen: Screen, hide: boolean): T {
  const below = screen === "desktop" ? false : isHiddenAt(node, screen === "tablet" ? "desktop" : "tablet");
  return withScreenStyle(node, screen, patchStyle(ownStyle(node, screen), { hidden: hide === below ? undefined : hide }));
}
export const toggleHidden = <T extends Styled>(node: T, screen: Screen): T => setHidden(node, screen, !isHiddenAt(node, screen));
