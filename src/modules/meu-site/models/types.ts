import type { SiteContent } from "../contracts";
import type { Palette } from "../site-palette";
import type { ModelMode } from "./bricks";

/** The four site models of the handoff "Templates de Sites — CMS V1". */
export const SITE_MODEL_KEYS = ["trainix", "fitnova", "sisphus", "race"] as const;
export type SiteModelKey = (typeof SITE_MODEL_KEYS)[number];

export interface SiteModelDef {
  key: SiteModelKey;
  /** The name shown on the card (the handoff's names are internal names of presets, not brands: the card says what the model is). */
  label: string;
  hint: string;
  palette: Palette;
  /** A one-page site with the header's links, the WhatsApp button and a footer of its own; `mode` "preview" fills in the model's samples. */
  build: (title: string, mode: ModelMode) => SiteContent;
}
