import { test, expect, type Browser, type Page } from "@playwright/test";
import { localIP } from "./helpers";
import { AUTOSAVE_DELAY_MS, AUTOSAVE_SAVED, AUTOSAVE_STOPPED, SAVE_UNREACHABLE } from "../../src/modules/meu-site/autosave";
import { closeEditor, editor, inspector, openEditor, panel, startEditor as startSite } from "./site-helpers";

const startEditor = (page: Page) => startSite(page, "Marina Sozinha");
/** A browser with nothing chosen yet: the config of the suite seeds the choice as "off" for every context, and this one asks for none. */
async function freshBrowser(browser: Browser, baseURL: string | undefined) {
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { "cf-connecting-ip": localIP() }, storageState: { cookies: [], origins: [] } });
  return { context, page: await context.newPage() };
}
const title = (page: Page) => inspector(page).getByRole("textbox", { name: "Título do site", exact: true });
const toggle = (page: Page) => editor(page).getByRole("checkbox", { name: "Salvar sozinho" });
const status = (page: Page, text: string) => editor(page).getByText(text, { exact: false });
/** Writes a new title: the draft is now different from what is saved. */
async function retitle(page: Page, text: string) {
  await panel(page, "Propriedades");
  await title(page).fill(text);
}
/** Past the pause after which the draft would have saved itself. */
const pastThePause = (page: Page) => page.waitForTimeout(AUTOSAVE_DELAY_MS + 2000);
const serverActions = (page: Page) => {
  const sent: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.headers()["next-action"]) sent.push(request.url());
  });
  return sent;
};

test("autosave: the draft saves itself after a pause (on by default), can be turned off and stays off in the next visit, and turned on again", async ({ browser, baseURL }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The phone has its own scenario below.");
  test.setTimeout(240_000);
  // A browser with nothing chosen yet, which is "on".
  const actor = await freshBrowser(browser, baseURL);
  const page = actor.page;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await startEditor(page);
  await expect(toggle(page)).toBeChecked();
  await expect(status(page, "Rascunho salvo (revisão 1)")).toBeVisible();

  // ---- a change, a pause, and the draft is saved without a button ----
  await retitle(page, "Marina Sozinha");
  await expect(status(page, "Alterações não salvas")).toBeVisible();
  await expect(status(page, "Rascunho salvo (revisão 2)")).toBeVisible({ timeout: 20_000 });
  await expect(status(page, AUTOSAVE_SAVED)).toBeVisible();
  // It is in the draft, not only on the screen.
  await page.reload();
  await openEditor(page);
  await panel(page, "Propriedades");
  await expect(title(page)).toHaveValue("Marina Sozinha");

  // ---- the pause starts again with each change: typing on does not send anything in the middle (nothing goes to the server before a whole pause) ----
  await expect(toggle(page)).toBeChecked();
  const sent = serverActions(page);
  await title(page).fill("Marina S");
  await page.waitForTimeout(AUTOSAVE_DELAY_MS * 0.6);
  await title(page).fill("Marina Sozinha Treinos");
  await page.waitForTimeout(AUTOSAVE_DELAY_MS * 0.6);
  expect(sent.length, "nothing was sent while the changes went on").toBe(0);
  await expect(status(page, "Alterações não salvas")).toBeVisible();
  await expect(status(page, "Rascunho salvo (revisão 3)")).toBeVisible({ timeout: 20_000 });
  expect(sent.length, "one save for the two changes").toBeGreaterThanOrEqual(1);

  // ---- turned off: nothing is saved without the button, and the choice is there on the next visit ----
  await toggle(page).uncheck();
  await retitle(page, "Marina Manual");
  await pastThePause(page);
  await expect(status(page, "Alterações não salvas")).toBeVisible();
  await expect(status(page, AUTOSAVE_SAVED)).toHaveCount(0);
  await editor(page).getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(status(page, "Rascunho salvo (revisão 4)")).toBeVisible();
  await closeEditor(page);
  await page.reload();
  await openEditor(page);
  await expect(toggle(page)).not.toBeChecked();

  // ---- turned on again: it saves by itself again ----
  await toggle(page).check();
  await retitle(page, "Marina Automática");
  await expect(status(page, "Rascunho salvo (revisão 5)")).toBeVisible({ timeout: 20_000 });
  await actor.context.close();
});

test("autosave: a conflict with another tab stops it (and says so) instead of trying again, and a reload brings it back; a failed connection is said once and the next change tries again", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The computer runs the scenario of the two tabs.");
  test.setTimeout(300_000);
  const actor = await freshBrowser(browser, baseURL);
  const first = actor.page;
  await first.setViewportSize({ width: 1440, height: 1000 });
  await startEditor(first);
  await closeEditor(first);

  // Two tabs of the same person, both at revision 1.
  const second = await actor.context.newPage();
  await second.setViewportSize({ width: 1440, height: 1000 });
  await second.goto("./profissional/meu-site");
  await openEditor(second);
  await openEditor(first);

  // The first tab saves: the second one is now behind.
  await retitle(first, "Título da primeira aba");
  await expect(status(first, "Rascunho salvo (revisão 2)")).toBeVisible({ timeout: 20_000 });

  // ---- the second tab changes something: the save is refused, it is said, and it stops ----
  const sent = serverActions(second);
  await retitle(second, "Título da segunda aba");
  await expect(editor(second).getByText("Outra pessoa salvou o site depois de você abri-lo", { exact: false })).toBeVisible({ timeout: 20_000 });
  await expect(editor(second).getByText(AUTOSAVE_STOPPED)).toBeVisible();
  await expect(status(second, "Alterações não salvas")).toBeVisible();
  const afterConflict = sent.length;
  await retitle(second, "Mais uma mudança na segunda aba");
  await pastThePause(second);
  expect(sent.length, "no attempt after the conflict").toBe(afterConflict);
  await expect(status(second, "Alterações não salvas")).toBeVisible();

  // ---- reloading brings the saved draft and the autosave back ----
  await second.reload();
  await openEditor(second);
  await panel(second, "Propriedades");
  await expect(title(second)).toHaveValue("Título da primeira aba");
  await retitle(second, "Título depois de atualizar");
  await expect(status(second, "Rascunho salvo (revisão 3)")).toBeVisible({ timeout: 20_000 });

  // ---- the connection fails: it is said (once), the text stays, and the next change tries again ----
  await second.route("**/profissional/meu-site", (route) => (route.request().headers()["next-action"] ? route.abort() : route.continue()));
  await retitle(second, "Sem conexão");
  await expect(editor(second).getByText(SAVE_UNREACHABLE)).toBeVisible({ timeout: 20_000 });
  await expect(status(second, "Alterações não salvas")).toBeVisible();
  const afterFailure = sent.length;
  await pastThePause(second);
  expect(sent.length, "the same content is not sent again").toBe(afterFailure);
  await second.unroute("**/profissional/meu-site");
  await retitle(second, "Com conexão de novo");
  await expect(status(second, "Rascunho salvo (revisão 4)")).toBeVisible({ timeout: 20_000 });
  await expect(status(second, AUTOSAVE_SAVED)).toBeVisible();
  await actor.context.close();
});

test("autosave on a phone: the choice is in the header, turns it on, and the draft saves itself", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "The computer has its own scenarios above.");
  test.setTimeout(240_000);
  await startEditor(page);
  // The browser of the suite starts with it off (the config says why): turning it on is what a person does.
  await expect(toggle(page)).not.toBeChecked();
  await toggle(page).check();
  await retitle(page, "Marina no celular");
  await expect(status(page, "Rascunho salvo (revisão 2)")).toBeVisible({ timeout: 20_000 });
  const box = await toggle(page).boundingBox();
  expect(box && box.width).toBeGreaterThanOrEqual(16);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
