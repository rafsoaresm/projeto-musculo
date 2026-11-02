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

/**
 * The PAR-Q of the document, seven questions (handoff 3.1): the legacy instrument as it is, identified with its version. A different
 * instrument (PAR-Q+) is another form with its own identifier, never this one replaced silently.
 */
export const PARQ_INSTRUMENT = { id: "parq_7_legacy", version: "pdf_2026_11" } as const;
// The wording of the handoff (section 3.1), which summarizes the PDF's; the PDF's own text replaces it if it differs (PENDENCIAS B47).
export const PARQ = {
  heart_condition: "Algum médico informou que você tem um problema cardíaco e recomendou atividade física apenas supervisionada?",
  chest_pain_activity: "Você sente dor no peito durante a atividade física?",
  chest_pain_month: "No último mês, você sentiu dor no peito ao praticar atividade física?",
  dizziness: "Você tem tontura, desequilíbrio e/ou perda de consciência?",
  bone_joint: "Você tem algum problema ósseo ou articular que possa ser agravado pela atividade física?",
  blood_pressure_medication: "Você toma medicação para pressão arterial e/ou problemas cardíacos?",
  other_reason: "Você conhece outra razão para não realizar atividade física?",
} as const;

// The nine skinfold sites of page 2 (mm) are with the protocols that use them: formulas/protocols.ts (SKINFOLD_SITES).
export { SKINFOLD_SITES, type SkinfoldSite } from "./formulas/protocols";

/** The perimeters of page 2 (cm): some single, some on each side. */
export const PERIMETERS_SINGLE = { shoulder: "Ombro", chest: "Tórax", waist: "Cintura", abdomen: "Abdômen", hip: "Quadril" } as const;
export const PERIMETERS_SIDED = { arm: "Braço", forearm: "Antebraço", thigh: "Coxa", calf: "Panturrilha" } as const;

/** The bone breadths of page 2 (cm). */
export const BONE_BREADTHS = { humerus: "Biepicondilar do úmero", femur: "Biepicondilar do fêmur", wrist: "Biestiloide" } as const;
