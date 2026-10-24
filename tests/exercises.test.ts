import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exercisesFor } from "@/db/exercises";
import { parseVideoUrl } from "@/modules/biblioteca/contracts";

// Real local D1 with the five migrations. Identities are rows, as the server
// derives them from a verified session.
let mf: Miniflare;
let db: D1Database;
const scope = (userId: string, organizationId = "org-a") => ({
  userId,
  organizationId,
});
const draft = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  category: "Core",
  ...extra,
});
const YT = "https://www.youtube.com/watch?v=abc123";

async function migrate(database: D1Database) {
  for (const file of [
    "0001_foundation.sql",
    "0002_identity_and_onboarding.sql",
    "0003_roles_and_access.sql",
    "0004_training_plans.sql",
    "0005_exercise_library.sql",
  ]) {
    const sql = await readFile(
      new URL(`../migrations/${file}`, import.meta.url),
      "utf8",
    );
    await database.batch(
      sql
        .replace(/^--.*$/gm, "")
        .split(";")
        .filter((statement) => statement.trim())
        .map((statement) => database.prepare(statement)),
    );
  }
}

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "exercises-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db);
  const people = [
    "owner-a",
    "tech-a",
    "manager-a",
    "commercial-a",
    "finance-a",
    "owner-b",
    "client-1",
    "mgr-1",
  ];
  await db.batch([
    ...people.map((id) =>
      db
        .prepare(
          "INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)",
        )
        .bind(id, `${id}@example.test`),
    ),
    db.prepare(
      "INSERT INTO users(id) VALUES ('owner-a'),('tech-a'),('manager-a'),('commercial-a'),('finance-a'),('owner-b'),('client-1'),('mgr-1')",
    ),
    db.prepare("INSERT INTO platform_admins(user_id) VALUES ('mgr-1')"),
    db.prepare(
      "INSERT INTO organizations(id,name) VALUES ('org-a','Studio A'),('org-b','Studio B')",
    ),
    db.prepare(
      `INSERT INTO memberships(organization_id,user_id,role) VALUES
       ('org-a','owner-a','OWNER'),('org-a','tech-a','TECHNICAL'),('org-a','manager-a','MANAGER'),
       ('org-a','commercial-a','COMMERCIAL'),('org-a','finance-a','FINANCE'),('org-b','owner-b','OWNER')`,
    ),
  ]);
});
afterAll(async () => {
  await mf.dispose();
});

describe("system library (seed)", () => {
  it("holds the 64 exercises of the master document, none of them a reviewed video", async () => {
    const all = await exercisesFor(db, scope("tech-a")).list({ scope: "SYSTEM" });
    expect(all).toHaveLength(64);
    const byCategory = Object.fromEntries(
      Object.entries(
        all.reduce<Record<string, number>>((acc, row) => {
          acc[row.category] = (acc[row.category] ?? 0) + 1;
          return acc;
        }, {}),
      ),
    );
    expect(byCategory).toEqual({
      Agachar: 5,
      Empurrar: 16,
      Puxar: 14,
      Quadril: 8,
      Unilateral: 9,
      Core: 8,
      Cardio: 4,
    });
    for (const row of all) {
      expect(row.scope).toBe("SYSTEM");
      expect(row.source).toBe("MASTER_DOCUMENT_SEED");
      expect(row.videoStatus).toBe("SEARCH_LINK");
      expect(parseVideoUrl(row.videoUrl as string)?.searchPage).toBe(true);
      expect(row.videoVerifiedAt).toBeNull();
    }
    expect(new Set(all.map((r) => r.name.toLowerCase())).size).toBe(64);
  });
});

describe("who can reach the library", () => {
  it("is open to technical members only", async () => {
    for (const user of ["owner-a", "manager-a", "tech-a"]) {
      expect(
        (await exercisesFor(db, scope(user)).list()).length,
        user,
      ).toBeGreaterThanOrEqual(64);
    }
    for (const user of ["commercial-a", "finance-a", "client-1", "mgr-1", "stranger"]) {
      const library = exercisesFor(db, scope(user));
      expect(await library.list(), `${user} list`).toEqual([]);
      expect(await library.find("sys-001"), `${user} find`).toBeNull();
      expect(await library.create(draft("Invasor")), `${user} create`).toEqual({
        status: "not_found",
      });
      expect(await library.copyFromSystem("sys-001"), `${user} copy`).toEqual({
        status: "not_found",
      });
    }
    // A member of another organization asking with this organization's id.
    expect(await exercisesFor(db, scope("owner-b", "org-a")).list()).toEqual([]);
    const count = await db
      .prepare("SELECT COUNT(*) AS n FROM exercises WHERE organization_id IS NOT NULL")
      .first<{ n: number }>();
    expect(count?.n).toBe(0);
  });

  it("stops at once when the membership is revoked or the identity is blocked", async () => {
    const library = exercisesFor(db, scope("tech-a"));
    await db
      .prepare("UPDATE memberships SET revoked_at = '2026-11-01T00:00:00.000Z' WHERE user_id = 'tech-a'")
      .run();
    expect(await library.list()).toEqual([]);
    await db.prepare("UPDATE memberships SET revoked_at = NULL WHERE user_id = 'tech-a'").run();
    await db.prepare("UPDATE users SET disabled_at = '2026-11-01T00:00:00.000Z' WHERE id = 'tech-a'").run();
    expect(await library.list()).toEqual([]);
    expect(await library.create(draft("Bloqueado"))).toEqual({ status: "not_found" });
    await db.prepare("UPDATE users SET disabled_at = NULL WHERE id = 'tech-a'").run();
    expect((await library.list()).length).toBeGreaterThanOrEqual(64);
  });
});

describe("own exercises", () => {
  it("creates, validates and keeps libraries apart", async () => {
    const a = exercisesFor(db, scope("tech-a"));
    const b = exercisesFor(db, scope("owner-b", "org-b"));
    const created = await a.create(draft("Prancha com elevação", { level: "Base", notes: "  nota interna  " }));
    expect(created.status).toBe("saved");
    const own = await a.find((created as { id: string }).id);
    expect(own).toMatchObject({
      scope: "ORGANIZATION",
      name: "Prancha com elevação",
      category: "Core",
      level: "Base",
      notes: "nota interna",
      videoUrl: null,
      videoStatus: "NONE",
      source: "ORGANIZATION",
    });
    // Same name, any case, in the same library is refused; another library may reuse it.
    // SQLite's lower() ignores accents, so the code decides what counts as the same name.
    expect(await a.create(draft("PRANCHA COM ELEVAÇÃO"))).toEqual({ status: "duplicate" });
    expect(await a.create(draft("  prancha   com  elevação "))).toEqual({ status: "duplicate" });
    expect((await a.list({ query: "ELEVAÇÃO" })).map((r) => r.name)).toContain("Prancha com elevação");
    expect((await b.create(draft("Prancha com elevação"))).status).toBe("saved");
    // Neither library shows the other's exercises, even by id.
    expect((await a.list({ scope: "ORGANIZATION" })).map((r) => r.name)).toEqual(["Prancha com elevação"]);
    const theirs = (await b.list({ scope: "ORGANIZATION" }))[0];
    expect(await a.find(theirs.id)).toBeNull();
    expect(await a.update(theirs.id, draft("Roubado"))).toEqual({ status: "not_found" });
    expect(await a.archive(theirs.id)).toBe(false);
  });

  it("rejects invalid input without storing anything", async () => {
    const a = exercisesFor(db, scope("tech-a"));
    const before = (await a.list({ scope: "ORGANIZATION" })).length;
    const bad: unknown[] = [
      draft(""),
      draft("x".repeat(121)),
      { name: "Sem categoria" },
      draft("Categoria falsa", { category: "Inventada" }),
      draft("Vídeo http", { videoUrl: "http://www.youtube.com/watch?v=abc" }),
      draft("Vídeo script", { videoUrl: "javascript:alert(1)" }),
      draft("Vídeo de outro host", { videoUrl: "https://exemplo.com/video" }),
      draft("Vídeo com senha", { videoUrl: "https://user:pass@www.youtube.com/watch?v=abc" }),
      draft("Vídeo com porta", { videoUrl: "https://www.youtube.com:8443/watch?v=abc" }),
      draft("Vídeo enorme", { videoUrl: `https://www.youtube.com/watch?v=${"a".repeat(500)}` }),
      draft("Notas enormes", { notes: "n".repeat(1001) }),
      draft("Campo extra", { organizationId: "org-b" }),
    ];
    for (const input of bad) {
      await expect(a.create(input), JSON.stringify(input).slice(0, 60)).rejects.toThrow();
    }
    expect((await a.list({ scope: "ORGANIZATION" })).length).toBe(before);
  });

  it("tells a search page from a video and makes verification a deliberate step", async () => {
    const a = exercisesFor(db, scope("tech-a"));
    const search = await a.create(
      draft("Busca", { videoUrl: "https://www.youtube.com/results?search_query=prancha", videoVerified: true }),
    );
    expect((await a.find((search as { id: string }).id))?.videoStatus).toBe("SEARCH_LINK");

    const made = await a.create(draft("Com vídeo", { videoUrl: YT, videoVerified: true }));
    const id = (made as { id: string }).id;
    // Never verified at creation, even when the box was ticked.
    expect((await a.find(id))?.videoStatus).toBe("UNVERIFIED");

    // Verifying means saving again with the same link and the box ticked.
    expect((await a.update(id, draft("Com vídeo", { videoUrl: YT, videoVerified: true }))).status).toBe("saved");
    const verified = await a.find(id);
    expect(verified?.videoStatus).toBe("VERIFIED");
    expect(verified?.videoVerifiedAt).not.toBeNull();
    const row = await db
      .prepare("SELECT video_verified_by_user_id AS who FROM exercises WHERE id = ?1")
      .bind(id)
      .first<{ who: string }>();
    expect(row?.who).toBe("tech-a");

    // Saving something else keeps it; a new link clears it even with the box ticked.
    await a.update(id, draft("Com vídeo", { videoUrl: YT, videoVerified: true, notes: "ajuste" }));
    expect((await a.find(id))?.videoStatus).toBe("VERIFIED");
    await a.update(id, draft("Com vídeo", { videoUrl: "https://vimeo.com/123456", videoVerified: true }));
    const changed = await a.find(id);
    expect(changed?.videoStatus).toBe("UNVERIFIED");
    expect(changed?.videoVerifiedAt).toBeNull();
    // Unticking and removing the link both clear it.
    await a.update(id, draft("Com vídeo", { videoUrl: "https://vimeo.com/123456" }));
    expect((await a.find(id))?.videoStatus).toBe("UNVERIFIED");
    await a.update(id, draft("Com vídeo"));
    expect((await a.find(id))).toMatchObject({ videoStatus: "NONE", videoUrl: null });
  });

  it("archives and restores, and refuses a restore that would repeat a name", async () => {
    const a = exercisesFor(db, scope("tech-a"));
    const first = (await a.create(draft("Arquivável"))) as { id: string };
    expect(await a.archive(first.id)).toBe(true);
    expect(await a.archive(first.id)).toBe(false);
    expect((await a.list()).some((r) => r.id === first.id)).toBe(false);
    expect((await a.list({ includeArchived: true })).some((r) => r.id === first.id)).toBe(true);
    // The name is free again while archived, so a new one can take it.
    const second = (await a.create(draft("Arquivável"))) as { id: string };
    expect(await a.restore(first.id)).toEqual({ status: "duplicate" });
    expect(await a.archive(second.id)).toBe(true);
    expect((await a.restore(first.id)).status).toBe("saved");
    // An archived exercise cannot be edited.
    await a.archive(first.id);
    expect(await a.update(first.id, draft("Arquivável editado"))).toEqual({ status: "not_found" });
  });
});

describe("system exercises", () => {
  it("cannot be edited or archived, and a copy becomes the organization's own", async () => {
    const a = exercisesFor(db, scope("owner-a"));
    const before = await a.find("sys-001");
    expect(await a.update("sys-001", draft("Alterado", { category: "Agachar" }))).toEqual({ status: "not_found" });
    expect(await a.archive("sys-001")).toBe(false);
    expect(await a.restore("sys-001")).toEqual({ status: "not_found" });
    expect(await a.find("sys-001")).toEqual(before);

    const copy = await a.copyFromSystem("sys-001");
    expect(copy.status).toBe("saved");
    const own = await a.find((copy as { id: string }).id);
    expect(own).toMatchObject({
      scope: "ORGANIZATION",
      name: before?.name,
      category: before?.category,
      videoStatus: "SEARCH_LINK",
    });
    // The copy is editable; the original stays as it was.
    expect(
      (await a.update(own!.id, draft(own!.name, { category: "Agachar", notes: "meu ajuste" }))).status,
    ).toBe("saved");
    expect(await a.find("sys-001")).toEqual(before);
    // Copying twice would repeat the name; an organization copy cannot be copied.
    expect(await a.copyFromSystem("sys-001")).toEqual({ status: "duplicate" });
    expect(await a.copyFromSystem(own!.id)).toEqual({ status: "not_found" });
    // Another organization is not affected.
    expect(await exercisesFor(db, scope("owner-b", "org-b")).find(own!.id)).toBeNull();
  });
});

describe("searching", () => {
  it("filters by text, category and scope, and treats wildcards as plain text", async () => {
    const a = exercisesFor(db, scope("tech-a"));
    const rosca = await a.list({ query: "rosca" });
    expect(rosca.length).toBeGreaterThanOrEqual(5);
    expect(rosca.every((r) => r.name.toLowerCase().includes("rosca"))).toBe(true);
    expect((await a.list({ category: "Cardio", scope: "SYSTEM" })).map((r) => r.category)).toEqual(
      Array(4).fill("Cardio"),
    );
    expect(await a.list({ query: "%" })).toEqual([]);
    expect(await a.list({ query: "_" })).toEqual([]);
    expect(await a.list({ query: "nada-parecido-com-isto" })).toEqual([]);
    const ordered = await a.list({ scope: "SYSTEM" });
    expect(ordered.map((r) => r.category)).toEqual([...ordered.map((r) => r.category)].sort());
  });
});
