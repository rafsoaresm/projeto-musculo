import { chromium } from "playwright";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const t = await b.newPage({ viewport: { width: 1440, height: 900 } });
await t.goto("file://" + process.argv[2]);
console.log(await t.evaluate((sel) => { const e = document.querySelector(sel); const c = getComputedStyle(e); return { border: c.border, bg: c.backgroundColor, radius: c.borderRadius, pad: c.padding }; }, process.argv[3]));
await b.close();
