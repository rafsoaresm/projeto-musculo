import { describe, expect, it } from "vitest";
import { buildPlanningContext, ageBandOf, sessionMinutesBand, shortlist } from "@/modules/prescricao/planejador/context";
import { contextHash } from "@/modules/prescricao/planejador/hashes";
import { PLANNER_MAX_CANDIDATES, PLANNING_CONTEXT_VERSION } from "@/modules/prescricao/planejador/versions";
import { MUSCLES, PATTERNS } from "@/modules/biblioteca/metadata/vocabulary";
import { exercise } from "./helpers/motor-fixtures";
import { XINTUS_CATALOG } from "./helpers/xintus";
import { CANARY, XINTUS_ANSWERS, canaryBundle, canaryContext, generationContext, planOptions, xintusBundle } from "./helpers/planning-fixtures";

/** Every key path of a JSON value (array indexes folded into `[]`, record keys of the count maps folded into `*`). */
function keyPaths(value: unknown, prefix = "", out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keyPaths(v, `${prefix}[]`, out));
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) {
      const folded = prefix === "library.byPattern" || prefix === "library.byPrimaryMuscle" ? "*" : k;
      const path = prefix ? `${prefix}.${folded}` : folded;
      out.add(path);
      keyPaths(v, path, out);
    }
  return out;
}

const WHITELIST = [
  "contextVersion", "student", "student.experience", "student.goalCodes", "student.ageBand", "student.sessionMinutes", "student.daysPerWeek",
  "student.equipment", "student.equipment.known", "student.equipment.codes", "student.origins", "student.origins.experience", "student.origins.goal",
  "student.origins.sessionMinutes", "student.origins.daysPerWeek", "student.origins.equipment", "screening", "screening.parq", "screening.decision",
  "observations", "observations[].alias", "observations[].kind", "observations[].code", "observations[].grade", "observations[].readings",
  "observations[].readings[].code", "observations[].readings[].level", "periodization", "periodization.irregular", "periodization.phases",
  "periodization.phases[].index", "periodization.phases[].weeks", "periodization.phases[].sessionsPerWeek", "periodization.phases[].stimulus",
  "periodization.phases[].weekdays", "periodization.phases[].weekSequence", "periodization.phases[].workouts",
  "periodization.phases[].workouts[].alias", "periodization.phases[].workouts[].sessionsInPhase", "periodization.phases[].workouts[].perWeek",
  "periodization.phases[].workouts[].perWeek.min", "periodization.phases[].workouts[].perWeek.max", "periodization.phases[].workouts[].modalities",
  "periodization.phases[].workouts[].exerciseTarget", "periodization.phases[].workouts[].existingFocus", "periodization.phases[].workouts[].hasFixedItems",
  "history", "history.windowDays", "history.sessionsBand", "history.recordsBand", "history.painRecorded", "constraints", "constraints.hasLocked",
  "constraints.hasPreserved", "constraints.excludedPatterns", "constraints.excludedCautionTags", "constraints.timeBudget", "library",
  "library.eligibleExercises", "library.byPattern", "library.byPattern.*", "library.byPrimaryMuscle", "library.byPrimaryMuscle.*", "library.reviewedShare",
  "library.candidates", "library.candidates[].alias", "library.candidates[].modality", "library.candidates[].primaryMuscles",
  "library.candidates[].secondaryMuscles", "library.candidates[].patterns", "library.candidates[].difficulty", "library.candidates[].compound",
  "library.candidates[].laterality", "library.candidates[].metric", "library.candidates[].metadata",
];

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

describe("planning context: the canary student (design §8.1)", () => {
  it("contains no identifying value, in any form", async () => {
    const bundle = await canaryBundle();
    const json = norm(JSON.stringify(bundle.context));
    const forbidden = [
      "zelia", "quintanilha", "braga", CANARY.email, "98888", "7766", "123.456", "12345678909", "1991", "1991-03-14", "14/03", CANARY.planTitle,
      "superior zelia", CANARY.exerciseName, "remada da", "acacias", "ombro", "marco", "ex-zelia-own-1", "plan-zelia-uuid-1", "stu-zelia-uuid-1",
      "rev-zelia-uuid-1", "org-canary-uuid-1", "clinica", "base zelia", "treino da",
    ];
    for (const value of forbidden) expect(json, value).not.toContain(norm(value));
    for (const alias of bundle.aliases.workouts.values()) expect(json).not.toContain(norm(JSON.stringify(alias)));
    // the age is a band, not a date
    expect(bundle.context.student.ageBand).toBe("30_39");
    expect(json).toContain('"ageband":"30_39"');
    expect(bundle.minor).toBe(false);
  });

  it("puts every identifier on the deny list and the server refs, never in the context", async () => {
    const bundle = await canaryBundle();
    const deny = [...bundle.denyList.values, ...bundle.denyList.tokens].join("|");
    for (const value of ["zelia", "quintanilha", "braga", "zelia.quintanilha@exemplo.test", "5511988887766", "1991-03-14", "14/03/1991", "ex-zelia-own-1", "plan-zelia-uuid-1", "remada da zelia", "superior zelia", "clinica"])
      expect(deny, value).toContain(value);
    expect(bundle.refs).toMatchObject({ organizationId: "org-canary-uuid-1", planId: "plan-zelia-uuid-1", revisionId: "rev-zelia-uuid-1", studentId: "stu-zelia-uuid-1" });
    expect(JSON.stringify(bundle.context)).not.toContain("uuid");
  });

  it("records what is never sent", async () => {
    const bundle = await canaryBundle();
    const has = (field: string, reason: string) => bundle.omitted.some((o) => o.field === field && o.reason === reason);
    expect(has("profile.name", "DIRECT_IDENTIFIER")).toBe(true);
    expect(has("profile.email", "DIRECT_IDENTIFIER")).toBe(true);
    expect(has("profile.gender", "NOT_NEEDED")).toBe(true);
    expect(has("profile.height", "NOT_NEEDED")).toBe(true);
    expect(has("profile.weight", "NOT_NEEDED")).toBe(true);
    expect(has("profile.goal", "FREE_TEXT")).toBe(true);
    expect(has("profile.freeText", "FREE_TEXT")).toBe(true);
    expect(has("assessment.label", "FREE_TEXT")).toBe(true);
    expect(has("parameters.acceptedFlagDecisions", "DIRECT_IDENTIFIER")).toBe(true);
  });
});

describe("planning context: whitelist", () => {
  it("has exactly the documented key paths (a new field must edit this test)", async () => {
    const bundle = await xintusBundle({}, {}, { ...XINTUS_ANSWERS });
    // Optional leaves appear only when the data has them; the union over a few shapes must equal the whitelist.
    const withFocus = await xintusBundle(
      { revision: { ...generationContext().revision, schedule: generationContext().revision.schedule } },
      {},
      { ...XINTUS_ANSWERS, coverageByWorkout: [{ phaseIndex: 1, label: "A", muscles: ["CHEST"], patterns: ["HORIZONTAL_PUSH"] }] },
    );
    const paths = new Set([...keyPaths(bundle.context), ...keyPaths(withFocus.context)]);
    paths.add("periodization.phases[].workouts[].existingFocus.muscles");
    const actual = [...paths].filter((p) => !p.startsWith("periodization.phases[].workouts[].existingFocus.")).sort();
    expect(actual).toEqual([...new Set(WHITELIST)].sort());
    expect(keyPaths(withFocus.context).has("periodization.phases[].workouts[].existingFocus.muscles")).toBe(true);
    expect(keyPaths(withFocus.context).has("periodization.phases[].workouts[].existingFocus.patterns")).toBe(true);
  });

  it("only vocabulary codes, aliases, enums and numbers are strings in the context", async () => {
    const bundle = await xintusBundle();
    const allowed = /^(?:[A-Z][A-Z0-9_]*|[XTF][1-9][0-9]*|[A-Za-z0-9_:.-]{1,60}|\d{2}_\d{2}|\d{2}_PLUS)$/;
    const walk = (v: unknown): void => {
      if (typeof v === "string") expect(v, v).toMatch(allowed);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(bundle.context);
    expect(bundle.context.contextVersion).toBe(PLANNING_CONTEXT_VERSION);
  });
});

describe("planning context: the Xintus fixture", () => {
  it("carries dorsiflexion level 2 as a coded observation and nothing else about the person", async () => {
    const { context } = await xintusBundle();
    const flexitest = context.observations.find((o) => o.code === "FLEXITEST");
    expect(flexitest).toMatchObject({ alias: "F1", kind: "FLEXIBILITY", grade: null });
    expect(flexitest!.readings).toContainEqual({ code: "ankle_dorsiflexion", level: 2 });
    expect(flexitest!.readings).toHaveLength(15);
    expect(flexitest!.readings.filter((r) => r.code !== "ankle_dorsiflexion").every((r) => r.level === 3)).toBe(true);
    expect(JSON.stringify(flexitest)).not.toMatch(/label|Flexiteste:|nível/i);
    expect(context.student).toMatchObject({
      experience: "INTERMEDIATE", sessionMinutes: 60, daysPerWeek: 4, ageBand: "30_39",
      equipment: { known: true }, origins: { experience: "STUDENT_DECLARED", equipment: "PROFESSIONAL_DECISION" },
    });
    expect(context.student.goalCodes).toContain("HYPERTROPHY");
    expect(context.screening).toEqual({ parq: "CLEAR", decision: null });
    expect(context.periodization.phases).toHaveLength(3);
    for (const phase of context.periodization.phases) {
      expect(phase).toMatchObject({ weeks: 4, sessionsPerWeek: 4, stimulus: "HYPERTROPHY", weekSequence: ["T1", "T2", "T1", "T2"] });
      expect(phase.weekdays).toEqual([1, 2, 4, 5]);
      expect(phase.workouts.map((w) => [w.alias, w.sessionsInPhase, w.perWeek, w.exerciseTarget])).toEqual([["T1", 8, { min: 2, max: 2 }, 6], ["T2", 8, { min: 2, max: 2 }, 6]]);
      expect(phase.workouts.every((w) => w.modalities?.join() === "RESISTANCE" && w.existingFocus === null && !w.hasFixedItems)).toBe(true);
    }
    expect(context.periodization.irregular).toBe(false);
    expect(context.history).toEqual({ windowDays: 180, sessionsBand: "NONE", recordsBand: "NONE", painRecorded: false });
    expect(context.constraints).toMatchObject({ hasLocked: false, hasPreserved: false, timeBudget: "SOFT" });
  });

  it("records the omissions of the Xintus plan", async () => {
    const { omitted } = await xintusBundle();
    for (const f of ["profile.gender", "profile.height", "profile.weight", "profile.goal", "assessment.label", "parameters.acceptedFlagDecisions"])
      expect(omitted.some((o) => o.field === f), f).toBe(true);
  });

  it("answers the questions through the same gate as a generation (no equipment answer: unknown, not guessed)", async () => {
    const out = await buildPlanningContext(generationContext(), planOptions({}, { stimulusByPhase: XINTUS_ANSWERS.stimulusByPhase }));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.build.ready).toBe(false);
    expect(out.build.questions.some((q) => q.code === "EQUIPMENT")).toBe(true);
    expect(out.bundle.context.student.equipment).toEqual({ known: false, codes: [] });
    expect(out.bundle.context.student.origins.equipment).toBe("UNKNOWN");
  });

  it("refuses answers the generation would refuse, and structures the planner does not support", async () => {
    const rejected = await buildPlanningContext(generationContext(), planOptions({}, { ...XINTUS_ANSWERS, preferredExerciseIds: ["ex-nao-existe"] }));
    expect(rejected).toMatchObject({ ok: false, code: "BUILD_REJECTED" });
    const labels = "ABCDEFGHI".split("").map((label) => ({ label }));
    const big = await import("./helpers/planning-fixtures").then((m) => m.scheduleOf([{ weeks: 1, sessionsPerWeek: 1, workouts: labels }]));
    const tooLarge = await buildPlanningContext(generationContext({ revision: { ...generationContext().revision, schedule: big } }), planOptions());
    expect(tooLarge).toEqual({ ok: false, code: "STRUCTURE_TOO_LARGE" });
  });
});

describe("planning context: aliases and the shortlist", () => {
  it("numbers exercises by id over the shortlist and workouts by first appearance", async () => {
    const { aliases, context } = await xintusBundle();
    const ids = [...aliases.exercises.values()];
    expect(ids).toEqual([...ids].sort());
    expect([...aliases.exercises.keys()]).toEqual(ids.map((_, i) => `X${i + 1}`));
    expect([...aliases.workouts]).toEqual([["T1", "A"], ["T2", "B"]]);
    expect(context.library.candidates.map((c) => c.alias)).toEqual([...aliases.exercises.keys()]);
    expect([...aliases.findings.keys()]).toEqual(["F1"]);
  });

  it("is capped, covers every pattern with an eligible exercise and never carries pending metadata", async () => {
    const many = Array.from({ length: 70 }, (_, i) =>
      exercise({ id: `ex-extra-${String(i).padStart(2, "0")}`, name: `Extra ${i}`, primaryMuscles: ["QUADRICEPS"], patterns: ["SQUAT"], equipment: [], compound: true, difficulty: 2 }));
    const pending = exercise({ id: "ex-pending", name: "Pendente", primaryMuscles: ["CALVES"], patterns: ["PLANTAR_FLEXION"], equipment: [], metadataStatus: "PENDING" });
    const { context, omitted } = await xintusBundle({ catalog: [...XINTUS_CATALOG, ...many, pending] });
    expect(context.library.candidates.length).toBeLessThanOrEqual(PLANNER_MAX_CANDIDATES);
    expect(omitted.some((o) => o.field === "library.candidates" && o.reason === "CAPPED")).toBe(true);
    const patterns = new Set(context.library.candidates.flatMap((c) => c.patterns));
    for (const p of Object.keys(context.library.byPattern)) expect(patterns.has(p), p).toBe(true);
    expect(context.library.candidates.every((c) => c.metadata === "REVIEWED" || c.metadata === "INFERRED")).toBe(true);
    expect(Object.keys(context.library.byPattern)).not.toContain("PLANTAR_FLEXION_PENDING");
    // pending exercise never counted: PLANTAR_FLEXION comes only from the reviewed calf raise
    expect(context.library.byPattern.PLANTAR_FLEXION).toBe(1);
  });

  it("counts the engine's eligible pool (excluded patterns and unavailable equipment never enter)", async () => {
    const all = await xintusBundle();
    const limited = await xintusBundle({}, {}, { ...XINTUS_ANSWERS, equipmentCodes: ["DUMBBELL", "BENCH"], excludedPatterns: ["SQUAT"] });
    expect(limited.context.library.eligibleExercises).toBeLessThan(all.context.library.eligibleExercises);
    expect(limited.context.library.byPattern.SQUAT).toBeUndefined();
    expect(limited.context.constraints.excludedPatterns).toEqual(["SQUAT"]);
    expect(limited.context.library.candidates.every((c) => !c.patterns.includes("SQUAT"))).toBe(true);
  });

  it("shortlist(): one per pattern first, reviewed and compound first, deterministic", () => {
    const pool = [
      exercise({ id: "b", name: "b", patterns: ["SQUAT"], primaryMuscles: ["QUADRICEPS"], compound: false, metadataStatus: "REVIEWED" }),
      exercise({ id: "a", name: "a", patterns: ["SQUAT"], primaryMuscles: ["QUADRICEPS"], compound: true, metadataStatus: "INFERRED" }),
      exercise({ id: "c", name: "c", patterns: ["SQUAT"], primaryMuscles: ["QUADRICEPS"], compound: true, metadataStatus: "REVIEWED", difficulty: 3 }),
      exercise({ id: "d", name: "d", patterns: ["HINGE"], primaryMuscles: ["HAMSTRINGS"], metadataStatus: "REVIEWED" }),
    ];
    const first = shortlist(pool, 3);
    expect(first.chosen.map((e) => e.id)).toEqual(["b", "c", "d"]);
    expect(first.chosen.map((e) => e.id)).not.toContain("a");
    expect(first.capped).toBe(true);
    expect(shortlist([...pool].reverse(), 3).chosen.map((e) => e.id)).toEqual(["b", "c", "d"]);
  });
});

describe("planning context: hashes", () => {
  it("is stable under catalog, history and existing permutations", async () => {
    const base = await xintusBundle();
    const reversed = await xintusBundle({ catalog: [...XINTUS_CATALOG].reverse() });
    expect(reversed.contextHash).toBe(base.contextHash);
    expect(reversed.aliases.aliasMapHash).toBe(base.aliases.aliasMapHash);
    expect(reversed.refs.structureFingerprint).toBe(base.refs.structureFingerprint);
    expect(base.contextHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await contextHash(base.context)).toBe(base.contextHash);
    const again = await xintusBundle();
    expect(again.contextHash).toBe(base.contextHash);
    expect(JSON.stringify(again.context)).toBe(JSON.stringify(base.context));
  });

  it("is stable under the key order of the answers", async () => {
    const a = await xintusBundle({}, {}, { stimulusByPhase: XINTUS_ANSWERS.stimulusByPhase, equipmentCodes: ["MACHINE", "BARBELL", "RACK", "DUMBBELL", "BENCH", "CABLE", "BIKE", "SLED"] });
    const b = await xintusBundle({}, {}, { equipmentCodes: ["SLED", "BIKE", "CABLE", "BENCH", "DUMBBELL", "RACK", "BARBELL", "MACHINE"], stimulusByPhase: XINTUS_ANSWERS.stimulusByPhase });
    expect(a.contextHash).toBe(b.contextHash);
  });

  it("changes when a candidate difficulty changes", async () => {
    const base = await xintusBundle();
    const changed = XINTUS_CATALOG.map((e) => (e.id === "ex-legpress" ? { ...e, difficulty: 4 } : e));
    const other = await xintusBundle({ catalog: changed });
    expect(other.contextHash).not.toBe(base.contextHash);
  });

  it("does not change when one more workout is logged inside the band, nor when more preserved rows exist; a band change does", async () => {
    const log = (i: number) => ({ exerciseId: "ex-squat", date: `2026-10-${String(10 + i).padStart(2, "0")}`, equipmentKey: null, metric: "REPS" as const, sets: [], pain: false });
    const window = (sessions: number) => ({ since: "2026-05-09", until: "2026-11-05", sinceDays: 180, sessions, truncated: false });
    const withLogs = (n: number) =>
      generationContext({ history: { window: window(n), summary: { logs: Array.from({ length: n }, (_, i) => log(i)), exercises: [], customSkipped: 0, notDone: 0, sessionsWithEffort: 0 } } });
    const hash = async (ctx: ReturnType<typeof generationContext>) => {
      const out = await buildPlanningContext(ctx, planOptions());
      if (!out.ok) throw new Error(out.code);
      return out.bundle.contextHash;
    };
    expect(await hash(withLogs(2))).toBe(await hash(withLogs(5)));
    expect(await hash(withLogs(0))).not.toBe(await hash(withLogs(2)));
    expect(await hash(withLogs(9))).not.toBe(await hash(withLogs(10)));
    const row = (id: string) => ({ id, phaseIndex: 1, workoutLabel: "A", exerciseId: "ex-squat", name: "Agachamento", position: 1, origin: "MANUAL" }) as unknown as ReturnType<typeof generationContext>["existing"][number];
    const one = await hash(generationContext({ existing: [row("r1")] }));
    const two = await hash(generationContext({ existing: [row("r1"), row("r2"), row("r3")] }));
    expect(one).toBe(two);
    expect(one).not.toBe(await hash(generationContext()));
  });

  it("changes with the saved structure (fingerprint) and with the professional's workout focus", async () => {
    const base = await xintusBundle();
    const focused = await xintusBundle({}, {}, { ...XINTUS_ANSWERS, coverageByWorkout: [{ phaseIndex: 1, label: "A", muscles: ["CHEST", "TRICEPS"] }] });
    expect(focused.contextHash).not.toBe(base.contextHash);
    const wk = focused.context.periodization.phases[0].workouts[0];
    expect(wk.existingFocus).toEqual({ muscles: ["CHEST", "TRICEPS"], patterns: [] });
    const { scheduleOf } = await import("./helpers/planning-fixtures");
    const phase = { weeks: 4, sessionsPerWeek: 4, trainingDays: [0, 1, 3, 4], workouts: [{ label: "A" }, { label: "B" }] };
    const other = await xintusBundle({ revision: { ...generationContext().revision, schedule: scheduleOf([phase, phase, phase], "2026-11-16") } });
    expect(other.refs.structureFingerprint).not.toBe(base.refs.structureFingerprint);
  });
});

describe("planning context: ages, minutes, history, structure", () => {
  it("bands the age and flags a minor", async () => {
    expect(ageBandOf("2012-05-01", "2026-11-05")).toEqual({ band: null, minor: true });
    expect(ageBandOf(null, "2026-11-05")).toEqual({ band: null, minor: false });
    expect(ageBandOf("not-a-date", "2026-11-05")).toEqual({ band: null, minor: false });
    expect(ageBandOf("2008-11-05", "2026-11-05")).toEqual({ band: "18_29", minor: false });
    expect(ageBandOf("2008-11-06", "2026-11-05")).toEqual({ band: null, minor: true });
    expect(ageBandOf("1996-01-01", "2026-11-05").band).toBe("30_39");
    expect(ageBandOf("1986-01-01", "2026-11-05").band).toBe("40_49");
    expect(ageBandOf("1976-01-01", "2026-11-05").band).toBe("50_59");
    expect(ageBandOf("1950-01-01", "2026-11-05").band).toBe("60_PLUS");
    const base = generationContext();
    const minor = await xintusBundle({ profile: { ...base.profile!, birthDate: "2012-05-01" } });
    expect(minor.minor).toBe(true);
    expect(minor.context.student.ageBand).toBeNull();
  });

  it("floors the minutes to 15-minute steps within 15..180", () => {
    expect([60, 62, 74, 75, 10, 300, 0, null].map((m) => sessionMinutesBand(m))).toEqual([60, 60, 60, 75, 15, 180, null, null]);
  });

  it("unknown student facts stay unknown (null), never a guess", async () => {
    const base = generationContext();
    const out = await xintusBundle({ profile: null, assessment: null });
    expect(out.context.student).toMatchObject({ experience: null, goalCodes: [], ageBand: null, sessionMinutes: null, daysPerWeek: null });
    expect(out.context.student.origins).toMatchObject({ experience: "UNKNOWN", goal: "UNKNOWN", sessionMinutes: "UNKNOWN", daysPerWeek: "UNKNOWN" });
    expect(out.context.screening).toEqual({ parq: "NOT_DONE", decision: null });
    expect(out.context.observations).toEqual([]);
    expect(base.profile).not.toBeNull();
  });

  it("reports an irregular rotation and aliases by label across phases", async () => {
    const { scheduleOf } = await import("./helpers/planning-fixtures");
    const schedule = scheduleOf([{ weeks: 2, sessionsPerWeek: 3, rotation: ["A", "B"], workouts: [{ label: "A" }, { label: "B" }] }, { weeks: 2, sessionsPerWeek: 2, workouts: [{ label: "B" }, { label: "C" }] }]);
    const out = await xintusBundle({ revision: { ...generationContext().revision, schedule } }, {}, { stimulusByPhase: XINTUS_ANSWERS.stimulusByPhase!.slice(0, 2), equipmentCodes: XINTUS_ANSWERS.equipmentCodes });
    expect(out.context.periodization.irregular).toBe(true);
    expect([...out.aliases.workouts]).toEqual([["T1", "A"], ["T2", "B"], ["T3", "C"]]);
    expect(out.context.periodization.phases[1].workouts.map((w) => w.alias)).toEqual(["T2", "T3"]);
  });

  it("carries the vocabulary the schema uses", () => {
    expect(Object.keys(MUSCLES).length).toBeGreaterThan(10);
    expect(Object.keys(PATTERNS).length).toBeGreaterThan(10);
    expect(canaryContext().plan.title).toBe(CANARY.planTitle);
  });
});
