import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exerciseMetadataFor, systemMetadataFor } from "@/db/exercise-metadata";
import { exercisesFor } from "@/db/exercises";
import { INFERENCE_RULES } from "@/modules/biblioteca/metadata/inference";
import { inferFromName, parseSystemSeed } from "@/modules/biblioteca/metadata/inference-core";
import { precedence } from "@/modules/biblioteca/metadata/status";
import { MAX_ALTERNATIVES, type Provenance } from "@/modules/biblioteca/metadata/vocabulary";
import { ALL_MIGRATIONS, migrate, splitStatements } from "./helpers/migrate";

// Motor S4: library metadata (0044) and its inferred seed (0045) against a real local D1. Covers the file rules, the seed count,
// every trigger (scope, identity, "inference never overwrites a person", version, permanence, append-only events, relations),
// precedence in SQL equal to status.ts, compare-and-set, events, enrichment of the organization's own exercises, alternatives,
// and isolation: another organization, roles without technical access, revoked or disabled users, students and platform managers.

let mf: Miniflare;
let db: D1Database;
const scope = (userId: string, organizationId = "org-a") => ({ userId, organizationId });
const run = (sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds).run();
const first = <T>(sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds).first<T>();
const all = async <T>(sql: string, ...binds: unknown[]) => (await db.prepare(sql).bind(...binds).all<T>()).results;
const refused = (promise: Promise<unknown>, message: string | RegExp) => expect(promise).rejects.toThrow(message);
const stamp = "2026-11-04T10:00:00.000Z";
const seedText = readFileSync(new URL("../migrations/0045_exercise_metadata_inferred_seed.sql", import.meta.url), "utf8");
const SYSTEM = parseSystemSeed(readFileSync(new URL("../migrations/0005_exercise_library.sql", import.meta.url), "utf8"));
const metaA = () => exerciseMetadataFor(db, scope("tech-a"));
const metaB = () => exerciseMetadataFor(db, scope("tech-b", "org-b"));

async function ownExercise(name: string, user = "tech-a", org = "org-a", category = "Core") {
  const outcome = await exercisesFor(db, scope(user, org)).create({ name, category });
  if (outcome.status !== "saved") throw new Error(`exercise refused: ${outcome.status}`);
  return outcome.id;
}
async function rawAttribute(over: {
  exercise: string;
  scope?: string;
  field?: string;
  status?: Provenance;
  source?: string;
  value?: string | null;
  rule?: string | null;
  reviewer?: string | null;
}) {
  const status = over.status ?? "INFERRED";
  await run(
    `INSERT INTO exercise_attributes (id, exercise_id, scope_organization_id, field, value_json, status, source, rule_id, rules_version,
       reviewed_by_user_id, reviewed_at, version, last_write_id, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 1, 'raw', ?12, ?12)`,
    crypto.randomUUID(),
    over.exercise,
    over.scope ?? "",
    over.field ?? "difficulty",
    over.value === undefined ? (status === "PENDING" ? null : "2") : over.value,
    status,
    over.source ?? (status === "INFERRED" ? "INFERENCE" : (over.scope ?? "") === "" ? "PLATFORM" : "PROFESSIONAL"),
    over.rule === undefined ? (status === "INFERRED" ? "TEST_RULE" : null) : over.rule,
    status === "INFERRED" ? "test" : null,
    over.reviewer === undefined ? (status === "REVIEWED" ? "tech-a" : null) : over.reviewer,
    status === "REVIEWED" ? stamp : null,
    stamp,
  );
}

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "exercise-metadata-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  const people = ["tech-a", "owner-a", "commercial-a", "finance-a", "revoked-a", "disabled-a", "tech-b", "client-1", "mgr-1", "mgr-off"];
  await db.batch([
    ...people.map((id) =>
      db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)").bind(id, `${id}@example.test`),
    ),
    ...people.map((id) => db.prepare("INSERT INTO users(id) VALUES (?1)").bind(id)),
    db.prepare("UPDATE users SET disabled_at = '2026-01-01T00:00:00.000Z' WHERE id = 'disabled-a'"),
    db.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','Studio A'),('org-b','Studio B')"),
    db.prepare(
      `INSERT INTO memberships(organization_id,user_id,role,revoked_at) VALUES
       ('org-a','tech-a','TECHNICAL',NULL),('org-a','owner-a','OWNER',NULL),('org-a','commercial-a','COMMERCIAL',NULL),
       ('org-a','finance-a','FINANCE',NULL),('org-a','revoked-a','TECHNICAL','2026-01-01T00:00:00.000Z'),
       ('org-a','disabled-a','TECHNICAL',NULL),('org-b','tech-b','TECHNICAL',NULL)`,
    ),
    db.prepare("INSERT INTO professionals(id,organization_id,user_id,display_name) VALUES ('pro-a','org-a','tech-a','Pro A')"),
    db.prepare("INSERT INTO students(id,organization_id,display_name) VALUES ('st-1','org-a','Aluno Um')"),
    db.prepare("INSERT INTO student_access(organization_id,student_id,user_id) VALUES ('org-a','st-1','client-1')"),
    db.prepare("INSERT INTO platform_admins(user_id) VALUES ('mgr-1'),('mgr-off')"),
    db.prepare("UPDATE platform_admins SET revoked_at = '2026-01-01T00:00:00.000Z' WHERE user_id = 'mgr-off'"),
  ]);
});
afterAll(async () => {
  await mf?.dispose();
});

describe("migration files", () => {
  const text = (file: string) => readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8");

  it("0044 and 0045 follow 0043 in ALL_MIGRATIONS and the health route names 0045", () => {
    const at = ALL_MIGRATIONS.indexOf("0043_execution_occurrences.sql");
    expect(ALL_MIGRATIONS.slice(at + 1)).toEqual(["0044_exercise_metadata.sql", "0045_exercise_metadata_inferred_seed.sql"]);
    expect(text("../src/app/api/health/route.ts")).toContain('.bind("0045_exercise_metadata_inferred_seed")');
  });

  it("0044 splits into exactly its statements", () => {
    const sql = text("0044_exercise_metadata.sql");
    const statements = splitStatements(sql);
    expect(statements).toHaveLength(18);
    expect(sql.split("\n").filter((line) => /^(CREATE|ALTER|INSERT|UPDATE|DROP) /.test(line))).toHaveLength(18);
    const seen: Record<string, number> = {};
    for (const statement of statements.slice(0, -1)) {
      const kind = statement.split(/\s+/).slice(0, 2).join(" ");
      seen[kind] = (seen[kind] ?? 0) + 1;
    }
    expect(seen).toEqual({ "CREATE TABLE": 3, "CREATE INDEX": 3, "CREATE UNIQUE": 1, "CREATE TRIGGER": 10 });
    expect(statements.at(-1)).toBe("INSERT INTO app_schema_versions(version) VALUES ('0044_exercise_metadata')");
    expect(sql.split("\n").filter((line) => /;\s*--/.test(line))).toEqual([]);
    expect(sql).not.toMatch(/INSERT\s+OR\s+IGNORE/i);
  });

  it("0045 wrote exactly the generator's rows: system scope, INFERRED, sys-* only, with rule and version", async () => {
    const expected = SYSTEM.flatMap((exercise) =>
      inferFromName(INFERENCE_RULES, exercise.name, exercise.category).map((item) => ({
        exercise_id: exercise.id,
        field: item.field,
        value_json: JSON.stringify(item.value),
        rule_id: item.ruleId,
      })),
    );
    const rows = await all<{ exercise_id: string; field: string; value_json: string; rule_id: string; scope: string; status: string; source: string; rules_version: string }>(
      `SELECT exercise_id, field, value_json, rule_id, scope_organization_id AS scope, status, source, rules_version
       FROM exercise_attributes WHERE last_write_id = '0045_exercise_metadata_inferred_seed' ORDER BY exercise_id, rowid`,
    );
    expect(rows).toHaveLength(expected.length);
    expect(rows.map(({ exercise_id, field, value_json, rule_id }) => ({ exercise_id, field, value_json, rule_id }))).toEqual(expected);
    expect(new Set(rows.map((row) => row.exercise_id)).size).toBe(64);
    for (const row of rows) {
      expect(row).toMatchObject({ scope: "", status: "INFERRED", source: "INFERENCE", rules_version: INFERENCE_RULES.version });
      expect(row.exercise_id).toMatch(/^sys-\d{3}$/);
    }
    expect(seedText).toContain(`'${INFERENCE_RULES.version}'`);
    // The seed starts the trail: one INFERRED event per row, credited to no person.
    const events = await all<{ exercise_id: string; field: string; action: string; actor: string | null; rule_id: string; rules_version: string }>(
      `SELECT exercise_id, field, action, actor_user_id AS actor, rule_id, rules_version FROM exercise_attribute_events
       WHERE scope_organization_id = '' AND write_id = '0045_exercise_metadata_inferred_seed' ORDER BY exercise_id, rowid`,
    );
    expect(events).toHaveLength(expected.length);
    for (const event of events) expect(event).toMatchObject({ action: "INFERRED", actor: null, rules_version: INFERENCE_RULES.version });
    const history = (await metaA().detail("sys-001"))!.history.filter((event) => event.scope === "SYSTEM");
    expect(history.length).toBeGreaterThan(0);
    expect(history[0]).toMatchObject({ action: "INFERRED", actor: null, rulesVersion: INFERENCE_RULES.version });
  });
});

describe("resolution and summary", () => {
  it("shows the system seed as inferred, with its rule, and names lacking a needed field as pending", async () => {
    const map = await metaA().resolve(["sys-001", "sys-009", "sys-055", "nope"]);
    expect([...map.keys()].sort()).toEqual(["sys-001", "sys-009", "sys-055"]);
    const goblet = map.get("sys-001")!;
    expect(goblet.summary).toBe("INFERRED");
    expect(goblet.fields.modality).toMatchObject({ value: "RESISTANCE", provenance: "INFERRED", scope: "SYSTEM", ruleId: "MOD_RESISTANCE" });
    expect(goblet.fields.equipment).toMatchObject({ value: ["DUMBBELL"], provenance: "INFERRED" });
    expect(goblet.fields.difficulty).toBeUndefined();
    expect(map.get("sys-009")!.summary).toBe("PENDING");
    expect(map.get("sys-009")!.fields.equipment).toBeUndefined();
    expect(map.get("sys-055")!.summary).toBe("PENDING");
  });

  it("resolves by the same precedence as status.ts for every pair of system and organization rows", async () => {
    const statuses: Provenance[] = ["REVIEWED", "INFERRED", "PENDING"];
    let index = 10;
    for (const system of statuses)
      for (const org of statuses) {
        const exercise = `sys-0${index++}`;
        await rawAttribute({ exercise, scope: "", status: system, value: system === "PENDING" ? null : "3" });
        // The organization's own INFERRED rows only come from enrichment of its own exercises, but the rule must still hold.
        await rawAttribute({ exercise, scope: "org-a", status: org, value: org === "PENDING" ? null : "4" });
        const resolved = (await metaA().resolve([exercise])).get(exercise)!.fields.difficulty!;
        const winner = precedence("ORGANIZATION", org) < precedence("SYSTEM", system) ? { scope: "ORGANIZATION", status: org } : { scope: "SYSTEM", status: system };
        expect(resolved, `${system} vs ${org}`).toMatchObject({ scope: winner.scope, provenance: winner.status });
        expect(resolved.value).toBe(winner.status === "PENDING" ? null : winner.scope === "ORGANIZATION" ? 4 : 3);
        // Another organization only ever sees the system row.
        const other = (await metaB().resolve([exercise])).get(exercise)!.fields.difficulty!;
        expect(other).toMatchObject({ scope: "SYSTEM", provenance: system });
      }
  });
});

describe("writing a field (organization scope)", () => {
  it("'Salvar como revisado por mim' creates the organization's adjustment of a system exercise; it wins only for that organization", async () => {
    const saved = await metaA().setField("sys-002", "equipment", ["MACHINE"], null);
    expect(saved).toEqual({ status: "saved", version: 1 });
    const mine = (await metaA().resolve(["sys-002"])).get("sys-002")!;
    expect(mine.fields.equipment).toMatchObject({ provenance: "REVIEWED", scope: "ORGANIZATION", value: ["MACHINE"] });
    expect(mine.summary).toBe("INFERRED");
    const theirs = (await metaB().resolve(["sys-002"])).get("sys-002")!;
    expect(theirs.fields.equipment).toMatchObject({ provenance: "INFERRED", scope: "SYSTEM" });
    const row = await first<{ scope: string; source: string; reviewer: string }>(
      `SELECT scope_organization_id AS scope, source, reviewed_by_user_id AS reviewer FROM exercise_attributes
       WHERE exercise_id = 'sys-002' AND field = 'equipment' AND scope_organization_id <> ''`,
    );
    expect(row).toEqual({ scope: "org-a", source: "PROFESSIONAL", reviewer: "tech-a" });
    // Confirming the same value is a REVIEWED event; a different one is SET.
    const events = await all<{ action: string; actor: string }>(
      `SELECT action, actor_user_id AS actor FROM exercise_attribute_events WHERE exercise_id = 'sys-002' AND field = 'equipment' AND scope_organization_id = 'org-a'`,
    );
    expect(events).toEqual([{ action: "REVIEWED", actor: "tech-a" }]);
    expect(await metaA().setField("sys-002", "equipment", ["MACHINE", "BENCH"], 1)).toEqual({ status: "saved", version: 2 });
    const later = await all<{ action: string }>(
      `SELECT action FROM exercise_attribute_events WHERE exercise_id = 'sys-002' AND field = 'equipment' AND scope_organization_id = 'org-a' ORDER BY rowid`,
    );
    expect(later.map((event) => event.action)).toEqual(["REVIEWED", "SET"]);
  });

  it("is a compare-and-set: a stale version or a second first write is a conflict, and an invalid value is refused", async () => {
    expect(await metaA().setField("sys-003", "difficulty", 2, null)).toEqual({ status: "saved", version: 1 });
    expect(await metaA().setField("sys-003", "difficulty", 3, null)).toEqual({ status: "conflict" });
    expect(await metaA().setField("sys-003", "difficulty", 3, 7)).toEqual({ status: "conflict" });
    const [left, right] = await Promise.all([
      metaA().setField("sys-004", "difficulty", 2, null),
      exerciseMetadataFor(db, scope("owner-a")).setField("sys-004", "difficulty", 4, null),
    ]);
    expect([left.status, right.status].sort()).toEqual(["conflict", "saved"]);
    expect(await metaA().setField("sys-003", "difficulty", 9, 1)).toEqual({ status: "invalid" });
    expect(await metaA().setField("sys-003", "primary_muscles", ["NOT_A_MUSCLE"], null)).toEqual({ status: "invalid" });
    const count = await first<{ n: number }>(
      "SELECT count(*) AS n FROM exercise_attribute_events WHERE exercise_id IN ('sys-003','sys-004') AND field = 'difficulty'",
    );
    expect(count?.n).toBe(2);
  });

  it("'Marcar como pendente' hides the value for this organization and stops it being used", async () => {
    expect((await metaA().resolve(["sys-005"])).get("sys-005")!.summary).toBe("INFERRED");
    expect(await metaA().markPending("sys-005", "equipment", null)).toEqual({ status: "saved", version: 1 });
    const mine = (await metaA().resolve(["sys-005"])).get("sys-005")!;
    expect(mine.fields.equipment).toMatchObject({ provenance: "PENDING", scope: "ORGANIZATION", value: null });
    expect(mine.summary).toBe("PENDING");
    expect((await metaB().resolve(["sys-005"])).get("sys-005")!.summary).toBe("INFERRED");
    // Reviewing it again brings it back.
    expect(await metaA().setField("sys-005", "equipment", ["MACHINE"], 1)).toEqual({ status: "saved", version: 2 });
    expect((await metaA().resolve(["sys-005"])).get("sys-005")!.fields.equipment!.provenance).toBe("REVIEWED");
  });

  it("detail shows the value in use, the organization's row and the system's row, with history", async () => {
    const detail = (await metaA().detail("sys-002"))!;
    const equipment = detail.fields.find((entry) => entry.field === "equipment")!;
    expect(equipment.effective).toMatchObject({ provenance: "REVIEWED", scope: "ORGANIZATION" });
    expect(equipment.organization).toMatchObject({ provenance: "REVIEWED", version: 2, reviewedByMe: true, value: ["MACHINE", "BENCH"] });
    expect(equipment.system).toMatchObject({ provenance: "INFERRED", ruleId: "EQ_MACHINE", value: ["MACHINE"] });
    expect(detail.history[0]).toMatchObject({ field: "equipment", action: "SET", actor: "Pro A", scope: "ORGANIZATION" });
    expect(detail.fields.map((entry) => entry.field)).toHaveLength(12);
    // Another organization's detail of the same exercise has none of org-a's rows or events.
    const theirs = (await metaB().detail("sys-002"))!;
    expect(theirs.fields.find((entry) => entry.field === "equipment")!.organization).toBeNull();
    expect(theirs.history.filter((event) => event.scope === "ORGANIZATION")).toEqual([]);
  });
});

describe("isolation between organizations, roles and accounts", () => {
  it("another organization cannot read, write or relate an organization's own exercise, even by id", async () => {
    const own = await ownExercise("Supino privado da A", "tech-a", "org-a", "Empurrar");
    await metaA().setField(own, "modality", "RESISTANCE", null);
    expect((await metaB().resolve([own])).size).toBe(0);
    expect(await metaB().detail(own)).toBeNull();
    expect(await metaB().setField(own, "modality", "CARDIO", null)).toEqual({ status: "not_found" });
    expect(await metaB().markPending(own, "modality", null)).toEqual({ status: "not_found" });
    expect(await metaB().addAlternative("sys-006", own)).toEqual({ status: "not_found" });
    expect(await metaB().addAlternative(own, "sys-006")).toEqual({ status: "not_found" });
    const rows = await all<{ scope: string }>("SELECT scope_organization_id AS scope FROM exercise_attributes WHERE exercise_id = ?1", own);
    expect(rows).toEqual([{ scope: "org-a" }]);
    // Enrichment of org-b never reaches org-a's exercises.
    await metaB().enrichOrganization();
    expect(await all("SELECT 1 FROM exercise_attributes WHERE exercise_id = ?1 AND scope_organization_id = 'org-b'", own)).toEqual([]);
  });

  it("only owner, manager and technical members, active and not revoked, reach the metadata", async () => {
    for (const user of ["commercial-a", "finance-a", "revoked-a", "disabled-a", "client-1", "mgr-1"]) {
      const repo = exerciseMetadataFor(db, scope(user));
      expect((await repo.resolve(["sys-001"])).size, user).toBe(0);
      expect(await repo.detail("sys-001"), user).toBeNull();
      expect(await repo.setField("sys-001", "difficulty", 2, null), user).toEqual({ status: "not_found" });
      expect(await repo.enrichOrganization(), user).toEqual({ status: "not_found" });
      expect(await repo.addAlternative("sys-001", "sys-002"), user).toEqual({ status: "not_found" });
    }
    expect(await first("SELECT 1 FROM exercise_attributes WHERE exercise_id = 'sys-001' AND field = 'difficulty'")).toBeNull();
    expect(() => exerciseMetadataFor(db, null)).toThrow("AUTHENTICATION_REQUIRED");
    expect(() => exerciseMetadataFor(db, { userId: "tech-a", organizationId: " " })).toThrow("AUTHENTICATION_REQUIRED");
  });

  it("an organization context can never write the system scope, and the database refuses foreign scopes", async () => {
    // The repository always writes ?1 = the session's organization: the system row of sys-007 is unchanged.
    await metaA().setField("sys-007", "laterality", "UNILATERAL", null);
    expect(await first<{ status: string }>("SELECT status FROM exercise_attributes WHERE exercise_id = 'sys-007' AND field = 'laterality' AND scope_organization_id = ''")).toEqual({ status: "INFERRED" });
    const own = await ownExercise("Exercício da A para escopo");
    // A professional row in the system scope breaks a CHECK; a system row on an organization's exercise breaks the scope trigger.
    await refused(rawAttribute({ exercise: "sys-008", scope: "", status: "REVIEWED", source: "PROFESSIONAL" }), /CHECK constraint failed/);
    await refused(rawAttribute({ exercise: own, scope: "", status: "REVIEWED" }), "EXERCISE_ATTRIBUTE_SCOPE_INVALID");
    await refused(rawAttribute({ exercise: own, scope: "org-b", status: "REVIEWED", reviewer: "tech-b" }), "EXERCISE_ATTRIBUTE_SCOPE_INVALID");
    await refused(rawAttribute({ exercise: "sys-008", scope: "org-zz", status: "REVIEWED" }), "EXERCISE_ATTRIBUTE_SCOPE_INVALID");
    await refused(
      run(
        `INSERT INTO exercise_relations (id, from_exercise_id, to_exercise_id, scope_organization_id, kind, status, source, created_by_user_id,
           created_at, last_write_id) VALUES ('rel-x', 'sys-001', ?1, 'org-b', 'ALTERNATIVE', 'REVIEWED', 'PROFESSIONAL', 'tech-b', ?2, 'raw')`,
        own,
        stamp,
      ),
      "EXERCISE_RELATION_SCOPE_INVALID",
    );
  });

  it("the system scope is for active platform managers only, on system exercises only", async () => {
    expect(() => systemMetadataFor(db, null)).toThrow("AUTHENTICATION_REQUIRED");
    for (const user of ["tech-a", "mgr-off"])
      expect(await systemMetadataFor(db, { userId: user }).setField("sys-020", "difficulty", 2, null), user).toEqual({ status: "not_found" });
    const own = await ownExercise("Exercício da A para o gestor");
    expect(await systemMetadataFor(db, { userId: "mgr-1" }).setField(own, "difficulty", 2, null)).toEqual({ status: "not_found" });
    expect(await systemMetadataFor(db, { userId: "mgr-1" }).setField("sys-020", "difficulty", 2, null)).toEqual({ status: "saved", version: 1 });
    expect(await systemMetadataFor(db, { userId: "mgr-1" }).setField("sys-020", "difficulty", 3, null)).toEqual({ status: "conflict" });
    // A system review wins over the inferred value for every organization.
    expect(await systemMetadataFor(db, { userId: "mgr-1" }).setField("sys-020", "equipment", ["BENCH"], 1)).toEqual({ status: "saved", version: 2 });
    for (const repo of [metaA(), metaB()])
      expect((await repo.resolve(["sys-020"])).get("sys-020")!.fields.equipment).toMatchObject({ provenance: "REVIEWED", scope: "SYSTEM" });
  });

  it("archived exercises are not resolved and cannot be written", async () => {
    const own = await ownExercise("Exercício para arquivar");
    expect(await exercisesFor(db, scope("tech-a")).archive(own)).toBe(true);
    expect((await metaA().resolve([own])).size).toBe(0);
    expect(await metaA().setField(own, "difficulty", 2, null)).toEqual({ status: "not_found" });
    expect((await metaA().detail(own))!.archived).toBe(true);
  });
});

describe("database rules", () => {
  it("inference never overwrites what a person decided, rows are permanent, identity is frozen and every update bumps the version", async () => {
    const reviewed = await first<{ id: string }>("SELECT id FROM exercise_attributes WHERE exercise_id = 'sys-003' AND scope_organization_id = 'org-a' AND field = 'difficulty'");
    await refused(
      run(`UPDATE exercise_attributes SET status = 'INFERRED', source = 'INFERENCE', rule_id = 'X', rules_version = 'v', reviewed_by_user_id = NULL,
             version = version + 1, last_write_id = 'w2' WHERE id = ?1`, reviewed!.id),
      "EXERCISE_ATTRIBUTE_REVIEW_WINS",
    );
    const pending = await first<{ id: string }>("SELECT id FROM exercise_attributes WHERE exercise_id = 'sys-005' AND scope_organization_id = 'org-a' AND field = 'equipment'");
    await run("UPDATE exercise_attributes SET status = 'PENDING', value_json = NULL, reviewed_by_user_id = NULL, reviewed_at = NULL, version = version + 1, last_write_id = 'w3' WHERE id = ?1", pending!.id);
    await refused(
      run(`UPDATE exercise_attributes SET status = 'INFERRED', source = 'INFERENCE', value_json = '["MACHINE"]', rule_id = 'X', rules_version = 'v',
             version = version + 1, last_write_id = 'w4' WHERE id = ?1`, pending!.id),
      "EXERCISE_ATTRIBUTE_REVIEW_WINS",
    );
    await refused(run("DELETE FROM exercise_attributes WHERE id = ?1", reviewed!.id), "EXERCISE_ATTRIBUTE_PERMANENT");
    await refused(run("UPDATE exercise_attributes SET field = 'metric', version = version + 1, last_write_id = 'w5' WHERE id = ?1", reviewed!.id), "EXERCISE_ATTRIBUTE_IDENTITY_FROZEN");
    await refused(run("UPDATE exercise_attributes SET scope_organization_id = 'org-b', version = version + 1, last_write_id = 'w6' WHERE id = ?1", reviewed!.id), "EXERCISE_ATTRIBUTE_IDENTITY_FROZEN");
    await refused(run("UPDATE exercise_attributes SET value_json = '4' WHERE id = ?1", reviewed!.id), "EXERCISE_ATTRIBUTE_VERSION_INVALID");
    await refused(run("UPDATE exercise_attributes SET value_json = '4', version = version + 1 WHERE id = ?1", reviewed!.id), "EXERCISE_ATTRIBUTE_VERSION_INVALID");
    // An INFERRED value needs its rule; a REVIEWED one needs its reviewer.
    await refused(rawAttribute({ exercise: "sys-021", status: "INFERRED", rule: null }), /CHECK constraint failed/);
    await refused(rawAttribute({ exercise: "sys-021", scope: "org-a", status: "REVIEWED", reviewer: null }), /CHECK constraint failed/);
  });

  it("events are append-only, and a removed relation is frozen", async () => {
    const event = await first<{ id: string }>("SELECT id FROM exercise_attribute_events LIMIT 1");
    await refused(run("UPDATE exercise_attribute_events SET action = 'SET' WHERE id = ?1", event!.id), "EXERCISE_ATTRIBUTE_EVENT_APPEND_ONLY");
    await refused(run("DELETE FROM exercise_attribute_events WHERE id = ?1", event!.id), "EXERCISE_ATTRIBUTE_EVENT_APPEND_ONLY");
    expect(await metaA().addAlternative("sys-030", "sys-023")).toEqual({ status: "saved" });
    const relation = await first<{ id: string }>("SELECT id FROM exercise_relations WHERE from_exercise_id = 'sys-030' AND scope_organization_id = 'org-a'");
    await refused(run("UPDATE exercise_relations SET to_exercise_id = 'sys-024', removed_at = ?2 WHERE id = ?1", relation!.id, stamp), "EXERCISE_RELATION_FROZEN");
    await refused(run("DELETE FROM exercise_relations WHERE id = ?1", relation!.id), "EXERCISE_RELATION_PERMANENT");
    expect(await metaA().removeAlternative(relation!.id)).toBe(true);
    await refused(run("UPDATE exercise_relations SET removed_at = NULL WHERE id = ?1", relation!.id), "EXERCISE_RELATION_FROZEN");
    expect(await metaA().removeAlternative(relation!.id)).toBe(false);
  });
});

describe("alternatives (curated substitutions)", () => {
  it("adds, refuses duplicates and self, caps the count, removes, and hides archived targets", async () => {
    expect(await metaA().addAlternative("sys-011", "sys-006")).toEqual({ status: "saved" });
    expect(await metaA().addAlternative("sys-011", "sys-006")).toEqual({ status: "duplicate" });
    expect(await metaA().addAlternative("sys-011", "sys-011")).toEqual({ status: "invalid" });
    const mine = (await metaA().resolve(["sys-011"])).get("sys-011")!;
    expect(mine.alternatives).toEqual([{ exerciseId: "sys-006", name: "Supino com halteres", provenance: "REVIEWED", scope: "ORGANIZATION" }]);
    expect((await metaB().resolve(["sys-011"])).get("sys-011")!.alternatives).toEqual([]);
    // org-b cannot remove org-a's relation.
    const relationId = (await metaA().detail("sys-011"))!.alternatives[0].relationId;
    expect(await metaB().removeAlternative(relationId)).toBe(false);
    // Archived target disappears from the list.
    const own = await ownExercise("Alternativa que será arquivada", "tech-a", "org-a", "Empurrar");
    expect(await metaA().addAlternative("sys-011", own)).toEqual({ status: "saved" });
    expect((await metaA().resolve(["sys-011"])).get("sys-011")!.alternatives).toHaveLength(2);
    await exercisesFor(db, scope("tech-a")).archive(own);
    expect((await metaA().resolve(["sys-011"])).get("sys-011")!.alternatives).toHaveLength(1);
    // Technical cap.
    const targets = SYSTEM.map((exercise) => exercise.id).filter((id) => id !== "sys-040").slice(0, MAX_ALTERNATIVES + 1);
    const outcomes = [];
    for (const target of targets) outcomes.push((await metaA().addAlternative("sys-040", target)).status);
    expect(outcomes.filter((status) => status === "saved")).toHaveLength(MAX_ALTERNATIVES);
    expect(outcomes.at(-1)).toBe("too_many");
    // After a removal it can be added again, and every change left an event.
    expect(await metaA().removeAlternative(relationId)).toBe(true);
    expect(await metaA().addAlternative("sys-011", "sys-006")).toEqual({ status: "saved" });
    const events = await all<{ action: string }>(
      "SELECT action FROM exercise_attribute_events WHERE exercise_id = 'sys-011' AND field = 'alternatives' ORDER BY rowid",
    );
    expect(events.map((event) => event.action)).toEqual(["RELATION_ADDED", "RELATION_ADDED", "RELATION_REMOVED", "RELATION_ADDED"]);
  });
});

describe("'Inferir metadados das minhas fichas' (enrichOrganization)", () => {
  it("infers the organization's own exercises, keeps what a person decided, refreshes and clears stale inferences, and is idempotent", async () => {
    const repo = exerciseMetadataFor(db, scope("owner-a"));
    const press = await ownExercise("Supino com halteres da casa", "tech-a", "org-a", "Empurrar");
    const plank = await ownExercise("Prancha com apoio", "tech-a", "org-a", "Core");
    const mystery = await ownExercise("Movimento sem regra", "tech-a", "org-a", "Core");
    // A person already reviewed the press's equipment before any inference.
    expect(await metaA().setField(press, "equipment", ["DUMBBELL"], null)).toEqual({ status: "saved", version: 1 });

    const firstRun = await repo.enrichOrganization();
    expect(firstRun.status).toBe("done");
    const after = (await metaA().resolve([press, plank, mystery]));
    expect(after.get(press)!.fields.movement_patterns).toMatchObject({ provenance: "INFERRED", scope: "ORGANIZATION", ruleId: "PAT_HORIZONTAL_PUSH", rulesVersion: INFERENCE_RULES.version });
    expect(after.get(press)!.fields.equipment).toMatchObject({ provenance: "REVIEWED", value: ["DUMBBELL"] });
    expect(after.get(press)!.summary).toBe("INFERRED");
    expect(after.get(plank)!.fields.metric).toMatchObject({ value: "TIME", provenance: "INFERRED" });
    // A category alone gives only the modality, so the mystery exercise stays pending.
    expect(Object.keys(after.get(mystery)!.fields)).toEqual(["modality"]);
    expect(after.get(mystery)!.summary).toBe("PENDING");
    if (firstRun.status !== "done") throw new Error("enrich refused");
    expect(firstRun.keptByPerson).toBeGreaterThanOrEqual(1);
    // Enrichment touches only the organization's own exercises: no system exercise got an inferred row from it.
    expect(
      await all("SELECT 1 FROM exercise_attributes WHERE scope_organization_id = 'org-a' AND exercise_id LIKE 'sys-%' AND source = 'INFERENCE' AND last_write_id <> 'raw'"),
    ).toEqual([]);

    // Second run: nothing to write, no new events.
    const events = async () => (await first<{ n: number }>("SELECT count(*) AS n FROM exercise_attribute_events WHERE scope_organization_id = 'org-a'"))!.n;
    const before = await events();
    const second = await repo.enrichOrganization();
    expect(second).toMatchObject({ status: "done", inferred: 0, cleared: 0 });
    expect(await events()).toBe(before);

    // Renaming changes what the rules give: inferred rows follow the name; the reviewed one stays.
    await run("UPDATE exercises SET name = 'Supino com barra da casa', name_key = 'supino com barra da casa', updated_at = ?2 WHERE id = ?1", press, stamp);
    await run("UPDATE exercises SET name = 'Movimento novo', name_key = 'movimento novo', updated_at = ?2 WHERE id = ?1", plank, stamp);
    const third = await repo.enrichOrganization();
    if (third.status !== "done") throw new Error("enrich refused");
    expect(third.cleared).toBeGreaterThan(0);
    const renamed = await metaA().resolve([press, plank]);
    expect(renamed.get(press)!.fields.equipment).toMatchObject({ provenance: "REVIEWED", value: ["DUMBBELL"] });
    expect(renamed.get(plank)!.fields.metric).toMatchObject({ provenance: "PENDING", value: null });
    expect(renamed.get(plank)!.summary).toBe("PENDING");
    // Back to a recognised name: the rows inference had cleared come back as INFERRED.
    await run("UPDATE exercises SET name = 'Prancha com apoio', name_key = 'prancha com apoio', updated_at = ?2 WHERE id = ?1", plank, stamp);
    await repo.enrichOrganization();
    expect((await metaA().resolve([plank])).get(plank)!.fields.metric).toMatchObject({ provenance: "INFERRED", value: "TIME" });
    const trail = await all<{ action: string }>("SELECT action FROM exercise_attribute_events WHERE exercise_id = ?1 AND field = 'metric' ORDER BY rowid", plank);
    expect(trail.map((event) => event.action)).toEqual(["INFERRED", "PENDING", "INFERRED"]);
  });
});

describe("review fixes (S4)", () => {
  it("renaming an own exercise refreshes its inferred values in the same save, never a person's, and only once inference ran", async () => {
    const library = exercisesFor(db, scope("tech-a"));
    const plank = await ownExercise("Prancha da revisão", "tech-a", "org-a", "Core");
    const untouched = await ownExercise("Prancha só com nota nova", "tech-a", "org-a", "Core");
    await exerciseMetadataFor(db, scope("tech-a")).enrichOrganization();
    // Created after the run: inference never ran on it.
    const fresh = await ownExercise("Prancha criada depois", "tech-a", "org-a", "Core");
    expect((await metaA().resolve([plank])).get(plank)!.fields.metric).toMatchObject({ value: "TIME", ruleId: "MET_PLANK_TIME" });
    // A person reviewed the primary muscles.
    expect(await metaA().setField(plank, "primary_muscles", ["ABS", "OBLIQUES"], (await metaA().detail(plank))!.fields.find((f) => f.field === "primary_muscles")!.organization!.version)).toMatchObject({ status: "saved" });

    expect(await library.update(plank, { name: "Remada com halteres da revisão", category: "Puxar" })).toMatchObject({ status: "saved" });
    const after = (await metaA().resolve([plank])).get(plank)!;
    expect(after.fields.movement_patterns).toMatchObject({ provenance: "INFERRED", value: ["HORIZONTAL_PULL"], ruleId: "PAT_HORIZONTAL_PULL" });
    expect(after.fields.metric).toMatchObject({ provenance: "INFERRED", value: "REPS" });
    expect(after.fields.equipment).toMatchObject({ provenance: "INFERRED", value: ["DUMBBELL"] });
    expect(after.fields.primary_muscles).toMatchObject({ provenance: "REVIEWED", value: ["ABS", "OBLIQUES"] });
    // The trail credits the rule (rules version set), with the person who saved as the one who started it.
    const trail = await all<{ action: string; rules_version: string | null }>(
      "SELECT action, rules_version FROM exercise_attribute_events WHERE exercise_id = ?1 AND field = 'movement_patterns' ORDER BY rowid",
      plank,
    );
    expect(trail).toEqual([
      { action: "INFERRED", rules_version: INFERENCE_RULES.version },
      { action: "INFERRED", rules_version: INFERENCE_RULES.version },
    ]);

    // A name the rules do not read: the old inferred values become pending instead of lingering.
    expect(await library.update(plank, { name: "Movimento sem regra da revisão", category: "Puxar" })).toMatchObject({ status: "saved" });
    const cleared = (await metaA().resolve([plank])).get(plank)!;
    expect(cleared.fields.movement_patterns).toMatchObject({ provenance: "PENDING", value: null });
    expect(cleared.fields.metric).toMatchObject({ provenance: "PENDING", value: null });
    expect(cleared.summary).toBe("PENDING");

    // Never inferred: a rename writes no metadata (the professional did not ask for inference).
    expect(await library.update(fresh, { name: "Remada criada depois", category: "Puxar" })).toMatchObject({ status: "saved" });
    expect(await all("SELECT 1 FROM exercise_attributes WHERE exercise_id = ?1", fresh)).toEqual([]);
    // Editing anything but the name and category leaves the inferred rows alone.
    const before = await all("SELECT field, version FROM exercise_attributes WHERE exercise_id = ?1 ORDER BY field", untouched);
    expect(await library.update(untouched, { name: "Prancha só com nota nova", category: "Core", notes: "só a nota" })).toMatchObject({ status: "saved" });
    expect(await all("SELECT field, version FROM exercise_attributes WHERE exercise_id = ?1 ORDER BY field", untouched)).toEqual(before);
  });

  it("a rename that loses the compare-and-set changes no metadata", async () => {
    const id = await ownExercise("Prancha concorrente", "tech-a", "org-a", "Core");
    await exerciseMetadataFor(db, scope("tech-a")).enrichOrganization();
    const before = await all("SELECT field, value_json, version FROM exercise_attributes WHERE exercise_id = ?1 ORDER BY field", id);
    const library = exercisesFor(db, scope("tech-a"));
    // Another save lands between the read and the write: same exercise, updated_at moves.
    const original = library.find.bind(library);
    library.find = async (target: string) => {
      const row = await original(target);
      await run("UPDATE exercises SET updated_at = '2026-11-04T23:59:59.000Z' WHERE id = ?1", id);
      return row;
    };
    expect(await library.update(id, { name: "Remada concorrente", category: "Puxar" })).toEqual({ status: "conflict" });
    expect(await all("SELECT field, value_json, version FROM exercise_attributes WHERE exercise_id = ?1 ORDER BY field", id)).toEqual(before);
  });

  it("an empty list is never a reviewed movement pattern", async () => {
    const id = await ownExercise("Exercício para lista vazia", "tech-a", "org-a", "Core");
    expect(await metaA().setField(id, "movement_patterns", [], null)).toEqual({ status: "invalid" });
    expect(await metaA().setField(id, "equipment", [], null)).toMatchObject({ status: "saved" });
  });

  it("an alternative the system already curated is a duplicate, and a pair in both scopes is listed once", async () => {
    await run(
      `INSERT INTO exercise_relations (id, from_exercise_id, to_exercise_id, scope_organization_id, kind, status, source,
         created_by_user_id, created_at, last_write_id)
       VALUES ('rel-sys-1', 'sys-022', 'sys-031', '', 'ALTERNATIVE', 'REVIEWED', 'PLATFORM', 'mgr-1', ?1, 'raw')`,
      stamp,
    );
    expect(await metaA().addAlternative("sys-022", "sys-031")).toEqual({ status: "duplicate" });
    // An organization relation from before the system curated the pair.
    await run(
      `INSERT INTO exercise_relations (id, from_exercise_id, to_exercise_id, scope_organization_id, kind, status, source,
         created_by_user_id, created_at, last_write_id)
       VALUES ('rel-org-1', 'sys-022', 'sys-027', 'org-a', 'ALTERNATIVE', 'REVIEWED', 'PROFESSIONAL', 'tech-a', ?1, 'raw')`,
      stamp,
    );
    await run(
      `INSERT INTO exercise_relations (id, from_exercise_id, to_exercise_id, scope_organization_id, kind, status, source,
         created_by_user_id, created_at, last_write_id)
       VALUES ('rel-sys-2', 'sys-022', 'sys-027', '', 'ALTERNATIVE', 'REVIEWED', 'PLATFORM', 'mgr-1', ?1, 'raw')`,
      stamp,
    );
    const listed = (await metaA().resolve(["sys-022"])).get("sys-022")!.alternatives;
    expect(listed).toHaveLength(2);
    expect(new Map(listed.map((item) => [item.exerciseId, item.scope]))).toEqual(
      new Map([
        ["sys-031", "SYSTEM"],
        ["sys-027", "ORGANIZATION"],
      ]),
    );
    const detail = (await metaA().detail("sys-022"))!;
    expect(detail.alternatives.find((item) => item.exerciseId === "sys-027")).toMatchObject({ relationId: "rel-org-1", removable: true });
    // Another organization sees only the system's.
    expect((await metaB().resolve(["sys-022"])).get("sys-022")!.alternatives.map((item) => item.scope)).toEqual(["SYSTEM", "SYSTEM"]);
  });
});
