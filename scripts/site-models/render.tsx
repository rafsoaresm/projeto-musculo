/**
 * Draws a site model as a static page, for comparing it with the Figma frames (not part of the app): the model's document, the page's style
 * sheet made from it, and the app's own style sheet, with the sample photos read from public/site-models.
 *
 *   npx esbuild scripts/site-models/render.tsx --bundle --platform=node --format=esm --jsx=automatic --alias:@=./src --outfile=<tmp>/render.mjs
 *   node <tmp>/render.mjs <model> <preview|site> <out.html>
 * Then screenshot <out.html> at 1440 and 390 wide.
 */
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { SiteRenderer } from "@/modules/meu-site/renderer";
import { buildSiteCss } from "@/modules/meu-site/site-css";
import { siteNav } from "@/modules/meu-site/site-nav";
import { HOME } from "@/modules/meu-site/contracts";
import { SITE_MODELS_V1 } from "@/modules/meu-site/models";
import { demoKeyOf, demoPhotoUrl } from "@/modules/meu-site/models/demo-photos";

const [key, mode = "preview", out = "model.html"] = process.argv.slice(2);
const model = SITE_MODELS_V1.find((entry) => entry.key === key);
if (!model) throw new Error(`no model ${key}; one of ${SITE_MODELS_V1.map((entry) => entry.key).join(", ")}`);
const content = model.build("Trainer Prescription", mode as "preview" | "site");
const root = resolve(".");
// Relative to the page, as the app's own addresses are (the page's sheet takes only such addresses): the photos are copied next to it.
const folder = "./site-models/";
cpSync(`${root}/public/site-models`, resolve(dirname(resolve(out)), "site-models"), { recursive: true });
const css = buildSiteCss(content, {
  imageUrl: (id) => {
    const demo = demoKeyOf(id);
    return demo && mode === "preview" ? demoPhotoUrl(folder, demo) : null;
  },
});
const app = [readFileSync("src/styles/tokens.css", "utf8"), readFileSync("src/app/globals.css", "utf8").replace('@import "../styles/tokens.css";', "").replace("./fonts/inter-site.var.woff2", `file://${root}/src/app/fonts/inter-site.var.woff2`)].join("\n");
const body = renderToStaticMarkup(
  createElement(SiteRenderer, {
    content,
    images: () => null,
    nav: siteNav(content, HOME, (_id, slug) => (slug ? `#${slug}` : "#")),
    ...(mode === "preview" ? { demoFolder: folder } : null),
  }),
);
writeFileSync(out, `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${app}</style><style>${css}</style></head><body>${body}</body></html>`);
console.log(`wrote ${out}`);
