import { beforeEach, describe, expect, it } from "vitest";
import type { Doc } from "@/modules/frappe-editor/doc-query";
import { DOCTYPES, EditorError, MAX_DOC_CHARS, call, slugOf, stamp, type DocStore, type Env, type Params } from "@/modules/frappe-editor/protocol";

/** The store of one organization, in memory: what the D1 repository does, without the database. */
function memoryStore(): DocStore & { rows: Map<string, Doc>; denied: boolean } {
  const rows = new Map<string, Doc>();
  const key = (doctype: string, name: string) => `${doctype}\u0000${name}`;
  const store = {
    rows,
    denied: false,
    async list(doctype: string) {
      return store.denied ? [] : [...rows.values()].filter((doc) => doc.doctype === doctype).map((doc) => structuredClone(doc));
    },
    async get(doctype: string, name: string) {
      const found = store.denied ? undefined : rows.get(key(doctype, name));
      return found ? structuredClone(found) : null;
    },
    async insert(doc: Doc) {
      if (store.denied) return "forbidden" as const;
      if (rows.has(key(doc.doctype, doc.name))) return "exists" as const;
      if ([...rows.values()].filter((entry) => entry.doctype === doc.doctype).length >= DOCTYPES[doc.doctype]) return "limit" as const;
      rows.set(key(doc.doctype, doc.name), structuredClone(doc));
      return "ok" as const;
    },
    async replace(doc: Doc) {
      if (store.denied) return "forbidden" as const;
      if (!rows.has(key(doc.doctype, doc.name))) return "not_found" as const;
      rows.set(key(doc.doctype, doc.name), structuredClone(doc));
      return "ok" as const;
    },
    async remove(doctype: string, name: string) {
      if (store.denied) return "forbidden" as const;
      return rows.delete(key(doctype, name)) ? ("ok" as const) : ("not_found" as const);
    },
    async rename(doctype: string, from: string, to: string) {
      if (store.denied) return "forbidden" as const;
      const found = rows.get(key(doctype, from));
      if (!found) return "not_found" as const;
      if (rows.has(key(doctype, to))) return "exists" as const;
      rows.delete(key(doctype, from));
      rows.set(key(doctype, to), { ...found, name: to });
      return "ok" as const;
    },
  };
  return store;
}

let store: ReturnType<typeof memoryStore>;
let clock = Date.parse("2026-10-30T10:00:00.000Z");
let counter = 0;
const env = (): Env => ({
  store,
  user: "marina@example.test",
  now: () => new Date((clock += 1000)),
  hash: (length) => String(++counter).padStart(length, "0"),
});
const run = async (method: string, params: Params = {}) => (await call(env(), method, params)).message as Record<string, unknown> & unknown[];
const fails = async (method: string, params: Params, status: number, excType?: string) => {
  const error = await call(env(), method, params).then(
    () => null,
    (caught) => caught,
  );
  expect(error, `${method} should have failed`).toBeInstanceOf(EditorError);
  expect((error as EditorError).status).toBe(status);
  if (excType) expect((error as EditorError).excType).toBe(excType);
  return error as EditorError;
};
const newPage = async (extra: Params = {}) => (await run("frappe.client.insert", { doc: { doctype: "Builder Page", ...extra } })) as unknown as Doc;
const blocks = (label: string) => [{ blockId: "root", element: "div", children: [{ blockId: label, element: "p", innerText: label }] }];

beforeEach(() => {
  store = memoryStore();
  counter = 0;
});

describe("creating a page", () => {
  it("names it, titles it and routes it the way Frappe does, and keeps the blocks as the text the editor reads back", async () => {
    const page = await newPage({ draft_blocks: blocks("a") });
    expect(page).toMatchObject({ doctype: "Builder Page", name: "page-00000001", page_title: "My Page", page_name: "page-00000001", route: "pages/page-00000001", published: 0, staging: 0, blocks: "[]", owner: "marina@example.test", modified_by: "marina@example.test", docstatus: 0 });
    expect(typeof page.draft_blocks).toBe("string");
    expect(JSON.parse(page.draft_blocks as string)).toEqual(blocks("a"));
  });
  it("takes the title and the route that were asked for, trimming the slashes", async () => {
    const page = await newPage({ page_title: "  Sobre  ", route: "/sobre-mim/" });
    expect(page).toMatchObject({ page_title: "Sobre", route: "sobre-mim" });
  });
  it("does not let two pages share an address", async () => {
    await newPage({ route: "sobre" });
    await fails("frappe.client.insert", { doc: { doctype: "Builder Page", route: "/sobre" } }, 409, "DuplicateEntryError");
  });
  it("does not trust the dates, the owner, the status or the flags the editor sends", async () => {
    const page = await newPage({ creation: "1999-01-01", owner: "someone@else.test", docstatus: 1, published: "1", is_template: "yes" });
    expect(page.creation).toBe(stamp(new Date(clock)));
    expect(page).toMatchObject({ owner: "marina@example.test", docstatus: 0, published: 1, is_template: 0 });
  });
  it("refuses a type the editor does not keep, an empty document and one that is too big", async () => {
    await fails("frappe.client.insert", { doc: { doctype: "User", name: "x" } }, 403, "PermissionError");
    await fails("frappe.client.insert", { doc: { doctype: "Builder AI Provider", name: "x" } }, 403);
    await fails("frappe.client.insert", { doc: {} }, 403);
    await fails("frappe.client.insert", { doc: { doctype: "Builder Page", draft_blocks: "x".repeat(MAX_DOC_CHARS) } }, 413);
  });
  it("refuses the page beyond the limit of the organization, and a name that is taken", async () => {
    for (let index = 0; index < DOCTYPES["Builder Page"]; index++) await newPage({ route: `p-${index}` });
    await fails("frappe.client.insert", { doc: { doctype: "Builder Page", route: "one-more" } }, 409, "ValidationError");
    store = memoryStore();
    await newPage({ name: "mine" });
    await fails("frappe.client.insert", { doc: { doctype: "Builder Page", name: "mine", route: "other" } }, 409, "DuplicateEntryError");
  });
  it("is refused to a person who may not edit the site", async () => {
    store.denied = true;
    await fails("frappe.client.insert", { doc: { doctype: "Builder Page" } }, 403, "PermissionError");
  });
});

describe("reading and changing a document", () => {
  it("gives the document back, and says so in words when it is not there", async () => {
    const page = await newPage({ page_title: "Início" });
    expect(await run("frappe.client.get", { doctype: "Builder Page", name: page.name })).toMatchObject({ page_title: "Início" });
    const error = await fails("frappe.client.get", { doctype: "Builder Page", name: "page-nope" }, 404, "DoesNotExistError");
    expect(error.message).toContain("page-nope");
  });
  it("answers a single document (the settings) even before it was ever saved, and keeps what is saved in it", async () => {
    expect(await run("frappe.client.get", { doctype: "Builder Settings" })).toMatchObject({ doctype: "Builder Settings", name: "Builder Settings" });
    expect(await run("frappe.client.get", { doctype: "Website Settings", name: "Website Settings" })).toMatchObject({ name: "Website Settings" });
    await run("frappe.client.set_value", { doctype: "Builder Settings", fieldname: { script_editor_theme: "dark" } });
    expect(await run("frappe.client.get", { doctype: "Builder Settings" })).toMatchObject({ script_editor_theme: "dark" });
    await fails("frappe.client.delete", { doctype: "Builder Settings", name: "Builder Settings" }, 417);
  });
  it("changes fields, from an object or from one field and its value, and stamps the change", async () => {
    const page = await newPage();
    const first = await run("frappe.client.set_value", { doctype: "Builder Page", name: page.name, fieldname: { page_title: "Novo", draft_blocks: blocks("b") } });
    expect(first).toMatchObject({ page_title: "Novo", modified_by: "marina@example.test" });
    expect(first.modified).not.toBe(page.modified);
    expect(typeof first.draft_blocks).toBe("string");
    expect(await run("frappe.client.set_value", { doctype: "Builder Page", name: page.name, fieldname: "page_title", value: "Outro" })).toMatchObject({ page_title: "Outro" });
    expect(await run("frappe.client.set_value", { doctype: "Builder Page", name: page.name, fieldname: '{"page_title":"Texto"}' })).toMatchObject({ page_title: "Texto" });
  });
  it("never lets the editor change who made a document, when, or what it is called", async () => {
    const page = await newPage();
    const saved = await run("frappe.client.set_value", { doctype: "Builder Page", name: page.name, fieldname: { owner: "x@y.z", creation: "1999-01-01", name: "other", doctype: "User" } });
    expect(saved).toMatchObject({ owner: "marina@example.test", creation: page.creation, name: page.name, doctype: "Builder Page" });
  });
  it("keeps an address for one page only, and says what is missing", async () => {
    const a = await newPage({ route: "a" });
    const b = await newPage({ route: "b" });
    await fails("frappe.client.set_value", { doctype: "Builder Page", name: b.name, fieldname: { route: "/a/" } }, 409, "DuplicateEntryError");
    expect(await run("frappe.client.set_value", { doctype: "Builder Page", name: a.name, fieldname: { route: "a", page_title: "Mesma" } })).toMatchObject({ route: "a" });
    await fails("frappe.client.set_value", { doctype: "Builder Page", name: "page-nope", fieldname: { page_title: "x" } }, 404);
  });
  it("saves a whole document, deletes one, and renames one without taking another's name", async () => {
    const page = await newPage({ page_title: "A" });
    const other = await newPage({ page_title: "B", route: "b" });
    expect(await run("frappe.client.save", { doc: { ...page, page_title: "A2" } })).toMatchObject({ page_title: "A2" });
    await fails("frappe.client.rename_doc", { doctype: "Builder Page", old_name: page.name, new_name: other.name }, 409, "DuplicateEntryError");
    await fails("frappe.client.rename_doc", { doctype: "Builder Page", old_name: "page-nope", new_name: "x" }, 404);
    await fails("frappe.client.rename_doc", { doctype: "Builder Page", old_name: page.name, new_name: " " }, 417);
    expect(await run("frappe.client.rename_doc", { doctype: "Builder Page", old_name: page.name, new_name: "inicio" })).toBe("inicio");
    expect(await run("frappe.client.delete", { doctype: "Builder Page", name: "inicio" })).toBe("ok");
    await fails("frappe.client.delete", { doctype: "Builder Page", name: "inicio" }, 404);
  });
});

describe("listing documents", () => {
  it("filters, orders, cuts and projects as the editor asks", async () => {
    await newPage({ page_title: "A", route: "a", published: 1 });
    await newPage({ page_title: "B", route: "b" });
    await newPage({ page_title: "C", route: "c", published: 1 });
    const rows = (await run("frappe.client.get_list", { doctype: "Builder Page", fields: ["name", "page_title"], filters: { published: 1 }, order_by: "page_title desc" })) as unknown as Doc[];
    expect(rows.map((row) => row.page_title)).toEqual(["C", "A"]);
    expect(Object.keys(rows[0]).sort()).toEqual(["name", "page_title"]);
    const paged = (await run("frappe.client.get_list", { doctype: "Builder Page", fields: ["page_title"], order_by: "page_title asc", limit_start: 1, limit_page_length: 1 })) as unknown as Doc[];
    expect(paged).toEqual([{ page_title: "B" }]);
    const ored = (await run("frappe.client.get_list", { doctype: "Builder Page", fields: ["page_title"], or_filters: { published: 1, route: "b" }, order_by: "page_title asc" })) as unknown as Doc[];
    expect(ored.map((row) => row.page_title)).toEqual(["A", "B", "C"]);
    expect(await run("frappe.client.get_count", { doctype: "Builder Page", filters: { published: 1 } })).toBe(2);
    expect(await run("frappe.client.get_value", { doctype: "Builder Page", filters: { route: "b" }, fieldname: ["page_title", "route"] })).toEqual({ page_title: "B", route: "b" });
    expect(await run("frappe.client.get_value", { doctype: "Builder Page", filters: { route: "zz" }, fieldname: "page_title" })).toBeNull();
  });
  it("answers a filter it does not understand with a refusal, and a type it does not keep with another", async () => {
    await fails("frappe.client.get_list", { doctype: "Builder Page", filters: [["name", "regexp", "x"]] }, 417, "ValidationError");
    await fails("frappe.client.get_list", { doctype: "tabUser" }, 403);
  });
  it("lists nothing to a person who may not edit the site", async () => {
    await newPage();
    store.denied = true;
    expect(await run("frappe.client.get_list", { doctype: "Builder Page" })).toEqual([]);
  });
});

describe("publishing a page", () => {
  it("makes the draft the live version, takes a snapshot of it, and says where the page is", async () => {
    const page = await newPage({ draft_blocks: blocks("v1"), route: "inicio" });
    const body = await call(env(), "run_doc_method", { dt: "Builder Page", dn: page.name, method: "publish" });
    expect(body.message).toBe("inicio");
    const live = body.docs![0];
    expect(live).toMatchObject({ published: 1, staging: 0 });
    expect(live.published_at).toBeTruthy();
    expect(JSON.parse(live.blocks as string)).toEqual(blocks("v1"));
    expect(live.draft_blocks).toBeNull();
    const snapshots = (await run("frappe.client.get_list", { doctype: "Builder Snapshot" })) as unknown as Doc[];
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ reference_doctype: "Builder Page", reference_name: page.name, snapshot_type: "Publish" });
  });
  it("publishes again with no new draft without a second snapshot, and with the same draft without one either", async () => {
    const page = await newPage({ draft_blocks: blocks("v1") });
    const publish = () => call(env(), "run_doc_method", { dt: "Builder Page", dn: page.name, method: "publish" });
    await publish();
    await publish();
    await run("frappe.client.set_value", { doctype: "Builder Page", name: page.name, fieldname: { draft_blocks: blocks("v1") } });
    await publish();
    expect(await run("frappe.client.get_count", { doctype: "Builder Snapshot" })).toBe(1);
    await run("frappe.client.set_value", { doctype: "Builder Page", name: page.name, fieldname: { draft_blocks: blocks("v2") } });
    await publish();
    expect(await run("frappe.client.get_count", { doctype: "Builder Snapshot" })).toBe(2);
  });
  it("keeps the last twenty publications and no more", async () => {
    const page = await newPage();
    for (let index = 0; index < 23; index++) {
      await run("frappe.client.set_value", { doctype: "Builder Page", name: page.name, fieldname: { draft_blocks: blocks(`v${index}`) } });
      await call(env(), "run_doc_method", { dt: "Builder Page", dn: page.name, method: "publish" });
    }
    expect(await run("frappe.client.get_count", { doctype: "Builder Snapshot" })).toBe(20);
  });
  it("takes a page offline, tests it on staging, and refuses to stage a page that is live", async () => {
    const page = await newPage({ draft_blocks: blocks("v1") });
    const method = (name: string) => call(env(), "run_doc_method", { dt: "Builder Page", dn: page.name, method: name });
    expect((await method("publish_to_staging")).docs![0]).toMatchObject({ published: 0, staging: 1 });
    await method("publish");
    await fails("run_doc_method", { dt: "Builder Page", dn: page.name, method: "publish_to_staging" }, 417);
    expect((await method("mark_as_staging")).docs![0]).toMatchObject({ published: 0, staging: 1 });
    await fails("run_doc_method", { dt: "Builder Page", dn: page.name, method: "mark_as_staging" }, 417);
    expect((await method("unpublish")).docs![0]).toMatchObject({ published: 0, staging: 0 });
  });
});

describe("the versions of a page", () => {
  it("takes a snapshot by hand with its label, and brings one back into the draft without touching what is live", async () => {
    const page = await newPage({ draft_blocks: blocks("v1") });
    const name = (await run("run_doc_method", { dt: "Builder Page", dn: page.name, method: "create_manual_snapshot", args: { label: "Antes" } })) as unknown as { message: string };
    expect(name).toBeTruthy();
    const snapshot = (await run("frappe.client.get_list", { doctype: "Builder Snapshot", filters: { snapshot_type: "Manual" } })) as unknown as Doc[];
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].label).toBe("Antes");
    await run("frappe.client.set_value", { doctype: "Builder Page", name: page.name, fieldname: { draft_blocks: blocks("v2") } });
    const restored = await call(env(), "run_doc_method", { dt: "Builder Page", dn: page.name, method: "restore_snapshot", args: { snapshot: snapshot[0].name } });
    expect(JSON.parse(restored.docs![0].draft_blocks as string)).toEqual(blocks("v1"));
    expect(restored.docs![0].blocks).toBe("[]");
  });
  it("does not restore the snapshot of another page, nor take a snapshot of a page with nothing in it", async () => {
    const a = await newPage({ draft_blocks: blocks("a"), route: "a" });
    const b = await newPage({ route: "b" });
    await run("run_doc_method", { dt: "Builder Page", dn: a.name, method: "create_manual_snapshot" });
    const [snapshot] = (await run("frappe.client.get_list", { doctype: "Builder Snapshot" })) as unknown as Doc[];
    await fails("run_doc_method", { dt: "Builder Page", dn: b.name, method: "restore_snapshot", args: { snapshot: snapshot.name } }, 417);
    expect((await call(env(), "run_doc_method", { dt: "Builder Page", dn: b.name, method: "create_manual_snapshot" })).message).toBeNull();
  });
  it("reads a snapshot as the document looked then, on top of what the page is now, even if the page is gone", async () => {
    const page = await newPage({ page_title: "Agora", draft_blocks: blocks("v1") });
    await run("run_doc_method", { dt: "Builder Page", dn: page.name, method: "create_manual_snapshot" });
    const [snapshot] = (await run("frappe.client.get_list", { doctype: "Builder Snapshot" })) as unknown as Doc[];
    await run("frappe.client.set_value", { doctype: "Builder Page", name: page.name, fieldname: { page_title: "Depois", draft_blocks: blocks("v2") } });
    const then = await run("builder.api.get_versioned_doc", { snapshot: snapshot.name });
    expect(then.page_title).toBe("Depois");
    expect(JSON.parse(then.draft_blocks as string)).toEqual(blocks("v1"));
    store.rows.delete(`Builder Page\u0000${page.name}`);
    expect((await run("builder.api.get_versioned_doc", { snapshot: snapshot.name })).name).toBe(page.name);
  });
  it("takes the snapshots of a page with it when the page is deleted", async () => {
    const page = await newPage({ draft_blocks: blocks("v1") });
    await run("run_doc_method", { dt: "Builder Page", dn: page.name, method: "create_manual_snapshot" });
    await run("frappe.client.delete", { doctype: "Builder Page", name: page.name });
    expect(await run("frappe.client.get_count", { doctype: "Builder Snapshot" })).toBe(0);
  });
});

describe("what the editor does around the pages", () => {
  it("copies a page unpublished, with a new name and address and a title that says it is a copy, numbered when copied again", async () => {
    const page = await newPage({ page_title: "Home", route: "home", published: 1, draft_blocks: blocks("v1"), project_folder: "Site" });
    const copy = await run("builder.api.duplicate_page", { page_name: page.name });
    expect(copy).toMatchObject({ page_title: "Home (Copy)", published: 0, staging: 0, project_folder: "Site" });
    expect(copy.name).not.toBe(page.name);
    expect(copy.route).not.toBe("home");
    expect(copy.draft_blocks).toBe(page.draft_blocks);
    expect((await run("builder.api.duplicate_page", { page_name: page.name })).page_title).toBe("Home (Copy 2)");
    expect((await run("builder.api.duplicate_page", { page_name: copy.name })).page_title).toBe("Home (Copy 3)");
    await fails("builder.api.duplicate_page", { page_name: "page-nope" }, 404);
  });
  it("moves pages into a folder and takes the folder away without taking the pages", async () => {
    const a = await newPage({ route: "a" });
    const b = await newPage({ route: "b" });
    await run("frappe.client.insert", { doc: { doctype: "Builder Project Folder", folder_name: "Site" } });
    await run("builder.api.update_page_folder", { pages: [a.name, "page-nope"], folder_name: "Site" });
    expect((await run("frappe.client.get", { doctype: "Builder Page", name: a.name })).project_folder).toBe("Site");
    expect((await run("frappe.client.get", { doctype: "Builder Page", name: b.name })).project_folder).toBeUndefined();
    await run("builder.api.delete_folder", { folder_name: "Site" });
    expect((await run("frappe.client.get", { doctype: "Builder Page", name: a.name })).project_folder).toBe("");
    expect(await run("frappe.client.get_count", { doctype: "Builder Project Folder" })).toBe(0);
    expect(await run("frappe.client.get_count", { doctype: "Builder Page" })).toBe(2);
  });
});

describe("what is off", () => {
  it("answers the features this app does not have with a fixed answer, a fresh copy each time", async () => {
    expect(await run("builder.ai.api.get_ai_models")).toEqual([]);
    expect(await run("builder.ai.api.ai_setup_state")).toEqual({ configured: false });
    expect(await run("builder.plugins.installations.can_manage_plugins")).toBe(false);
    expect(await run("builder.api.get_template_groups")).toEqual([]);
    expect(await run("frappe.client.has_permission")).toEqual({ has_permission: true });
    const first = await run("builder.ai.api.ai_setup_state");
    first.configured = true;
    expect(await run("builder.ai.api.ai_setup_state")).toEqual({ configured: false });
  });
  it("answers what it does not know in words (501) and a method of a page that does not exist (404)", async () => {
    const error = await fails("builder.api.import_remote_assets", {}, 501, "NotImplementedError");
    expect(error.message).toContain("import_remote_assets");
    await fails("frappe.client.some_other_call", {}, 501);
    const page = await newPage();
    await fails("run_doc_method", { dt: "Builder Page", dn: page.name, method: "drop_table" }, 404);
    await fails("run_doc_method", { dt: "Builder Component", dn: "x", method: "evil" }, 404);
    expect((await call(env(), "run_doc_method", { dt: "Builder Page", dn: page.name, method: "get_page_data" })).message).toEqual({});
  });
});

describe("helpers", () => {
  it("writes a title as an address, without accents, and a date as Frappe does", () => {
    expect(slugOf("  Sobre Mim — Início! ")).toBe("sobre-mim-inicio");
    expect(slugOf("")).toBe("");
    expect(slugOf("x".repeat(100))).toHaveLength(60);
    expect(stamp(new Date("2026-10-30T10:15:42.123Z"))).toBe("2026-10-30 10:15:42.123000");
  });
});

describe("publishing needs an address for the site", () => {
  it("refuses to publish (and to put in test) while the organization has none, and publishes once it has", async () => {
    const page = await newPage({ draft_blocks: blocks("a") });
    const without = (): Env => ({ ...env(), siteReady: async () => false });
    for (const method of ["publish", "publish_to_staging"]) {
      const error = await call(without(), "run_doc_method", { dt: "Builder Page", dn: page.name, method }).then(
        () => null,
        (caught) => caught,
      );
      expect(error, method).toBeInstanceOf(EditorError);
      expect((error as EditorError).status).toBe(417);
      expect((error as EditorError).message).toContain("endereço do site");
    }
    expect((await store.get("Builder Page", page.name))?.published).toBe(0);
    const ready: Env = { ...env(), siteReady: async () => true };
    expect(((await call(ready, "run_doc_method", { dt: "Builder Page", dn: page.name, method: "publish" })).docs?.[0] as Doc).published).toBe(1);
  });
});

describe("the templates that come with the editor", () => {
  const standard = (name: string, over: Params = {}): Doc => ({ doctype: "Block Template", name, template_name: name, category: "Structure", sort_order: 2, block: "{}", preview: "/x/a.png", ...over });
  const withBuiltin = (): Env => ({ ...env(), builtin: (doctype) => (doctype === "Block Template" ? [standard("Navbar 1"), standard("Form 1", { category: "Basic Forms", sort_order: 14 })] : []) });
  const asBuiltin = (method: string, params: Params) => call(withBuiltin(), method, params);

  it("are listed with the person's own, ordered and filtered like any list, and read by name", async () => {
    await run("frappe.client.insert", { doc: { doctype: "Block Template", name: "Meu modelo", template_name: "Meu modelo", category: "Basic", block: "{}", sort_order: 1 } });
    const listed = (await asBuiltin("frappe.client.get_list", { doctype: "Block Template", fields: ["name", "category"], order_by: "sort_order asc" })).message as Array<{ name: string }>;
    expect(listed.map((doc) => doc.name)).toEqual(["Meu modelo", "Navbar 1", "Form 1"]);
    const forms = (await asBuiltin("frappe.client.get_list", { doctype: "Block Template", filters: { category: "Basic Forms" } })).message as Array<{ name: string }>;
    expect(forms.map((doc) => doc.name)).toEqual(["Form 1"]);
    expect(((await asBuiltin("frappe.client.get", { doctype: "Block Template", name: "Navbar 1" })).message as Doc).preview).toBe("/x/a.png");
    // a document of the person with the same name wins in the list, and is not listed twice
    await store.insert(standard("Navbar 1", { category: "Basic", sort_order: 9 }));
    const again = (await asBuiltin("frappe.client.get_list", { doctype: "Block Template", fields: ["name", "category"] })).message as Array<{ name: string; category: string }>;
    expect(again.filter((doc) => doc.name === "Navbar 1")).toEqual([{ name: "Navbar 1", category: "Basic" }]);
  });
  it("are not changed, removed, renamed or taken over by a name, and the other documents are not touched by any of it", async () => {
    for (const [method, params] of [
      ["frappe.client.set_value", { doctype: "Block Template", name: "Form 1", fieldname: "category", value: "Basic" }],
      ["frappe.client.save", { doc: { doctype: "Block Template", name: "Form 1", block: "evil" } }],
      ["frappe.client.delete", { doctype: "Block Template", name: "Form 1" }],
      ["frappe.client.rename_doc", { doctype: "Block Template", old_name: "Form 1", new_name: "Outro" }],
      ["frappe.client.rename_doc", { doctype: "Block Template", old_name: "Meu", new_name: "Form 1" }],
      ["frappe.client.insert", { doc: { doctype: "Block Template", name: "Form 1", block: "{}" } }],
    ] as const) {
      const error = await asBuiltin(method, params).then(
        () => null,
        (caught) => caught,
      );
      expect(error, method).toBeInstanceOf(EditorError);
      expect([403, 409]).toContain((error as EditorError).status);
    }
    expect(store.rows.size).toBe(0);
  });
  it("are nothing for the other types of document", async () => {
    expect(((await asBuiltin("frappe.client.get_list", { doctype: "Builder Component" })).message as unknown[]).length).toBe(0);
    await fails("frappe.client.get", { doctype: "Builder Component", name: "Navbar 1" }, 404);
  });
});
