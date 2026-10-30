/**
 * The forms of a public page made in the embedded editor. A person draws a form with the editor's own blocks (a form, inputs, a text area,
 * a select, radios, a checkbox, a button); this module says what such a form IS: which of its controls are fields, what each one means (the
 * name, the e-mail, the phone, the message, or something else the person asked), what each one may hold, and what a visitor's submission has to
 * look like to be kept. Pure: no database, no request. The definition is always read from the PUBLISHED page on the server, at the time of the
 * submission; nothing of it comes from the visitor, who only sends values for fields the page really has.
 *
 * What the editor lets a person say about a field is its type, its hint ("placeholder") and, as custom attributes, a name, an `aria-label` and
 * `required`. The shipped form templates say nothing more than that, so the meaning is read from what is there:
 *   - the name is the text field called `nome` or `name`, else the first one whose label says name, else the first text field;
 *   - the e-mail is the first field of type Email, the phone the first of type Tel (a form needs at least one of them);
 *   - the message is the first text area; every other field goes into the message as `label: value` lines, in the order of the form.
 * The inbox keeps a name, an e-mail and/or a phone, and a message of up to 1000 letters, so that is the shape every form has.
 */
import { FIELD, INQUIRY_FIELD_PROBLEM, INQUIRY_MESSAGE_MAX, cleanText, hasHiddenText, readContact, readName, type InquiryValue } from "@/modules/meu-site/inquiries";
import { plainText } from "./html";

type Node = Record<string, unknown>;

export type FieldKind = "name" | "email" | "phone" | "message" | "text" | "choice" | "check";

export interface FormField {
  /** What the browser sends it as (`f1`, `f2`…): never a word the person chose, so no name of theirs can clash with the form's own. */
  key: string;
  kind: FieldKind;
  control: "input" | "textarea" | "select" | "radio" | "checkbox";
  /** The `type` of an input, as the browser gets it. */
  type: string;
  label: string;
  required: boolean;
  /** The most letters it may hold. */
  max: number;
  /** For a choice, what the visitor may pick; the browser sends the position. */
  options: string[];
}

export interface FormDefinition {
  /** The block id of the form on the page (made unique when a component with a form is used twice). */
  id: string;
  /** Changes when anything a submission depends on changes: a submission made against another version is refused instead of being misread. */
  version: string;
  fields: FormField[];
  /** What the form still lacks to receive messages; empty when it is ready. */
  problems: string[];
  /** Controls that are in the form but are not used, and why. */
  ignored: string[];
}

/** What a block inside a form is for, so the renderer can write it the way the definition says. */
export type Binding = { role: "field"; field: FormField } | { role: "radio"; field: FormField; index: number } | { role: "option"; index: number } | { role: "ignored" };

export interface BuiltForm {
  definition: FormDefinition;
  bindings: Map<Node, Binding>;
  /** True when the form has a control that sends it (a button, or an input of type submit). */
  hasSubmit: boolean;
}

const KIND_NAMES: Partial<Record<FieldKind, string>> = { name: "nome", email: "e-mail", phone: "telefone", message: "mensagem" };

/** What a form holds, in a line for the person who made it (`nome, e-mail, mensagem e 2 outros campos`). */
export function describeForm(definition: FormDefinition): string {
  const parts = definition.fields.flatMap((field) => KIND_NAMES[field.kind] ?? []);
  const others = definition.fields.length - parts.length;
  if (others > 0) parts.push(others === 1 ? "um outro campo" : `${others} outros campos`);
  if (parts.length === 0) return "nenhum campo";
  return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
}

/** The names the fields of the form have in the page that carries it, apart from `f<n>`. */
export const FORM_FIELD = { consent: FIELD.consent, bait: FIELD.bait, route: "pagina", form: "formulario", version: "versao" } as const;
/** Where the answers of a public form go, from the site's own folder (`/site/<slug>/…`). */
export const FORM_SEND_PATH = "m/contato";
export const FORM_THANKS_PATH = "m/enviado";
/** What a form sends is some lines of text; a body larger than this is not from the form. */
export const FORM_BODY_MAX_BYTES = 16384;

const MAX_NODES = 1500;
const MAX_FIELDS = 25;
const MAX_OPTIONS = 40;
const MAX_OPTION_LETTERS = 80;
const MAX_LABEL_LETTERS = 60;

const isRecord = (value: unknown): value is Node => typeof value === "object" && value !== null && !Array.isArray(value);
const records = (value: unknown): Node[] => (Array.isArray(value) ? value.filter(isRecord) : []);
const text = (value: unknown): string => (typeof value === "string" ? value : "");

const TEXT_TYPES = new Set(["text", "email", "tel", "number", "date", "time", "url", "search"]);
const NAME_ATTRIBUTES = new Set(["nome", "name", "nome-completo", "seu-nome", "full-name", "fullname", "first-name", "firstname"]);
const NAME_LABEL = /(^|[^\p{L}])(nome|name)([^\p{L}]|$)/iu;
const AUTOCOMPLETE: Partial<Record<FieldKind, string>> = { name: "name", email: "email", phone: "tel" };
const TYPE_LIMIT: Record<string, number> = { text: 150, search: 150, email: 254, tel: 30, number: 20, date: 10, time: 5, url: 200 };

/** The element a block is, the way the renderer reads it. */
const elementOf = (block: Node) => text(block.originalElement) || text(block.element) || "div";

function attributesOf(block: Node): Record<string, string> {
  const out: Record<string, string> = {};
  for (const source of [block.attributes, block.customAttributes]) {
    if (!isRecord(source)) continue;
    for (const [name, value] of Object.entries(source)) if (typeof value === "string") out[name.toLowerCase()] = value;
  }
  return out;
}

/** A piece of text the person wrote, fit to be a label (one line, no hidden characters, short). */
function oneLine(raw: string, max: number): string {
  return plainText(raw).slice(0, max).trim();
}

const humanize = (name: string) => oneLine(name.replace(/[-_]+/g, " "), MAX_LABEL_LETTERS);

interface Entry {
  block: Node;
  element: string;
  attrs: Record<string, string>;
  index: number;
  siblings: Node[];
  ancestors: Node[];
}

/** The hash of a string, for telling two versions of a form apart (not for anything secret): 53 bits, as 14 hex digits. */
function fingerprint(source: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < source.length; i += 1) {
    const code = source.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

/** Whether a route fits where the inbox keeps the page of a message (the column is 40 letters). */
export const routeFitsInbox = (route: string) => route === "" || (route.length <= 40 && /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(route));

/**
 * Reads a form block (with its components already merged into it, so what is read is what is drawn) into its definition and the role of
 * each control in it. `hidden` says whether a block is left out of the page (a condition no data can satisfy).
 */
export function buildForm(form: Node, options: { id: string; hidden(block: Node): boolean }): BuiltForm {
  const entries: Entry[] = [];
  let truncated = false;
  const walk = (parent: Node, ancestors: Node[]) => {
    const siblings = records(parent.children).filter((child) => !options.hidden(child));
    siblings.forEach((child, index) => {
      if (entries.length >= MAX_NODES) {
        truncated = true;
        return;
      }
      entries.push({ block: child, element: elementOf(child), attrs: attributesOf(child), index, siblings, ancestors });
      walk(child, [...ancestors, child]);
    });
  };
  walk(form, []);

  /** All the text a label holds: its own and its descendants' (without the controls). */
  const textOfTree = (block: Node, depth = 0): string => {
    let out = text(block.innerHTML);
    if (depth < 8) for (const child of records(block.children)) if (!options.hidden(child) && !/^(input|textarea|select|button)$/.test(elementOf(child))) out += ` ${textOfTree(child, depth + 1)}`;
    return out;
  };
  const labelText = (block: Node) => oneLine(textOfTree(block), MAX_LABEL_LETTERS);
  const labels = entries.filter((entry) => entry.element === "label");

  /** The text that goes with a control: the label around it, the one that points at it, the one right before it. */
  const labelOf = (entry: Entry): string => {
    const wrapping = [...entry.ancestors].reverse().find((ancestor) => elementOf(ancestor) === "label");
    if (wrapping && labelText(wrapping)) return labelText(wrapping);
    const id = entry.attrs.id;
    if (id) {
      const pointed = labels.find((candidate) => candidate.attrs.for === id);
      if (pointed && labelText(pointed.block)) return labelText(pointed.block);
    }
    const before = entry.siblings[entry.index - 1];
    if (before && elementOf(before) === "label" && labelText(before)) return labelText(before);
    return "";
  };

  const ignored: string[] = [];
  const bindings = new Map<Node, Binding>();
  const fields: FormField[] = [];
  let hasSubmit = false;
  let counter = 0;
  const nextKey = () => `f${(counter += 1)}`;
  const flagged = (attrs: Record<string, string>, name: string) => Object.hasOwn(attrs, name) && attrs[name] !== "false";

  interface Control {
    entry: Entry;
    control: FormField["control"];
    type: string;
  }
  const controls: Control[] = [];
  for (const entry of entries) {
    const { element, attrs } = entry;
    if (element === "button") {
      const type = (attrs.type ?? "submit").trim().toLowerCase();
      if (type !== "button" && type !== "reset") hasSubmit = true;
    } else if (element === "input") {
      const type = (attrs.type ?? "text").trim().toLowerCase() || "text";
      if (type === "submit") hasSubmit = true;
      else if (flagged(attrs, "disabled")) {
        bindings.set(entry.block, { role: "ignored" });
        ignored.push("Um campo desativado não entra no formulário.");
      } else if (TEXT_TYPES.has(type)) controls.push({ entry, control: "input", type });
      else if (type === "checkbox" || type === "radio") controls.push({ entry, control: type, type });
      else {
        bindings.set(entry.block, { role: "ignored" });
        ignored.push(`Um campo do tipo “${type.slice(0, 20)}” não entra no formulário (só texto, e-mail, telefone, número, data, hora, endereço, busca, caixa e opção).`);
      }
    } else if (element === "textarea") {
      if (flagged(attrs, "disabled")) {
        bindings.set(entry.block, { role: "ignored" });
        ignored.push("Um campo desativado não entra no formulário.");
      } else controls.push({ entry, control: "textarea", type: "textarea" });
    } else if (element === "select") {
      if (flagged(attrs, "disabled")) {
        bindings.set(entry.block, { role: "ignored" });
        ignored.push("Um campo desativado não entra no formulário.");
      } else controls.push({ entry, control: "select", type: "select" });
    }
  }

  // What the first text fields of each meaning are.
  const textFields = controls.filter((item) => item.control === "input" && item.type === "text");
  const nameOwner =
    textFields.find((item) => NAME_ATTRIBUTES.has((item.entry.attrs.name ?? "").trim().toLowerCase().replace(/[_\s]+/g, "-"))) ??
    textFields.find((item) => NAME_LABEL.test(labelOf(item.entry) || item.entry.attrs["aria-label"] || item.entry.attrs.placeholder || "")) ??
    textFields[0];
  const emailOwner = controls.find((item) => item.control === "input" && item.type === "email");
  const phoneOwner = controls.find((item) => item.control === "input" && item.type === "tel");
  const messageOwner = controls.find((item) => item.control === "textarea");
  const contactCount = (emailOwner ? 1 : 0) + (phoneOwner ? 1 : 0);

  const cap = (limit: number, attrs: Record<string, string>) => {
    const own = /^\d{1,4}$/.test(attrs.maxlength ?? "") ? Number(attrs.maxlength) : limit;
    return Math.max(1, Math.min(limit, own));
  };
  const labelFor = (entry: Entry, fallback: string) =>
    labelOf(entry) || oneLine(entry.attrs["aria-label"] ?? "", MAX_LABEL_LETTERS) || oneLine(entry.attrs.placeholder ?? "", MAX_LABEL_LETTERS) || humanize(entry.attrs.name ?? "") || fallback;

  const radioGroups = new Map<string, FormField>();
  for (const item of controls) {
    if (fields.length >= MAX_FIELDS) {
      bindings.set(item.entry.block, { role: "ignored" });
      ignored.push(`Passou de ${MAX_FIELDS} campos: os de baixo não entram.`);
      continue;
    }
    const { entry, control, type } = item;
    const attrs = entry.attrs;
    const fallback = `Campo ${fields.length + 1}`;
    const required = flagged(attrs, "required");
    if (control === "radio") {
      const group = (attrs.name ?? "").trim();
      if (!group) {
        bindings.set(entry.block, { role: "ignored" });
        ignored.push("Uma opção sem nome de grupo não entra no formulário (dê o mesmo nome às opções da mesma pergunta).");
        continue;
      }
      let field = radioGroups.get(group);
      if (!field) {
        field = { key: nextKey(), kind: "choice", control: "radio", type: "radio", label: oneLine(attrs["aria-label"] ?? "", MAX_LABEL_LETTERS) || humanize(group) || fallback, required: false, max: MAX_OPTION_LETTERS, options: [] };
        radioGroups.set(group, field);
        fields.push(field);
      }
      if (required) field.required = true;
      if (field.options.length >= MAX_OPTIONS) {
        bindings.set(entry.block, { role: "ignored" });
        continue;
      }
      const option = labelOf(entry) || oneLine(attrs.value ?? "", MAX_OPTION_LETTERS) || `Opção ${field.options.length + 1}`;
      bindings.set(entry.block, { role: "radio", field, index: field.options.length });
      field.options.push(option.slice(0, MAX_OPTION_LETTERS));
      continue;
    }
    if (control === "select") {
      const options: string[] = [];
      const own = entries.filter((candidate) => candidate.element === "option" && candidate.ancestors.includes(entry.block));
      for (const option of own) {
        const label = oneLine(text(option.block.innerHTML) || option.attrs.value || "", MAX_OPTION_LETTERS);
        if (!label || flagged(option.attrs, "disabled") || options.length >= MAX_OPTIONS) bindings.set(option.block, { role: "ignored" });
        else {
          bindings.set(option.block, { role: "option", index: options.length });
          options.push(label);
        }
      }
      if (options.length === 0) {
        bindings.set(entry.block, { role: "ignored" });
        ignored.push("Uma lista sem opções não entra no formulário.");
        continue;
      }
      const field: FormField = { key: nextKey(), kind: "choice", control: "select", type: "select", label: labelFor(entry, fallback), required, max: MAX_OPTION_LETTERS, options };
      fields.push(field);
      bindings.set(entry.block, { role: "field", field });
      continue;
    }
    let kind: FieldKind = "text";
    if (item === nameOwner) kind = "name";
    else if (item === emailOwner) kind = "email";
    else if (item === phoneOwner) kind = "phone";
    else if (item === messageOwner) kind = "message";
    else if (control === "checkbox") kind = "check";
    const limit = kind === "name" ? 160 : kind === "message" ? INQUIRY_MESSAGE_MAX : (TYPE_LIMIT[type] ?? 150);
    const field: FormField = {
      key: nextKey(),
      kind,
      control,
      type: kind === "name" ? "text" : type,
      label: labelFor(entry, fallback),
      required: kind === "name" || ((kind === "email" || kind === "phone") && contactCount === 1) || required,
      max: control === "checkbox" ? 3 : cap(limit, attrs),
      options: [],
    };
    fields.push(field);
    bindings.set(entry.block, { role: "field", field });
  }

  const problems: string[] = [];
  if (!fields.some((field) => field.kind === "name")) problems.push("Falta o campo do nome: um campo de texto.");
  if (!fields.some((field) => field.kind === "email" || field.kind === "phone")) problems.push("Falta um campo de e-mail (tipo Email) ou de telefone (tipo Tel).");
  if (truncated) problems.push("O formulário tem blocos demais.");
  const version = fingerprint(JSON.stringify(fields.map((field) => [field.key, field.kind, field.control, field.type, field.label, field.required, field.max, field.options])));
  return { definition: { id: options.id, version, fields, problems, ignored: [...new Set(ignored)] }, bindings, hasSubmit };
}

const STRIPPED = ["value", "checked", "selected", "disabled", "readonly", "pattern", "min", "max", "step", "minlength", "autofocus", "multiple"];

/** Writes the attributes of a control the way its field says (name, type, required, size), and takes out what would give it a value of its own. */
export function bindAttributes(attributes: Record<string, string>, binding: Binding): void {
  if (binding.role === "ignored") return;
  for (const name of STRIPPED) delete attributes[name];
  if (binding.role === "option") {
    attributes.value = String(binding.index);
    return;
  }
  const { field } = binding;
  attributes.name = field.key;
  if (field.required) attributes.required = "";
  else delete attributes.required;
  if (binding.role === "radio") {
    attributes.type = "radio";
    attributes.value = String(binding.index);
    attributes["aria-label"] = attributes["aria-label"] || field.options[binding.index] || field.label;
    return;
  }
  if (field.control === "input") attributes.type = field.type;
  if (field.control === "input" || field.control === "textarea") attributes.maxlength = String(field.max);
  const auto = AUTOCOMPLETE[field.kind];
  if (auto && !attributes.autocomplete) attributes.autocomplete = auto;
  if (!attributes["aria-label"]) attributes["aria-label"] = field.label;
}

export type FormSubmission =
  | { kind: "ok"; value: InquiryValue }
  | { kind: "bot" }
  /** The page changed between the visitor opening it and sending: nothing is read, because the fields may mean something else now. */
  | { kind: "changed" }
  | { kind: "invalid"; problem: string };

const SHAPES: Record<string, RegExp> = { number: /^-?\d{1,15}([.,]\d{1,6})?$/, date: /^\d{4}-\d{2}-\d{2}$/, time: /^\d{2}:\d{2}$/, url: /^https?:\/\/\S{2,190}$/i };

/**
 * What a visitor sent, read against the form of the published page. The bait field is told "bot" (the route answers as if it worked); a
 * different version is told "changed"; anything else wrong is said in words that name the field. A value is kept only for a field the form has.
 */
export function parseFormSubmission(definition: FormDefinition, form: Pick<FormData, "get">, page: string): FormSubmission {
  const raw = (name: string): string | null => {
    const value = form.get(name);
    return typeof value === "string" ? value : null;
  };
  if ((raw(FORM_FIELD.bait) ?? "") !== "") return { kind: "bot" };
  if (raw(FORM_FIELD.version) !== definition.version) return { kind: "changed" };
  const invalid = (problem: string): FormSubmission => ({ kind: "invalid", problem });

  let name: string | null = null;
  let email: string | null = null;
  let phone: string | null = null;
  let message = "";
  const extras: string[] = [];
  for (const field of definition.fields) {
    const sent = raw(field.key);
    const where = `“${field.label}”`;
    if (field.control === "checkbox") {
      if (sent === "on") extras.push(`${field.label}: Sim`);
      else if (field.required) return invalid(`Marque o campo ${where} para enviar.`);
      continue;
    }
    if (field.kind === "choice") {
      if (sent === null || sent === "") {
        if (field.required) return invalid(`Escolha uma opção em ${where}.`);
        continue;
      }
      const index = /^\d{1,2}$/.test(sent) ? Number(sent) : -1;
      const option = field.options[index];
      if (option === undefined) return invalid(`Escolha uma das opções de ${where}.`);
      extras.push(`${field.label}: ${option}`);
      continue;
    }
    const value = cleanText(sent ?? "");
    if (value === "") {
      if (field.required) return invalid(`O campo ${where} é obrigatório.`);
      continue;
    }
    if (value.length > field.max) return invalid(`O campo ${where} passou de ${field.max} letras.`);
    if (hasHiddenText(value, field.kind === "message" || field.control === "textarea")) return invalid(`O campo ${where} tem caracteres que não podem ser enviados.`);
    if (field.kind === "name") {
      name = readName(value);
      if (name === null) return invalid(INQUIRY_FIELD_PROBLEM.name);
    } else if (field.kind === "email") {
      const contact = readContact(value);
      if (contact?.email == null) return invalid(`Escreva um e-mail válido em ${where}.`);
      email = contact.email;
    } else if (field.kind === "phone") {
      const contact = readContact(value);
      if (contact?.phone == null) return invalid(`Escreva um telefone com DDD em ${where}.`);
      phone = contact.phone;
    } else if (field.kind === "message") message = value;
    else {
      const shape = SHAPES[field.type];
      if (shape && !shape.test(value)) return invalid(`Confira o campo ${where}: o formato não é o esperado.`);
      extras.push(field.control === "textarea" && value.includes("\n") ? `${field.label}:\n${value}` : `${field.label}: ${value}`);
    }
  }
  if (name === null) return invalid(INQUIRY_FIELD_PROBLEM.name);
  if (email === null && phone === null) return invalid(INQUIRY_FIELD_PROBLEM.contact);
  if (raw(FORM_FIELD.consent) !== "on") return invalid(INQUIRY_FIELD_PROBLEM.consent);
  const body = [message, extras.join("\n")].filter(Boolean).join("\n\n");
  if (body.length > INQUIRY_MESSAGE_MAX) return invalid(`O que foi escrito passou de ${INQUIRY_MESSAGE_MAX} letras no total. Encurte os textos e tente de novo.`);
  return { kind: "ok", value: { name, email, phone, message: body === "" ? null : body, page } };
}
