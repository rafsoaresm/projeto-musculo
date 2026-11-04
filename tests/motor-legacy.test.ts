/**
 * Reprodução das versões publicadas: uma proposta gerada com 2026.11.1 ou 2026.11.2 regenera byte a byte (exceto
 * `engineVersion`). Os hashes abaixo foram calculados no código anterior à auditoria (motor 2.0.1, 04/11/2026).
 * NUNCA troque um hash desta lista: se ele mudou, o motor mudou o comportamento de uma versão publicada.
 */
import { describe, expect, it } from "vitest";
import {
  alternativesFor, canonicalJson, generate, rebase, regenerate, sha256Hex, substitute, toDisplayFields,
  type EngineInput, type EngineOutcome, type EngineResult, type RuleSetRef,
} from "@/modules/prescricao/motor";
import { baseInput, parameters, structure } from "./helpers/motor-fixtures";
import { xintusInput, xintusPreviousResult } from "./helpers/xintus";

const ok = (o: EngineOutcome): EngineResult => {
  if (!o.ok) throw new Error(`${o.code}: ${o.message}`);
  return o.result;
};
const anyVersion = (r: EngineResult) => canonicalJson({ ...r, engineVersion: "<any>" });

function cases(rules: RuleSetRef): Array<[string, () => unknown]> {
  const at = (over: Partial<EngineInput> = {}) => baseInput({ rules, ...over });
  const base = at();
  const before = generate(base);
  const changed: EngineInput = { ...base, parameters: parameters({ doseOverrides: [{ patch: { values: { restSeconds: 150 } } }] }) };
  const first = before.occurrences[0];
  const row = {
    prescribedExerciseId: "pe-new", phaseIndex: 1, label: "B", exerciseId: "ex-curl", name: "Rosca direta", position: 9,
    dose: null, display: { ...toDisplayFields(null), sets: "3", reps: "12", doseText: "3 × 12" }, origin: "PROFESSIONAL",
  };
  const many = Array.from({ length: 200 }, (_, i) => ({ ...base.catalog[i % base.catalog.length], id: `gen-${String(i).padStart(3, "0")}` }));
  return [
    ["variety:base", () => anyVersion(generate(base))],
    ["variety:linear", () => anyVersion(generate(at({ parameters: parameters({ progressionByPhase: [{ phaseIndex: 1, progression: { model: "LINEAR", ramps: [{ param: "sets", from: 2, to: 4 }], deload: { weeks: [4], setsMultiplier: 0.5 } } }] }) })))],
    ["variety:cardio-mobility", () => anyVersion(generate(at({
      structure: structure("2026-11-09", [{ weeks: 2, sessionsPerWeek: 3, workouts: [
        { label: "Z2", exerciseTarget: 1, focus: { stimulus: { value: "AEROBIC_ENDURANCE", source: "STRUCTURE", basis: "PROFESSIONAL" } } },
        { label: "HIIT", exerciseTarget: 1, focus: { stimulus: { value: "INTERVALS", source: "STRUCTURE", basis: "PROFESSIONAL" } } },
        { label: "Mob", exerciseTarget: 2, focus: { stimulus: { value: "MOBILITY", source: "STRUCTURE", basis: "PROFESSIONAL" } } },
      ] }]),
    })))],
    ["xintus", () => anyVersion(generate(xintusInput(rules)))],
    ["xintus:previous", () => anyVersion(xintusPreviousResult(rules))],
    ["big-abc", () => anyVersion(generate(at({
      catalog: many,
      structure: structure("2026-11-09", Array.from({ length: 12 }, () => ({ weeks: 4, sessionsPerWeek: 6, stimulus: "HYPERTROPHY", workouts: ["A", "B", "C"].map((label) => ({ label, exerciseTarget: 8 })) }))),
    })))],
    ["regenerate:item", () => anyVersion(ok(regenerate(base, before, { kind: "ITEM", phaseIndex: 1, week: 1, slot: 1, slotKey: first.items[0].slotKey })))],
    ["regenerate:week", () => anyVersion(ok(regenerate(changed, before, { kind: "WEEK", phaseIndex: 1, week: 3 })))],
    ["regenerate:workout", () => anyVersion(ok(regenerate(changed, before, { kind: "WORKOUT", phaseIndex: 1, label: "B", fromWeek: 2 })))],
    ["regenerate:phase", () => anyVersion(ok(regenerate(changed, before, { kind: "PHASE", phaseIndex: 2 })))],
    ["regenerate:from-phase", () => anyVersion(ok(regenerate(changed, before, { kind: "FROM_PHASE", phaseIndex: 1 })))],
    ["substitute:occurrence", () => anyVersion(ok(substitute(base, before, { phaseIndex: 1, slotKey: first.items[0].slotKey, applies: { kind: "OCCURRENCE", week: 1, slot: 1 } }, "ex-goblet")))],
    ["substitute:from-week", () => anyVersion(ok(substitute(base, before, { phaseIndex: 1, slotKey: first.items[0].slotKey, applies: { kind: "FROM_WEEK", week: 3 } }, "ex-goblet")))],
    ["substitute:phase", () => anyVersion(ok(substitute(base, before, { phaseIndex: 1, slotKey: first.items[0].slotKey, applies: { kind: "PHASE" } }, "ex-goblet")))],
    ["rebase", () => anyVersion(ok(rebase({ ...base, existing: [row] }, before)))],
    ["alternatives", () => canonicalJson(alternativesFor(base, before, { phaseIndex: 1, slotKey: first.items[0].slotKey, week: 1, slot: 1 }, 8))],
  ];
}

// Calculados em 04/11/2026 sobre o motor 2.0.1 (antes da auditoria). Nunca troque.
const GOLDEN: Record<string, Record<string, string>> = {
  "2026.11.1": {
    "variety:base": "55f62bfa2378ff4912ee9f8fbcb0419cc87115ecf44f3d2afa331efa03b8a4c7",
    "variety:linear": "421986cadfd21dcd774f9b0e0e5cfd24c6f62f61c79919f595727a9ef718b9fe",
    "variety:cardio-mobility": "5325c4f7b286dd4a4847311e12f45d9d917f983c56b4c1c9e025542fc2184bbc",
    "xintus": "df7a95dd341fde66b11d23d985bd29826ba902a39170f2f0fbcad620d5af704c",
    "xintus:previous": "9739238dc15da7f0a35e02f02ef801b6d955b8430df3e44310b8af50ad5668be",
    "big-abc": "caf86ad24fcb99fc5f820354c8b28e20d2d1e7c2bfb6e16be66fc2294a75699e",
    "regenerate:item": "e01b01a323d2b9b71c487c4c2863e3c3a5c9ef20dd3991f89ba778d0755e7514",
    "regenerate:week": "01ff3108931e6935b9014a3171129718cca5e4a216be0d9d011b40ec9f192b5e",
    "regenerate:workout": "c408ae97fd078f1c3c69ee4395c4379de758d26e3fac8ff2a0fdb31e064f3fd8",
    "regenerate:phase": "1a4d523af53c1a104d2689407bf232bf969283abb35e6b9bfbc32d1bc3c79e38",
    "regenerate:from-phase": "c61608f6a9578ebfe02177238a59485a16ec604c1d17ce43b28e7fa5aa168ef2",
    "substitute:occurrence": "d790968f59faef3dfcf5b60a98a8b3ade94e1d148f35d2c5b245a931b838b9bb",
    "substitute:from-week": "854635fa683ffaec8ed85ea4f269830dfe82f779aadef54aca5f164b23cd1e73",
    "substitute:phase": "10912294f8215b55ddff64caedae612e5fca79d9cd8b666b4c7efc482a0bf2ff",
    "rebase": "83d77222f13d358f92e5f46da63b67727e6ae240dc798596ec35c7acdaffb211",
    "alternatives": "1d0ce3f318f7c3b6f9f3088908f2d28ad133ca6bde1e58fd6e180f8969df065e",
  },
  "2026.11.2": {
    "variety:base": "5ff9ddb9238ceeb4dc3a34e807414a5cb56dac741b5a1580a2369251389cd5d5",
    "variety:linear": "ef67e9a956033de8c07379a9286eec1a0920293db5a475841f804bdb7540fcde",
    "variety:cardio-mobility": "2f716cb214a2f71e2067689687660968ba956ae2423e229525c5d3a7c5f35154",
    "xintus": "4e1d813c7087e8efd733b7503a0fce3bb1eb84731c9814c0141866a11eb0d9d0",
    "xintus:previous": "3d8b3bba4433a3319e46769373d62a24a2ea79881438c8b7ed17bfe34be7a86b",
    "big-abc": "82a0729275173bf3d1bde7436c019376214033fddbeced657af5a7285bc45589",
    "regenerate:item": "4067b1909ac499ab669f9d4f90c0decfb3e3bdfe58feab29d99223a8d45527ad",
    "regenerate:week": "0d5c7ab5c74c37e5de6e69a51aeae097428be914eef6531c2ce4548a239faa14",
    "regenerate:workout": "17a578cdda4aa3fdd259cd9875521d4ace6a365f29cf3ad2efd1b16887287ab6",
    "regenerate:phase": "0e4ff506d70463eedf802eaef8e8c367decff6a1d35952a3c81621b0e84d5e63",
    "regenerate:from-phase": "95b7274672d9ca858447e18e5aa7ffa2ac0205adf8b7019f27338809183eb4ec",
    "substitute:occurrence": "e0a3daff08ec532f8a778fc82a2866d85cae9f9c0e5e95ffc3efec954b6c5448",
    "substitute:from-week": "942b261c7773e99571138f5b783d275feaf738a9f88c39c105b4206032e15e75",
    "substitute:phase": "b33434ec1db6dd639a63a770d0654fe25dfa3928b53a3291d78278dc5624524b",
    "rebase": "d9c1c8856a0aaa87eb8d3b1dcc48b03f122e35762212bb2422cdee2edd060481",
    "alternatives": "1d0ce3f318f7c3b6f9f3088908f2d28ad133ca6bde1e58fd6e180f8969df065e",
  },
};

describe("motor: versões publicadas reproduzem byte a byte (exceto engineVersion)", () => {
  for (const version of Object.keys(GOLDEN)) {
    it(`gymgital-base@${version}`, async () => {
      const got: Record<string, string> = {};
      for (const [name, run] of cases({ id: "gymgital-base", version })) got[name] = await sha256Hex(String(run()));
      if (process.env.PRINT_GOLDEN) console.log(version, JSON.stringify(got, null, 2));
      expect(got).toEqual(GOLDEN[version]);
    });
  }
});
