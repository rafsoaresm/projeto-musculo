import { test, expect } from "@playwright/test";
import { addStudent, createProfessional, localIP, newActor, noHorizontalOverflow, showStudentTab } from "./helpers";

const tabs = (page: import("@playwright/test").Page) => page.getByRole("tablist", { name: "Ficha do aluno" });

test("the student's record: a header with the portal and the next action, tabs that keep their place, and nothing invented on the Resumo", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio da ficha com abas");
  const studentURL = await addStudent(page, "Aluna das abas");

  // Header: who, the portal as it is, and the one next action (a new student has no file yet).
  await expect(page.getByText("Ficha do aluno", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Aluna das abas · Sem acesso ao portal")).toBeVisible();
  await expect(page.getByRole("link", { name: "Próxima ação: preencher a ficha" })).toBeVisible();

  // The Figma's five tabs, in its order, and Acesso e dados; Resumo opens first.
  await expect(tabs(page).getByRole("tab")).toHaveText(["Resumo", "Avaliação Física", "Periodização", "Treinos", "Evolução", "Acesso e dados"]);
  await expect(tabs(page).getByRole("tab", { name: "Resumo" })).toHaveAttribute("aria-selected", "true");

  // Resumo: the timeline says what is missing, without dates or steps that did not happen; the invitation is not here (AC05.4).
  const steps = page.getByRole("list", { name: "Etapas do aluno" }).getByRole("listitem");
  await expect(steps).toHaveText(["Cadastro salvo", /Nenhuma avaliação física registrada/, /Nenhum plano salvo/, /Nenhum plano entregue/, /Nenhum treino registrado pelo aluno/]);
  await expect(page.getByRole("heading", { name: "Informações relevantes" })).toBeVisible();
  await expect(page.getByText("A ficha ainda não foi preenchida")).toBeVisible();
  await expect(page.getByRole("button", { name: "Gerar link de convite" })).toHaveCount(0);
  await noHorizontalOverflow(page);

  // Keyboard: the arrows move between the tabs (and wrap), Home and End go to the ends.
  await tabs(page).getByRole("tab", { name: "Resumo" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs(page).getByRole("tab", { name: "Avaliação Física" })).toBeFocused();
  await expect(page.getByText("Este aluno ainda não tem avaliação física.", { exact: false })).toBeVisible();
  await page.keyboard.press("End");
  await expect(tabs(page).getByRole("tab", { name: "Acesso e dados" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(tabs(page).getByRole("tab", { name: "Resumo" })).toHaveAttribute("aria-selected", "true");

  // The open tab is in the address: a reload keeps it (AC05.2), and an unknown one opens Resumo.
  await showStudentTab(page, "Periodização");
  await expect(page).toHaveURL(/\?aba=periodizacao$/);
  await page.reload();
  await expect(tabs(page).getByRole("tab", { name: "Periodização" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("link", { name: "Novo plano" })).toBeVisible();
  await page.goto(`${studentURL}?aba=nada`);
  await expect(tabs(page).getByRole("tab", { name: "Resumo" })).toHaveAttribute("aria-selected", "true");

  // An old link to a section opens its tab.
  await page.goto(`${studentURL}#pedidos`);
  await expect(tabs(page).getByRole("tab", { name: "Acesso e dados" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Pedidos do aluno sobre os dados dele" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Gerar link de convite" })).toBeVisible();

  // A sub-page goes back to the tab it came from (AC05.1).
  await showStudentTab(page, "Periodização");
  await page.getByRole("link", { name: "Novo plano" }).click();
  await page.getByRole("link", { name: "Voltar ao aluno" }).click();
  await expect(tabs(page).getByRole("tab", { name: "Periodização" })).toHaveAttribute("aria-selected", "true");

  // Another organization does not see the record by its address.
  const other = await newActor(browser, baseURL);
  await createProfessional(other.page, "Outro estúdio das abas");
  const response = await other.page.goto(studentURL);
  expect(response?.status()).toBe(404);
  await expect(other.page.getByRole("tablist", { name: "Ficha do aluno" })).toHaveCount(0);
  await other.context.close();
});
