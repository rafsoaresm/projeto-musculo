/** The steps of the guided assessment by their key, in order (the address keeps the step: ?etapa=). Pure, read by the page and the shell. */
export const STEP_KEYS = ["triagem", "medidas", "movimento", "revisao"] as const;
export type StepKey = (typeof STEP_KEYS)[number];
export const isStepKey = (value: unknown): value is StepKey => typeof value === "string" && (STEP_KEYS as readonly string[]).includes(value);
