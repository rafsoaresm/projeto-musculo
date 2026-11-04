/**
 * Worker used only by tests/motor-measure.test.ts (MOTOR_MEASURE=1): bundled with esbuild and run inside Miniflare's workerd with a
 * local D1, so the engine's CPU and the proposal writes are measured in the Workers runtime, not in Node. Timing is taken by the
 * caller around each request (inside workerd the clock only moves on I/O). Not part of the app bundle.
 */
import type { D1Database } from "@cloudflare/workers-types";
import { plansFor } from "@/db/plans";
import { prescriptionFor } from "@/db/prescription";
import { proposalsFor } from "@/db/prescription-proposals";
import { studentSessionsFor } from "@/db/workout-sessions";
import { generate, workUnits, type EngineInput, type EngineResult } from "@/modules/prescricao/motor";
import { structureFacts } from "@/modules/prescricao/automatica/facts";
import { buildPeriodization } from "@/modules/training/periodization";
import { baseInput, CATALOG, exercise, structure } from "./motor-fixtures";

interface Env {
  DB: D1Database;
}
interface Shape {
  phases: number;
  weeks: number;
  sessionsPerWeek: number;
  labels: number;
  items: number;
  catalog: number;
}
const ctx = { userId: "tech-a", organizationId: "org-a" };

/** A synthetic periodization of the given shape over a library of `catalog` exercises (copies of the fixtures). */
function inputOf(shape: Shape): EngineInput {
  const catalog = Array.from({ length: shape.catalog }, (_, n) => {
    const base = CATALOG[n % CATALOG.length];
    return exercise({ ...base, id: `${base.id}-${n}`, name: `${base.name} ${n}` });
  });
  const labels = Array.from({ length: shape.labels }, (_, n) => String.fromCharCode(65 + n));
  return baseInput({
    catalog,
    structure: structure(
      "2026-11-09",
      Array.from({ length: shape.phases }, (_, p) => ({
        weeks: shape.weeks,
        sessionsPerWeek: shape.sessionsPerWeek,
        stimulus: p % 2 ? "STRENGTH" : "HYPERTROPHY",
        workouts: labels.map((label) => ({ label, exerciseTarget: shape.items })),
      })),
    ),
  });
}

/** The synthetic library's ids are not rows of `exercises` (foreign key): map each to one of the 64 system exercises. */
function onSystemLibrary(generated: EngineResult): EngineResult {
  const ids = [...new Set(generated.occurrences.flatMap((o) => o.items.map((i) => i.exerciseId ?? "")))].sort();
  const sys = new Map(ids.map((id, n) => [id, `sys-${String((n % 64) + 1).padStart(3, "0")}`]));
  return { ...generated, occurrences: generated.occurrences.map((o) => ({ ...o, items: o.items.map((i) => ({ ...i, exerciseId: i.exerciseId ? sys.get(i.exerciseId)! : null })) })) };
}

/** A real v2 periodization of the given shape (saved through plansFor, so the schedule is the app's own). */
function v2Input(shape: Shape) {
  const labels = Array.from({ length: shape.labels }, (_, n) => String.fromCharCode(65 + n));
  return {
    schemaVersion: 2,
    startDate: "2026-11-23",
    phases: Array.from({ length: shape.phases }, () => ({
      weeks: shape.weeks,
      sessionsPerWeek: shape.sessionsPerWeek,
      // The saved target goes to 20 (0.93); a workout may still hold up to MAX_PER_WORKOUT = 30 rows (added by hand or by time).
      workouts: labels.map((label) => ({ label, exerciseTarget: Math.min(shape.items, 20) })),
    })),
  };
}

async function body<T>(request: Request): Promise<T> {
  return (await request.json()) as T;
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/noop") return Response.json({ ok: true });
    if (path === "/engine") {
      const input = inputOf(await body<Shape>(request));
      const result = generate(input);
      const items = result.occurrences.reduce((a, o) => a + o.items.length, 0);
      return Response.json({ units: workUnits(input), occurrences: result.occurrences.length, items, bytes: JSON.stringify(result).length });
    }
    if (path === "/plan") {
      const created = await plansFor(env.DB, ctx).create("st-1", {
        title: "Medição",
        input: { schemaVersion: 2, startDate: "2026-11-23", phases: [{ weeks: 1, sessionsPerWeek: 1, workouts: [{ label: "A", exerciseTarget: 3 }] }] } as never,
      });
      return Response.json(created);
    }
    if (path === "/write") {
      const { shape, planId, revisionId } = await body<{ shape: Shape; planId: string; revisionId: string }>(request);
      const result = onSystemLibrary(generate(inputOf(shape)));
      const cv = await env.DB.prepare("SELECT content_version AS v FROM plan_revisions WHERE id = ?1").bind(revisionId).first<{ v: number }>();
      const out = await proposalsFor(env.DB, ctx).recordGeneration(planId, revisionId, {
        idempotencyKey: crypto.randomUUID(), requestHash: "0".repeat(64), scope: "FULL", scopeJson: {}, baseContentVersion: cv!.v,
        catalogHash: "0".repeat(64), inputHash: "0".repeat(64), facts: {}, studentId: "st-1", inputJson: null, parameters: {},
      }, result);
      const items = result.occurrences.reduce((a, o) => a + o.items.length, 0);
      return Response.json({ out, occurrences: result.occurrences.length, items });
    }
    if (path === "/apply-setup") {
      // A proposal generated over the revision's own saved schedule (so every session joins), recorded as S6 does.
      const shape = await body<Shape>(request);
      const input = v2Input(shape);
      let created: { planId: string; revisionId: string };
      try {
        created = (await plansFor(env.DB, ctx).create("st-1", { title: "Aplicação", input: input as never }))!;
      } catch (error) {
        return new Response(JSON.stringify((error as { issues?: unknown }).issues ?? String(error)), { status: 500 });
      }
      const structure = structureFacts(buildPeriodization(input));
      const engineInput = { ...inputOf(shape), structure: { ...structure, phases: structure.phases.map((ph, n) => ({ ...ph, workouts: ph.workouts.map((w) => ({ ...w, exerciseTarget: shape.items })), stimulus: { value: n % 2 ? "STRENGTH" : "HYPERTROPHY", source: "STRUCTURE" as const, basis: "PROFESSIONAL" as const } })) } };
      const result = onSystemLibrary(generate(engineInput));
      const out = await proposalsFor(env.DB, ctx).recordGeneration(created.planId, created.revisionId, {
        idempotencyKey: crypto.randomUUID(), requestHash: "0".repeat(64), scope: "FULL", scopeJson: {}, baseContentVersion: 0,
        catalogHash: "0".repeat(64), inputHash: "0".repeat(64), facts: {}, studentId: "st-1", inputJson: null, parameters: {},
      }, result);
      const items = result.occurrences.reduce((a, o) => a + o.items.length, 0);
      return Response.json({ ...created, out, occurrences: result.occurrences.length, items });
    }
    if (path === "/apply") {
      const { planId, revisionId, proposalId } = await body<{ planId: string; revisionId: string; proposalId: string }>(request);
      const out = await proposalsFor(env.DB, ctx).apply(planId, revisionId, proposalId, {
        idempotencyKey: crypto.randomUUID(), requestHash: "0".repeat(64), expectedVersion: 1, conflictMode: "PRESERVE", confirmedWorkouts: [], confirmInfeasible: true,
      });
      const doses = await env.DB.prepare("SELECT COUNT(*) AS n FROM prescribed_exercise_occurrences WHERE revision_id = ?1").bind(revisionId).first<{ n: number }>();
      return Response.json({ out, doses: doses?.n ?? 0 });
    }
    if (path === "/execution-setup") {
      const plans = plansFor(env.DB, ctx);
      const rx = prescriptionFor(env.DB, ctx);
      const created = (await plans.create("st-1", {
        title: "Execução",
        input: { startDate: "2026-11-02", phases: Array.from({ length: 3 }, () => ({ weeks: 4, sessionsPerWeek: 3, split: "Full Body", exercisesPerSession: 20 })) } as never,
      }))!;
      const ids = (await env.DB.prepare("SELECT id FROM exercises WHERE organization_id IS NULL ORDER BY id LIMIT 30").all<{ id: string }>()).results;
      for (const { id } of ids) await rx.add(created.planId, created.revisionId, { phaseIndex: 1, workoutLabel: "Full Body" }, { exerciseId: id }, { sets: "3", reps: "10" });
      await plans.markReady(created.planId, created.revisionId);
      await plans.approve(created.planId, created.revisionId, { screeningNotRecorded: true });
      await plans.deliver(created.planId, created.revisionId);
      const rows = await rx.list(created.planId, created.revisionId);
      return Response.json({ planId: created.planId, prescribed: rows.map((r) => r.id) });
    }
    if (path === "/execution-save") {
      const { planId, prescribed, sets, performedOn } = await body<{ planId: string; prescribed: string[]; sets: number; performedOn: string }>(request);
      const out = await studentSessionsFor(env.DB, "client-1").save("st-1", {
        planId, phaseIndex: 1, workoutLabel: "Full Body", performedOn, effort: 7,
        exercises: prescribed.map((id) => ({ prescribedExerciseId: id, done: true, sets: Array.from({ length: sets }, (_, n) => ({ reps: 10, loadKg: 20 + n })) })),
      });
      return Response.json({ out });
    }
    return new Response("not found", { status: 404 });
  },
};

export default worker;
