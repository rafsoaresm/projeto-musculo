import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { currentTerms, termsFor, type EditorState } from "@/db/terms";
import {
  BASELINE,
  DRAFT_MAX_CHARACTERS,
  parseDraftContent,
  type Audience,
  type TermsContent,
  type TermsDraftContent,
} from "@/modules/consentimento/terms";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// Real local D1 with the real migrations and triggers. Managers are rows in platform_admins, as the
// server derives them from a verified session.
let mf: Miniflare;
let db: D1Database;
const T0 = new Date("2026-11-01T12:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const run = (sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds).run();
const one = async <T>(sql: string, ...binds: unknown[]) => (await db.prepare(sql).bind(...binds).first<T>())!;
const count = async (sql: string, ...binds: unknown[]) => (await one<{ n: number }>(sql, ...binds)).n;
const manager = (user = "mgr-1") => termsFor(db, { userId: user });
const words = (change: (content: TermsDraftContent) => void, audience: Audience = "STUDENT"): TermsDraftContent => {
  const content: TermsDraftContent = JSON.parse(JSON.stringify(BASELINE[audience]));
  change(content);
  return content;
};
const published = (title: string, audience: Audience = "STUDENT"): TermsContent => {
  const content: TermsContent = JSON.parse(JSON.stringify(BASELINE[audience]));
  content.title = title;
  return content;
};
const inForceId = async (audience: Audience = "STUDENT") =>
  (await db.prepare("SELECT id FROM terms_versions WHERE audience = ?1 ORDER BY published_at DESC, rowid DESC LIMIT 1").bind(audience).first<{ id: string }>())?.id ?? null;
const state = async (draftRevision: number | null, audience: Audience = "STUDENT"): Promise<EditorState> => ({
  inForceId: await inForceId(audience),
  draftRevision,
});
const drafts = async () => (await db.prepare("SELECT audience, revision FROM terms_drafts ORDER BY audience").all<{ audience: string; revision: number }>()).results;
const trail = async (action: string) =>
  (await db.prepare("SELECT actor_user_id AS actor, subject_id AS subject FROM access_audit_events WHERE action = ?1 ORDER BY created_at, rowid").bind(action).all<{ actor: string; subject: string }>()).results;

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "terms-draft-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  const people = ["mgr-1", "mgr-2", "mgr-gone", "mgr-off", "tech-a", "stranger"];
  await db.batch([
    ...people.map((id) => db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)").bind(id, `${id}@example.test`)),
    ...people.map((id) => db.prepare("INSERT INTO users(id) VALUES (?1)").bind(id)),
    db.prepare("INSERT INTO platform_admins(user_id) VALUES ('mgr-1'),('mgr-2'),('mgr-off')"),
    db.prepare("INSERT INTO platform_admins(user_id, revoked_at) VALUES ('mgr-gone','2026-01-01T00:00:00.000Z')"),
    db.prepare("UPDATE users SET disabled_at = '2026-01-01T00:00:00.000Z' WHERE id = 'mgr-off'"),
  ]);
});
afterAll(async () => {
  await mf.dispose();
});

describe("the words of a draft", () => {
  it("may be incomplete, and come back exactly as typed", () => {
    const typed = { title: "  ", intro: "", sections: [{ heading: "", text: "linha 1\r\nlinha 2" }], confirmation: "" };
    expect(parseDraftContent("PROFESSIONAL", typed)).toEqual({
      title: "  ",
      intro: "",
      sections: [{ heading: "", text: "linha 1\nlinha 2" }],
      confirmation: "",
    });
    // The text to be published is stricter: the same words are refused there.
    expect(() => parseDraftContent("STUDENT", words((c) => (c.title = "")))).not.toThrow();
  });

  it("keeps the limits of size and shape, and refuses extra fields", () => {
    const bad = (value: unknown, audience: Audience = "STUDENT") => expect(() => parseDraftContent(audience, value)).toThrow(ZodError);
    bad(words((c) => (c.title = "x".repeat(121))));
    bad(words((c) => (c.intro = "x".repeat(3001))));
    bad(words((c) => (c.sections = [])));
    bad(words((c) => (c.sections = Array.from({ length: 21 }, () => ({ heading: "a", text: "b" })))));
    bad(words((c) => (c.confirmation = "x".repeat(301))));
    bad({ ...words(() => {}), extra: "campo" });
    bad({ ...words(() => {}), sections: [{ heading: "a", text: "b", id: 1 }] });
    // The professional's text has no photos block.
    bad(words(() => {}, "STUDENT"), "PROFESSIONAL");
    // Within every field's limit, but too large for a draft as a whole.
    bad(words((c) => (c.sections = Array.from({ length: 20 }, (_, i) => ({ heading: `s${i}`, text: "x".repeat(4000) })))));
    expect(DRAFT_MAX_CHARACTERS).toBe(60000);
  });
});

describe("saving, reading and discarding", () => {
  it("starts a draft, reads it back and raises the revision by one on each save", async () => {
    expect(await manager().draft("STUDENT")).toBeNull();
    const first = await manager().saveDraft("STUDENT", words((c) => (c.title = "Primeira ideia")), await state(null), at(1));
    expect(first).toEqual({ status: "saved", revision: 1 });
    const read = (await manager().draft("STUDENT"))!;
    expect(read).toMatchObject({ revision: 1, updatedAt: at(1).toISOString(), updatedByEmail: "mgr-1@example.test", baseIsCurrent: true });
    expect(read.content.title).toBe("Primeira ideia");

    expect(await manager("mgr-2").saveDraft("STUDENT", words((c) => (c.title = "Segunda ideia")), await state(1), at(2))).toEqual({ status: "saved", revision: 2 });
    expect(await manager().draft("STUDENT")).toMatchObject({ revision: 2, updatedByEmail: "mgr-2@example.test" });
    // The other audience has its own draft, which is empty.
    expect(await manager().draft("PROFESSIONAL")).toBeNull();
  });

  it("does nothing that anyone but the editor could see: the text in force and the published versions stay", async () => {
    const terms = await currentTerms(db, "STUDENT");
    expect(terms.source).toBe("BASELINE");
    expect(terms.content).toEqual(BASELINE.STUDENT);
    expect(await count("SELECT COUNT(*) AS n FROM terms_versions")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM consent_acceptances")).toBe(0);
  });

  it("refuses to write over what another manager did, whichever way it went", async () => {
    const before = (await manager().draft("STUDENT"))!;
    // Saving with an old revision: the draft is untouched.
    expect(await manager().saveDraft("STUDENT", words((c) => (c.title = "Perdida")), await state(1), at(3))).toEqual({ status: "conflict" });
    // Saving as if there were no draft, when there is one.
    expect(await manager().saveDraft("STUDENT", words((c) => (c.title = "Perdida")), await state(null), at(3))).toEqual({ status: "conflict" });
    // A revision that never existed, or is not a number.
    for (const revision of [99, 0, -1, 1.5]) expect(await manager().saveDraft("STUDENT", words(() => {}), await state(revision), at(3))).toEqual({ status: "conflict" });
    expect(await manager().draft("STUDENT")).toEqual(before);
    // Discarding an old revision does not discard.
    expect(await manager().discardDraft("STUDENT", 1, at(3))).toEqual({ status: "conflict" });
    expect(await drafts()).toEqual([{ audience: "STUDENT", revision: 2 }]);
    expect(await trail("TERMS_DRAFT_DISCARDED_STUDENT")).toHaveLength(0);
  });

  it("discards the revision it was shown, leaves a trail naming no words, and lets a new draft begin", async () => {
    expect(await manager("mgr-2").discardDraft("STUDENT", 2, at(4))).toEqual({ status: "discarded" });
    expect(await manager().draft("STUDENT")).toBeNull();
    expect(await trail("TERMS_DRAFT_DISCARDED_STUDENT")).toEqual([{ actor: "mgr-2", subject: "STUDENT" }]);
    // Discarding again finds nothing to discard.
    expect(await manager().discardDraft("STUDENT", 2, at(5))).toEqual({ status: "conflict" });
    // A fresh draft starts again at revision 1.
    expect(await manager().saveDraft("STUDENT", words((c) => (c.title = "Recomeço")), await state(null), at(6))).toEqual({ status: "saved", revision: 1 });
  });

  it("refuses a first draft on a text that is no longer the one in force", async () => {
    // The editor loaded the initial text; meanwhile another text was published.
    const loaded = await state(null, "PROFESSIONAL");
    expect(loaded.inForceId).toBeNull();
    expect((await manager("mgr-2").publish("PROFESSIONAL", published("Publicado por outro", "PROFESSIONAL"), null, at(7))).status).toBe("published");
    expect(await manager().saveDraft("PROFESSIONAL", words((c) => (c.title = "Sobre o texto velho"), "PROFESSIONAL"), loaded, at(8))).toEqual({ status: "base_changed" });
    expect(await manager().draft("PROFESSIONAL")).toBeNull();
    // On the new text it is accepted.
    expect(await manager().saveDraft("PROFESSIONAL", words((c) => (c.title = "Sobre o texto novo"), "PROFESSIONAL"), await state(null, "PROFESSIONAL"), at(9))).toEqual({ status: "saved", revision: 1 });
  });
});

describe("publishing", () => {
  it("publishes the text and takes the draft with it, in one batch", async () => {
    // The student's draft is at revision 1 (see above). Publishing from it removes it.
    expect(await drafts()).toEqual([{ audience: "PROFESSIONAL", revision: 1 }, { audience: "STUDENT", revision: 1 }]);
    const outcome = await manager().publish("STUDENT", published("Texto publicado a partir do rascunho"), "motivo", at(10), await state(1));
    expect(outcome.status).toBe("published");
    expect(await drafts()).toEqual([{ audience: "PROFESSIONAL", revision: 1 }]);
    expect((await currentTerms(db, "STUDENT")).content.title).toBe("Texto publicado a partir do rascunho");
    expect(await trail("TERMS_PUBLISHED_STUDENT")).toHaveLength(1);
  });

  it("publishes nothing when the draft is not in the state the editor loaded", async () => {
    const versions = await count("SELECT COUNT(*) AS n FROM terms_versions");
    const stale = await manager().publish("PROFESSIONAL", published("Não deve sair", "PROFESSIONAL"), null, at(11), await state(7, "PROFESSIONAL"));
    expect(stale).toEqual({ status: "draft_changed" });
    // The editor saw no draft, but there is one.
    expect(await manager().publish("PROFESSIONAL", published("Não deve sair", "PROFESSIONAL"), null, at(12), await state(null, "PROFESSIONAL"))).toEqual({ status: "draft_changed" });
    expect(await count("SELECT COUNT(*) AS n FROM terms_versions")).toBe(versions);
    expect(await drafts()).toEqual([{ audience: "PROFESSIONAL", revision: 1 }]);
    expect(await trail("TERMS_PUBLISHED_PROFESSIONAL")).toHaveLength(1);
  });

  it("publishes nothing when another text was published after the editor loaded the one in force", async () => {
    const loaded = await state(1, "PROFESSIONAL");
    expect((await manager("mgr-2").publish("PROFESSIONAL", published("Outro gestor chegou antes", "PROFESSIONAL"), null, at(13))).status).toBe("published");
    const versions = await count("SELECT COUNT(*) AS n FROM terms_versions");
    expect(await manager().publish("PROFESSIONAL", published("Por cima, sem ter visto", "PROFESSIONAL"), null, at(14), loaded)).toEqual({ status: "base_changed" });
    expect(await count("SELECT COUNT(*) AS n FROM terms_versions")).toBe(versions);
    expect((await currentTerms(db, "PROFESSIONAL")).content.title).toBe("Outro gestor chegou antes");
    // Nothing was audited as published for the refused one.
    expect(await trail("TERMS_PUBLISHED_PROFESSIONAL")).toHaveLength(2);
  });

  it("publishes, when the editor loaded the state that is still true, even with no draft at all", async () => {
    await run("DELETE FROM terms_drafts");
    const outcome = await manager().publish("STUDENT", published("Sem rascunho nenhum"), null, at(15), await state(null));
    expect(outcome.status).toBe("published");
  });
});

describe("publishing over a text another manager published, with no draft involved", () => {
  it("is refused on the version in force alone", async () => {
    const loaded = await state(null);
    expect(loaded.draftRevision).toBeNull();
    expect(await drafts()).toEqual([]);
    expect((await manager("mgr-2").publish("STUDENT", published("Chegou antes"), null, at(16))).status).toBe("published");
    const versions = await count("SELECT COUNT(*) AS n FROM terms_versions");
    expect(await manager().publish("STUDENT", published("Por cima, sem ter visto"), null, at(17), loaded)).toEqual({ status: "base_changed" });
    expect(await count("SELECT COUNT(*) AS n FROM terms_versions")).toBe(versions);
    expect((await currentTerms(db, "STUDENT")).content.title).toBe("Chegou antes");
    // On the state it did see, the same words go out.
    expect((await manager().publish("STUDENT", published("Depois de ler o novo"), null, at(18), await state(null))).status).toBe("published");
  });
});

describe("who may write, and what the database holds", () => {
  it("refuses everyone who is not an active manager, and writes nothing", async () => {
    for (const who of ["mgr-gone", "mgr-off", "tech-a", "stranger"]) {
      await expect(manager(who).draft("STUDENT"), who).rejects.toThrow("PLATFORM_ACTION_FORBIDDEN");
      await expect(manager(who).saveDraft("STUDENT", words(() => {}), await state(null), at(20)), who).rejects.toThrow("PLATFORM_ACTION_FORBIDDEN");
      await expect(manager(who).discardDraft("STUDENT", 1, at(20)), who).rejects.toThrow("PLATFORM_ACTION_FORBIDDEN");
    }
    expect(await drafts()).toEqual([]);
    expect(() => termsFor(db, null)).toThrow("AUTHENTICATION_REQUIRED");
  });

  it("holds its own rules against SQL written around the code", async () => {
    const insert = (user: string, revision = 1, audience = "STUDENT") =>
      run(
        "INSERT INTO terms_drafts (audience, content_json, base_sha256, revision, updated_by_user_id, updated_at) VALUES (?1, '{}', ?2, ?3, ?4, ?5)",
        audience,
        "a".repeat(64),
        revision,
        user,
        at(30).toISOString(),
      );
    // Only an active manager starts a draft, and always at revision 1.
    for (const who of ["mgr-gone", "mgr-off", "tech-a"]) await expect(insert(who), who).rejects.toThrow(/TERMS_ADMIN_REQUIRED/);
    await expect(insert("mgr-1", 2)).rejects.toThrow(/TERMS_DRAFT_RULES/);
    await expect(insert("mgr-1", 1, "OTHER")).rejects.toThrow();
    await insert("mgr-1");
    // One draft per audience.
    await expect(insert("mgr-1")).rejects.toThrow();
    // The sequence of revisions, the audience and the base cannot be bent.
    const update = (set: string, ...binds: unknown[]) => run(`UPDATE terms_drafts SET ${set} WHERE audience = 'STUDENT'`, ...binds);
    await expect(update("revision = 3")).rejects.toThrow(/TERMS_DRAFT_RULES/);
    await expect(update("revision = 1")).rejects.toThrow(/TERMS_DRAFT_RULES/);
    await expect(update("audience = 'PROFESSIONAL', revision = 2")).rejects.toThrow(/TERMS_DRAFT_RULES/);
    await expect(update("base_sha256 = ?1, revision = 2", "b".repeat(64))).rejects.toThrow(/TERMS_DRAFT_RULES/);
    // Only an active manager writes it.
    await expect(update("revision = 2, updated_by_user_id = 'mgr-gone'")).rejects.toThrow(/TERMS_ADMIN_REQUIRED/);
    await expect(update("revision = 2, updated_by_user_id = 'tech-a'")).rejects.toThrow(/TERMS_ADMIN_REQUIRED/);
    await update("revision = 2, updated_by_user_id = 'mgr-2'");
    expect(await drafts()).toEqual([{ audience: "STUDENT", revision: 2 }]);
    // Content that is not JSON, or too large, is refused by the table.
    await expect(update("revision = 3, content_json = 'não é json'")).rejects.toThrow();
    await expect(update("revision = 3, content_json = json_quote(?1)", "x".repeat(60001))).rejects.toThrow();
    await run("DELETE FROM terms_drafts");
  });
});
