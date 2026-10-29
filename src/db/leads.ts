import type { D1Database } from "@cloudflare/workers-types";
import {
  emailKey,
  leadEdit,
  leadInput,
  noteInput,
  phoneKey,
  stageMove,
  type LeadSource,
  type LeadStage,
  type LostReason,
} from "@/modules/leads/contracts";
import { activeUser, assertContext, technicalAccessExists, type AuthenticatedContext } from "./students";

/**
 * Leads: people interested in a service who are not students yet. Owner, manager and commercial members
 * of the organization read and work them; a technical member does not (needs-to-know), and a lead never
 * gives access to a student's record. The organization and the person come from the verified session; each
 * statement repeats the membership and the active login, so a revocation or a block between the read and the
 * write is refused by the statement itself. A lead holds no health data.
 *
 * Converting a won lead into a student is its own act, done by someone who can create students (an owner or a
 * manager with a professional record) or by linking a student they already look after. It is idempotent: a
 * second attempt finds the lead already converted and creates nothing. A converted lead is frozen.
 */
export const LEAD_DELETED = "LEAD_DELETED";

export interface LeadRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  source: LeadSource;
  stage: LeadStage;
  lostReason: LostReason | null;
  serviceId: string | null;
  serviceName: string | null;
  studentId: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface LeadEventRow {
  id: string;
  kind: "CREATED" | "STAGE" | "NOTE" | "EDITED" | "CONVERTED";
  fromStage: LeadStage | null;
  toStage: LeadStage | null;
  lostReason: LostReason | null;
  note: string | null;
  actorName: string | null;
  createdAt: string;
}
export interface LeadMatch {
  id: string;
  name: string;
  stage: LeadStage;
}
export interface StudentMatch {
  id: string;
  displayName: string;
  reasons: Array<"email" | "phone" | "name">;
}

export type CreateOutcome =
  | { status: "created"; id: string }
  | { status: "duplicates"; matches: LeadMatch[] }
  | { status: "invalid_service" }
  | { status: "forbidden" };
export type EditOutcome =
  | { status: "saved" }
  | { status: "converted" }
  | { status: "invalid_service" }
  | { status: "not_found" };
export type MoveOutcome =
  | { status: "moved" }
  | { status: "unchanged" }
  | { status: "conflict"; current: LeadStage }
  | { status: "converted" }
  | { status: "not_found" };
export type ConvertOutcome =
  | { status: "converted"; studentId: string }
  | { status: "already"; studentId: string }
  | { status: "not_won" }
  | { status: "forbidden" }
  | { status: "student_taken" }
  | { status: "not_found" };
export type ConvertHow = { mode: "create" } | { mode: "link"; studentId: string };

export function leadsFor(db: D1Database, context: AuthenticatedContext | null) {
  const { userId, organizationId } = assertContext(context);
  // ?1 organization, ?2 acting login. Reading and working a lead; deleting one is for owner and manager.
  const worksLeads = `EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = ?1 AND m.user_id = ?2
    AND m.revoked_at IS NULL AND m.role IN ('OWNER','MANAGER','COMMERCIAL')) AND ${activeUser("?2")}`;
  const managesLeads = `EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = ?1 AND m.user_id = ?2
    AND m.revoked_at IS NULL AND m.role IN ('OWNER','MANAGER')) AND ${activeUser("?2")}`;
  const activeService = (service: string) =>
    `EXISTS (SELECT 1 FROM service_offerings sv WHERE sv.organization_id = ?1 AND sv.id = ${service} AND sv.active = 1)`;

  const select = `SELECT l.id, l.name, l.email, l.phone, l.source, l.stage, l.lost_reason AS lostReason,
      l.service_id AS serviceId, sv.name AS serviceName, l.student_id AS studentId,
      l.created_at AS createdAt, l.updated_at AS updatedAt
    FROM leads l LEFT JOIN service_offerings sv ON sv.organization_id = l.organization_id AND sv.id = l.service_id`;

  async function one(leadId: string): Promise<LeadRow | null> {
    return db
      .prepare(`${select} WHERE l.organization_id = ?1 AND l.id = ?3 AND ${worksLeads}`)
      .bind(organizationId, userId, leadId)
      .first<LeadRow>();
  }

  async function duplicatesOf(email: string | null, phone: string | null, exceptId: string | null): Promise<LeadMatch[]> {
    if (!email && !phone) return [];
    const result = await db
      .prepare(
        `SELECT l.id, l.name, l.stage FROM leads l
         WHERE l.organization_id = ?1 AND ${worksLeads}
           AND ((?3 IS NOT NULL AND l.email_key = ?3) OR (?4 IS NOT NULL AND l.phone_key = ?4))
           AND (?5 IS NULL OR l.id <> ?5)
         ORDER BY l.created_at DESC, l.id LIMIT 5`,
      )
      .bind(organizationId, userId, email, phone, exceptId)
      .all<LeadMatch>();
    return result.results;
  }

  async function serviceIsOffered(serviceId: string | undefined): Promise<boolean> {
    if (!serviceId) return true;
    const row = await db
      .prepare(`SELECT 1 AS ok WHERE ${activeService("?3")}`)
      .bind(organizationId, userId, serviceId)
      .first();
    return Boolean(row);
  }

  return {
    async list(stage: LeadStage | null = null): Promise<LeadRow[]> {
      const result = await db
        .prepare(
          `${select} WHERE l.organization_id = ?1 AND ${worksLeads} AND (?3 IS NULL OR l.stage = ?3)
           ORDER BY l.updated_at DESC, l.id LIMIT 300`,
        )
        .bind(organizationId, userId, stage)
        .all<LeadRow>();
      return result.results;
    },

    async counts(): Promise<Record<LeadStage, number>> {
      const result = await db
        .prepare(
          `SELECT l.stage, COUNT(*) AS total FROM leads l
           WHERE l.organization_id = ?1 AND ${worksLeads} GROUP BY l.stage`,
        )
        .bind(organizationId, userId)
        .all<{ stage: LeadStage; total: number }>();
      const counts = { NEW: 0, CONTACT: 0, ASSESSMENT: 0, PROPOSAL: 0, WON: 0, LOST: 0 } as Record<LeadStage, number>;
      for (const row of result.results) counts[row.stage] = row.total;
      return counts;
    },

    find: one,

    async timeline(leadId: string): Promise<LeadEventRow[]> {
      const result = await db
        .prepare(
          `SELECT e.id, e.kind, e.from_stage AS fromStage, e.to_stage AS toStage, e.lost_reason AS lostReason,
                  e.note, au.name AS actorName, e.created_at AS createdAt
           FROM lead_events e LEFT JOIN auth_user au ON au.id = e.actor_user_id
           WHERE e.organization_id = ?1 AND e.lead_id = ?3 AND ${worksLeads}
           ORDER BY e.created_at DESC, e.id LIMIT 200`,
        )
        .bind(organizationId, userId, leadId)
        .all<LeadEventRow>();
      return result.results;
    },

    /** People already in the list with the same address or number. Used before saving, to ask. */
    async duplicatesFor(raw: { email?: string; phone?: string }, exceptId: string | null = null): Promise<LeadMatch[]> {
      return duplicatesOf(
        raw.email ? emailKey(raw.email) : null,
        raw.phone ? phoneKey(raw.phone) : null,
        exceptId,
      );
    },

    async create(raw: unknown, options: { confirmDuplicates?: boolean } = {}, now = new Date()): Promise<CreateOutcome> {
      const input = leadInput.parse(raw);
      const email = input.email ? emailKey(input.email) : null;
      const phone = input.phone ? phoneKey(input.phone) : null;
      if (!options.confirmDuplicates) {
        const matches = await duplicatesOf(email, phone, null);
        if (matches.length > 0) return { status: "duplicates", matches };
      }
      if (!(await serviceIsOffered(input.serviceId))) return { status: "invalid_service" };
      const id = crypto.randomUUID();
      const stamp = now.toISOString();
      const results = await db.batch([
        db
          .prepare(
            `INSERT INTO leads (id, organization_id, name, email, phone, email_key, phone_key, source, service_id,
                                created_by, created_at, updated_at)
             SELECT ?3, ?1, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?2, ?11, ?11
             WHERE ${worksLeads} AND (?10 IS NULL OR ${activeService("?10")})`,
          )
          .bind(organizationId, userId, id, input.name, input.email ?? null, input.phone ?? null, email, phone, input.source, input.serviceId ?? null, stamp),
        db
          .prepare(
            `INSERT INTO lead_events (id, organization_id, lead_id, kind, note, actor_user_id, created_at)
             SELECT ?1, ?2, ?3, 'CREATED', ?4, ?5, ?6 WHERE (SELECT changes()) > 0`,
          )
          .bind(crypto.randomUUID(), organizationId, id, input.note ?? null, userId, stamp),
      ]);
      return results[0].meta.changes > 0 ? { status: "created", id } : { status: "forbidden" };
    },

    async update(leadId: string, raw: unknown, now = new Date()): Promise<EditOutcome> {
      const input = leadEdit.parse(raw);
      if (!(await serviceIsOffered(input.serviceId))) {
        // Keeping the service the lead already has is fine even if it is inactive now.
        const current = await one(leadId);
        if (!current || current.serviceId !== input.serviceId) return { status: "invalid_service" };
      }
      const stamp = now.toISOString();
      const results = await db.batch([
        db
          .prepare(
            `UPDATE leads SET name = ?4, email = ?5, phone = ?6, email_key = ?7, phone_key = ?8, source = ?9,
                              service_id = ?10, updated_at = ?11
             WHERE organization_id = ?1 AND id = ?3 AND student_id IS NULL AND ${worksLeads}
               AND (?9 <> 'SITE' OR source = 'SITE')
               AND (?10 IS NULL OR ?10 = service_id OR ${activeService("?10")})`,
          )
          .bind(
            organizationId,
            userId,
            leadId,
            input.name,
            input.email ?? null,
            input.phone ?? null,
            input.email ? emailKey(input.email) : null,
            input.phone ? phoneKey(input.phone) : null,
            input.source,
            input.serviceId ?? null,
            stamp,
          ),
        db
          .prepare(
            `INSERT INTO lead_events (id, organization_id, lead_id, kind, actor_user_id, created_at)
             SELECT ?1, ?2, ?3, 'EDITED', ?4, ?5 WHERE (SELECT changes()) > 0`,
          )
          .bind(crypto.randomUUID(), organizationId, leadId, userId, stamp),
      ]);
      if (results[0].meta.changes > 0) return { status: "saved" };
      const row = await one(leadId);
      if (!row) return { status: "not_found" };
      return row.studentId ? { status: "converted" } : { status: "not_found" };
    },

    /**
     * Moves the lead from the stage the person saw to another. If someone else moved it in the meantime the
     * statement finds a different stage and changes nothing.
     */
    async moveTo(leadId: string, from: LeadStage, raw: unknown, now = new Date()): Promise<MoveOutcome> {
      const move = stageMove.parse(raw);
      const stamp = now.toISOString();
      const results = await db.batch([
        db
          .prepare(
            `UPDATE leads SET stage = ?4, lost_reason = ?5, updated_at = ?6
             WHERE organization_id = ?1 AND id = ?3 AND stage = ?7 AND ?4 <> ?7 AND student_id IS NULL AND ${worksLeads}`,
          )
          .bind(organizationId, userId, leadId, move.to, move.lostReason ?? null, stamp, from),
        db
          .prepare(
            `INSERT INTO lead_events (id, organization_id, lead_id, kind, from_stage, to_stage, lost_reason, note, actor_user_id, created_at)
             SELECT ?1, ?2, ?3, 'STAGE', ?4, ?5, ?6, ?7, ?8, ?9 WHERE (SELECT changes()) > 0`,
          )
          .bind(crypto.randomUUID(), organizationId, leadId, from, move.to, move.lostReason ?? null, move.note ?? null, userId, stamp),
      ]);
      if (results[0].meta.changes > 0) return { status: "moved" };
      const row = await one(leadId);
      if (!row) return { status: "not_found" };
      if (row.studentId) return { status: "converted" };
      if (row.stage !== from) return { status: "conflict", current: row.stage };
      return { status: "unchanged" };
    },

    async addNote(leadId: string, raw: unknown, now = new Date()): Promise<boolean> {
      const { note } = noteInput.parse(raw);
      const stamp = now.toISOString();
      const results = await db.batch([
        db
          .prepare(
            `INSERT INTO lead_events (id, organization_id, lead_id, kind, note, actor_user_id, created_at)
             SELECT ?4, ?1, l.id, 'NOTE', ?5, ?2, ?6 FROM leads l
             WHERE l.organization_id = ?1 AND l.id = ?3 AND ${worksLeads}`,
          )
          .bind(organizationId, userId, leadId, crypto.randomUUID(), note, stamp),
        // A note is activity: the lead goes up the list. A converted lead is frozen and stays where it is.
        db
          .prepare(
            `UPDATE leads SET updated_at = ?4
             WHERE organization_id = ?1 AND id = ?3 AND student_id IS NULL AND ${worksLeads}`,
          )
          .bind(organizationId, userId, leadId, stamp),
      ]);
      return results[0].meta.changes > 0;
    },

    /** Deleting is for owner and manager, and only a lead that did not become a student. Leaves a line, with no name. */
    async remove(leadId: string, now = new Date()): Promise<boolean> {
      const results = await db.batch([
        db
          .prepare(
            `DELETE FROM leads WHERE organization_id = ?1 AND id = ?3 AND student_id IS NULL AND ${managesLeads}`,
          )
          .bind(organizationId, userId, leadId),
        db
          .prepare(
            `INSERT INTO access_audit_events (id, organization_id, actor_user_id, action, subject_id, created_at)
             SELECT ?1, ?2, ?3, '${LEAD_DELETED}', ?4, ?5 WHERE (SELECT changes()) > 0`,
          )
          .bind(crypto.randomUUID(), organizationId, userId, leadId, now.toISOString()),
      ]);
      return results[0].meta.changes > 0;
    },

    /** Students this person already looks after that look like the lead: same e-mail, same phone or same name. */
    async studentMatches(leadId: string): Promise<StudentMatch[]> {
      const lead = await one(leadId);
      if (!lead || lead.studentId) return [];
      const leadEmail = lead.email ? emailKey(lead.email) : null;
      const leadPhone = lead.phone ? phoneKey(lead.phone) : null;
      const result = await db
        .prepare(
          `SELECT s.id, s.display_name AS displayName, sp.email, sp.phone
           FROM students s LEFT JOIN student_profiles sp ON sp.organization_id = s.organization_id AND sp.student_id = s.id
           WHERE s.organization_id = ?1 AND ${technicalAccessExists("s", "?2")}
             AND NOT EXISTS (SELECT 1 FROM leads o WHERE o.organization_id = s.organization_id AND o.student_id = s.id)
           ORDER BY s.display_name, s.id LIMIT 500`,
        )
        .bind(organizationId, userId)
        .all<{ id: string; displayName: string; email: string | null; phone: string | null }>();
      const matches: StudentMatch[] = [];
      for (const student of result.results) {
        const reasons: StudentMatch["reasons"] = [];
        if (leadEmail && student.email && emailKey(student.email) === leadEmail) reasons.push("email");
        if (leadPhone && student.phone && phoneKey(student.phone) === leadPhone) reasons.push("phone");
        if (student.displayName.trim().toLowerCase() === lead.name.trim().toLowerCase()) reasons.push("name");
        if (reasons.length > 0) matches.push({ id: student.id, displayName: student.displayName, reasons });
      }
      return matches;
    },

    /**
     * Turns a won lead into a student: creates one (as "Novo aluno" does) or links one the person already looks
     * after. Everything happens in one batch; a second call finds the lead converted and creates nothing.
     */
    async convert(leadId: string, how: ConvertHow, now = new Date()): Promise<ConvertOutcome> {
      const lead = await one(leadId);
      if (!lead) return { status: "not_found" };
      if (lead.studentId) return { status: "already", studentId: lead.studentId };
      if (lead.stage !== "WON") return { status: "not_won" };
      const stamp = now.toISOString();
      const unconvertedWon = `EXISTS (SELECT 1 FROM leads wl WHERE wl.organization_id = ?1 AND wl.id = ?3
        AND wl.stage = 'WON' AND wl.student_id IS NULL)`;

      if (how.mode === "link") {
        const taken = await db
          .prepare("SELECT 1 AS ok FROM leads WHERE organization_id = ? AND student_id = ?")
          .bind(organizationId, how.studentId)
          .first();
        if (taken) return { status: "student_taken" };
        try {
          const results = await db.batch([
            db
              .prepare(
                `UPDATE leads SET student_id = ?4, updated_at = ?5
                 WHERE organization_id = ?1 AND id = ?3 AND stage = 'WON' AND student_id IS NULL AND ${worksLeads}
                   AND EXISTS (SELECT 1 FROM students s WHERE s.organization_id = ?1 AND s.id = ?4 AND ${technicalAccessExists("s", "?2")})`,
              )
              .bind(organizationId, userId, leadId, how.studentId, stamp),
            db
              .prepare(
                `INSERT INTO lead_events (id, organization_id, lead_id, kind, actor_user_id, created_at)
                 SELECT ?1, ?2, ?3, 'CONVERTED', ?4, ?5 WHERE (SELECT changes()) > 0`,
              )
              .bind(crypto.randomUUID(), organizationId, leadId, userId, stamp),
          ]);
          if (results[0].meta.changes > 0) return { status: "converted", studentId: how.studentId };
        } catch (error) {
          // Two leads for one student would break the attribution: the index refuses it.
          if (/UNIQUE/i.test(String(error))) return { status: "student_taken" };
          throw error;
        }
      } else {
        const studentId = crypto.randomUUID();
        const results = await db.batch([
          // The same rule as "Novo aluno": a professional of the organization with a role that cares for students.
          db
            .prepare(
              `INSERT INTO students (id, organization_id, display_name)
               SELECT ?4, p.organization_id, ?5 FROM professionals p
               JOIN memberships m ON m.user_id = p.user_id AND m.organization_id = p.organization_id
               WHERE p.user_id = ?2 AND p.organization_id = ?1 AND ${activeUser("?2")}
                 AND m.revoked_at IS NULL AND m.role IN ('OWNER','MANAGER','TECHNICAL')
                 AND ${worksLeads} AND ${unconvertedWon}`,
            )
            .bind(organizationId, userId, leadId, studentId, lead.name),
          db
            .prepare(
              `INSERT INTO care_assignments (organization_id, student_id, professional_id)
               SELECT s.organization_id, s.id, p.id FROM students s
               JOIN professionals p ON p.organization_id = s.organization_id
               WHERE s.id = ?1 AND p.user_id = ?2`,
            )
            .bind(studentId, userId),
          db
            .prepare(
              `UPDATE leads SET student_id = ?4, updated_at = ?5
               WHERE organization_id = ?1 AND id = ?3 AND stage = 'WON' AND student_id IS NULL AND ${worksLeads}
                 AND EXISTS (SELECT 1 FROM students s WHERE s.organization_id = ?1 AND s.id = ?4)`,
            )
            .bind(organizationId, userId, leadId, studentId, stamp),
          db
            .prepare(
              `INSERT INTO lead_events (id, organization_id, lead_id, kind, actor_user_id, created_at)
               SELECT ?1, ?2, ?3, 'CONVERTED', ?4, ?5 WHERE (SELECT changes()) > 0`,
            )
            .bind(crypto.randomUUID(), organizationId, leadId, userId, stamp),
          db
            .prepare(
              `INSERT INTO audit_events (id, organization_id, actor_user_id, action, subject_id)
               SELECT ?1, organization_id, ?2, 'STUDENT_CREATED', id FROM students WHERE id = ?3`,
            )
            .bind(crypto.randomUUID(), userId, studentId),
        ]);
        if (results[2].meta.changes > 0) return { status: "converted", studentId };
      }
      // Nothing changed: someone converted it first, or this person may not convert it.
      const after = await one(leadId);
      if (after?.studentId) return { status: "already", studentId: after.studentId };
      return { status: "forbidden" };
    },
  };
}
