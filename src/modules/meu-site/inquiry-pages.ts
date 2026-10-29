/**
 * The small pages the contact form answers with (confirmation, a field to fix, too many messages). They are the answer of a form sent
 * without a script, so they are plain documents with their own few lines of style: nothing of the tool around them, nothing cached,
 * and no address that is not on this same site.
 */
const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] as string);

export interface InquiryPage {
  title: string;
  message: string;
  /** Where the link under the message goes (a relative address on this site) and what it says. */
  back: { href: string; label: string };
}

export function inquiryPageHtml(page: InquiryPage): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(page.title)}</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f6f7f9;color:#1f2933}
main{max-width:460px;padding:28px;border:1px solid #d5dae1;border-radius:14px;background:#fff}
h1{margin:0 0 10px;font-size:22px}
p{margin:0 0 18px;line-height:1.5}
a{color:#0b5cad;font-weight:600}
</style>
</head>
<body>
<main>
<h1>${escapeHtml(page.title)}</h1>
<p>${escapeHtml(page.message)}</p>
<p><a href="${escapeHtml(page.back.href)}">${escapeHtml(page.back.label)}</a></p>
</main>
</body>
</html>`;
}

/** The headers every one of these answers has: the page is the answer to one form, never stored and never listed. */
export const INQUIRY_PAGE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex",
  "X-Content-Type-Options": "nosniff",
} as const;
