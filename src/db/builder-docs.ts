import type { D1Database } from "@cloudflare/workers-types";
import type { Doc } from "@/modules/frappe-editor/doc-query";
import { DOCTYPES, type DocStore } from "@/modules/frappe-editor/protocol";
import { SITE_WRITES } from "./sites";
import { assertContext, type AuthenticatedContext } from "./students";

/**
 * The documents of the embedded editor (migration 0027): pages, components, templates, variables, fonts, scripts and versions, one JSON
 * row each, under the organization of the verified session. Only the owner and the managers read or write them (the editor is a tool of
 * those who edit the site), and every statement repeats the membership, the role and the active login, so a forged request, another
 * organization's document name or a revoked member reaches nothing. The editor never names the organization.
 */
export function builderDocsFor(db: D1Database, context: AuthenticatedContext | null, now: () => Date = () => new Date()): DocStore {
  const { userId, organizationId } = assertContext(context);
  const writes = SITE_WRITES;
  const parse = (data: string) => JSON.parse(data) as Doc;
  /** After a statement that changed nothing: was it the person's role, or the document? */
  const allowed = async () => (await db.prepare(`SELECT 1 AS ok WHERE ${writes}`).bind(organizationId, userId).first()) !== null;

  return {
    async list(doctype) {
      const { results } = await db
        .prepare(`SELECT data FROM builder_docs WHERE organization_id = ?1 AND doctype = ?3 AND ${writes}`)
        .bind(organizationId, userId, doctype)
        .all<{ data: string }>();
      return results.map((row) => parse(row.data));
    },

    async get(doctype, name) {
      const row = await db
        .prepare(`SELECT data FROM builder_docs WHERE organization_id = ?1 AND doctype = ?3 AND name = ?4 AND ${writes}`)
        .bind(organizationId, userId, doctype, name)
        .first<{ data: string }>();
      return row ? parse(row.data) : null;
    },

    async insert(doc) {
      const limit = DOCTYPES[doc.doctype];
      if (!limit) return "forbidden";
      try {
        const result = await db
          .prepare(
            `INSERT INTO builder_docs (organization_id, doctype, name, data, created_by, updated_by, created_at, updated_at)
             SELECT ?1, ?3, ?4, ?5, ?2, ?2, ?6, ?6
             WHERE ${writes} AND (SELECT COUNT(*) FROM builder_docs WHERE organization_id = ?1 AND doctype = ?3) < ?7`,
          )
          .bind(organizationId, userId, doc.doctype, doc.name, JSON.stringify(doc), now().toISOString(), limit)
          .run();
        if (result.meta.changes > 0) return "ok";
        return (await allowed()) ? "limit" : "forbidden";
      } catch (error) {
        if (error instanceof Error && /UNIQUE|PRIMARY KEY/i.test(error.message)) return (await allowed()) ? "exists" : "forbidden";
        throw error;
      }
    },

    async replace(doc) {
      const result = await db
        .prepare(
          `UPDATE builder_docs SET data = ?5, updated_by = ?2, updated_at = ?6
           WHERE organization_id = ?1 AND doctype = ?3 AND name = ?4 AND ${writes}`,
        )
        .bind(organizationId, userId, doc.doctype, doc.name, JSON.stringify(doc), now().toISOString())
        .run();
      if (result.meta.changes > 0) return "ok";
      return (await allowed()) ? "not_found" : "forbidden";
    },

    async remove(doctype, name) {
      const result = await db
        .prepare(`DELETE FROM builder_docs WHERE organization_id = ?1 AND doctype = ?3 AND name = ?4 AND ${writes}`)
        .bind(organizationId, userId, doctype, name)
        .run();
      if (result.meta.changes > 0) return "ok";
      return (await allowed()) ? "not_found" : "forbidden";
    },

    async rename(doctype, from, to) {
      if (!(await allowed())) return "forbidden";
      const taken = await db
        .prepare(`SELECT 1 AS taken FROM builder_docs WHERE organization_id = ?1 AND doctype = ?2 AND name = ?3`)
        .bind(organizationId, doctype, to)
        .first();
      if (taken && from !== to) return "exists";
      const result = await db
        .prepare(
          `UPDATE builder_docs SET name = ?5, data = json_set(data, '$.name', ?5), updated_by = ?2, updated_at = ?6
           WHERE organization_id = ?1 AND doctype = ?3 AND name = ?4 AND ${writes}`,
        )
        .bind(organizationId, userId, doctype, from, to, now().toISOString())
        .run();
      return result.meta.changes > 0 ? "ok" : "not_found";
    },
  };
}
