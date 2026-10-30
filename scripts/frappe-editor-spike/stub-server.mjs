import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const DIST = "/home/user/rafsoaresm/builder/builder/public/frontend";
const SHELL = fs.readFileSync("/home/user/rafsoaresm/builder/builder/www/_builder.html", "utf8");
const MIME = { ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2", ".html": "text/html" };
const PREFIX = "/assets/builder/frontend/";
const BASE = "/builder";
const log = [];
const store = { "Builder Page": [], "Builder Component": [], "Builder Variable": [], "User Font": [], "Block Template": [], "Builder Settings": [{ name: "Builder Settings" }], "Builder Project Folder": [], "Builder Client Script": [] };
function shell() {
  let h = SHELL;
  h = h.replace(/\{% if editor_demo %\}[\s\S]*?\{% endif %\}/, "");
  h = h.replace(/\{% for key in boot %\}[\s\S]*?\{% endfor %\}/, 'window["translated_messages"] = {};');
  const vars = { csrf_token: "x", builder_path: BASE, site_name: "localhost", "socketio_port or ''": "", builder_version: "develop", is_fc_site: "False", is_developer_mode: "False", is_read_only_mode: "False" };
  for (const [k, v] of Object.entries(vars)) h = h.replaceAll(`{{ ${k} }}`, v);
  return h;
}
const send = (res, code, body, type = "application/json", extra = {}) => { res.writeHead(code, { "content-type": type, ...extra }); res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const readBody = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b)); });
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.startsWith(PREFIX)) {
    const f = path.join(DIST, url.pathname.slice(PREFIX.length));
    if (f.startsWith(DIST) && fs.existsSync(f) && fs.statSync(f).isFile()) return send(res, 200, fs.readFileSync(f), MIME[path.extname(f)] || "application/octet-stream");
    return send(res, 404, "nf", "text/plain");
  }
  if (url.pathname === BASE || url.pathname.startsWith(BASE + "/")) return send(res, 200, shell(), "text/html", { "set-cookie": "user_id=Administrator; Path=/" });
  if (url.pathname.startsWith("/api/")) {
    const body = await readBody(req);
    const method = decodeURIComponent(url.pathname.replace(/^\/api\/(method|resource)\//, ""));
    log.push(`${req.method} ${url.pathname}${url.search.slice(0, 120)} ${body.slice(0, 200)}`);
    let params = {};
    try { params = body ? JSON.parse(body) : {}; } catch { params = Object.fromEntries(new URLSearchParams(body)); }
    for (const [k, v] of url.searchParams) params[k] = v;
    const rid = () => Math.random().toString(36).slice(2, 12);
    const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);
    const docs = (t) => (store[t] ||= []);
    const JSONF = ["blocks", "draft_blocks"];
    const norm = (d) => { for (const k of JSONF) if (d[k] && typeof d[k] !== "string") d[k] = JSON.stringify(d[k]); return d; };
    const ARR = ["builder.ai.api.get_ai_models", "builder.plugins.installations.get_installations", "builder.api.get_apps", "builder.api.get_template_groups", "builder.ai.api.list_page_ai_sessions"];
    const STUB = { "builder.api.get_component_data": {}, "builder.api.get_codemirror_completions": [], "builder.api.is_site_read_only": false, "builder.ai.api.ai_setup_state": { configured: false }, "builder.ai.api.get_ai_session": null, "builder.ai.api.sync_ai_models": [], "builder.api.get_versioned_doc": null };
    if (method in STUB) return send(res, 200, { message: STUB[method] });
    if (ARR.includes(method)) return send(res, 200, { message: [] });
    if (method === "builder.plugins.installations.can_manage_plugins") return send(res, 200, { message: false });
    if (method === "frappe.client.has_permission") return send(res, 200, { message: { has_permission: true } });
    if (method === "frappe.client.insert") { const d = typeof params.doc === "string" ? JSON.parse(params.doc) : params.doc; const nm = d.name || rid(); const doc = { name: nm, creation: now(), modified: now(), owner: "Administrator", modified_by: "Administrator", ...(d.doctype === "Builder Page" ? { page_name: "page-" + nm, route: d.route || "page-" + nm } : null), ...norm(d) }; docs(d.doctype).push(doc); return send(res, 200, { message: doc }); }
    if (method === "frappe.client.get") { const d = docs(params.doctype).find((x) => x.name === params.name); if (!d && params.name === params.doctype) return send(res, 200, { message: { name: params.name, doctype: params.doctype } }); return d ? send(res, 200, { message: d }) : send(res, 404, { exc_type: "DoesNotExistError", exception: "not found", _server_messages: "[]" }); }
    if (method === "frappe.client.set_value") { const d = docs(params.doctype).find((x) => x.name === params.name); let f = params.fieldname; if (typeof f === "string") { try { f = JSON.parse(f); } catch { f = { [f]: params.value }; } } if (d) Object.assign(d, norm(f), { modified: now() }); return send(res, 200, { message: d }); }
    if (method === "frappe.client.delete") { store[params.doctype] = docs(params.doctype).filter((x) => x.name !== params.name); return send(res, 200, { message: "ok" }); }
    if (method === "run_doc_method") return send(res, 200, { message: {}, docs: [] });
    if (url.pathname.startsWith("/api/resource/")) return send(res, 200, { data: store[method.split("/")[0]] || [] });
    if (method === "frappe.client.get_list") { return send(res, 200, { message: docs(params.doctype) }); }
    return send(res, 200, { message: null });
  }
  if (url.pathname === "/__log") return send(res, 200, log.join("\n"), "text/plain");
  send(res, 404, "nf", "text/plain");
}).listen(8899, () => console.log("spike on 8899"));
