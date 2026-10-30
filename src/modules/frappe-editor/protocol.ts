import { page as slice, order, project, select, type Doc } from "./doc-query";

/**
 * What the embedded editor of Frappe Builder says to its server, answered on top of a store of documents. The editor was written to
 * talk to a Frappe site; here the same calls (`frappe.client.*`, `run_doc_method`, `builder.api.*`) are answered by this module, so the
 * editor itself needs no change. Only what the editor uses is answered; anything else is refused in words, never made up.
 *
 * Nothing in this file knows who is asking: the store it is given is already the one of the verified organization and person.
 */
export class EditorError extends Error {
  constructor(
    readonly status: number,
    readonly excType: string,
    message: string,
  ) {
    super(message);
  }
}

export type StoreOutcome = "ok" | "exists" | "not_found" | "limit" | "forbidden";
export interface DocStore {
  list(doctype: string): Promise<Doc[]>;
  get(doctype: string, name: string): Promise<Doc | null>;
  insert(doc: Doc): Promise<Extract<StoreOutcome, "ok" | "exists" | "limit" | "forbidden">>;
  replace(doc: Doc): Promise<Extract<StoreOutcome, "ok" | "not_found" | "forbidden">>;
  remove(doctype: string, name: string): Promise<Extract<StoreOutcome, "ok" | "not_found" | "forbidden">>;
  rename(doctype: string, from: string, to: string): Promise<Extract<StoreOutcome, "ok" | "not_found" | "exists" | "forbidden">>;
}

export interface Env {
  store: DocStore;
  /** The address of the person, as Frappe writes `owner` and `modified_by`. */
  user: string;
  now: () => Date;
  /** `length` lowercase letters and digits that nobody can guess. */
  hash: (length: number) => string;
  /** Does the organization have an address for its site? A page can only be published where it has one. Absent: not asked. */
  siteReady?: () => Promise<boolean>;
}

export type Params = Record<string, unknown>;

/** The types the editor may keep, with how many of each an organization may have. The database repeats the list of types. */
export const DOCTYPES: Record<string, number> = {
  "Builder Page": 200,
  "Builder Component": 300,
  "Block Template": 200,
  "Builder Client Script": 500,
  "Builder Page Client Script": 1000,
  "Builder Project Folder": 100,
  "Builder Settings": 1,
  "Website Settings": 1,
  "Website Route Redirect": 200,
  "User Font": 100,
  "Builder Token": 300,
  "Builder Variable": 300,
  "Builder Snapshot": 2000,
};
const SINGLES = new Set(["Builder Settings", "Website Settings"]);
const JSON_TEXT_FIELDS = ["blocks", "draft_blocks"];
export const MAX_DOC_CHARS = 1_400_000;
const KEEP_PUBLISH_SNAPSHOTS = 20;

const fail = (status: number, excType: string, message: string): never => {
  throw new EditorError(status, excType, message);
};
const text = (value: unknown) => (typeof value === "string" ? value : "");
const record = (value: unknown): Params => {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Params) : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Params) : {};
};
function doctypeOf(value: unknown): string {
  const doctype = text(value);
  if (!(doctype in DOCTYPES)) fail(403, "PermissionError", `O editor não guarda documentos do tipo “${doctype || "?"}”.`);
  return doctype;
}

/** Frappe writes `2026-10-30 10:15:42.123456`. */
export const stamp = (date: Date) => date.toISOString().replace("T", " ").replace("Z", "000");

/** A title as the part of an address: lowercase letters and digits joined by hyphens. */
export const slugOf = (title: string) =>
  title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

/** A block tree handed over as a list is kept as text, as the editor reads it back. */
function normalize(doc: Doc): Doc {
  for (const field of JSON_TEXT_FIELDS) {
    const value = doc[field];
    if (value !== null && value !== undefined && typeof value !== "string") doc[field] = JSON.stringify(value);
  }
  return doc;
}

function checkSize(doc: Doc) {
  if (JSON.stringify(doc).length > MAX_DOC_CHARS) fail(413, "ValidationError", "O documento passou do tamanho que o editor guarda.");
}

function single(doctype: string, now: Date, user: string): Doc {
  return { doctype, name: doctype, creation: stamp(now), modified: stamp(now), modified_by: user, owner: user, docstatus: 0, idx: 0 };
}

async function nameFor(env: Env, doctype: string, wanted: unknown): Promise<string> {
  if (SINGLES.has(doctype)) return doctype;
  const given = text(wanted).trim();
  if (given) return given;
  if (doctype === "Builder Page") return `page-${env.hash(8)}`;
  if (doctype === "Builder Snapshot") return `snapshot-${env.hash(10)}`;
  return env.hash(10);
}

/** A route has no slashes at its ends and no spaces; an empty one is `pages/<name>`. */
const cleanRoute = (route: unknown) => text(route).replace(/^[/.\s]+|[/.\s]+$/g, "");

async function ensureFreeRoute(env: Env, route: string, except: string) {
  if (!route) return;
  const taken = (await env.store.list("Builder Page")).find((doc) => doc.name !== except && cleanRoute(doc.route) === route);
  if (taken) fail(409, "DuplicateEntryError", `Já existe uma página com o endereço “${route}”.`);
}

// ---- documents ----

async function get(env: Env, params: Params): Promise<Doc> {
  const doctype = doctypeOf(params.doctype);
  const name = text(params.name) || (SINGLES.has(doctype) ? doctype : "");
  const found = await env.store.get(doctype, name);
  if (found) return found;
  if (SINGLES.has(doctype)) return single(doctype, env.now(), env.user);
  return fail(404, "DoesNotExistError", `${doctype} ${name} não foi encontrado.`);
}

async function getList(env: Env, params: Params): Promise<unknown[]> {
  const doctype = doctypeOf(params.doctype);
  let docs: Doc[];
  try {
    docs = select(await env.store.list(doctype), params.filters, params.or_filters);
  } catch (error) {
    if (error instanceof Error && error.message === "BAD_FILTER") fail(417, "ValidationError", "O filtro pedido não é aceito.");
    throw error;
  }
  const ordered = order(docs, params.order_by ?? "modified desc");
  const length = params.limit_page_length ?? params.limit ?? params.page_length;
  return slice(ordered, params.limit_start ?? params.start, length).map((doc) => project(doc, params.fields));
}

async function insert(env: Env, params: Params): Promise<Doc> {
  const given = record(params.doc);
  const doctype = doctypeOf(given.doctype);
  const now = env.now();
  const doc = normalize({ ...given, doctype, name: await nameFor(env, doctype, given.name) });
  doc.creation = stamp(now);
  doc.modified = stamp(now);
  doc.owner = env.user;
  doc.modified_by = env.user;
  doc.docstatus = 0;
  doc.idx = Number(doc.idx) || 0;
  if (doctype === "Builder Page") {
    doc.page_title = text(doc.page_title).trim() || "My Page";
    doc.page_name = text(doc.page_name) || doc.name;
    doc.route = cleanRoute(doc.route) || `pages/${doc.name}`;
    await ensureFreeRoute(env, text(doc.route), text(doc.name));
    doc.blocks = text(doc.blocks) || "[]";
    for (const flag of ["published", "staging", "is_standard", "is_template"]) doc[flag] = Number(doc[flag]) || 0;
  }
  checkSize(doc);
  const outcome = await env.store.insert(doc);
  if (outcome === "exists") fail(409, "DuplicateEntryError", `${doctype} ${doc.name} já existe.`);
  if (outcome === "limit") fail(409, "ValidationError", `O limite de ${DOCTYPES[doctype]} documentos do tipo “${doctype}” foi atingido.`);
  if (outcome === "forbidden") fail(403, "PermissionError", "Só o proprietário ou a gestão alteram o site.");
  return doc;
}

async function save(env: Env, doc: Doc, changes: Params): Promise<Doc> {
  const next = normalize({ ...doc, ...changes, doctype: doc.doctype, name: doc.name });
  // What identifies a document, and who made it, is not the editor's to change.
  for (const field of ["creation", "owner"]) next[field] = doc[field];
  next.modified = stamp(env.now());
  next.modified_by = env.user;
  if (doc.doctype === "Builder Page") {
    next.route = cleanRoute(next.route) || `pages/${doc.name}`;
    if (next.route !== cleanRoute(doc.route)) await ensureFreeRoute(env, text(next.route), doc.name);
    next.blocks = text(next.blocks) || "[]";
  }
  checkSize(next);
  const outcome = await env.store.replace(next);
  if (outcome === "not_found") fail(404, "DoesNotExistError", `${doc.doctype} ${doc.name} não foi encontrado.`);
  if (outcome === "forbidden") fail(403, "PermissionError", "Só o proprietário ou a gestão alteram o site.");
  return next;
}

async function setValue(env: Env, params: Params): Promise<Doc> {
  const doctype = doctypeOf(params.doctype);
  const name = text(params.name) || (SINGLES.has(doctype) ? doctype : "");
  const field = params.fieldname;
  const changes: Params = typeof field === "string" && !field.startsWith("{") ? { [field]: params.value } : record(field);
  const existing = await env.store.get(doctype, name);
  if (!existing && SINGLES.has(doctype)) {
    const fresh = single(doctype, env.now(), env.user);
    const outcome = await env.store.insert(normalize({ ...fresh, ...changes, doctype, name }));
    if (outcome === "forbidden") fail(403, "PermissionError", "Só o proprietário ou a gestão alteram o site.");
    return (await env.store.get(doctype, name)) ?? fresh;
  }
  if (!existing) return fail(404, "DoesNotExistError", `${doctype} ${name} não foi encontrado.`);
  return save(env, existing, changes);
}

async function remove(env: Env, params: Params): Promise<string> {
  const doctype = doctypeOf(params.doctype);
  const name = text(params.name);
  if (SINGLES.has(doctype)) fail(417, "ValidationError", "Esse documento não é apagado.");
  const outcome = await env.store.remove(doctype, name);
  if (outcome === "not_found") fail(404, "DoesNotExistError", `${doctype} ${name} não foi encontrado.`);
  if (outcome === "forbidden") fail(403, "PermissionError", "Só o proprietário ou a gestão alteram o site.");
  if (doctype === "Builder Page") {
    // What belonged to the page goes with it: its snapshots.
    for (const snapshot of await env.store.list("Builder Snapshot")) {
      if (snapshot.reference_doctype === "Builder Page" && snapshot.reference_name === name) await env.store.remove("Builder Snapshot", snapshot.name);
    }
  }
  return "ok";
}

async function renameDoc(env: Env, params: Params): Promise<string> {
  const doctype = doctypeOf(params.doctype);
  const from = text(params.old_name ?? params.old);
  const to = text(params.new_name ?? params.new).trim();
  if (!to) fail(417, "ValidationError", "O novo nome está vazio.");
  const outcome = await env.store.rename(doctype, from, to);
  if (outcome === "not_found") fail(404, "DoesNotExistError", `${doctype} ${from} não foi encontrado.`);
  if (outcome === "exists") fail(409, "DuplicateEntryError", `${doctype} ${to} já existe.`);
  if (outcome === "forbidden") fail(403, "PermissionError", "Só o proprietário ou a gestão alteram o site.");
  return to;
}

// ---- snapshots (the versions of a page) ----

async function takeSnapshot(env: Env, page: Doc, type: "Publish" | "Manual", label: string | null): Promise<string | null> {
  const field = type === "Publish" || page.draft_blocks ? "draft_blocks" : "blocks";
  const data = { [field]: page[field] ?? null, page_data_script: page.page_data_script ?? null };
  // A page with nothing in it has nothing to keep (Frappe would keep "[]").
  if (!data[field] || data[field] === "[]") return null;
  const encoded = JSON.stringify(data);
  const snapshots = (await env.store.list("Builder Snapshot")).filter((entry) => entry.reference_doctype === "Builder Page" && entry.reference_name === page.name);
  const latest = order(snapshots.filter((entry) => entry.snapshot_type === type), "creation desc")[0];
  if (latest && latest.data === encoded) return null;
  const snapshot = await insert(env, {
    doc: { doctype: "Builder Snapshot", reference_doctype: "Builder Page", reference_name: page.name, snapshot_type: type, label: label ?? "", data: encoded },
  });
  if (type === "Publish") {
    const publishes = order(snapshots.filter((entry) => entry.snapshot_type === "Publish"), "creation desc");
    for (const old of publishes.slice(KEEP_PUBLISH_SNAPSHOTS - 1)) await env.store.remove("Builder Snapshot", old.name);
  }
  return text(snapshot.name);
}

async function promoteDraft(env: Env, page: Doc): Promise<Params> {
  if (!page.draft_blocks) return {};
  await takeSnapshot(env, page, "Publish", null);
  return { blocks: page.draft_blocks, draft_blocks: null };
}

async function needSite(env: Env): Promise<void> {
  if (env.siteReady && !(await env.siteReady())) fail(417, "ValidationError", "Defina o endereço do site em Meu Site antes de publicar uma página.");
}

async function pageMethod(env: Env, name: string, method: string, args: Params): Promise<{ message: unknown; page?: Doc }> {
  const page = await get(env, { doctype: "Builder Page", name });
  const now = stamp(env.now());
  switch (method) {
    case "publish": {
      await needSite(env);
      const saved = await save(env, page, { published: 1, staging: 0, published_at: now, ...(await promoteDraft(env, page)) });
      return { message: saved.route, page: saved };
    }
    case "publish_to_staging": {
      await needSite(env);
      if (Number(page.published)) fail(417, "ValidationError", "Esta página está no ar. Marque-a como em teste.");
      const saved = await save(env, page, { staging: 1, ...(await promoteDraft(env, page)) });
      return { message: saved.route, page: saved };
    }
    case "mark_as_staging": {
      if (!Number(page.published)) fail(417, "ValidationError", "Só uma página no ar pode ir para teste.");
      return { message: null, page: await save(env, page, { published: 0, staging: 1 }) };
    }
    case "unpublish":
      return { message: null, page: await save(env, page, { published: 0, staging: 0 }) };
    case "create_manual_snapshot":
      return { message: await takeSnapshot(env, page, "Manual", args.label === undefined ? null : text(args.label)) };
    case "restore_snapshot": {
      const snapshot = await get(env, { doctype: "Builder Snapshot", name: text(args.snapshot) });
      if (snapshot.reference_doctype !== "Builder Page" || snapshot.reference_name !== name) fail(417, "ValidationError", "Esta versão não é desta página.");
      const data = record(snapshot.data);
      const blocks = data.draft_blocks ?? data.blocks;
      const saved = await save(env, page, { draft_blocks: blocks ?? null, ...("page_data_script" in data ? { page_data_script: data.page_data_script } : null) });
      return { message: null, page: saved };
    }
    // The python script that fed a page with data does not run here; the page has none.
    case "get_page_data":
      return { message: {} };
    case "get_outdated_component_pins":
      return { message: [] };
    case "get_current_component_version":
      return { message: null };
    default:
      return fail(404, "ValidationError", `O método “${method}” não existe neste editor.`);
  }
}

async function runDocMethod(env: Env, params: Params): Promise<{ message: unknown; docs: Doc[] }> {
  const doctype = doctypeOf(params.dt ?? params.doctype);
  const name = text(params.dn ?? params.name);
  const method = text(params.method);
  if (doctype !== "Builder Page") {
    if (doctype === "Builder Component" && method === "sync_component") return { message: null, docs: [] };
    return fail(404, "ValidationError", `O método “${method}” não existe neste editor.`);
  }
  const { message, page } = await pageMethod(env, name, method, record(params.args));
  return { message, docs: page ? [page] : [] };
}

// ---- builder.api ----

function copyTitle(title: string, siblings: string[]): string {
  const base = title.replace(/ \(Copy(?: \d+)?\)(?: \d+)?$/, "");
  const pattern = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(Copy(?: (\\d+))?\\)$`);
  const numbers = siblings.flatMap((entry) => {
    const found = pattern.exec(entry);
    return found ? [Number(found[1] ?? 1)] : [];
  });
  return numbers.length ? `${base} (Copy ${Math.max(...numbers) + 1})` : `${base} (Copy)`;
}

async function duplicatePage(env: Env, params: Params): Promise<Doc> {
  const source = await get(env, { doctype: "Builder Page", name: params.page_name });
  const siblings = (await env.store.list("Builder Page")).map((entry) => text(entry.page_title));
  const copy: Params = { ...source };
  for (const field of ["name", "page_name", "route", "creation", "modified", "published_at", "preview"]) delete copy[field];
  return insert(env, {
    doc: { ...copy, doctype: "Builder Page", page_title: copyTitle(text(source.page_title) || text(source.page_name), siblings), published: 0, staging: 0, is_standard: 0, app: null },
  });
}

async function updatePageFolder(env: Env, params: Params): Promise<null> {
  const names = Array.isArray(params.pages) ? params.pages.map(String) : [];
  for (const name of names) {
    const page = await env.store.get("Builder Page", name);
    if (page) await env.store.replace({ ...page, project_folder: text(params.folder_name) });
  }
  return null;
}

async function deleteFolder(env: Env, params: Params): Promise<null> {
  const folder = text(params.folder_name);
  for (const page of await env.store.list("Builder Page")) {
    if (page.project_folder === folder) await env.store.replace({ ...page, project_folder: "" });
  }
  for (const entry of await env.store.list("Builder Project Folder")) {
    if (entry.folder_name === folder) await env.store.remove("Builder Project Folder", entry.name);
  }
  return null;
}

async function versionedDoc(env: Env, params: Params): Promise<Doc> {
  const snapshot = await get(env, { doctype: "Builder Snapshot", name: params.snapshot });
  const current = await env.store.get(text(snapshot.reference_doctype), text(snapshot.reference_name));
  const base: Doc = current ?? ({ doctype: text(snapshot.reference_doctype), name: text(snapshot.reference_name) } as Doc);
  return { ...base, ...record(snapshot.data) } as Doc;
}

/** What the editor asks that this app answers with a fixed value: the features that are off (AI, plugins, hub templates, analytics). */
const FIXED: Record<string, unknown> = {
  "builder.api.is_site_read_only": false,
  "builder.api.get_apps": [],
  "builder.api.get_template_groups": [],
  "builder.api.get_component_data": {},
  "builder.api.get_codemirror_completions": [],
  "builder.api.get_builder_users": [],
  "builder.api.get_pending_invitations": [],
  "builder.api.identify_persona": null,
  "builder.api.get_page_analytics": [],
  "builder.api.get_overall_analytics": [],
  "builder.api.get_page_ctr": [],
  "builder.ai.api.ai_setup_state": { configured: false },
  "builder.ai.api.get_ai_models": [],
  "builder.ai.api.list_page_ai_sessions": [],
  "builder.ai.api.get_ai_session": null,
  "builder.ai.api.sync_ai_models": [],
  "builder.plugins.installations.can_manage_plugins": false,
  "builder.plugins.installations.get_installations": [],
  "builder.plugins.state": [],
  "builder.plugins.get_startup_plugins": [],
  "frappe.client.has_permission": { has_permission: true },
  "frappe.utils.telemetry.pulse.client.boot_config": null,
  "frappe.translate.get_boot_translations": {},
};

/** The answer to one call, as the body the editor reads (`{message}`, and `docs` for a document method). */
export async function call(env: Env, method: string, params: Params): Promise<{ message: unknown; docs?: Doc[] }> {
  if (method in FIXED) return { message: structuredClone(FIXED[method]) };
  switch (method) {
    case "frappe.client.get":
      return { message: await get(env, params) };
    case "frappe.client.get_list":
      return { message: await getList(env, params) };
    case "frappe.client.get_count":
      return { message: (await getList(env, { ...params, fields: ["name"], limit_page_length: 0 })).length };
    case "frappe.client.get_value": {
      const rows = (await getList(env, { ...params, limit_page_length: 1 })) as Params[];
      const fields = Array.isArray(params.fieldname) ? params.fieldname : [params.fieldname];
      return { message: rows[0] ? Object.fromEntries(fields.map((field) => [String(field), rows[0][String(field)]])) : null };
    }
    case "frappe.client.insert":
      return { message: await insert(env, params) };
    case "frappe.client.set_value":
      return { message: await setValue(env, params) };
    case "frappe.client.save": {
      const given = record(params.doc);
      return { message: await setValue(env, { doctype: given.doctype, name: given.name, fieldname: given }) };
    }
    case "frappe.client.delete":
      return { message: await remove(env, params) };
    case "frappe.client.rename_doc":
      return { message: await renameDoc(env, params) };
    case "run_doc_method":
      return runDocMethod(env, params);
    case "builder.api.get_versioned_doc":
      return { message: await versionedDoc(env, params) };
    case "builder.api.duplicate_page":
      return { message: await duplicatePage(env, params) };
    case "builder.api.update_page_folder":
      return { message: await updatePageFolder(env, params) };
    case "builder.api.delete_folder":
      return { message: await deleteFolder(env, params) };
    case "builder.api.sync_component":
      return { message: null };
    default:
      return fail(501, "NotImplementedError", `A função “${method}” do editor não está disponível aqui.`);
  }
}
