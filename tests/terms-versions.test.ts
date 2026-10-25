import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { hasCurrentAcceptance, photoAuthorizationFor, recordAcceptance } from "@/db/consent";
import { currentTerms, shownTerms, termsFor, versionNameAt } from "@/db/terms";
import { BASELINE, BASELINE_VERSION, termsHash, type TermsContent } from "@/modules/consentimento/terms";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// Real local D1 with the real migrations and triggers. The manager is a row in platform_admins, as the
// server derives it from a verified session.
let mf: Miniflare;
let db: D1Database;
const T0 = new Date("2026-11-01T12:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const run = (sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds).run();
const count = async (sql: string, ...binds: unknown[]) => (await db.prepare(sql).bind(...binds).first<{ n: number }>())!.n;
const manager = (user = "mgr-1") => termsFor(db, { userId: user });
const edited = (change: (content: TermsContent) => void, audience: "STUDENT" | "PROFESSIONAL" = "STUDENT") => {
  const content: TermsContent = JSON.parse(JSON.stringify(BASELINE[audience]));
  change(content);
  return content;
};

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "terms-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  const people = ["mgr-1", "mgr-2", "mgr-off", "tech-a", "client-1", "client-2", "stranger"];
  await db.batch([
    ...people.map((id) =>
      db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)").bind(id, `${id}@example.test`),
    ),
    ...people.map((id) => db.prepare("INSERT INTO users(id) VALUES (?1)").bind(id)),
    db.prepare("INSERT INTO platform_admins(user_id) VALUES ('mgr-1'),('mgr-off')"),
    db.prepare("INSERT INTO platform_admins(user_id, revoked_at) VALUES ('mgr-2','2026-01-01T00:00:00.000Z')"),
    db.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','Studio A')"),
    db.prepare("INSERT INTO students(id,organization_id,display_name) VALUES ('st-1','org-a','Student One')"),
    db.prepare("INSERT INTO student_access(organization_id,student_id,user_id) VALUES ('org-a','st-1','client-1')"),
  ]);
  await run("UPDATE users SET disabled_at = '2026-01-01T00:00:00.000Z' WHERE id = 'mgr-off'");
});
afterAll(async () => {
  await mf.dispose();
});

describe("the text in force", () => {
  it("is the approved initial text, with its proof, until the manager publishes another", async () => {
    for (const audience of ["STUDENT", "PROFESSIONAL"] as const) {
      const terms = await currentTerms(db, audience);
      expect(terms).toMatchObject({ audience, version: BASELINE_VERSION, source: "BASELINE", publishedAt: null });
      expect(terms.content).toEqual(BASELINE[audience]);
      expect(terms.sha256).toBe(await termsHash(audience, BASELINE_VERSION, BASELINE[audience]));
    }
    expect(await count("SELECT COUNT(*) AS n FROM terms_versions")).toBe(0);
    // What a page hands to the person is the version and the words, nothing about where they came from.
    expect(Object.keys(await shownTerms(db, "STUDENT")).sort()).toEqual(["audience", "content", "version"]);
  });
});

describe("publishing", () => {
  it("makes the next version the one in force, with the proof of its exact words, and leaves the other audience alone", async () => {
    const words = edited((c) => (c.title = "Termos e aviso de privacidade do aluno (atualizado)"));
    const outcome = await manager().publish("STUDENT", words, "  Ajuste do título.  ", at(0));
    expect(outcome).toEqual({
      status: "published",
      version: "2026-11-01-120000",
      sha256: await termsHash("STUDENT", "2026-11-01-120000", words),
    });
    const now = await currentTerms(db, "STUDENT");
    expect(now).toMatchObject({ version: "2026-11-01-120000", source: "PUBLISHED", publishedAt: at(0).toISOString() });
    expect(now.content).toEqual(words);
    expect(now.sha256).toBe((outcome as { sha256: string }).sha256);
    expect((await currentTerms(db, "PROFESSIONAL")).version).toBe(BASELINE_VERSION);

    // Who, when and why are kept; the trail says what happened but never the words.
    const row = await db.prepare("SELECT published_by_user_id AS who, change_note AS note FROM terms_versions").first<{ who: string; note: string }>();
    expect(row).toEqual({ who: "mgr-1", note: "Ajuste do título." });
    const audit = await db.prepare("SELECT actor_user_id AS actor, organization_id AS org, action, subject_id AS subject FROM access_audit_events WHERE action LIKE 'TERMS_PUBLISHED_%'").all<{ actor: string; org: string | null; action: string; subject: string }>();
    expect(audit.results).toHaveLength(1);
    expect(audit.results[0]).toMatchObject({ actor: "mgr-1", org: null, action: "TERMS_PUBLISHED_STUDENT" });
    expect(JSON.stringify(audit.results)).not.toContain("atualizado");
  });

  it("names versions by the day and time, so they sort and never repeat", () => {
    expect(versionNameAt(new Date("2026-03-04T05:06:07.890Z"))).toBe("2026-03-04-050607");
    expect(versionNameAt(at(0)) < versionNameAt(at(1))).toBe(true);
  });

  it("publishes nothing for the same words, and nothing for words that are not valid", async () => {
    const before = await count("SELECT COUNT(*) AS n FROM terms_versions");
    const inForce = (await currentTerms(db, "STUDENT")).content;
    expect(await manager().publish("STUDENT", inForce, "igual", at(1))).toEqual({ status: "unchanged" });
    const noPhotos = edited((c) => delete c.photos);
    await expect(manager().publish("STUDENT", noPhotos, "", at(1))).rejects.toThrow(ZodError);
    await expect(manager().publish("STUDENT", { ...inForce, sections: [] }, "", at(1))).rejects.toThrow(ZodError);
    await expect(manager().publish("STUDENT", { ...inForce, extra: "x" }, "", at(1))).rejects.toThrow(ZodError);
    await expect(manager().publish("STUDENT", edited((c) => (c.title = "x")), "n".repeat(501), at(1))).rejects.toThrow("TERMS_NOTE_TOO_LONG");
    expect(await count("SELECT COUNT(*) AS n FROM terms_versions")).toBe(before);
  });

  it("refuses a second publication in the same second instead of overwriting the first", async () => {
    const first = await manager().publish("PROFESSIONAL", edited((c) => (c.title = "Primeiro"), "PROFESSIONAL"), "", at(5));
    expect(first.status).toBe("published");
    expect(await manager().publish("PROFESSIONAL", edited((c) => (c.title = "Segundo"), "PROFESSIONAL"), "", at(5))).toEqual({ status: "conflict" });
    expect((await currentTerms(db, "PROFESSIONAL")).content.title).toBe("Primeiro");
  });

  it("is open only to an active platform manager, in the code and in the database", async () => {
    const before = await count("SELECT COUNT(*) AS n FROM terms_versions");
    const words = edited((c) => (c.title = "Tentativa"));
    for (const user of ["tech-a", "client-1", "stranger", "mgr-2", "mgr-off", "nobody"]) {
      await expect(manager(user).publish("STUDENT", words, "", at(9)), `${user} publish`).rejects.toThrow("PLATFORM_ACTION_FORBIDDEN");
      await expect(manager(user).history("STUDENT"), `${user} history`).rejects.toThrow("PLATFORM_ACTION_FORBIDDEN");
      await expect(manager(user).contentOf("STUDENT", null), `${user} contentOf`).rejects.toThrow("PLATFORM_ACTION_FORBIDDEN");
    }
    expect(() => termsFor(db, null)).toThrow("AUTHENTICATION_REQUIRED");
    expect(() => termsFor(db, { userId: " " })).toThrow("AUTHENTICATION_REQUIRED");
    const insert = (user: string) =>
      run(
        `INSERT INTO terms_versions(id,audience,version,content_json,sha256,published_by_user_id,published_at)
         VALUES (?1,'STUDENT',?2,'{}',?3,?4,'2026-11-01T00:00:00.000Z')`,
        crypto.randomUUID(), `direct-${user}`, "a".repeat(64), user,
      );
    for (const user of ["tech-a", "mgr-2", "mgr-off"]) await expect(insert(user), user).rejects.toThrow(/TERMS_ADMIN_REQUIRED/);
    expect(await count("SELECT COUNT(*) AS n FROM terms_versions")).toBe(before);
  });

  it("never changes or loses a published version", async () => {
    await expect(run("UPDATE terms_versions SET content_json = '{}'")).rejects.toThrow(/TERMS_APPEND_ONLY/);
    await expect(run("UPDATE terms_versions SET sha256 = ?1", "b".repeat(64))).rejects.toThrow(/TERMS_APPEND_ONLY/);
    await expect(run("DELETE FROM terms_versions")).rejects.toThrow(/TERMS_APPEND_ONLY/);
    const bad = (sha: string, json: string, audience = "STUDENT") =>
      run(
        `INSERT INTO terms_versions(id,audience,version,content_json,sha256,published_by_user_id,published_at)
         VALUES (?1,?2,?3,?4,?5,'mgr-1','2026-11-01T00:00:00.000Z')`,
        crypto.randomUUID(), audience, `bad-${sha.length}-${json.length}`, json, sha,
      );
    await expect(bad("short", "{}")).rejects.toThrow();
    await expect(bad("G".repeat(64), "{}")).rejects.toThrow();
    await expect(bad("c".repeat(64), "not json")).rejects.toThrow();
    await expect(bad("c".repeat(64), "{}", "OTHER")).rejects.toThrow();
  });
});

describe("what a new version does to the people who accepted the old one", () => {
  it("asks everyone again, refuses an acceptance of words that are no longer in force, and counts who accepted what", async () => {
    // The professional's text has been "Primeiro" since the previous test; start from the approved student text of the baseline's era.
    const login = "client-2";
    expect(await hasCurrentAcceptance(db, login, "STUDENT")).toBe(false);
    const inForce = await currentTerms(db, "STUDENT");
    expect(await recordAcceptance(db, login, "STUDENT", { photosAuthorized: true, shownVersion: inForce.version }, at(20))).toEqual({ status: "accepted" });
    expect(await hasCurrentAcceptance(db, login, "STUDENT")).toBe(true);
    const accepted = await db.prepare("SELECT terms_version AS version, terms_sha256 AS sha FROM consent_acceptances WHERE user_id = ?1").bind(login).first<{ version: string; sha: string }>();
    expect(accepted).toEqual({ version: inForce.version, sha: inForce.sha256 });

    // The manager publishes while the person has the old text on the screen.
    const published = await manager().publish("STUDENT", edited((c) => (c.confirmation = "Li, entendi e aceito os termos.")), "Nova frase.", at(30));
    expect(published.status).toBe("published");
    expect(await hasCurrentAcceptance(db, login, "STUDENT")).toBe(false);
    const before = await count("SELECT COUNT(*) AS n FROM consent_acceptances");
    expect(await recordAcceptance(db, login, "STUDENT", { photosAuthorized: true, shownVersion: inForce.version }, at(31))).toEqual({ status: "outdated" });
    expect(await recordAcceptance(db, login, "STUDENT", { photosAuthorized: true, shownVersion: "" }, at(31))).toEqual({ status: "outdated" });
    expect(await count("SELECT COUNT(*) AS n FROM consent_acceptances")).toBe(before);

    // The person reads the new words and accepts those, and what is recorded is the new version and hash.
    const now = await currentTerms(db, "STUDENT");
    expect(await recordAcceptance(db, login, "STUDENT", { photosAuthorized: true, shownVersion: now.version }, at(32))).toEqual({ status: "accepted" });
    expect(await hasCurrentAcceptance(db, login, "STUDENT")).toBe(true);
    const latest = await db.prepare("SELECT terms_version AS version, terms_sha256 AS sha FROM consent_acceptances WHERE user_id = ?1 ORDER BY accepted_at DESC, rowid DESC LIMIT 1").bind(login).first<{ version: string; sha: string }>();
    expect(latest).toEqual({ version: now.version, sha: now.sha256 });

    // Counts are of people whose latest acceptance is that version, never who.
    const history = await manager().history("STUDENT");
    expect(history.map((row) => [row.version, row.acceptedBy, row.current])).toEqual([
      [now.version, 1, true],
      ["2026-11-01-120000", 0, false],
      [BASELINE_VERSION, 0, false],
    ]);
  });

  it("closes the photos of a student whose acceptance is of an older text, until they accept the new one", async () => {
    await recordAcceptance(db, "client-1", "STUDENT", { photosAuthorized: true, shownVersion: (await currentTerms(db, "STUDENT")).version }, at(40));
    expect(await photoAuthorizationFor(db, "org-a", "st-1")).toMatchObject({ status: "authorized" });
    await manager().publish("STUDENT", edited((c) => (c.intro = "Introdução nova, mais curta.")), "", at(41));
    expect(await photoAuthorizationFor(db, "org-a", "st-1")).toEqual({ status: "denied", reason: "OUTDATED" });
    await recordAcceptance(db, "client-1", "STUDENT", { photosAuthorized: true, shownVersion: (await currentTerms(db, "STUDENT")).version }, at(42));
    expect(await photoAuthorizationFor(db, "org-a", "st-1")).toMatchObject({ status: "authorized" });
  });
});

describe("the manager's history", () => {
  it("lists the newest first and the initial text last, with who published and why, and gives back the words of any version", async () => {
    const history = await manager().history("STUDENT");
    expect(history.length).toBeGreaterThanOrEqual(3);
    expect(history[0].current).toBe(true);
    expect(history.slice(1).every((row) => !row.current)).toBe(true);
    expect(history.at(-1)).toMatchObject({ id: null, version: BASELINE_VERSION, source: "BASELINE", publishedAt: null, publishedByEmail: null });
    const dates = history.filter((row) => row.publishedAt).map((row) => row.publishedAt!);
    expect(dates).toEqual([...dates].sort().reverse());
    const second = history.find((row) => row.version === "2026-11-01-120000")!;
    expect(second).toMatchObject({ publishedByEmail: "mgr-1@example.test", changeNote: "Ajuste do título.", source: "PUBLISHED" });

    expect((await manager().contentOf("STUDENT", second.id))!.title).toBe("Termos e aviso de privacidade do aluno (atualizado)");
    expect(await manager().contentOf("STUDENT", null)).toEqual(BASELINE.STUDENT);
    expect(await manager().contentOf("STUDENT", "no-such-version")).toBeNull();
    // A version of another audience is not served as this one's.
    const professionalId = (await manager().history("PROFESSIONAL"))[0].id;
    expect(await manager().contentOf("STUDENT", professionalId)).toBeNull();
  });
});
