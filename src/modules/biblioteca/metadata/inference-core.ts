/**
 * Deterministic metadata inference from an exercise's name (motor S4, decision Q3 of 04/11/2026).
 *
 * This file has NO imports on purpose: `scripts/enrich-system-library.mjs` runs it with plain Node
 * (type stripping) to generate migration 0045, and the app runs the very same code for "Inferir
 * metadados das minhas fichas". Only erasable TypeScript syntax is allowed here.
 *
 * How it works (documented in docs/MOTOR-PRESCRICAO.md, "Metadados da biblioteca"):
 * - The name is normalized (lower case, no accents, anything that is not a letter or digit becomes a
 *   space) and split into words.
 * - A keyword matches when its words appear in a row in the name, each name word STARTING with the
 *   keyword word ("halter" matches "halteres").
 * - Fields are inferred in `fieldOrder`. For each field the rules are tried in file order and the
 *   first rule that matches decides; a rule whose value is null decides "do not infer" (a person
 *   must fill it in). A rule may also look at fields inferred earlier (`when`, all conditions).
 * - Only the modality has a fallback by category (`categoryFallback`), used when no rule matched.
 *   Rules that derive other fields from the modality also require a movement pattern recognised in
 *   the name, so a category alone never produces more than the modality. A rule may also require a
 *   category (`categoryAny`), only to hold a field back for a person when the category and the name
 *   disagree (value null), never to produce a value from the category alone.
 * - `noneWord` compares whole words (prepositions such as "com" or "no", which as prefixes would
 *   match "completo" or "nordico").
 * - Nothing is random, nothing depends on the clock or the locale. Same name, same rules version:
 *   same output, byte for byte.
 *
 * Everything inferred is stored as INFERRED ("Inferido (não revisado)") with the rule id and the
 * rules version. It is a heuristic, never presented as validated biomechanics.
 */

/** A condition on a field inferred earlier in this run: it has one of `anyOf`, or (with `present`) any value. */
export interface InferenceCondition {
  field: string;
  anyOf?: string[];
  present?: boolean;
}

export interface InferenceRule {
  id: string;
  /** Every keyword must match. */
  all?: string[];
  /** At least one keyword must match. */
  any?: string[];
  /** No keyword may match. */
  none?: string[];
  /** No word of the name may be exactly one of these (prepositions such as "com", "no"). */
  noneWord?: string[];
  /** The exercise's library category must be one of these. */
  categoryAny?: string[];
  /** Conditions on fields inferred earlier in this run; all must hold. */
  when?: InferenceCondition | InferenceCondition[];
  /** null: matched, and the field is deliberately left for a person. */
  value: unknown;
}

export interface InferenceRules {
  id: string;
  version: string;
  basis: string;
  comment: string;
  fieldOrder: string[];
  fields: Record<string, InferenceRule[]>;
  categoryFallback: Record<string, { ruleId: string; values: Record<string, unknown> }>;
}

export interface InferredValue {
  field: string;
  value: unknown;
  ruleId: string;
}

export interface SeedExercise {
  id: string;
  name: string;
  category: string;
}

export function nameTokens(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word.length > 0);
}

function keywordMatches(words: string[], keyword: string): boolean {
  const parts = nameTokens(keyword);
  if (parts.length === 0) return false;
  for (let start = 0; start + parts.length <= words.length; start += 1) {
    let ok = true;
    for (let index = 0; index < parts.length; index += 1) {
      if (!words[start + index].startsWith(parts[index])) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

function conditionHolds(condition: InferenceCondition, inferred: Map<string, unknown>): boolean {
  const current = inferred.get(condition.field);
  if (current === undefined || current === null) return false;
  if (condition.present) return true;
  const values = Array.isArray(current) ? current : [current];
  return values.some((value) => (condition.anyOf ?? []).includes(String(value)));
}

function whenMatches(rule: InferenceRule, inferred: Map<string, unknown>): boolean {
  if (!rule.when) return true;
  const conditions = Array.isArray(rule.when) ? rule.when : [rule.when];
  return conditions.length > 0 && conditions.every((condition) => conditionHolds(condition, inferred));
}

export function ruleMatches(
  rule: InferenceRule,
  words: string[],
  inferred: Map<string, unknown>,
  category: string | null = null,
): boolean {
  if (!rule.all && !rule.any && !rule.when) return false;
  if (rule.all && !rule.all.every((keyword) => keywordMatches(words, keyword))) return false;
  if (rule.any && !rule.any.some((keyword) => keywordMatches(words, keyword))) return false;
  if (rule.none && rule.none.some((keyword) => keywordMatches(words, keyword))) return false;
  if (rule.noneWord && rule.noneWord.some((word) => words.includes(word))) return false;
  if (rule.categoryAny && (category === null || !rule.categoryAny.includes(category))) return false;
  return whenMatches(rule, inferred);
}

/** The inferred fields of one exercise, in `fieldOrder`. Fields left for a person are absent. */
export function inferFromName(rules: InferenceRules, name: string, category: string | null): InferredValue[] {
  const words = nameTokens(name);
  const inferred = new Map<string, unknown>();
  const out: InferredValue[] = [];
  for (const field of rules.fieldOrder) {
    let decided = false;
    for (const rule of rules.fields[field] ?? []) {
      if (!ruleMatches(rule, words, inferred, category)) continue;
      decided = true;
      if (rule.value !== null) {
        inferred.set(field, rule.value);
        out.push({ field, value: rule.value, ruleId: rule.id });
      }
      break;
    }
    const fallback = rules.categoryFallback[field];
    if (!decided && fallback && category !== null && Object.hasOwn(fallback.values, category)) {
      const value = fallback.values[category];
      inferred.set(field, value);
      out.push({ field, value, ruleId: fallback.ruleId });
    }
  }
  return out;
}

const sqlText = (value: string) => `'${value.replace(/'/g, "''")}'`;

/**
 * The system rows of migration 0005, read from its seed. Each seed line is
 * `('sys-NNN', NULL, 'Name', 'name key', 'Category', ...`.
 */
export function parseSystemSeed(sql: string): SeedExercise[] {
  const out: SeedExercise[] = [];
  const pattern = /\('(sys-\d{3})', NULL, '((?:[^']|'')*)', '(?:[^']|'')*', '((?:[^']|'')*)'/g;
  for (const match of sql.matchAll(pattern)) {
    out.push({ id: match[1], name: match[2].replace(/''/g, "'"), category: match[3].replace(/''/g, "'") });
  }
  return out;
}

/**
 * Migration 0045: one INSERT per system exercise, rows with `scope_organization_id = ''` (system
 * scope), status INFERRED, the rule id and the rules version. `ON CONFLICT DO NOTHING`: a value a
 * person already set is never touched. No line inside a statement ends with ";" (migration splitter).
 */
export function renderSeedSql(rules: InferenceRules, exercises: SeedExercise[], stem: string, stamp: string): string {
  const lines = [
    `-- Additive migration: inferred metadata for the 64 system exercises (motor S4, decision Q3 of 04/11/2026). 0001..0044 stay untouched.`,
    `-- GENERATED by scripts/enrich-system-library.mjs from src/modules/biblioteca/metadata/inference-rules.json`,
    `-- (${rules.id}@${rules.version}). Do not edit by hand: change the rules and regenerate; a test compares this file with the generator.`,
    `--`,
    `-- Every row is INFERRED ("Inferido (não revisado)"): a name-based heuristic, never validated biomechanics. Fields the rules leave`,
    `-- for a person are absent, so that exercise reads as "Pendente de curadoria". ON CONFLICT DO NOTHING keeps any value already set.`,
    ``,
  ];
  const columns =
    "id, exercise_id, scope_organization_id, field, value_json, status, source, rule_id, rules_version, version, last_write_id, created_at, updated_at";
  for (const exercise of exercises) {
    const values = inferFromName(rules, exercise.name, exercise.category);
    if (values.length === 0) continue;
    lines.push(`INSERT INTO exercise_attributes (${columns}) VALUES`);
    values.forEach((item, index) => {
      const row = [
        sqlText(`${exercise.id}:${item.field}`),
        sqlText(exercise.id),
        "''",
        sqlText(item.field),
        sqlText(JSON.stringify(item.value)),
        "'INFERRED'",
        "'INFERENCE'",
        sqlText(item.ruleId),
        sqlText(rules.version),
        "1",
        sqlText(stem),
        sqlText(stamp),
        sqlText(stamp),
      ].join(", ");
      lines.push(`  (${row})${index === values.length - 1 ? "" : ","}`);
    });
    lines.push(`ON CONFLICT(exercise_id, scope_organization_id, field) DO NOTHING;`);
  }
  lines.push(
    ``,
    `-- The trail starts here too: one INFERRED event per seeded row, with no actor (the migration, not a person).`,
    `INSERT INTO exercise_attribute_events (id, scope_organization_id, exercise_id, field, action, status, value_json,`,
    `  rule_id, rules_version, actor_user_id, write_id, created_at)`,
    `SELECT 'seed:' || a.id, a.scope_organization_id, a.exercise_id, a.field, 'INFERRED', a.status, a.value_json,`,
    `  a.rule_id, a.rules_version, NULL, a.last_write_id, a.created_at`,
    `FROM exercise_attributes a`,
    `WHERE a.scope_organization_id = '' AND a.last_write_id = ${sqlText(stem)} AND a.source = 'INFERENCE'`,
    `ON CONFLICT(id) DO NOTHING;`,
    ``,
    `INSERT INTO app_schema_versions(version) VALUES (${sqlText(stem)});`,
    ``,
  );
  return lines.join("\n");
}
