import type { D1Database } from "@cloudflare/workers-types";
import { serviceInput, type Delivery } from "@/modules/leads/contracts";
import { activeUser, assertContext, type AuthenticatedContext } from "./students";

/**
 * The services a professional sells. Everyone with commercial access to the organization (owner, manager,
 * commercial) reads them; only an owner or a manager writes. The organization and the person come from the
 * verified session; each statement repeats the membership and the active login.
 */
export interface ServiceRow {
  id: string;
  name: string;
  description: string | null;
  delivery: Delivery;
  active: boolean;
  leads: number;
}
export type ServiceOutcome = { status: "saved"; id: string } | { status: "forbidden" } | { status: "duplicate_name" } | { status: "not_found" };

export function servicesFor(db: D1Database, context: AuthenticatedContext | null) {
  const { userId, organizationId } = assertContext(context);
  // ?1 organization, ?2 acting login.
  const reads = `EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = ?1 AND m.user_id = ?2
    AND m.revoked_at IS NULL AND m.role IN ('OWNER','MANAGER','COMMERCIAL')) AND ${activeUser("?2")}`;
  const writes = `EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = ?1 AND m.user_id = ?2
    AND m.revoked_at IS NULL AND m.role IN ('OWNER','MANAGER')) AND ${activeUser("?2")}`;

  async function why(name: string | null, excludeId: string | null): Promise<"forbidden" | "duplicate_name"> {
    const allowed = await db.prepare(`SELECT 1 AS ok WHERE ${writes}`).bind(organizationId, userId).first();
    if (!allowed) return "forbidden";
    if (name) {
      const same = await db
        .prepare(
          `SELECT 1 AS ok FROM service_offerings WHERE organization_id = ?1 AND lower(trim(name)) = lower(trim(?2))
           AND (?3 IS NULL OR id <> ?3)`,
        )
        .bind(organizationId, name, excludeId)
        .first();
      if (same) return "duplicate_name";
    }
    return "forbidden";
  }

  return {
    async list(includeInactive = true): Promise<ServiceRow[]> {
      const result = await db
        .prepare(
          `SELECT s.id, s.name, s.description, s.delivery, s.active,
                  (SELECT COUNT(*) FROM leads l WHERE l.organization_id = s.organization_id AND l.service_id = s.id) AS leads
           FROM service_offerings s
           WHERE s.organization_id = ?1 AND ${reads} AND (?3 = 1 OR s.active = 1)
           ORDER BY s.active DESC, lower(s.name), s.id`,
        )
        .bind(organizationId, userId, includeInactive ? 1 : 0)
        .all<Omit<ServiceRow, "active"> & { active: number }>();
      return result.results.map((row) => ({ ...row, active: row.active === 1 }));
    },

    async create(raw: unknown, now = new Date()): Promise<ServiceOutcome> {
      const input = serviceInput.parse(raw);
      const id = crypto.randomUUID();
      const stamp = now.toISOString();
      const result = await db
        .prepare(
          `INSERT INTO service_offerings (id, organization_id, name, description, delivery, created_by, created_at, updated_at)
           SELECT ?3, ?1, ?4, ?5, ?6, ?2, ?7, ?7
           WHERE ${writes}
             AND NOT EXISTS (SELECT 1 FROM service_offerings o WHERE o.organization_id = ?1 AND lower(trim(o.name)) = lower(trim(?4)))`,
        )
        .bind(organizationId, userId, id, input.name, input.description ?? null, input.delivery, stamp)
        .run();
      if (result.meta.changes > 0) return { status: "saved", id };
      return { status: await why(input.name, null) };
    },

    async update(serviceId: string, raw: unknown, now = new Date()): Promise<ServiceOutcome> {
      const input = serviceInput.parse(raw);
      const result = await db
        .prepare(
          `UPDATE service_offerings SET name = ?4, description = ?5, delivery = ?6, updated_at = ?7
           WHERE organization_id = ?1 AND id = ?3 AND ${writes}
             AND NOT EXISTS (SELECT 1 FROM service_offerings o WHERE o.organization_id = ?1 AND o.id <> ?3
                             AND lower(trim(o.name)) = lower(trim(?4)))`,
        )
        .bind(organizationId, userId, serviceId, input.name, input.description ?? null, input.delivery, now.toISOString())
        .run();
      if (result.meta.changes > 0) return { status: "saved", id: serviceId };
      const exists = await db
        .prepare("SELECT 1 AS ok FROM service_offerings WHERE organization_id = ? AND id = ?")
        .bind(organizationId, serviceId)
        .first();
      if (!exists) return { status: "not_found" };
      return { status: await why(input.name, serviceId) };
    },

    /** An inactive service stays on the leads that already chose it; it just is not offered any more. */
    async setActive(serviceId: string, active: boolean, now = new Date()): Promise<ServiceOutcome> {
      const result = await db
        .prepare(
          `UPDATE service_offerings SET active = ?4, updated_at = ?5
           WHERE organization_id = ?1 AND id = ?3 AND ${writes}`,
        )
        .bind(organizationId, userId, serviceId, active ? 1 : 0, now.toISOString())
        .run();
      if (result.meta.changes > 0) return { status: "saved", id: serviceId };
      const exists = await db
        .prepare("SELECT 1 AS ok FROM service_offerings WHERE organization_id = ? AND id = ?")
        .bind(organizationId, serviceId)
        .first();
      return { status: exists ? await why(null, null) : "not_found" };
    },
  };
}
