import type { D1Database, R2Bucket, R2ObjectBody } from "@cloudflare/workers-types";
import { referencedAssetIds, safeParseContent } from "@/modules/meu-site/contracts";
import { MAX_ASSETS_PER_SITE, imageObjectKey, sanitizeImage, type ImageCheck, type ImageType } from "@/modules/meu-site/images";
import { sha256HexOfBytes } from "./crypto";
import { SITE_READS, SITE_WRITES } from "./sites";
import { assertContext, type AuthenticatedContext } from "./students";

/**
 * The images of the public page. The bytes are in the private bucket SITE_MEDIA and only this repository and the public
 * route below reach them; the database holds the index. The owner and the managers add and remove, the commercial
 * members read (as for the site itself), and the organization and the person always come from the verified session.
 *
 * Order, when the two stores cannot change together. Adding: the object first, then the row, and the object is
 * removed again if the row is refused. Removing: the row first, then the object, so a failure never leaves a row that
 * points at nothing (it can leave an object nobody points at, which nobody can reach either).
 *
 * An image is public only through `publishedAssetBySlug`: it has to be in the release the page's pointer names. An
 * image that is only in the library, only in a draft, or in a page that was taken offline is served to nobody.
 */
export const SITE_IMAGE_ADDED = "SITE_IMAGE_ADDED";
export const SITE_IMAGE_REMOVED = "SITE_IMAGE_REMOVED";

export interface AssetRow {
  id: string;
  contentType: ImageType;
  bytes: number;
  width: number;
  height: number;
  createdAt: string;
}
export type AddOutcome =
  | { status: "stored"; asset: AssetRow }
  | { status: "invalid"; reason: Extract<ImageCheck, { ok: false }>["reason"] }
  | { status: "unavailable" }
  | { status: "limit" }
  | { status: "forbidden" };
export type RemoveOutcome = { status: "removed" } | { status: "in_draft" } | { status: "published" } | { status: "not_found" };
export interface AssetBody {
  body: ReadableStream;
  contentType: ImageType;
  bytes: number;
  sha256: string;
}

export function siteAssetsFor(db: D1Database, bucket: R2Bucket | null, context: AuthenticatedContext | null) {
  const { userId, organizationId } = assertContext(context);
  const audit = (action: string, subject: string, stamp: string) =>
    db
      .prepare(
        `INSERT INTO access_audit_events (id, organization_id, actor_user_id, action, subject_id, created_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE (SELECT changes()) > 0`,
      )
      .bind(crypto.randomUUID(), organizationId, userId, action, subject, stamp);

  return {
    /** The images of the site, newest first. */
    async list(): Promise<AssetRow[]> {
      const result = await db
        .prepare(
          `SELECT a.id, a.content_type AS contentType, a.bytes, a.width, a.height, a.created_at AS createdAt
           FROM site_assets a JOIN sites s ON s.id = a.site_id
           WHERE s.organization_id = ?1 AND ${SITE_READS} ORDER BY a.created_at DESC, a.id`,
        )
        .bind(organizationId, userId)
        .all<AssetRow>();
      return result.results;
    },

    /** Checks the image, writes it to the storage and indexes it. What is stored is the cleaned file, never the one sent. */
    async add(input: Uint8Array, now = new Date()): Promise<AddOutcome> {
      if (!bucket) return { status: "unavailable" };
      const checked = sanitizeImage(input);
      if (!checked.ok) return { status: "invalid", reason: checked.reason };
      const site = await db
        .prepare(`SELECT s.id FROM sites s WHERE s.organization_id = ?1 AND ${SITE_WRITES}`)
        .bind(organizationId, userId)
        .first<{ id: string }>();
      if (!site) return { status: "forbidden" };
      const total = await db.prepare("SELECT COUNT(*) AS c FROM site_assets WHERE site_id = ?").bind(site.id).first<{ c: number }>();
      if ((total?.c ?? 0) >= MAX_ASSETS_PER_SITE) return { status: "limit" };
      const id = crypto.randomUUID();
      const key = imageObjectKey(organizationId, site.id, checked.type);
      const stamp = now.toISOString();
      await bucket.put(key, checked.bytes, { httpMetadata: { contentType: checked.type } });
      try {
        const results = await db.batch([
          db
            .prepare(
              `INSERT INTO site_assets (id, site_id, object_key, content_type, bytes, width, height, sha256, created_by, created_at)
               SELECT ?3, s.id, ?4, ?5, ?6, ?7, ?8, ?9, ?2, ?10 FROM sites s WHERE s.id = ?11 AND s.organization_id = ?1 AND ${SITE_WRITES}`,
            )
            .bind(organizationId, userId, id, key, checked.type, checked.bytes.length, checked.width, checked.height, await sha256HexOfBytes(checked.bytes), stamp, site.id),
          audit(SITE_IMAGE_ADDED, id, stamp),
        ]);
        if (results[0].meta.changes === 0) {
          await bucket.delete(key).catch(() => undefined);
          return { status: "forbidden" };
        }
      } catch (error) {
        await bucket.delete(key).catch(() => undefined);
        if (/at most 60 images/i.test(String(error))) return { status: "limit" };
        throw error;
      }
      return { status: "stored", asset: { id, contentType: checked.type, bytes: checked.bytes.length, width: checked.width, height: checked.height, createdAt: stamp } };
    },

    /** The image for the editor and the preview: only to a login that reads this organization's site. */
    async read(assetId: string): Promise<AssetBody | null> {
      if (!bucket) return null;
      const row = await db
        .prepare(
          `SELECT a.object_key AS key, a.content_type AS contentType, a.bytes, a.sha256
           FROM site_assets a JOIN sites s ON s.id = a.site_id
           WHERE a.id = ?3 AND s.organization_id = ?1 AND ${SITE_READS}`,
        )
        .bind(organizationId, userId, assetId)
        .first<{ key: string; contentType: ImageType; bytes: number; sha256: string }>();
      if (!row) return null;
      const object = (await bucket.get(row.key)) as R2ObjectBody | null;
      return object ? { body: object.body as unknown as ReadableStream, contentType: row.contentType, bytes: row.bytes, sha256: row.sha256 } : null;
    },

    /**
     * Takes an image out of the library. Not while the draft uses it, and never once a published version used it (that
     * version is immutable and keeps showing it).
     */
    async remove(assetId: string, now = new Date()): Promise<RemoveOutcome> {
      const row = await db
        .prepare(
          `SELECT a.object_key AS key, a.site_id AS siteId FROM site_assets a JOIN sites s ON s.id = a.site_id
           WHERE a.id = ?3 AND s.organization_id = ?1 AND ${SITE_WRITES}`,
        )
        .bind(organizationId, userId, assetId)
        .first<{ key: string; siteId: string }>();
      if (!row) return { status: "not_found" };
      const draft = await db.prepare("SELECT content FROM site_drafts WHERE site_id = ?").bind(row.siteId).first<{ content: string }>();
      if (draft) {
        let raw: unknown = null;
        try {
          raw = JSON.parse(draft.content);
        } catch {
          raw = null;
        }
        const parsed = safeParseContent(raw);
        if (parsed.success && referencedAssetIds(parsed.data).includes(assetId)) return { status: "in_draft" };
      }
      const stamp = now.toISOString();
      try {
        const results = await db.batch([
          db
            .prepare(
              `DELETE FROM site_assets WHERE id = ?3 AND site_id = ?4
                 AND EXISTS (SELECT 1 FROM sites s WHERE s.id = ?4 AND s.organization_id = ?1 AND ${SITE_WRITES})`,
            )
            .bind(organizationId, userId, assetId, row.siteId),
          audit(SITE_IMAGE_REMOVED, assetId, stamp),
        ]);
        if (results[0].meta.changes === 0) return { status: "not_found" };
      } catch (error) {
        if (/published version|FOREIGN KEY/i.test(String(error))) return { status: "published" };
        throw error;
      }
      if (bucket) await bucket.delete(row.key).catch(() => undefined);
      return { status: "removed" };
    },
  };
}

/**
 * The public reading of one image: no session, and only if the release that the page's pointer names uses it, or if it was sent from
 * the new editor (builder-files.ts) to this site's organization. An unknown address, a malformed identifier, an image that is only in
 * the library or in a draft, one of a page that was taken offline, and one of another site all answer the same (null).
 */
export async function publishedAssetBySlug(db: D1Database, bucket: R2Bucket | null, slug: string, assetId: string): Promise<AssetBody | null> {
  if (!bucket || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$/.test(slug) || !/^[0-9a-f-]{36}$/.test(assetId)) return null;
  const row = await db
    .prepare(
      `SELECT a.object_key AS key, a.content_type AS contentType, a.bytes, a.sha256
       FROM sites s
       JOIN site_published p ON p.site_id = s.id
       JOIN site_release_assets ra ON ra.site_id = s.id AND ra.release_id = p.release_id
       JOIN site_assets a ON a.site_id = ra.site_id AND a.id = ra.asset_id
       WHERE s.slug = ? AND a.id = ?`,
    )
    .bind(slug, assetId)
    .first<{ key: string; contentType: ImageType; bytes: number; sha256: string }>();
  // Not an image of a version of the first editor: one sent from the new editor (public by its address; see migration 0028).
  const found =
    row ??
    (await db
      .prepare(
        `SELECT f.object_key AS key, f.content_type AS contentType, f.bytes, f.sha256
         FROM sites s JOIN builder_files f ON f.organization_id = s.organization_id
         WHERE s.slug = ? AND f.id = ?`,
      )
      .bind(slug, assetId)
      .first<{ key: string; contentType: ImageType; bytes: number; sha256: string }>());
  if (!found) return null;
  const object = (await bucket.get(found.key)) as R2ObjectBody | null;
  return object ? { body: object.body as unknown as ReadableStream, contentType: found.contentType, bytes: found.bytes, sha256: found.sha256 } : null;
}
