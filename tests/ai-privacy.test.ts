import { describe, expect, it } from "vitest";
import { canonicalJson } from "@/modules/prescricao/motor/hash";
import { plannerResponseSchema } from "@/modules/prescricao/planejador/blueprint";
import type { DenyList } from "@/modules/prescricao/planejador/context-types";
import {
  buildProviderPayload, fixedTokens, normalizeForScan, PrivacyBlockedError, scanPatterns, scanPayload, verifyIssued,
} from "@/modules/prescricao/planejador/privacy";
import { MODEL_TEST_SCHEMA, MODEL_TEST_SCHEMA_NAME, MODEL_TEST_SYSTEM_PROMPT, MODEL_TEST_USER, PLANNER_SCHEMA_NAME, PLANNER_SYSTEM_PROMPT, plannerUserMessage } from "@/modules/prescricao/planejador/prompt";
import { toWireSchema } from "@/modules/prescricao/planejador/provedores/wire-schema";
import { PROVIDER_KINDS, type ProviderKind } from "@/modules/prescricao/planejador/provedores/port";
import { canaryBundle, xintusBundle } from "./helpers/planning-fixtures";

// The single anonymising choke point (design V4 §3.3): a fictitious student whose every identifying value is searched in the payload.
const wire = (kind: ProviderKind) => toWireSchema(plannerResponseSchema, kind);
const bodyFor = (user: unknown, kind: ProviderKind = "openai") => ({
  kind, system: PLANNER_SYSTEM_PROMPT, user, schema: wire(kind), schemaName: PLANNER_SCHEMA_NAME, vocabularySchemas: [wire(kind)],
});
const EMPTY: DenyList = { values: [], tokens: [], prose: [] };

/** Every form a leak of the canary student could take. */
const LEAKS: Array<[string, string]> = [
  ["a name token", "Zélia"],
  ["a name token, upper case and unaccented", "ZELIA"],
  ["the full name", "Zélia Quintanilha Braga"],
  ["a surname token", "quintanilha"],
  ["the e-mail", "zelia.quintanilha@exemplo.test"],
  ["the e-mail local part", "zelia.quintanilha"],
  ["the phone as typed", "+55 11 98888-7766"],
  ["the phone with separators", "(11) 98888-7766"],
  ["the phone without the country code, digits only", "11988887766"],
  ["the phone with the country code, digits only", "5511988887766"],
  ["the document with dots", "123.456.789-09"],
  ["the document, digits only", "12345678909"],
  ["the birth date (ISO)", "1991-03-14"],
  ["the birth date (BR)", "14/03/1991"],
  ["the plan title", "Plano da Zélia — hipertrofia"],
  ["the student id", "stu-zelia-uuid-1"],
  ["the plan id", "plan-zelia-uuid-1"],
  ["the organization id", "org-canary-uuid-1"],
  ["a workout label", "Superior Zélia"],
  ["an own exercise name", "Remada da Zélia"],
  ["a UUID", "0b9d2c3e-1f4a-4b6c-8d7e-9f0a1b2c3d4e"],
  ["a URL", "https://exemplo.test/aluno"],
  ["a mention", "@zelia"],
];

describe("the canary student", () => {
  it("builds a payload for every provider dialect without blocking, and the payload carries none of the canary values", async () => {
    const bundle = await canaryBundle();
    for (const kind of PROVIDER_KINDS) {
      const request = await buildProviderPayload("PLANNER", bodyFor(plannerUserMessage(bundle.context), kind), bundle.denyList);
      const sent = `${request.system}\n${canonicalJson(request.schema)}\n${request.user}`;
      const text = normalizeForScan(sent);
      for (const needle of ["zelia", "quintanilha", "braga", "98888", "7766", "123 456 789", "12345678909", "1991", "acacias", "ombro", "exemplo test", "hipertrofia", "stu zelia", "plan zelia", "org canary"]) {
        expect(text, `${kind}: ${needle}`).not.toContain(needle);
      }
      expect(request.user).toContain('"ageBand":"30_39"');
      expect(request.payloadHash).toMatch(/^[0-9a-f]{64}$/);
      expect(request.estimatedInputTokens).toBeGreaterThan(0);
    }
  });

  it.each(LEAKS)("fails closed when %s is inside the user message", async (_what, leaked) => {
    const bundle = await canaryBundle();
    // the leak sits in a free-text-like spot the context builder would never produce
    const user = { ...plannerUserMessage(bundle.context), note: `observação ${leaked}` };
    await expect(buildProviderPayload("PLANNER", bodyFor(user), bundle.denyList)).rejects.toBeInstanceOf(PrivacyBlockedError);
  });

  it("the error and its hits never carry the matched value", async () => {
    const bundle = await canaryBundle();
    const user = { ...plannerUserMessage(bundle.context), note: "Zélia Quintanilha 11988887766 zelia.quintanilha@exemplo.test" };
    const error = await buildProviderPayload("PLANNER", bodyFor(user), bundle.denyList).then(
      () => null,
      (e: unknown) => e as PrivacyBlockedError,
    );
    expect(error).toBeInstanceOf(PrivacyBlockedError);
    expect(error!.hits.length).toBeGreaterThan(0);
    const dump = `${error!.message} ${JSON.stringify(error!.hits)} ${String(error)}`.toLowerCase();
    for (const needle of ["zelia", "zélia", "quintanilha", "98888", "11988887766", "exemplo"]) expect(dump).not.toContain(needle);
    expect(error!.hits.every((h) => h.kind === "DENY_VALUE" || h.kind === "PATTERN")).toBe(true);
  });

  it("no provider is called and nothing is built when the scan blocks (the brand is never issued)", async () => {
    const bundle = await canaryBundle();
    const user = { ...plannerUserMessage(bundle.context), note: "Zélia" };
    let built = false;
    await buildProviderPayload("PLANNER", bodyFor(user), bundle.denyList).then(() => (built = true), () => undefined);
    expect(built).toBe(false);
  });
});

describe("the deny-list against the closed vocabulary (no false positives)", () => {
  it("does not flag codes for a student called Ana, or aliases", () => {
    const deny: DenyList = { values: ["ana", "ana lima"], tokens: ["ana", "lima"], prose: [] };
    const user = canonicalJson({ muscles: ["HAMSTRINGS", "ANTI_EXTENSION", "ABS"], candidate: "X12", workout: "T3", finding: "F2", index: 3 });
    expect(scanPayload(user, deny)).toEqual([]);
  });

  it("a student called Core, Push or Quad is never blocked by the CODE of the same word", () => {
    for (const name of ["Core", "Push", "Pull", "Legs", "Upper", "Lower", "Cardio", "Tríceps", "Quad", "Hypertrophy", "Strength", "Hipertrofia"]) {
      const deny: DenyList = { values: [normalizeForScan(name)], tokens: [normalizeForScan(name)], prose: [] };
      const user = canonicalJson({ roles: ["CORE", "PUSH", "PULL", "LEGS", "UPPER", "LOWER", "CARDIO"], muscles: ["TRICEPS", "QUADRICEPS"], goal: ["HYPERTROPHY", "STRENGTH"] });
      expect(scanPayload(user, deny), name).toEqual([]);
    }
  });

  it("but a name outside the vocabulary is still caught as a whole word, and as a phrase", () => {
    const deny: DenyList = { values: ["ana lima", "zelia"], tokens: ["ana", "zelia"], prose: [] };
    expect(scanPayload(canonicalJson({ note: "falou com a Ana" }), deny).length).toBeGreaterThan(0);
    expect(scanPayload(canonicalJson({ note: "Ana Lima" }), deny).length).toBeGreaterThan(0);
    expect(scanPayload(canonicalJson({ note: "zélia" }), deny).length).toBeGreaterThan(0);
    // a word that merely CONTAINS the token is not the token
    expect(scanPayload(canonicalJson({ note: "banana ananas" }), { values: [], tokens: ["ana"], prose: [] })).toEqual([]);
  });

  it("goal and level typed by the professional (Hypertrophy, Hipertrofia, Strength, Superior, Push) never block a real context", async () => {
    const bundle = await xintusBundle();
    const deny: DenyList = {
      values: ["hypertrophy", "hipertrofia", "strength", "forca", "superior", "inferior", "push", "pull", "legs", "upper", "lower", "core", "cardio", "triceps", "intermediario"],
      tokens: ["hypertrophy", "hipertrofia", "strength", "push", "pull", "legs", "upper", "lower", "core", "cardio", "triceps"],
      prose: [],
    };
    await expect(buildProviderPayload("PLANNER", bodyFor(plannerUserMessage(bundle.context)), deny)).resolves.toBeDefined();
  });

  it("phones and documents are compared by digit sequence, with or without the country code and separators", () => {
    const deny: DenyList = { values: ["11988887766", "5511988887766", "12345678909"], tokens: [], prose: [] };
    for (const text of ["11988887766", "(11) 98888-7766", "+55 11 98888 7766", "11.98888.7766", "123.456.789-09", "123 456 789 09"]) {
      expect(scanPayload(canonicalJson({ note: text }), deny).length, text).toBeGreaterThan(0);
    }
    // small numbers of the context are not a phone
    expect(scanPayload(canonicalJson({ weeks: 4, minutes: 60, days: [1, 2, 4, 5], band: "30_39", eligible: 118 }), deny)).toEqual([]);
  });
});

describe("structural patterns (always on, on the exact bytes sent)", () => {
  it.each([
    ["e-mail", "a@b.co"], ["@", "x @user"], ["CPF", "123.456.789-09"], ["ISO date", "2026-11-05"], ["BR date", "05/11/2026"], ["URL", "http://x.y"], ["www", "www.x.y"],
    ["UUID", "0b9d2c3e-1f4a-4b6c-8d7e-9f0a1b2c3d4e"], ["long hex", "a".repeat(32)], ["phone-like", "11 98888-7766"], ["phone-like digits", "11988887766"],
  ])("catches %s", (_name, text) => {
    expect(scanPatterns(`before ${text} after`).length).toBeGreaterThan(0);
  });

  it("does not flag the legitimate payload alphabet", () => {
    expect(scanPatterns(canonicalJson({ ageBand: "30_39", weeks: 4, perWeek: { min: 1, max: 2 }, weekdays: [1, 2, 4, 5], promptVersion: "planner-2026.11.1", n: 118 }))).toEqual([]);
  });

  it("a structural hit blocks even with an empty deny-list (the system prompt and schema are part of the bytes)", async () => {
    await expect(buildProviderPayload("PLANNER", { ...bodyFor({ ok: true }), system: `${PLANNER_SYSTEM_PROMPT}\nsee https://x.test` }, EMPTY)).rejects.toBeInstanceOf(PrivacyBlockedError);
    await expect(buildProviderPayload("PLANNER", bodyFor({ contato: "a@b.co" }), EMPTY)).rejects.toBeInstanceOf(PrivacyBlockedError);
  });
});

describe("build-time constants", () => {
  it("the system prompt, the connectivity prompt and every wire schema pass the structural patterns and contain no canary value", async () => {
    const bundle = await canaryBundle();
    const constants = [
      PLANNER_SYSTEM_PROMPT, MODEL_TEST_SYSTEM_PROMPT, canonicalJson(MODEL_TEST_SCHEMA), canonicalJson(MODEL_TEST_USER),
      ...PROVIDER_KINDS.map((k) => canonicalJson(wire(k))),
    ];
    for (const text of constants) {
      expect(scanPatterns(text)).toEqual([]);
      const norm = normalizeForScan(text);
      for (const needle of ["zelia", "quintanilha", "braga", "98888", "exemplo test", "acacias"]) expect(norm).not.toContain(needle);
    }
    // the connectivity check carries no student data at all and builds with an empty deny-list
    const request = await buildProviderPayload("PLANNER", { kind: "openai", system: MODEL_TEST_SYSTEM_PROMPT, user: MODEL_TEST_USER, schema: { ...MODEL_TEST_SCHEMA }, schemaName: MODEL_TEST_SCHEMA_NAME }, EMPTY);
    expect(request.user).toBe('{"task":"CONNECTIVITY_CHECK"}');
    void bundle;
  });

  it("fixedTokens(schemas) is built once per distinct schema set (the planner passes the same schema on every call)", () => {
    const one = fixedTokens([wire("openai")]);
    expect(fixedTokens([wire("openai")])).toBe(one);
    expect(fixedTokens([wire("anthropic")])).not.toBe(fixedTokens());
  });

  it("fixedTokens() covers every word the real payloads are made of (a new code must be added on purpose)", async () => {
    const fixed = fixedTokens([wire("openai")]);
    const alias = /^[xtf]\d+$/;
    for (const bundle of [await xintusBundle(), await canaryBundle()]) {
      const user = canonicalJson(plannerUserMessage(bundle.context));
      const unknown = normalizeForScan(user).split(" ").filter((t) => t && !/^\d+$/.test(t) && !alias.test(t) && !fixed.has(t) && !fixedTokens().has(t));
      expect(unknown, "tokens of the payload outside the closed vocabulary").toEqual([]);
    }
  });
});

describe("only the choke point issues requests", () => {
  it("a copy, a hand-made object or a request for another dialect is not accepted by verifyIssued", async () => {
    const bundle = await xintusBundle();
    const request = await buildProviderPayload("PLANNER", bodyFor(plannerUserMessage(bundle.context), "anthropic"), bundle.denyList);
    expect(await verifyIssued(request, "anthropic")).toBe(true);
    expect(await verifyIssued(request, "openai")).toBe(false);
    expect(await verifyIssued({ ...request } as typeof request, "anthropic")).toBe(false);
    expect(await verifyIssued({ ...request, user: "{}" } as typeof request, "anthropic")).toBe(false);
    expect(Object.isFrozen(request)).toBe(true);
  });

  it("the user message is the canonical JSON of the coded context and nothing else is student-derived", async () => {
    const bundle = await xintusBundle();
    const request = await buildProviderPayload("PLANNER", bodyFor(plannerUserMessage(bundle.context)), bundle.denyList);
    expect(request.user).toBe(canonicalJson(plannerUserMessage(bundle.context)));
    expect(JSON.parse(request.user).context).toEqual(JSON.parse(JSON.stringify(bundle.context)));
  });
});
