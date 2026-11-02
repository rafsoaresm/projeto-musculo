/**
 * The widths of the preview of a page (Editor Guiado, "Ver o modelo"; 0.70): the page is laid out at the width of a real screen and scaled down to
 * fit the panel, so "Computador" shows the computer's layout (not a tablet's, as a 600 px wide panel would) and "Celular" the phone's.
 * The chosen width is always the one shown (the pressed button says what is seen): a panel narrower than the page scales it down, never swaps it.
 * The computer is 1280 wide (above the tablet's limit of screens.ts, at the container of the site models); the phone is 390 (the models' Figma).
 */
export type PreviewWidth = "computador" | "celular";
export const PREVIEW_WIDTHS: readonly PreviewWidth[] = ["computador", "celular"];
export const PREVIEW_PX: Record<PreviewWidth, number> = { computador: 1280, celular: 390 };
export const PREVIEW_LABEL: Record<PreviewWidth, string> = { computador: "Computador", celular: "Celular" };
/** How much the page is scaled to fit the panel: never more than its own size, never nothing (not yet measured is 1). */
export function previewScale(available: number, width: PreviewWidth): number {
  if (!Number.isFinite(available) || available <= 0) return 1;
  return Math.min(1, Math.max(0.1, available / PREVIEW_PX[width]));
}
