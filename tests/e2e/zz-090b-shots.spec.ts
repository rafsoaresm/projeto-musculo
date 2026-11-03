import { test } from "@playwright/test";
import { createProfessional, localIP } from "./helpers";

const OUT = "/tmp/claude-0/-home-user-projeto-musculo/437756eb-90b4-5954-a2ec-e4bf8a130c76/scratchpad/produto";

test("0.90b screenshots of the name histories", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio Movimento Consciente", "Marina Configuradora");
  await page.goto("./profissional/configuracoes");
  const rename = async (form: string, label: string, value: string, saved: string) => {
    const f = page.getByRole("form", { name: form });
    await f.getByRole("textbox", { name: label }).fill(value);
    await f.getByRole("button", { name: "Salvar" }).click();
    await page.getByText(saved).waitFor();
    await page.reload();
  };
  await rename("Alterar o nome do espaço", "Nome do espaço", "Estúdio Movimento Consciente e Treinamento Funcional", "Nome do espaço salvo.");
  await rename("Alterar o nome do espaço", "Nome do espaço", "Estúdio MC", "Nome do espaço salvo.");
  await rename("Alterar o nome de exibição", "Nome de exibição", "Marina Souza", "Nome de exibição salvo.");
  for (const width of [1440, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.reload();
    const section = page.locator(".name-history").first().locator("xpath=ancestor::section");
    await page.locator("#espaco-historico").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/0.90b-configuracoes-historico-${width}.png`, fullPage: true });
    await section.screenshot({ path: `${OUT}/0.90b-configuracoes-historico-espaco-${width}.png` });
    const metrics = await page.evaluate(() =>
      [...document.querySelectorAll(".name-history table")].map((t) =>
        [...t.querySelectorAll("tbody tr:first-child > *")].map((c) => {
          const r = c.getBoundingClientRect();
          return `${Math.round(r.x)}/${Math.round(r.width)}/${Math.round(r.height)}`;
        }),
      ),
    );
    console.log(width, JSON.stringify(metrics), await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth));
  }
});
