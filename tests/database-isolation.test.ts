import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { studentsFor } from "@/db/students";

// Real local D1 binding. Identity is supplied by the test, not a working login.
let mf: Miniflare;
let db: D1Database;
const scope = (userId: string, organizationId = "org-a") => ({
  userId,
  organizationId,
});

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "trainer-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  const migration = await readFile(
    new URL("../migrations/0001_foundation.sql", import.meta.url),
    "utf8",
  );
  // Source-controlled migration contains no SQL string literals with semicolons.
  await db.batch(
    migration
      .replace(/^--.*$/gm, "")
      .split(";")
      .filter((sql) => sql.trim())
      .map((sql) => db.prepare(sql)),
  );
  await db.batch([
    db.prepare(
      "INSERT INTO users(id) VALUES ('tech-a'),('tech-b'),('owner'),('finance'),('student'),('stranger'),('commercial'),('support')",
    ),
    db.prepare(
      "INSERT INTO organizations(id,name) VALUES ('org-a','Organization A'),('org-b','Organization B')",
    ),
    db.prepare(
      "INSERT INTO memberships(organization_id,user_id,role) VALUES ('org-a','tech-a','TECHNICAL'),('org-b','tech-b','TECHNICAL'),('org-a','owner','OWNER'),('org-a','finance','FINANCE'),('org-a','commercial','COMMERCIAL')",
    ),
    db.prepare(
      "INSERT INTO professionals(id,organization_id,user_id,display_name) VALUES ('pro-a','org-a','tech-a','Professional A'),('pro-b','org-b','tech-b','Professional B')",
    ),
    db.prepare(
      "INSERT INTO students(id,organization_id,display_name) VALUES ('student-a','org-a','Student A'),('student-b','org-b','Student B')",
    ),
    db.prepare(
      "INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-a','student-a','pro-a'),('org-b','student-b','pro-b')",
    ),
    db.prepare(
      "INSERT INTO student_access(organization_id,student_id,user_id) VALUES ('org-a','student-a','student')",
    ),
  ]);
});
afterAll(async () => {
  await mf?.dispose();
});

describe("Webflow SQLite foundation and authorized repositories", () => {
  it("isolates professional records even when another student ID is known", async () => {
    expect(await studentsFor(db, scope("tech-a")).list()).toEqual([
      { id: "student-a", organizationId: "org-a", displayName: "Student A" },
    ]);
    expect(
      await studentsFor(db, scope("tech-b", "org-b")).findById("student-b"),
    ).not.toBeNull();
    expect(
      await studentsFor(db, scope("tech-a")).findById("student-b"),
    ).toBeNull();
    expect(await studentsFor(db, scope("tech-a", "org-b")).list()).toEqual([]);
  });
  it.each(["owner", "finance", "commercial", "support", "stranger"])(
    "does not grant technical access to %s without assignment",
    async (user) => {
      expect(await studentsFor(db, scope(user)).list()).toEqual([]);
    },
  );
  it("gives a student access only to explicit organization links", async () => {
    expect(
      await studentsFor(db, scope("student")).findById("student-a"),
    ).not.toBeNull();
    expect(await studentsFor(db, scope("student", "org-b")).list()).toEqual([]);
  });
  it("rejects cross-organization student foreign keys", async () => {
    await expect(
      db
        .prepare(
          "INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-a','student-b','pro-a')",
        )
        .run(),
    ).rejects.toThrow(/foreign key/i);
  });
  it("rejects cross-organization professional foreign keys", async () => {
    await expect(
      db
        .prepare(
          "INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-a','student-a','pro-b')",
        )
        .run(),
    ).rejects.toThrow(/foreign key/i);
  });
  it("requires server identity and organization context", () => {
    expect(() => studentsFor(db, null)).toThrow("AUTHENTICATION_REQUIRED");
    expect(() => studentsFor(db, scope(""))).toThrow("AUTHENTICATION_REQUIRED");
    expect(() => studentsFor(db, scope("tech-a", ""))).toThrow(
      "AUTHENTICATION_REQUIRED",
    );
  });
  it("parameterizes IDs instead of interpolating SQL", async () => {
    expect(
      await studentsFor(db, scope("tech-a")).findById("' OR 1=1 --"),
    ).toBeNull();
    expect(await studentsFor(db, scope("' OR 1=1 --")).list()).toEqual([]);
  });
  it("keeps separate contexts for an identity linked to both organizations", async () => {
    await db
      .prepare(
        "INSERT INTO student_access(organization_id,student_id,user_id) VALUES ('org-b','student-b','student')",
      )
      .run();
    try {
      expect(
        (await studentsFor(db, scope("student")).list()).map((s) => s.id),
      ).toEqual(["student-a"]);
      expect(
        (await studentsFor(db, scope("student", "org-b")).list()).map(
          (s) => s.id,
        ),
      ).toEqual(["student-b"]);
    } finally {
      await db
        .prepare("DELETE FROM student_access WHERE organization_id='org-b'")
        .run();
    }
  });
  it.each([
    ["memberships", "user_id", "tech-a", "tech-a"],
    ["care_assignments", "professional_id", "pro-a", "tech-a"],
    ["student_access", "user_id", "student", "student"],
  ])(
    "rechecks %s revocation on every query",
    async (table, column, value, actor) => {
      // Identifiers above are test constants; application input never supplies SQL identifiers.
      const repo = studentsFor(db, scope(actor));
      await db
        .prepare(
          `UPDATE ${table} SET revoked_at='2026-10-23T00:00:00Z' WHERE ${column}=?`,
        )
        .bind(value)
        .run();
      try {
        expect(await repo.list()).toEqual([]);
      } finally {
        await db
          .prepare(`UPDATE ${table} SET revoked_at=NULL WHERE ${column}=?`)
          .bind(value)
          .run();
      }
    },
  );
  it("blocks a disabled identity without deleting historical records", async () => {
    await db
      .prepare(
        "UPDATE users SET disabled_at='2026-10-23T00:00:00Z' WHERE id='tech-a'",
      )
      .run();
    try {
      expect(await studentsFor(db, scope("tech-a")).list()).toEqual([]);
      expect(
        (await db.prepare("SELECT id FROM students").all()).results,
      ).toHaveLength(2);
    } finally {
      await db
        .prepare("UPDATE users SET disabled_at=NULL WHERE id='tech-a'")
        .run();
    }
  });
  it("rolls back a failed D1 batch instead of partially persisting writes", async () => {
    await expect(
      db.batch([
        db.prepare(
          "INSERT INTO students(id,organization_id,display_name) VALUES ('rollback','org-a','Rollback')",
        ),
        db.prepare(
          "INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-a','rollback','pro-b')",
        ),
      ]),
    ).rejects.toThrow(/foreign key/i);
    expect(
      await db.prepare("SELECT id FROM students WHERE id='rollback'").first(),
    ).toBeNull();
  });
});
