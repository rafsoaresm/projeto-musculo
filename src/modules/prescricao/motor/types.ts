/**
 * Motor de prescrição v2: tipos. O motor é puro (sem banco, rede, IA, relógio ou acaso) e não
 * conhece organização nem usuário: recebe fatos já autorizados pelo adaptador e devolve uma
 * proposta para revisão profissional. Todo número traz a sua base (Basis).
 */

/** De onde vem um valor. EVIDENCE só com referência verificada no repositório. */
export type Basis = "EVIDENCE" | "HEURISTIC" | "HEURISTIC_ACCEPTED" | "PROFESSIONAL" | "STUDENT_DATA";

export interface Fact<T> {
  value: T;
  source: "PROFILE" | "ASSESSMENT" | "STRUCTURE" | "PROFESSIONAL" | "HISTORY" | "RULES";
  ref?: string;
  basis: Basis;
  ruleId?: string;
}

export interface Range {
  min: number;
  max: number;
}

export type Metric = "REPS" | "TIME" | "DISTANCE" | "INTERVALS" | "CONTINUOUS";
export type LoadBasis = "TOTAL" | "PER_HAND" | "PER_SIDE" | "MACHINE_STACK" | "BODYWEIGHT" | "ASSISTANCE" | "NONE";

export type Intensity =
  | { kind: "RIR"; range: Range }
  | { kind: "RPE"; range: Range }
  | { kind: "PERCENT_1RM"; range: Range }
  | {
      kind: "ZONE";
      systemLabel: string;
      zone: string;
      bounds?: { unit: "BPM" | "PACE_S_PER_KM" | "WATTS" | "RPE"; range: Range };
    }
  | { kind: "PACE"; secondsPerKm: Range }
  | { kind: "TEXT"; text: string };

export type MethodKind =
  | "STRAIGHT"
  | "SUPERSET"
  | "CIRCUIT"
  | "DROP_SET"
  | "REST_PAUSE"
  | "CLUSTER"
  | "EMOM"
  | "AMRAP"
  | "CUSTOM";
export interface Method {
  kind: MethodKind;
  groupKey?: string;
  text?: string;
}

/** Um formato de dose por métrica: força não é forçada em séries × repetições quando não cabe. */
export type Dose =
  | {
      metric: "REPS";
      sets: number;
      reps: Range;
      intensity?: Intensity;
      tempo?: string;
      restSeconds: number | null;
      loadBasis: LoadBasis;
      /** O motor nunca propõe quilos. */
      loadKg: null;
      loadInstruction?: string;
      method?: Method;
    }
  | {
      metric: "TIME";
      sets: number;
      durationSeconds: Range;
      intensity?: Intensity;
      restSeconds: number | null;
      method?: Method;
    }
  | { metric: "DISTANCE"; sets: number; distanceMeters: Range; intensity?: Intensity; restSeconds: number | null }
  | {
      metric: "INTERVALS";
      blocks: number;
      repeats: number;
      work: { durationSeconds?: Range; distanceMeters?: Range; intensity?: Intensity };
      recovery: { durationSeconds: Range; mode: "PASSIVE" | "ACTIVE"; intensity?: Intensity };
      restBetweenBlocksSeconds: number | null;
    }
  | { metric: "CONTINUOUS"; durationSeconds?: Range; distanceMeters?: Range; intensity?: Intensity };

/**
 * Parâmetros numéricos de dose em forma plana: é nesta forma que regras, ajustes do profissional
 * e progressões semanais se combinam, cada parâmetro com a sua base.
 */
export type DoseParam =
  | "sets"
  | "repsMin"
  | "repsMax"
  | "durationMin"
  | "durationMax"
  | "distanceMin"
  | "distanceMax"
  | "restSeconds"
  | "rirMin"
  | "rirMax"
  | "rpeMin"
  | "rpeMax"
  | "blocks"
  | "repeats"
  | "workDurationMin"
  | "workDurationMax"
  | "workDistanceMin"
  | "workDistanceMax"
  | "recoveryMin"
  | "recoveryMax"
  | "restBetweenBlocks";

export interface DosePatch {
  values?: Partial<Record<DoseParam, number>>;
  /** Intensidade escrita pelo profissional (zona, ritmo, %1RM, texto). Vence RIR/RPE numéricos. */
  intensity?: Intensity;
  tempo?: string;
  method?: Method;
  loadBasis?: LoadBasis;
  loadInstruction?: string;
  recoveryMode?: "PASSIVE" | "ACTIVE";
}

/** Progressão semanal dentro de uma fase. As partes se combinam; `model` é o rótulo escolhido. */
export interface WeeklyProgression {
  model: "NONE" | "LINEAR" | "STEP" | "SEQUENCE" | "BLOCK" | "CUSTOM";
  /** LINEAR: interpola do valor inicial (semana 1) ao final (última semana). */
  ramps?: Array<{ param: DoseParam; from: number; to: number; metric?: Metric }>;
  /** STEP: soma `delta` a cada `everyWeeks` semanas, sem passar de `limit`. */
  steps?: Array<{ param: DoseParam; delta: number; everyWeeks: number; limit?: number; metric?: Metric }>;
  /** SEQUENCE (ondulatória): troca o estímulo por semana ou por sessão da semana. */
  sequence?: { per: "WEEK" | "OCCURRENCE_IN_WEEK"; stimuli: string[] };
  /** BLOCK: blocos de semanas com estímulo próprio; somam as semanas da fase. */
  blocks?: Array<{ weeks: number; stimulus: string }>;
  /** CUSTOM: ajustes de semanas específicas. */
  weekOverrides?: Array<{ week: number; patch: DosePatch }>;
  /** Descarga: séries × multiplicador (arredondado, mínimo 0) e ajustes opcionais. */
  deload?: { weeks: number[]; setsMultiplier: number; patch?: DosePatch };
}

export interface RuleSetRef {
  id: string;
  version: string;
}

export type MetadataStatus = "REVIEWED" | "INFERRED" | "PENDING";

/** Exercício já filtrado pelo adaptador para o que a organização pode ver. Única fonte de ids. */
export interface CatalogExercise {
  id: string;
  name: string;
  /** Nome normalizado (como `exercises.name_key`); usado só na chave de exercícios personalizados. */
  nameKey?: string;
  category: string | null;
  modality: string | null;
  metric: Metric | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  patterns: string[];
  /** Equipamento padrão: todos exigidos. Vazio = sem equipamento. */
  equipment: string[];
  /**
   * Conjuntos alternativos ao padrão: o exercício é elegível se o padrão estiver todo disponível
   * OU se algum destes conjuntos estiver todo disponível.
   */
  equipmentAlternatives: string[][];
  /** 1 (mais simples) a 5. */
  difficulty: number | null;
  laterality: "UNILATERAL" | "BILATERAL" | null;
  compound: boolean | null;
  secondsPerRep: number | null;
  cautionTags: string[];
  /** Substituições curadas (ids do catálogo). */
  substitutes: string[];
  /** REVIEWED vence; INFERRED aparece como "Inferido (não revisado)"; PENDING não é selecionado. */
  metadataStatus: MetadataStatus;
  archived: boolean;
}

export type Experience = "BEGINNER" | "INTERMEDIATE" | "ADVANCED";

/**
 * Decisão do profissional sobre a triagem. CLEARED, MEDICAL_CLEARANCE e OTHER são as três escolhas do PAR-Q da
 * Avaliação Física (`PARQ_DECISIONS`); REVIEWED é a revisão registrada do formato anterior (só o fundamento,
 * em texto); CLEARED_WITH_RESTRICTIONS e REFER ficam para outras origens. Nenhuma muda a seleção sozinha.
 */
export type ScreeningDecision = "CLEARED" | "CLEARED_WITH_RESTRICTIONS" | "REFER" | "MEDICAL_CLEARANCE" | "OTHER" | "REVIEWED";

export interface ScreeningFacts {
  parq: "CLEAR" | "POSITIVE" | "NOT_DONE";
  professionalDecision: ScreeningDecision | null;
  /** "Precisa de liberação médica" registrada (R13: não bloqueia a geração nem a aprovação). */
  medicalClearanceRecorded: boolean;
  ref?: string;
}

export interface FindingFact {
  kind: "MOVEMENT" | "POSTURE" | "FLEXIBILITY" | "ANAMNESIS" | "ASSESSMENT_CONTEXT";
  code: string;
  label: string;
  /** Grau do achado (ex.: teste de movimento MODERATE, STOPPED_BY_PAIN). */
  grade?: string;
  ref?: string;
}

export interface StudentFacts {
  /** Texto do nível no perfil, mapeado por EXPERIENCE_MAP. */
  level: Fact<string> | null;
  /** Objetivo em texto: produz apenas sugestões de estímulo, nunca uma escolha. */
  goal: Fact<string> | null;
  sessionMinutes: Fact<number> | null;
  screening: ScreeningFacts;
  findings: FindingFact[];
}

export interface WorkoutFocusFacts {
  stimulus?: Fact<string>;
  modalities?: string[];
  muscles?: string[];
  patterns?: string[];
  minutes?: number;
  excludedExerciseIds?: string[];
}

export interface StructureOccurrence {
  week: number;
  slot: number;
  label: string;
  plannedDate: string | null;
  weekStart: string;
}

export interface StructureWorkout {
  label: string;
  name: string | null;
  exerciseTarget: number | null;
  focus: WorkoutFocusFacts;
}

export interface StructurePhase {
  index: number;
  name: string | null;
  weeks: number;
  sessionsPerWeek: number;
  workouts: StructureWorkout[];
  occurrences: StructureOccurrence[];
  stimulus?: Fact<string>;
  progression?: Fact<WeeklyProgression>;
}

export interface StructureFacts {
  startDate: string;
  phases: StructurePhase[];
}

export interface ExposureSet {
  reps: number | null;
  durationSeconds: number | null;
  loadKg: number | null;
  loadBasis: LoadBasis | null;
  rir: number | null;
  completed: boolean;
}

/** Um registro de execução de um exercício (já dentro da janela pedida pelo adaptador). */
export interface ExposureLog {
  exerciseId: string;
  date: string;
  equipmentKey: string | null;
  metric: Metric;
  sets: ExposureSet[];
  pain: boolean;
  /** Esforço da sessão (0 a 10) que o aluno registrou; só contexto, o motor não o usa para calcular. */
  sessionEffort?: number | null;
  ref?: string;
}

export interface DisplayFields {
  sets: string | null;
  reps: string | null;
  loadInstruction: string | null;
  cadence: string | null;
  restSeconds: number | null;
  restText: string | null;
  rirMin: number | null;
  rirMax: number | null;
  doseText: string;
}

/** Linha atual da revisão em rascunho: sempre preservada. */
export interface ExistingItem {
  prescribedExerciseId: string;
  phaseIndex: number;
  label: string;
  exerciseId: string | null;
  name: string;
  nameKey?: string;
  position: number;
  dose: Dose | null;
  display: DisplayFields;
  origin: string;
}

export interface ItemTarget {
  phaseIndex: number;
  slotKey: string;
}

export type FlagDecision =
  | { kind: "EXCLUDE_PATTERN"; pattern: string }
  | { kind: "EXCLUDE_CAUTION_TAG"; tag: string }
  | { kind: "EXCLUDE_EXERCISE"; exerciseId: string }
  | { kind: "ACKNOWLEDGE" };

export interface DoseOverride {
  /** Ausente = qualquer. */
  stimulus?: string;
  /**
   * Só sem `stimulus`: estímulos aos quais o ajuste não se aplica. A linha "qualquer estímulo" da tabela de doses vale para os
   * estímulos sem linha própria; editada, ela não deve mudar as linhas de um estímulo nomeado (que mostram o seu próprio valor).
   */
  exceptStimuli?: string[];
  modality?: string;
  metric?: Metric;
  phaseIndex?: number;
  label?: string;
  exerciseId?: string;
  patch: DosePatch;
}

export interface GenerationParameters {
  /** Q1 (04/11/2026): o adaptador preenche FILL_FROM_POLICY por padrão; LEAVE_EMPTY deixa toda dose vazia. */
  doseMode: "FILL_FROM_POLICY" | "LEAVE_EMPTY";
  metadataTrust: "REVIEWED_ONLY" | "REVIEWED_AND_INFERRED";
  stimulusByPhase: Array<{ phaseIndex: number; value: string; basis: "PROFESSIONAL" | "HEURISTIC_ACCEPTED"; ruleId?: string }>;
  modalitiesByWorkout: Array<{ phaseIndex: number; label: string; modalities: string[] }>;
  /** null = não informado (pergunta obrigatória); [] = sem equipamento. */
  availableEquipment: string[] | null;
  availableMinutes: number | null;
  timeBudget: "SOFT" | "HARD";
  exerciseCountByWorkout: Array<{ phaseIndex: number; label: string; count: number | "BY_TIME" }>;
  preferredExerciseIds: string[];
  excludedExerciseIds: string[];
  excludedPatterns: string[];
  excludedCautionTags: string[];
  phaseCoverage: Array<{
    phaseIndex: number;
    muscles?: string[];
    patterns?: string[];
    basis: "PROFESSIONAL" | "HEURISTIC_ACCEPTED";
    ruleId?: string;
  }>;
  progressionByPhase: Array<{ phaseIndex: number; progression: WeeklyProgression }>;
  doseOverrides: DoseOverride[];
  /** Métrica escolhida pelo profissional para um exercício (vence o atributo do catálogo). */
  metricOverrides: Array<{ exerciseId: string; metric: Metric }>;
  acceptedFlagDecisions: Array<{ flagCode: string; decision: FlagDecision }>;
}

export type GenerationScope = { kind: "FULL" } | { kind: "PHASES"; phaseIndexes: number[] };

export interface EngineInput {
  rules: RuleSetRef;
  /** Data de referência (AAAA-MM-DD) fornecida pelo chamador; o motor não lê o relógio. */
  asOf: string;
  parameters: GenerationParameters;
  student: StudentFacts;
  structure: StructureFacts;
  catalog: CatalogExercise[];
  history: ExposureLog[];
  existing: ExistingItem[];
  locked: ItemTarget[];
  scope: GenerationScope;
}

export type RegenerationScope =
  | { kind: "ITEM"; phaseIndex: number; week: number; slot: number; slotKey: string }
  | { kind: "OCCURRENCE"; phaseIndex: number; week: number; slot: number }
  | { kind: "WEEK"; phaseIndex: number; week: number }
  | { kind: "WORKOUT"; phaseIndex: number; label: string; fromWeek?: number }
  | { kind: "PHASE"; phaseIndex: number }
  | { kind: "FROM_PHASE"; phaseIndex: number };

export type SubstitutionTarget = {
  phaseIndex: number;
  slotKey: string;
  applies: { kind: "OCCURRENCE"; week: number; slot: number } | { kind: "FROM_WEEK"; week: number } | { kind: "PHASE" };
};

export interface TraceEntry {
  code: string;
  basis: Basis;
  ruleId?: string;
  detail: string;
}

export interface ParamTrace {
  param: string;
  value: unknown;
  basis: Basis;
  ruleId?: string;
  refs?: string[];
}

/** REVIEWED; INCLUDES_INFERRED = "Inferido (não revisado)"; PENDING = sem curadoria; NOT_APPLICABLE = linha sem exercício da biblioteca. */
export type ItemMetadata = "REVIEWED" | "INCLUDES_INFERRED" | "PENDING" | "NOT_APPLICABLE";

export interface ItemOut {
  slotKey: string;
  position: number;
  exerciseId: string | null;
  exerciseName: string;
  modality: string | null;
  dose: Dose | null;
  display: DisplayFields;
  origin: "ENGINE" | "PRESERVED" | "LOCKED" | "SUBSTITUTED";
  existingPrescribedExerciseId: string | null;
  substitutesSlotKey: string | null;
  alternatives: string[];
  metadata: ItemMetadata;
  trace: { selection: TraceEntry[]; params: ParamTrace[] };
}

export interface OccurrenceOut {
  phaseIndex: number;
  week: number;
  slot: number;
  label: string;
  plannedDate: string | null;
  weekStart: string;
  stimulus: Fact<string> | null;
  items: ItemOut[];
  /** Estimativa conservadora; parcial quando algum item não tem duração calculável. */
  estimatedMinutes: number | null;
  durationComplete: boolean;
  budgetMinutes: number | null;
  budgetSource: "WORKOUT" | "PARAMETERS" | "PROFILE" | null;
}

export type Severity = "ERROR" | "WARNING" | "INFO";

export interface Suggestion {
  value: string;
  ruleId: string;
  label: string;
}

export interface Issue {
  severity: Severity;
  code: string;
  path: string;
  message: string;
  suggestedAction?: string;
  phaseIndex?: number;
  label?: string;
  /** Quantas ocorrências foram agregadas nesta linha (limites técnicos). */
  count?: number;
  /** Sugestões em forma de botões: nada é pré-selecionado. */
  suggestions?: Suggestion[];
  /** SELECTION: produzido na seleção e mantido até a fase ser regenerada; as demais são recalculadas. */
  stage: "INPUT" | "SELECTION" | "VALIDATION";
}

export interface Assumption {
  code: string;
  text: string;
  basis: Basis;
  ruleId?: string;
}

export interface Flag {
  code: string;
  severity: Severity;
  source: "SCREENING" | "ASSESSMENT" | "ANAMNESIS" | "HISTORY";
  ref?: string;
  message: string;
  suggestedDecision?: FlagDecision;
  decided?: FlagDecision;
}

export interface VolumeRow {
  phaseIndex: number;
  week: number;
  muscle: string;
  directSets: number;
  indirectSets: number;
  weightedSets: number;
  occurrences: number;
}

export interface WorkoutSummary {
  phaseIndex: number;
  label: string;
  name: string | null;
  stimulus: Fact<string> | null;
  modalities: Fact<string[]> | null;
  count: Fact<number> | null;
  coverage: { muscles: string[]; patterns: string[]; basis: Basis; ruleId?: string } | null;
  eligible: number;
  excluded: Record<string, number>;
}

export interface PhaseSummary {
  phaseIndex: number;
  name: string | null;
  weeks: number;
  sessionsPerWeek: number;
  progression: Fact<WeeklyProgression> | null;
}

export interface ProgressionProposal {
  action: "INCREASE" | "MAINTAIN" | "REVIEW" | "INSUFFICIENT_DATA";
  suggestedLoadKg: number | null;
  explanation: string;
  basis: Basis;
  ruleId: string;
  exposuresUsed: number;
}

export interface HistorySuggestion {
  phaseIndex: number;
  slotKey: string;
  exerciseId: string;
  proposal: ProgressionProposal;
}

export interface RuleUse {
  ruleId: string;
  basis: Basis;
  label: string;
}

export interface EngineResult {
  engineVersion: string;
  rules: RuleSetRef;
  vocabularyVersion: string;
  status: "SUCCEEDED" | "INFEASIBLE";
  validation: "PASSED" | "WARNINGS" | "BLOCKED";
  requiresProfessionalReview: true;
  phases: PhaseSummary[];
  workouts: WorkoutSummary[];
  occurrences: OccurrenceOut[];
  issues: Issue[];
  assumptions: Assumption[];
  flags: Flag[];
  volume: VolumeRow[];
  historySuggestions: HistorySuggestion[];
  rulesUsed: RuleUse[];
}

/** Operações de revisão devolvem um resultado ou um motivo; nunca lançam exceção. */
export type EngineOutcome = { ok: true; result: EngineResult } | { ok: false; code: string; message: string };

export interface Alternative {
  exerciseId: string;
  name: string;
  modality: string | null;
  metadata: ItemMetadata;
  reasons: string[];
  score: number;
}

/** Item alvo de alternativas; com semana e sessão, exclui o que já está naquela sessão. */
export interface AlternativeTarget extends ItemTarget {
  week?: number;
  slot?: number;
}

export interface ProgressionSettings {
  consecutiveSuccesses: number;
  maximumIncrementFraction: number;
  /** Menor incremento do equipamento, informado pelo profissional. Ausente = não propor aumento. */
  incrementKg: number | null;
  /** Janela de histórico considerada, em dias antes de `today`. */
  windowDays: number;
}
