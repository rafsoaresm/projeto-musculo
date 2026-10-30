import { test, expect, type Page } from "@playwright/test";
import { createProfessional, localIP, newActor, policyRefusals, trackPolicy } from "./helpers";

/** What the editor asks of its server, asked the way the editor asks (same origin, with the header that marks its calls). */
const asEditor = async (page: Page, method: string, params: Record<string, unknown>) => {
  const response = await page.request.post(`./api/builder-editor/api/method/${method}`, { headers: { "x-site-request": "1" }, data: params });
  return { status: response.status(), body: (await response.json()) as { message?: Record<string, unknown> } };
};

const node = (element: string, attributes: Record<string, string> = {}, more: Record<string, unknown> = {}) => ({ blockId: crypto.randomUUID().slice(0, 8), element, attributes, ...more });
const body = (...children: unknown[]) => JSON.stringify([{ blockId: "root", originalElement: "body", element: "div", baseStyles: { display: "flex", flexDirection: "column", padding: "16px", gap: "12px" }, children }]);
const html = (innerHTML: string, baseStyles: Record<string, string> = {}) => node("div", {}, { originalElement: "__raw_html__", innerHTML, baseStyles });

/** Code that tries everything a hostile block would: to read the site's cookies and storage, to reach into the page that holds it, to move that page, and to call the site. */
const PROBE = `<div id="calc"></div><pre id="probe"></pre>
<script>
const result = {};
const attempt = (name, fn) => { try { result[name] = String(fn()); } catch (error) { result[name] = 'blocked:' + error.name; } };
document.getElementById('calc').textContent = String(6 * 7);
attempt('cookie', () => document.cookie);
attempt('storage', () => localStorage.length);
attempt('parentDocument', () => parent.document.title);
attempt('topLocation', () => top.location.href);
attempt('origin', () => self.origin);
attempt('moveTop', () => { if (top === window) return 'is the top'; top.location.href = 'about:blank'; return 'tried'; }); // opened by itself, the document is the top: it would only move itself
attempt('markParent', () => { parent.__pwned = 'yes'; return parent.__pwned; });
fetch('/api/health').then(() => { result.fetch = 'reached'; }).catch((error) => { result.fetch = 'blocked:' + error.name; }).finally(() => { document.getElementById('probe').textContent = JSON.stringify(result); });
</script>`;

async function publish(page: Page, route: string, title: string, blocks: string) {
  const made = await asEditor(page, "frappe.client.insert", { doc: { doctype: "Builder Page", page_title: title, route, blocks: "[]", draft_blocks: blocks } });
  expect(made.status).toBe(200);
  const name = String(made.body.message!.name);
  expect((await asEditor(page, "run_doc_method", { dt: "Builder Page", dn: name, method: "publish", args: {} })).status).toBe(200);
  return name;
}

const panel = (page: Page) => page.getByRole("region", { name: "Editor novo (Frappe Builder)" });

test("frappe code: free code on a published page is a frame that runs it and reaches nothing of the site, the page holds none of it, and the switch of the site is the only way it gets the network", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(240_000);
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  const unique = crypto.randomUUID().slice(0, 8);
  await createProfessional(page, `Estúdio ${unique}`, "Marina Código");
  const slug = `estudio-${unique}`;
  await page.goto("./profissional/meu-site");
  await page.getByRole("form", { name: "Criar o meu site" }).getByRole("button", { name: "Criar meu site" }).click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByText("Nenhuma página no ar tem código livre.")).toBeVisible();
  await expect(panel(page)).toContainText("O código não carrega nada de fora");

  // ---- a page with free code (one that is only itself, one that asks for a script of another site), a video frame, a drawing, a line of marked text and plain text ----
  const drawing = '<svg id="logo" width="40" height="40" viewBox="0 0 4 4"><circle cx="2" cy="2" r="1.5" onclick="window.__pwned=1"/></svg>';
  await publish(
    page,
    "codigo",
    "Código",
    body(
      node("h1", {}, { innerHTML: "Calculadora" }),
      html(PROBE, { width: "300px", height: "200px" }),
      html('<script src="https://cdn.test/widget.js"></script><div id="w">widget</div>', { width: "280px", height: "100px" }),
      node("iframe", { src: "https://www.youtube.com/embed/abc", allow: "autoplay; fullscreen" }, { baseStyles: { width: "280px", height: "160px" } }),
      html(drawing),
      html("<p>—Aldous <b>Huxley</b>,</p>"),
    ),
  );

  // ---- the panel counts the code of the page and says which asks for something outside ----
  await page.goto("./profissional/meu-site");
  const code = panel(page).getByRole("list", { name: "Código livre das páginas no ar" });
  await expect(code.getByRole("listitem")).toHaveCount(1);
  await expect(code).toContainText("Código (/codigo): 3 blocos de código, 2 pedem algo de fora: não vai aparecer enquanto o código não puder carregar coisas de outros sites.");

  // ---- a visitor: the page holds the frames and not the code ----
  const visit = await newActor(browser, baseURL);
  const visitor = visit.page;
  await visitor.goto(`./site/${slug}/codigo`);
  await expect(visitor.getByRole("heading", { name: "Calculadora" })).toBeVisible();
  const frames = visitor.locator('iframe[sandbox="allow-scripts"]');
  await expect(frames).toHaveCount(3);
  await expect(visitor.locator("iframe")).toHaveCount(3);
  await expect(visitor.locator("script")).toHaveCount(0);
  const page0 = await visitor.content();
  expect(page0).not.toMatch(/6 \* 7|getElementById|widget\.js|youtube|allow-same-origin|srcdoc/);
  const sources = await frames.evaluateAll((list) => list.map((frame) => frame.getAttribute("src")));
  // Written from where the page is: the page is one level below the address of the site, so two steps up (and the same under any mount path).
  expect(sources.map(String), JSON.stringify(sources)).toEqual([0, 1, 2].map((index) => expect.stringMatching(new RegExp(`^\\.\\./\\.\\./site/${slug}/m/codigo/[A-Za-z0-9_-]+/${index}$`))));
  // The drawing is in the page (cleaned: its handler is gone), and so is the line of marked text; neither is a frame.
  await expect(visitor.locator("svg#logo circle")).toHaveCount(1);
  expect(await visitor.locator("svg#logo circle").evaluate((circle) => circle.hasAttribute("onclick"))).toBe(false);
  await expect(visitor.getByText("Huxley")).toBeVisible();
  // The block has the size the person gave it.
  const box = (await frames.first().boundingBox())!;
  expect([Math.round(box.width), Math.round(box.height)]).toEqual([300, 200]);
  expect(await visitor.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

  // ---- the code runs in its frame, and everything it tried against the site and the page came to nothing ----
  const first = visitor.frameLocator('iframe[sandbox="allow-scripts"]').first();
  await expect(first.locator("#calc")).toHaveText("42");
  await expect(first.locator("#probe")).not.toBeEmpty();
  const probe = JSON.parse((await first.locator("#probe").textContent()) ?? "{}") as Record<string, string>;
  expect(probe).toMatchObject({
    cookie: "blocked:SecurityError",
    storage: "blocked:SecurityError",
    parentDocument: "blocked:SecurityError",
    topLocation: "blocked:SecurityError",
    origin: "null",
    fetch: "blocked:TypeError",
  });
  await visitor.waitForTimeout(1500);
  expect(visitor.url()).toMatch(new RegExp(`/site/${slug}/codigo$`)); // the code did not move the page
  expect(await visitor.evaluate(() => (window as unknown as { __pwned?: string }).__pwned ?? null)).toBeNull();
  expect(await visitor.title()).not.toBe("");
  // A script of another site is refused while the switch is closed: its block shows nothing, and the page says nothing is wrong.
  await expect(visitor.frameLocator('iframe[sandbox="allow-scripts"]').nth(1).locator("#w")).toHaveText("widget");

  // ---- opened by itself (a person pasting the address of a frame), it is the same walled-in document ----
  const direct = await newActor(browser, baseURL);
  const frameAddress = new URL(String(sources[0]), visitor.url()).href;
  await direct.page.goto(frameAddress);
  await expect(direct.page.locator("#probe")).not.toBeEmpty();
  expect(JSON.parse((await direct.page.locator("#probe").textContent()) ?? "{}")).toMatchObject({ cookie: "blocked:SecurityError", storage: "blocked:SecurityError", origin: "null" });
  await direct.context.close();

  // ---- what the frames are served with: closed by default, and the address of a frame that is not there is not found ----
  const policyOf = async () => (await visitor.request.get(frameAddress)).headers()["content-security-policy"] ?? "";
  const closed = await policyOf();
  expect(closed).toContain("sandbox allow-scripts");
  expect(closed).not.toContain("allow-same-origin");
  expect(closed).not.toContain("https:");
  expect((await visitor.request.get(frameAddress.replace(/\/0$/, "/9"))).status()).toBe(404);
  expect((await visitor.request.get(frameAddress.replace(/\/[^/]+\/0$/, "/nao-existe/0"))).status()).toBe(404);

  // ---- the switch of the site: the owner opens it (a line of warning in the panel), and the frames are served with https: at the next request ----
  await expect(panel(page).getByRole("button", { name: "Deixar o código carregar coisas de outros sites" })).toBeVisible();
  await expect(panel(page)).toContainText("manda o seu endereço de internet");
  await panel(page).getByRole("button", { name: "Deixar o código carregar coisas de outros sites" }).click();
  await expect(panel(page).getByText("O código livre das páginas passou a poder carregar coisas de outros sites (https).")).toBeVisible();
  await expect(panel(page)).toContainText("O código pode carregar coisas de outros sites (https)");
  const opened = await policyOf();
  expect(opened).toContain("script-src 'unsafe-inline' 'unsafe-eval' https:");
  expect(opened).toContain("sandbox allow-scripts");
  expect(opened).not.toContain("allow-same-origin");
  await expect(code).toContainText("2 pedem algo de fora.");
  // The code still reaches nothing of the site, with the network open.
  await visitor.reload();
  const reopened = JSON.parse((await visitor.frameLocator('iframe[sandbox="allow-scripts"]').first().locator("#probe").textContent({ timeout: 15_000 })) ?? "{}") as Record<string, string>;
  expect(reopened).toMatchObject({ cookie: "blocked:SecurityError", storage: "blocked:SecurityError", parentDocument: "blocked:SecurityError", origin: "null" });

  // ---- and closed again ----
  await panel(page).getByRole("button", { name: "Bloquear de novo o que o código carrega de fora" }).click();
  await expect(panel(page).getByText("O código livre das páginas deixou de poder carregar coisas de outros sites.")).toBeVisible();
  expect(await policyOf()).toBe(closed);
  await visit.context.close();
});

test("frappe code, from the editor itself: the Embed template of the library is text until code is pasted in it, the YouTube one is not offered, and nothing the editor does is refused by its policy", async ({ page, browser, baseURL }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The editor is a tool for a computer.");
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1700, height: 1000 });
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  const unique = crypto.randomUUID().slice(0, 8);
  await createProfessional(page, `Estúdio ${unique}`, "Marina Embed");
  const slug = `estudio-${unique}`;
  await page.goto("./profissional/meu-site");
  await page.getByRole("form", { name: "Criar o meu site" }).getByRole("button", { name: "Criar meu site" }).click();
  await expect(panel(page)).toBeVisible();

  await trackPolicy(page);
  await page.goto("./profissional/meu-site/editor");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByText("Start from scratch").click();
  await expect(page.getByText("body", { exact: true }).first()).toBeVisible();
  const pageName = new URL(page.url()).pathname.split("/").pop()!;
  await page.mouse.click(28, 76);
  await page.getByPlaceholder("Search Template").fill("youtube");
  await expect(page.getByText("YouTube", { exact: true })).toHaveCount(0);
  await page.getByPlaceholder("Search Template").fill("embed");
  const card = page.getByText("Embed", { exact: true }).first();
  await expect(card).toBeVisible();
  const read = async () => {
    const answer = await asEditor(page, "frappe.client.get", { doctype: "Builder Page", name: pageName });
    return (answer.body.message ?? {}) as Record<string, unknown>;
  };
  await expect(async () => {
    const box = (await card.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y - 20);
    await page.mouse.down();
    await page.mouse.move(700, 400, { steps: 12 });
    await page.mouse.move(890, 420, { steps: 12 });
    await page.mouse.up();
    await expect.poll(async () => String((await read()).draft_blocks ?? ""), { timeout: 4000 }).toContain("Paste HTML or double click to edit");
  }).toPass({ timeout: 40_000 });
  // The block is drawn in the canvas inside a frame that runs nothing, and the editor's policy refused nothing.
  await expect(page.locator('iframe[sandbox=""]').first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect.poll(async () => Number((await read()).published), { timeout: 30_000 }).toBe(1);
  expect(await policyRefusals(page)).toEqual([]);

  // ---- on the site the template is the line it holds: text, and not a frame, until someone pastes code in it ----
  await page.goto("./profissional/meu-site");
  await expect(panel(page).getByText("Nenhuma página no ar tem código livre.")).toBeVisible();
  const visit = await newActor(browser, baseURL);
  await visit.page.goto(`./site/${slug}`);
  await expect(visit.page.getByText("Paste HTML or double click to edit")).toBeVisible();
  await expect(visit.page.locator("iframe")).toHaveCount(0);
  await visit.context.close();
});
