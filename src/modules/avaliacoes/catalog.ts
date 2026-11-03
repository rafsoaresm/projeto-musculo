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

/** The perimeters of page 2 (cm): some single, some on each side (handoff 3.2: each side in a field of its own). */
export const PERIMETERS_SINGLE = { shoulder: "Ombro", chest: "Tórax", waist: "Cintura", abdomen: "Abdômen", hip: "Quadril" } as const;
export const PERIMETERS_SIDED = { arm: "Braço", forearm: "Antebraço", thigh: "Coxa", calf: "Panturrilha" } as const;
export type PerimeterSingle = keyof typeof PERIMETERS_SINGLE;
export type PerimeterSided = keyof typeof PERIMETERS_SIDED;
/** The stored codes, in the order of the screen (the order of page 2). */
export const PERIMETER_SINGLE_CODES = ["shoulder", "chest", "waist", "abdomen", "hip"] as const satisfies readonly PerimeterSingle[];
export const PERIMETER_SIDED_CODES = ["arm", "forearm", "thigh", "calf"] as const satisfies readonly PerimeterSided[];
/** The sided perimeters with their article, for the sentences that name them ("do braço", "da coxa"). */
export const PERIMETERS_SIDED_OF: Record<PerimeterSided, string> = { arm: "do braço", forearm: "do antebraço", thigh: "da coxa", calf: "da panturrilha" };

/** The bone breadths of page 2 (cm). */
export const BONE_BREADTHS = { humerus: "Biepicondilar do úmero", femur: "Biepicondilar do fêmur", wrist: "Biestiloide" } as const;
export type BoneBreadth = keyof typeof BONE_BREADTHS;
export const BONE_BREADTH_CODES = ["humerus", "femur", "wrist"] as const satisfies readonly BoneBreadth[];

/* ---------- Page 3: posture and somatotype (handoff 3.3) ---------- */

/** The three views of the postural assessment, in the order of page 3. */
export const POSTURE_VIEWS = { lateral: "Visão lateral", posterior: "Visão posterior", anterior: "Visão anterior" } as const;
export type PostureView = keyof typeof POSTURE_VIEWS;
export const POSTURE_VIEW_CODES = ["lateral", "posterior", "anterior"] as const satisfies readonly PostureView[];
/** The short name of each view, for the tabs and the sentences that name them ("Lateral", "na visão lateral"). */
export const POSTURE_VIEW_SHORT: Record<PostureView, string> = { lateral: "Lateral", posterior: "Posterior", anterior: "Anterior" };

/**
 * One region of a view (handoff 3.3: `view`, `region`, `findings[]`): its findings with their labels, in the handoff's order and words (only the
 * capitalization changes). `multiple`: findings that may coexist are a multiple choice (handoff: "seleção múltipla apenas nos achados que possam
 * coexistir"); the others are a single choice. `neutral`: the finding that says "nothing deviates" (alinhado, fisiológico, sem desvio observado),
 * which never goes with another finding of the region. A region left without a finding was not observed: never "alinhado" by default.
 * "Sem desvio observado" in the head tilt and the hip rotation is the option the handoff adds; it is placed first, as the neutral finding is in the
 * other regions (the handoff writes it after "direita / esquerda"). `sided`: a paired region whose findings do not name a side, so the side is
 * recorded apart (handoff 3.3: `laterality?`); the regions whose findings already say it (esquerdo deprimido, esquerda alada...) and the midline
 * ones are not sided.
 */
export interface PostureRegion {
  view: PostureView;
  region: string;
  label: string;
  findings: Readonly<Record<string, string>>;
  neutral: string | null;
  multiple: boolean;
  sided: boolean;
}
export const POSTURE_REGIONS = [
  { view: "lateral", region: "cervical_lordosis", label: "Lordose cervical", findings: { physiological: "Fisiológica", increased: "Aumentada", decreased: "Diminuída" }, neutral: "physiological", multiple: false, sided: false },
  { view: "lateral", region: "shoulders", label: "Ombros", findings: { aligned: "Alinhados", protracted: "Protusos", internal_rotation: "Rotação interna" }, neutral: "aligned", multiple: true, sided: true },
  { view: "lateral", region: "abdomen", label: "Abdômen", findings: { physiological: "Fisiológico", protruding: "Protuso" }, neutral: "physiological", multiple: false, sided: false },
  { view: "lateral", region: "thoracic_kyphosis", label: "Cifose torácica", findings: { physiological: "Fisiológica", increased: "Aumentada", flattened: "Retificada" }, neutral: "physiological", multiple: false, sided: false },
  { view: "lateral", region: "lumbar_lordosis", label: "Lordose lombar", findings: { physiological: "Fisiológica", increased: "Aumentada", flattened: "Retificada" }, neutral: "physiological", multiple: false, sided: false },
  { view: "lateral", region: "hip", label: "Quadril", findings: { aligned: "Alinhado", anteversion: "Anteversão", retroversion: "Retroversão" }, neutral: "aligned", multiple: false, sided: false },
  { view: "lateral", region: "knees", label: "Joelhos", findings: { aligned: "Alinhados", recurvatum: "Recurvatum", flexed: "Flexo" }, neutral: "aligned", multiple: false, sided: true },
  { view: "lateral", region: "feet", label: "Pés", findings: { flat: "Plano", cavus: "Cavo", calcaneus: "Calcâneo", equinus: "Equino" }, neutral: null, multiple: true, sided: true },
  { view: "posterior", region: "shoulders", label: "Ombros", findings: { aligned: "Alinhados", left_depressed: "Esquerdo deprimido", right_depressed: "Direito deprimido" }, neutral: "aligned", multiple: false, sided: false },
  { view: "posterior", region: "spine", label: "Coluna", findings: { aligned: "Alinhada", lumbar_scoliosis: "Escoliose lombar", thoracic_scoliosis: "Escoliose torácica", s_curve: "Em “S”" }, neutral: "aligned", multiple: true, sided: false },
  {
    view: "posterior",
    region: "scapulae",
    label: "Escápulas",
    findings: { abducted: "Abduzida", left_winged: "Esquerda alada", right_winged: "Direita alada", downward_rotation: "Rodada inferior", upward_rotation: "Rodada superior" },
    neutral: null,
    multiple: true,
    sided: false,
  },
  { view: "posterior", region: "feet", label: "Pés", findings: { aligned: "Alinhados", pronated: "Pronados", supinated: "Supinados" }, neutral: "aligned", multiple: false, sided: true },
  { view: "posterior", region: "tibia", label: "Tíbia", findings: { aligned: "Alinhada", varus: "Vara", valgus: "Valga" }, neutral: "aligned", multiple: false, sided: true },
  { view: "posterior", region: "head_tilt", label: "Inclinação da cabeça", findings: { none: "Sem desvio observado", right: "Direita", left: "Esquerda" }, neutral: "none", multiple: false, sided: false },
  { view: "posterior", region: "hip_rotation", label: "Rotação do quadril", findings: { none: "Sem desvio observado", internal: "Interna", external: "Externa" }, neutral: "none", multiple: false, sided: true },
  { view: "anterior", region: "knees", label: "Joelhos", findings: { aligned: "Alinhados", valgus: "Valgo", varus: "Varo" }, neutral: "aligned", multiple: false, sided: true },
  { view: "anterior", region: "patellae", label: "Patelas", findings: { aligned: "Alinhadas", lateralized: "Lateralizadas", medialized: "Medializadas" }, neutral: "aligned", multiple: false, sided: true },
  { view: "anterior", region: "asis", label: "EIAS", findings: { aligned: "Alinhada", left_depressed: "Esquerda deprimida", right_depressed: "Direita deprimida" }, neutral: "aligned", multiple: false, sided: false },
  { view: "anterior", region: "psis", label: "EIPS", findings: { aligned: "Alinhada", left_depressed: "Esquerda deprimida", right_depressed: "Direita deprimida" }, neutral: "aligned", multiple: false, sided: false },
] as const satisfies readonly PostureRegion[];
/** The side of a sided region's findings (handoff 3.3: `laterality?`), recorded only with a finding that is not the neutral one. */
export const LATERALITIES = { left: "Lado esquerdo", right: "Lado direito", both: "Ambos os lados" } as const;
export type LateralityCode = keyof typeof LATERALITIES;
export const LATERALITY_CODES = ["left", "right", "both"] as const satisfies readonly LateralityCode[];
/** The stored key of a region: its view and its region ("lateral_shoulders"), so the same region in two views never mixes. */
type RegionKeyOf<R> = R extends { view: infer V extends string; region: infer G extends string } ? `${V}_${G}` : never;
export type PostureRegionKey = RegionKeyOf<(typeof POSTURE_REGIONS)[number]>;
export const postureRegionKey = (region: PostureRegion) => `${region.view}_${region.region}` as PostureRegionKey;
export const POSTURE_REGION_KEYS = POSTURE_REGIONS.map(postureRegionKey) as [PostureRegionKey, ...PostureRegionKey[]];
export const POSTURE_REGION_BY_KEY: Record<PostureRegionKey, PostureRegion> = Object.fromEntries(
  POSTURE_REGIONS.map((region): [string, PostureRegion] => [postureRegionKey(region), region]),
) as Record<PostureRegionKey, PostureRegion>;

/**
 * The somatotype as the professional records it (handoff 3.3: "seleção/registro profissional manual"), never inferred from a photo. The three
 * components may be chosen together (the PDF's "endomorfo-mesomorfo"); "Misto" and "Não classificado" stand alone.
 */
export const SOMATOTYPES = { endomorph: "Endomorfo", mesomorph: "Mesomorfo", ectomorph: "Ectomorfo", mixed: "Misto", unclassified: "Não classificado" } as const;
export type SomatotypeCode = keyof typeof SOMATOTYPES;
export const SOMATOTYPE_CODES = ["endomorph", "mesomorph", "ectomorph", "mixed", "unclassified"] as const satisfies readonly SomatotypeCode[];
export const SOMATOTYPE_ALONE: readonly SomatotypeCode[] = ["mixed", "unclassified"];

/**
 * Two measures of the Heath-Carter protocol that page 2 does not have (handoff 3.3 names them: the supraspinale skinfold — not the suprailiac — and
 * the flexed arm girth). They are kept as measured; the somatotype is not computed in this version (handoff 10: P2), so no equation runs on them.
 */
export const HEATH_CARTER_MEASURES = {
  supraspinaleSkinfoldMm: { label: "Dobra supraespinhal", unit: "mm" },
  flexedArmGirthCm: { label: "Perímetro do braço flexionado", unit: "cm" },
} as const;
export type HeathCarterMeasure = keyof typeof HEATH_CARTER_MEASURES;
export const HEATH_CARTER_CODES = ["supraspinaleSkinfoldMm", "flexedArmGirthCm"] as const satisfies readonly HeathCarterMeasure[];
