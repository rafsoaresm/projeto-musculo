/**
 * Zod -> JSON Schema for each provider (design V4 §3.2 "Wire schema"). The provider-side schema is a HINT, never the authority: the
 * server always runs `plannerResponseSchema` + the binding validator. The tables below are written from the documented shapes
 * known on 05/11/2026 and are verified ONLY by unit tests against the real planner schema; they were NOT checked against the live APIs.
 *
 * Common pass (all kinds): drop `$schema`; `oneOf` -> `anyOf`; drop `minimum`/`maximum` equal to +/- the safe-integer bound; `const: v` -> `enum: [v]`.
 * Per-kind pass: one table (`STRIPPED`) and two small structural rules (OpenAI strict objects; Google nullable as a type list).
 */
import { z } from "zod";
import type { ProviderKind, WireSchema } from "./port";

const SAFE_INT = 9007199254740991;

/** Keywords removed per kind. */
export const STRIPPED: Readonly<Record<ProviderKind, readonly string[]>> = Object.freeze({
  openai: ["pattern", "minLength", "maxLength", "format", "minItems", "maxItems", "minimum", "maximum", "default"],
  anthropic: [],
  google: ["additionalProperties", "pattern", "minLength", "maxLength", "format", "default"],
  mock: [],
});

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

function common(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(common);
  if (!isObject(node)) return node;
  const out: Json = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "$schema") continue;
    if ((key === "minimum" || key === "maximum") && typeof value === "number" && Math.abs(value) >= SAFE_INT) continue;
    if (key === "const") {
      out.enum = [value];
      continue;
    }
    out[key === "oneOf" ? "anyOf" : key] = common(value);
  }
  return out;
}

function strip(node: unknown, keys: readonly string[]): unknown {
  if (Array.isArray(node)) return node.map((n) => strip(n, keys));
  if (!isObject(node)) return node;
  const out: Json = {};
  for (const [key, value] of Object.entries(node)) {
    // `properties` maps NAMES to schemas: a property that happens to be called "pattern" is not a keyword.
    if (key === "properties" && isObject(value)) {
      out[key] = Object.fromEntries(Object.entries(value).map(([name, schema]) => [name, strip(schema, keys)]));
      continue;
    }
    if (keys.includes(key)) continue;
    out[key] = strip(value, keys);
  }
  return out;
}

/** OpenAI strict mode: every object closed and ALL its properties required (our wire schemas have `.nullable()`, never `.optional()`). */
function openAiStrict(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(openAiStrict);
  if (!isObject(node)) return node;
  const out: Json = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] = key === "properties" && isObject(value) ? Object.fromEntries(Object.entries(value).map(([n, s]) => [n, openAiStrict(s)])) : openAiStrict(value);
  }
  if (isObject(out.properties)) {
    out.additionalProperties = false;
    out.required = Object.keys(out.properties);
  }
  return out;
}

/** Google: `anyOf [X, {type:"null"}]` -> `type: [X, "null"]` when X is a plain typed schema. */
function googleNullable(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(googleNullable);
  if (!isObject(node)) return node;
  const out: Json = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] = key === "properties" && isObject(value) ? Object.fromEntries(Object.entries(value).map(([n, s]) => [n, googleNullable(s)])) : googleNullable(value);
  }
  const any = out.anyOf;
  if (Array.isArray(any) && any.length === 2) {
    const nullIndex = any.findIndex((a) => isObject(a) && a.type === "null" && Object.keys(a).length === 1);
    const other = any[nullIndex === 0 ? 1 : 0];
    if (nullIndex >= 0 && isObject(other) && typeof other.type === "string") {
      const { anyOf: _drop, ...rest } = out;
      void _drop;
      return { ...rest, ...other, type: [other.type, "null"] };
    }
  }
  return out;
}

export function toWireSchema(schema: z.ZodType, kind: ProviderKind): WireSchema {
  const raw = z.toJSONSchema(schema, { target: "draft-7", unrepresentable: "any" });
  let out = common(raw);
  if (kind === "openai") out = openAiStrict(out);
  if (kind === "google") out = googleNullable(out);
  return strip(out, STRIPPED[kind]) as WireSchema;
}

/** Every JSON Schema keyword used in a schema (for the key-inventory tests). */
export function keywordInventory(schema: unknown): string[] {
  const keys = new Set<string>();
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!isObject(node)) return;
    for (const [k, v] of Object.entries(node)) {
      if (k === "properties" && isObject(v)) {
        Object.values(v).forEach(walk);
        continue;
      }
      keys.add(k);
      walk(v);
    }
  };
  walk(schema);
  return [...keys].sort();
}
