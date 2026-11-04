import { describe, expect, it } from "vitest";
import {
  STRUCTURE_LIMITS,
  parsePeriodizationInput,
  periodizationInputSchema,
  periodizationInputSchemaV2,
  type PeriodizationInputV1,
  type PeriodizationInputV2,
  type PhaseInputV2,
} from "@/modules/training/contracts";
import {
  buildPeriodization,
  convertV1ToV2,
  convertV2ToV1,
  phaseDivisionText,
  phaseName,
  phaseTarget,
  phaseTargetText,
  phaseWorkoutLabels,
  phaseWorkouts,
} from "@/modules/training/periodization";
import { dayLabel, nextLabel, spreadDays, structureIssueMessage, workoutsFromSplit } from "@/modules/training/structure-draft";
import { isBelowTarget, progressOf, workoutSlots } from "@/modules/prescricao/summary";
import { scheduleOccurrences } from "@/modules/prescricao/motor/calendar";
import { planFingerprint } from "@/modules/pdf/plan-pdf";
import { divisionSuffix, phaseTitle, workoutTitle } from "@/modules/training/format";
import type { StudentTrainingPlan } from "@/db/student-plan";

// Topic 3 (fases e semanas em quantidades variáveis) and topic 16 (compatibilidade com os dados legados) at the
// structure level. The D1 side (saved plans, readers) is in tests/structure-v2-d1.test.ts.

const SPLITS = ["Full Body", "AB", "ABC", "ABCD", "ABCDE", "ABCDEF", "ABCDEFG"] as const;
const v1 = (phases: PeriodizationInputV1["phases"], startDate = "2026-11-02"): PeriodizationInputV1 => ({ startDate, phases });
const w = (label: string, extra: Partial<PhaseInputV2["workouts"][number]> = {}) => ({
  label,
  name: null,
  exerciseTarget: 5,
  focus: null,
  ...extra,
});
const phase = (extra: Partial<PhaseInputV2> = {}): PhaseInputV2 => ({
  name: null,
  weeks: 4,
  sessionsPerWeek: 3,
  workouts: [w("A"), w("B"), w("C")],
  rotation: null,
  trainingDays: null,
  ...extra,
});
const v2 = (phases: PhaseInputV2[], startDate = "2026-11-02"): PeriodizationInputV2 => ({ schemaVersion: 2, startDate, phases });
const issues = (raw: unknown) => {
  const result = periodizationInputSchemaV2.safeParse(raw);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
};

describe("legacy v1 structures (topic 16)", () => {
  it("parses a stored v1 input exactly as before, through every entry point", () => {
    const stored = JSON.parse(
      JSON.stringify(v1([{ weeks: 4, sessionsPerWeek: 3, split: "ABC", exercisesPerSession: 5 }, { weeks: 3, sessionsPerWeek: 2, split: "AB", exercisesPerSession: 8 }, { weeks: 6, sessionsPerWeek: 7, split: "Full Body", exercisesPerSession: 3 }])),
    );
    expect(parsePeriodizationInput(stored)).toEqual(stored);
    expect(periodizationInputSchema.parse(stored)).toEqual(stored);
    // The stored bytes come back unchanged: no field is added to a v1 input.
    expect(JSON.stringify(parsePeriodizationInput(stored))).toBe(JSON.stringify(stored));
  });

  it("builds the same v1 schedule as 0.93, byte for byte", () => {
    const schedule = buildPeriodization(v1([{ weeks: 3, sessionsPerWeek: 2, split: "ABC", exercisesPerSession: 5 }, { weeks: 3, sessionsPerWeek: 1, split: "Full Body", exercisesPerSession: 3 }, { weeks: 3, sessionsPerWeek: 3, split: "AB", exercisesPerSession: 20 }], "2026-10-26"));
    // Output of main 0.93's `buildPeriodization` (run before this change), key order included.
    expect(JSON.stringify(schedule)).toBe(
        '{"schemaVersion":1,"engineVersion":"0.1.0","status":"DRAFT","startDate":"2026-10-26","endDate":"2026-12-27","totalWeeks":9,"totalSessions":18,"phases":[' +
        '{"weeks":3,"sessionsPerWeek":2,"split":"ABC","exercisesPerSession":5,"index":1,"startDate":"2026-10-26","endDate":"2026-11-15","microcycles":[{"index":1,"startDate":"2026-10-26","endDate":"2026-11-01","sessions":["A","B"]},{"index":2,"startDate":"2026-11-02","endDate":"2026-11-08","sessions":["C","A"]},{"index":3,"startDate":"2026-11-09","endDate":"2026-11-15","sessions":["B","C"]}]},' +
        '{"weeks":3,"sessionsPerWeek":1,"split":"Full Body","exercisesPerSession":3,"index":2,"startDate":"2026-11-16","endDate":"2026-12-06","microcycles":[{"index":1,"startDate":"2026-11-16","endDate":"2026-11-22","sessions":["Full Body"]},{"index":2,"startDate":"2026-11-23","endDate":"2026-11-29","sessions":["Full Body"]},{"index":3,"startDate":"2026-11-30","endDate":"2026-12-06","sessions":["Full Body"]}]},' +
        '{"weeks":3,"sessionsPerWeek":3,"split":"AB","exercisesPerSession":20,"index":3,"startDate":"2026-12-07","endDate":"2026-12-27","microcycles":[{"index":1,"startDate":"2026-12-07","endDate":"2026-12-13","sessions":["A","B","A"]},{"index":2,"startDate":"2026-12-14","endDate":"2026-12-20","sessions":["B","A","B"]},{"index":3,"startDate":"2026-12-21","endDate":"2026-12-27","sessions":["A","B","A"]}]}]}',
    );
  });

  it("keeps v1's limits for v1 inputs and refuses a v1 input that claims another version", () => {
    expect(() => parsePeriodizationInput(v1([{ weeks: 7, sessionsPerWeek: 3, split: "ABC", exercisesPerSession: 5 }, { weeks: 3, sessionsPerWeek: 3, split: "ABC", exercisesPerSession: 5 }, { weeks: 3, sessionsPerWeek: 3, split: "ABC", exercisesPerSession: 5 }]))).toThrow();
    expect(() => parsePeriodizationInput({ ...v1(Array.from({ length: 3 }, () => ({ weeks: 3, sessionsPerWeek: 3, split: "ABC" as const, exercisesPerSession: 5 }))), schemaVersion: 1 })).toThrow();
    expect(() => parsePeriodizationInput(v1(Array.from({ length: 4 }, () => ({ weeks: 3, sessionsPerWeek: 3, split: "ABC" as const, exercisesPerSession: 5 }))))).toThrow();
  });

  it("reads v1 phases through the shared helpers as they were shown before", () => {
    const schedule = buildPeriodization(v1(Array.from({ length: 3 }, (_, i) => ({ weeks: 3, sessionsPerWeek: 3, split: SPLITS[i + 1], exercisesPerSession: 6 }))));
    const first = schedule.phases[0];
    expect(phaseWorkoutLabels(first)).toEqual(["A", "B"]);
    expect(phaseDivisionText(first)).toBe("AB");
    expect(phaseName(first)).toBeNull();
    expect(phaseTargetText(first)).toBe("6");
    expect(phaseTarget(first, "B")).toBe(6);
    expect(phaseTarget(first, "Z")).toBeNull();
    expect(workoutSlots(schedule).map((slot) => [slot.phaseIndex, slot.label, slot.target, slot.name])).toEqual([
      [1, "A", 6, null], [1, "B", 6, null], [2, "A", 6, null], [2, "B", 6, null], [2, "C", 6, null],
      [3, "A", 6, null], [3, "B", 6, null], [3, "C", 6, null], [3, "D", 6, null],
    ]);
  });

  it("converts every v1 split to v2 without moving a session, label or target", () => {
    for (const split of SPLITS)
      for (const sessionsPerWeek of [1, 2, 3, 5, 7])
        for (const weeks of [3, 4, 6]) {
          const original = v1(Array.from({ length: 3 }, () => ({ weeks, sessionsPerWeek, split, exercisesPerSession: 7 })));
          const converted = convertV1ToV2(original);
          expect(periodizationInputSchemaV2.safeParse(converted).success).toBe(true);
          const a = buildPeriodization(original);
          const b = buildPeriodization(converted);
          expect(b.phases.map((p) => p.microcycles.map((m) => m.sessions))).toEqual(a.phases.map((p) => p.microcycles.map((m) => m.sessions)));
          expect([b.startDate, b.endDate, b.totalWeeks, b.totalSessions]).toEqual([a.startDate, a.endDate, a.totalWeeks, a.totalSessions]);
          expect(workoutSlots(b).map((s) => [s.phaseIndex, s.label, s.target])).toEqual(workoutSlots(a).map((s) => [s.phaseIndex, s.label, s.target]));
          expect(b.phases.map(phaseDivisionText)).toEqual(a.phases.map((p) => [...(p.split === "Full Body" ? ["Full Body"] : p.split)].join(" / ")));
          expect(convertV2ToV1(converted)).toEqual(original);
        }
  });

  it("has no v1 form for a structure that uses v2 features", () => {
    const base = convertV1ToV2(v1(Array.from({ length: 3 }, () => ({ weeks: 4, sessionsPerWeek: 3, split: "ABC" as const, exercisesPerSession: 5 }))));
    const tweak = (change: (phases: PhaseInputV2[]) => void) => {
      const copy = structuredClone(base);
      change(copy.phases);
      return convertV2ToV1(copy);
    };
    expect(tweak(() => {})).not.toBeNull();
    expect(tweak((p) => (p[0].name = "Adaptação"))).toBeNull();
    expect(tweak((p) => (p[0].workouts[0].label = "Superior"))).toBeNull();
    expect(tweak((p) => (p[0].workouts[1].exerciseTarget = 6))).toBeNull();
    expect(tweak((p) => (p[0].workouts.forEach((x) => (x.exerciseTarget = null))))).toBeNull();
    expect(tweak((p) => (p[0].workouts.forEach((x) => (x.exerciseTarget = 2))))).toBeNull();
    expect(tweak((p) => (p[0].rotation = ["A", "C", "B"]))).toBeNull();
    expect(tweak((p) => (p[0].rotation = ["A", "B", "C"]))).not.toBeNull();
    expect(tweak((p) => (p[0].trainingDays = [0, 2, 4]))).toBeNull();
    expect(tweak((p) => (p[0].weeks = 8))).toBeNull();
    expect(tweak((p) => (p[0].sessionsPerWeek = 10))).toBeNull();
    expect(tweak((p) => (p[0].workouts[0].focus = { note: "pernas", minutes: null }))).toBeNull();
    expect(tweak((p) => p.pop())).toBeNull();
  });
});

describe("free structures (topic 3)", () => {
  it("accepts one phase of one week with one session, and a single free label", () => {
    const schedule = buildPeriodization(v2([phase({ weeks: 1, sessionsPerWeek: 1, workouts: [w("Corrida longa", { exerciseTarget: 1 })] })]));
    expect(schedule.schemaVersion).toBe(2);
    expect(schedule.engineVersion).toBe("0.2.0");
    expect([schedule.totalWeeks, schedule.totalSessions, schedule.startDate, schedule.endDate]).toEqual([1, 1, "2026-11-02", "2026-11-08"]);
    expect(schedule.phases[0].microcycles[0]).toEqual({
      index: 1,
      startDate: "2026-11-02",
      endDate: "2026-11-08",
      sessions: ["Corrida longa"],
      slots: [{ slot: 1, label: "Corrida longa", plannedDate: null }],
    });
  });

  it.each([1, 2, 5, 7, 12])("builds %i phases with different weeks and sessions each", (count) => {
    const phases = Array.from({ length: count }, (_, i) => phase({ weeks: 1 + (i % 5), sessionsPerWeek: 1 + (i % 6) }));
    const schedule = buildPeriodization(v2(phases));
    expect(schedule.phases).toHaveLength(count);
    expect(schedule.totalWeeks).toBe(phases.reduce((sum, p) => sum + p.weeks, 0));
    expect(schedule.totalSessions).toBe(phases.reduce((sum, p) => sum + p.weeks * p.sessionsPerWeek, 0));
    // Continuous calendar: each phase starts the day after the previous one ends.
    schedule.phases.forEach((p, i) => {
      expect(p.index).toBe(i + 1);
      expect(p.microcycles).toHaveLength(p.weeks);
      p.microcycles.forEach((m) => expect(m.sessions).toHaveLength(p.sessionsPerWeek));
      if (i > 0) {
        const previous = new Date(`${schedule.phases[i - 1].endDate}T00:00:00Z`);
        previous.setUTCDate(previous.getUTCDate() + 1);
        expect(p.startDate).toBe(previous.toISOString().slice(0, 10));
      }
    });
  });

  it("accepts long phases (beyond v1's 6 weeks) and up to 14 sessions a week", () => {
    const schedule = buildPeriodization(v2([phase({ weeks: 16, sessionsPerWeek: 14 }), phase({ weeks: 10, sessionsPerWeek: 2 })]));
    expect(schedule.totalWeeks).toBe(26);
    expect(schedule.totalSessions).toBe(16 * 14 + 20);
    expect(schedule.phases[0].microcycles[0].sessions).toEqual(["A", "B", "C", "A", "B", "C", "A", "B", "C", "A", "B", "C", "A", "B"]);
    // Rotation continues across weeks within the phase.
    expect(schedule.phases[0].microcycles[1].sessions[0]).toBe("C");
  });

  it("follows a custom rotation and restarts it in each phase", () => {
    const rotation = ["A", "B", "A", "C"];
    const schedule = buildPeriodization(v2([phase({ sessionsPerWeek: 3, weeks: 3, rotation }), phase({ weeks: 1, sessionsPerWeek: 2, rotation })]));
    expect(schedule.phases[0].rotation).toEqual(rotation);
    expect(schedule.phases[0].microcycles.map((m) => m.sessions)).toEqual([["A", "B", "A"], ["C", "A", "B"], ["A", "C", "A"]]);
    expect(schedule.phases[1].microcycles[0].sessions).toEqual(["A", "B"]);
  });

  it("dates each session from the training days, and leaves dates empty without them", () => {
    const schedule = buildPeriodization(
      v2([phase({ weeks: 2, sessionsPerWeek: 4, trainingDays: [0, 0, 3, 6] }), phase({ weeks: 1, sessionsPerWeek: 2 })], "2026-11-04"),
    );
    expect(schedule.phases[0].microcycles[1].slots).toEqual([
      { slot: 1, label: "B", plannedDate: "2026-11-11" },
      { slot: 2, label: "C", plannedDate: "2026-11-11" },
      { slot: 3, label: "A", plannedDate: "2026-11-14" },
      { slot: 4, label: "B", plannedDate: "2026-11-17" },
    ]);
    expect(schedule.phases[1].microcycles[0].slots.every((slot) => slot.plannedDate === null)).toBe(true);
  });

  it("matches the engine's calendar (occurrences the adapter will hand to the motor)", () => {
    const input = v2([phase({ weeks: 3, sessionsPerWeek: 5, rotation: ["C", "A", "B", "A"], trainingDays: [0, 1, 2, 4, 6] }), phase({ weeks: 2, sessionsPerWeek: 2 })], "2027-01-01");
    const schedule = buildPeriodization(input);
    const engine = scheduleOccurrences(
      input.startDate,
      schedule.phases.map((p) => ({ weeks: p.weeks, sessionsPerWeek: p.sessionsPerWeek, rotation: p.rotation, trainingDays: p.trainingDays })),
    );
    const ours = schedule.phases.map((p) =>
      p.microcycles.flatMap((m) => m.slots.map((s) => ({ week: m.index, slot: s.slot, label: s.label, plannedDate: s.plannedDate, weekStart: m.startDate }))),
    );
    expect(ours).toEqual(engine);
  });

  it("keeps names, targets (or none) and focus per workout, and reads them through the helpers", () => {
    const schedule = buildPeriodization(
      v2([
        phase({
          name: "  Adaptação  ",
          workouts: [w(" Superior ", { name: "Empurrar", exerciseTarget: 6, focus: { note: "peito", minutes: 50 } }), w("Inferior", { exerciseTarget: null })],
          sessionsPerWeek: 2,
        }),
        phase({ workouts: [w("A", { exerciseTarget: 4 }), w("B", { exerciseTarget: 4 })] }),
      ]),
    );
    const first = schedule.phases[0];
    expect(phaseName(first)).toBe("Adaptação");
    expect(phaseWorkoutLabels(first)).toEqual(["Superior", "Inferior"]);
    expect(phaseDivisionText(first)).toBe("Superior / Inferior");
    expect(phaseTargetText(first)).toBe("Superior 6 · Inferior sem alvo");
    expect(phaseTargetText(schedule.phases[1])).toBe("4");
    expect(phaseWorkouts(first)[0]).toEqual({ label: "Superior", name: "Empurrar", target: 6, focus: { note: "peito", minutes: 50 } });
    const progress = progressOf(schedule, [
      { phaseIndex: 1, workoutLabel: "Superior" },
      { phaseIndex: 1, workoutLabel: "Inferior" },
      { phaseIndex: 1, workoutLabel: "Inferior" },
    ]);
    expect(progress.map((p) => [p.label, p.name, p.target, p.count, p.status])).toEqual([
      ["Superior", "Empurrar", 6, 1, "BELOW"],
      ["Inferior", null, null, 2, "NO_TARGET"],
      ["A", null, 4, 0, "BELOW"],
      ["B", null, 4, 0, "BELOW"],
    ]);
    expect(isBelowTarget({ target: null }, 0)).toBe(false);
    expect(isBelowTarget({ target: 3 }, 2)).toBe(true);
  });

  it("refuses what the database or the screens cannot hold, saying why", () => {
    const ok = v2([phase()]);
    expect(issues(ok)).toEqual([]);
    expect(issues({ ...ok, phases: [] })[0]).toMatch(/pelo menos uma fase/);
    expect(issues({ ...ok, phases: Array.from({ length: 13 }, () => phase({ weeks: 1, sessionsPerWeek: 1, workouts: [w("A")] })) })[0]).toMatch(/12 fases/);
    expect(issues(v2([phase({ sessionsPerWeek: 15 })]))[0]).toMatch(/14 sessões/);
    expect(issues(v2([phase({ weeks: 0 })]))[0]).toMatch(/1 semana/);
    expect(issues(v2([phase({ weeks: 2.5 })])).length).toBeGreaterThan(0);
    for (const label of ["A|B", "A/B", "A\\B", "", "   ", "x".repeat(21), "tab\there"])
      expect(issues(v2([phase({ workouts: [w(label), w("B")] })])).length, label).toBeGreaterThan(0);
    expect(issues(v2([phase({ workouts: [w("x".repeat(20)), w("Treino ação 2")], sessionsPerWeek: 2 })]))).toEqual([]);
    expect(issues(v2([phase({ workouts: [w("A"), w("A")] })])).some((m) => /duas vezes/.test(m))).toBe(true);
    expect(issues(v2([phase({ workouts: [] })]))[0]).toMatch(/pelo menos um treino/);
    expect(issues(v2([phase({ rotation: ["A", "Z"] })])).some((m) => /não é um treino/.test(m))).toBe(true);
    expect(issues(v2([phase({ rotation: [] })]))[0]).toMatch(/pelo menos uma posição/);
    expect(issues(v2([phase({ rotation: Array.from({ length: 505 }, () => "A") })]))[0]).toMatch(/até 504 posições/);
    // As in v1 (ABCDEFG in 3 sessions), a workout the rotation does not reach is allowed: nothing is guessed about it.
    expect(issues(v2([phase({ weeks: 1, sessionsPerWeek: 2 })]))).toEqual([]);
    expect(issues(v2([phase({ rotation: ["A", "B"] })]))).toEqual([]);
    expect(issues(v2([phase({ trainingDays: [0, 2] })])).some((m) => /um dia para cada sessão/.test(m))).toBe(true);
    expect(issues(v2([phase({ trainingDays: [4, 2, 6] })])).some((m) => /ordem das sessões/.test(m))).toBe(true);
    expect(issues(v2([phase({ trainingDays: [0, 2, 7] })])).length).toBeGreaterThan(0);
    expect(issues(v2([phase({ workouts: [w("A", { exerciseTarget: 21 }), w("B"), w("C")] })]))[0]).toMatch(/até 20/);
    expect(issues(v2([phase({ workouts: [w("A", { exerciseTarget: 0 }), w("B"), w("C")] })]))[0]).toMatch(/começa em 1/);
    expect(issues(v2([phase({ workouts: [w("A", { focus: { note: null, minutes: 601 } }), w("B"), w("C")] })]))[0]).toMatch(/600 minutos/);
    expect(issues({ ...ok, extra: 1 }).length).toBeGreaterThan(0);
    expect(issues({ ...ok, phases: [{ ...phase(), split: "ABC" }] }).length).toBeGreaterThan(0);
  });

  it("caps the total of sessions at the technical limit, and never past 2100", () => {
    const max = STRUCTURE_LIMITS.MAX_OCCURRENCES;
    expect(max).toBe(504);
    // 504 = 12 × 6 × 7, the most v1 allowed: accepted.
    expect(issues(v2(Array.from({ length: 12 }, () => phase({ weeks: 6, sessionsPerWeek: 7 }))))).toEqual([]);
    expect(issues(v2([phase({ weeks: 36, sessionsPerWeek: 14 })]))).toEqual([]);
    expect(issues(v2([phase({ weeks: 36, sessionsPerWeek: 14 }), phase({ weeks: 1, sessionsPerWeek: 1, workouts: [w("A")] })]))[0]).toMatch(/505 sessões; o limite técnico atual é 504/);
    expect(issues(v2([phase({ weeks: 2, sessionsPerWeek: 3 })], "2100-12-20"))[0]).toMatch(/depois de 2100/);
    expect(issues(v2([phase({ weeks: 1, sessionsPerWeek: 3 })], "2100-12-25"))).toEqual([]);
  });
});

describe("planner helpers (free structure editor)", () => {
  it("suggests free letters, spreads days in order and names weekdays from the start date", () => {
    expect(nextLabel(["A", "B", "D"])).toBe("C");
    expect(nextLabel(Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)))).toBe("T27");
    for (let n = 1; n <= 14; n += 1) {
      const days = spreadDays(n);
      expect(days).toHaveLength(n);
      expect(days.every((day, i) => day >= 0 && day <= 6 && (i === 0 || day >= days[i - 1]))).toBe(true);
      expect(issues(v2([phase({ sessionsPerWeek: n, trainingDays: days })]))).toEqual([]);
    }
    expect(spreadDays(3)).toEqual([0, 2, 4]);
    expect(dayLabel("2026-11-04", 0)).toBe("Dia 1 (qua.)");
    expect(dayLabel("2026-11-04", 4)).toBe("Dia 5 (dom.)");
    expect(dayLabel("", 2)).toBe("Dia 3");
    expect(workoutsFromSplit("AB", [w("X", { exerciseTarget: 9 })]).map((x) => [x.label, x.exerciseTarget])).toEqual([["A", 9], ["B", 9]]);
  });

  it("tells the first problem with its phase, in Portuguese", () => {
    const bad = periodizationInputSchemaV2.safeParse(v2([phase(), phase({ workouts: [w("A|B"), w("B"), w("C")] })]));
    expect(bad.success).toBe(false);
    if (!bad.success) expect(structureIssueMessage(bad.error)).toBe("Fase 2: O rótulo do treino não pode ter |, / ou \\.");
    const date = periodizationInputSchemaV2.safeParse({ ...v2([phase()]), startDate: "" });
    if (!date.success) expect(structureIssueMessage(date.error)).toMatch(/data de início/);
    const typed = periodizationInputSchemaV2.safeParse(v2([phase({ weeks: Number.NaN })]));
    if (!typed.success) expect(structureIssueMessage(typed.error)).toBe("Fase 1: confira os valores desta fase.");
  });
});

describe("readers' wording and the PDF fingerprint", () => {
  const exercise = { id: "x", name: "Agachamento", videoUrl: null, videoStatus: "NONE" as const, sets: "3", reps: "10", loadInstruction: null, cadence: null, restSeconds: 60, restText: null, rirMin: null, rirMax: null, notes: null };
  const plan = (names: boolean): StudentTrainingPlan => ({
    planId: "p",
    revisionId: "r",
    title: "Plano",
    revisionNumber: 1,
    deliveredAt: "2026-11-10T13:00:00.000Z",
    deliveredBy: null,
    deliveredOrganizationName: null,
    startDate: "2026-11-02",
    endDate: "2026-11-29",
    phases: [{ index: 1, startDate: "2026-11-02", endDate: "2026-11-29", weeks: 4, sessionsPerWeek: 3, split: "ABC", ...(names ? { name: "Base" } : {}), workouts: [{ label: "A", ...(names ? { name: "Superior" } : {}), exercises: [exercise] }] }],
  });

  it("keeps the v1 fingerprint formula, and a v2 name changes the fingerprint", async () => {
    // The canonical form of 0.93, written out here so a change to it fails this test.
    const p = plan(false);
    const canonical = JSON.stringify([p.revisionId, p.title, p.revisionNumber, p.deliveredAt, p.startDate, p.endDate,
      p.phases.map((ph) => [ph.index, ph.startDate, ph.endDate, ph.weeks, ph.sessionsPerWeek, ph.split,
        ph.workouts.map((wk) => [wk.label, wk.exercises.map((e) => [e.name, e.videoUrl, e.videoStatus, e.sets, e.reps, e.loadInstruction, e.cadence, e.restSeconds, e.restText, e.rirMin, e.rirMax, e.notes])])])]);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
    const expected = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(await planFingerprint(p)).toBe(expected);
    expect(await planFingerprint({ ...p, phases: p.phases.map((ph) => ({ ...ph, name: null, workouts: ph.workouts.map((wk) => ({ ...wk, name: null })) })) })).toBe(expected);
    expect(await planFingerprint(plan(true))).not.toBe(expected);
  });

  it("titles phases and workouts with their v2 names only when they have one", () => {
    expect(phaseTitle(1)).toBe("Fase 01");
    expect(phaseTitle(3, "Base")).toBe("Fase 03 · Base");
    expect(workoutTitle("A")).toBe("Treino A");
    expect(workoutTitle("A", null)).toBe("Treino A");
    expect(workoutTitle("A", "Superior")).toBe("Treino A · Superior");
    expect(divisionSuffix("Full Body")).toBe("");
    expect(divisionSuffix("Superior / Inferior")).toBe(" · divisão Superior / Inferior");
  });
});
