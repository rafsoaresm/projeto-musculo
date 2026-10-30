import { chromium } from "/home/user/projeto-musculo/node_modules/playwright/index.mjs";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const p = await b.newPage({ viewport: { width: 1700, height: 1000 } });
await p.goto("http://127.0.0.1:8899/builder", { waitUntil: "networkidle" });
await p.getByRole("button", { name: "New", exact: true }).click();
await p.getByText("Start from scratch").click();
await p.waitForTimeout(3000);
// container tool and draw
await p.mouse.click(130, 24);
await p.mouse.move(560, 260); await p.mouse.down(); await p.mouse.move(900, 420, { steps: 8 }); await p.mouse.up();
await p.waitForTimeout(1200);
await p.screenshot({ path: "/tmp/claude-0/scratch/spike/ed-draw.png" });
await b.close();
