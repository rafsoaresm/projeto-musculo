import rulesJson from "./inference-rules.json";
import { canonicalJson, isMetadataField } from "./fields";
import { inferFromName, type InferenceRules } from "./inference-core";
import type { MetadataField } from "./vocabulary";

/** The library inference rules, frozen. A change of any rule needs a new `version` (stored on each inferred row). */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
export const INFERENCE_RULES: InferenceRules = deepFreeze(structuredClone(rulesJson) as InferenceRules);
export const INFERENCE_RULES_REF = `${INFERENCE_RULES.id}@${INFERENCE_RULES.version}`;

export interface InferredField {
  field: MetadataField;
  valueJson: string;
  ruleId: string;
}

/** What the rules infer for one exercise, as canonical JSON ready to store. */
export function inferExercise(name: string, category: string | null): InferredField[] {
  return inferFromName(INFERENCE_RULES, name, category).flatMap((item) =>
    isMetadataField(item.field)
      ? [{ field: item.field, valueJson: canonicalJson(item.field, item.value), ruleId: item.ruleId }]
      : [],
  );
}
