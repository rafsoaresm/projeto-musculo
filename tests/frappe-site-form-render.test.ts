import { describe, expect, it } from "vitest";
import { STANDARD_TEMPLATES } from "@/modules/frappe-editor/block-templates.generated";
import { renderBlocks, type Block } from "@/modules/frappe-site/render";
import { urlContext } from "@/modules/frappe-site/urls";

const url = urlContext("studio", 0);
const SEND = { action: "../site/studio/m/contato", noticeUrl: "https://example.test/aviso?a=1&b=\"2\"" };
const node = (element: string, attributes: Record<string, string> = {}, more: Block = {}): Block => ({ blockId: crypto.randomUUID().slice(0, 8), element, attributes, ...more });
const form = (...children: Block[]): Block => node("form", {}, { children });
const NAME = node("input", { type: "text", placeholder: "Seu nome" });
const EMAIL = node("input", { type: "email", placeholder: "E-mail" });
const MESSAGE = node("textarea", { placeholder: "Mensagem" });
const SEND_BUTTON = node("button", {}, { innerHTML: "Enviar agora" });
const open = (blocks: Block[], components: Record<string, Block> = {}, forms: { route: string; send: typeof SEND | null } = { route: "contato", send: SEND }) =>
  renderBlocks({ blocks, component: (id) => components[id] ?? null, fontToken: () => null, url, forms });
const template = (id: string): Block => {
  const parsed = JSON.parse(STANDARD_TEMPLATES.find((entry) => entry.id === id)!.block) as Block | Block[];
  return Array.isArray(parsed) ? parsed[0]! : parsed;
};

describe("a form is drawn only where the site opened its forms, and it sends where the site says", () => {
  it("closed (or only being read): nothing of the form is drawn, but its definition is there for the panel and for the submission", () => {
    const blocks = [node("h1", {}, { innerHTML: "Fale comigo" }), form(NAME, EMAIL, SEND_BUTTON)];
    for (const forms of [{ route: "contato", send: null }, undefined]) {
      const out = renderBlocks({ blocks, component: () => null, fontToken: () => null, url, forms });
      expect(out.body).toBe('<body><h1 class="__text_block__">Fale comigo</h1></body>');
      expect(out.forms).toHaveLength(1);
      expect(out.forms[0]!.fields.map((field) => field.kind)).toEqual(["name", "email"]);
    }
  });

  it("open: the form posts to the address the site gave, whatever the page said, with its fields named f1, f2…", () => {
    const hostile = form(node("input", { type: "text", placeholder: "Seu nome", name: "x", formaction: "https://evil.test", onfocus: "alert(1)", value: "preenchido" }), EMAIL, MESSAGE, SEND_BUTTON);
    (hostile.attributes as Record<string, string>).action = "https://evil.test/steal";
    (hostile.attributes as Record<string, string>).method = "get";
    const out = open([hostile]).body;
    expect(out).toMatch(/^<body><form method="post" action="\.\.\/site\/studio\/m\/contato">/);
    expect(out).not.toMatch(/evil\.test|onfocus|formaction|preenchido|name="x"/);
    expect(out).toContain('<input type="text" placeholder="Seu nome" name="f1" required maxlength="160" autocomplete="name" aria-label="Seu nome">');
    expect(out).toContain('<input type="email" placeholder="E-mail" name="f2" required maxlength="254" autocomplete="email" aria-label="E-mail">');
    expect(out).toContain('<textarea placeholder="Mensagem" name="f3" maxlength="1000" aria-label="Mensagem"></textarea>');
  });

  it("the box for the privacy notice, the bait and the hidden fields come right before the first button that sends, once", () => {
    const out = open([form(NAME, EMAIL, SEND_BUTTON, node("button", {}, { innerHTML: "Outro" }))]).body;
    const consent = out.indexOf('name="aceite"');
    expect(consent).toBeGreaterThan(out.indexOf('name="f2"'));
    expect(consent).toBeLessThan(out.indexOf("Enviar agora"));
    expect(out.match(/name="aceite"/g)).toHaveLength(1);
    expect(out).toContain('<a href="https://example.test/aviso?a=1&amp;b=&quot;2&quot;" target="_blank" rel="noopener noreferrer">aviso de privacidade</a>');
    expect(out).toContain('<div aria-hidden="true" style="position: absolute; left: -10000px;');
    expect(out).toContain('name="empresa_extra" tabindex="-1" autocomplete="off"');
    expect(out).toContain('<input type="hidden" name="pagina" value="contato">');
    expect(out).toMatch(/<input type="hidden" name="formulario" value="[A-Za-z0-9_-]+">/);
    expect(out).toMatch(/<input type="hidden" name="versao" value="[0-9a-f]{14}">/);
    expect(out).toMatch(/<button type="submit">Enviar agora<\/button>/);
    expect(out).toMatch(/<button type="submit">Outro<\/button>/);
  });

  it("a button that is not for sending is left alone; a form with none gets one, so it can be sent", () => {
    const reset = open([form(NAME, EMAIL, node("button", { type: "button" }, { innerHTML: "Limpar" }))]).body;
    expect(reset).toContain('<button type="button">Limpar</button>');
    expect(reset).toMatch(/name="aceite"[\s\S]*<button type="submit" style="[^"]*">Enviar<\/button><\/form>/);
    const bare = open([form(NAME, EMAIL)]).body;
    expect(bare.match(/type="submit"/g)).toHaveLength(1);
    // A button that names itself does not add a field of the page's making.
    expect(open([form(NAME, EMAIL, node("button", { name: "x", value: "y" }, { innerHTML: "Ir" }))]).body).toContain('<button type="submit">Ir</button>');
    // An input of type submit is the button; it gets the consent box too.
    const submit = open([form(NAME, EMAIL, node("input", { type: "submit", value: "Mandar", name: "z" }))]).body;
    expect(submit).toMatch(/name="aceite"[\s\S]*<input type="submit" value="Mandar">/);
    expect(submit).not.toContain("Enviar</button>");
  });

  it("a form that cannot receive messages is not drawn, and says why", () => {
    const noName = open([node("h2", {}, { innerHTML: "Boletim" }), form(EMAIL, SEND_BUTTON)]);
    expect(noName.body).toBe('<body><h2 class="__text_block__">Boletim</h2></body>');
    expect(noName.forms[0]!.problems).toEqual(["Falta o campo do nome: um campo de texto."]);
    const news = open([template("form_2")]);
    expect(news.body).toBe("<body></body>");
    expect(news.forms[0]!.problems).toEqual(["Falta o campo do nome: um campo de texto."]);
    expect(open([form(NAME, SEND_BUTTON)]).forms[0]!.problems).toEqual(["Falta um campo de e-mail (tipo Email) ou de telefone (tipo Tel)."]);
  });

  it("the shipped forms of the editor are drawn as working forms", () => {
    const out = open([template("form_1")]).body;
    expect(out).toContain('name="f1"');
    expect(out).toContain('<textarea placeholder="Message" name="f3"');
    expect(out).toContain("<p>Submit</p>");
    const third = open([template("form_3")]).body;
    expect(third.match(/name="f\d"/g)).toEqual(['name="f1"', 'name="f2"', 'name="f3"', 'name="f4"']);
  });

  it("only a route the inbox can keep is a place for a form", () => {
    const long = open([form(NAME, EMAIL, SEND_BUTTON)], {}, { route: "x".repeat(41), send: SEND });
    expect(long.body).toBe("<body></body>");
    expect(long.forms[0]!.problems).toEqual(["O endereço desta página tem mais de 40 letras ou caracteres que a caixa de entrada não guarda."]);
    expect(open([form(NAME, EMAIL, SEND_BUTTON)], {}, { route: "", send: SEND }).body).toContain('name="pagina" value=""');
    expect(open([form(NAME, EMAIL, SEND_BUTTON)], {}, { route: "servicos/personal", send: SEND }).body).toContain('name="pagina" value="servicos/personal"');
  });
});

describe("the controls of a form", () => {
  it("a list gets an empty first option, and every option and radio carries its position, not its text", () => {
    const select = node("select", { "aria-label": "Objetivo", name: "obj" }, { children: [node("option", { value: "secreto", selected: "" }, { innerHTML: "Emagrecer" }), node("option", {}, { innerHTML: "" }), node("option", {}, { innerHTML: "Ganhar <b>massa</b>" })] });
    const radios = ["A", "B"].map((value) => node("input", { type: "radio", name: "turno", value, checked: "" }));
    const out = open([form(NAME, EMAIL, select, ...radios, SEND_BUTTON)]).body;
    expect(out).toContain('<select aria-label="Objetivo" name="f3"><option value=""></option><option value="0">Emagrecer</option><option value="1">Ganhar &lt;b&gt;massa&lt;/b&gt;</option></select>');
    expect(out).toContain('<input type="radio" name="f4" value="0" aria-label="A">');
    expect(out).toContain('<input type="radio" name="f4" value="1" aria-label="B">');
    expect(out).not.toMatch(/secreto|selected|checked/);
  });

  it("what cannot be a field is not drawn: passwords, files, hidden values, disabled controls", () => {
    const out = open([form(NAME, EMAIL, node("input", { type: "password", name: "senha" }), node("input", { type: "file" }), node("input", { type: "hidden", name: "h", value: "v" }), node("input", { disabled: "" }), SEND_BUTTON)]);
    expect(out.body.match(/<input /g)).toHaveLength(2 + 1 + 1 + 3); // the two fields, the consent box, the bait, and the three hidden ones of the form itself
    expect(out.body).not.toMatch(/password|senha|type="file"|name="h"|disabled/);
    expect(out.forms[0]!.ignored).toHaveLength(4);
  });

  it("a field left out of the page by a condition is neither drawn nor read", () => {
    const off = node("input", { type: "tel", placeholder: "Fora" }, { visibilityCondition: { key: "x" } });
    const out = open([form(NAME, EMAIL, off, SEND_BUTTON)]);
    expect(out.body).not.toContain("Fora");
    expect(out.forms[0]!.fields).toHaveLength(2);
  });

  it("a form inside a form is a plain box: its fields belong to the outer one", () => {
    const out = open([form(NAME, form(EMAIL), SEND_BUTTON)]);
    expect(out.body.match(/<form/g)).toHaveLength(1);
    expect(out.forms).toHaveLength(1);
    expect(out.forms[0]!.fields.map((field) => field.kind)).toEqual(["name", "email"]);
  });

  it("a form inside a component is read as it is drawn, with what the instance changed", () => {
    const component = form(node("input", { type: "text", placeholder: "Nome" }, { blockId: "n" }), node("input", { type: "email", placeholder: "E-mail" }, { blockId: "e" }), node("button", {}, { blockId: "b", innerHTML: "Enviar" }));
    component.blockId = "cmp";
    const instance: Block = { blockId: "inst", extendedFromComponent: "c1", children: [{ blockId: "n" }, { blockId: "e", attributes: { placeholder: "Seu e-mail" } }, { blockId: "b" }] };
    const out = open([instance], { c1: component });
    expect(out.forms).toHaveLength(1);
    expect(out.forms[0]!.fields.map((field) => field.label)).toEqual(["Nome", "Seu e-mail"]);
    expect(out.body).toContain('name="f2"');
    expect(out.body).toContain('placeholder="Seu e-mail"');
    // A component with a form used twice makes two forms with their own ids.
    const twice = open([{ ...instance, blockId: "i1" }, { ...instance, blockId: "i2" }], { c1: component });
    expect(twice.forms.map((entry) => entry.id)).toEqual(["cmp", "cmp-2"]);
  });

  it("a field that is itself a component is read and drawn like any other", () => {
    const phone = node("input", { type: "tel", placeholder: "WhatsApp" }, { blockId: "tel" });
    const out = open([form(NAME, EMAIL, { blockId: "slot", extendedFromComponent: "phone" }, SEND_BUTTON)], { phone });
    expect(out.forms[0]!.fields.map((field) => field.kind)).toEqual(["name", "email", "phone"]);
    expect(out.body).toContain('<input type="tel" placeholder="WhatsApp" name="f3"');
  });

  it("what a repeater would draw from data is not a field of the form", () => {
    const repeated: Block = { blockId: "rep", element: "div", isRepeaterBlock: true, dataKey: { key: "items" }, children: [node("input", { type: "tel", placeholder: "Fora" })] };
    const out = open([form(NAME, EMAIL, repeated, SEND_BUTTON)]);
    expect(out.forms[0]!.fields.map((field) => field.kind)).toEqual(["name", "email"]);
    expect(out.body).not.toContain("Fora");
  });

  it("nothing of a form draws where a repeater would", () => {
    const repeated: Block = { blockId: "rep", element: "div", isRepeaterBlock: true, dataKey: { key: "items" }, children: [form(NAME, EMAIL, SEND_BUTTON)] };
    const out = open([repeated]);
    expect(out.forms).toEqual([]);
    expect(out.body).toBe("<body><div></div></body>");
  });
});
