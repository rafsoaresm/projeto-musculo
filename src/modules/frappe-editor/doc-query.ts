/**
 * What the editor asks of a list of documents, answered on plain objects: which fields to give back, which documents to keep (the
 * `filters` and `or_filters` of Frappe), in what order and from where. It runs on the documents of one organization and one type, a few
 * hundred at most, so nothing here is turned into SQL: a filter the editor sends can never reach a statement.
 */
export type Doc = Record<string, unknown> & { doctype: string; name: string };

type Operator = "=" | "!=" | ">" | "<" | ">=" | "<=" | "like" | "not like" | "in" | "not in" | "is" | "between";
const OPERATORS = new Set<string>(["=", "!=", ">", "<", ">=", "<=", "like", "not like", "in", "not in", "is", "between"]);

export interface Condition {
  field: string;
  operator: Operator;
  value: unknown;
}

const asText = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const isSet = (value: unknown) => value !== null && value !== undefined && value !== "";

function toCondition(field: unknown, operator: unknown, value: unknown): Condition | null {
  if (typeof field !== "string" || !field) return null;
  const op = typeof operator === "string" ? operator.toLowerCase() : "=";
  return OPERATORS.has(op) ? { field, operator: op as Operator, value } : null;
}

/**
 * The two shapes Frappe takes: an object (`{published: 1, route: ["like", "a%"]}`) and a list of rows (`[["name", "=", "x"]]` or
 * `[["Builder Page", "name", "=", "x"]]`). An empty or missing filter keeps everything. A condition that is not understood throws, so a
 * request is never answered as if it had not asked.
 */
export function parseFilters(raw: unknown): Condition[] {
  if (raw === null || raw === undefined || raw === "") return [];
  const value = typeof raw === "string" ? safeJson(raw) : raw;
  const out: Condition[] = [];
  if (Array.isArray(value)) {
    for (const row of value) {
      if (!Array.isArray(row)) throw new Error("BAD_FILTER");
      const cells = row.length === 4 ? row.slice(1) : row;
      const condition = cells.length === 2 ? toCondition(cells[0], "=", cells[1]) : cells.length === 3 ? toCondition(cells[0], cells[1], cells[2]) : null;
      if (!condition) throw new Error("BAD_FILTER");
      out.push(condition);
    }
    return out;
  }
  if (value && typeof value === "object") {
    for (const [field, entry] of Object.entries(value as Record<string, unknown>)) {
      const condition = Array.isArray(entry) && entry.length === 2 ? toCondition(field, entry[0], entry[1]) : toCondition(field, "=", entry);
      if (!condition) throw new Error("BAD_FILTER");
      out.push(condition);
    }
    return out;
  }
  throw new Error("BAD_FILTER");
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("BAD_FILTER");
  }
}

/** A field as Frappe may write it: `name`, `tabBuilder Page`.`name` or `tabBuilder Page`.name; the table is dropped. */
const fieldOf = (text: string) => text.trim().replace(/`[^`]*`\./g, "").replace(/`/g, "").trim();

/** `a%b` as Frappe's `like` reads it: `%` is any run of characters, `_` is one, the match ignores case. */
function likePattern(pattern: string): RegExp {
  const source = [...pattern].map((char) => (char === "%" ? ".*" : char === "_" ? "." : char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("");
  return new RegExp(`^${source}$`, "is");
}

export function matches(doc: Doc, condition: Condition): boolean {
  const actual = doc[condition.field];
  const { operator, value } = condition;
  switch (operator) {
    case "=":
      return asText(actual) === asText(value);
    case "!=":
      return asText(actual) !== asText(value);
    case ">":
      return Number(actual) > Number(value) || (Number.isNaN(Number(actual)) && asText(actual) > asText(value));
    case "<":
      return Number(actual) < Number(value) || (Number.isNaN(Number(actual)) && asText(actual) < asText(value));
    case ">=":
      return Number(actual) >= Number(value) || (Number.isNaN(Number(actual)) && asText(actual) >= asText(value));
    case "<=":
      return Number(actual) <= Number(value) || (Number.isNaN(Number(actual)) && asText(actual) <= asText(value));
    case "like":
      return likePattern(asText(value)).test(asText(actual));
    case "not like":
      return !likePattern(asText(value)).test(asText(actual));
    case "in":
      return Array.isArray(value) && value.some((entry) => asText(entry) === asText(actual));
    case "not in":
      return !Array.isArray(value) || !value.some((entry) => asText(entry) === asText(actual));
    case "is":
      return asText(value).toLowerCase() === "set" ? isSet(actual) : !isSet(actual);
    case "between":
      return Array.isArray(value) && value.length === 2 && asText(actual) >= asText(value[0]) && asText(actual) <= asText(value[1]);
  }
}

/** Every `filters` condition must hold, and at least one of `or_filters` (when there are any). */
export function select(docs: readonly Doc[], filters: unknown, orFilters: unknown): Doc[] {
  const all = parseFilters(filters);
  const any = parseFilters(orFilters);
  return docs.filter((doc) => all.every((condition) => matches(doc, condition)) && (any.length === 0 || any.some((condition) => matches(doc, condition))));
}

/** `"modified desc"`, `"modified desc, name asc"` or `"`tabBuilder Page`.modified desc"`; unknown text keeps the order as it is. */
export function order(docs: readonly Doc[], orderBy: unknown): Doc[] {
  const keys = asText(orderBy)
    .split(",")
    .map((part) => fieldOf(part))
    .filter(Boolean)
    .map((part) => {
      const [field, direction] = part.split(/\s+/);
      return { field, descending: (direction ?? "").toLowerCase() === "desc" };
    });
  if (keys.length === 0) return [...docs];
  return [...docs].sort((a, b) => {
    for (const { field, descending } of keys) {
      // Numbers go by value (a `sort_order` of 14 comes after 2), anything else by its text.
      const numbers = typeof a[field] === "number" && typeof b[field] === "number";
      const left = numbers ? (a[field] as number) : asText(a[field]);
      const right = numbers ? (b[field] as number) : asText(b[field]);
      if (left === right) continue;
      const result = left < right ? -1 : 1;
      return descending ? -result : result;
    }
    return 0;
  });
}

/** `fields` as a list or as a JSON text; `*` or nothing gives the whole document. */
export function project(doc: Doc, fields: unknown): Record<string, unknown> {
  const list = typeof fields === "string" ? (fields.startsWith("[") ? (safeJson(fields) as unknown[]) : [fields]) : fields;
  if (!Array.isArray(list) || list.length === 0 || list.includes("*")) return { ...doc };
  const out: Record<string, unknown> = {};
  for (const field of list) {
    if (typeof field !== "string") continue;
    const plain = fieldOf(field);
    out[plain] = doc[plain];
  }
  return out;
}

export function page<T>(rows: readonly T[], start: unknown, length: unknown): T[] {
  const from = Math.max(0, Number(start) || 0);
  const size = Number(length);
  return rows.slice(from, Number.isFinite(size) && size > 0 ? from + size : undefined);
}
