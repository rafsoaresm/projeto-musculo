import { test, expect } from "@playwright/test";
import { addStudent, createProfessional, localIP, noHorizontalOverflow } from "./helpers";

const GROUPS = [
  ["PRINCIPAL", ["Visão geral", "Alunos", "Avaliações", "Planos e treinos", "Biblioteca de exercícios"]],
  ["COMERCIAL", ["Meu Site", "Leads", "Serviços"]],
  ["CONTA E EQUIPE", ["Configurações", "Minha conta"]],
] as const;
const ALL = GROUPS.flatMap(([, labels]) => labels);

test("navigation V4 on a computer: the ten destinations in three groups, one item lit by the address, kept on reload and on Back", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The phone has its own scenario.");
  test.setTimeout(180_000);
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, `Estúdio ${crypto.randomUUID().slice(0, 8)}`, "Marina Navegação");
  const nav = page.getByRole("navigation", { name: "Navegação de Profissional de educação física" });
  await expect(nav.getByRole("link")).toHaveText([...ALL]);
  for (const [group] of GROUPS) await expect(nav.getByText(group, { exact: true })).toBeVisible();
  // Groups are labels, never links.
  for (const [group] of GROUPS) await expect(nav.getByRole("link", { name: group })).toHaveCount(0);
  await expect(page.getByText("TRAINER / RX")).toBeVisible();
  await expect(page.getByText("ÁREA PROFISSIONAL", { exact: true })).toBeVisible();
  await expect(page.getByText("TRAINER PRESCRIPTION", { exact: true })).toBeVisible();

  const lit = () => nav.locator('[aria-current="page"]');
  const student = await addStudent(page, "Ana Navegação");
  const cases: Array<[string, string]> = [
    ["./profissional", "Visão geral"],
    [student, "Alunos"],
    [`${student}/ficha`, "Alunos"],
    [`${student}/planos/novo`, "Planos e treinos"],
    ["./profissional/prescricao", "Planos e treinos"],
    ["./profissional/periodizacao", "Planos e treinos"],
    ["./profissional/avaliacoes", "Avaliações"],
    ["./profissional/biblioteca", "Biblioteca de exercícios"],
    ["./profissional/meu-site", "Meu Site"],
    ["./profissional/leads/mensagens", "Leads"],
    ["./profissional/servicos", "Serviços"],
    ["./profissional/configuracoes", "Configurações"],
    ["./profissional/conta", "Minha conta"],
  ];
  for (const [path, label] of cases) {
    await page.goto(path);
    await expect(lit(), path).toHaveCount(1);
    await expect(lit(), path).toHaveText(label);
  }
  await page.reload();
  await expect(lit()).toHaveText("Minha conta");
  await page.goBack();
  await expect(lit()).toHaveText("Configurações");
  // The address the V4 gives the module leads to it, and the simulator is reached from it.
  await page.goto("./profissional/planos");
  await expect(page).toHaveURL(/\/profissional\/prescricao$/);
  await expect(page.getByRole("heading", { name: "Planos e treinos", level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Simulador de ciclos" }).click();
  await expect(page.getByRole("heading", { name: "Simulador de ciclos", level: 1 })).toBeVisible();
  await expect(lit()).toHaveText("Planos e treinos");
  await page.goto("./profissional");
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 850 });
    await noHorizontalOverflow(page);
  }
});

test("navigation V4 on a phone: the menu is a drawer opened from the top bar, with the same ten destinations, that holds the focus and gives it back", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, `Estúdio ${crypto.randomUUID().slice(0, 8)}`, "Marina Gaveta");
  for (const width of [360, 390, 430, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("./profissional/meu-site");
    await expect(page.locator(".mobile-nav")).toHaveCount(0);
    const opener = page.getByRole("button", { name: "Menu" });
    await expect(opener).toBeVisible();
    // Never open by itself.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await opener.click();
    const drawer = page.getByRole("dialog", { name: "Menu de Profissional de educação física" });
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute("aria-modal", "true");
    // The ten destinations come first, in order (the areas a person can switch to, if any, follow them).
    const names = (await drawer.getByRole("link").allInnerTexts()).map((name) => name.trim());
    expect(names.slice(0, ALL.length)).toEqual([...ALL]);
    await expect(drawer.locator('[aria-current="page"]')).toHaveText("Meu Site");
    // The focus starts in the drawer, goes round inside it, and Escape gives it back to the button.
    await expect(drawer.getByRole("button", { name: "Fechar" })).toBeFocused();
    for (let n = 0; n < 20; n++) {
      await page.keyboard.press("Tab");
      expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await expect(opener).toBeFocused();
    // Fechar and a tap outside close it too.
    await opener.click();
    await page.getByRole("dialog").getByRole("button", { name: "Fechar" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await opener.click();
    await page.mouse.click(width - 10, 400);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // A destination is reached and the drawer is gone on the new page.
    await opener.click();
    await page.getByRole("dialog").getByRole("link", { name: "Leads" }).click();
    await expect(page).toHaveURL(/\/profissional\/leads$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await noHorizontalOverflow(page);
  }
});
