import type { D1Database } from "@cloudflare/workers-types";
import {
  BASELINE,
  BASELINE_VERSION,
  parseDraftContent,
  parseTermsContent,
  sameContent,
  termsHash,
  type Audience,
  type ResolvedTerms,
  type ShownTerms,
  type TermsContent,
  type TermsDraftContent,
} from "@/modules/consentimento/terms";
import { adminGuard, type PlatformContext } from "./platform";

/**
 * The words of the terms in force. The text the lawyer approved is the initial one and lives in the
 * application; the platform manager can publish another, one immutable row per version, and the
 * latest row of an audience is the one in force. Everyone who has accepted something else is asked
 * again at the next access (see `hasCurrentAcceptance`).
 */
const baselineCache = new Map<Audience, Promise<ResolvedTerms>>();

function baseline(audience: Audience): Promise<ResolvedTerms> {
  let cached = baselineCache.get(audience);
  if (!cached) {
    cached = termsHash(audience, BASELINE_VERSION, BASELINE[audience]).then((sha256) => ({
      audience,
      version: BASELINE_VERSION,
      content: BASELINE[audience],
      sha256,
      source: "BASELINE" as const,
      publishedAt: null,
    }));
    baselineCache.set(audience, cached);
  }
  return cached;
}

interface VersionRow {
  id: string;
  version: string;
  contentJson: string;
  sha256: string;
  publishedAt: string;
}

function resolved(audience: Audience, row: VersionRow): ResolvedTerms {
  let content: TermsContent;
  try {
    content = parseTermsContent(audience, JSON.parse(row.contentJson));
  } catch {
    // A stored version that cannot be read must never be shown as if it were the text in force.
    throw new Error("TERMS_UNREADABLE");
  }
  return { audience, version: row.version, content, sha256: row.sha256, source: "PUBLISHED", publishedAt: row.publishedAt };
}

const latestRow = (db: D1Database, audience: Audience) =>
  db
    .prepare(
      `SELECT id, version, content_json AS contentJson, sha256, published_at AS publishedAt
       FROM terms_versions WHERE audience = ?1 ORDER BY published_at DESC, rowid DESC LIMIT 1`,
    )
    .bind(audience)
    .first<VersionRow>();

/** The terms in force for an audience: the latest published version, or the initial text before any. */
export async function currentTerms(db: D1Database, audience: Audience): Promise<ResolvedTerms> {
  const row = await latestRow(db, audience);
  return row ? resolved(audience, row) : baseline(audience);
}

/** What a page hands to the person reading: the version and the words, without where they came from. */
export async function shownTerms(db: D1Database, audience: Audience): Promise<ShownTerms> {
  const { version, content } = await currentTerms(db, audience);
  return { audience, version, content };
}

export interface TermsVersionSummary {
  /** The row id; null for the initial text, which is in the application and not in the table. */
  id: string | null;
  version: string;
  sha256: string;
  source: "BASELINE" | "PUBLISHED";
  publishedAt: string | null;
  publishedByEmail: string | null;
  changeNote: string | null;
  /** People whose latest acceptance is this version. A count, never who. */
  acceptedBy: number;
  current: boolean;
}
export type PublishOutcome =
  | { status: "published"; version: string; sha256: string }
  | { status: "unchanged" }
  | { status: "conflict" }
  /** The draft was saved, replaced or discarded by someone after the editor loaded it. Nothing was published. */
  | { status: "draft_changed" }
  /** Another text was published after the editor loaded the one in force. Nothing was published. */
  | { status: "base_changed" };

/**
 * What the editor loaded, so that a manager never writes over what another did in between: the version
 * in force (its row id, or null for the initial text) and the saved draft (its revision, or null for none).
 */
export interface EditorState {
  inForceId: string | null;
  draftRevision: number | null;
}

/** The words being written for one audience, shared by the managers. Not a published version. */
export interface TermsDraft {
  content: TermsDraftContent;
  /** The optimistic lock: each save must carry the revision it loaded. */
  revision: number;
  updatedAt: string;
  updatedByEmail: string;
  /** The text in force is still the one this draft was started from. */
  baseIsCurrent: boolean;
}
export type SaveDraftOutcome = { status: "saved"; revision: number } | { status: "conflict" } | { status: "base_changed" };
export type DiscardDraftOutcome = { status: "discarded" } | { status: "conflict" };

/** Version names of published texts: the day and time, so that they sort and never repeat. */
export const versionNameAt = (now: Date) => {
  const iso = now.toISOString();
  return `${iso.slice(0, 10)}-${iso.slice(11, 19).replace(/:/g, "")}`;
};

/** The id of the version in force for the audience in ?2 (null for the initial text), as SQL. */
const inForceIdSql = `(SELECT v.id FROM terms_versions v WHERE v.audience = ?2 ORDER BY v.published_at DESC, v.rowid DESC LIMIT 1)`;

const acceptedByCount = `(SELECT COUNT(DISTINCT c.user_id) FROM consent_acceptances c
  WHERE c.audience = ?2 AND c.terms_version = %VERSION% AND c.terms_sha256 = %SHA%
    AND c.id = (SELECT c2.id FROM consent_acceptances c2
      WHERE c2.user_id = c.user_id AND c2.audience = c.audience ORDER BY c2.accepted_at DESC, c2.rowid DESC LIMIT 1))`;

/** The platform manager's side: reads the history and publishes a new version. Nobody else. */
export function termsFor(db: D1Database, context: PlatformContext | null) {
  const userId = context?.userId?.trim();
  if (!userId) throw new Error("AUTHENTICATION_REQUIRED");
  // ?1 is always the acting manager and ?2 the audience.
  const assertAdmin = async () => {
    const ok = await db.prepare(`SELECT 1 AS ok WHERE ${adminGuard("?1")}`).bind(userId).first();
    if (!ok) throw new Error("PLATFORM_ACTION_FORBIDDEN");
  };

  return {
    /** What is in force and every version before it, newest first, with how many people accepted each. */
    async history(audience: Audience): Promise<TermsVersionSummary[]> {
      await assertAdmin();
      const published = await db
        .prepare(
          `SELECT v.id, v.version, v.sha256, v.published_at AS publishedAt, v.change_note AS changeNote,
             ue.email AS publishedByEmail,
             ${acceptedByCount.replace("%VERSION%", "v.version").replace("%SHA%", "v.sha256")} AS acceptedBy
           FROM terms_versions v
           JOIN auth_user ue ON ue.id = v.published_by_user_id
           WHERE v.audience = ?2 AND ${adminGuard("?1")}
           ORDER BY v.published_at DESC, v.rowid DESC`,
        )
        .bind(userId, audience)
        .all<Omit<TermsVersionSummary, "source" | "current">>();
      const initial = await baseline(audience);
      const initialCount = await db
        .prepare(`SELECT ${acceptedByCount.replace("%VERSION%", "?3").replace("%SHA%", "?4")} AS n WHERE ${adminGuard("?1")}`)
        .bind(userId, audience, initial.version, initial.sha256)
        .first<{ n: number }>();
      const rows: TermsVersionSummary[] = [
        ...published.results.map((row) => ({ ...row, source: "PUBLISHED" as const, current: false })),
        {
          id: null,
          version: initial.version,
          sha256: initial.sha256,
          source: "BASELINE",
          publishedAt: null,
          publishedByEmail: null,
          changeNote: null,
          acceptedBy: initialCount?.n ?? 0,
          current: false,
        },
      ];
      rows[0].current = true;
      return rows;
    },

    /** The words of one version, to start an edit from it. `null` id is the initial text. */
    async contentOf(audience: Audience, id: string | null): Promise<TermsContent | null> {
      await assertAdmin();
      if (id === null) return (await baseline(audience)).content;
      const row = await db
        .prepare(
          `SELECT id, version, content_json AS contentJson, sha256, published_at AS publishedAt
           FROM terms_versions WHERE id = ?3 AND audience = ?2 AND ${adminGuard("?1")}`,
        )
        .bind(userId, audience, id)
        .first<VersionRow>();
      return row ? resolved(audience, row).content : null;
    },

    /** The saved draft of an audience, or null when there is none. */
    async draft(audience: Audience): Promise<TermsDraft | null> {
      await assertAdmin();
      const row = await db
        .prepare(
          `SELECT d.content_json AS contentJson, d.revision, d.updated_at AS updatedAt, d.base_sha256 AS baseSha,
             ue.email AS updatedByEmail
           FROM terms_drafts d JOIN auth_user ue ON ue.id = d.updated_by_user_id
           WHERE d.audience = ?2 AND ${adminGuard("?1")}`,
        )
        .bind(userId, audience)
        .first<{ contentJson: string; revision: number; updatedAt: string; baseSha: string; updatedByEmail: string }>();
      if (!row) return null;
      let content: TermsDraftContent;
      try {
        content = parseDraftContent(audience, JSON.parse(row.contentJson));
      } catch {
        throw new Error("TERMS_DRAFT_UNREADABLE");
      }
      const inForce = await currentTerms(db, audience);
      return {
        content,
        revision: row.revision,
        updatedAt: row.updatedAt,
        updatedByEmail: row.updatedByEmail,
        baseIsCurrent: row.baseSha === inForce.sha256,
      };
    },

    /**
     * Saves the draft. `expected` is what the editor loaded: the draft revision (null when it loaded none)
     * and the version in force. If the draft is not exactly in that state any more, somebody saved,
     * replaced or discarded it in between (`conflict`); if a new draft is started on a text that is no
     * longer the one in force, another text was published in between (`base_changed`). Nothing is
     * written in either case. Throws a ZodError for words that do not fit, and `PLATFORM_ACTION_FORBIDDEN`
     * for anyone who is not an active manager. The draft may be incomplete.
     */
    async saveDraft(audience: Audience, raw: unknown, expected: EditorState, now = new Date()): Promise<SaveDraftOutcome> {
      await assertAdmin();
      const content = JSON.stringify(parseDraftContent(audience, raw));
      const stamp = now.toISOString();
      try {
        if (expected.draftRevision === null) {
          const base = await currentTerms(db, audience);
          const result = await db
            .prepare(
              `INSERT INTO terms_drafts (audience, content_json, base_sha256, revision, updated_by_user_id, updated_at)
               SELECT ?2, ?3, ?4, 1, ?1, ?5
               WHERE ${adminGuard("?1")} AND ${inForceIdSql} IS ?6
                 AND NOT EXISTS (SELECT 1 FROM terms_drafts WHERE audience = ?2)`,
            )
            .bind(userId, audience, content, base.sha256, stamp, expected.inForceId)
            .run();
          if (result.meta.changes > 0) return { status: "saved", revision: 1 };
          const taken = await db.prepare("SELECT 1 AS ok FROM terms_drafts WHERE audience = ?1").bind(audience).first();
          return taken ? { status: "conflict" } : { status: "base_changed" };
        }
        if (!Number.isInteger(expected.draftRevision) || expected.draftRevision < 1) return { status: "conflict" };
        const result = await db
          .prepare(
            `UPDATE terms_drafts SET content_json = ?3, revision = revision + 1, updated_by_user_id = ?1, updated_at = ?4
             WHERE audience = ?2 AND revision = ?5 AND ${adminGuard("?1")}`,
          )
          .bind(userId, audience, content, stamp, expected.draftRevision)
          .run();
        return result.meta.changes > 0 ? { status: "saved", revision: expected.draftRevision + 1 } : { status: "conflict" };
      } catch (error) {
        const message = String(error);
        if (message.includes("UNIQUE")) return { status: "conflict" };
        if (message.includes("TERMS_ADMIN_REQUIRED")) throw new Error("PLATFORM_ACTION_FORBIDDEN");
        throw error;
      }
    },

    /** Throws the draft away, leaving a row in the trail. Only the revision the editor loaded can be discarded. */
    async discardDraft(audience: Audience, expectedRevision: number, now = new Date()): Promise<DiscardDraftOutcome> {
      await assertAdmin();
      const stamp = now.toISOString();
      const results = await db.batch([
        db
          .prepare(`DELETE FROM terms_drafts WHERE audience = ?2 AND revision = ?3 AND ${adminGuard("?1")}`)
          .bind(userId, audience, expectedRevision),
        db
          .prepare(
            `INSERT INTO access_audit_events (id, organization_id, actor_user_id, action, subject_id, created_at)
             SELECT ?1, NULL, ?2, ?3, ?4, ?5 WHERE (SELECT changes()) > 0`,
          )
          .bind(crypto.randomUUID(), userId, `TERMS_DRAFT_DISCARDED_${audience}`, audience, stamp),
      ]);
      return results[0].meta.changes > 0 ? { status: "discarded" } : { status: "conflict" };
    },

    /**
     * Publishes new words as the next version. Throws a ZodError for words that are not valid, and
     * `PLATFORM_ACTION_FORBIDDEN` for anyone who is not an active manager. The same words as the ones
     * in force publish nothing: a new version would ask everyone to accept again for no change.
     *
     * `expected` is what the editor loaded (see `EditorState`): if the version in force is not that one
     * any more, or the draft is not exactly in that state, nothing is published, so a manager never
     * publishes over what another one did. Without it nothing is checked. A published text removes the
     * draft of its audience, in the same batch.
     */
    async publish(
      audience: Audience,
      raw: unknown,
      note: unknown,
      now = new Date(),
      expected?: EditorState,
    ): Promise<PublishOutcome> {
      await assertAdmin();
      const content = parseTermsContent(audience, raw);
      const reason = typeof note === "string" ? note.trim() : "";
      if (reason.length > 500) throw new Error("TERMS_NOTE_TOO_LONG");
      const current = await currentTerms(db, audience);
      if (sameContent(current.content, content)) return { status: "unchanged" };

      const version = versionNameAt(now);
      const sha256 = await termsHash(audience, version, content);
      const id = crypto.randomUUID();
      const stamp = now.toISOString();
      const guarded = expected !== undefined;
      const stateIs = guarded
        ? ` AND ${inForceIdSql} IS ?9
            AND ((?10 IS NULL AND NOT EXISTS (SELECT 1 FROM terms_drafts WHERE audience = ?2))
              OR EXISTS (SELECT 1 FROM terms_drafts WHERE audience = ?2 AND revision = ?10))`
        : "";
      const binds: unknown[] = [userId, audience, id, version, JSON.stringify(content), sha256, reason || null, stamp];
      if (expected) binds.push(expected.inForceId, expected.draftRevision);
      try {
        const results = await db.batch([
          db
            .prepare(
              `INSERT INTO terms_versions (id, audience, version, content_json, sha256, change_note, published_by_user_id, published_at)
               SELECT ?3, ?2, ?4, ?5, ?6, ?7, ?1, ?8 WHERE ${adminGuard("?1")}${stateIs}`,
            )
            .bind(...binds),
          db
            .prepare(
              `INSERT INTO access_audit_events (id, organization_id, actor_user_id, action, subject_id, created_at)
               SELECT ?1, NULL, ?2, ?3, ?4, ?5 WHERE (SELECT changes()) > 0`,
            )
            .bind(crypto.randomUUID(), userId, `TERMS_PUBLISHED_${audience}`, id, stamp),
          // The words were published: the draft they came from has done its job. Only if the version exists.
          db
            .prepare(
              `DELETE FROM terms_drafts
               WHERE audience = ?2 AND EXISTS (SELECT 1 FROM terms_versions WHERE id = ?3 AND published_by_user_id = ?1)`,
            )
            .bind(userId, audience, id),
        ]);
        if (results[0].meta.changes === 0) {
          if (!guarded) throw new Error("PLATFORM_ACTION_FORBIDDEN");
          // Nothing was written: say which of the two things the manager had not seen has changed.
          return (await latestRow(db, audience))?.id !== (expected.inForceId ?? undefined)
            ? { status: "base_changed" }
            : { status: "draft_changed" };
        }
      } catch (error) {
        const message = String(error);
        if (message.includes("UNIQUE")) return { status: "conflict" };
        if (message.includes("TERMS_ADMIN_REQUIRED")) throw new Error("PLATFORM_ACTION_FORBIDDEN");
        throw error;
      }
      return { status: "published", version, sha256 };
    },
  };
}
