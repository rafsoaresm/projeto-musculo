import { styleSchema, type Style } from "./style";

/**
 * Changes to a style, as functions: the panel only says "this property is now this" (or "back to nothing"), and what the
 * document holds stays as small as what was really changed. A property that is cleared leaves no key; a group of sides
 * (padding, margin) that has no side left leaves no key either, and a style with nothing left is no style at all.
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
