import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { plansFor } from "@/db/plans";
import { buildPeriodization } from "@/modules/training/periodization";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// Real local D1 with the four migrations. Identities are rows, as the server
// derives them from a verified session.
let mf: Miniflare;
let db: D1Database;
const scope = (userId: string, organizationId = "org-a") => ({
  userId,
  organizationId,
});
const phases = (count: number, split = "ABC") =>
  Array.from({ length: count }, () => ({
    weeks: 4,
    sessionsPerWeek: 3,
    split,
    exercisesPerSession: 5,
  }));
const input = (count = 3, startDate = "2026-11-02", split = "ABC") => ({
  startDate,
  phases: phases(count, split),
});


const counts = async () =>
  (await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM training_plans) AS plans,
         (SELECT COUNT(*) FROM plan_revisions) AS revisions,
         (SELECT COUNT(*) FROM training_plan_events) AS events`,
    )
    .first<{ plans: number; revisions: number; events: number }>())!;

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "plans-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  const people = [
    "owner-a",
    "tech-a",
    "tech-a2",
    "commercial-a",
    "owner-b",
    "tech-b",
    "client-1",
    "mgr-1",
  ];
  await db.batch([
    ...people.map((id) =>
      db
        .prepare(
          "INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)",
        )
        .bind(id, `${id}@example.test`),
    ),
    db.prepare(
      "INSERT INTO users(id) VALUES ('owner-a'),('tech-a'),('tech-a2'),('commercial-a'),('owner-b'),('tech-b'),('client-1'),('mgr-1')",
    ),
    db.prepare("INSERT INTO platform_admins(user_id) VALUES ('mgr-1')"),
    db.prepare(
      "INSERT INTO organizations(id,name) VALUES ('org-a','Studio A'),('org-b','Studio B')",
    ),
    db.prepare(
      `INSERT INTO memberships(organization_id,user_id,role) VALUES
       ('org-a','owner-a','OWNER'),('org-a','tech-a','TECHNICAL'),('org-a','tech-a2','TECHNICAL'),
       ('org-a','commercial-a','COMMERCIAL'),('org-b','owner-b','OWNER'),('org-b','tech-b','TECHNICAL')`,
    ),
    db.prepare(
      `INSERT INTO professionals(id,organization_id,user_id,display_name) VALUES
       ('pro-owner-a','org-a','owner-a','Owner A'),('pro-a','org-a','tech-a','Pro A'),
       ('pro-a2','org-a','tech-a2','Pro A2'),('pro-owner-b','org-b','owner-b','Owner B'),
       ('pro-b','org-b','tech-b','Pro B')`,
    ),
    db.prepare(
      `INSERT INTO students(id,organization_id,display_name) VALUES
       ('st-1','org-a','Student One'),('st-2','org-a','Student Two'),
       ('st-3','org-a','Student Three'),('st-b','org-b','Student B')`,
    ),
    db.prepare(
      `INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES
       ('org-a','st-1','pro-a'),('org-a','st-2','pro-a2'),('org-a','st-3','pro-a'),
       ('org-b','st-b','pro-b')`,
    ),
    // The student has a portal login for st-1, and it must not open plans.
    db.prepare(
      "INSERT INTO student_access(organization_id,student_id,user_id) VALUES ('org-a','st-1','client-1')",
    ),
  ]);
});
afterAll(async () => {
  await mf.dispose();
});

describe("saving a plan", () => {
  let planId: string;
  let revisionId: string;

  it("creates a plan with a first draft whose schedule the server computed", async () => {
    const created = await plansFor(db, scope("tech-a")).create("st-1", {
      title: "  Ciclo inicial  ",
      input: input(),
    });
    expect(created).not.toBeNull();
    ({ planId, revisionId } = created!);
    const found = await plansFor(db, scope("tech-a")).findRevision(
      planId,
      revisionId,
    );
    expect(found?.plan).toEqual({
      id: planId,
      studentId: "st-1",
      title: "Ciclo inicial",
    });
    expect(found?.revision.state).toBe("DRAFT");
    expect(found?.revision.revisionNumber).toBe(1);
    expect(found?.revision.schedule).toEqual(buildPeriodization(input()));
    expect(found?.revision.totalWeeks).toBe(12);
    expect(found?.revision.totalSessions).toBe(36);
    const listed = await plansFor(db, scope("tech-a")).listForStudent("st-1");
    expect(listed).toHaveLength(1);
    expect(listed[0].revisions.map((r) => r.state)).toEqual(["DRAFT"]);
  });

  it("refuses everyone without active technical access and writes nothing", async () => {
    const before = await counts();
    const attempts: Array<[string, string, string]> = [
      ["tech-a2", "org-a", "st-1"], // professional without assignment
      ["owner-a", "org-a", "st-1"], // owner without assignment
      ["commercial-a", "org-a", "st-1"], // commercial member
      ["client-1", "org-a", "st-1"], // the student's own login
      ["mgr-1", "org-a", "st-1"], // platform manager
      ["tech-b", "org-a", "st-1"], // another organization's professional
      ["tech-b", "org-b", "st-1"], // own organization, foreign student id
      ["stranger", "org-a", "st-1"], // unknown identity
    ];
    for (const [user, org, student] of attempts) {
      const plans = plansFor(db, scope(user, org));
      expect(
        await plans.create(student, { title: "x", input: input() }),
        `${user}/${org} create`,
      ).toBeNull();
      expect(await plans.listForStudent(student), `${user} list`).toEqual([]);
      expect(await plans.findRevision(planId, revisionId), `${user} find`).toBe(
        null,
      );
      expect(
        await plans.saveDraft(planId, revisionId, input(6)),
        `${user} save`,
      ).toBe(false);
      expect(await plans.markReady(planId, revisionId), `${user} ready`).toBe(
        false,
      );
      expect(
        (await plans.newRevisionFrom(planId, revisionId)).status,
        `${user} copy`,
      ).toBe("not_found");
    }
    expect(await counts()).toEqual(before);
    const untouched = await plansFor(db, scope("tech-a")).findRevision(
      planId,
      revisionId,
    );
    expect(untouched?.revision.totalWeeks).toBe(12);
  });

  it("does not let a professional use a plan of another student's record", async () => {
    // tech-a2 owns st-2 but st-1's plan id must not open through that scope.
    const own = await plansFor(db, scope("tech-a2")).create("st-2", {
      title: "Outro aluno",
      input: input(),
    });
    expect(own).not.toBeNull();
    expect(
      await plansFor(db, scope("tech-a2")).findRevision(planId, revisionId),
    ).toBeNull();
    expect(
      await plansFor(db, scope("tech-a")).findRevision(
        own!.planId,
        own!.revisionId,
      ),
    ).toBeNull();
  });

  it("rejects invalid input and titles without storing anything", async () => {
    const before = await counts();
    const plans = plansFor(db, scope("tech-a"));
    await expect(
      plans.create("st-1", { title: "ok", input: input(5) }),
    ).rejects.toThrow();
    await expect(
      plans.create("st-1", { title: "ok", input: input(3, "2026-02-30") }),
    ).rejects.toThrow();
    await expect(
      plans.create("st-1", {
        title: "ok",
        input: { ...input(), schedule: "forged" },
      }),
    ).rejects.toThrow();
    for (const title of ["", "   ", "x".repeat(121), null, 7]) {
      await expect(
        plans.create("st-1", { title, input: input() }),
      ).rejects.toThrow("PLAN_TITLE_INVALID");
    }
    await expect(
      plans.saveDraft(planId, revisionId, input(4)),
    ).rejects.toThrow();
    expect(await counts()).toEqual(before);
  });

  it("saves changes only while the revision is a draft", async () => {
    const plans = plansFor(db, scope("tech-a"));
    expect(await plans.saveDraft(planId, revisionId, input(6, "2026-12-07", "AB")))
      .toBe(true);
    const saved = await plans.findRevision(planId, revisionId);
    expect(saved?.revision.input.phases).toHaveLength(6);
    expect(saved?.revision.schedule).toEqual(
      buildPeriodization(input(6, "2026-12-07", "AB")),
    );
    expect(saved?.revision.startDate).toBe("2026-12-07");
    expect(saved?.revision.totalWeeks).toBe(24);

    expect(await plans.markReady(planId, revisionId)).toBe(true);
    // A second call, and any edit after READY, change nothing.
    expect(await plans.markReady(planId, revisionId)).toBe(false);
    expect(await plans.saveDraft(planId, revisionId, input(3))).toBe(false);
    const frozen = await plans.findRevision(planId, revisionId);
    expect(frozen?.revision.state).toBe("READY");
    expect(frozen?.revision.readyAt).not.toBeNull();
    expect(frozen?.revision.input.phases).toHaveLength(6);
  });

  it("copies a ready revision into a new draft and keeps the original intact", async () => {
    const plans = plansFor(db, scope("tech-a"));
    const original = await plans.findRevision(planId, revisionId);
    const copy = await plans.newRevisionFrom(planId, revisionId);
    expect(copy.status).toBe("created");
    const copyId = (copy as { revisionId: string }).revisionId;
    expect(copyId).not.toBe(revisionId);

    // One open draft per plan: a second copy is refused, even in parallel.
    expect((await plans.newRevisionFrom(planId, revisionId)).status).toBe(
      "draft_open",
    );
    const draft = await plans.findRevision(planId, copyId);
    expect(draft?.revision.revisionNumber).toBe(2);
    expect(draft?.revision.state).toBe("DRAFT");
    expect(draft?.revision.basedOnRevisionId).toBe(revisionId);
    expect(draft?.revision.input).toEqual(original?.revision.input);
    // A draft cannot be copied: it is already editable.
    expect((await plans.newRevisionFrom(planId, copyId)).status).toBe(
      "not_found",
    );

    // Editing the copy does not change the earlier revision.
    expect(await plans.saveDraft(planId, copyId, input(3, "2027-01-04"))).toBe(
      true,
    );
    const after = await plans.findRevision(planId, revisionId);
    expect(after?.revision).toEqual(original?.revision);

    expect(await plans.markReady(planId, copyId)).toBe(true);
    const racers = await Promise.all([
      plans.newRevisionFrom(planId, copyId),
      plans.newRevisionFrom(planId, copyId),
    ]);
    expect(racers.map((r) => r.status).sort()).toEqual([
      "created",
      "draft_open",
    ]);
    const listed = await plans.listForStudent("st-1");
    expect(listed[0].revisions.map((r) => [r.revisionNumber, r.state])).toEqual(
      [
        [3, "DRAFT"],
        [2, "READY"],
        [1, "READY"],
      ],
    );
  });

  it("records who did what without any plan content", async () => {
    const events = await db
      .prepare(
        `SELECT action, actor_user_id AS actor FROM training_plan_events
         WHERE plan_id = ?1 ORDER BY created_at, rowid`,
      )
      .bind(planId)
      .all<{ action: string; actor: string }>();
    expect(events.results.map((e) => e.action)).toEqual([
      "PLAN_CREATED",
      "DRAFT_SAVED",
      "MARKED_READY",
      "REVISION_CREATED",
      "DRAFT_SAVED",
      "MARKED_READY",
      "REVISION_CREATED",
    ]);
    expect(new Set(events.results.map((e) => e.actor))).toEqual(
      new Set(["tech-a"]),
    );
    // Refused attempts left no trace in the trail either.
    const total = await db
      .prepare("SELECT COUNT(*) AS n FROM training_plan_events WHERE plan_id = ?1")
      .bind(planId)
      .first<{ n: number }>();
    expect(total?.n).toBe(7);
  });
});

describe("access that ends", () => {
  it("stops reading and writing as soon as the assignment, membership or identity is revoked", async () => {
    const plans = plansFor(db, scope("tech-a"));
    const created = await plans.create("st-3", {
      title: "Plano",
      input: input(),
    });
    expect(created).not.toBeNull();
    const { planId, revisionId } = created!;

    await db
      .prepare(
        "UPDATE care_assignments SET revoked_at = '2026-11-01T00:00:00.000Z' WHERE student_id = 'st-3'",
      )
      .run();
    expect(await plans.listForStudent("st-3")).toEqual([]);
    expect(await plans.findRevision(planId, revisionId)).toBeNull();
    expect(await plans.saveDraft(planId, revisionId, input(6))).toBe(false);
    expect(await plans.markReady(planId, revisionId)).toBe(false);

    await db
      .prepare(
        "UPDATE care_assignments SET revoked_at = NULL WHERE student_id = 'st-3'",
      )
      .run();
    expect(await plans.findRevision(planId, revisionId)).not.toBeNull();

    await db
      .prepare("UPDATE memberships SET revoked_at = '2026-11-01T00:00:00.000Z' WHERE user_id = 'tech-a'")
      .run();
    expect(await plans.findRevision(planId, revisionId)).toBeNull();
    await db
      .prepare("UPDATE memberships SET revoked_at = NULL WHERE user_id = 'tech-a'")
      .run();

    await db
      .prepare("UPDATE users SET disabled_at = '2026-11-01T00:00:00.000Z' WHERE id = 'tech-a'")
      .run();
    expect(await plans.findRevision(planId, revisionId)).toBeNull();
    expect(await plans.saveDraft(planId, revisionId, input(6))).toBe(false);
    await db.prepare("UPDATE users SET disabled_at = NULL WHERE id = 'tech-a'").run();
    expect(await plans.findRevision(planId, revisionId)).not.toBeNull();
  });

  it("keeps plans out of every other table a student or manager can read", async () => {
    // The only places that mention plans are the plan tables themselves and the student's log of a
    // delivered revision, which points at it and copies nothing back.
    const tables = await db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table'
         AND sql LIKE '%plan_revisions%' ORDER BY name`,
      )
      .all<{ name: string }>();
    expect(tables.results.map((t) => t.name)).toEqual([
      "plan_revisions",
      "prescribed_exercises",
      "training_plan_events",
      "workout_sessions",
    ]);
  });
});
