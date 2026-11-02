/**
 * Draws each site model as a page of the Editor Avançado would publish it (site-model-blocks.ts -> frappe-site/render.ts -> document.ts), takes
 * its pictures at 1440 and 390 wide, and puts them side by side with the Editor Guiado's preview of the same model (scripts/site-models/qa.sh),
 * for comparing the two by eye. Not part of the app.
 *
 *   npx esbuild scripts/site-models/frappe-qa.tsx --bundle --platform=node --format=esm --alias:@=./src \
 *     --outfile=node_modules/.cache/site-models/frappe-qa.mjs --packages=external
 *   node node_modules/.cache/site-models/frappe-qa.mjs <out-dir> [model ...]
 *
 * <out-dir> must already hold <model>-preview-1440.png and -390.png from qa.sh (they are made by it when missing). It writes
 * <model>-frappe.html, <model>-frappe-1440.png, <model>-frappe-390.png and <model>-side-<width>-p<n>.png (guided on the left, Frappe on the right).
 */
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { SITE_MODELS_V1 } from "@/modules/meu-site/models";
import { siteModelPage } from "@/modules/frappe-editor/site-model-blocks";
import { renderBlocks } from "@/modules/frappe-site/render";
import { buildDocument } from "@/modules/frappe-site/document";
import { fontFaces } from "@/modules/frappe-site/fonts";
import { urlContext } from "@/modules/frappe-site/urls";

const [outArg, ...keys] = process.argv.slice(2);
if (!outArg) throw new Error("usage: frappe-qa.mjs <out-dir> [model ...]");
const out = resolve(outArg);
const root = resolve(".");
const models = SITE_MODELS_V1.filter((model) => keys.length === 0 || keys.includes(model.key));

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "/opt/pw-browsers/chromium" });
for (const model of models) {
  if (!existsSync(`${out}/${model.key}-preview-1440.png`)) execFileSync("bash", ["scripts/site-models/qa.sh", model.key, "preview", out], { stdio: "inherit" });
  const page = siteModelPage(model, "Trainer Prescription", { whatsapp: null });
  const url = urlContext("qa", 0);
  const rendered = renderBlocks({
    blocks: [page],
    component: () => null,
    fontToken: () => null,
    url,
    forms: { route: "", send: { action: "#", noticeUrl: "#" } },
  });
  const html = buildDocument({
    rendered,
    meta: { title: model.label, description: "", image: null, favicon: null, language: "pt-BR", noindex: true },
    tokens: [],
    freeStyles: [],
    fontFaces: fontFaces(rendered.fonts, `file://${root}/public/`),
    keepLight: true,
    asset: url.asset,
  });
  const file = `${out}/${model.key}-frappe.html`;
  writeFileSync(file, html);
  for (const width of [1440, 390]) {
    const tab = await browser.newPage({ viewport: { width, height: 900 } });
    await tab.goto(`file://${file}`);
    await tab.waitForLoadState("networkidle");
    await tab.screenshot({ path: `${out}/${model.key}-frappe-${width}.png`, fullPage: true });
    const overflow = await tab.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const height = await tab.evaluate(() => document.documentElement.scrollHeight);
    console.log(`${model.key} ${width}: overflow ${overflow}px, height ${height}px`);
    await tab.close();
  }
  // Side by side, cut in parts for reading: the guided preview on the left, the Frappe page on the right.
  execFileSync("python3", [
    "-c",
    `
import sys
from PIL import Image
out, key = sys.argv[1], sys.argv[2]
for width in (1440, 390):
    a = Image.open(f"{out}/{key}-preview-{width}.png").convert("RGB")
    b = Image.open(f"{out}/{key}-frappe-{width}.png").convert("RGB")
    h = max(a.size[1], b.size[1])
    side = Image.new("RGB", (a.size[0] + b.size[0] + 20, h), (255, 0, 255))
    side.paste(a, (0, 0))
    side.paste(b, (a.size[0] + 20, 0))
    step = 2400 if width == 1440 else 1400
    scale = 1440 / side.size[0] if width == 1440 else 1
    for i, top in enumerate(range(0, h, step)):
        part = side.crop((0, top, side.size[0], min(h, top + step)))
        part.resize((int(part.size[0] * scale), int(part.size[1] * scale))).save(f"{out}/{key}-side-{width}-p{i}.png")
`,
    out,
    model.key,
  ]);
}
await browser.close();
