import { test, expect } from "@playwright/test";
import { addStudent, createProfessional, localIP, noHorizontalOverflow } from "./helpers";

// The screens of the app on a narrow phone (360), a wide phone (390) and a tablet (768): nothing sticks out to the side, and the five tabs of the bottom bar
// show their names whole. The scenarios of each module look at their own screens in detail; this one only watches that none of them stops fitting.
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

test("the screens of the professional fit narrow windows, and the bottom bar names its tabs whole", async ({ page }, testInfo) => {
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
    await expect(page.locator(".mobile-nav")).toBeVisible();
    const clipped = await page.evaluate(() => [...document.querySelectorAll(".mobile-nav span")].filter((el) => el.scrollWidth > el.clientWidth).map((el) => el.textContent));
    expect(clipped, `the tabs at ${width}px`).toEqual([]);
  }
});
