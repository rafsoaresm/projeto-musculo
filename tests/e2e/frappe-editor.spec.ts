import { test, expect, type Page } from "@playwright/test";
import { createProfessional, localIP, newActor } from "./helpers";

/** What the editor reads from its server, asked the way the editor asks (same origin, with the header that marks its calls). */
const asEditor = (page: Page, method: string, params: Record<string, unknown>) =>
  page.evaluate(
    async ([name, body]) => {
      const base = (window as unknown as { __EDITOR_API__: string }).__EDITOR_API__;
      const response = await fetch(`${base}/api/method/${name}`, { method: "POST", headers: { "content-type": "application/json", "x-site-request": "1" }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    },
    [method, params] as const,
  );

test("frappe editor: opens under the mount with nothing fixed to the root and nothing from outside, makes a page that is still there after a reload, and keeps organizations apart", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The editor is a tool for a computer.");
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1700, height: 1000 });
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  const unique = crypto.randomUUID().slice(0, 8);
  await createProfessional(page, `Estúdio ${unique}`, "Marina Frappe");

  const origin = new URL(baseURL!).origin;
  const mount = new URL(baseURL!).pathname.replace(/\/$/, "");
  const outside: string[] = [];
  const calls: string[] = [];
  const files: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url.startsWith("data:") || url.startsWith("blob:") || url === "about:blank") return;
    if (!url.startsWith(`${origin}/`)) return void outside.push(url);
    const path = new URL(url).pathname;
    if (path.includes("/api/")) calls.push(path);
    if (path.includes("/frappe-editor/")) files.push(path);
  });

  // ---- the editor opens, and is the editor of Frappe Builder ----
  // The way in is the Meu Site screen: a link that works under any mount path.
  await page.goto("./profissional/meu-site");
  await page.getByRole("link", { name: "Abrir o editor novo" }).click();
  await expect(page).toHaveURL(new RegExp(`${mount}/profissional/meu-site/editor/?$`));
  await expect(page.getByRole("heading", { name: "All Pages" })).toBeVisible();
  await expect(page.getByText("You don't have any pages yet", { exact: false })).toBeVisible();

  // ---- a page from scratch, and a container drawn on it ----
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByText("Start from scratch").click();
  await expect(page).toHaveURL(new RegExp(`${mount}/profissional/meu-site/editor/page/[a-z0-9-]+$`));
  const pageName = new URL(page.url()).pathname.split("/").pop()!;
  await expect(page.getByText("Select a block to edit properties")).toBeVisible();
  // "c" is the shortcut of the container tool.
  await page.keyboard.press("c");
  await page.mouse.move(560, 260);
  await page.mouse.down();
  await page.mouse.move(900, 420, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByText("container", { exact: true }).first()).toBeVisible();
  // The panel of properties is the one that lets the person write any color: a hexadecimal, not a closed list.
  await expect(page.getByText("Background", { exact: true })).toBeVisible();
  await expect
    .poll(() => page.locator("input").evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value)))
    .toContain("#ededed");

  // ---- it is saved in the database of the organization, not in the browser ----
  const draft = async () => {
    const answer = await asEditor(page, "frappe.client.get", { doctype: "Builder Page", name: pageName });
    return String((answer.body as { message?: { draft_blocks?: string } }).message?.draft_blocks ?? "");
  };
  await expect.poll(draft, { timeout: 30_000 }).toMatch(/"children":\[\{/);
  await page.reload();
  await expect(page.getByText("container", { exact: true }).first()).toBeVisible();

  // ---- every call went to the editor's address under the mount, every file came from here, and nothing went anywhere else ----
  expect(outside, "nothing is asked of another site").toEqual([]);
  expect(calls.length).toBeGreaterThan(0);
  for (const path of calls) expect(path.startsWith(`${mount}/api/builder-editor/api/method/`), path).toBe(true);
  expect(files.length).toBeGreaterThan(10);
  for (const path of files) expect(path.startsWith(`${mount}/frappe-editor/`), path).toBe(true);

  // ---- another organization sees none of it ----
  const other = await newActor(browser, baseURL);
  const stranger = other.page;
  await createProfessional(stranger, `Outro ${unique}`, "Outra Pessoa");
  await stranger.goto("./profissional/meu-site/editor");
  await expect(stranger.getByText("You don't have any pages yet", { exact: false })).toBeVisible();
  const taken = await asEditor(stranger, "frappe.client.get", { doctype: "Builder Page", name: pageName });
  expect(taken.status).toBe(404);
  const listed = await asEditor(stranger, "frappe.client.get_list", { doctype: "Builder Page" });
  expect((listed.body as { message: unknown[] }).message).toEqual([]);
  await other.context.close();

  // ---- without a login: no editor, no answers; without the header of the editor: no answers either ----
  const visitor = await newActor(browser, baseURL);
  await visitor.page.goto("./profissional/meu-site/editor");
  await expect(visitor.page).toHaveURL(new RegExp(`${mount}/entrar`));
  await expect(visitor.page.getByRole("heading", { name: "All Pages" })).toHaveCount(0);
  const call = "./api/builder-editor/api/method/frappe.client.get_list";
  expect((await visitor.page.request.post(call, { headers: { "x-site-request": "1" }, data: { doctype: "Builder Page" } })).status()).toBe(401);
  expect((await page.request.post(call, { data: { doctype: "Builder Page" } })).status()).toBe(400);
  expect((await page.request.post("./api/builder-editor/frappe.client.get_list", { headers: { "x-site-request": "1" }, data: {} })).status()).toBe(404);
  expect((await page.request.post(call, { headers: { "x-site-request": "1" }, data: { doctype: "User" } })).status()).toBe(403);
  await visitor.context.close();
});
