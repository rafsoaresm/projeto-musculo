import { FITNOVA } from "./fitnova";
import { RACE } from "./race";
import { SISPHUS } from "./sisphus";
import { TRAINIX } from "./trainix";
import type { SiteModelDef } from "./types";

/** The site models of the Editor Guiado (handoff "Templates de Sites — CMS V1"), in the order of the cards. */
export const SITE_MODELS_V1: readonly SiteModelDef[] = [TRAINIX, FITNOVA, SISPHUS, RACE];
export type { SiteModelDef, SiteModelKey } from "./types";
