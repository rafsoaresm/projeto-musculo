/** The steps of the guided assessment by their key, in order (the address keeps the step: ?etapa=). Pure, read by the page and the shell. */
export const STEP_KEYS = ["triagem", "medidas", "movimento", "testes", "revisao"] as const;
export type StepKey = (typeof STEP_KEYS)[number];
export const isStepKey = (value: unknown): value is StepKey => typeof value === "string" && (STEP_KEYS as readonly string[]).includes(value);
/** The title of each step on its screen, shared by the guided flow and the editor of a model so both name the steps the same way. */
export const STEP_TITLE: Record<StepKey, string> = {
  triagem: "Triagem e segurança",
  medidas: "Composição corporal",
  movimento: "Postura e movimento",
  testes: "Testes físicos",
  revisao: "Revisão e conclusão",
};
