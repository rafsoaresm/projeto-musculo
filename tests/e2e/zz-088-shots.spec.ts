import { test, expect, type Page } from "@playwright/test";
import { addStudent, createProfessional, localIP, openInvitation, password, showStudentTab, signIn, signOut } from "./helpers";

const DIR = "/tmp/claude-0/-home-user-projeto-musculo/437756eb-90b4-5954-a2ec-e4bf8a130c76/scratchpad/produto";
const WIDTHS = [1440, 1280, 1024, 768, 390];

async function shoot(page: Page, name: string, region: string) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    const target = page.getByRole("region", { name: region });
    await target.evaluate((element) => element.scrollIntoView({ block: "center" }));
    await target.screenshot({ path: `${DIR}/0.88-${name}-${width}.png` });
  }
}

test("0.88 screenshots", async ({ page, browser, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one set of screenshots is enough");
  test.setTimeout(180_000);
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  const address = await createProfessional(page, "Estúdio com um nome bem comprido para ver a quebra de linha", "Profissional com Nome Bastante Longo da Silva");
  const studentURL = await addStudent(page, "Aluna das capturas");
  const { client } = await openInvitation(page, browser, baseURL, "Aluna das capturas");
  await client.page.getByRole("button", { name: "Aceitar convite" }).click();
  await expect(client.page).toHaveURL(/\/aluno\/?$/);
  await page.goto(`${studentURL}/ficha`);
  await page.goto(studentURL);
  await showStudentTab(page, "Acesso e dados");
  await shoot(page, "acessos-aluno", "Acessos aos dados do aluno");

  await client.page.goto("./aluno/conta");
  await shoot(client.page, "aluno-quem-acessou", "Quem acessou os meus dados");
  await client.context.close();

  await page.setViewportSize({ width: 1280, height: 900 });
  await signOut(page);
  for (const attempt of [1, 2]) {
    await page.goto("./entrar");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("E-mail", { exact: true }).fill(address);
    await page.getByLabel("Senha", { exact: true }).fill(`${password}-${attempt}`);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page.locator(".form-error[role=alert]")).toBeVisible();
  }
  await signIn(page, address);
  await page.goto("./profissional/conta");
  await shoot(page, "conta-falhas", "Aparelhos conectados");
});
