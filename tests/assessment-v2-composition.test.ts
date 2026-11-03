import { describe, expect, it } from "vitest";
import { assessmentV2Open } from "@/modules/avaliacoes/v2";
import {
  EMPTY_COMPOSITION,
  compositionPreview,
  compositionSchema,
  formFromPayload,
  heightFromText,
  methodLine,
  otherSites,
  payloadFromForm,
  readComposition,
  requiredSites,
  type CompositionForm,
} from "@/modules/avaliacoes/v2/composition";
import { PROTOCOL_VARIANTS } from "@/modules/avaliacoes/formulas";

// The handoff's example (section 8): man, 27 on the assessment date, 69,1 kg, 1,71 m, the nine skinfolds of page 2.
const HANDOFF_SITES = {
  subscapular: ["11"],
  triceps: ["24"],
  biceps: ["11"],
  chest: ["12"],
  midaxillary: ["9"],
  suprailiac: ["15"],
  abdominal: ["16"],
  thigh: ["35"],
  calf_medial: ["17"],
};
const form = (patch: Partial<CompositionForm> = {}): CompositionForm => ({
  ...formFromPayload(EMPTY_COMPOSITION),
  weight: "69,1",
  height: "1,71",
  protocol: "jackson_pollock_7",
  equation: "male",
  skinfolds: HANDOFF_SITES,
  ...patch,
});

describe("the switch of the new format", () => {
  it("is open by default and closes only with exactly \"false\", from the Worker or from process.env", () => {
    expect(assessmentV2Open({}, {})).toBe(true);
    expect(assessmentV2Open({ ASSESSMENT_V2_ENABLED: "true" }, {})).toBe(true);
    expect(assessmentV2Open({ ASSESSMENT_V2_ENABLED: "FALSE" }, {})).toBe(true);
    expect(assessmentV2Open({ ASSESSMENT_V2_ENABLED: "false" }, {})).toBe(false);
    expect(assessmentV2Open({}, { ASSESSMENT_V2_ENABLED: "false" })).toBe(false);
  });
});

describe("the schema of the Medidas step", () => {
  it("defaults to nothing measured, no protocol, equation not selected, mean and Siri", () => {
    expect(EMPTY_COMPOSITION).toEqual({
      weightKg: null,
      heightCm: null,
      systolicMmHg: null,
      diastolicMmHg: null,
      restingHeartRateBpm: null,
      protocol: null,
      equation: "not_selected",
      aggregation: "mean",
      conversion: "siri_1961",
      skinfolds: {},
    });
  });
  it("accepts 1 to 3 positive readings per site and refuses 0, 4, a zero or a negative reading", () => {
    expect(compositionSchema.safeParse({ skinfolds: { chest: [12] } }).success).toBe(true);
    expect(compositionSchema.safeParse({ skinfolds: { chest: [12, 12.5, 13] } }).success).toBe(true);
    expect(compositionSchema.safeParse({ skinfolds: { chest: [] } }).success).toBe(false);
    expect(compositionSchema.safeParse({ skinfolds: { chest: [1, 2, 3, 4] } }).success).toBe(false);
    expect(compositionSchema.safeParse({ skinfolds: { chest: [0] } }).success).toBe(false);
    expect(compositionSchema.safeParse({ skinfolds: { chest: [-3] } }).success).toBe(false);
    expect(compositionSchema.safeParse({ weightKg: 0 }).success).toBe(false);
  });
  it("refuses unknown fields, unknown sites, an unknown protocol, equation or conversion", () => {
    expect(compositionSchema.safeParse({ gender: "male" }).success).toBe(false);
    expect(compositionSchema.safeParse({ skinfolds: { neck: [10] } }).success).toBe(false);
    expect(compositionSchema.safeParse({ protocol: "durnin" }).success).toBe(false);
    expect(compositionSchema.safeParse({ equation: "masculino" }).success).toBe(false);
    expect(compositionSchema.safeParse({ conversion: "brozek_1963" }).success).toBe(false);
  });
  it("reads a stored payload back, and anything unknown or invalid as the empty step", () => {
    expect(readComposition({ protocol: "faulkner_4" }).protocol).toBe("faulkner_4");
    expect(readComposition({ protocol: "x" })).toEqual(EMPTY_COMPOSITION);
    expect(readComposition(null)).toEqual(EMPTY_COMPOSITION);
    expect(readComposition("texto")).toEqual(EMPTY_COMPOSITION);
  });
});

describe("the text of the screen", () => {
  it("reads the Brazilian comma and a height in metres or centimetres", () => {
    expect(heightFromText("1,71")).toBeCloseTo(171, 9);
    expect(heightFromText("1.71")).toBeCloseTo(171, 9);
    expect(heightFromText("171")).toBe(171);
    expect(heightFromText("")).toBeNull();
    expect(heightFromText("alto")).toBeNaN();
    const read = payloadFromForm(form({ systolic: "120", diastolic: "80", heartRate: "70" }));
    expect(read.problems).toEqual([]);
    expect(read.payload).toMatchObject({ weightKg: 69.1, systolicMmHg: 120, diastolicMmHg: 80, restingHeartRateBpm: 70 });
    expect(read.payload?.heightCm).toBeCloseTo(171, 9);
    expect(read.payload?.skinfolds.chest).toEqual([12]);
  });
  it("leaves an empty field or reading out (never 0) and names a field that is not a positive number", () => {
    const read = payloadFromForm(form({ weight: "", skinfolds: { chest: ["12", "", "12,4"], thigh: [""] } }));
    expect(read.payload?.weightKg).toBeNull();
    expect(read.payload?.skinfolds).toEqual({ chest: [12, 12.4] });
    expect(payloadFromForm(form({ weight: "69 kg" })).problems).toEqual(["Peso"]);
    expect(payloadFromForm(form({ height: "0" })).problems).toEqual(["Altura"]);
    expect(payloadFromForm(form({ skinfolds: { chest: ["0"] } })).problems).toEqual(["Peitoral"]);
    expect(payloadFromForm(form({ skinfolds: { chest: ["1", "2", "3", "4"] } })).problems).toEqual(["Peitoral"]);
  });
  it("shows a stored payload again as typed (height in metres, comma)", () => {
    const shown = formFromPayload(compositionSchema.parse({ weightKg: 69.1, heightCm: 171, skinfolds: { chest: [12.5] } }));
    expect(shown).toMatchObject({ weight: "69,1", height: "1,71", skinfolds: { chest: ["12,5"] } });
    // And back, unchanged.
    expect(payloadFromForm(shown).payload).toMatchObject({ weightKg: 69.1, heightCm: 171, skinfolds: { chest: [12.5] } });
  });
});

describe("which sites the step asks for", () => {
  it("asks the variant's sites, and both references' when the equation is not selected", () => {
    expect(requiredSites("jackson_pollock_7", "male")).toHaveLength(7);
    expect(requiredSites("jackson_pollock_3", "male")).toEqual(["chest", "abdominal", "thigh"]);
    expect(new Set(requiredSites("jackson_pollock_3", "not_selected"))).toEqual(new Set(["chest", "abdominal", "thigh", "triceps", "suprailiac"]));
    expect(requiredSites(null, "male")).toEqual([]);
    expect(otherSites("faulkner_4", "male")).toEqual(["biceps", "chest", "midaxillary", "thigh", "calf_medial"]);
    expect(otherSites(null, "male")).toHaveLength(9);
  });
  it("keeps every typed value when the protocol changes (JP7 → Faulkner → JP7)", () => {
    const jp7 = form();
    const faulkner = { ...jp7, protocol: "faulkner_4" as const };
    expect(payloadFromForm(faulkner).payload?.skinfolds).toEqual(payloadFromForm(jp7).payload?.skinfolds);
    expect(Object.keys(payloadFromForm(faulkner).payload?.skinfolds ?? {})).toHaveLength(9);
    expect(compositionPreview({ ...faulkner, protocol: "jackson_pollock_7" }, 27)).toEqual(compositionPreview(jp7, 27));
  });
});

describe("the preview", () => {
  it("matches the handoff's JP7 example: 122 mm, 17,3%, 11,9 kg, 57,2 kg, IMC 23,63", () => {
    expect(compositionPreview(form(), 27)).toEqual({
      sumLabel: "Soma das 7 dobras",
      sum: "122 mm",
      fatPercent: "17,3%",
      fatMass: "11,9 kg",
      fatFree: "57,2 kg",
      bmi: "23,63",
      method: "Fórmula Jackson & Pollock 1978 + Siri 1961; resultado estimado",
      status: null,
      flag: null,
    });
  });
  it("builds the method line from the variant's data (Faulkner has no conversion)", () => {
    expect(methodLine(PROTOCOL_VARIANTS.faulkner_4.male)).toBe("Fórmula Faulkner 1968; resultado estimado");
    expect(methodLine(PROTOCOL_VARIANTS.jackson_pollock_3.female)).toBe("Fórmula Jackson, Pollock & Ward 1980 + Siri 1961; resultado estimado");
    expect(compositionPreview(form({ protocol: "faulkner_4" }), 27)).toMatchObject({ sum: "66 mm", fatPercent: "15,9%" });
  });
  it("says what is missing instead of a number", () => {
    expect(compositionPreview(form({ protocol: null }), 27).status).toBe("Escolha o protocolo de dobras para calcular");
    expect(compositionPreview(form({ equation: "not_selected" }), 27)).toMatchObject({ status: "Escolha a equação de referência para calcular", sum: null, method: null });
    expect(compositionPreview(form({ skinfolds: { ...HANDOFF_SITES, chest: [""], thigh: [] } }), 27)).toMatchObject({
      status: "Aguardando medidas: Peitoral, Coxa",
      sum: null,
    });
    expect(compositionPreview(form(), null)).toMatchObject({ status: "Sem idade: o cálculo precisa da data de nascimento", sum: null });
    expect(compositionPreview(form({ skinfolds: { ...HANDOFF_SITES, chest: ["-2"] } }), 27).status).toBe("Valores fora do possível: confira as medidas");
    expect(compositionPreview(form({ skinfolds: { ...HANDOFF_SITES, chest: ["doze"] } }), 27).status).toBe("Valores fora do possível: confira as medidas");
  });
  it("aggregates up to three readings and asks for one when the rule is a single reading", () => {
    const three = form({ skinfolds: { ...HANDOFF_SITES, chest: ["11", "12", "13"] } });
    expect(compositionPreview(three, 27).sum).toBe("122 mm");
    expect(compositionPreview({ ...three, aggregation: "median" }, 27).sum).toBe("122 mm");
    expect(compositionPreview({ ...three, aggregation: "single" }, 27)).toMatchObject({ status: "Leitura única: deixe só uma leitura em Peitoral", sum: null });
  });
  it("flags a person outside the original validation population, and shows the result anyway", () => {
    expect(compositionPreview(form(), 70)).toMatchObject({ flag: "Fora da faixa original de validação (Homens de 18 a 61 anos)" });
    expect(compositionPreview(form({ protocol: "guedes_3" }), null).flag).toBe("Sem idade para conferir a faixa original de validação (Referência original: homens jovens universitários (17–27 anos))");
  });
  it("shows the IMC without skinfolds, and no mass without the weight", () => {
    expect(compositionPreview(form({ protocol: null }), 27).bmi).toBe("23,63");
    expect(compositionPreview(form({ height: "171" }), 27).bmi).toBe("23,63");
    expect(compositionPreview(form({ weight: "" }), 27)).toMatchObject({ fatPercent: "17,3%", fatMass: null, fatFree: null, bmi: null });
  });
});
