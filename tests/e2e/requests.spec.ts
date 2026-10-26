import { test, expect, type Page } from "@playwright/test";
import {
  acceptStudentTerms,
  addStudent,
  createProfessional,
  joinStudent,
  localIP,
  newActor,
  noHorizontalOverflow,
  openInvitation,
  png,
  signIn,
} from "./helpers";

const inBrazil = (date: Date) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
const today = () => inBrazil(new Date());
const inFifteenDays = () => inBrazil(new Date(Date.now() + 15 * 24 * 60 * 60 * 1000));

const requestForm = (page: Page) => page.getByRole("form", { name: "Fazer um pedido sobre os meus dados" });
const answerForm = (page: Page) => page.getByRole("form", { name: "Responder ao pedido" });

test("a student asks about their data with a deadline, the professional sees it and answers in words, and the student reads the answer", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio dos pedidos");
  const studentURL = await addStudent(page, "Aluna dos pedidos");
  const { client } = await openInvitation(page, browser, baseURL, "Aluna dos pedidos");
  const me = client.page;
  await acceptStudentTerms(me);
  await me.getByRole("button", { name: "Aceitar convite" }).click();
  await expect(me).toHaveURL(/\/aluno\/?$/);

  // The professional's overview has nothing to answer yet.
  await page.goto("./profissional");
  await expect(page.getByText("Pedidos de alunos sobre os dados", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pedidos de alunos sobre os dados deles" })).toHaveCount(0);

  // The student's account says what can be asked, who answers and in how long, and that nothing is sent by e-mail.
  await me.goto("./aluno/conta");
  await expect(me.getByRole("heading", { name: "Pedidos sobre os seus dados" })).toBeVisible();
  await expect(me.getByText("Quem responde é o seu profissional, em até 15 dias.", { exact: false })).toBeVisible();
  await expect(me.getByText("não envia e-mail nem aviso", { exact: false })).toBeVisible();
  await expect(me.getByText("Você ainda não fez nenhum pedido.")).toBeVisible();
  await noHorizontalOverflow(me);

  // A correction needs words; whitespace is not words.
  const form = requestForm(me);
  await form.getByLabel("O que você quer pedir").selectOption({ label: "Corrigir um dado meu" });
  await form.getByLabel("Conte o que você precisa").fill("   ");
  await form.getByRole("button", { name: "Registrar o pedido" }).click();
  await expect(me.locator("p.form-error")).toContainText("Conte o que você precisa neste pedido.");
  await expect(me.getByText("Você ainda não fez nenhum pedido.")).toBeVisible();

  // A request for a copy is recorded with the deadline.
  await form.getByLabel("O que você quer pedir").selectOption({ label: "Receber uma cópia dos meus dados" });
  await form.getByLabel(/Algo mais que o seu profissional deva saber/).fill("Quero tudo o que vocês guardam sobre mim.");
  await form.getByRole("button", { name: "Registrar o pedido" }).click();
  await expect(me.getByText(`Pedido registrado. O prazo de resposta do seu profissional é ${inFifteenDays()}.`)).toBeVisible();
  const mine = me.locator("ul.request-list > li", { hasText: "Receber uma cópia dos meus dados" });
  await expect(mine.getByText(`Em andamento · prazo ${inFifteenDays()}`)).toBeVisible();
  await expect(mine.getByText("Você escreveu: Quero tudo o que vocês guardam sobre mim.")).toBeVisible();

  // The same kind cannot be opened twice while the first is open.
  await form.getByRole("button", { name: "Registrar o pedido" }).click();
  await expect(me.locator("p.form-error")).toContainText("Você já tem um pedido deste tipo em andamento");

  // The professional sees it, with the deadline, on the overview and in the student's page.
  await page.goto("./profissional");
  await expect(page.locator(".kpi", { hasText: "Pedidos de alunos sobre os dados" }).locator(".kpi-value")).toHaveText("1");
  await expect(page.getByText("Resposta em até 15 dias")).toBeVisible();
  const link = page.getByRole("link", { name: new RegExp(`Aluna dos pedidos · Receber uma cópia dos meus dados · prazo ${inFifteenDays()}`) });
  await link.click();
  await expect(page).toHaveURL(/#pedidos$/);
  const panel = page.locator("#pedidos");
  await expect(panel.getByRole("heading", { name: "Pedidos do aluno sobre os dados dele" })).toBeVisible();
  await expect(panel.getByText(`Prazo ${inFifteenDays()}`)).toBeVisible();
  await expect(panel.getByText("O aluno escreveu: Quero tudo o que vocês guardam sobre mim.")).toBeVisible();
  await noHorizontalOverflow(page);

  // A partial answer has to say what was left out: the student reads it.
  const answer = answerForm(page);
  await answer.getByLabel("Resposta").selectOption({ label: "Atendido em parte" });
  await answer.getByLabel("Explicação, que o aluno vai ler").fill("   ");
  await answer.getByRole("button", { name: "Registrar a resposta" }).click();
  await expect(page.locator("p.form-error")).toContainText("Explique a resposta");
  await answer.getByLabel("Explicação, que o aluno vai ler").fill("Enviei os dados de cadastro por e-mail; o treino entregue fica congelado.");
  await answer.getByRole("button", { name: "Registrar a resposta" }).click();
  await expect(panel.getByText(`Atendido em parte em ${today()}`)).toBeVisible();
  await expect(panel.getByText("Resposta registrada: Enviei os dados de cadastro por e-mail; o treino entregue fica congelado.")).toBeVisible();
  await expect(answerForm(page)).toHaveCount(0);
  await page.goto("./profissional");
  await expect(page.getByRole("heading", { name: "Pedidos de alunos sobre os dados deles" })).toHaveCount(0);
  await expect(page.locator(".kpi", { hasText: "Pedidos de alunos sobre os dados" }).locator(".kpi-value")).toHaveText("0");

  // The student reads the answer, and can ask again, and withdraw what is still open.
  await me.reload();
  const answered = me.locator("ul.request-list > li", { hasText: "Receber uma cópia dos meus dados" });
  await expect(answered.getByText(`Atendido em parte em ${today()}`)).toBeVisible();
  await expect(answered.getByText("Resposta do seu profissional: Enviei os dados de cadastro por e-mail; o treino entregue fica congelado.")).toBeVisible();
  await expect(answered.getByRole("button", { name: "Cancelar este pedido" })).toHaveCount(0);
  await requestForm(me).getByLabel("O que você quer pedir").selectOption({ label: "Retirar o meu aceite dos termos" });
  await requestForm(me).getByRole("button", { name: "Registrar o pedido" }).click();
  const second = me.locator("ul.request-list > li", { hasText: "Retirar o meu aceite dos termos" });
  await expect(second.getByText("Em andamento", { exact: false })).toBeVisible();
  await second.getByRole("button", { name: "Cancelar este pedido" }).click();
  await expect(second.getByText(`Cancelado por você em ${today()}`)).toBeVisible();
  await noHorizontalOverflow(me);

  // The student's page of the professional shows the cancellation, not as an open request.
  await page.goto(studentURL);
  await expect(page.locator("#pedidos").getByText(`Cancelado pelo aluno em ${today()}`)).toBeVisible();
  await client.context.close();
});

test("on request, the professional erases the stored photos; the assessment keeps the rest and says they were erased", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio do apagar");
  const studentURL = await addStudent(page, "Aluna do apagar");
  await page.getByRole("button", { name: "Iniciar avaliação" }).click();
  await expect(page.getByRole("heading", { name: "Avaliação inicial de Aluna do apagar" })).toBeVisible();
  const draftURL = page.url();
  await page.goto(studentURL);
  const email = await joinStudent(page, browser, baseURL, "Aluna do apagar", { photos: true });
  await page.goto(draftURL);
  await page.locator("#foto-ANTERIOR").setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: png() });
  await expect(page.getByText("Foto anterior enviada.")).toBeVisible();
  const photo = page.getByRole("group", { name: "Foto anterior" }).getByRole("img", { name: "Foto anterior do aluno" });
  await photo.scrollIntoViewIfNeeded();
  const src = new URL((await photo.getAttribute("src"))!, page.url()).href;
  expect((await page.request.get(src)).status()).toBe(200);
  await page.getByLabel(/Perguntei ao aluno sobre os seis itens/).check();
  await page.getByRole("button", { name: "Registrar avaliação" }).click();
  await expect(page.getByRole("heading", { name: /Avaliação de \d{2}\/\d{2}\/\d{4}/ })).toBeVisible();
  const recordedURL = page.url();
  await expect(page.getByRole("img", { name: "Foto anterior do aluno" })).toBeVisible();

  // The student asks for the photos to be erased; the screen says what that does and does not do.
  const student = await newActor(browser, baseURL);
  await signIn(student.page, email);
  await student.page.goto("./aluno/conta");
  const form = requestForm(student.page);
  await form.getByLabel("O que você quer pedir").selectOption({ label: "Apagar as minhas fotos" });
  await expect(student.page.getByText("Isso não retira a sua autorização para fotos novas", { exact: false })).toBeVisible();
  await form.getByRole("button", { name: "Registrar o pedido" }).click();
  await expect(student.page.getByText("Pedido registrado.", { exact: false })).toBeVisible();

  // The professional sees how many photos there are, must confirm, and the erasure has no way back.
  await page.goto(studentURL);
  const panel = page.locator("#pedidos");
  await expect(panel.getByText("Há 1 foto deste aluno guardada.", { exact: false })).toBeVisible();
  await panel.getByRole("button", { name: "Apagar as fotos" }).click();
  await expect(panel.getByText("Apagar remove os arquivos", { exact: false })).toBeVisible();
  await panel.getByRole("button", { name: "Voltar" }).click();
  await expect(panel.getByRole("button", { name: "Confirmar: apagar para sempre" })).toHaveCount(0);
  await panel.getByRole("button", { name: "Apagar as fotos" }).click();
  await panel.getByRole("button", { name: "Confirmar: apagar para sempre" }).click();
  await expect(panel.getByText(`Atendido em ${today()}`)).toBeVisible();
  await expect(panel.getByText("Resposta registrada: 1 foto apagada do armazenamento.")).toBeVisible();

  // The bytes are gone; the recorded assessment keeps its content and says what happened to the photo.
  expect((await page.request.get(src)).status()).toBe(404);
  await page.goto(recordedURL);
  await expect(page.getByRole("img", { name: "Foto anterior do aluno" })).toHaveAttribute("aria-label", /apagada a pedido do aluno/);
  await expect(page.getByText(`Foto apagada a pedido do aluno em ${today()}.`)).toBeVisible();
  await expect(page.locator("img.posture-photo")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Fotos da postura" })).toBeVisible();
  await page.goto(`${studentURL}/evolucao`);
  await expect(page.getByText(`Foto apagada a pedido do aluno em ${today()}.`)).toBeVisible();

  // The student reads the answer.
  await student.page.reload();
  const done = student.page.locator("ul.request-list > li", { hasText: "Apagar as minhas fotos" });
  await expect(done.getByText(`Atendido em ${today()}`)).toBeVisible();
  await expect(done.getByText("Resposta do seu profissional: 1 foto apagada do armazenamento.")).toBeVisible();
  await student.context.close();
});
