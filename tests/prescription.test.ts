import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { plansFor } from "@/db/plans";
import { exercisesFor } from "@/db/exercises";
import { prescriptionFor, type PrescribedItem } from "@/db/prescription";
import { MAX_PER_WORKOUT } from "@/modules/prescricao/contracts";
import { progressOf, workoutSlots } from "@/modules/prescricao/summary";
import { buildPeriodization } from "@/modules/training/periodization";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// Real local D1 with the six migrations. Identities are rows, as the server
// derives them from a verified session.
let mf: Miniflare;
let db: D1Database;
const scope = (userId: string, organizationId = "org-a") => ({ userId, organizationId });
const phases = (count: number, split = "ABC", exercisesPerSession = 3) =>
  Array.from({ length: count }, () => ({
    weeks: 4,
    sessionsPerWeek: 3,
    split,
    exercisesPerSession,
  }));
const input = (count = 3, split = "ABC", target = 3) => ({
  startDate: "2026-11-02",
  phases: phases(count, split, target),
});
const A1 = { phaseIndex: 1, workoutLabel: "A" };
const B1 = { phaseIndex: 1, workoutLabel: "B" };
const A2 = { phaseIndex: 2, workoutLabel: "A" };


const itemsRaw = () =>
  db
    .prepare("SELECT COUNT(*) AS n, COUNT(DISTINCT id) AS ids FROM prescribed_exercises")
    .first<{ n: number; ids: number }>();
const mine = (plan: { planId: string; revisionId: string }) =>
  prescriptionFor(db, scope("tech-a")).list(plan.planId, plan.revisionId);
const idOf = (outcome: { status: string }) => (outcome as unknown as { id: string }).id;

// A fresh plan per test, so tests do not depend on each other's rows.
async function newPlan(count = 3, split = "ABC", target = 3, student = "st-1") {
  const created = await plansFor(db, scope("tech-a")).create(student, {
    title: `Plano ${crypto.randomUUID().slice(0, 6)}`,
    input: input(count, split, target),
  });
  return created!;
}

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "prescription-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  const people = ["owner-a", "tech-a", "tech-a2", "commercial-a", "owner-b", "tech-b", "client-1", "mgr-1"];
  await db.batch([
    ...people.map((id) =>
      db
        .prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)")
        .bind(id, `${id}@example.test`),
    ),
    db.prepare(
      "INSERT INTO users(id) VALUES ('owner-a'),('tech-a'),('tech-a2'),('commercial-a'),('owner-b'),('tech-b'),('client-1'),('mgr-1')",
    ),
    db.prepare("INSERT INTO platform_admins(user_id) VALUES ('mgr-1')"),
    db.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','Studio A'),('org-b','Studio B')"),
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
       ('st-1','org-a','Student One'),('st-2','org-a','Student Two'),('st-b','org-b','Student B')`,
    ),
    db.prepare(
      `INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES
       ('org-a','st-1','pro-a'),('org-a','st-2','pro-a2'),('org-b','st-b','pro-b')`,
    ),
    db.prepare("INSERT INTO student_access(organization_id,student_id,user_id) VALUES ('org-a','st-1','client-1')"),
  ]);
});
afterAll(async () => {
  await mf.dispose();
});

describe("who can prescribe", () => {
  it("refuses everyone without active technical access and writes nothing", async () => {
    const plan = await newPlan();
    const mineApi = prescriptionFor(db, scope("tech-a"));
    const seeded = idOf(await mineApi.add(plan.planId, plan.revisionId, A1, { customName: "Meu exercício" }));
    const before = await itemsRaw();
    const attempts: Array<[string, string]> = [
      ["tech-a2", "org-a"], // professional of another student
      ["owner-a", "org-a"], // owner without assignment
      ["commercial-a", "org-a"],
      ["client-1", "org-a"], // the student's own login
      ["mgr-1", "org-a"], // platform manager
      ["tech-b", "org-a"],
      ["tech-b", "org-b"],
      ["stranger", "org-a"],
    ];
    for (const [user, org] of attempts) {
      const api = prescriptionFor(db, scope(user, org));
      const label = `${user}/${org}`;
      expect(await api.list(plan.planId, plan.revisionId), `${label} list`).toEqual([]);
      expect(await api.openDraft(plan.planId, plan.revisionId), `${label} open`).toBeNull();
      expect((await api.add(plan.planId, plan.revisionId, A1, { customName: "Invasor" })).status, `${label} add`).toBe("not_found");
      expect(await api.update(plan.planId, plan.revisionId, seeded, {}, "Alterado"), `${label} update`).toBe(false);
      expect(await api.remove(plan.planId, plan.revisionId, seeded), `${label} remove`).toBe(false);
      expect(await api.reorder(plan.planId, plan.revisionId, A1, [seeded]), `${label} reorder`).toBe(false);
      expect((await api.duplicate(plan.planId, plan.revisionId, seeded)).status, `${label} duplicate`).toBe("not_found");
      expect(await api.replaceExercise(plan.planId, plan.revisionId, seeded, "sys-001"), `${label} replace`).toBe(false);
      expect((await api.copyWorkout(plan.planId, plan.revisionId, A1, B1)).status, `${label} copy`).toBe("not_found");
    }
    expect(await itemsRaw()).toEqual(before);
    expect((await mine(plan))[0].name).toBe("Meu exercício");
  });

  it("stops at once when the assignment is revoked or the identity is blocked", async () => {
    const plan = await newPlan();
    const api = prescriptionFor(db, scope("tech-a"));
    const id = idOf(await api.add(plan.planId, plan.revisionId, A1, { customName: "Cortável" }));
    await db.prepare("UPDATE care_assignments SET revoked_at = '2026-11-01T00:00:00.000Z' WHERE student_id = 'st-1'").run();
    expect(await api.list(plan.planId, plan.revisionId)).toEqual([]);
    expect((await api.add(plan.planId, plan.revisionId, A1, { customName: "Tarde" })).status).toBe("not_found");
    expect(await api.remove(plan.planId, plan.revisionId, id)).toBe(false);
    await db.prepare("UPDATE care_assignments SET revoked_at = NULL WHERE student_id = 'st-1'").run();
    await db.prepare("UPDATE users SET disabled_at = '2026-11-01T00:00:00.000Z' WHERE id = 'tech-a'").run();
    expect(await api.list(plan.planId, plan.revisionId)).toEqual([]);
    await db.prepare("UPDATE users SET disabled_at = NULL WHERE id = 'tech-a'").run();
    expect((await api.list(plan.planId, plan.revisionId)).length).toBe(1);
  });
});

describe("adding exercises", () => {
  it("snapshots the library exercise and never follows later library changes", async () => {
    const plan = await newPlan();
    const library = exercisesFor(db, scope("tech-a"));
    const own = (await library.create({ name: "Remada do meu jeito", category: "Puxar", videoUrl: "https://www.youtube.com/watch?v=abc123" })) as { id: string };
    const api = prescriptionFor(db, scope("tech-a"));
    const fromSystem = idOf(await api.add(plan.planId, plan.revisionId, A1, { exerciseId: "sys-001" }));
    const fromOwn = idOf(await api.add(plan.planId, plan.revisionId, A1, { exerciseId: own.id }));
    let items = await mine(plan);
    const sys = items.find((i) => i.id === fromSystem) as PrescribedItem;
    expect(sys).toMatchObject({
      exerciseId: "sys-001",
      name: "Agachamento goblet",
      videoStatus: "SEARCH_LINK",
      origin: "PROFESSIONAL",
      sets: null,
      reps: null,
      loadInstruction: null,
      cadence: null,
      restSeconds: null,
      rirMin: null,
    });
    expect(items.map((i) => i.position)).toEqual([1, 2]);

    // Editing, archiving or renaming the library exercise leaves the prescription alone.
    await library.update(own.id, { name: "Outro nome", category: "Puxar", videoUrl: "https://vimeo.com/999" });
    await library.archive(own.id);
    items = await mine(plan);
    const kept = items.find((i) => i.id === fromOwn) as PrescribedItem;
    expect(kept.name).toBe("Remada do meu jeito");
    expect(kept.videoUrl).toBe("https://www.youtube.com/watch?v=abc123");
    // An archived or foreign exercise cannot be added.
    expect((await api.add(plan.planId, plan.revisionId, A1, { exerciseId: own.id })).status).toBe("not_found");
    const foreign = (await exercisesFor(db, scope("owner-b", "org-b")).create({ name: "Só da B", category: "Core" })) as { id: string };
    expect((await api.add(plan.planId, plan.revisionId, A1, { exerciseId: foreign.id })).status).toBe("not_found");
    expect((await api.add(plan.planId, plan.revisionId, A1, { exerciseId: "nao-existe" })).status).toBe("not_found");
  });

  it("only accepts workouts that exist in the saved structure", async () => {
    const plan = await newPlan(3, "AB");
    const api = prescriptionFor(db, scope("tech-a"));
    for (const target of [
      { phaseIndex: 1, workoutLabel: "C" },
      { phaseIndex: 4, workoutLabel: "A" },
      { phaseIndex: 0, workoutLabel: "A" },
      { phaseIndex: 1, workoutLabel: "Full Body" },
      { phaseIndex: 1, workoutLabel: "a" },
    ]) {
      expect((await api.add(plan.planId, plan.revisionId, target, { customName: "X" })).status, JSON.stringify(target)).toBe("invalid_target");
    }
    expect((await api.add(plan.planId, plan.revisionId, { phaseIndex: 3, workoutLabel: "B" }, { customName: "Ok" })).status).toBe("saved");
    const fullBody = await newPlan(3, "Full Body");
    expect((await api.add(fullBody.planId, fullBody.revisionId, { phaseIndex: 1, workoutLabel: "Full Body" }, { customName: "FB" })).status).toBe("saved");
  });

  it("stores only the professional's own text and validates it", async () => {
    const plan = await newPlan();
    const api = prescriptionFor(db, scope("tech-a"));
    const id = idOf(
      await api.add(plan.planId, plan.revisionId, A1, { customName: "  Prancha  " }, {
        sets: "3-4", reps: "até a falha técnica", loadInstruction: "RPE 8", cadence: "3-0-1-0",
        restSeconds: 90, restText: "1 a 2 min", rirMin: 1, rirMax: 3, notes: "cuidado com o ombro",
      }),
    );
    expect((await mine(plan)).find((i) => i.id === id)).toMatchObject({
      name: "Prancha", exerciseId: null, sets: "3-4", reps: "até a falha técnica",
      loadInstruction: "RPE 8", cadence: "3-0-1-0", restSeconds: 90, restText: "1 a 2 min",
      rirMin: 1, rirMax: 3, notes: "cuidado com o ombro", videoStatus: "NONE",
    });
    const bad: unknown[] = [
      { sets: "x".repeat(21) }, { reps: "x".repeat(41) }, { loadInstruction: "x".repeat(121) },
      { cadence: "x".repeat(41) }, { restText: "x".repeat(41) }, { notes: "x".repeat(501) },
      { restSeconds: -1 }, { restSeconds: 3601 }, { restSeconds: 1.5 },
      { rirMin: -1 }, { rirMax: 11 }, { rirMin: 4, rirMax: 2 },
      { videoUrl: "http://www.youtube.com/watch?v=abc" }, { videoUrl: "https://exemplo.com/v" },
      { proprietario: "org-b" },
    ];
    const before = await itemsRaw();
    for (const fields of bad) {
      await expect(api.add(plan.planId, plan.revisionId, A1, { customName: "Inválido" }, fields), JSON.stringify(fields)).rejects.toThrow();
    }
    for (const name of ["", "   ", "x".repeat(121)]) {
      await expect(api.add(plan.planId, plan.revisionId, A1, { customName: name })).rejects.toThrow();
    }
    expect(await itemsRaw()).toEqual(before);
  });

  it("stops at the cap of a workout", async () => {
    const plan = await newPlan();
    const api = prescriptionFor(db, scope("tech-a"));
    for (let i = 0; i < MAX_PER_WORKOUT; i++)
      expect((await api.add(plan.planId, plan.revisionId, A1, { customName: `Ex ${i}` })).status).toBe("saved");
    expect((await api.add(plan.planId, plan.revisionId, A1, { customName: "Demais" })).status).toBe("full");
    const first = (await mine(plan))[0];
    expect((await api.duplicate(plan.planId, plan.revisionId, first.id)).status).toBe("full");
    expect((await mine(plan)).length).toBe(MAX_PER_WORKOUT);
    // Another workout is not affected.
    expect((await api.add(plan.planId, plan.revisionId, B1, { customName: "Livre" })).status).toBe("saved");
  });
});

describe("editing, ordering and removing", () => {
  it("edits values, keeps the library name, and tells an overridden video from the library's", async () => {
    const plan = await newPlan();
    const api = prescriptionFor(db, scope("tech-a"));
    const lib = idOf(await api.add(plan.planId, plan.revisionId, A1, { exerciseId: "sys-001" }));
    const custom = idOf(await api.add(plan.planId, plan.revisionId, A1, { customName: "Meu" }));
    expect(await api.update(plan.planId, plan.revisionId, lib, { sets: "3", reps: "8-12" }, "Nome trocado")).toBe(true);
    let items = await mine(plan);
    let libItem = items.find((i) => i.id === lib) as PrescribedItem;
    // The name of a library exercise is not editable; the library's search link stays.
    expect(libItem).toMatchObject({ name: "Agachamento goblet", sets: "3", reps: "8-12", videoStatus: "SEARCH_LINK" });
    expect(libItem.videoUrl).toContain("youtube.com/results");
    // A video typed here overrides only this prescription and is not "reviewed".
    await api.update(plan.planId, plan.revisionId, lib, { videoUrl: "https://vimeo.com/123" });
    libItem = (await mine(plan)).find((i) => i.id === lib) as PrescribedItem;
    expect(libItem).toMatchObject({ videoUrl: "https://vimeo.com/123", videoStatus: "UNVERIFIED" });
    expect((await exercisesFor(db, scope("tech-a")).find("sys-001"))?.videoStatus).toBe("SEARCH_LINK");
    // Saving again with the same link does not change the status; clearing it does.
    await api.update(plan.planId, plan.revisionId, lib, { videoUrl: "https://vimeo.com/123", notes: "n" });
    expect(((await mine(plan)).find((i) => i.id === lib) as PrescribedItem).videoStatus).toBe("UNVERIFIED");
    // Fields that are not sent stay; an explicit null clears.
    await api.update(plan.planId, plan.revisionId, lib, {});
    expect((await mine(plan)).find((i) => i.id === lib)).toMatchObject({ sets: "3", reps: "8-12", videoUrl: "https://vimeo.com/123" });
    await api.update(plan.planId, plan.revisionId, lib, { videoUrl: null, sets: null });
    expect((await mine(plan)).find((i) => i.id === lib)).toMatchObject({ videoUrl: null, videoStatus: "NONE", sets: null, reps: "8-12" });
    // A custom exercise can be renamed.
    await api.update(plan.planId, plan.revisionId, custom, {}, "Renomeado");
    items = await mine(plan);
    expect(items.find((i) => i.id === custom)?.name).toBe("Renomeado");
    expect(await api.update(plan.planId, plan.revisionId, "inexistente", {})).toBe(false);
  });

  it("reorders only with the exact set of ids and keeps positions unique", async () => {
    const plan = await newPlan();
    const api = prescriptionFor(db, scope("tech-a"));
    const ids = [];
    for (const name of ["Um", "Dois", "Três"]) ids.push(idOf(await api.add(plan.planId, plan.revisionId, A1, { customName: name })));
    const other = idOf(await api.add(plan.planId, plan.revisionId, B1, { customName: "Do B" }));
    expect(await api.reorder(plan.planId, plan.revisionId, A1, [ids[2], ids[0], ids[1]])).toBe(true);
    expect((await mine(plan)).filter((i) => i.workoutLabel === "A").map((i) => i.name)).toEqual(["Três", "Um", "Dois"]);
    const before = await mine(plan);
    for (const wrong of [[ids[0]], [ids[0], ids[1], ids[2], other], [ids[0], ids[0], ids[1]], [ids[0], ids[1], other], []]) {
      expect(await api.reorder(plan.planId, plan.revisionId, A1, wrong), JSON.stringify(wrong)).toBe(false);
    }
    expect(await api.reorder(plan.planId, plan.revisionId, { phaseIndex: 1, workoutLabel: "Z" }, ids)).toBe(false);
    expect(await mine(plan)).toEqual(before);
    expect((await mine(plan)).filter((i) => i.workoutLabel === "A").map((i) => i.position)).toEqual([1, 2, 3]);
  });

  it("removes an item, leaves a gap that the next add does not reuse, and renumbers on reorder", async () => {
    const plan = await newPlan();
    const api = prescriptionFor(db, scope("tech-a"));
    const [a, b, c] = [
      idOf(await api.add(plan.planId, plan.revisionId, A1, { customName: "A" })),
      idOf(await api.add(plan.planId, plan.revisionId, A1, { customName: "B" })),
      idOf(await api.add(plan.planId, plan.revisionId, A1, { customName: "C" })),
    ];
    expect(await api.remove(plan.planId, plan.revisionId, b)).toBe(true);
    expect(await api.remove(plan.planId, plan.revisionId, b)).toBe(false);
    idOf(await api.add(plan.planId, plan.revisionId, A1, { customName: "D" }));
    expect((await mine(plan)).map((i) => [i.name, i.position])).toEqual([["A", 1], ["C", 3], ["D", 4]]);
    expect(await api.reorder(plan.planId, plan.revisionId, A1, [c, a, (await mine(plan))[2].id])).toBe(true);
    expect((await mine(plan)).map((i) => [i.name, i.position])).toEqual([["C", 1], ["A", 2], ["D", 3]]);
  });

  it("duplicates to the end and replaces the exercise keeping what was typed", async () => {
    const plan = await newPlan();
    const api = prescriptionFor(db, scope("tech-a"));
    const id = idOf(await api.add(plan.planId, plan.revisionId, A1, { exerciseId: "sys-001" }, { sets: "3", reps: "10", notes: "ok" }));
    const copy = await api.duplicate(plan.planId, plan.revisionId, id);
    expect(copy.status).toBe("saved");
    let items = await mine(plan);
    expect(items.map((i) => [i.name, i.sets, i.position])).toEqual([["Agachamento goblet", "3", 1], ["Agachamento goblet", "3", 2]]);
    expect(items[1].id).not.toBe(id);
    expect(await api.replaceExercise(plan.planId, plan.revisionId, id, "sys-002")).toBe(true);
    items = await mine(plan);
    expect(items[0]).toMatchObject({ exerciseId: "sys-002", name: "Leg press 45°", sets: "3", reps: "10", notes: "ok", position: 1 });
    expect(items[1].name).toBe("Agachamento goblet");
    const own = (await exercisesFor(db, scope("owner-b", "org-b")).create({ name: "Só da B 2", category: "Core" })) as { id: string };
    expect(await api.replaceExercise(plan.planId, plan.revisionId, id, own.id)).toBe(false);
    expect(await api.replaceExercise(plan.planId, plan.revisionId, id, "nao-existe")).toBe(false);
    expect((await mine(plan))[0].name).toBe("Leg press 45°");
  });

  it("copies a workout only into an empty one", async () => {
    const plan = await newPlan();
    const api = prescriptionFor(db, scope("tech-a"));
    await api.add(plan.planId, plan.revisionId, A1, { exerciseId: "sys-001" }, { sets: "3" });
    await api.add(plan.planId, plan.revisionId, A1, { customName: "Meu" }, { reps: "12" });
    expect(await api.copyWorkout(plan.planId, plan.revisionId, A1, A2)).toEqual({ status: "saved", count: 2 });
    const items = await mine(plan);
    const second = items.filter((i) => i.phaseIndex === 2);
    expect(second.map((i) => [i.name, i.sets, i.reps, i.position])).toEqual([["Agachamento goblet", "3", null, 1], ["Meu", null, "12", 2]]);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    // Editing the copy leaves the source as it was.
    await api.update(plan.planId, plan.revisionId, second[0].id, { sets: "5" });
    expect((await mine(plan)).find((i) => i.phaseIndex === 1 && i.position === 1)?.sets).toBe("3");
    // Nothing is overwritten, and bad targets are refused.
    expect((await api.copyWorkout(plan.planId, plan.revisionId, A1, A2)).status).toBe("destination_not_empty");
    expect((await api.copyWorkout(plan.planId, plan.revisionId, B1, { phaseIndex: 3, workoutLabel: "A" })).status).toBe("empty_source");
    expect((await api.copyWorkout(plan.planId, plan.revisionId, A1, A1)).status).toBe("invalid_target");
    expect((await api.copyWorkout(plan.planId, plan.revisionId, A1, { phaseIndex: 9, workoutLabel: "A" })).status).toBe("invalid_target");
  });
});

describe("a revision that is no longer a draft", () => {
  it("cannot be changed, and a copy gets its own rows", async () => {
    const plan = await newPlan();
    const plans = plansFor(db, scope("tech-a"));
    const api = prescriptionFor(db, scope("tech-a"));
    const a = idOf(await api.add(plan.planId, plan.revisionId, A1, { exerciseId: "sys-001" }, { sets: "3" }));
    await api.add(plan.planId, plan.revisionId, B1, { customName: "Meu B" });
    expect(await plans.markReady(plan.planId, plan.revisionId)).toBe(true);

    const frozen = await mine(plan);
    expect((await api.add(plan.planId, plan.revisionId, A1, { customName: "Tarde" })).status).toBe("not_found");
    expect(await api.update(plan.planId, plan.revisionId, a, { sets: "9" })).toBe(false);
    expect(await api.remove(plan.planId, plan.revisionId, a)).toBe(false);
    expect(await api.reorder(plan.planId, plan.revisionId, A1, [a])).toBe(false);
    expect((await api.duplicate(plan.planId, plan.revisionId, a)).status).toBe("not_found");
    expect(await api.replaceExercise(plan.planId, plan.revisionId, a, "sys-002")).toBe(false);
    expect((await api.copyWorkout(plan.planId, plan.revisionId, A1, A2)).status).toBe("not_found");
    expect(await mine(plan)).toEqual(frozen);

    // The copy carries the prescription under new ids, and editing it leaves the original.
    const next = await plans.newRevisionFrom(plan.planId, plan.revisionId);
    expect(next.status).toBe("created");
    const nextId = (next as { revisionId: string }).revisionId;
    const copied = await api.list(plan.planId, nextId);
    expect(copied.map((i) => [i.phaseIndex, i.workoutLabel, i.name, i.sets, i.position])).toEqual(
      frozen.map((i) => [i.phaseIndex, i.workoutLabel, i.name, i.sets, i.position]),
    );
    expect(copied.every((c) => !frozen.some((f) => f.id === c.id))).toBe(true);
    expect(await api.update(plan.planId, nextId, copied[0].id, { sets: "5" })).toBe(true);
    expect(await api.remove(plan.planId, nextId, copied[1].id)).toBe(true);
    expect(await mine(plan)).toEqual(frozen);
  });

  it("is not touched by a refused attempt on its sibling draft", async () => {
    // Both revisions of one plan share a workout label; rows must stay with their revision.
    const plan = await newPlan();
    const plans = plansFor(db, scope("tech-a"));
    const api = prescriptionFor(db, scope("tech-a"));
    await api.add(plan.planId, plan.revisionId, A1, { customName: "Original" });
    await plans.markReady(plan.planId, plan.revisionId);
    const nextId = ((await plans.newRevisionFrom(plan.planId, plan.revisionId)) as { revisionId: string }).revisionId;
    const copiedId = (await api.list(plan.planId, nextId))[0].id;
    // The copy's id used against the original revision does nothing.
    expect(await api.remove(plan.planId, plan.revisionId, copiedId)).toBe(false);
    expect((await api.list(plan.planId, plan.revisionId)).length).toBe(1);
    expect((await api.list(plan.planId, nextId)).length).toBe(1);
  });
});

describe("changing the structure under a prescription", () => {
  it("refuses a change that would remove a workout that has exercises", async () => {
    const plan = await newPlan(6, "ABC");
    const plans = plansFor(db, scope("tech-a"));
    const api = prescriptionFor(db, scope("tech-a"));
    const inSix = idOf(await api.add(plan.planId, plan.revisionId, { phaseIndex: 6, workoutLabel: "C" }, { customName: "Na fase 6" }));
    const before = await plans.findRevision(plan.planId, plan.revisionId);
    // Fewer phases, or a split without that letter, would lose the exercise.
    await expect(plans.saveDraft(plan.planId, plan.revisionId, input(3))).rejects.toThrow("PRESCRIPTION_WOULD_BE_LOST");
    await expect(plans.saveDraft(plan.planId, plan.revisionId, input(6, "AB"))).rejects.toThrow("PRESCRIPTION_WOULD_BE_LOST");
    expect(await plans.findRevision(plan.planId, plan.revisionId)).toEqual(before);
    expect((await mine(plan)).length).toBe(1);
    // A change that keeps every used workout is fine, including a new target.
    expect(await plans.saveDraft(plan.planId, plan.revisionId, input(6, "ABCD", 5))).toBe(true);
    expect((await plans.findRevision(plan.planId, plan.revisionId))?.revision.input.phases[0].exercisesPerSession).toBe(5);
    expect((await mine(plan)).length).toBe(1);
    // Once the exercise is removed, the structure can shrink.
    expect(await api.remove(plan.planId, plan.revisionId, inSix)).toBe(true);
    expect(await plans.saveDraft(plan.planId, plan.revisionId, input(3))).toBe(true);
  });
});

describe("progress against the target", () => {
  it("counts exercises per workout and never fills a gap", async () => {
    const plan = await newPlan(3, "AB", 3);
    const api = prescriptionFor(db, scope("tech-a"));
    for (const name of ["1", "2", "3"]) await api.add(plan.planId, plan.revisionId, A1, { customName: name });
    await api.add(plan.planId, plan.revisionId, B1, { customName: "4" });
    for (const name of ["5", "6", "7", "8"]) await api.add(plan.planId, plan.revisionId, A2, { customName: name });
    const schedule = buildPeriodization(input(3, "AB", 3));
    expect(workoutSlots(schedule)).toHaveLength(6);
    const progress = progressOf(schedule, await mine(plan));
    const status = (phaseIndex: number, label: string) =>
      progress.find((p) => p.phaseIndex === phaseIndex && p.label === label);
    expect(status(1, "A")).toMatchObject({ count: 3, target: 3, status: "MET" });
    expect(status(1, "B")).toMatchObject({ count: 1, status: "BELOW" });
    expect(status(2, "A")).toMatchObject({ count: 4, status: "ABOVE" });
    expect(status(3, "A")).toMatchObject({ count: 0, status: "BELOW" });
    expect(await mine(plan)).toHaveLength(8);
  });
});

describe("trail", () => {
  it("records the actor and the fact, never the content", async () => {
    const plan = await newPlan();
    const api = prescriptionFor(db, scope("tech-a"));
    await api.add(plan.planId, plan.revisionId, A1, { customName: "Segredo clínico" }, { notes: "lesão no joelho" });
    await api.add(plan.planId, plan.revisionId, A1, { customName: "Refused" }, { sets: "x".repeat(99) }).catch(() => undefined);
    const rows = await db
      .prepare("SELECT action, actor_user_id AS actor FROM training_plan_events WHERE plan_id = ?1 ORDER BY rowid")
      .bind(plan.planId)
      .all<{ action: string; actor: string }>();
    expect(rows.results.map((r) => r.action)).toEqual(["PLAN_CREATED", "PRESCRIPTION_EDITED"]);
    expect(JSON.stringify(rows.results)).not.toContain("Segredo");
    expect(JSON.stringify(rows.results)).not.toContain("joelho");
  });
});

describe("overview of plans and pending prescription", () => {
  it("lists only the newest revision of the plans the user reaches, open drafts first", async () => {
    // tech-a2 reaches only st-2, so nothing from the tests above shows up.
    const mineB = (user: string, org = "org-a") => plansFor(db, scope(user, org)).overview();
    const rx = prescriptionFor(db, scope("tech-a2"));
    const plans = plansFor(db, scope("tech-a2"));
    expect(await mineB("tech-a2")).toEqual([]);

    const first = (await plans.create("st-2", { title: "Primeiro", input: input(3, "ABC", 3) }))!;
    for (const name of ["a", "b", "c"]) await rx.add(first.planId, first.revisionId, A1, { customName: name });
    await rx.add(first.planId, first.revisionId, B1, { customName: "d" });
    await plans.markReady(first.planId, first.revisionId);
    const second = (await plans.create("st-2", { title: "Segundo", input: input(3, "AB", 3) }))!;

    let rows = await mineB("tech-a2");
    // The open draft comes first even though the other plan is older.
    expect(rows.map((r) => [r.title, r.state, r.revisionNumber])).toEqual([
      ["Segundo", "DRAFT", 1],
      ["Primeiro", "READY", 1],
    ]);
    expect(rows[0]).toMatchObject({ studentId: "st-2", studentName: "Student Two", exercises: 0, workouts: 6, below: 6 });
    // 9 workouts (3 phases x ABC); A of phase 1 met its target of 3, B has 1 of 3.
    expect(rows[1]).toMatchObject({ exercises: 4, workouts: 9, below: 8 });
    expect(rows[1].totalWeeks).toBe(12);

    // A newer revision replaces the older one in the list, and carries its own counts.
    const next = (await plans.newRevisionFrom(first.planId, first.revisionId)) as { revisionId: string };
    await rx.add(first.planId, next.revisionId, A2, { customName: "e" });
    rows = await mineB("tech-a2");
    expect(rows.filter((r) => r.planId === first.planId)).toHaveLength(1);
    expect(rows.find((r) => r.planId === first.planId)).toMatchObject({
      revisionNumber: 2, state: "DRAFT", exercises: 5, below: 8,
    });
    expect(second.planId).not.toBe(first.planId);

    // Nobody else sees any of it.
    for (const [user, org] of [
      ["tech-a", "org-a"], ["owner-a", "org-a"], ["commercial-a", "org-a"],
      ["client-1", "org-a"], ["mgr-1", "org-a"], ["tech-b", "org-b"], ["tech-b", "org-a"], ["stranger", "org-a"],
    ]) {
      const seen = await mineB(user, org);
      expect(seen.some((r) => r.studentId === "st-2"), `${user}/${org}`).toBe(false);
    }
  });

  it("stops listing a student's plans when the assignment is revoked", async () => {
    const plans = plansFor(db, scope("tech-a2"));
    expect((await plans.overview()).length).toBeGreaterThan(0);
    await db.prepare("UPDATE care_assignments SET revoked_at = '2026-11-01T00:00:00.000Z' WHERE student_id = 'st-2'").run();
    expect(await plans.overview()).toEqual([]);
    await db.prepare("UPDATE care_assignments SET revoked_at = NULL WHERE student_id = 'st-2'").run();
    expect((await plans.overview()).length).toBeGreaterThan(0);
  });
});

describe("copying a whole mesocycle", () => {
  const mixed = {
    startDate: "2026-11-02",
    phases: [
      { weeks: 4, sessionsPerWeek: 3, split: "ABC", exercisesPerSession: 3 },
      { weeks: 4, sessionsPerWeek: 2, split: "AB", exercisesPerSession: 3 },
      { weeks: 4, sessionsPerWeek: 3, split: "ABC", exercisesPerSession: 3 },
    ],
  };
  it("copies workout by workout into a phase with no exercises, under new ids", async () => {
    const plan = await newPlan();
    const api = prescriptionFor(db, scope("tech-a"));
    await api.add(plan.planId, plan.revisionId, A1, { exerciseId: "sys-001" }, { sets: "3", reps: "10" });
    await api.add(plan.planId, plan.revisionId, A1, { customName: "Meu" }, { notes: "x" });
    await api.add(plan.planId, plan.revisionId, B1, { customName: "Do B" });
    expect(await api.copyPhase(plan.planId, plan.revisionId, 1, 2)).toEqual({ status: "saved", copied: 3, skipped: [] });
    const items = await mine(plan);
    const second = items.filter((i) => i.phaseIndex === 2);
    expect(second.map((i) => [i.workoutLabel, i.name, i.sets, i.position])).toEqual([
      ["A", "Agachamento goblet", "3", 1], ["A", "Meu", null, 2], ["B", "Do B", null, 1],
    ]);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    // Editing the copy leaves the source phase as it was.
    await api.update(plan.planId, plan.revisionId, second[0].id, { sets: "9" });
    expect(((await mine(plan)).find((i) => i.phaseIndex === 1 && i.position === 1 && i.workoutLabel === "A"))?.sets).toBe("3");
    // Nothing already prescribed is overwritten.
    expect((await api.copyPhase(plan.planId, plan.revisionId, 1, 2)).status).toBe("destination_not_empty");
    expect((await api.copyPhase(plan.planId, plan.revisionId, 2, 1)).status).toBe("destination_not_empty");
    expect((await api.copyPhase(plan.planId, plan.revisionId, 3, 1)).status).toBe("empty_source");
    expect((await api.copyPhase(plan.planId, plan.revisionId, 1, 1)).status).toBe("invalid_target");
    expect((await api.copyPhase(plan.planId, plan.revisionId, 1, 9)).status).toBe("invalid_target");
    expect((await api.copyPhase(plan.planId, plan.revisionId, 0, 3)).status).toBe("invalid_target");
  });

  it("reports workouts the destination does not have instead of forcing them elsewhere", async () => {
    const created = (await plansFor(db, scope("tech-a")).create("st-1", { title: "Misto", input: mixed }))!;
    const api = prescriptionFor(db, scope("tech-a"));
    await api.add(created.planId, created.revisionId, A1, { customName: "No A" });
    await api.add(created.planId, created.revisionId, { phaseIndex: 1, workoutLabel: "C" }, { customName: "No C" });
    // Phase 2 is AB: only A comes along and C is reported.
    expect(await api.copyPhase(created.planId, created.revisionId, 1, 2)).toEqual({ status: "saved", copied: 1, skipped: ["C"] });
    expect((await mine(created)).filter((i) => i.phaseIndex === 2).map((i) => [i.workoutLabel, i.name])).toEqual([["A", "No A"]]);
    // Phase 3 is ABC, and a source with only C has nothing in common with an AB destination.
    await api.add(created.planId, created.revisionId, { phaseIndex: 3, workoutLabel: "C" }, { customName: "Só C" });
    const onlyC = (await plansFor(db, scope("tech-a")).create("st-1", { title: "Só C", input: mixed }))!;
    await api.add(onlyC.planId, onlyC.revisionId, { phaseIndex: 1, workoutLabel: "C" }, { customName: "C" });
    expect((await api.copyPhase(onlyC.planId, onlyC.revisionId, 1, 2)).status).toBe("no_common_workouts");
    expect((await mine(onlyC)).filter((i) => i.phaseIndex === 2)).toEqual([]);
  });

  it("is refused for anyone without access and for a closed revision", async () => {
    const plan = await newPlan();
    const api = prescriptionFor(db, scope("tech-a"));
    await api.add(plan.planId, plan.revisionId, A1, { customName: "X" });
    const before = await itemsRaw();
    for (const [user, org] of [["tech-a2", "org-a"], ["owner-a", "org-a"], ["commercial-a", "org-a"], ["client-1", "org-a"], ["mgr-1", "org-a"], ["tech-b", "org-b"]]) {
      expect((await prescriptionFor(db, scope(user, org)).copyPhase(plan.planId, plan.revisionId, 1, 2)).status, user).toBe("not_found");
    }
    expect(await itemsRaw()).toEqual(before);
    await plansFor(db, scope("tech-a")).markReady(plan.planId, plan.revisionId);
    expect((await api.copyPhase(plan.planId, plan.revisionId, 1, 2)).status).toBe("not_found");
    expect(await itemsRaw()).toEqual(before);
  });
});
