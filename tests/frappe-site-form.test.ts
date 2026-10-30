import { describe, expect, it } from "vitest";
import { STANDARD_TEMPLATES } from "@/modules/frappe-editor/block-templates.generated";
import { bindAttributes, buildForm, describeForm, parseFormSubmission, routeFitsInbox, FORM_FIELD, type FormDefinition } from "@/modules/frappe-site/form";

type Node = Record<string, unknown>;
const node = (element: string, attributes: Record<string, string> = {}, more: Node = {}): Node => ({ blockId: crypto.randomUUID().slice(0, 8), element, attributes, ...more });
const form = (...children: Node[]): Node => node("form", {}, { children });
const read = (block: Node, hidden: (block: Node) => boolean = () => false) => buildForm(block, { id: "form-1", hidden });
const template = (id: string): Node => {
  const found = STANDARD_TEMPLATES.find((entry) => entry.id === id)!;
  const parsed = JSON.parse(found.block) as Node | Node[];
  return Array.isArray(parsed) ? parsed[0]! : parsed;
};
const kinds = (definition: FormDefinition) => definition.fields.map((field) => `${field.kind}:${field.label}`);

const NAME = node("input", { type: "text", placeholder: "Seu nome" });
const EMAIL = node("input", { type: "email", placeholder: "E-mail" });
const PHONE = node("input", { type: "tel", placeholder: "WhatsApp" });
const MESSAGE = node("textarea", { placeholder: "Mensagem" });

describe("what a form drawn in the editor is", () => {
  it("the three forms that come with the editor are forms the inbox can receive, or say what they lack", () => {
    const first = read(template("form_1"));
    expect(kinds(first.definition)).toEqual(["name:Full Name", "email:Email", "message:Message"]);
    expect(first.definition.problems).toEqual([]);
    expect(first.hasSubmit).toBe(true);
    expect(first.definition.fields.map((field) => field.key)).toEqual(["f1", "f2", "f3"]);

    // A newsletter has only an e-mail: nothing to call the person by.
    const newsletter = read(template("form_2"));
    expect(kinds(newsletter.definition)).toEqual(["email:Email"]);
    expect(newsletter.definition.problems).toEqual(["Falta o campo do nome: um campo de texto."]);

    // The first of two text fields is the name; the other one goes into the message as a line.
    const third = read(template("form_3"));
    expect(kinds(third.definition)).toEqual(["name:First Name", "text:Last Name", "email:Email", "message:Message"]);
    expect(third.definition.problems).toEqual([]);
  });

  it("the name is the field called nome or name, else the one whose label says name, else the first text field", () => {
    const byAttribute = read(form(node("input", { placeholder: "Cidade" }), node("input", { placeholder: "Apelido", name: "Nome" }), EMAIL));
    expect(kinds(byAttribute.definition)).toEqual(["text:Cidade", "name:Apelido", "email:E-mail"]);
    const byLabel = read(form(node("input", { placeholder: "Cidade" }), node("input", { placeholder: "Nome completo" }), EMAIL));
    expect(kinds(byLabel.definition)).toEqual(["text:Cidade", "name:Nome completo", "email:E-mail"]);
    const byOrder = read(form(node("input", { placeholder: "Cidade" }), node("input", { placeholder: "Bairro" }), EMAIL));
    expect(kinds(byOrder.definition)).toEqual(["name:Cidade", "text:Bairro", "email:E-mail"]);
    // Only a field of type text can be the name: a search box is not.
    expect(read(form(node("input", { type: "search", placeholder: "Nome" }), EMAIL)).definition.problems).toContain("Falta o campo do nome: um campo de texto.");
  });

  it("a form needs a way to reach the person: the first field of type Email and the first of type Tel; the others are lines of the message", () => {
    const both = read(form(NAME, EMAIL, PHONE, node("input", { type: "email", placeholder: "E-mail do pai" })));
    expect(kinds(both.definition)).toEqual(["name:Seu nome", "email:E-mail", "phone:WhatsApp", "text:E-mail do pai"]);
    expect(both.definition.fields.map((field) => field.required)).toEqual([true, false, false, false]);
    const alone = read(form(NAME, PHONE));
    expect(alone.definition.fields.map((field) => field.required)).toEqual([true, true]);
    expect(read(form(NAME, MESSAGE)).definition.problems).toEqual(["Falta um campo de e-mail (tipo Email) ou de telefone (tipo Tel)."]);
    expect(read(form()).definition.problems).toHaveLength(2);
  });

  it("the first text area is the message; every other field keeps the label the person gave it", () => {
    const built = read(form(NAME, EMAIL, MESSAGE, node("textarea", { "aria-label": "Lesões" }), node("input", { type: "number", name: "idade" })));
    expect(kinds(built.definition)).toEqual(["name:Seu nome", "email:E-mail", "message:Mensagem", "text:Lesões", "text:idade"]);
    expect(built.definition.fields.map((field) => field.max)).toEqual([160, 254, 1000, 150, 20]);
  });

  it("the label of a field is the label around it, the one that points at it, or the one right before it, before its own hint", () => {
    const wrapping = node("label", {}, { innerHTML: "<p>Como te chamo?</p>", children: [node("input", { placeholder: "x" })] });
    const pointed = [node("label", { for: "tel" }, { innerHTML: "Telefone com DDD" }), node("div", {}, { children: [node("input", { id: "tel", type: "tel", placeholder: "y" })] })];
    const before = node("div", {}, { children: [node("label", {}, { innerHTML: "<p>E-mail &amp; confirmação</p>" }), node("input", { type: "email", placeholder: "z" })] });
    const built = read(form(wrapping, ...pointed, before));
    expect(kinds(built.definition)).toEqual(["name:Como te chamo?", "phone:Telefone com DDD", "email:E-mail & confirmação"]);
    // The shipped "label" block is a label and an input in a box: the label is the one before.
    expect(kinds(read(form(template("label"), EMAIL)).definition)[0]).toBe("name:Label");
    // A label is one line of plain text: no markup, nothing hidden, and short.
    const messy = read(form(node("input", { placeholder: "<b>Nome</b>\n​<script>x</script> " + "a".repeat(100) }), EMAIL));
    expect(messy.definition.fields[0]!.label).not.toMatch(/[<>\n​]/);
    expect(messy.definition.fields[0]!.label.length).toBeLessThanOrEqual(60);
    // With nothing to go by, the field is told by its position.
    expect(read(form(node("input"), EMAIL)).definition.fields[0]!.label).toBe("Campo 1");
  });

  it("lists, option groups and boxes are fields of their own, and the options keep their order", () => {
    const select = node("select", { "aria-label": "Objetivo" }, { children: [node("option", {}, { innerHTML: "" }), node("option", { value: "x" }, { innerHTML: "Emagrecer" }), node("option", { disabled: "" }, { innerHTML: "Nada" }), node("option", {}, { innerHTML: "Ganhar massa" })] });
    const radios = ["Manhã", "Noite"].map((value) => node("input", { type: "radio", name: "turno", value }));
    const box = node("label", {}, { innerHTML: "Topo treino em grupo", children: [node("input", { type: "checkbox", required: "" })] });
    const built = read(form(NAME, EMAIL, select, ...radios, box));
    const [, , choice, turn, check] = built.definition.fields;
    expect(choice).toMatchObject({ kind: "choice", control: "select", label: "Objetivo", options: ["Emagrecer", "Ganhar massa"] });
    expect(turn).toMatchObject({ kind: "choice", control: "radio", label: "turno", options: ["Manhã", "Noite"] });
    expect(check).toMatchObject({ kind: "check", control: "checkbox", label: "Topo treino em grupo", required: true });
    // The option that is not offered is not drawn either.
    const options = (select.children as Node[]).map((child) => built.bindings.get(child));
    expect(options).toEqual([{ role: "ignored" }, { role: "option", index: 0 }, { role: "ignored" }, { role: "option", index: 1 }]);
  });

  it("a list or a group of options keeps its first 40 options", () => {
    const options = Array.from({ length: 45 }, (_value, index) => node("option", {}, { innerHTML: `Opção ${index + 1}` }));
    const list = read(form(NAME, EMAIL, node("select", { "aria-label": "Plano" }, { children: options })));
    expect(list.definition.fields[2]!.options).toHaveLength(40);
    expect(list.definition.fields[2]!.options[39]).toBe("Opção 40");
    expect(list.bindings.get(options[40]!)).toEqual({ role: "ignored" });
    const radios = Array.from({ length: 45 }, (_value, index) => node("input", { type: "radio", name: "turno", value: `T${index + 1}` }));
    const group = read(form(NAME, EMAIL, ...radios));
    expect(group.definition.fields[2]!.options).toHaveLength(40);
    expect(group.bindings.get(radios[44]!)).toEqual({ role: "ignored" });
  });

  it("what cannot be a field is left out, and said", () => {
    const built = read(
      form(
        NAME,
        EMAIL,
        node("input", { type: "password" }),
        node("input", { type: "file" }),
        node("input", { type: "hidden", name: "x", value: "y" }),
        node("input", { type: "text", disabled: "" }),
        node("input", { type: "radio" }),
        node("select"),
        node("input", { type: "submit", value: "Enviar" }),
      ),
    );
    expect(built.definition.fields).toHaveLength(2);
    expect(built.hasSubmit).toBe(true);
    expect(built.definition.ignored).toEqual([
      "Um campo do tipo “password” não entra no formulário (só texto, e-mail, telefone, número, data, hora, endereço, busca, caixa e opção).",
      "Um campo do tipo “file” não entra no formulário (só texto, e-mail, telefone, número, data, hora, endereço, busca, caixa e opção).",
      "Um campo do tipo “hidden” não entra no formulário (só texto, e-mail, telefone, número, data, hora, endereço, busca, caixa e opção).",
      "Um campo desativado não entra no formulário.",
      "Uma opção sem nome de grupo não entra no formulário (dê o mesmo nome às opções da mesma pergunta).",
      "Uma lista sem opções não entra no formulário.",
    ]);
    const passwords = [...built.bindings.values()].filter((binding) => binding.role === "ignored");
    expect(passwords).toHaveLength(6);
  });

  it("a button that is not for sending does not count, and blocks left out of the page are not read", () => {
    expect(read(form(NAME, EMAIL, node("button", { type: "button" }), node("button", { type: "reset" }))).hasSubmit).toBe(false);
    expect(read(form(NAME, EMAIL, node("button", { type: "submit" }))).hasSubmit).toBe(true);
    const off = node("input", { type: "tel", placeholder: "Fora" }, { visibilityCondition: "x" });
    const built = read(form(NAME, EMAIL, off), (block) => block === off);
    expect(kinds(built.definition)).toEqual(["name:Seu nome", "email:E-mail"]);
    expect(built.bindings.has(off)).toBe(false);
  });

  it("a size set in the editor can make a field smaller, never larger than the form allows", () => {
    const built = read(form(node("input", { placeholder: "Nome", maxlength: "20" }), node("input", { type: "email", maxlength: "9999" }), node("textarea", { maxlength: "5000" })));
    expect(built.definition.fields.map((field) => field.max)).toEqual([20, 254, 1000]);
  });

  it("a form of more than 25 fields keeps the first 25", () => {
    const many = Array.from({ length: 30 }, (_value, index) => node("input", { type: "text", placeholder: `Campo ${index}` }));
    const built = read(form(...many, EMAIL));
    expect(built.definition.fields).toHaveLength(25);
    expect(built.definition.ignored).toEqual(["Passou de 25 campos: os de baixo não entram."]);
  });

  it("the version changes with anything a submission depends on, and with nothing else", () => {
    const make = (label: string, style = "") => read(form(node("input", { placeholder: label }, { baseStyles: { color: style } }), EMAIL)).definition.version;
    expect(make("Nome")).toBe(make("Nome", "red"));
    expect(make("Nome")).not.toBe(make("Seu nome"));
    expect(make("Nome")).toMatch(/^[0-9a-f]{14}$/);
    expect(read(form(NAME, EMAIL)).definition.version).not.toBe(read(form(NAME, EMAIL, MESSAGE)).definition.version);
  });

  it("tells in a line what a form holds", () => {
    expect(describeForm(read(template("form_1")).definition)).toBe("nome, e-mail e mensagem");
    expect(describeForm(read(template("form_3")).definition)).toBe("nome, e-mail, mensagem e um outro campo");
    expect(describeForm(read(form(NAME, EMAIL, node("input", { placeholder: "A" }), node("input", { placeholder: "B" }))).definition)).toBe("nome, e-mail e 2 outros campos");
    expect(describeForm(read(template("form_2")).definition)).toBe("e-mail");
    expect(describeForm(read(form(node("input", { type: "password" }))).definition)).toBe("nenhum campo");
    expect(describeForm(read(form(node("input", { type: "number" }))).definition)).toBe("um outro campo");
    expect(describeForm(read(form(node("input", { type: "text" }))).definition)).toBe("nome");
  });

  it("the route of the page has to fit where the inbox keeps it", () => {
    for (const fits of ["", "contato", "servicos/personal", "a_b-c", "x".repeat(40)]) expect(routeFitsInbox(fits), fits).toBe(true);
    for (const wrong of ["x".repeat(41), "/contato", "a//b", "a b", "ação", "a/"]) expect(routeFitsInbox(wrong), wrong).toBe(false);
  });
});

describe("a control is written the way its field says", () => {
  it("name, type, size and the need to fill it come from the field, and nothing that would pre-fill it stays", () => {
    const built = read(form(node("input", { placeholder: "Seu nome", value: "Fulano", name: "nome" }), EMAIL, MESSAGE));
    const [name, email, message] = [...built.bindings.values()];
    const attributes: Record<string, string> = { placeholder: "Seu nome", value: "Fulano", name: "nome", pattern: "x", checked: "", readonly: "" };
    bindAttributes(attributes, name!);
    expect(attributes).toEqual({ placeholder: "Seu nome", name: "f1", type: "text", required: "", maxlength: "160", autocomplete: "name", "aria-label": "Seu nome" });
    const second: Record<string, string> = { type: "email", required: "" };
    bindAttributes(second, email!);
    expect(second).toMatchObject({ name: "f2", type: "email", autocomplete: "email" });
    const third: Record<string, string> = { required: "", autocomplete: "off", "aria-label": "Outra" };
    bindAttributes(third, message!);
    expect(third).toEqual({ name: "f3", maxlength: "1000", autocomplete: "off", "aria-label": "Outra" });
  });

  it("an option and a radio carry their position, so what is sent is a number and never the text", () => {
    const radios = ["A", "B"].map((value) => node("input", { type: "radio", name: "g", value, checked: "" }));
    const select = node("select", {}, { children: [node("option", { value: "valor secreto", selected: "" }, { innerHTML: "Um" })] });
    const built = read(form(NAME, EMAIL, ...radios, select));
    const radio: Record<string, string> = { type: "radio", name: "g", value: "A", checked: "" };
    bindAttributes(radio, built.bindings.get(radios[1]!)!);
    expect(radio).toEqual({ type: "radio", name: "f3", value: "1", "aria-label": "B" });
    const option: Record<string, string> = { value: "valor secreto", selected: "" };
    bindAttributes(option, built.bindings.get((select.children as Node[])[0]!)!);
    expect(option).toEqual({ value: "0" });
  });
});

describe("what a visitor sent, read against the form of the page", () => {
  const select = node("select", { "aria-label": "Objetivo" }, { children: [node("option", {}, { innerHTML: "Emagrecer" }), node("option", {}, { innerHTML: "Ganhar massa" })] });
  const definition = read(form(NAME, EMAIL, PHONE, MESSAGE, node("input", { placeholder: "Idade", type: "number" }), select, node("input", { type: "checkbox", "aria-label": "Aceito ligação" }))).definition;
  const key = (label: string) => definition.fields.find((field) => field.label === label)!.key;
  const good = (): Record<string, string> => ({
    [key("Seu nome")]: "Ana Souza",
    [key("E-mail")]: "ana@example.test",
    [key("Mensagem")]: "Quero saber dos planos",
    [key("Idade")]: "31",
    [key("Objetivo")]: "1",
    [key("Aceito ligação")]: "on",
    [FORM_FIELD.consent]: "on",
    [FORM_FIELD.version]: definition.version,
  });
  const send = (fields: Record<string, string>) => parseFormSubmission(definition, new URLSearchParams(fields), "contato");

  it("becomes a message of the inbox: the text first, then each other field as a line with its label", () => {
    expect(send(good())).toEqual({
      kind: "ok",
      value: { name: "Ana Souza", email: "ana@example.test", phone: null, message: "Quero saber dos planos\n\nIdade: 31\nObjetivo: Ganhar massa\nAceito ligação: Sim", page: "contato" },
    });
    // Phone and e-mail both go to the lead when both are given; one is enough.
    const withPhone = send({ ...good(), [key("WhatsApp")]: "(11) 91234-5678" });
    expect(withPhone).toMatchObject({ kind: "ok", value: { email: "ana@example.test", phone: "(11) 91234-5678" } });
    const onlyPhone = send({ ...good(), [key("E-mail")]: "", [key("WhatsApp")]: "11 91234-5678" });
    expect(onlyPhone).toMatchObject({ kind: "ok", value: { email: null, phone: "11 91234-5678" } });
    // Without a message and without other fields the inbox keeps the contact alone.
    const bare = parseFormSubmission(read(form(NAME, EMAIL)).definition, new URLSearchParams({ f1: "Ana", f2: "ana@example.test", aceite: "on", versao: read(form(NAME, EMAIL)).definition.version }), "");
    expect(bare).toEqual({ kind: "ok", value: { name: "Ana", email: "ana@example.test", phone: null, message: null, page: "" } });
  });

  it("what is not a field of the form is not read, whatever the visitor adds", () => {
    const extra = send({ ...good(), f99: "x", empresa: "x", nome: "Outro", email: "x@example.test" });
    expect(extra).toEqual(send(good()));
  });

  it("a filled bait is a program (told bot, before anything else); another version of the form is told changed", () => {
    expect(send({ ...good(), [FORM_FIELD.bait]: "x" })).toEqual({ kind: "bot" });
    expect(send({ [FORM_FIELD.bait]: "x" })).toEqual({ kind: "bot" });
    expect(send({ ...good(), [FORM_FIELD.version]: "0".repeat(14) })).toEqual({ kind: "changed" });
    const without = good();
    delete without[FORM_FIELD.version];
    expect(send(without)).toEqual({ kind: "changed" });
  });

  it("says in words which field is wrong, and the first one only", () => {
    const problem = (fields: Record<string, string>) => {
      const answer = send(fields);
      return answer.kind === "invalid" ? answer.problem : answer.kind;
    };
    expect(problem({ ...good(), [key("Seu nome")]: " " })).toBe("O campo “Seu nome” é obrigatório.");
    expect(problem({ ...good(), [key("Seu nome")]: "A" })).toBe("Escreva o seu nome (de 2 a 160 letras).");
    expect(problem({ ...good(), [key("E-mail")]: "ana@" })).toBe("Escreva um e-mail válido em “E-mail”.");
    expect(problem({ ...good(), [key("WhatsApp")]: "ana@example.test" })).toBe("Escreva um telefone com DDD em “WhatsApp”.");
    expect(problem({ ...good(), [key("WhatsApp")]: "12" })).toBe("Escreva um telefone com DDD em “WhatsApp”.");
    expect(problem({ ...good(), [key("E-mail")]: "" })).toBe("Escreva um e-mail ou um telefone (com DDD) para a resposta chegar até você.");
    expect(problem({ ...good(), [FORM_FIELD.consent]: "" })).toBe("Marque que leu o aviso de privacidade para enviar.");
    expect(problem({ ...good(), [key("Idade")]: "trinta" })).toBe("Confira o campo “Idade”: o formato não é o esperado.");
    expect(problem({ ...good(), [key("Objetivo")]: "2" })).toBe("Escolha uma das opções de “Objetivo”.");
    expect(problem({ ...good(), [key("Objetivo")]: "Ganhar massa" })).toBe("Escolha uma das opções de “Objetivo”.");
    expect(problem({ ...good(), [key("Mensagem")]: "a".repeat(1001) })).toBe("O campo “Mensagem” passou de 1000 letras.");
    expect(problem({ ...good(), [key("Mensagem")]: "oi‮evil" })).toBe("O campo “Mensagem” tem caracteres que não podem ser enviados.");
    expect(problem({ ...good(), [key("Seu nome")]: "A​na" })).toBe("O campo “Seu nome” tem caracteres que não podem ser enviados.");
    // The first problem wins: the name is checked before the e-mail.
    expect(problem({ ...good(), [key("Seu nome")]: "", [key("E-mail")]: "x" })).toBe("O campo “Seu nome” é obrigatório.");
  });

  it("a text area may have lines; the whole of what is kept never passes the 1000 letters of the inbox", () => {
    const ok = send({ ...good(), [key("Mensagem")]: "linha 1\r\nlinha 2" });
    expect(ok).toMatchObject({ kind: "ok", value: { message: expect.stringMatching(/^linha 1\nlinha 2\n\nIdade/) } });
    const big = send({ ...good(), [key("Mensagem")]: "a".repeat(990), [key("Idade")]: "31" });
    expect(big).toEqual({ kind: "invalid", problem: "O que foi escrito passou de 1000 letras no total. Encurte os textos e tente de novo." });
    const fits = send({ ...good(), [key("Mensagem")]: "a".repeat(900) });
    expect(fits.kind).toBe("ok");
  });

  it("a required choice or box must be picked; an optional one left empty adds no line", () => {
    const required = read(form(NAME, EMAIL, node("select", { required: "", "aria-label": "Plano" }, { children: [node("option", {}, { innerHTML: "A" })] }), node("input", { type: "checkbox", required: "", "aria-label": "Li as regras" }))).definition;
    const base = { f1: "Ana", f2: "ana@example.test", aceite: "on", versao: required.version };
    const run = (fields: Record<string, string>) => parseFormSubmission(required, new URLSearchParams({ ...base, ...fields }), "");
    expect(run({})).toEqual({ kind: "invalid", problem: "Escolha uma opção em “Plano”." });
    expect(run({ f3: "0" })).toEqual({ kind: "invalid", problem: "Marque o campo “Li as regras” para enviar." });
    expect(run({ f3: "0", f4: "on" })).toMatchObject({ kind: "ok", value: { message: "Plano: A\nLi as regras: Sim" } });
    expect(send({ ...good(), [key("Objetivo")]: "", [key("Aceito ligação")]: "" })).toMatchObject({ kind: "ok", value: { message: "Quero saber dos planos\n\nIdade: 31" } });
  });
});
