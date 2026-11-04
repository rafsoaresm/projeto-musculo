import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { canonicalJson, parseFieldValue, readStoredValue, type FieldValue } from "@/modules/biblioteca/metadata/fields";
import { INFERENCE_RULES, inferExercise } from "@/modules/biblioteca/metadata/inference";
import {
  summarize,
  type ResolvedAlternative,
  type ResolvedField,
  type ResolvedMetadata,
} from "@/modules/biblioteca/metadata/status";
import {
  MAX_ALTERNATIVES,
  METADATA_FIELDS,
  type MetadataField,
  type MetadataSummary,
  type Provenance,
} from "@/modules/biblioteca/metadata/vocabulary";
import { adminGuard } from "./platform";
import { activeUser, assertContext, type AuthenticatedContext } from "./students";

/**
 * Library metadata (motor S4, design §3.4 and §4.3). Same access as the library itself
 * (`exercisesFor`): owner, manager or technical members, active and not revoked. The organization
 * and the user come from the verified session (?1 and ?2), never from a payload.
 *
 * - An organization writes only its own scope (`scope_organization_id = ?1`), on exercises it can
 *   see: the system's (an "ajuste da minha organização") or its own. It can never write the system
 *   scope (''); that is `systemMetadataFor`, for platform managers only.
 * - Reads resolve each field by precedence (org REVIEWED > org PENDING > system REVIEWED >
 *   org INFERRED > system PENDING > system INFERRED) and ignore archived or foreign exercises.
 * - Every write records an event in the same batch, gated on the write token of that write.
 */

export type MetadataWriteOutcome =
  | { status: "saved"; version: number }
  | { status: "conflict" }
  | { status: "invalid" }
  | { status: "not_found" };

export type RelationOutcome =
  | { status: "saved" }
  | { status: "duplicate" }
  | { status: "too_many" }
  | { status: "invalid" }
  | { status: "not_found" };

export type EnrichOutcome =
  | { status: "done"; exercises: number; inferred: number; unchanged: number; keptByPerson: number; cleared: number }
  | { status: "not_found" };

export interface StoredField {
  value: FieldValue | null;
  provenance: Provenance;
  ruleId: string | null;
  rulesVersion: string | null;
  reviewedAt: string | null;
  reviewedByMe: boolean;
  version: number;
}

export interface FieldDetail {
  field: MetadataField;
  effective: ResolvedField | null;
  organization: StoredField | null;
  system: StoredField | null;
}

export interface MetadataEvent {
  field: string;
  action: string;
  status: Provenance | null;
  valueJson: string | null;
  ruleId: string | null;
  scope: "SYSTEM" | "ORGANIZATION";
  actor: string | null;
  createdAt: string;
}

export interface MetadataDetail {
  exerciseId: string;
  exerciseScope: "SYSTEM" | "ORGANIZATION";
  archived: boolean;
  fields: FieldDetail[];
  summary: MetadataSummary;
  alternatives: Array<ResolvedAlternative & { relationId: string; removable: boolean }>;
  history: MetadataEvent[];
}

interface AttributeRow {
  exercise_id: string;
  field: MetadataField;
  value_json: string | null;
  status: Provenance;
  scope_organization_id: string;
  rule_id: string | null;
  rules_version: string | null;
  reviewed_at: string | null;
  reviewed_by_user_id: string | null;
  version: number;
  source: string;
}

/** Precedence in SQL; must stay equal to `precedence()` in status.ts (tested). */
const RANK = `CASE
  WHEN a.scope_organization_id <> '' AND a.status = 'REVIEWED' THEN 1
  WHEN a.scope_organization_id <> '' AND a.status = 'PENDING' THEN 2
  WHEN a.scope_organization_id = '' AND a.status = 'REVIEWED' THEN 3
  WHEN a.scope_organization_id <> '' AND a.status = 'INFERRED' THEN 4
  WHEN a.scope_organization_id = '' AND a.status = 'PENDING' THEN 5
  ELSE 6 END`;

/** Rows per json_each chunk in one statement (bound parameter, not SQL text). Not measured under workerd. */
const CHUNK = 200;
const chunks = <T>(list: T[]) =>
  Array.from({ length: Math.ceil(list.length / CHUNK) }, (_, index) => list.slice(index * CHUNK, (index + 1) * CHUNK));

const toResolved = (row: AttributeRow): ResolvedField => {
  const value = row.status === "PENDING" ? null : readStoredValue(row.field, row.value_json);
  return {
    value,
    // A stored value that no longer validates is treated as pending, never as a guess.
    provenance: value === null ? "PENDING" : row.status,
    scope: row.scope_organization_id === "" ? "SYSTEM" : "ORGANIZATION",
    ruleId: row.rule_id,
    rulesVersion: row.rules_version,
    reviewedAt: row.reviewed_at,
  };
};

const isUnique = (error: unknown) => String(error).includes("UNIQUE");

interface Writer {
  scope: string;
  userId: string;
  source: "PROFESSIONAL" | "PLATFORM";
  /** SQL that is true only when the actor may write this scope for exercise ?3. */
  guard: string;
  binds: unknown[];
}

/**
 * One field write (REVIEWED with a value, or PENDING without one) as a compare-and-set on the
 * row's version (null: there is no row of this scope yet), plus its event, in one batch.
 */
async function writeField(
  db: D1Database,
  writer: Writer,
  exerciseId: string,
  field: MetadataField,
  next: { status: "REVIEWED" | "PENDING"; valueJson: string | null; action: "SET" | "REVIEWED" | "PENDING" },
  expectedVersion: number | null,
  now: Date,
): Promise<boolean> {
  const stamp = now.toISOString();
  const writeId = crypto.randomUUID();
  const reviewer = next.status === "REVIEWED" ? writer.userId : null;
  const reviewedAt = next.status === "REVIEWED" ? stamp : null;
  // ?1 scope, ?2 user, ?3 exercise, ?4 field, ?5 value, ?6 status, ?7 reviewer, ?8 reviewed at, ?9 stamp,
  // ?10 write id, ?11 expected version or new id, ?12 source; then the guard's own binds from ?13.
  const binds = [
    writer.scope,
    writer.userId,
    exerciseId,
    field,
    next.valueJson,
    next.status,
    reviewer,
    reviewedAt,
    stamp,
    writeId,
    expectedVersion ?? crypto.randomUUID(),
    writer.source,
    ...writer.binds,
  ];
  const write =
    expectedVersion === null
      ? `INSERT INTO exercise_attributes (id, exercise_id, scope_organization_id, field, value_json, status, source,
           reviewed_by_user_id, reviewed_at, updated_by_user_id, version, last_write_id, created_at, updated_at)
         SELECT ?11, ?3, ?1, ?4, ?5, ?6, ?12, ?7, ?8, ?2, 1, ?10, ?9, ?9
         WHERE ${writer.guard}
         ON CONFLICT(exercise_id, scope_organization_id, field) DO NOTHING`
      : `UPDATE exercise_attributes SET value_json = ?5, status = ?6, source = ?12, rule_id = NULL, rules_version = NULL,
           reviewed_by_user_id = ?7, reviewed_at = ?8, updated_by_user_id = ?2, version = version + 1,
           last_write_id = ?10, updated_at = ?9
         WHERE exercise_id = ?3 AND scope_organization_id = ?1 AND field = ?4 AND version = ?11 AND ${writer.guard}`;
  const results = await db.batch([
    db.prepare(write).bind(...binds),
    db
      .prepare(
        `INSERT INTO exercise_attribute_events (id, scope_organization_id, exercise_id, field, action, status, value_json,
           rule_id, rules_version, actor_user_id, write_id, created_at)
         SELECT lower(hex(randomblob(16))), a.scope_organization_id, a.exercise_id, a.field, ?5, a.status, a.value_json,
           NULL, NULL, ?2, ?6, ?7
         FROM exercise_attributes a
         WHERE a.exercise_id = ?3 AND a.scope_organization_id = ?1 AND a.field = ?4 AND a.last_write_id = ?6`,
      )
      .bind(writer.scope, writer.userId, exerciseId, field, next.action, writeId, stamp),
  ]);
  return results[0].meta.changes > 0;
}

export function exerciseMetadataFor(db: D1Database, context: AuthenticatedContext | null) {
  const { userId, organizationId } = assertContext(context);
  const technical = `${activeUser("?2")} AND EXISTS (SELECT 1 FROM memberships m
    WHERE m.organization_id = ?1 AND m.user_id = ?2 AND m.revoked_at IS NULL
      AND m.role IN ('OWNER','MANAGER','TECHNICAL'))`;
  /** Exercise `id` (SQL expression) is visible to the organization and not archived. */
  const usable = (id: string) => `EXISTS (SELECT 1 FROM exercises e WHERE e.id = ${id} AND e.archived_at IS NULL
    AND (e.organization_id IS NULL OR e.organization_id = ?1))`;
  const writer: Writer = {
    scope: organizationId,
    userId,
    source: "PROFESSIONAL",
    guard: `${usable("?3")} AND ${technical}`,
    binds: [],
  };

  async function allowed(): Promise<boolean> {
    return (await db.prepare(`SELECT 1 AS ok WHERE ${technical}`).bind(organizationId, userId).first()) !== null;
  }

  async function rowsFor(ids: string[]): Promise<AttributeRow[]> {
    if (ids.length === 0) return [];
    const result = await db
      .prepare(
        `WITH wanted AS (SELECT DISTINCT value AS id FROM json_each(?3)),
         visible AS (
           SELECT e.id FROM exercises e JOIN wanted w ON w.id = e.id
           WHERE e.archived_at IS NULL AND (e.organization_id IS NULL OR e.organization_id = ?1) AND ${technical}
         ),
         ranked AS (
           SELECT a.exercise_id, a.field, a.value_json, a.status, a.scope_organization_id, a.rule_id, a.rules_version,
             a.reviewed_at, a.reviewed_by_user_id, a.version, a.source,
             ROW_NUMBER() OVER (PARTITION BY a.exercise_id, a.field ORDER BY ${RANK}) AS rk
           FROM exercise_attributes a JOIN visible v ON v.id = a.exercise_id
           WHERE a.scope_organization_id IN ('', ?1)
         )
         SELECT exercise_id, field, value_json, status, scope_organization_id, rule_id, rules_version, reviewed_at,
           reviewed_by_user_id, version, source
         FROM ranked WHERE rk = 1`,
      )
      .bind(organizationId, userId, JSON.stringify(ids))
      .all<AttributeRow>();
    return result.results;
  }

  async function alternativesFor(ids: string[]) {
    if (ids.length === 0) return [];
    const result = await db
      .prepare(
        `WITH wanted AS (SELECT DISTINCT value AS id FROM json_each(?3))
         SELECT r.id AS relationId, r.from_exercise_id AS fromId, r.to_exercise_id AS exerciseId, t.name, r.status,
           r.scope_organization_id AS scopeId
         FROM exercise_relations r
         JOIN wanted w ON w.id = r.from_exercise_id
         JOIN exercises f ON f.id = r.from_exercise_id AND f.archived_at IS NULL
           AND (f.organization_id IS NULL OR f.organization_id = ?1)
         JOIN exercises t ON t.id = r.to_exercise_id AND t.archived_at IS NULL
           AND (t.organization_id IS NULL OR t.organization_id = ?1)
         WHERE r.removed_at IS NULL AND r.kind = 'ALTERNATIVE' AND r.scope_organization_id IN ('', ?1) AND ${technical}
         ORDER BY r.from_exercise_id, t.name_key, r.id`,
      )
      .bind(organizationId, userId, JSON.stringify(ids))
      .all<{ relationId: string; fromId: string; exerciseId: string; name: string; status: Provenance; scopeId: string }>();
    return result.results;
  }

  return {
    /**
     * The metadata of each visible, non-archived exercise among `ids`, by precedence. Exercises
     * the organization cannot see, or archived ones, are absent from the map. This is the seam the
     * S5 input adapter reads to build the engine catalog.
     */
    async resolve(ids: string[]): Promise<Map<string, ResolvedMetadata>> {
      const unique = [...new Set(ids)];
      const out = new Map<string, ResolvedMetadata>();
      for (const part of chunks(unique)) {
        const [rows, relations, visible] = await Promise.all([
          rowsFor(part),
          alternativesFor(part),
          db
            .prepare(
              `SELECT e.id FROM exercises e JOIN json_each(?3) w ON w.value = e.id
               WHERE e.archived_at IS NULL AND (e.organization_id IS NULL OR e.organization_id = ?1) AND ${technical}`,
            )
            .bind(organizationId, userId, JSON.stringify(part))
            .all<{ id: string }>(),
        ]);
        for (const { id } of visible.results)
          out.set(id, { exerciseId: id, fields: {}, alternatives: [], summary: "PENDING" });
        for (const row of rows) {
          const entry = out.get(row.exercise_id);
          if (entry) entry.fields[row.field] = toResolved(row);
        }
        for (const relation of relations)
          out.get(relation.fromId)?.alternatives.push({
            exerciseId: relation.exerciseId,
            name: relation.name,
            provenance: relation.status,
            scope: relation.scopeId === "" ? "SYSTEM" : "ORGANIZATION",
          });
      }
      for (const entry of out.values()) entry.summary = summarize(entry.fields);
      return out;
    },

    /** Everything the exercise page shows: per field the value in use, the organization's row and the system's row. */
    async detail(exerciseId: string): Promise<MetadataDetail | null> {
      const exercise = await db
        .prepare(
          `SELECT e.id, CASE WHEN e.organization_id IS NULL THEN 'SYSTEM' ELSE 'ORGANIZATION' END AS scope,
             e.archived_at AS archivedAt
           FROM exercises e
           WHERE e.id = ?3 AND (e.organization_id IS NULL OR e.organization_id = ?1) AND ${technical}`,
        )
        .bind(organizationId, userId, exerciseId)
        .first<{ id: string; scope: "SYSTEM" | "ORGANIZATION"; archivedAt: string | null }>();
      if (!exercise) return null;
      const [stored, resolved, history] = await Promise.all([
        db
          .prepare(
            `SELECT a.exercise_id, a.field, a.value_json, a.status, a.scope_organization_id, a.rule_id, a.rules_version,
               a.reviewed_at, a.reviewed_by_user_id, a.version, a.source
             FROM exercise_attributes a WHERE a.exercise_id = ?3 AND a.scope_organization_id IN ('', ?1)`,
          )
          .bind(organizationId, userId, exerciseId)
          .all<AttributeRow>(),
        exercise.archivedAt ? Promise.resolve(new Map<string, ResolvedMetadata>()) : this.resolve([exerciseId]),
        db
          .prepare(
            `SELECT ev.field, ev.action, ev.status, ev.value_json AS valueJson, ev.rule_id AS ruleId,
               CASE WHEN ev.scope_organization_id = '' THEN 'SYSTEM' ELSE 'ORGANIZATION' END AS scope,
               p.display_name AS actor, ev.created_at AS createdAt
             FROM exercise_attribute_events ev
             LEFT JOIN professionals p ON p.organization_id = ?1 AND p.user_id = ev.actor_user_id
             WHERE ev.exercise_id = ?3 AND ev.scope_organization_id IN ('', ?1)
             ORDER BY ev.created_at DESC, ev.id DESC LIMIT 20`,
          )
          .bind(organizationId, userId, exerciseId)
          .all<MetadataEvent>(),
      ]);
      const toStored = (row: AttributeRow | undefined): StoredField | null =>
        row
          ? {
              value: row.status === "PENDING" ? null : readStoredValue(row.field, row.value_json),
              provenance: row.status,
              ruleId: row.rule_id,
              rulesVersion: row.rules_version,
              reviewedAt: row.reviewed_at,
              reviewedByMe: row.reviewed_by_user_id === userId,
              version: row.version,
            }
          : null;
      const effective = resolved.get(exerciseId);
      const alternatives = exercise.archivedAt ? [] : await alternativesFor([exerciseId]);
      return {
        exerciseId,
        exerciseScope: exercise.scope,
        archived: Boolean(exercise.archivedAt),
        fields: METADATA_FIELDS.map((field) => ({
          field,
          effective: effective?.fields[field] ?? null,
          organization: toStored(stored.results.find((r) => r.field === field && r.scope_organization_id === organizationId)),
          system: toStored(stored.results.find((r) => r.field === field && r.scope_organization_id === "")),
        })),
        summary: effective?.summary ?? "PENDING",
        alternatives: alternatives.map((relation) => ({
          relationId: relation.relationId,
          exerciseId: relation.exerciseId,
          name: relation.name,
          provenance: relation.status,
          scope: relation.scopeId === "" ? ("SYSTEM" as const) : ("ORGANIZATION" as const),
          removable: relation.scopeId === organizationId,
        })),
        history: history.results,
      };
    },

    /**
     * "Salvar como revisado por mim": stores the value in the organization's scope as REVIEWED.
     * Confirming the value already in use records a REVIEWED event; a different value records SET.
     */
    async setField(
      exerciseId: string,
      field: MetadataField,
      raw: unknown,
      expectedVersion: number | null,
      now = new Date(),
    ): Promise<MetadataWriteOutcome> {
      const value = parseFieldValue(field, raw);
      if (value === null) return { status: "invalid" };
      const valueJson = canonicalJson(field, value);
      const current = (await this.resolve([exerciseId])).get(exerciseId);
      if (!current) return { status: "not_found" };
      const inUse = current.fields[field];
      const same = inUse?.value !== null && inUse !== undefined && canonicalJson(field, inUse.value) === valueJson;
      const saved = await writeField(
        db,
        writer,
        exerciseId,
        field,
        { status: "REVIEWED", valueJson, action: same ? "REVIEWED" : "SET" },
        expectedVersion,
        now,
      );
      if (saved) return { status: "saved", version: (expectedVersion ?? 0) + 1 };
      return (await this.resolve([exerciseId])).has(exerciseId) ? { status: "conflict" } : { status: "not_found" };
    },

    /** "Marcar como pendente": the field stops being used for this organization until someone reviews it. */
    async markPending(
      exerciseId: string,
      field: MetadataField,
      expectedVersion: number | null,
      now = new Date(),
    ): Promise<MetadataWriteOutcome> {
      const saved = await writeField(
        db,
        writer,
        exerciseId,
        field,
        { status: "PENDING", valueJson: null, action: "PENDING" },
        expectedVersion,
        now,
      );
      if (saved) return { status: "saved", version: (expectedVersion ?? 0) + 1 };
      return (await this.resolve([exerciseId])).has(exerciseId) ? { status: "conflict" } : { status: "not_found" };
    },

    /** A curated alternative (substitution) in the organization's scope; both exercises must be usable by it. */
    async addAlternative(fromId: string, toId: string, now = new Date()): Promise<RelationOutcome> {
      if (fromId === toId) return { status: "invalid" };
      const stamp = now.toISOString();
      const writeId = crypto.randomUUID();
      try {
        const results = await db.batch([
          db
            .prepare(
              `INSERT INTO exercise_relations (id, from_exercise_id, to_exercise_id, scope_organization_id, kind, status, source,
                 created_by_user_id, created_at, last_write_id)
               SELECT ?5, ?3, ?4, ?1, 'ALTERNATIVE', 'REVIEWED', 'PROFESSIONAL', ?2, ?6, ?7
               WHERE ${usable("?3")} AND ${usable("?4")} AND ${technical}
                 AND (SELECT count(*) FROM exercise_relations WHERE from_exercise_id = ?3 AND scope_organization_id = ?1
                   AND kind = 'ALTERNATIVE' AND removed_at IS NULL) < ?8`,
            )
            .bind(organizationId, userId, fromId, toId, crypto.randomUUID(), stamp, writeId, MAX_ALTERNATIVES),
          db
            .prepare(
              `INSERT INTO exercise_attribute_events (id, scope_organization_id, exercise_id, field, action, status, value_json,
                 actor_user_id, write_id, created_at)
               SELECT lower(hex(randomblob(16))), ?1, r.from_exercise_id, 'alternatives', 'RELATION_ADDED', r.status,
                 json_quote(r.to_exercise_id), ?2, ?3, ?4
               FROM exercise_relations r WHERE r.scope_organization_id = ?1 AND r.last_write_id = ?3`,
            )
            .bind(organizationId, userId, writeId, stamp),
        ]);
        if (results[0].meta.changes > 0) return { status: "saved" };
      } catch (error) {
        if (isUnique(error)) return { status: "duplicate" };
        throw error;
      }
      const both = await this.resolve([fromId, toId]);
      if (!both.has(fromId) || !both.has(toId)) return { status: "not_found" };
      return { status: "too_many" };
    },

    /** Removes one of the organization's alternatives (system ones are not the organization's to remove). */
    async removeAlternative(relationId: string, now = new Date()): Promise<boolean> {
      const stamp = now.toISOString();
      const writeId = crypto.randomUUID();
      const results = await db.batch([
        db
          .prepare(
            `UPDATE exercise_relations SET removed_at = ?4, removed_by_user_id = ?2, last_write_id = ?5
             WHERE id = ?3 AND scope_organization_id = ?1 AND removed_at IS NULL AND ${technical}`,
          )
          .bind(organizationId, userId, relationId, stamp, writeId),
        db
          .prepare(
            `INSERT INTO exercise_attribute_events (id, scope_organization_id, exercise_id, field, action, status, value_json,
               actor_user_id, write_id, created_at)
             SELECT lower(hex(randomblob(16))), ?1, r.from_exercise_id, 'alternatives', 'RELATION_REMOVED', r.status,
               json_quote(r.to_exercise_id), ?2, ?3, ?4
             FROM exercise_relations r WHERE r.id = ?5 AND r.scope_organization_id = ?1 AND r.last_write_id = ?3`,
          )
          .bind(organizationId, userId, writeId, stamp, relationId),
      ]);
      return results[0].meta.changes > 0;
    },

    /**
     * "Inferir metadados das minhas fichas": runs the documented name rules on the organization's own,
     * non-archived exercises. Writes INFERRED rows in the organization's scope; refreshes inferred rows
     * whose rule result changed; turns an inferred value the rules no longer produce into PENDING.
     * Never touches a value a person reviewed or marked pending (the database refuses it as well).
     */
    async enrichOrganization(now = new Date()): Promise<EnrichOutcome> {
      if (!(await allowed())) return { status: "not_found" };
      const own = await db
        .prepare(
          `SELECT e.id, e.name, e.category FROM exercises e
           WHERE e.organization_id = ?1 AND e.archived_at IS NULL AND ${technical}
           ORDER BY e.name_key, e.id`,
        )
        .bind(organizationId, userId)
        .all<{ id: string; name: string; category: string }>();
      const existing = await db
        .prepare(
          `SELECT a.exercise_id, a.field, a.value_json, a.status, a.rule_id, a.rules_version, a.source
           FROM exercise_attributes a JOIN exercises e ON e.id = a.exercise_id
           WHERE a.scope_organization_id = ?1 AND e.organization_id = ?1 AND e.archived_at IS NULL AND ${technical}`,
        )
        .bind(organizationId, userId)
        .all<Pick<AttributeRow, "exercise_id" | "field" | "value_json" | "status" | "rule_id" | "rules_version" | "source">>();
      const byKey = new Map(existing.results.map((row) => [`${row.exercise_id}\u0000${row.field}`, row]));
      const upserts: Array<{ id: string; e: string; f: string; v: string; r: string }> = [];
      const clears: Array<{ e: string; f: string }> = [];
      let unchanged = 0;
      let keptByPerson = 0;
      for (const exercise of own.results) {
        const inferred = inferExercise(exercise.name, exercise.category);
        const produced = new Set(inferred.map((item) => item.field));
        for (const item of inferred) {
          const row = byKey.get(`${exercise.id}\u0000${item.field}`);
          if (row && row.source !== "INFERENCE") {
            keptByPerson += 1;
            continue;
          }
          if (
            row &&
            row.status === "INFERRED" &&
            row.value_json === item.valueJson &&
            row.rule_id === item.ruleId &&
            row.rules_version === INFERENCE_RULES.version
          ) {
            unchanged += 1;
            continue;
          }
          upserts.push({ id: crypto.randomUUID(), e: exercise.id, f: item.field, v: item.valueJson, r: item.ruleId });
        }
        for (const field of METADATA_FIELDS) {
          const row = byKey.get(`${exercise.id}\u0000${field}`);
          if (row && row.source === "INFERENCE" && row.status === "INFERRED" && !produced.has(field))
            clears.push({ e: exercise.id, f: field });
        }
      }
      const stamp = now.toISOString();
      const writeId = crypto.randomUUID();
      const statements: D1PreparedStatement[] = [];
      for (const part of chunks(upserts))
        statements.push(
          db
            .prepare(
              `INSERT INTO exercise_attributes (id, exercise_id, scope_organization_id, field, value_json, status, source, rule_id,
                 rules_version, updated_by_user_id, version, last_write_id, created_at, updated_at)
               SELECT json_extract(j.value, '$.id'), e.id, ?1, json_extract(j.value, '$.f'), json_extract(j.value, '$.v'),
                 'INFERRED', 'INFERENCE', json_extract(j.value, '$.r'), ?4, ?2, 1, ?3, ?5, ?5
               FROM json_each(?6) j
               JOIN exercises e ON e.id = json_extract(j.value, '$.e') AND e.organization_id = ?1 AND e.archived_at IS NULL
               WHERE ${technical}
               ON CONFLICT(exercise_id, scope_organization_id, field) DO UPDATE SET
                 value_json = excluded.value_json, status = 'INFERRED', rule_id = excluded.rule_id,
                 rules_version = excluded.rules_version, updated_by_user_id = excluded.updated_by_user_id,
                 version = exercise_attributes.version + 1, last_write_id = excluded.last_write_id, updated_at = excluded.updated_at
               WHERE exercise_attributes.source = 'INFERENCE'`,
            )
            .bind(organizationId, userId, writeId, INFERENCE_RULES.version, stamp, JSON.stringify(part)),
        );
      for (const part of chunks(clears))
        statements.push(
          db
            .prepare(
              `UPDATE exercise_attributes SET status = 'PENDING', value_json = NULL, rule_id = NULL, rules_version = ?4,
                 updated_by_user_id = ?2, version = version + 1, last_write_id = ?3, updated_at = ?5
               WHERE scope_organization_id = ?1 AND source = 'INFERENCE' AND status = 'INFERRED'
                 AND EXISTS (SELECT 1 FROM json_each(?6) j WHERE json_extract(j.value, '$.e') = exercise_attributes.exercise_id
                   AND json_extract(j.value, '$.f') = exercise_attributes.field)
                 AND ${technical}`,
            )
            .bind(organizationId, userId, writeId, INFERENCE_RULES.version, stamp, JSON.stringify(part)),
        );
      if (statements.length > 0) {
        statements.push(
          db
            .prepare(
              `INSERT INTO exercise_attribute_events (id, scope_organization_id, exercise_id, field, action, status, value_json,
                 rule_id, rules_version, actor_user_id, write_id, created_at)
               SELECT lower(hex(randomblob(16))), a.scope_organization_id, a.exercise_id, a.field,
                 CASE a.status WHEN 'INFERRED' THEN 'INFERRED' ELSE 'PENDING' END, a.status, a.value_json, a.rule_id,
                 a.rules_version, ?2, ?3, ?4
               FROM exercise_attributes a WHERE a.scope_organization_id = ?1 AND a.last_write_id = ?3`,
            )
            .bind(organizationId, userId, writeId, stamp),
        );
        await db.batch(statements);
      }
      const counts = await db
        .prepare(
          `SELECT status, count(*) AS n FROM exercise_attributes WHERE scope_organization_id = ?1 AND last_write_id = ?2
           GROUP BY status`,
        )
        .bind(organizationId, writeId)
        .all<{ status: Provenance; n: number }>();
      const count = (status: Provenance) => counts.results.find((row) => row.status === status)?.n ?? 0;
      return {
        status: "done",
        exercises: own.results.length,
        inferred: count("INFERRED"),
        unchanged,
        keptByPerson,
        cleared: count("PENDING"),
      };
    },
  };
}

/**
 * Curation of the system library (scope ''), for platform managers only. No organization context:
 * `requirePlatformAdmin` gives only the user id, and the guard is checked in SQL on every write.
 */
export function systemMetadataFor(db: D1Database, admin: { userId: string } | null) {
  if (!admin?.userId?.trim()) throw new Error("AUTHENTICATION_REQUIRED");
  const userId = admin.userId;
  // ?13 is the admin user again: the guard must not depend on the writer's own binds layout.
  const writer: Writer = {
    scope: "",
    userId,
    source: "PLATFORM",
    guard: `EXISTS (SELECT 1 FROM exercises e WHERE e.id = ?3 AND e.organization_id IS NULL AND e.archived_at IS NULL)
      AND ${adminGuard("?13")}`,
    binds: [userId],
  };
  const version = async (exerciseId: string, field: MetadataField) =>
    (
      await db
        .prepare(`SELECT version FROM exercise_attributes WHERE exercise_id = ?1 AND scope_organization_id = '' AND field = ?2`)
        .bind(exerciseId, field)
        .first<{ version: number }>()
    )?.version ?? null;
  return {
    async setField(
      exerciseId: string,
      field: MetadataField,
      raw: unknown,
      expectedVersion: number | null,
      now = new Date(),
    ): Promise<MetadataWriteOutcome> {
      const value = parseFieldValue(field, raw);
      if (value === null) return { status: "invalid" };
      const saved = await writeField(
        db,
        writer,
        exerciseId,
        field,
        { status: "REVIEWED", valueJson: canonicalJson(field, value), action: "SET" },
        expectedVersion,
        now,
      );
      if (saved) return { status: "saved", version: (expectedVersion ?? 0) + 1 };
      return (await version(exerciseId, field)) === expectedVersion ? { status: "not_found" } : { status: "conflict" };
    },
    async markPending(
      exerciseId: string,
      field: MetadataField,
      expectedVersion: number | null,
      now = new Date(),
    ): Promise<MetadataWriteOutcome> {
      const saved = await writeField(
        db,
        writer,
        exerciseId,
        field,
        { status: "PENDING", valueJson: null, action: "PENDING" },
        expectedVersion,
        now,
      );
      if (saved) return { status: "saved", version: (expectedVersion ?? 0) + 1 };
      return (await version(exerciseId, field)) === expectedVersion ? { status: "not_found" } : { status: "conflict" };
    },
  };
}
