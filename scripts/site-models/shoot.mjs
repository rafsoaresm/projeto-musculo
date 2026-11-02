// node scripts/site-models/shoot.mjs <page.html> <out-prefix>: full-page screenshots at 1440 and 390 wide (out-prefix-1440.png, -390.png),
// and the horizontal overflow at each width.
import { chromium } from "playwright";
const [page, prefix] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "/opt/pw-browsers/chromium" });
for (const width of [1440, 390]) {
  const tab = await browser.newPage({ viewport: { width, height: 900 } });
  await tab.goto(`file://${page}`);
  // Lazy images below the fold: scroll through the page so every one loads before the full-page picture.
  await tab.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += 600) {
      window.scrollTo(0, y);
      await new Promise((done) => setTimeout(done, 30));
    }
    window.scrollTo(0, 0);
  });
  await tab.waitForLoadState("networkidle");
  await tab.screenshot({ path: `${prefix}-${width}.png`, fullPage: true });
  const overflow = await tab.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(`${width}: overflow ${overflow}px, height ${await tab.evaluate(() => document.documentElement.scrollHeight)}px`);
  await tab.close();
}
await browser.close();
