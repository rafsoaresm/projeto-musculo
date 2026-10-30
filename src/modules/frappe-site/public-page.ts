/**
 * From what the database says of a published page to the document a visitor receives (see db/builder-public.ts for the reading, render.ts for
 * the blocks and document.ts for the document itself). Pure: the same page always gives the same document.
 */
import type { PublicPage } from "@/db/builder-public";
import { freeCss } from "./css";
import { buildDocument, PUBLIC_CSP, type PageMeta } from "./document";
import { fontFaces } from "./fonts";
import { FORM_SEND_PATH, type FormDefinition } from "./form";
import { renderBlocks, type RenderInput } from "./render";
import { toMountRoot, urlContext } from "./urls";

export { PUBLIC_CSP };

const text = (value: unknown) => (typeof value === "string" ? value : "");
const flag = (value: unknown) => Number(value) === 1 || value === true;

/** What a page is drawn from, the same for the document a visitor gets and for the reading of its forms when a message arrives. */
function renderInput(found: PublicPage, depth: number, noticeUrl: string | null): RenderInput {
  const tokenValue = new Map(found.tokens.map((token) => [token.name, token.value]));
  return {
    blocks: found.blocks,
    component: (id, version) => (version ? found.components.get(`${id}@${version}`) : undefined) ?? found.components.get(id) ?? null,
    fontToken: (name) => tokenValue.get(name.replace(/^--/, "")) ?? null,
    url: urlContext(found.slug, depth),
    // A form is drawn only when the environment opened the public forms (a privacy notice to point to) AND the site opened its own switch.
    forms: { route: found.route, send: noticeUrl && found.inquiriesOpen ? { action: `${toMountRoot(depth)}site/${found.slug}/${FORM_SEND_PATH}`, noticeUrl } : null },
  };
}

/** The forms of a published page, as they are on it now (drawn or not). */
export const formsOfPage = (found: PublicPage): FormDefinition[] => renderBlocks(renderInput(found, 0, null)).forms;

/** `noticeUrl` is the address of the privacy notice when the environment has opened the public forms, otherwise null. */
export function publicDocument(found: PublicPage, depth: number, noticeUrl: string | null = null): string {
  const url = urlContext(found.slug, depth);
  const rendered = renderBlocks(renderInput(found, depth, noticeUrl));
  const { page, settings } = found;
  const meta: PageMeta = {
    title: text(page.page_title) || text(page.page_name) || "Página",
    description: text(page.meta_description),
    image: text(page.meta_image) ? url.asset(text(page.meta_image)) : null,
    favicon: text(page.favicon) || text(settings.favicon) ? url.asset(text(page.favicon) || text(settings.favicon)) : null,
    language: text(page.language) || text(settings.default_language) || "pt-BR",
    noindex: flag(page.disable_indexing) || flag(page.staging),
  };
  return buildDocument({
    rendered,
    meta,
    tokens: found.tokens,
    freeStyles: found.styles.map((css) => freeCss(css, url.asset)).filter(Boolean),
    fontFaces: fontFaces(rendered.fonts, toMountRoot(depth)),
    keepLight: flag(settings.disable_auto_dark_mode),
    asset: url.asset,
  });
}

/** The page a visitor gets for an address that does not exist (or is not published): the same for every reason, and not listed by search engines. */
export function notFoundDocument(): string {
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex"><title>Página não encontrada</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;color:#1f2933;background:#f7f8fa}main{padding:24px;text-align:center}h1{font-size:1.4rem;margin:0 0 8px}p{margin:0;color:#52606d}</style></head>
<body><main><h1>Página não encontrada</h1><p>O endereço não existe ou a página não está no ar.</p></main></body></html>
`;
}
