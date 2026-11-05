/**
 * Motor de prescrição v2 (puro): sem banco, rede, IA, relógio ou acaso. Recebe fatos já
 * autorizados pelo adaptador e devolve uma proposta para revisão profissional. Nenhuma função
 * daqui aprova ou entrega um plano.
 */
export * from "./types";
export { ENGINE_VERSION, generate, revalidate, workUnits } from "./generate";
export { regenerate, substitute, rebase, alternativesFor } from "./regenerate";
export { validateDose, toDisplayFields, describeStructuredDose, EMPTY_DOSE_TEXT } from "./dose";
export { proposeProgression } from "./progression";
export { canonicalInput, canonicalRequest, canonicalJson, sha256Hex } from "./hash";
export { scheduleOccurrences, dateAdd, validDate } from "./calendar";
export { slotKeyOf, parseSlotKey } from "./select";
export { TECHNICAL_LIMITS } from "./bounds";
export { RULESETS, REFERENCES, DEFAULT_RULESET, getRuleSet, validateRuleSet, renderRulesTable, BASIS_TEXT, type RuleSet } from "./rules";
export { auditPlan, boundAudit, AUDIT_VERSION, type AuditInput } from "./audit";
export { targetSuggestion, type TargetSuggestion, type TargetSuggestionOutcome } from "./targets";
export { VOCABULARY_VERSION, AUDIT_LABELS, ISSUE_LABELS, STIMULUS_LABELS, MODALITY_LABELS, PATTERN_LABELS } from "./vocabulary";
