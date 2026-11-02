import type { D1Database } from "@cloudflare/workers-types";
import { slugSchema } from "@/modules/meu-site/contracts";
import { EMPTY_TRACKING, hasTracking, type TrackingSettings } from "@/modules/meu-site/tracking";
import { assertContext, type AuthenticatedContext } from "./students";
import { SITE_READS, SITE_WRITES } from "./sites";

/**
 * The tagging of the site (Meu Site 0.71): public identifiers of GA4, Google Ads and the Meta Pixel, what counts as a conversion and the site's
 * privacy notice. One row per organization, read at each request of a public page (like the switch of the free code), so a change needs no new
 * publication. The owner and the managers write it (with a line in the trail); the commercial members read it. The organization and the person
 * come from the verified session, and each statement repeats the membership, the role and the active login. The public reading has no session
 * and returns only what the page's script needs.
 */
export const SITE_TRACKING_CHANGED = "SITE_TRACKING_CHANGED";

export type TrackingSaveOutcome = { status: "saved"; changed: boolean } | { status: "not_found" };

interface Row {
  ga4: string | null;
  adsId: string | null;
  adsLead: string | null;
  adsContact: string | null;
  meta: string | null;
  value: number | null;
  whatsapp: number;
  form: number;
  email: number;
  instagram: number;
  privacy: string | null;
  updatedAt?: string;
}

const COLUMNS = `t.ga4_id AS ga4, t.ads_id AS adsId, t.ads_label_lead AS adsLead, t.ads_label_contact AS adsContact, t.meta_pixel_id AS meta,
  t.lead_value_cents AS value, t.count_whatsapp AS whatsapp, t.count_form AS form, t.count_email AS email, t.count_instagram AS instagram,
  t.privacy_url AS privacy`;

const settingsOf = (row: Row): TrackingSettings => ({
  ga4Id: row.ga4,
  adsId: row.adsId,
  adsLabelLead: row.adsLead,
  adsLabelContact: row.adsContact,
  metaPixelId: row.meta,
  leadValueCents: row.value,
  count: { whatsapp: row.whatsapp === 1, form: row.form === 1, email: row.email === 1, instagram: row.instagram === 1 },
  privacyUrl: row.privacy,
});

export function siteTrackingFor(db: D1Database, context: AuthenticatedContext | null) {
  const { userId, organizationId } = assertContext(context);
  return {
    /** What the panel shows: the settings (the defaults while nothing was saved) and when they last changed; null when this login may not see the site or there is none. */
    async read(): Promise<{ settings: TrackingSettings; updatedAt: string | null } | null> {
      const site = await db.prepare(`SELECT s.id FROM sites s WHERE s.organization_id = ?1 AND ${SITE_READS}`).bind(organizationId, userId).first<{ id: string }>();
      if (!site) return null;
      const row = await db
        .prepare(`SELECT ${COLUMNS}, t.updated_at AS updatedAt FROM site_tracking t WHERE t.organization_id = ?1 AND ${SITE_READS}`)
        .bind(organizationId, userId)
        .first<Row>();
      return row ? { settings: settingsOf(row), updatedAt: row.updatedAt ?? null } : { settings: EMPTY_TRACKING, updatedAt: null };
    },

    /**
     * Writes the settings (already read by readTracking). Only the owner and the managers, only for an organization that has a site; a line in the
     * trail when something changed, none when the same settings are saved again.
     */
    async save(settings: TrackingSettings, now = new Date()): Promise<TrackingSaveOutcome> {
      const stamp = now.toISOString();
      const values = [
        settings.ga4Id,
        settings.adsId,
        settings.adsLabelLead,
        settings.adsLabelContact,
        settings.metaPixelId,
        settings.leadValueCents,
        settings.count.whatsapp ? 1 : 0,
        settings.count.form ? 1 : 0,
        settings.count.email ? 1 : 0,
        settings.count.instagram ? 1 : 0,
        settings.privacyUrl,
      ];
      const columns = ["ga4_id", "ads_id", "ads_label_lead", "ads_label_contact", "meta_pixel_id", "lead_value_cents", "count_whatsapp", "count_form", "count_email", "count_instagram", "privacy_url"];
      const results = await db.batch([
        db
          .prepare(
            `INSERT INTO site_tracking (organization_id, ${columns.join(", ")}, updated_at, updated_by_user_id)
             SELECT ?1, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?2
             WHERE EXISTS (SELECT 1 FROM sites s WHERE s.organization_id = ?1) AND ${SITE_WRITES}
             ON CONFLICT (organization_id) DO UPDATE SET
               ${columns.map((column) => `${column} = excluded.${column}`).join(", ")}, updated_at = excluded.updated_at, updated_by_user_id = excluded.updated_by_user_id
             WHERE ${columns.map((column) => `site_tracking.${column} IS NOT excluded.${column}`).join(" OR ")}`,
          )
          .bind(organizationId, userId, ...values, stamp),
        db
          .prepare(
            `INSERT INTO access_audit_events (id, organization_id, actor_user_id, action, subject_id, created_at)
             SELECT ?1, ?2, ?3, ?4, s.id, ?5 FROM sites s WHERE s.organization_id = ?2 AND (SELECT changes()) > 0`,
          )
          .bind(crypto.randomUUID(), organizationId, userId, SITE_TRACKING_CHANGED, stamp),
      ]);
      if (results[0]!.meta.changes > 0) return { status: "saved", changed: true };
      // Nothing changed: either it already was so (fine), or this login may not write the site.
      const allowed = await db.prepare(`SELECT 1 AS ok FROM sites s WHERE s.organization_id = ?1 AND ${SITE_WRITES}`).bind(organizationId, userId).first();
      return allowed ? { status: "saved", changed: false } : { status: "not_found" };
    },
  };
}

/**
 * The public reading, for the pages and the script of a site: no session, the settings of the site the address names, and only when at least one
 * tool is on (null otherwise, and for an address that does not exist). Nothing of the organization is returned.
 */
export async function publicTrackingBySlug(db: D1Database, rawSlug: string): Promise<TrackingSettings | null> {
  const slug = slugSchema.safeParse(rawSlug);
  if (!slug.success) return null;
  const row = await db
    .prepare(`SELECT ${COLUMNS} FROM sites s JOIN site_tracking t ON t.organization_id = s.organization_id WHERE s.slug = ?`)
    .bind(slug.data)
    .first<Row>();
  if (!row) return null;
  const settings = settingsOf(row);
  return hasTracking(settings) ? settings : null;
}
