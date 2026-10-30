import type { D1Database } from "@cloudflare/workers-types";
import {
  INQUIRIES_PER_SENDER_PER_HOUR,
  INQUIRIES_PER_SITE_PER_HOUR,
  INQUIRIES_WAITING_MAX,
  contactKeys,
  type InquiryValue,
} from "@/modules/meu-site/inquiries";
import { slugSchema } from "@/modules/meu-site/contracts";
import { activeUser, assertContext, type AuthenticatedContext } from "./students";

/**
 * The messages visitors leave in the contact form of the public page, waiting for the professional.
 *
 * Two doors, kept apart on purpose. The public one (`receiveInquiry`) has no session: the organization comes from the site the address names, never from
 * anything the visitor sent, and it writes only if that site has been opened for messages and is published. The other one (`siteInquiriesFor`) is
 * the organization's own, for those who work the leads (owner, manager, commercial): it reads, turns one into a lead, or discards it. Either way the
 * row is deleted: the person's data is kept in a lead only because someone of the organization chose to, and nowhere otherwise.
 */
export const INQUIRY_CONVERTED = "SITE_INQUIRY_CONVERTED";
export const INQUIRY_DISCARDED = "SITE_INQUIRY_DISCARDED";

export interface InquiryRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  message: string | null;
  page: string;
  createdAt: string;
  /** How many leads of the organization already have this e-mail or this number. */
  sameContact: number;
}
export type ReceiveOutcome = { status: "received" } | { status: "closed" } | { status: "limited" };
export type ConvertInquiryOutcome = { status: "converted"; leadId: string } | { status: "not_found" };
export type DiscardInquiryOutcome = { status: "discarded" } | { status: "not_found" };

const HOUR_MS = 60 * 60 * 1000;

/**
 * A site is public when it has a published version of the first editor, or a published page of the new one (the same pages the public route of
 * the new editor answers: published, and not a dynamic route). `s` is the sites row.
 */
const PUBLIC_SITE = `(EXISTS (SELECT 1 FROM site_published p WHERE p.site_id = s.id)
  OR EXISTS (SELECT 1 FROM builder_docs b WHERE b.organization_id = s.organization_id AND b.doctype = 'Builder Page'
    AND json_extract(b.data, '$.published') = 1 AND COALESCE(json_extract(b.data, '$.dynamic_route'), 0) = 0))`;

/**
 * The public door. `sender` is the keyed hash of the sender's address (or null where there is no address to hash): it is only counted, and emptied
 * after the hour the count looks at. One statement decides everything (open, published, room in the inbox, the two limits) and writes, so two requests
 * at once cannot both pass a limit.
 */
export async function receiveInquiry(
  db: D1Database,
  input: { slug: string; value: InquiryValue; noticeUrl: string; sender: string | null },
  now = new Date(),
): Promise<ReceiveOutcome> {
  const slug = slugSchema.safeParse(input.slug);
  if (!slug.success) return { status: "closed" };
  const keys = contactKeys(input.value);
  const stamp = now.toISOString();
  const sinceHour = new Date(now.getTime() - HOUR_MS).toISOString();
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO site_inquiries (id, organization_id, site_id, page, name, email, phone, email_key, phone_key, message, notice_url, ip_key, created_at)
         SELECT ?1, s.organization_id, s.id, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11
         FROM sites s
         WHERE s.slug = ?12 AND s.inquiries_open = 1
           AND ${PUBLIC_SITE}
           AND (SELECT COUNT(*) FROM site_inquiries q WHERE q.site_id = s.id) < ?13
           AND (SELECT COUNT(*) FROM site_inquiries q WHERE q.site_id = s.id AND q.created_at > ?14) < ?15
           AND (?10 IS NULL OR (SELECT COUNT(*) FROM site_inquiries q WHERE q.site_id = s.id AND q.ip_key = ?10 AND q.created_at > ?14) < ?16)`,
      )
      .bind(
        crypto.randomUUID(),
        input.value.page,
        input.value.name,
        input.value.email,
        input.value.phone,
        keys.emailKey,
        keys.phoneKey,
        input.value.message,
        input.noticeUrl,
        input.sender,
        stamp,
        slug.data,
        INQUIRIES_WAITING_MAX,
        sinceHour,
        INQUIRIES_PER_SITE_PER_HOUR,
        INQUIRIES_PER_SENDER_PER_HOUR,
      ),
    // The address hash is only for the hour it is counted over.
    db
      .prepare(`UPDATE site_inquiries SET ip_key = NULL WHERE ip_key IS NOT NULL AND created_at <= ?1 AND site_id = (SELECT id FROM sites WHERE slug = ?2)`)
      .bind(sinceHour, slug.data),
  ]);
  if (results[0].meta.changes > 0) return { status: "received" };
  // Nothing was written: say whether the form is closed (or the site is not public) or the limits were reached.
  const open = await db
    .prepare(`SELECT 1 AS ok FROM sites s WHERE s.slug = ?1 AND s.inquiries_open = 1 AND ${PUBLIC_SITE}`)
    .bind(slug.data)
    .first();
  return open ? { status: "limited" } : { status: "closed" };
}

/** The organization's door: whoever works the leads sees the messages of their own site. */
export function siteInquiriesFor(db: D1Database, context: AuthenticatedContext | null) {
  const { userId, organizationId } = assertContext(context);
  // ?1 organization, ?2 acting login. The same people as the leads: owner, manager and commercial.
  const worksLeads = `EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = ?1 AND m.user_id = ?2
    AND m.revoked_at IS NULL AND m.role IN ('OWNER','MANAGER','COMMERCIAL')) AND ${activeUser("?2")}`;

  return {
    async list(): Promise<InquiryRow[]> {
      const result = await db
        .prepare(
          `SELECT i.id, i.name, i.email, i.phone, i.message, i.page, i.created_at AS createdAt,
             (SELECT COUNT(*) FROM leads l WHERE l.organization_id = i.organization_id
                AND ((i.email_key IS NOT NULL AND l.email_key = i.email_key) OR (i.phone_key IS NOT NULL AND l.phone_key = i.phone_key))) AS sameContact
           FROM site_inquiries i
           WHERE i.organization_id = ?1 AND ${worksLeads}
           ORDER BY i.created_at DESC, i.id LIMIT 200`,
        )
        .bind(organizationId, userId)
        .all<InquiryRow>();
      return result.results;
    },

    async count(): Promise<number> {
      const row = await db
        .prepare(`SELECT COUNT(*) AS total FROM site_inquiries i WHERE i.organization_id = ?1 AND ${worksLeads}`)
        .bind(organizationId, userId)
        .first<{ total: number }>();
      return row?.total ?? 0;
    },

    /**
     * Turns the message into a lead of the site's origin, with what the person wrote as the first note, and deletes it, in one batch: a second attempt (a
     * double click, two tabs) finds nothing and creates nothing.
     */
    async convert(inquiryId: string, now = new Date()): Promise<ConvertInquiryOutcome> {
      const leadId = crypto.randomUUID();
      const stamp = now.toISOString();
      const results = await db.batch([
        db
          .prepare(
            `INSERT INTO leads (id, organization_id, name, email, phone, email_key, phone_key, source, service_id, created_by, created_at, updated_at)
             SELECT ?3, i.organization_id, i.name, i.email, i.phone, i.email_key, i.phone_key, 'SITE', NULL, ?2, ?4, ?4
             FROM site_inquiries i WHERE i.organization_id = ?1 AND i.id = ?5 AND ${worksLeads}`,
          )
          .bind(organizationId, userId, leadId, stamp, inquiryId),
        db
          .prepare(
            `INSERT INTO lead_events (id, organization_id, lead_id, kind, note, actor_user_id, created_at)
             SELECT ?6, ?1, ?3, 'CREATED', (SELECT i.message FROM site_inquiries i WHERE i.organization_id = ?1 AND i.id = ?5), ?2, ?4
             WHERE (SELECT changes()) > 0`,
          )
          .bind(organizationId, userId, leadId, stamp, inquiryId, crypto.randomUUID()),
        db
          .prepare(
            `DELETE FROM site_inquiries WHERE organization_id = ?1 AND id = ?5
               AND EXISTS (SELECT 1 FROM leads l WHERE l.organization_id = ?1 AND l.id = ?3)`,
          )
          .bind(organizationId, userId, leadId, stamp, inquiryId),
        db
          .prepare(
            `INSERT INTO access_audit_events (id, organization_id, actor_user_id, action, subject_id, created_at)
             SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE (SELECT changes()) > 0`,
          )
          .bind(crypto.randomUUID(), organizationId, userId, INQUIRY_CONVERTED, leadId, stamp),
      ]);
      return results[0].meta.changes > 0 ? { status: "converted", leadId } : { status: "not_found" };
    },

    /** Deletes the message: what the person wrote is not kept anywhere else. */
    async discard(inquiryId: string, now = new Date()): Promise<DiscardInquiryOutcome> {
      const stamp = now.toISOString();
      const results = await db.batch([
        db
          .prepare(`DELETE FROM site_inquiries WHERE organization_id = ?1 AND id = ?3 AND ${worksLeads}`)
          .bind(organizationId, userId, inquiryId),
        db
          .prepare(
            `INSERT INTO access_audit_events (id, organization_id, actor_user_id, action, subject_id, created_at)
             SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE (SELECT changes()) > 0`,
          )
          .bind(crypto.randomUUID(), organizationId, userId, INQUIRY_DISCARDED, inquiryId, stamp),
      ]);
      return results[0].meta.changes > 0 ? { status: "discarded" } : { status: "not_found" };
    },
  };
}
