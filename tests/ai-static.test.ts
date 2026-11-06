import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Static guards of the AI layer (design V4 §8.9, 1.2 part): the rules that keep keys, prompts and identity out of logs, clients and the wrong files.
const ROOT = new URL("..", import.meta.url).pathname;
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
const read = (path: string) => readFileSync(path, "utf8");
const PLANEJADOR = walk(join(ROOT, "src/modules/prescricao/planejador")).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
const PROVEDORES = PLANEJADOR.filter((f) => f.includes("/provedores/"));
const AI_DB = ["src/db/ai-planning.ts", "src/db/ai-platform.ts"].map((f) => join(ROOT, f));
const SRC = walk(join(ROOT, "src")).filter((f) => /\.(ts|tsx)$/.test(f));
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const rel = (f: string) => relative(ROOT, f);

describe("the AI layer never logs", () => {
  it("has no console.* call anywhere in planejador/ or the AI repositories", () => {
    for (const f of [...PLANEJADOR, ...AI_DB]) expect(stripComments(read(f)), rel(f)).not.toMatch(/\bconsole\s*\./);
  });
});

describe("environment and keys", () => {
  it("reads process.env and getCloudflareContext only in planejador/env.ts", () => {
    for (const f of PLANEJADOR.filter((p) => !p.endsWith("/env.ts"))) {
      expect(stripComments(read(f)), rel(f)).not.toMatch(/process\.env|getCloudflareContext/);
    }
    expect(read(join(ROOT, "src/modules/prescricao/planejador/env.ts"))).toMatch(/^import "server-only";/);
  });

  it("AI_PLANNER_ENABLED does not exist anywhere in src (the gates are database driven; only AI_PLANNER_DISABLED wins)", () => {
    for (const f of SRC) expect(read(f), rel(f)).not.toContain("AI_PLANNER_ENABLED");
  });

  it("no variable of the AI layer is NEXT_PUBLIC_*", () => {
    for (const f of [...SRC, ...walk(join(ROOT, "docs")).filter((d) => d.endsWith("WEBFLOW-CLOUD.md"))]) {
      expect(read(f), rel(f)).not.toMatch(/NEXT_PUBLIC_AI_/);
    }
  });

  it("key_ciphertext is named by exactly two source files: the write path and the single reader", () => {
    const files = SRC.filter((f) => read(f).includes("key_ciphertext")).map(rel).sort();
    expect(files).toEqual(["src/db/ai-planning.ts", "src/db/ai-platform.ts"]);
    // the manager repository writes it and never selects it
    const platform = stripComments(read(join(ROOT, "src/db/ai-platform.ts")));
    expect(platform.match(/key_ciphertext/g)?.length).toBeLessThanOrEqual(4);
    for (const m of platform.matchAll(/SELECT[\s\S]*?FROM/g)) expect(m[0]).not.toContain("key_ciphertext");
    // and the reader is one function selecting it for one provider
    const planning = stripComments(read(join(ROOT, "src/db/ai-planning.ts")));
    expect(planning.match(/key_ciphertext/g)).toHaveLength(1);
  });

  it("no SELECT * touches an AI table in the repositories", () => {
    for (const f of AI_DB) expect(stripComments(read(f)), rel(f)).not.toMatch(/SELECT\s+\*/i);
  });

  it("no model name is hardcoded as a fact (models are configuration)", () => {
    for (const f of [...PLANEJADOR, ...AI_DB]) {
      const text = stripComments(read(f)).replace(/mock-[a-z0-9-]+/g, "");
      expect(text, rel(f)).not.toMatch(/\b(gpt-[\w.-]+|o[134]-[\w.-]+|claude-[\w.-]+|gemini-[\w.-]+|text-embedding[\w.-]*)\b/i);
    }
  });
});

describe("providers", () => {
  it("adapters are plain modules: no server-only, no database, no env, no framework", () => {
    for (const f of PROVEDORES) {
      const text = stripComments(read(f));
      expect(text, rel(f)).not.toMatch(/server-only|from "@\/db|from "next|getCloudflareContext|process\.env/);
    }
  });

  it("each real adapter has ONE constant base URL, no env override and no key in a URL", () => {
    const hosts = { openai: "https://api.openai.com", anthropic: "https://api.anthropic.com", google: "https://generativelanguage.googleapis.com" };
    const all = PROVEDORES.filter((f) => !f.endsWith("/mock.ts")).map((f) => stripComments(read(f))).join("\n");
    const urls = [...new Set([...all.matchAll(/https?:\/\/[A-Za-z0-9.-]+/g)].map((m) => m[0]))].sort();
    expect(urls).toEqual(Object.values(hosts).sort());
    expect(all).not.toMatch(/[?&]key=|[?&]api_key=|[?&]apikey=/i);
  });

  it("no sampling knob is sent: temperature and top_p do not appear in the adapters", () => {
    for (const f of PROVEDORES) expect(stripComments(read(f)), rel(f)).not.toMatch(/temperature|top_p|top_k/);
  });

  it("only the choke point can issue a request: nobody else touches the brand or builds SafeProviderRequest by hand", () => {
    for (const f of PLANEJADOR.filter((p) => !p.endsWith("/privacy.ts") && !p.endsWith("/port.ts"))) {
      expect(stripComments(read(f)), rel(f)).not.toMatch(/as unknown as SafeProviderRequest|ISSUED\b/);
    }
  });

  it("the request sent never carries more than system, user and schema: the adapters read only those fields of the request", () => {
    for (const f of PROVEDORES.filter((p) => /(openai|anthropic|google)\.ts$/.test(p))) {
      const used = [...stripComments(read(f)).matchAll(/\breq\.(\w+)/g)].map((m) => m[1]);
      expect([...new Set(used)].sort().filter((u) => !["system", "user", "schema", "schemaName"].includes(u)), rel(f)).toEqual([]);
    }
  });
});

describe("boundaries of the module", () => {
  it("the deterministic engine imports nothing from the planner or the AI repositories", () => {
    for (const f of walk(join(ROOT, "src/modules/prescricao/motor")).filter((p) => p.endsWith(".ts"))) {
      expect(read(f), rel(f)).not.toMatch(/planejador|ai-planning|ai-platform|provedores/);
    }
  });

  it("nothing in the AI layer approves, delivers, applies or writes a plan", () => {
    for (const f of [...PLANEJADOR, ...AI_DB]) {
      const text = stripComments(read(f));
      expect(text, rel(f)).not.toMatch(/from "[^"]*(approv|aprova|deliver|entrega|planos\/actions)[^"]*"/i);
      expect(text, rel(f)).not.toMatch(/\b(INSERT INTO|UPDATE|DELETE FROM)\s+(plan_revisions|prescribed_exercises|prescription_proposals|training_plans|plan_approvals|plan_deliveries)\b/i);
    }
  });

  it("every write that depends on a previous statement's row count uses (SELECT changes())", () => {
    const planning = read(join(ROOT, "src/db/ai-planning.ts"));
    expect(planning).toContain("WHERE (SELECT changes()) = 1");
    const all = planning.match(/changes\(\)/g)?.length ?? 0;
    const guarded = planning.match(/\(SELECT changes\(\)\)/g)?.length ?? 0;
    expect(all).toBeGreaterThan(2);
    expect(all).toBe(guarded);
  });

  it("every statement of the organization repository filters by organization", () => {
    const planning = stripComments(read(join(ROOT, "src/db/ai-planning.ts")));
    const statements = [...planning.matchAll(/\.prepare\(\s*`([\s\S]*?)`/g)].map((m) => m[1]);
    expect(statements.length).toBeGreaterThan(30);
    for (const sql of statements) {
      // platform-wide reads (switch, task row, provider presence, circuit) are still gated by membership of the acting organization
      expect(sql, sql.slice(0, 80)).toMatch(/organization_id|revisionGate|MEMBER|\?1|\$\{gate\}/);
      // tenant tables: the organization column itself must appear (a MEMBER or ?1 alone does not prove the filter)
      const touchesTenantTable = /\b(ai_planner_cache|planning_runs|planning_run_payloads|ai_usage_ledger|ai_usage_month|blueprint_acceptances)\b/.test(sql);
      if (touchesTenantTable) expect(sql, `tenant filter: ${sql.slice(0, 80)}`).toMatch(/organization_id/);
    }
    expect(read(join(ROOT, "src/app/api/health/route.ts"))).toContain('.bind("0049_ai_adjustments")');
    expect(stripComments(read(join(ROOT, "src/modules/prescricao/planejador/provedores/http.ts")))).toContain('redirect: "error"');
  });

  it("every statement of the manager repository carries the manager guard", () => {
    const platform = stripComments(read(join(ROOT, "src/db/ai-platform.ts")));
    const statements = [...platform.matchAll(/\.prepare\(\s*`([\s\S]*?)`/g)].map((m) => m[1]);
    expect(statements.length).toBeGreaterThan(20);
    for (const sql of statements) expect(sql, sql.slice(0, 80)).toMatch(/\$\{writer\}|adminGuard\(/);
  });

  it("the migrations are additive: 0046 to 0049 create tables, indexes and triggers only", () => {
    for (const file of ["0046_ai_platform.sql", "0047_ai_planning.sql", "0048_proposal_blueprints.sql", "0049_ai_adjustments.sql"]) {
      const sql = read(join(ROOT, "migrations", file));
      expect(sql, file).not.toMatch(/^\s*(ALTER|DROP)\s/im);
      expect(sql, file).not.toMatch(/\b(DELETE FROM|UPDATE\s+\w+\s+SET)\b/i);
      expect(sql.trim().split("\n").at(-1), file).toMatch(/INSERT INTO app_schema_versions\(version\) VALUES \('004[6789]_/);
    }
  });
});

describe("planning orchestration (sub-stage 1.3)", () => {
  const importsOf = (text: string) => [...stripComments(text).matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map((m) => m[1]);

  it("nothing reaches a provider outside a gate: only orchestration.ts (planning gate), adjust-service.ts (adjustment gate) and the gestor service (panel gate, no student data) import the adapters or the registry", () => {
    const importers = SRC.filter((f) => !f.includes("/planejador/provedores/") && importsOf(read(f)).some((i) => /provedores\/(registry|openai|anthropic|google|mock)$/.test(i))).map(rel);
    expect(importers).toEqual(["src/modules/gestor/ai-service.ts", "src/modules/prescricao/planejador/adjust-service.ts", "src/modules/prescricao/planejador/orchestration.ts"]);
    // the panel's calls: body-less model listing and one constant prompt; each only after `ready()` (writer + both kill switches), and the
    // service can reach no student: it imports neither the context builder, nor the generation loader, nor the orchestration
    const panel = stripComments(read(join(ROOT, "src/modules/gestor/ai-service.ts")));
    expect(panel.match(/\.listModels\(/g)).toHaveLength(2);
    expect(panel.match(/callWithPolicy\(/g)).toHaveLength(1);
    expect(panel.match(/await ready\(\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(panel).toContain("{ values: [], tokens: [], prose: [] }");
    expect(panel).toContain("MODEL_TEST_USER");
    expect(importsOf(read(join(ROOT, "src/modules/gestor/ai-service.ts"))).filter((i) => /context|orchestration|automatica|@\/db\/(students|plans|generation|assessments)/.test(i))).toEqual([]);
    // and inside orchestration the adapter is only invoked by the function that takes a reservation as proof
    const text = stripComments(read(join(ROOT, "src/modules/prescricao/planejador/orchestration.ts")));
    expect(text).toMatch(/^import "server-only";/m);
    expect(text.match(/callWithPolicy\(/g)).toHaveLength(1);
    expect(text).toMatch(/async function callGated\(\s*proof: Reserved,/);
    expect(text.match(/callGated\(/g)).toHaveLength(2); // the definition and the single call
    expect(text.match(/\.call\(/g) ?? []).toHaveLength(0);
  });

  it("the adjustment service has the same shape: one provider call, taken only with a reservation as proof, no SQL, no approval or delivery", () => {
    const raw = read(join(ROOT, "src/modules/prescricao/planejador/adjust-service.ts"));
    const text = stripComments(raw);
    expect(text).toMatch(/^import "server-only";/m);
    expect(text.match(/callWithPolicy\(/g)).toHaveLength(1);
    expect(text).toMatch(/async function callGated\(proof: Reserved,/);
    expect(text.match(/callGated\(/g)).toHaveLength(2);
    expect(text.match(/\.call\(/g) ?? []).toHaveLength(0);
    const db = importsOf(raw).filter((i) => i.startsWith("@/db/"));
    expect(db.sort()).toEqual(["@/db/ai-adjustments", "@/db/ai-planning", "@/db/prescription-proposals", "@/db/students"]);
    for (const i of importsOf(raw)) expect(i, i).not.toMatch(/approv|aprova|deliver|entrega|planos\/actions|\/db\/plans|\/db\/prescription$/i);
    expect(text).not.toMatch(/\.prepare\(|\.batch\(|INSERT INTO|UPDATE \w+ SET|DELETE FROM/);
    // the only write to the proposal is the proposal service's compare-and-set path
    expect(text.match(/applyAdjustment\(/g)).toHaveLength(1);
    expect(text).not.toMatch(/\.apply\(planId, revisionId, \{ proposalId/);
    expect(text).not.toContain("eraseStudentAi");
  });

  it("the orchestration reads and writes only through the AI repositories, the student reader and the generation loader", () => {
    const text = read(join(ROOT, "src/modules/prescricao/planejador/orchestration.ts"));
    const db = importsOf(text).filter((i) => i.startsWith("@/db/"));
    expect(db.sort()).toEqual(["@/db/ai-planning", "@/db/students"]);
    for (const i of importsOf(text)) expect(i, i).not.toMatch(/approv|aprova|deliver|entrega|planos\/actions|prescription-proposals|\/db\/plans|\/db\/prescription/i);
    expect(stripComments(text)).not.toMatch(/\bprepare\(|\.batch\(|D1Database\)\.|INSERT|UPDATE|DELETE/);
  });

  it("the rules-mode producer is pure: no database, no framework, no network, no clock, no randomness", () => {
    for (const f of PLANEJADOR.filter((p) => p.includes("/rules-mode/") || p.endsWith("/strategy-view.ts"))) {
      const text = stripComments(read(f));
      expect(text, rel(f)).not.toMatch(/from "@\/db|server-only|from "next|fetch\(|process\.env|getCloudflareContext|Date\.now|new Date|Math\.random|crypto\./);
    }
  });

  it("the server actions are a thin 'use server' layer over the service", () => {
    const text = read(join(ROOT, "src/modules/prescricao/planejador/actions.ts"));
    expect(text.startsWith('"use server";')).toBe(true);
    expect(importsOf(text).sort()).toEqual(["./copy", "./orchestration", "./strategy-view", "@/modules/auth/server"]);
    const exported = [...text.matchAll(/^export (?:async )?(?:function|const|class)\s+(\w+)/gm)].map((m) => m[1]).sort();
    expect(exported).toEqual(["getLatestStrategies", "getPlanningAvailability", "getPlanningState", "planStrategies"]);
  });

  it("every environment variable of the AI layer is documented in docs/WEBFLOW-CLOUD.md, and none is public", () => {
    const docs = read(join(ROOT, "docs/WEBFLOW-CLOUD.md"));
    const config = read(join(ROOT, "src/modules/prescricao/planejador/config.ts"));
    const names = [...config.matchAll(/"(AI_[A-Z_]+)"/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThanOrEqual(9);
    for (const name of new Set(names)) expect(docs, name).toContain(`\`${name}\``);
  });

  it("the erasure by student is wired into the data-request answer, and the service never calls it", () => {
    const requests = stripComments(read(join(ROOT, "src/db/data-requests.ts")));
    expect(requests).toMatch(/aiPlanningFor\(db, context\)\.eraseStudentAi\(/);
    expect(stripComments(read(join(ROOT, "src/modules/prescricao/planejador/orchestration.ts")))).not.toContain("eraseStudentAi");
  });
});

describe("the gestor panel (sub-stage 1.4)", () => {
  const GESTOR = walk(join(ROOT, "src/modules/gestor")).filter((f) => /\/ai-[\w-]+\.(ts|tsx)$/.test(f));
  const PAGE = join(ROOT, "src/app/gestor/(painel)/inteligencia-artificial/page.tsx");
  const isClient = (f: string) => read(f).startsWith('"use client";');

  it("client components never import anything that can read, decrypt or send a key", () => {
    const clients = GESTOR.filter(isClient);
    expect(clients.map(rel).sort()).toEqual([
      "src/modules/gestor/ai-kill-switch.tsx", "src/modules/gestor/ai-models.tsx", "src/modules/gestor/ai-organizations.tsx", "src/modules/gestor/ai-plans.tsx",
      "src/modules/gestor/ai-providers.tsx", "src/modules/gestor/ai-ui.tsx",
    ]);
    for (const f of clients) {
      const text = stripComments(read(f));
      expect(text, rel(f)).not.toMatch(/key_ciphertext|readKeyForTest|openSecret|sealSecret|ai-service|@\/db\/ai-plan|server-only|process\.env|localStorage|sessionStorage/);
      // the only module of src/db a client may name is a type-only import
      for (const m of text.matchAll(/^import (?!type)[^;]*from "(@\/db\/[^"]+)"/gm)) throw new Error(`${rel(f)} imports ${m[1]} at runtime`);
      expect(text, rel(f)).not.toMatch(/console\s*\./);
    }
  });

  it("the key field is write-only: a password input, autocomplete off, never given a value from the server", () => {
    const text = read(join(ROOT, "src/modules/gestor/ai-providers.tsx"));
    expect(text).toMatch(/type="password"/);
    expect(text).toMatch(/autoComplete="off"/);
    expect(text).toContain("data-1p-ignore");
    expect(text).not.toMatch(/defaultValue=/);
    expect(text).not.toMatch(/connection\.(key|apiKey|ciphertext)/);
  });

  it("every action asks for an active platform manager first; the actions file only exports async functions", () => {
    const text = read(join(ROOT, "src/modules/gestor/ai-actions.ts"));
    expect(text.startsWith('"use server";')).toBe(true);
    const code = stripComments(text);
    const names = [...code.matchAll(/^export (async function|function|const|class|let|var)\s+(\w+)/gm)];
    for (const m of names) expect(m[1], m[2]).toBe("async function");
    for (const m of code.matchAll(/^export async function (\w+)[\s\S]*?^}/gm)) {
      expect(m[0], m[1]).toMatch(/requirePlatformAdmin\(\)|writerOrMessage\(\)/);
      expect(m[0], m[1]).not.toMatch(/organizationId\s*=\s*(?:await|\w+\.headers)|headers\(\)|cookies\(\)/);
    }
    expect(names.length).toBeGreaterThanOrEqual(10);
  });

  it("the service is the only gestor file that decrypts a key, and the page never reads one", () => {
    for (const f of GESTOR) {
      const text = stripComments(read(f));
      if (rel(f) !== "src/modules/gestor/ai-service.ts") expect(text, rel(f)).not.toMatch(/openSecret|sealSecret|readKeyForTest/);
    }
    expect(stripComments(read(PAGE))).not.toMatch(/openSecret|readKeyForTest|key_ciphertext|apiKey/);
    expect(read(join(ROOT, "src/modules/gestor/ai-service.ts"))).toMatch(/^import "server-only";/);
  });

  it("no Next link or browser call fixes a mount path (/api, /_next)", () => {
    for (const f of [...GESTOR, PAGE]) expect(stripComments(read(f)), rel(f)).not.toMatch(/["'`]\/(?:api|_next)\b|fetch\(/);
  });

  it("the page and the navigation are wired: route, nav item, audit labels for every AI action", () => {
    expect(read(join(ROOT, "src/modules/platform/surfaces.ts"))).toContain('slug: "inteligencia-artificial"');
    expect(read(PAGE)).toContain("requirePlatformAdmin()");
    const labels = read(join(ROOT, "src/modules/gestor/audit-table.tsx"));
    const actions = read(join(ROOT, "src/db/ai-platform.ts")).match(/AI_AUDIT_ACTIONS = \[([\s\S]*?)\] as const/)![1].match(/AI_[A-Z_]+/g)!;
    for (const action of actions) expect(labels, action).toContain(action);
  });
});
