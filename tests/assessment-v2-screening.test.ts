import { describe, expect, it } from "vitest";
import { MAX_SECTION_CHARS } from "@/db/assessments";
import { ANAMNESIS, GOALS, PARQ, PARQ_DECISIONS, PARQ_INSTRUMENT } from "@/modules/avaliacoes/catalog";
import {
  EMPTY_PROFILE,
  EMPTY_SCREENING,
  MAX_TEXT,
  PARQ_CODES,
  decisionShown,
  parqHasYes,
  parqUnanswered,
  profileFromForm,
  profileSchema,
  readProfile,
  readScreening,
  screeningFromForm,
  screeningPending,
  screeningSchema,
  triagemFormFrom,
  type ScreeningPayload,
  type TriagemForm,
} from "@/modules/avaliacoes/v2/screening";

const emptyForm = (): TriagemForm => triagemFormFrom(EMPTY_PROFILE, EMPTY_SCREENING);
const allParq = (answer: "yes" | "no" | "unanswered") => Object.fromEntries(PARQ_CODES.map((code) => [code, answer])) as TriagemForm["parq"];
const screening = (form: TriagemForm): ScreeningPayload => {
  const read = screeningFromForm(form);
  if (read.payload === null) throw new Error(read.problems.join(", "));
  return read.payload;
};

describe("the catalog the Triagem reads (handoff 3.1)", () => {
  it("has the seven goals, the ten anamnesis questions and the seven PAR-Q questions of the document, and three decisions", () => {
    expect(Object.keys(GOALS)).toHaveLength(7);
    expect(Object.keys(ANAMNESIS)).toHaveLength(10);
    expect(Object.keys(PARQ)).toHaveLength(7);
    expect(PARQ_INSTRUMENT).toEqual({ id: "parq_7_legacy", version: "pdf_2026_11" });
    expect(Object.keys(PARQ_DECISIONS)).toEqual(["cleared", "medical_clearance", "other"]);
  });
});

describe("the module profile (goals)", () => {
  it("defaults to no goal and no note", () => {
    expect(EMPTY_PROFILE).toEqual({ goals: [], goalNotes: "" });
  });
  it("takes several goals of the catalog, never an unknown or repeated one, nor an unknown field", () => {
    expect(profileSchema.safeParse({ goals: ["hypertrophy", "health"] }).success).toBe(true);
    expect(profileSchema.safeParse({ goals: ["strength_training"] }).success).toBe(false);
    expect(profileSchema.safeParse({ goals: ["health", "health"] }).success).toBe(false);
    expect(profileSchema.safeParse({ goals: [], gender: "male" }).success).toBe(false);
    expect(profileSchema.safeParse({ goalNotes: "x".repeat(MAX_TEXT + 1) }).success).toBe(false);
  });
  it("stores the goals in the catalog's order and names a note that is too long", () => {
    const form = { ...emptyForm(), goals: ["health", "hypertrophy"] as TriagemForm["goals"], goalNotes: "Correr 5 km" };
    expect(profileFromForm(form)).toEqual({ payload: { goals: ["hypertrophy", "health"], goalNotes: "Correr 5 km" }, problems: [] });
    expect(profileFromForm({ ...form, goalNotes: "x".repeat(MAX_TEXT + 1) })).toEqual({ payload: null, problems: ["Objetivos adicionais e notas"] });
  });
  it("reads anything unknown as the empty module, never a guess", () => {
    expect(readProfile({ goals: ["nope"] })).toEqual(EMPTY_PROFILE);
    expect(readProfile(null)).toEqual(EMPTY_PROFILE);
  });
});

describe("the module screening (anamnesis, activity, PAR-Q)", () => {
  it("defaults to nothing answered, no activity informed, the PAR-Q instrument identified and no decision", () => {
    expect(EMPTY_SCREENING).toEqual({
      anamnesis: {},
      activity: {
        current: { practices: null, activities: "", frequency: null, duration: "", notes: "" },
        past: { practiced: null, activities: "", totalTime: "", frequency: null, notes: "" },
      },
      parq: { instrument: "parq_7_legacy", version: "pdf_2026_11", answers: {}, professionalReview: { decision: null, notes: "" } },
    });
    expect(parqUnanswered(EMPTY_SCREENING)).toEqual(PARQ_CODES);
    expect(parqHasYes(EMPTY_SCREENING)).toBe(false);
  });

  it("refuses another instrument or version, unknown questions, answers and decisions", () => {
    const base = EMPTY_SCREENING;
    expect(screeningSchema.safeParse({ ...base, parq: { ...base.parq, instrument: "parq_plus" } }).success).toBe(false);
    expect(screeningSchema.safeParse({ ...base, parq: { ...base.parq, version: "2020" } }).success).toBe(false);
    expect(screeningSchema.safeParse({ ...base, parq: { ...base.parq, answers: { heart_condition: "maybe" } } }).success).toBe(false);
    expect(screeningSchema.safeParse({ ...base, parq: { ...base.parq, answers: { invented: "yes" } } }).success).toBe(false);
    expect(screeningSchema.safeParse({ ...base, parq: { ...base.parq, professionalReview: { decision: "approved_by_ai", notes: "" } } }).success).toBe(false);
    expect(screeningSchema.safeParse({ ...base, anamnesis: { allergies: { answer: "sometimes", details: "" } } }).success).toBe(false);
    expect(screeningSchema.safeParse({ ...base, anamnesis: { invented: { answer: "yes", details: "" } } }).success).toBe(false);
    expect(screeningSchema.safeParse({ ...base, riskFlag: true }).success).toBe(false);
  });

  it("stores a frequency as a value per week, never as free text nor as 0", () => {
    const ok = { ...EMPTY_SCREENING.activity.current, frequency: { value: 3, unit: "por_semana" } };
    expect(screeningSchema.safeParse({ activity: { current: ok } }).success).toBe(true);
    expect(screeningSchema.safeParse({ activity: { current: { ...ok, frequency: { value: 0, unit: "por_semana" } } } }).success).toBe(false);
    expect(screeningSchema.safeParse({ activity: { current: { ...ok, frequency: "3x" } } }).success).toBe(false);
    expect(screeningSchema.safeParse({ activity: { current: { ...ok, frequency: { value: 3, unit: "por_dia" } } } }).success).toBe(false);
    const form = emptyForm();
    expect(screening({ ...form, current: { ...form.current, frequency: "3" } }).activity.current.frequency).toEqual({ value: 3, unit: "por_semana" });
    expect(screening({ ...form, past: { ...form.past, frequency: "1,5" } }).activity.past.frequency).toEqual({ value: 1.5, unit: "por_semana" });
    expect(screening(form).activity.current.frequency).toBeNull();
    expect(screeningFromForm({ ...form, current: { ...form.current, frequency: "3x" } })).toEqual({ payload: null, problems: ["Frequência (atual)"] });
    expect(screeningFromForm({ ...form, past: { ...form.past, frequency: "0" } })).toEqual({ payload: null, problems: ["Frequência anterior"] });
  });

  it("keeps an anamnesis answer with its description, leaves untouched questions out, and names a text too long", () => {
    const form = emptyForm();
    form.anamnesis.injuries = { answer: "yes", details: "Entorse no tornozelo direito em 2024" };
    form.anamnesis.allergies = { answer: "unknown", details: "" };
    const payload = screening(form);
    expect(payload.anamnesis).toEqual({
      allergies: { answer: "unknown", details: "" },
      injuries: { answer: "yes", details: "Entorse no tornozelo direito em 2024" },
    });
    form.anamnesis.surgeries = { answer: "yes", details: "x".repeat(MAX_TEXT + 1) };
    expect(screeningFromForm(form)).toEqual({ payload: null, problems: [ANAMNESIS.surgeries] });
  });

  it("always stores the seven PAR-Q answers with the instrument and its version", () => {
    const form = { ...emptyForm(), parq: { ...allParq("no"), dizziness: "yes" as const } };
    const payload = screening(form);
    expect(payload.parq.instrument).toBe(PARQ_INSTRUMENT.id);
    expect(payload.parq.version).toBe(PARQ_INSTRUMENT.version);
    expect(Object.keys(payload.parq.answers)).toEqual(PARQ_CODES);
    expect(payload.parq.answers.dizziness).toBe("yes");
  });

  it("goes back to the screen as it was typed", () => {
    const form = emptyForm();
    form.goals = ["strength"];
    form.anamnesis.medication = { answer: "yes", details: "Losartana" };
    form.current = { practices: "yes", activities: "Corrida", frequency: "3", duration: "45 min", notes: "" };
    form.past = { practiced: "no", activities: "", totalTime: "", frequency: "", notes: "Nunca treinou" };
    form.parq = { ...allParq("no"), blood_pressure_medication: "yes" };
    form.decision = "medical_clearance";
    form.decisionNotes = "Pedir liberação do cardiologista.";
    const profile = profileFromForm(form).payload!;
    expect(triagemFormFrom(profile, readScreening(JSON.parse(JSON.stringify(screening(form)))))).toEqual(form);
  });
});

describe("the PAR-Q rules: a flag that asks for a human decision, never a verdict", () => {
  it("a question not answered is pending, never a Não", () => {
    const form = { ...emptyForm(), parq: { ...allParq("no"), other_reason: "unanswered" as const } };
    const payload = screening(form);
    expect(parqUnanswered(payload)).toEqual(["other_reason"]);
    expect(screeningPending(payload)).toEqual(["PAR-Q: 1 de 7 pergunta sem resposta"]);
    expect(screeningPending(EMPTY_SCREENING)).toEqual(["PAR-Q: 7 de 7 perguntas sem resposta"]);
  });

  it("all Não: nothing pending, no decision asked", () => {
    const form = { ...emptyForm(), parq: allParq("no") };
    expect(screeningPending(screening(form))).toEqual([]);
    expect(decisionShown(form)).toBe(false);
  });

  it("any Sim asks for the decision and its note, and both clear it", () => {
    const form = { ...emptyForm(), parq: { ...allParq("no"), chest_pain_activity: "yes" as const } };
    expect(parqHasYes(screening(form))).toBe(true);
    expect(decisionShown(form)).toBe(true);
    expect(screeningPending(screening(form))).toEqual(["PAR-Q com “Sim”: registre a decisão profissional", "PAR-Q com “Sim”: escreva a nota da decisão"]);
    expect(screeningPending(screening({ ...form, decision: "other" }))).toEqual(["PAR-Q com “Sim”: escreva a nota da decisão"]);
    expect(screeningPending(screening({ ...form, decision: "other", decisionNotes: "   " }))).toEqual(["PAR-Q com “Sim”: escreva a nota da decisão"]);
    expect(screeningPending(screening({ ...form, decision: "cleared", decisionNotes: "Dor investigada; exames normais." }))).toEqual([]);
  });

  it("a decision typed stays on the screen and stored even if the Sim is changed, so nothing typed is hidden", () => {
    const form = { ...emptyForm(), parq: allParq("no"), decision: "cleared" as const, decisionNotes: "Liberado" };
    expect(decisionShown(form)).toBe(true);
    expect(screening(form).parq.professionalReview).toEqual({ decision: "cleared", notes: "Liberado" });
    expect(screeningPending(screening(form))).toEqual([]);
  });
});

describe("the size of the module", () => {
  it("fits the size a section takes even with every text at its ceiling (the repository refuses a larger section)", () => {
    const long = "ç".repeat(MAX_TEXT);
    const form = emptyForm();
    for (const code of Object.keys(form.anamnesis) as (keyof TriagemForm["anamnesis"])[]) form.anamnesis[code] = { answer: "yes", details: long };
    form.current = { practices: "yes", activities: long, frequency: "3", duration: long, notes: long };
    form.past = { practiced: "yes", activities: long, totalTime: long, frequency: "2", notes: long };
    form.parq = allParq("yes");
    form.decision = "other";
    form.decisionNotes = long;
    expect(JSON.stringify(screening(form)).length).toBeLessThan(MAX_SECTION_CHARS);
  });
});
