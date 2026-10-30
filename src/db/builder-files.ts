import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { IMAGE_EXTENSION, sanitizeImage, type ImageCheck, type ImageType } from "@/modules/meu-site/images";
import { sha256HexOfBytes } from "./crypto";
import { SITE_WRITES } from "./sites";
import { assertContext, type AuthenticatedContext } from "./students";

/**
 * The images a person sends from the embedded editor (migration 0028). The bytes go to the private bucket SITE_MEDIA under the organization's
 * own key and the database holds the index; the public route (`publishedAssetBySlug`) is the only way out. What is stored is the file cleaned
 * by the same check as the images of the first editor (JPEG or PNG, no metadata, no chunk or segment that can carry text or a position), never
 * the file that was sent. Only the owner and the managers add; the organization and the person come from the verified session, and the
 * statement repeats the membership, the role and the active login.
 *
 * Order, when the two stores cannot change together: the object first, then the row, and the object is removed again if the row is refused.
 */
export const SITE_FILE_ADDED = "SITE_FILE_ADDED";
export const MAX_FILES_PER_ORGANIZATION = 300;

export interface FileRow {
  id: string;
  fileName: string;
  contentType: ImageType;
  bytes: number;
  width: number;
  height: number;
  createdAt: string;
}
export type AddFileOutcome =
  | { status: "stored"; file: FileRow }
  | { status: "invalid"; reason: Extract<ImageCheck, { ok: false }>["reason"] }
  | { status: "unavailable" }
  | { status: "limit" }
  | { status: "forbidden" };

/** The name of a file as the editor shows it: the last part of what the browser sent, with nothing that is not a letter, digit or one of `._ -`. */
export function cleanFileName(raw: string, type: ImageType): string {
  const last = raw.split(/[\\/]/).pop() ?? "";
  const base = last.replace(/[^\p{L}\p{N}._ -]+/gu, "").replace(/\s+/g, " ").trim().slice(0, 150);
  const name = base && base !== "." && base !== ".." ? base : "imagem";
  return /\.(jpe?g|png)$/i.test(name) ? name : `${name}.${IMAGE_EXTENSION[type]}`;
}

export function builderFilesFor(db: D1Database, bucket: R2Bucket | null, context: AuthenticatedContext | null) {
  const { userId, organizationId } = assertContext(context);
  const writes = SITE_WRITES;
  return {
    async add(input: Uint8Array, rawName: string, now = new Date()): Promise<AddFileOutcome> {
      if (!bucket) return { status: "unavailable" };
      const checked = sanitizeImage(input);
      if (!checked.ok) return { status: "invalid", reason: checked.reason };
      const allowed = await db.prepare(`SELECT 1 AS ok WHERE ${writes}`).bind(organizationId, userId).first();
      if (!allowed) return { status: "forbidden" };
      const total = await db.prepare("SELECT COUNT(*) AS c FROM builder_files WHERE organization_id = ?").bind(organizationId).first<{ c: number }>();
      if ((total?.c ?? 0) >= MAX_FILES_PER_ORGANIZATION) return { status: "limit" };
      const id = crypto.randomUUID();
      const key = `sites/${organizationId}/editor/${crypto.randomUUID()}.${IMAGE_EXTENSION[checked.type]}`;
      const name = cleanFileName(rawName, checked.type);
      const stamp = now.toISOString();
      await bucket.put(key, checked.bytes, { httpMetadata: { contentType: checked.type } });
      try {
        const results = await db.batch([
          db
            .prepare(
              `INSERT INTO builder_files (organization_id, id, object_key, file_name, content_type, bytes, width, height, sha256, created_by, created_at)
               SELECT ?1, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?2, ?11 WHERE ${writes}`,
            )
            .bind(organizationId, userId, id, key, name, checked.type, checked.bytes.length, checked.width, checked.height, await sha256HexOfBytes(checked.bytes), stamp),
          db
            .prepare(
              `INSERT INTO access_audit_events (id, organization_id, actor_user_id, action, subject_id, created_at)
               SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE (SELECT changes()) > 0`,
            )
            .bind(crypto.randomUUID(), organizationId, userId, SITE_FILE_ADDED, id, stamp),
        ]);
        if (results[0]!.meta.changes === 0) {
          await bucket.delete(key).catch(() => undefined);
          return { status: "forbidden" };
        }
      } catch (error) {
        await bucket.delete(key).catch(() => undefined);
        if (/at most 300 files/i.test(String(error))) return { status: "limit" };
        throw error;
      }
      return { status: "stored", file: { id, fileName: name, contentType: checked.type, bytes: checked.bytes.length, width: checked.width, height: checked.height, createdAt: stamp } };
    },
  };
}
