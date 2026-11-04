import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ALL_MIGRATIONS, splitStatements } from "./helpers/migrate";

/**
 * Motor S6 measurement (design §1.5, §4.2, §9 S6): the engine and the proposal writes run INSIDE workerd (Miniflare), with a local
 * D1. It is a measurement, not a check, so it only runs with MOTOR_MEASURE=1 and prints a table (and writes JSON to
 * MOTOR_MEASURE_OUT when set). Figures are "workerd local, não produção": Webflow Cloud's CPU limits and D1's remote latency are
 * not reproduced here. Results are recorded in docs/VALIDACAO.md.
 */
const enabled = process.env.MOTOR_MEASURE === "1";
const RUNS = Number(process.env.MOTOR_MEASURE_RUNS ?? 3);

interface Shape {
  phases: number;
  weeks: number;
  sessionsPerWeek: number;
  labels: number;
  items: number;
  catalog: number;
}

describe.skipIf(!enabled)("motor under workerd (local measurement)", () => {
  it("measures engine CPU, proposal writes and the execution save at the technical caps", async () => {
    // esbuild comes with the Cloudflare/OpenNext toolchain; imported here so a normal run (skipped) never loads it.
    const { build } = await import("esbuild");
    let patchedMaxSets = false;
    const bundled = await build({
      entryPoints: [fileURLToPath(new URL("./helpers/measure-worker.ts", import.meta.url))],
      bundle: true,
      format: "esm",
      platform: "neutral",
      target: "es2022",
      write: false,
      mainFields: ["module", "main"],
      conditions: ["workerd", "worker", "browser"],
      tsconfig: fileURLToPath(new URL("../tsconfig.json", import.meta.url)),
      logLevel: "silent",
      plugins: [
        {
          // Design §1.5: execution MAX_SETS may go from 12 to 20 (0012 CHECK allows 1..20) only if `save` with 30 × 20 sets is
          // measured. The measurement bundle alone raises the constant; the app keeps 12.
          name: "measure-max-sets",
          setup(b) {
            b.onLoad({ filter: /src[\\/]modules[\\/]execucao[\\/]contracts\.ts$/ }, async (args) => {
              const source = await readFile(args.path, "utf8");
              const patched = source.replace("export const MAX_SETS = 12;", "export const MAX_SETS = 20;");
              if (patched === source) throw new Error("MAX_SETS not found in execucao/contracts.ts");
              patchedMaxSets = true;
              return { contents: patched, loader: "ts" };
            });
          },
        },
      ],
    });
    expect(patchedMaxSets).toBe(true);
    const mf = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: bundled.outputFiles[0].text,
        compatibilityDate: "2026-10-23",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: { DB: "motor-measure" },
        cf: false,
      }),
    );
    try {
      const db = await mf.getD1Database("DB");
      for (const file of ALL_MIGRATIONS) {
        const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8");
        for (const statement of splitStatements(sql)) await db.prepare(statement).run();
      }
      await db.batch([
        db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES ('tech-a','tech-a','a@example.test',0,0),('client-1','c','c@example.test',0,0)"),
        db.prepare("INSERT INTO users(id) VALUES ('tech-a'),('client-1')"),
        db.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','Studio A')"),
        db.prepare("INSERT INTO memberships(organization_id,user_id,role) VALUES ('org-a','tech-a','TECHNICAL')"),
        db.prepare("INSERT INTO professionals(id,organization_id,user_id,display_name) VALUES ('pro-a','org-a','tech-a','Pro A')"),
        db.prepare("INSERT INTO students(id,organization_id,display_name) VALUES ('st-1','org-a','One')"),
        db.prepare("INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-a','st-1','pro-a')"),
        db.prepare("INSERT INTO student_access(organization_id,student_id,user_id) VALUES ('org-a','st-1','client-1')"),
      ]);
      const call = async (path: string, payload: unknown = {}) => {
        const started = performance.now();
        const response = await mf.dispatchFetch(`http://measure${path}`, { method: "POST", body: JSON.stringify(payload) });
        const text = await response.text();
        if (!response.ok) throw new Error(`${path}: ${text.slice(0, 2000)}`);
        const json = JSON.parse(text) as Record<string, unknown>;
        return { ms: performance.now() - started, json };
      };
      const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
      const timed = async (path: string, payload: unknown) => {
        const runs: number[] = [];
        let last: Record<string, unknown> = {};
        for (let n = 0; n < RUNS; n++) {
          const r = await call(path, payload);
          runs.push(r.ms);
          last = r.json;
        }
        return { ms: Math.round(median(runs)), json: last };
      };
      const noop = await timed("/noop", {});
      const rows: Array<Record<string, unknown>> = [{ what: "noop (overhead of one request)", ms: noop.ms }];

      // Engine CPU by size: sessions × library = work units.
      const shapes: Array<[string, Shape]> = [
        ["2 fases × 4 sem × 3 sessões, 3 treinos, 6 itens, 64 ex.", { phases: 2, weeks: 4, sessionsPerWeek: 3, labels: 3, items: 6, catalog: 64 }],
        ["4 × 6 × 4, 4 treinos, 8 itens, 64 ex.", { phases: 4, weeks: 6, sessionsPerWeek: 4, labels: 4, items: 8, catalog: 64 }],
        ["6 × 6 × 5, 5 treinos, 8 itens, 200 ex.", { phases: 6, weeks: 6, sessionsPerWeek: 5, labels: 5, items: 8, catalog: 200 }],
        ["12 × 6 × 7 (504 sessões), 7 treinos, 10 itens, 64 ex.", { phases: 12, weeks: 6, sessionsPerWeek: 7, labels: 7, items: 10, catalog: 64 }],
        ["12 × 6 × 7 (504 sessões), 7 treinos, 10 itens, 500 ex.", { phases: 12, weeks: 6, sessionsPerWeek: 7, labels: 7, items: 10, catalog: 500 }],
      ];
      for (const [what, shape] of shapes) {
        const r = await timed("/engine", shape);
        rows.push({ what: `motor: ${what}`, ms: r.ms, units: r.json.units, occurrences: r.json.occurrences, items: r.json.items, resultBytes: r.json.bytes });
      }

      // Proposal writes (one batch: proposal, ledger, sessions, items in json_each chunks).
      const writes: Array<[string, Shape]> = [
        ["gravar proposta: 24 sessões × 6 itens", { phases: 2, weeks: 4, sessionsPerWeek: 3, labels: 3, items: 6, catalog: 64 }],
        ["gravar proposta: 96 sessões × 8 itens", { phases: 4, weeks: 6, sessionsPerWeek: 4, labels: 4, items: 8, catalog: 64 }],
        ["gravar proposta: 504 sessões × 10 itens", { phases: 12, weeks: 6, sessionsPerWeek: 7, labels: 7, items: 10, catalog: 64 }],
        ["gravar proposta: 504 sessões × 30 itens (teto)", { phases: 12, weeks: 6, sessionsPerWeek: 7, labels: 7, items: 30, catalog: 64 }],
      ];
      for (const [what, shape] of writes) {
        const times: number[] = [];
        let last: Record<string, unknown> = {};
        for (let n = 0; n < RUNS; n++) {
          const plan = (await call("/plan")).json as { planId: string; revisionId: string };
          const r = await call("/write", { shape, ...plan });
          times.push(r.ms);
          last = r.json;
        }
        rows.push({ what, ms: Math.round(median(times)), status: (last.out as { status: string }).status, occurrences: last.occurrences, items: last.items });
      }

      // Execution save at the caps: 30 exercises × MAX_SETS (12) sets, and 30 × 20 (the candidate cap, design §1.5).
      const setup = (await call("/execution-setup")).json as { planId: string; prescribed: string[] };
      expect(setup.prescribed).toHaveLength(30);
      const days = [["2026-11-02", "2026-11-03", "2026-11-04"], ["2026-10-30", "2026-10-31", "2026-11-01"]];
      for (const [n, sets] of [12, 20].entries()) {
        const saves: number[] = [];
        let saved: unknown = null;
        for (const performedOn of days[n]) {
          const r = await call("/execution-save", { planId: setup.planId, prescribed: setup.prescribed, sets, performedOn });
          saves.push(r.ms);
          saved = r.json.out;
        }
        rows.push({ what: `execução: salvar 30 exercícios × ${sets} séries (${1 + 30 * (1 + sets)} comandos)`, ms: Math.round(median(saves)), status: (saved as { status: string }).status });
      }

      // Rows per statement: the same 5040 rows (≈ 10 MB of JSON) inserted through json_each in chunks of different sizes.
      await db.prepare("CREATE TABLE measure_rows (id TEXT PRIMARY KEY, a TEXT, b TEXT, c INTEGER, d TEXT)").run();
      const trace = JSON.stringify({ selection: Array.from({ length: 6 }, (_, n) => ({ code: "RANK", basis: "HEURISTIC", detail: `${"x".repeat(150)}${n}` })) });
      const probe = Array.from({ length: 5040 }, (_, n) => JSON.stringify({ id: `r${n}`, a: "x".repeat(40), b: "y".repeat(40), c: n, d: trace }));
      for (const bytes of [64_000, 256_000, 1_000_000]) {
        await db.prepare("DELETE FROM measure_rows").run();
        const chunks: string[] = [];
        let current: string[] = [];
        let size = 0;
        for (const row of probe) {
          if (current.length && size + row.length > bytes) {
            chunks.push(`[${current.join(",")}]`);
            current = [];
            size = 0;
          }
          current.push(row);
          size += row.length;
        }
        if (current.length) chunks.push(`[${current.join(",")}]`);
        const sql = `INSERT INTO measure_rows SELECT json_extract(value, '$.id'), json_extract(value, '$.a'), json_extract(value, '$.b'),
          json_extract(value, '$.c'), json_extract(value, '$.d') FROM json_each(?1)`;
        const started = performance.now();
        await db.batch(chunks.map((c) => db.prepare(sql).bind(c)));
        rows.push({ what: `json_each: 5040 linhas em blocos de ${bytes / 1000} KB`, ms: Math.round(performance.now() - started), statements: chunks.length });
      }

      console.table(rows);
      if (process.env.MOTOR_MEASURE_OUT) await writeFile(process.env.MOTOR_MEASURE_OUT, JSON.stringify({ when: new Date().toISOString(), runs: RUNS, rows }, null, 2));
    } finally {
      await mf.dispose();
    }
  }, 600_000);
});
