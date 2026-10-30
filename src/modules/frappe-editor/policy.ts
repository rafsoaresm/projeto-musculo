/**
 * What the editor may run and load. The editor draws what people write (blocks with free HTML, attributes, links) inside the page of the app, so
 * whatever got into a block would run with the session of whoever opens it. This policy is the wall behind the filters of the editor itself: scripts
 * only from the app's own files (and the page's two inline scripts, by nonce), so an event handler, a `javascript:` address or an injected script
 * does nothing; frames, forms, images, fonts and requests only to the app itself; no plugins, no `<base>`. `unsafe-eval` stays off: if the editor ever
 * needs it, this is where to see it (the browser test fails on any violation).
 */
export function editorPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob: data:",
    "connect-src 'self'",
    "frame-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join("; ");
}

/** Gives every inline script of the page the nonce of this answer (the page has only plain `<script>` tags: see the test). */
export const withNonce = (html: string, nonce: string): string => html.replace(/<script>/g, `<script nonce="${nonce}">`);
