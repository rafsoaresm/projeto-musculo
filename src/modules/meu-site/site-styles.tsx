/**
 * The stylesheet of a page, written into the page itself: for the editor and the preview, which only the person editing
 * sees. The public page does not use it: it links to its sheet from its own address (`/s/<address>/estilo.css`).
 * The text comes from `buildSiteCss`, whose alphabet has no angle bracket, so nothing in it can close the element;
 * if one ever got through, nothing is written.
 */
export function InlineSiteStyles({ css }: { css: string }) {
  if (css === "" || /[<>]/.test(css)) return null;
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
