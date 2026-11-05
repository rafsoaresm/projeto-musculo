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
    expect(read(join(ROOT, "src/app/api/health/route.ts"))).toContain('.bind("0047_ai_planning")');
    expect(stripComments(read(join(ROOT, "src/modules/prescricao/planejador/provedores/http.ts")))).toContain('redirect: "error"');
  });

  it("every statement of the manager repository carries the manager guard", () => {
    const platform = stripComments(read(join(ROOT, "src/db/ai-platform.ts")));
    const statements = [...platform.matchAll(/\.prepare\(\s*`([\s\S]*?)`/g)].map((m) => m[1]);
    expect(statements.length).toBeGreaterThan(20);
    for (const sql of statements) expect(sql, sql.slice(0, 80)).toMatch(/\$\{writer\}|adminGuard\(/);
  });

  it("the migrations are additive: 0046 and 0047 create tables, indexes and triggers only", () => {
    for (const file of ["0046_ai_platform.sql", "0047_ai_planning.sql"]) {
      const sql = read(join(ROOT, "migrations", file));
      expect(sql, file).not.toMatch(/^\s*(ALTER|DROP)\s/im);
      expect(sql, file).not.toMatch(/\b(DELETE FROM|UPDATE\s+\w+\s+SET)\b/i);
      expect(sql.trim().split("\n").at(-1), file).toMatch(/INSERT INTO app_schema_versions\(version\) VALUES \('004[67]_/);
    }
  });
});
