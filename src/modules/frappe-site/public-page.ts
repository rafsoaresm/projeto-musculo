/**
 * From what the database says of a published page to the document a visitor receives (see db/builder-public.ts for the reading, render.ts for
 * the blocks and document.ts for the document itself). Pure: the same page always gives the same document.
 */
import type { PublicPage } from "@/db/builder-public";
import { freeCss } from "./css";
import { buildDocument, PUBLIC_CSP, type PageMeta } from "./document";
import { fontFaces } from "./fonts";
import { CODE_PATH, type CodeBlock } from "./code";
import { FORM_SEND_PATH, type FormDefinition } from "./form";
import { renderBlocks, type RenderInput } from "./render";
import { toMountRoot, urlContext } from "./urls";

export { PUBLIC_CSP };

const text = (value: unknown) => (typeof value === "string" ? value : "");
const flag = (value: unknown) => Number(value) === 1 || value === true;

/** What a page is drawn from, the same for the document a visitor gets and for the reading of its forms when a message arrives. */
/** `forms`: the public forms are open (with the privacy notice to link to, or null when there is none); null when the environment closed them. */
export type OpenForms = { noticeUrl: string | null } | null;

function renderInput(found: PublicPage, depth: number, forms: OpenForms): RenderInput {
  const tokenValue = new Map(found.tokens.map((token) => [token.name, token.value]));
  return {
    blocks: found.blocks,
    component: (id, version) => (version ? found.components.get(`${id}@${version}`) : undefined) ?? found.components.get(id) ?? null,
    fontToken: (name) => tokenValue.get(name.replace(/^--/, "")) ?? null,
    url: urlContext(found.slug, depth),
    // The frame of a block of free code is the document `/site/<address>/m/codigo/<page>/<n>`, written from where the page is.
    code: { src: (index) => `${toMountRoot(depth)}site/${found.slug}/${CODE_PATH}/${encodeURIComponent(text(found.page.name))}/${index}` },
    // A form is drawn only when the environment did not close the public forms AND the site's own switch is on.
    forms: { route: found.route, send: forms && found.inquiriesOpen ? { action: `${toMountRoot(depth)}site/${found.slug}/${FORM_SEND_PATH}`, noticeUrl: forms.noticeUrl } : null },
  };
}

/** What a published page holds that is read rather than drawn: its forms (drawn or not) and its free code, in the order of the page (what its frames show). */
export function contentOfPage(found: PublicPage): { forms: FormDefinition[]; code: CodeBlock[] } {
  const { forms, codeBlocks } = renderBlocks(renderInput(found, 0, null));
  return { forms, code: codeBlocks };
}

/** The forms of a published page, as they are on it now (drawn or not). */
export const formsOfPage = (found: PublicPage): FormDefinition[] => contentOfPage(found).forms;

/** The free code of a published page, in the order of the page: what the frames of its blocks show. */
export const codeOfPage = (found: PublicPage): CodeBlock[] => contentOfPage(found).code;

/** The tagging script of a site (`/s/<slug>/m/rastreio`), from a page `depth` segments below `/site/<slug>`. */
export const trackingScriptUrl = (slug: string, depth: number) => `${toMountRoot(depth)}s/${slug}/m/rastreio`;

/**
 * `forms` says the public forms are open (and which privacy notice to link to, if any); null draws no form. `tracking`: the site has a
 * tool of tagging on (Meu Site 0.71), so the page loads its script; only the published page asks for it (never the preview or a model).
 */
export function publicDocument(found: PublicPage, depth: number, forms: OpenForms = null, tracking = false): string {
  const url = urlContext(found.slug, depth);
  const rendered = renderBlocks(renderInput(found, depth, forms));
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
    ...(tracking ? { script: trackingScriptUrl(found.slug, depth) } : {}),
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
