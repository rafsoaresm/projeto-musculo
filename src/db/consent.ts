import type { D1Database } from "@cloudflare/workers-types";
import { TERMS_VERSION, termsHash, type Audience } from "@/modules/consentimento/terms";
import { activeUser, assertContext, technicalAccessExists, type AuthenticatedContext } from "./students";

/**
 * The acceptance of the terms, once, when a person joins the tool. The table only grows: the state
 * of a person is their latest row for that audience. The text itself is in the application; a row
 * keeps the version and the SHA-256 of the exact words that were accepted.
 */
export interface Acceptance {
  id: string;
  version: string;
  sha256: string;
  photosAuthorized: boolean;
  acceptedAt: string;
}

export async function latestAcceptance(
  db: D1Database,
  userId: string,
  audience: Audience,
): Promise<Acceptance | null> {
  if (!userId?.trim()) return null;
  return db
    .prepare(
      `SELECT id, terms_version AS version, terms_sha256 AS sha256, photos_authorized AS photosAuthorized,
         accepted_at AS acceptedAt
       FROM consent_acceptances
       WHERE user_id = ?1 AND audience = ?2
       ORDER BY accepted_at DESC, rowid DESC LIMIT 1`,
    )
    .bind(userId, audience)
    .first<{ id: string; version: string; sha256: string; photosAuthorized: number; acceptedAt: string }>()
    .then((row) => (row ? { ...row, photosAuthorized: Boolean(row.photosAuthorized) } : null));
}

/** Whether the latest acceptance is of the version and of the exact words in force now. */
export async function hasCurrentAcceptance(db: D1Database, userId: string, audience: Audience): Promise<boolean> {
  const latest = await latestAcceptance(db, userId, audience);
  return latest !== null && latest.version === TERMS_VERSION && latest.sha256 === (await termsHash(audience));
}

export type AcceptOutcome = { status: "accepted" } | { status: "already" } | { status: "refused" };

/**
 * Records the acceptance of the terms in force. Asking again with the same choice changes nothing.
 * The photos authorization only exists for a student; for anyone else it is stored as "no". A
 * blocked login records nothing.
 */
export async function recordAcceptance(
  db: D1Database,
  userId: string,
  audience: Audience,
  options: { photosAuthorized: boolean },
  now = new Date(),
): Promise<AcceptOutcome> {
  if (!userId?.trim()) return { status: "refused" };
  const photos = audience === "STUDENT" && options.photosAuthorized;
  const sha256 = await termsHash(audience);
  const latest = await latestAcceptance(db, userId, audience);
  if (latest && latest.version === TERMS_VERSION && latest.sha256 === sha256 && latest.photosAuthorized === photos)
    return { status: "already" };
  // The person may not have a row in `users` yet (it is created when the space is created or the
  // invitation accepted, which comes right after this acceptance). It is made here from the verified
  // account, in the same step; a blocked login keeps its block and records nothing.
  const [, inserted] = await db.batch([
    db.prepare("INSERT OR IGNORE INTO users(id) SELECT id FROM auth_user WHERE id = ?1").bind(userId),
    db
      .prepare(
        `INSERT INTO consent_acceptances (id, user_id, audience, terms_version, terms_sha256, photos_authorized, accepted_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7 WHERE ${activeUser("?2")}`,
      )
      .bind(crypto.randomUUID(), userId, audience, TERMS_VERSION, sha256, photos ? 1 : 0, now.toISOString()),
  ]);
  return inserted.meta.changes > 0 ? { status: "accepted" } : { status: "refused" };
}

export interface StudentConsent {
  /** The student has a login that is linked to them right now. */
  hasLogin: boolean;
  accepted: boolean;
  /** The acceptance is of the version in force; an older one asks again at the next access. */
  current: boolean;
  photosAuthorized: boolean;
  acceptedAt: string | null;
}

/**
 * The latest acceptance of the login that is linked to a student right now. `null` when the student
 * has no active login; an `acceptance` of `null` when that login has not accepted anything yet. It
 * does not check who is asking: the caller has already established that they may reach the student.
 */
async function studentLoginAcceptance(
  db: D1Database,
  organizationId: string,
  studentId: string,
): Promise<{ loginId: string; acceptance: Acceptance | null } | null> {
  const link = await db
    .prepare(
      `SELECT sa.user_id AS loginId FROM student_access sa
       WHERE sa.organization_id = ?1 AND sa.student_id = ?2 AND sa.revoked_at IS NULL
       ORDER BY sa.created_at DESC LIMIT 1`,
    )
    .bind(organizationId, studentId)
    .first<{ loginId: string }>();
  if (!link) return null;
  return { loginId: link.loginId, acceptance: await latestAcceptance(db, link.loginId, "STUDENT") };
}

const isCurrent = async (acceptance: Acceptance | null) =>
  acceptance !== null && acceptance.version === TERMS_VERSION && acceptance.sha256 === (await termsHash("STUDENT"));

/**
 * What the professional may know about the student's acceptance: that it was made, when, and the
 * photos choice. Only with an active technical assignment over the student; otherwise nothing.
 */
export async function studentConsentFor(
  db: D1Database,
  context: AuthenticatedContext | null,
  studentId: string,
): Promise<StudentConsent | null> {
  const { userId, organizationId } = assertContext(context);
  const reach = await db
    .prepare(
      `SELECT 1 AS ok FROM students s
       WHERE s.organization_id = ?1 AND s.id = ?3 AND ${activeUser("?2")} AND ${technicalAccessExists("s", "?2")}`,
    )
    .bind(organizationId, userId, studentId)
    .first();
  if (!reach) return null;
  const found = await studentLoginAcceptance(db, organizationId, studentId);
  // No linked login: there is no one to have accepted, which is not the same as "refused".
  if (!found) return { hasLogin: false, accepted: false, current: false, photosAuthorized: false, acceptedAt: null };
  return {
    hasLogin: true,
    accepted: found.acceptance !== null,
    current: await isCurrent(found.acceptance),
    photosAuthorized: found.acceptance?.photosAuthorized ?? false,
    acceptedAt: found.acceptance?.acceptedAt ?? null,
  };
}

/**
 * Whether photos of a student may be taken now: their linked login has accepted the terms in force
 * and, in that same latest acceptance, authorized the photos. The professional cannot supply or
 * change this. Like `studentLoginAcceptance`, it does not check who is asking.
 */
export type PhotoAuthorization =
  | { status: "authorized"; acceptanceId: string }
  | { status: "denied"; reason: "NO_LOGIN" | "NOT_ACCEPTED" | "OUTDATED" | "DECLINED" };

export async function photoAuthorizationFor(
  db: D1Database,
  organizationId: string,
  studentId: string,
): Promise<PhotoAuthorization> {
  const found = await studentLoginAcceptance(db, organizationId, studentId);
  if (!found) return { status: "denied", reason: "NO_LOGIN" };
  if (!found.acceptance) return { status: "denied", reason: "NOT_ACCEPTED" };
  if (!(await isCurrent(found.acceptance))) return { status: "denied", reason: "OUTDATED" };
  if (!found.acceptance.photosAuthorized) return { status: "denied", reason: "DECLINED" };
  return { status: "authorized", acceptanceId: found.acceptance.id };
}

/**
 * The same lookup as `photoAuthorizationFor`, as a SQL expression, so that an insert can confirm in
 * the very statement that the acceptance it relies on is still the latest one. The id of the latest
 * acceptance of the login linked to the student; no row when there is none.
 */
export const latestStudentAcceptanceId = (organization: string, student: string) =>
  `(SELECT c.id FROM consent_acceptances c
    WHERE c.audience = 'STUDENT'
      AND c.user_id = (SELECT sa.user_id FROM student_access sa
        WHERE sa.organization_id = ${organization} AND sa.student_id = ${student} AND sa.revoked_at IS NULL
        ORDER BY sa.created_at DESC LIMIT 1)
    ORDER BY c.accepted_at DESC, c.rowid DESC LIMIT 1)`;
