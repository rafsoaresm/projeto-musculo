/**
 * The stable codes of the physical assessment, version 2 (handoff "Avaliação Física V2", sections 2 and 3): the modules of an assessment and
 * the items of each one, with the label people read. The codes are what is stored and never change; a label may be corrected (spelling) without
 * touching what was recorded. Pure data: no screen and no database here.
 */

/** The modules of an assessment of the new format, in the order of the guided flow (handoff section 2). */
export const ASSESSMENT_MODULES = ["profile", "screening", "composition", "posture", "movement", "tests", "conclusion"] as const;
export type AssessmentModule = (typeof ASSESSMENT_MODULES)[number];
export const MODULE_LABEL: Record<AssessmentModule, string> = {
  profile: "Perfil e objetivos",
  screening: "Triagem e segurança",
  composition: "Composição corporal",
  posture: "Postura",
  movement: "Movimento e flexibilidade",
  tests: "Testes físicos",
  conclusion: "Revisão e conclusão",
};
export const SECTION_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "DONE", "SKIPPED"] as const;
export type SectionStatus = (typeof SECTION_STATUSES)[number];
export const isModule = (value: unknown): value is AssessmentModule => typeof value === "string" && (ASSESSMENT_MODULES as readonly string[]).includes(value);

/** The goals of the training (page 1 of the PDF), several at once. */
export const GOALS = {
  toning: "Enrijecimento",
  hypertrophy: "Hipertrofia",
  strength: "Fortalecimento",
  definition: "Definição muscular",
  health: "Saúde e bem-estar",
  weight_loss: "Emagrecimento",
  conditioning: "Preparação física",
} as const;

/** The free field next to the goals (handoff 3.1: "Campo de objetivos adicionais e notas"). */
export const GOALS_NOTES_LABEL = "Objetivos adicionais e notas";

/** The ten questions of the clinical anamnesis (page 1), each answered Yes, No or Not informed, with a description. */
export const ANAMNESIS = {
  family_diseases: "Doenças na família nos últimos anos",
  personal_diseases: "Doenças pessoais nos últimos anos",
  exercise_restriction: "Restrição à prática de exercícios físicos",
  surgeries: "Cirurgias prévias",
  allergies: "Alergias",
  injuries: "Acidentes ou lesões osteomusculares",
  medication: "Uso de medicamentos",
  recent_pain: "Dores corporais recentes",
  smoking: "Hábito atual ou anterior de fumar",
  diet: "Dieta para perder ou ganhar peso",
} as const;

/** The answers of an anamnesis question (handoff 3.1: "Sim / Não / Não informado"). */
export const ANAMNESIS_ANSWERS = { yes: "Sim", no: "Não", unknown: "Não informado" } as const;

/**
 * Current and past physical activity (handoff 3.1, with its words): practises?; activities; frequency as a value with the unit "por_semana",
 * never free text such as "3x"; duration/time of practice; notes — and for the past, the total time of practice and the earlier frequency.
 */
export const ACTIVITY_CURRENT = {
  practices: "Pratica?",
  activities: "Atividades",
  frequency: "Frequência",
  duration: "Duração/tempo de prática",
  notes: "Observações",
} as const;
export const ACTIVITY_PAST = {
  practiced: "Praticou?",
  activities: "Atividades",
  totalTime: "Tempo total de prática",
  frequency: "Frequência anterior",
  notes: "Observações",
} as const;
export const FREQUENCY_UNITS = { por_semana: "por semana" } as const;

/**
 * The PAR-Q of the document, seven questions (handoff 3.1): the legacy instrument as it is, identified with its version. A different
 * instrument (PAR-Q+) is another form with its own identifier, never this one replaced silently.
 */
export const PARQ_INSTRUMENT = { id: "parq_7_legacy", version: "pdf_2026_11" } as const;
/** How the screens name that instrument and version (the ids above are what is stored). */
export const PARQ_INSTRUMENT_LABEL = "7 perguntas, versão do PDF de novembro de 2026";
// The handoff's own wording (section 3.1, items 1–7, verbatim). The PDF's text is not in the repository; when it arrives and differs, it
// replaces this (PENDENCIAS B47).
export const PARQ = {
  heart_condition: "Algum médico informou problema cardíaco e recomendou atividade apenas supervisionada?",
  chest_pain_activity: "Dor no peito durante atividade física?",
  chest_pain_month: "Dor no peito no último mês ao praticar atividade física?",
  dizziness: "Tontura, desequilíbrio e/ou perda de consciência?",
  bone_joint: "Problema ósseo/articular potencialmente agravável por atividade física?",
  blood_pressure_medication: "Medicação para pressão arterial e/ou problemas cardíacos?",
  other_reason: "Outra razão conhecida para não realizar atividade física?",
} as const;
/** The answers of a PAR-Q question (handoff 3.1: "Sim / Não / Não respondido"): one not answered is pending, never a "Não". */
export const PARQ_ANSWERS = { yes: "Sim", no: "Não", unanswered: "Não respondido" } as const;
/**
 * The professional's decision when any PAR-Q answer is "Sim" (handoff 3.1: a human decision is recorded, nothing is decided automatically;
 * the three choices are the user's decision of 02/11/2026: cleared to train, needs medical clearance, other — always with a note).
 */
export const PARQ_DECISIONS = {
  cleared: "Liberado para treinar",
  medical_clearance: "Precisa de liberação médica",
  other: "Outra decisão",
} as const;

// The nine skinfold sites of page 2 (mm) are with the protocols that use them: formulas/protocols.ts (SKINFOLD_SITES).
export { SKINFOLD_SITES, type SkinfoldSite } from "./formulas/protocols";

/** The perimeters of page 2 (cm): some single, some on each side. */
export const PERIMETERS_SINGLE = { shoulder: "Ombro", chest: "Tórax", waist: "Cintura", abdomen: "Abdômen", hip: "Quadril" } as const;
export const PERIMETERS_SIDED = { arm: "Braço", forearm: "Antebraço", thigh: "Coxa", calf: "Panturrilha" } as const;

/** The bone breadths of page 2 (cm). */
export const BONE_BREADTHS = { humerus: "Biepicondilar do úmero", femur: "Biepicondilar do fêmur", wrist: "Biestiloide" } as const;
