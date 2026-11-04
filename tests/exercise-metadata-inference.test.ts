import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FIELD_SCHEMAS,
  canonicalJson,
  formatFieldValue,
  parseFieldValue,
  readStoredValue,
  valueFromForm,
} from "@/modules/biblioteca/metadata/fields";
import { INFERENCE_RULES, inferExercise } from "@/modules/biblioteca/metadata/inference";
import {
  inferFromName,
  nameTokens,
  parseSystemSeed,
  renderSeedSql,
  type InferenceCondition,
} from "@/modules/biblioteca/metadata/inference-core";
import { precedence, summarize, type ResolvedField } from "@/modules/biblioteca/metadata/status";
import { METADATA_FIELDS, REQUIRED_FIELDS, type MetadataField } from "@/modules/biblioteca/metadata/vocabulary";
import { splitStatements } from "./helpers/migrate";

// Motor S4 (decision Q3 of 04/11/2026): the deterministic, documented name-based inference, the field values and the precedence
// rules, without a database. The D1 side (scope triggers, repository, isolation) is tests/exercise-metadata.test.ts.

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const SEED_STEM = "0045_exercise_metadata_inferred_seed";
const STAMP = "2026-11-04T00:00:00.000Z";
const byField = (name: string, category: string | null = null) =>
  Object.fromEntries(inferFromName(INFERENCE_RULES, name, category).map((item) => [item.field, item.value]));

describe("inference rules file", () => {
  it("is versioned, frozen and labelled as an editable heuristic", () => {
    expect(INFERENCE_RULES.id).toBe("gymgital-library-inference");
    expect(INFERENCE_RULES.version).toMatch(/^\d{4}\.\d{2}\.\d+$/);
    expect(INFERENCE_RULES.basis).toBe("Heurística operacional (editável)");
    expect(Object.isFrozen(INFERENCE_RULES.fields.equipment[0])).toBe(true);
  });

  it("only infers known fields, in an order where every `when` looks back, and never the fields only a person sets", () => {
    const order = INFERENCE_RULES.fieldOrder;
    expect(new Set(order).size).toBe(order.length);
    for (const field of order) expect(METADATA_FIELDS).toContain(field);
    // Difficulty, seconds per rep and caution markers are clinical or individual judgements: never inferred.
    for (const field of ["difficulty", "seconds_per_rep", "caution_tags"]) {
      expect(order).not.toContain(field);
      expect(INFERENCE_RULES.fields[field]).toBeUndefined();
    }
    for (const [field, rules] of Object.entries(INFERENCE_RULES.fields)) {
      expect(order).toContain(field);
      for (const rule of rules) {
        const conditions: InferenceCondition[] = rule.when ? (Array.isArray(rule.when) ? rule.when : [rule.when]) : [];
        for (const condition of conditions) expect(order.indexOf(condition.field)).toBeLessThan(order.indexOf(field));
      }
    }
  });

  it("has unique rule ids, a matcher on every rule, and only valid canonical values", () => {
    const ids = Object.values(INFERENCE_RULES.fields).flat().map((rule) => rule.id);
    ids.push(...Object.values(INFERENCE_RULES.categoryFallback).map((fallback) => fallback.ruleId));
    expect(new Set(ids).size).toBe(ids.length);
    for (const [field, rules] of Object.entries(INFERENCE_RULES.fields)) {
      for (const rule of rules) {
        expect(rule.all ?? rule.any ?? rule.when, rule.id).toBeDefined();
        expect(rule.id.length).toBeLessThanOrEqual(60);
        if (rule.value === null) continue;
        const valid = parseFieldValue(field as MetadataField, rule.value);
        expect(valid, `${rule.id} has an invalid value`).not.toBeNull();
        expect(JSON.stringify(rule.value), `${rule.id} is not canonical`).toBe(canonicalJson(field as MetadataField, rule.value));
      }
    }
    for (const [field, fallback] of Object.entries(INFERENCE_RULES.categoryFallback))
      for (const value of Object.values(fallback.values)) expect(parseFieldValue(field as MetadataField, value)).not.toBeNull();
  });
});

describe("name-based inference", () => {
  it("normalizes accents, case and punctuation, and matches keywords by word prefix", () => {
    expect(nameTokens("Leg press 45°")).toEqual(["leg", "press", "45"]);
    expect(nameTokens("Pull-through no CABO")).toEqual(["pull", "through", "no", "cabo"]);
    expect(byField("AGACHAMENTO GÓBLET")).toEqual(byField("agachamento goblet"));
    expect(byField("Supino com halteres").equipment).toEqual(["DUMBBELL", "BENCH"]);
    expect(byField("Supino com halter").equipment).toEqual(["DUMBBELL", "BENCH"]);
    // "flexão" is not a prefix of "flexora": a push-up is not a leg curl.
    expect(byField("Flexão de braços").movement_patterns).toEqual(["HORIZONTAL_PUSH"]);
    expect(byField("Cadeira flexora").movement_patterns).toEqual(["KNEE_FLEXION"]);
  });

  it("lets specific rules win over generic ones (rule order is the documented tie-break)", () => {
    expect(byField("Agachamento búlgaro")).toMatchObject({ movement_patterns: ["LUNGE"], equipment: ["BENCH"], laterality: "UNILATERAL" });
    expect(byField("Agachamento goblet")).toMatchObject({ movement_patterns: ["SQUAT"], equipment: ["DUMBBELL"], equipment_alternatives: [["KETTLEBELL"]] });
    expect(byField("Panturrilha no leg press")).toMatchObject({ movement_patterns: ["PLANTAR_FLEXION"], primary_muscles: ["CALVES"], equipment: ["MACHINE"] });
    expect(byField("Crucifixo inverso")).toMatchObject({ movement_patterns: ["HORIZONTAL_ABDUCTION"], primary_muscles: ["REAR_DELTOID"] });
    expect(byField("Crucifixo no cabo")).toMatchObject({ movement_patterns: ["HORIZONTAL_ADDUCTION"], equipment: ["CABLE"], compound: false });
    expect(byField("Barra fixa assistida")).toMatchObject({ equipment: ["MACHINE"], equipment_alternatives: [["PULL_UP_BAR", "RESISTANCE_BAND"]] });
    expect(byField("Prancha lateral")).toMatchObject({ movement_patterns: ["ANTI_LATERAL_FLEXION"], metric: "TIME", laterality: "UNILATERAL", equipment: [] });
    expect(byField("Remo ergométrico")).toMatchObject({ modality: "CARDIO", metric: "CONTINUOUS", equipment: ["ROWER"], primary_muscles: [] });
    expect(byField("Mergulho no banco")).toMatchObject({ compound: true, equipment: ["BENCH"] });
  });

  it("leaves a field for a person when the name does not say enough (no guess)", () => {
    // Elevação lateral: dumbbells, cable or machine? The name does not say.
    expect(byField("Elevação lateral").equipment).toBeUndefined();
    // Farmer walk: time or distance? Recognised, deliberately left empty.
    expect(byField("Farmer walk").metric).toBeUndefined();
    expect(byField("Dead bug").laterality).toBeUndefined();
  });

  it("uses the category only for the modality, and a category alone never yields more than that", () => {
    expect(byField("Exercício sem nome conhecido", "Core")).toEqual({ modality: "RESISTANCE" });
    expect(byField("Exercício sem nome conhecido", "Cardio")).toEqual({ modality: "CARDIO" });
    expect(byField("Exercício sem nome conhecido", null)).toEqual({});
    expect(inferFromName(INFERENCE_RULES, "Exercício sem nome conhecido", "Core")[0].ruleId).toBe("MOD_BY_CATEGORY");
    // A name the rules recognise does not need the category: same result with any category.
    expect(byField("Remada curvada com barra", "Cardio")).toEqual(byField("Remada curvada com barra", null));
  });

  it("is deterministic and returns canonical JSON ready to store", () => {
    const once = JSON.stringify(inferExercise("Remada unilateral com halter", "Puxar"));
    for (let index = 0; index < 5; index += 1)
      expect(JSON.stringify(inferExercise("Remada unilateral com halter", "Puxar"))).toBe(once);
    for (const item of inferExercise("Remada unilateral com halter", "Puxar"))
      expect(item.valueJson).toBe(canonicalJson(item.field, JSON.parse(item.valueJson)));
  });
});

describe("0045 seed (generated)", () => {
  const seed = parseSystemSeed(read("migrations/0005_exercise_library.sql"));

  it("reads the 64 system exercises of 0005", () => {
    expect(seed).toHaveLength(64);
    expect(seed[0]).toEqual({ id: "sys-001", name: "Agachamento goblet", category: "Agachar" });
    expect(seed.at(-1)).toEqual({ id: "sys-064", name: "Caminhada inclinada", category: "Cardio" });
  });

  it("is byte for byte what the generator renders (change the rules, then regenerate)", () => {
    expect(read(`migrations/${SEED_STEM}.sql`)).toBe(renderSeedSql(INFERENCE_RULES, seed, SEED_STEM, STAMP));
  });

  it("splits into one INSERT per exercise plus the version row, with rows marked INFERRED and no comment after a ';'", () => {
    const sql = read(`migrations/${SEED_STEM}.sql`);
    const statements = splitStatements(sql);
    const withValues = seed.filter((exercise) => inferFromName(INFERENCE_RULES, exercise.name, exercise.category).length > 0);
    expect(statements).toHaveLength(withValues.length + 1);
    expect(sql.split("\n").filter((line) => /^(CREATE|ALTER|INSERT|UPDATE|DROP) /.test(line))).toHaveLength(withValues.length + 1);
    expect(statements.at(-1)).toBe(`INSERT INTO app_schema_versions(version) VALUES ('${SEED_STEM}')`);
    for (const statement of statements.slice(0, -1)) {
      expect(statement).toMatch(/^INSERT INTO exercise_attributes /);
      expect(statement).toMatch(/ON CONFLICT\(exercise_id, scope_organization_id, field\) DO NOTHING$/);
    }
    expect(sql.split("\n").filter((line) => /;\s*--/.test(line))).toEqual([]);
    expect(sql).not.toMatch(/INSERT\s+OR\s+IGNORE/i);
    expect(sql).not.toMatch(/'REVIEWED'/);
  });

  it("leaves some system exercises honestly pending (fields the names do not give)", () => {
    const pending = seed.filter((exercise) => {
      const fields = byField(exercise.name, exercise.category);
      return REQUIRED_FIELDS.some((field) => !(field in fields));
    });
    expect(pending.map((exercise) => exercise.name)).toEqual(
      expect.arrayContaining(["Elevação lateral", "Farmer walk", "Abdução de quadril", "Hip thrust"]),
    );
    expect(pending.length).toBeLessThan(seed.length);
  });
});

describe("field values", () => {
  it("validates codes, keeps lists in vocabulary order without duplicates, and refuses unknown codes", () => {
    expect(parseFieldValue("primary_muscles", ["GLUTEUS", "QUADRICEPS", "GLUTEUS"])).toEqual(["QUADRICEPS", "GLUTEUS"]);
    expect(parseFieldValue("primary_muscles", ["MADE_UP_MUSCLE"])).toBeNull();
    expect(parseFieldValue("equipment", [])).toEqual([]);
    expect(parseFieldValue("equipment_alternatives", [["KETTLEBELL"], ["KETTLEBELL"], ["CABLE", "BARBELL"]])).toEqual([["KETTLEBELL"], ["BARBELL", "CABLE"]]);
    expect(parseFieldValue("equipment_alternatives", [[]])).toBeNull();
    expect(parseFieldValue("difficulty", 6)).toBeNull();
    expect(parseFieldValue("difficulty", 2.5)).toBeNull();
    expect(parseFieldValue("seconds_per_rep", 3.14)).toBe(3.1);
    expect(parseFieldValue("modality", "")).toBeNull();
    expect(parseFieldValue("compound", "true")).toBeNull();
    for (const field of METADATA_FIELDS) expect(FIELD_SCHEMAS[field]).toBeDefined();
  });

  it("reads stored JSON back, and an invalid stored value reads as absent (never as a guess)", () => {
    expect(readStoredValue("metric", '"TIME"')).toBe("TIME");
    expect(readStoredValue("metric", '"SOMETHING"')).toBeNull();
    expect(readStoredValue("metric", "{broken")).toBeNull();
    expect(readStoredValue("metric", null)).toBeNull();
  });

  it("reads each form shape, and an empty scalar is no value", () => {
    const form = (entries: Array<[string, string]>) => {
      const data = new FormData();
      for (const [key, value] of entries) data.append(key, value);
      return data;
    };
    expect(valueFromForm("equipment", form([["value", "CABLE"], ["value", "BARBELL"]]))).toEqual(["CABLE", "BARBELL"]);
    expect(valueFromForm("equipment", form([]))).toEqual([]);
    expect(valueFromForm("equipment_alternatives", form([["set0", "KETTLEBELL"], ["set2", "CABLE"]]))).toEqual([["KETTLEBELL"], ["CABLE"]]);
    expect(valueFromForm("difficulty", form([["value", "3"]]))).toBe(3);
    expect(valueFromForm("seconds_per_rep", form([["value", "2,5"]]))).toBe(2.5);
    expect(valueFromForm("compound", form([["value", "false"]]))).toBe(false);
    expect(valueFromForm("modality", form([["value", ""]]))).toBeUndefined();
    expect(parseFieldValue("modality", valueFromForm("modality", form([["value", ""]])))).toBeNull();
  });

  it("formats values in pt-BR, and an empty equipment list reads as no equipment", () => {
    expect(formatFieldValue("equipment", [])).toBe("Sem equipamento");
    expect(formatFieldValue("primary_muscles", ["QUADRICEPS", "GLUTEUS"])).toBe("Quadríceps, Glúteos");
    expect(formatFieldValue("equipment_alternatives", [["PULL_UP_BAR", "RESISTANCE_BAND"], ["MACHINE"]])).toBe("Barra fixa, Elástico ou Máquina");
    expect(formatFieldValue("compound", false)).toBe("Não");
    expect(formatFieldValue("seconds_per_rep", 2.5)).toBe("2,5 s");
    expect(formatFieldValue("modality", null)).toBe("—");
  });
});

describe("precedence and per-exercise summary", () => {
  const field = (provenance: ResolvedField["provenance"], scope: ResolvedField["scope"] = "SYSTEM", value: unknown = "X"): ResolvedField => ({
    value: provenance === "PENDING" ? null : (value as ResolvedField["value"]),
    provenance,
    scope,
    ruleId: null,
    rulesVersion: null,
    reviewedAt: null,
  });

  it("orders: org reviewed, org pending, system reviewed, org inferred, system pending, system inferred", () => {
    const order = [
      precedence("ORGANIZATION", "REVIEWED"),
      precedence("ORGANIZATION", "PENDING"),
      precedence("SYSTEM", "REVIEWED"),
      precedence("ORGANIZATION", "INFERRED"),
      precedence("SYSTEM", "PENDING"),
      precedence("SYSTEM", "INFERRED"),
    ];
    expect(order).toEqual([1, 2, 3, 4, 5, 6]);
    // A reviewed value always beats an inferred one, whatever the scope.
    expect(precedence("SYSTEM", "REVIEWED")).toBeLessThan(precedence("ORGANIZATION", "INFERRED"));
  });

  it("is PENDING when a field the engine needs is missing or pending, INFERRED when any field in use is inferred, else REVIEWED", () => {
    const complete = Object.fromEntries(REQUIRED_FIELDS.map((name) => [name, field("REVIEWED")]));
    expect(summarize(complete)).toBe("REVIEWED");
    expect(summarize({ ...complete, laterality: field("INFERRED") })).toBe("INFERRED");
    expect(summarize({ ...complete, modality: field("INFERRED") })).toBe("INFERRED");
    expect(summarize({ ...complete, equipment: field("PENDING") })).toBe("PENDING");
    const { equipment: _missing, ...withoutEquipment } = complete;
    void _missing;
    expect(summarize(withoutEquipment)).toBe("PENDING");
    // An optional field marked pending is just not used.
    expect(summarize({ ...complete, difficulty: field("PENDING") })).toBe("REVIEWED");
    expect(summarize({})).toBe("PENDING");
  });
});
