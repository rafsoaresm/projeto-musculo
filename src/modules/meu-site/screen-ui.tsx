import { Monitor, Smartphone, Tablet, type LucideIcon } from "lucide-react";
import { SCREEN_LABEL, SCREEN_WIDTH, type Screen } from "./screens";

/** The icon of each size of the screen, the same in the toggles over the canvas, the style panel and the layers. */
export const SCREEN_ICON: Record<Screen, LucideIcon> = { desktop: Monitor, tablet: Tablet, mobile: Smartphone };

/** "Computador · 1400 px" */
export const screenTitle = (screen: Screen) => `${SCREEN_LABEL[screen]} · ${SCREEN_WIDTH[screen]} px`;
