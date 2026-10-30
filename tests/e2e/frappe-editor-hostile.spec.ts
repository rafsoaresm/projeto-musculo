import { test, expect, type Page } from "@playwright/test";
import { createProfessional, localIP, policyRefusals, trackPolicy } from "./helpers";

/** What the editor asks of its server, asked the way the editor asks (same origin, with the header that marks its calls). */
const asEditor = async (page: Page, method: string, params: Record<string, unknown>) => {
  const response = await page.request.post(`./api/builder-editor/api/method/${method}`, { headers: { "x-site-request": "1" }, data: params });
  return { status: response.status(), body: (await response.json()) as { message?: Record<string, unknown> } };
};

type Marked = { __pwned?: string };

test("frappe editor, hostile page: what a person writes into a block (free HTML, a drawing with handlers, a div with markup, a frame with a javascript: address) is shown but never runs in the page of the app, whoever opens it", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The editor is a tool for a computer.");
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1700, height: 1000 });
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  // Every attempt marks the window; the policy of the editor reports what it refused.
  await trackPolicy(page);
  const unique = crypto.randomUUID().slice(0, 8);
  await createProfessional(page, `Estúdio ${unique}`, "Marina Hostil");
  await page.goto("./profissional/meu-site");
  await page.getByRole("form", { name: "Criar o meu site" }).getByRole("button", { name: "Criar meu site" }).click();

  const mark = (what: string) => `window.__pwned = (window.__pwned || '') + '${what};'; window.parent.__pwned = (window.parent.__pwned || '') + '${what};'`;
  const blocks = JSON.stringify([
    {
      blockId: "root",
      originalElement: "body",
      element: "div",
      children: [
        { blockId: "h1", originalElement: "__raw_html__", element: "div", innerHTML: `<p id="raw-text">texto livre</p><img src="x" onerror="${mark("raw-img")}"><script>${mark("raw-script")}</script>` },
        {
          blockId: "h2",
          originalElement: "__raw_html__",
          element: "div",
          innerHTML: `<svg id="drawing" width="60" height="30" onload="${mark("svg-load")}"><circle id="dot" r="10" cx="20" cy="15" onclick="${mark("svg-click")}"/><script>${mark("svg-script")}</script><a id="link" href="javascript:${mark("svg-href")}"><rect width="5" height="5"/></a><style>body{display:none}</style><foreignObject><div onclick="${mark("fo")}">x</div></foreignObject></svg>`,
        },
        { blockId: "h3", element: "div", innerHTML: `<b id="div-markup" onmouseover="${mark("div-hover")}">negrito</b><img src="x" onerror="${mark("div-img")}">` },
        { blockId: "h4", element: "iframe", attributes: { src: `javascript:${mark("iframe")}` } },
        { blockId: "h5", element: "div", attributes: { onmouseover: mark("attr"), onclick: mark("attr2") }, innerHTML: "" },
      ],
    },
  ]);
  const made = await asEditor(page, "frappe.client.insert", { doc: { doctype: "Builder Page", page_title: "Hostil", route: "hostil", blocks: "[]", draft_blocks: blocks } });
  expect(made.status).toBe(200);
  const pageName = String(made.body.message!.name);

  // ---- the editor answers with its policy ----
  const answered = await page.request.get("./profissional/meu-site/editor");
  const policy = answered.headers()["content-security-policy"] ?? "";
  expect(policy).toMatch(/script-src 'self' 'nonce-[0-9a-f]{32}'(;|$)/);
  expect(policy.split("; ").find((part) => part.startsWith("script-src"))).not.toMatch(/unsafe-inline|unsafe-eval/);
  expect((await page.request.get("./profissional/meu-site/editor")).headers()["content-security-policy"]).not.toBe(policy); // a nonce for each answer

  // ---- the page is opened in the editor, and everything on it is drawn ----
  await page.goto(`./profissional/meu-site/editor/page/${pageName}`);
  await expect(page.getByText("body", { exact: true }).first()).toBeVisible();
  // Free HTML and a block with markup are shown in frames that run nothing; the drawing is in the page, cleaned.
  await expect(page.locator('iframe[sandbox=""]')).toHaveCount(2, { timeout: 20_000 });
  const framed = await page.locator('iframe[sandbox=""]').evaluateAll((frames) => frames.map((frame) => (frame as HTMLIFrameElement).srcdoc));
  expect(framed.some((doc) => doc.includes("texto livre"))).toBe(true);
  expect(framed.some((doc) => doc.includes("negrito"))).toBe(true);
  await expect(page.locator("svg#drawing")).toHaveCount(1);
  await expect(page.locator("svg#drawing circle#dot")).toHaveCount(1);
  expect(await page.locator("svg#drawing").evaluate((svg) => ({ scripts: svg.querySelectorAll("script, style, foreignObject").length, handlers: [svg, ...svg.querySelectorAll("*")].filter((element) => [...element.attributes].some((attribute) => attribute.name.startsWith("on"))).length, links: [...svg.querySelectorAll("a")].map((a) => a.getAttribute("href")) }))).toEqual({ scripts: 0, handlers: 0, links: [null] });

  // ---- a person pointing at things does not set anything off, and nothing ran: not in the app's window, not in any frame ----
  await page.locator("svg#drawing circle#dot").hover({ force: true }).catch(() => undefined);
  await page.waitForTimeout(2500);
  // A sandboxed frame has no script context to ask (that is the point): it answers "blocked" instead of hanging the question.
  const ask = (frame: ReturnType<Page["frames"]>[number]) =>
    Promise.race([frame.evaluate(() => (window as unknown as Marked).__pwned ?? null).catch(() => "blocked"), new Promise<string>((resolve) => setTimeout(() => resolve("blocked"), 3000))]);
  const results = await Promise.all(page.frames().map(ask));
  for (const result of results) expect(result === null || result === "blocked", String(result)).toBe(true);
  // The policy refused the attempts that reached the app's own page (a handler of a block, a javascript: address); the sandboxed frame needed no refusal.
  const refused = await policyRefusals(page);
  expect(refused.length).toBeGreaterThan(0);
  expect(refused.every((entry) => /^(script-src|script-src-elem|script-src-attr|frame-src|default-src)/.test(entry)), JSON.stringify(refused)).toBe(true);
});
