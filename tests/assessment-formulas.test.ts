import { describe, expect, it } from "vitest";
import {
  ageOn,
  bilateralDifference,
  bmi,
  bodyComposition,
  cooper,
  FLEXITEST_MOVEMENTS,
  flexitest,
  FORMULA_VERSION,
  heightToCm,
  parseDecimal,
  PROTOCOL_VARIANTS,
  PROTOCOLS,
  selectedValue,
  sumFor,
  variantFor,
  waistHipRatio,
  type BodyCompositionInput,
  type FlexitestLevel,
  type SiteValues,
} from "@/modules/avaliacoes/formulas";

// Section 8 fixture: the PDF page 2, anonymized. Man, 27 on the assessment date, 69.1 kg, 1.71 m.
const PDF_SITES: SiteValues = {
  subscapular: 11,
  triceps: 24,
  biceps: 11,
  chest: 12,
  midaxillary: 9,
  suprailiac: 15,
  abdominal: 16,
  thigh: 35,
  calf_medial: 17,
};
const base = (over: Partial<BodyCompositionInput>): BodyCompositionInput => ({
  protocol: "jackson_pollock_7",
  equation: "male",
  ageYears: 27,
  weightKg: 69.1,
  sites: PDF_SITES,
  conversion: "siri_1961",
  ...over,
});
const ok = (input: BodyCompositionInput) => {
  const result = bodyComposition(input);
  if (result.status !== "ok") throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  return result;
};

describe("protocol matrix (section 4)", () => {
  it("shows exactly four protocols with Portuguese labels", () => {
    expect(PROTOCOLS.map((p) => p.label)).toEqual([
      "Faulkner (4 dobras)",
      "Guedes (3 dobras)",
      "Jackson e Pollock (7 dobras)",
      "Jackson e Pollock (3 dobras)",
    ]);
  });

  it("resolves stable variant identifiers by equation reference", () => {
    expect(variantFor("faulkner_4", "male").id).toBe("faulkner_4_1968");
    expect(variantFor("faulkner_4", "female").id).toBe("faulkner_4_1968");
    expect(variantFor("guedes_3", "male").id).toBe("guedes_3_1985_male");
    expect(variantFor("guedes_3", "female").id).toBe("guedes_3_1985_female");
    expect(variantFor("jackson_pollock_7", "male").id).toBe("jackson_pollock_7_1978_male");
    expect(variantFor("jackson_pollock_7", "female").id).toBe("jackson_pollock_7_1980_female");
    expect(variantFor("jackson_pollock_3", "male").id).toBe("jackson_pollock_3_1978_male");
    expect(variantFor("jackson_pollock_3", "female").id).toBe("jackson_pollock_3_1980_female");
  });

  it("only Faulkner gives % directly; all others give density", () => {
    for (const byRef of Object.values(PROTOCOL_VARIANTS)) {
      for (const variant of Object.values(byRef)) {
        expect(variant.output).toBe(variant.id === "faulkner_4_1968" ? "percent" : "density");
        expect(variant.source.length).toBeGreaterThan(0);
        expect(variant.validation.text.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("regression table (section 8)", () => {
  it("JP7 male: sum 122 mm, ~17.27 %, fat mass ~11.94 kg", () => {
    const result = ok(base({}));
    expect(result.sumMm).toBe(122);
    expect(result.density).toBeCloseTo(1.0593344, 7);
    expect(result.bodyFatPercent).toBeCloseTo(17.27, 2);
    expect(result.fatMassKg).toBeCloseTo(11.94, 2);
    expect(result.fatFreeMassKg).toBeCloseTo(69.1 - result.fatMassKg!, 10);
    expect(result.variant).toBe("jackson_pollock_7_1978_male");
    expect(result.conversion).toBe("siri_1961");
    expect(result.formulaVersion).toBe(FORMULA_VERSION);
    expect(result.flags).toEqual([]);
  });

  it("JP3 male: 63 mm, ~18.44 %", () => {
    const result = ok(base({ protocol: "jackson_pollock_3" }));
    expect(result.sumMm).toBe(63);
    expect(result.bodyFatPercent).toBeCloseTo(18.44, 2);
  });

  it("Guedes 3 male: 55 mm, ~19.35 %", () => {
    const result = ok(base({ protocol: "guedes_3" }));
    expect(result.sumMm).toBe(55);
    expect(result.bodyFatPercent).toBeCloseTo(19.35, 2);
  });

  it("Faulkner 4: 66 mm, 15.88 %, no density and no Siri", () => {
    const result = ok(base({ protocol: "faulkner_4" }));
    expect(result.sumMm).toBe(66);
    expect(result.bodyFatPercent).toBeCloseTo(15.88, 2);
    expect(result.density).toBeNull();
    expect(result.conversion).toBeNull();
    expect(result.flags).toEqual(["requires_professional_validation"]);
  });

  it("BMI 69.1 / 1.71² ~23.63 (height given in m)", () => {
    expect(bmi(69.1, heightToCm(1.71, "m"))).toBeCloseTo(23.63, 2);
    expect(bmi(69.1, heightToCm(171, "cm"))).toBeCloseTo(23.63, 2);
  });

  it("WHR 69.5 / 108 ~0.644", () => {
    expect(waistHipRatio(69.5, 108)).toBeCloseTo(0.644, 2);
    expect(waistHipRatio(69.5, 108)).toBeCloseTo(0.6435, 4);
  });

  it("Flexiteste of the PDF sums 32", () => {
    const levels = [2, 3, 2, 2, 1, 1, 2, 3, 3, 2, 2, 3, 2, 2, 2] as FlexitestLevel[];
    const input = Object.fromEntries(FLEXITEST_MOVEMENTS.map((m, i) => [m.code, levels[i]]));
    expect(flexitest(input)).toEqual({ filled: 15, total: 32, complete: true });
  });

  it("Cooper 2200 m: 11.0 km/h and VO2 ~37.90, not the PDF's 37.69", () => {
    const result = cooper(2200)!;
    expect(result.speedKmh).toBe(11);
    expect(result.vo2Estimate).toBeCloseTo(37.9, 2);
    expect(result.vo2Estimate).not.toBeCloseTo(37.69, 2);
    expect(result.formulaVersion).toBe(FORMULA_VERSION);
  });
});

describe("edge cases (section 8)", () => {
  it("a null site leaves the calculation pending with the missing sites", () => {
    const result = bodyComposition(base({ sites: { ...PDF_SITES, thigh: null } }));
    expect(result).toEqual({ status: "pending", reason: "missing_sites", missing: ["thigh"] });
    expect(sumFor(variantFor("jackson_pollock_3", "male"), { chest: 12 })).toEqual({
      sumMm: null,
      missing: ["abdominal", "thigh"],
      invalid: [],
    });
  });

  it("an improper zero or a negative value is invalid, never summed", () => {
    expect(bodyComposition(base({ sites: { ...PDF_SITES, chest: 0 } }))).toEqual({
      status: "invalid",
      reason: "invalid_site_value",
      sites: ["chest"],
    });
    expect(bodyComposition(base({ sites: { ...PDF_SITES, thigh: -35 } }))).toMatchObject({ status: "invalid" });
    expect(selectedValue([0], "single")).toBeNull();
    expect(selectedValue([-3], "single")).toBeNull();
    expect(selectedValue([Number.NaN], "single")).toBeNull();
  });

  it("indices return null, never 0, for missing or invalid input", () => {
    expect(bmi(null, 171)).toBeNull();
    expect(bmi(69.1, 0)).toBeNull();
    expect(waistHipRatio(69.5, null)).toBeNull();
    expect(waistHipRatio(-1, 108)).toBeNull();
    expect(bilateralDifference(30, undefined)).toBeNull();
    expect(bilateralDifference(31.5, 30)).toBeCloseTo(1.5, 10);
    expect(bilateralDifference(30, 31.5)).toBeCloseTo(-1.5, 10);
    expect(heightToCm(null, "m")).toBeNull();
    expect(cooper(0)).toBeNull();
    expect(cooper(-100)).toBeNull();
    expect(cooper(null)).toBeNull();
  });

  it("missing weight keeps % but leaves the masses null", () => {
    const result = ok(base({ weightKg: null }));
    expect(result.bodyFatPercent).toBeCloseTo(17.27, 2);
    expect(result.fatMassKg).toBeNull();
    expect(result.fatFreeMassKg).toBeNull();
  });

  it("parses the Brazilian decimal comma and rejects junk", () => {
    expect(parseDecimal("12,5")).toBe(12.5);
    expect(parseDecimal("12.5")).toBe(12.5);
    expect(parseDecimal(" 69,1 ")).toBe(69.1);
    expect(parseDecimal("1,71")).toBe(1.71);
    expect(parseDecimal("")).toBeNull();
    expect(parseDecimal("   ")).toBeNull();
    expect(parseDecimal(null)).toBeNull();
    expect(parseDecimal("abc")).toBeNull();
    expect(parseDecimal("12,5mm")).toBeNull();
    expect(parseDecimal("1.234,5")).toBeNull();
    expect(parseDecimal("1,2,3")).toBeNull();
    expect(parseDecimal(",5")).toBeNull();
  });

  it("three readings per site aggregate by mean or median, without truncation", () => {
    expect(selectedValue([12, 13, 14.5], "mean")).toBeCloseTo(13.1666666667, 9);
    expect(selectedValue([12, 14.5, 13], "median")).toBe(13);
    expect(selectedValue([12, 13], "median")).toBe(12.5);
    expect(selectedValue([12.35], "single")).toBe(12.35);
    expect(selectedValue([12, 13], "single")).toBeNull();
    expect(selectedValue([], "mean")).toBeNull();
    expect(selectedValue([1, 2, 3, 4], "mean")).toBeNull();
  });

  it("extra sites are not summed", () => {
    expect(sumFor(variantFor("jackson_pollock_3", "male"), PDF_SITES).sumMm).toBe(63);
    expect(sumFor(variantFor("faulkner_4", "male"), { ...PDF_SITES, calf_medial: 999 }).sumMm).toBe(66);
  });

  it("female JP3 and Guedes use their own sites", () => {
    const jp3 = ok(base({ protocol: "jackson_pollock_3", equation: "female" }));
    expect(jp3.variant).toBe("jackson_pollock_3_1980_female");
    expect(jp3.sumMm).toBe(24 + 15 + 35);
    const d3 = 1.0994921 - 0.0009929 * 74 + 0.0000023 * 74 * 74 - 0.0001392 * 27;
    expect(jp3.density).toBeCloseTo(d3, 12);
    expect(jp3.bodyFatPercent).toBeCloseTo(495 / d3 - 450, 10);

    const guedes = ok(base({ protocol: "guedes_3", equation: "female", ageYears: 18 }));
    expect(guedes.variant).toBe("guedes_3_1985_female");
    expect(guedes.sumMm).toBe(35 + 15 + 11);
    const dg = 1.1665 - 0.07063 * Math.log10(61);
    expect(guedes.density).toBeCloseTo(dg, 12);
    expect(guedes.bodyFatPercent).toBeCloseTo(495 / dg - 450, 10);
    expect(guedes.flags).toEqual([]);
  });

  it("female JP7 uses the 1980 equation", () => {
    const result = ok(base({ equation: "female" }));
    const d = 1.097 - 0.00046971 * 122 + 0.00000056 * 122 * 122 - 0.00012828 * 27;
    expect(result.variant).toBe("jackson_pollock_7_1980_female");
    expect(result.density).toBeCloseTo(d, 12);
  });

  it("equation not selected keeps the calculation pending, for every protocol", () => {
    for (const { id } of PROTOCOLS) {
      expect(bodyComposition(base({ protocol: id, equation: "not_selected" }))).toEqual({
        status: "pending",
        reason: "equation_not_selected",
      });
    }
  });

  it("JP needs age; Guedes and Faulkner do not", () => {
    expect(bodyComposition(base({ ageYears: null }))).toEqual({ status: "pending", reason: "missing_age" });
    expect(bodyComposition(base({ protocol: "jackson_pollock_3", ageYears: null }))).toMatchObject({
      status: "pending",
      reason: "missing_age",
    });
    expect(ok(base({ protocol: "guedes_3", ageYears: null })).flags).toEqual(["validation_age_unknown"]);
    expect(ok(base({ protocol: "faulkner_4", ageYears: null })).status).toBe("ok");
  });

  it("age outside the validation population flags, it does not block", () => {
    const jp7 = ok(base({ ageYears: 65 }));
    expect(jp7.flags).toEqual(["outside_validation_population"]);
    const jp7Female = ok(base({ equation: "female", ageYears: 58 }));
    expect(jp7Female.flags).toEqual(["outside_validation_population"]);
    expect(ok(base({ equation: "female", ageYears: 55 })).flags).toEqual([]);
    expect(ok(base({ protocol: "guedes_3", ageYears: 28 })).flags).toEqual(["outside_validation_population"]);
    expect(ok(base({ protocol: "guedes_3", equation: "female", ageYears: 20 })).flags).toEqual([
      "outside_validation_population",
    ]);
  });

  it("birthday on the assessment day counts", () => {
    expect(ageOn("1999-11-02", "2026-11-02")).toBe(27);
    expect(ageOn("1999-11-03", "2026-11-02")).toBe(26);
    expect(ageOn("1999-11-01", "2026-11-02")).toBe(27);
    expect(ageOn("2000-02-29", "2026-02-28")).toBe(25);
    expect(ageOn("2000-02-29", "2026-03-01")).toBe(26);
    expect(ageOn("2027-01-01", "2026-11-02")).toBeNull();
    expect(ageOn("1999-02-30", "2026-11-02")).toBeNull();
    expect(ageOn("02/11/1999", "2026-11-02")).toBeNull();
    expect(ageOn(null, "2026-11-02")).toBeNull();
  });

  it("an impossible result is invalid, never clamped", () => {
    // Faulkner with huge folds: 0.153 * 640 + 5.783 = 103.7 % fat, impossible (no narrower bound is made up).
    const huge = { triceps: 160, subscapular: 160, suprailiac: 160, abdominal: 160 };
    expect(bodyComposition(base({ protocol: "faulkner_4", sites: huge }))).toEqual({
      status: "invalid",
      reason: "implausible_fat_percent",
    });
    // Guedes male with a tiny sum gives density above 1.1 and a negative % fat.
    expect(
      bodyComposition(base({ protocol: "guedes_3", sites: { triceps: 1, suprailiac: 1, abdominal: 1 } })),
    ).toEqual({ status: "invalid", reason: "implausible_fat_percent" });
    // Non-integer or negative age is invalid input.
    expect(bodyComposition(base({ ageYears: 27.5 }))).toEqual({ status: "invalid", reason: "invalid_age" });
  });

  it("Flexiteste: empty items are not zero and the total waits for all 15", () => {
    const partial = flexitest({ shoulder_abduction: 2, hip_flexion: null, knee_flexion: 4 });
    expect(partial).toEqual({ filled: 2, total: null, complete: false });
    expect(FLEXITEST_MOVEMENTS).toHaveLength(15);
    expect(FLEXITEST_MOVEMENTS[0].label).toBe("Abdução horizontal dos ombros");
    expect(FLEXITEST_MOVEMENTS[14].label).toBe("Flexão plantar");
  });
});
