/**
 * Library metadata used by the automatic prescription (motor S4). Each field of an exercise is stored
 * on its own, with its provenance: REVIEWED (a person confirmed it), INFERRED (deterministic rule from
 * the name, never presented as validated) or PENDING (needs curation; never used for selection).
 *
 * Codes are the engine's vocabulary (`src/modules/prescricao/motor`): MAIÚSCULAS_COM_SUBLINHADO. The
 * engine accepts unknown codes; the library writes only the codes listed here so a typo never becomes
 * a "new muscle". Adding a code here is additive (no migration: values are validated in code).
 */
export const METADATA_FIELDS = [
  "modality",
  "metric",
  "primary_muscles",
  "secondary_muscles",
  "movement_patterns",
  "equipment",
  "equipment_alternatives",
  "difficulty",
  "laterality",
  "compound",
  "seconds_per_rep",
  "caution_tags",
] as const;
export type MetadataField = (typeof METADATA_FIELDS)[number];

/**
 * Without these the engine cannot place the exercise: an exercise missing one of them (or with one
 * marked pending) is "Pendente de curadoria" and is never picked automatically.
 */
export const REQUIRED_FIELDS: readonly MetadataField[] = [
  "modality",
  "metric",
  "primary_muscles",
  "movement_patterns",
  "equipment",
];

export type Provenance = "REVIEWED" | "INFERRED" | "PENDING";
/** Per exercise: the weakest provenance among the fields the engine needs (see `status.ts`). */
export type MetadataSummary = "REVIEWED" | "INFERRED" | "PENDING";

export const FIELD_LABELS: Record<MetadataField, string> = {
  modality: "Modalidade",
  metric: "Medida da dose",
  primary_muscles: "Músculos principais",
  secondary_muscles: "Músculos secundários",
  movement_patterns: "Padrões de movimento",
  equipment: "Equipamento",
  equipment_alternatives: "Equipamento alternativo",
  difficulty: "Dificuldade (1 a 5)",
  laterality: "Lateralidade",
  compound: "Multiarticular",
  seconds_per_rep: "Segundos por repetição",
  caution_tags: "Marcadores de cuidado",
};

export const MODALITIES: Record<string, string> = {
  RESISTANCE: "Treino resistido",
  CARDIO: "Cardiorrespiratório",
  MOBILITY: "Mobilidade",
  BALANCE: "Equilíbrio",
  SKILL: "Habilidade",
};

export const METRICS: Record<string, string> = {
  REPS: "Repetições",
  TIME: "Tempo",
  DISTANCE: "Distância",
  INTERVALS: "Intervalado",
  CONTINUOUS: "Contínuo",
};

export const MUSCLES: Record<string, string> = {
  QUADRICEPS: "Quadríceps",
  HAMSTRINGS: "Posteriores da coxa",
  GLUTEUS: "Glúteos",
  ADDUCTORS: "Adutores",
  ABDUCTORS: "Abdutores do quadril",
  CALVES: "Panturrilhas",
  CHEST: "Peitoral",
  LATS: "Grande dorsal",
  UPPER_BACK: "Dorsal alta (romboides e trapézio médio)",
  TRAPEZIUS: "Trapézio",
  FRONT_DELTOID: "Deltoide anterior",
  SIDE_DELTOID: "Deltoide lateral",
  REAR_DELTOID: "Deltoide posterior",
  BICEPS: "Bíceps",
  TRICEPS: "Tríceps",
  FOREARMS: "Antebraços",
  ABS: "Abdominais",
  OBLIQUES: "Oblíquos",
  ERECTORS: "Eretores da espinha",
};

export const PATTERNS: Record<string, string> = {
  SQUAT: "Agachar",
  HINGE: "Dobradiça de quadril",
  LUNGE: "Afundo / unilateral de pernas",
  HORIZONTAL_PUSH: "Empurrar horizontal",
  HORIZONTAL_PULL: "Puxar horizontal",
  VERTICAL_PUSH: "Empurrar vertical",
  VERTICAL_PULL: "Puxar vertical",
  KNEE_EXTENSION: "Extensão de joelho",
  KNEE_FLEXION: "Flexão de joelho",
  HIP_EXTENSION: "Extensão de quadril",
  HIP_ABDUCTION: "Abdução de quadril",
  PLANTAR_FLEXION: "Flexão plantar",
  ELBOW_FLEXION: "Flexão de cotovelo",
  ELBOW_EXTENSION: "Extensão de cotovelo",
  SHOULDER_ABDUCTION: "Abdução de ombro",
  SHOULDER_FLEXION: "Flexão de ombro",
  SHOULDER_EXTENSION: "Extensão de ombro",
  HORIZONTAL_ADDUCTION: "Adução horizontal de ombro",
  HORIZONTAL_ABDUCTION: "Abdução horizontal de ombro",
  ANTI_EXTENSION: "Antiextensão",
  ANTI_ROTATION: "Antirrotação",
  ANTI_LATERAL_FLEXION: "Antiflexão lateral",
  TRUNK_FLEXION: "Flexão de tronco",
  ROTATION: "Rotação de tronco",
  CARRY: "Carregar",
  CYCLICAL: "Cíclico",
  MOBILITY: "Mobilidade",
  BALANCE: "Equilíbrio",
};

export const EQUIPMENT: Record<string, string> = {
  BARBELL: "Barra",
  DUMBBELL: "Halteres",
  KETTLEBELL: "Kettlebell",
  CABLE: "Polia / cabo",
  MACHINE: "Máquina",
  BENCH: "Banco",
  PREACHER_BENCH: "Banco Scott",
  RACK: "Rack / suporte",
  PULL_UP_BAR: "Barra fixa",
  RESISTANCE_BAND: "Elástico",
  STEP_BOX: "Caixa / step",
  ROWER: "Remo ergométrico",
  STAIR_CLIMBER: "Escada ergométrica",
  BIKE: "Bicicleta ergométrica",
  TREADMILL: "Esteira",
  SLED: "Trenó",
};

export const LATERALITY: Record<string, string> = {
  BILATERAL: "Bilateral",
  UNILATERAL: "Unilateral (um lado por vez)",
};

/**
 * Markers the professional can exclude when generating (engine `cautionTags`). They describe the
 * exercise, not the student, and are never inferred: only a person sets them.
 */
export const CAUTION_TAGS: Record<string, string> = {
  AXIAL_LOAD: "Carga axial na coluna",
  OVERHEAD: "Braços acima da cabeça",
  IMPACT: "Impacto",
  DEEP_KNEE_FLEXION: "Flexão profunda de joelho",
  SPINAL_FLEXION: "Flexão de coluna com carga",
  FLOOR_TRANSITION: "Deitar e levantar do chão",
  HIGH_BALANCE_DEMAND: "Exige equilíbrio",
  GRIP_DEMAND: "Exige pegada",
};

export const PROVENANCE_LABELS: Record<Provenance, string> = {
  REVIEWED: "Revisado",
  INFERRED: "Inferido (não revisado)",
  PENDING: "Pendente de curadoria",
};

export const SUMMARY_LABELS: Record<MetadataSummary, string> = {
  REVIEWED: "Metadados revisados",
  INFERRED: "Inferido (não revisado)",
  PENDING: "Pendente de curadoria",
};

export const RELATION_KINDS = ["ALTERNATIVE"] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];
/**
 * Technical cap on curated alternatives per exercise and scope (checked in the insert itself, so it
 * also bounds the rows one `resolve()` chunk can return: 200 exercises × 12 × 2 scopes). It is not a
 * training rule and was not measured: the engine also finds substitutes by muscle and pattern, so a
 * curated list longer than this adds little. Raising it needs no migration (docs/MOTOR-PRESCRICAO.md).
 */
export const MAX_ALTERNATIVES = 12;
/**
 * Technical cap on alternative equipment sets ("halteres" or "kettlebell" or "elástico e barra fixa"),
 * set by the editor, which shows one group of checkboxes per set, and by the stored value's
 * 2000-character CHECK in 0044 (16 codes × 3 sets fits with room). Not measured; raising it is a code
 * change only (the value is validated in code).
 */
export const MAX_EQUIPMENT_ALTERNATIVES = 3;

export function labelFor(map: Record<string, string>, code: string): string {
  return map[code] ?? code;
}
