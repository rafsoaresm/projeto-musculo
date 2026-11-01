import { test, expect } from "@playwright/test";
import { addStudent, createProfessional, localIP, noHorizontalOverflow } from "./helpers";

// The screens of the app on a narrow phone (360), a wide phone (390) and a tablet (768): nothing sticks out to the side, and the menu opens from the top
// bar (handoff V4, section 5.1: no bottom bar for the professional). The scenarios of each module look at their own screens in detail.
const SCREENS = [
  "./profissional",
  "./profissional/alunos",
  "./profissional/avaliacoes",
  "./profissional/periodizacao",
  "./profissional/prescricao",
  "./profissional/biblioteca",
  "./profissional/leads",
  "./profissional/servicos",
  "./profissional/meu-site",
  "./profissional/configuracoes",
];

test("the screens of the professional fit narrow windows, and the menu opens from the top bar", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The window is set by the scenario itself.");
  test.setTimeout(240_000);
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, `Estúdio ${crypto.randomUUID().slice(0, 8)}`, "Marina Responsiva");
  const student = await addStudent(page, "Ana Souza da Silva Pereira");
  for (const width of [360, 390, 768]) {
    await page.setViewportSize({ width, height: 800 });
    for (const path of [...SCREENS, student]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await noHorizontalOverflow(page);
    }
    await page.goto("./profissional");
    await expect(page.locator(".mobile-nav")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Menu" })).toBeVisible();
  }
});
