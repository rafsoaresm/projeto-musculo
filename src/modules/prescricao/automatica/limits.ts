/**
 * Technical limits of one generation request (motor S6). None is a training rule; each exists because a server action runs on a
 * Worker with a CPU budget per request. Changing one is code only (no migration).
 *
 * WORK_UNITS_PER_REQUEST: work units are sessions × exercises in the library (`workUnits` of the engine). A FULL generation
 * runs the phases that fit in this budget (always at least one) and the professional continues with "Continuar a geração"
 * for the rest; a regeneration of a phase, or from a phase on, that does not fit is refused with a message to regenerate one
 * phase at a time. The value comes from the local workerd measurement recorded in docs/VALIDACAO.md (S6: "workerd local, não
 * produção"); production CPU limits of Webflow Cloud were not measured.
 */
export const WORK_UNITS_PER_REQUEST = 40_000;
