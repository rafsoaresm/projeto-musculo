/**
 * Skinfold protocol matrix (handoff Avaliação Física V2, section 4), as data.
 *
 * The person only sees four protocols. The equation variant is resolved by the
 * physiological reference selected for the calculation ("male" | "female"), never
 * by a generic gender label. Pure data: no I/O, safe on the server and the client.
 */

/** The nine skinfold sites catalogued on page 2 of the source PDF (mm). */
export const SKINFOLD_SITES = [
  { code: "subscapular", label: "Subescapular" },
  { code: "triceps", label: "Tríceps" },
  { code: "biceps", label: "Bíceps" },
  { code: "chest", label: "Peitoral" },
  { code: "midaxillary", label: "Axilar média" },
  { code: "suprailiac", label: "Supra-ilíaca" },
  { code: "abdominal", label: "Abdominal" },
  { code: "thigh", label: "Coxa" },
  { code: "calf_medial", label: "Panturrilha medial" },
] as const;
export type SkinfoldSite = (typeof SKINFOLD_SITES)[number]["code"];
export const SKINFOLD_SITE_CODES = SKINFOLD_SITES.map((site) => site.code) as [SkinfoldSite, ...SkinfoldSite[]];

export const PROTOCOLS = [
  { id: "faulkner_4", label: "Faulkner (4 dobras)" },
  { id: "guedes_3", label: "Guedes (3 dobras)" },
  { id: "jackson_pollock_7", label: "Jackson e Pollock (7 dobras)" },
  { id: "jackson_pollock_3", label: "Jackson e Pollock (3 dobras)" },
] as const;
export type ProtocolId = (typeof PROTOCOLS)[number]["id"];
export const PROTOCOL_IDS = PROTOCOLS.map((protocol) => protocol.id) as [ProtocolId, ...ProtocolId[]];

/** Physiological reference of the equation. Not a gender identity. */
export type EquationReference = "male" | "female";
export type EquationSelection = EquationReference | "not_selected";

export type VariantId =
  | "faulkner_4_1968"
  | "guedes_3_1985_male"
  | "guedes_3_1985_female"
  | "jackson_pollock_7_1978_male"
  | "jackson_pollock_7_1980_female"
  | "jackson_pollock_3_1978_male"
  | "jackson_pollock_3_1980_female";

export type ProtocolVariant = {
  id: VariantId;
  protocol: ProtocolId;
  /** null when the same equation is used for both references (Faulkner). */
  reference: EquationReference | null;
  sites: readonly SkinfoldSite[];
  /** "density" goes through a conversion (Siri); "percent" is already % fat. */
  output: "density" | "percent";
  requiresAge: boolean;
  validation: {
    /** Inclusive age range of the original validation sample; null when not stated. */
    ageMin: number | null;
    ageMax: number | null;
    text: string;
  };
  source: string;
};

const JP7_SITES = ["chest", "midaxillary", "triceps", "subscapular", "abdominal", "suprailiac", "thigh"] as const;

const FAULKNER: ProtocolVariant = {
  id: "faulkner_4_1968",
  protocol: "faulkner_4",
  reference: null,
  sites: ["triceps", "subscapular", "suprailiac", "abdominal"],
  output: "percent",
  requiresAge: false,
  validation: {
    ageMin: null,
    ageMax: null,
    text: "Utilização relatada para homens e mulheres; exige validação pelo profissional.",
  },
  source: "Faulkner (1968), conforme Avaliação Morfofuncional, SESES/Estácio, 2017, pp. 106–108.",
};

export const PROTOCOL_VARIANTS: Record<ProtocolId, Record<EquationReference, ProtocolVariant>> = {
  faulkner_4: { male: FAULKNER, female: FAULKNER },
  guedes_3: {
    male: {
      id: "guedes_3_1985_male",
      protocol: "guedes_3",
      reference: "male",
      sites: ["triceps", "suprailiac", "abdominal"],
      output: "density",
      requiresAge: false,
      validation: { ageMin: 17, ageMax: 27, text: "Referência original: homens jovens universitários (17–27 anos)." },
      source: "Guedes e Sampedro (1985), https://doi.org/10.5433/1679-0359.1985v6n3p160",
    },
    female: {
      id: "guedes_3_1985_female",
      protocol: "guedes_3",
      reference: "female",
      sites: ["thigh", "suprailiac", "subscapular"],
      output: "density",
      requiresAge: false,
      validation: { ageMin: 17, ageMax: 19, text: "Referência original: mulheres jovens universitárias (17–19 anos)." },
      source: "Guedes e Sampedro (1985), https://doi.org/10.5433/1679-0359.1985v6n3p160",
    },
  },
  jackson_pollock_7: {
    male: {
      id: "jackson_pollock_7_1978_male",
      protocol: "jackson_pollock_7",
      reference: "male",
      sites: JP7_SITES,
      output: "density",
      requiresAge: true,
      validation: { ageMin: 18, ageMax: 61, text: "Homens de 18 a 61 anos." },
      source: "Jackson e Pollock (1978); Topend Sports, Jackson-Pollock Body Density.",
    },
    female: {
      id: "jackson_pollock_7_1980_female",
      protocol: "jackson_pollock_7",
      reference: "female",
      sites: JP7_SITES,
      output: "density",
      requiresAge: true,
      validation: { ageMin: 18, ageMax: 55, text: "Mulheres de 18 a 55 anos." },
      source: "Jackson, Pollock e Ward (1980); Topend Sports, Jackson-Pollock Body Density.",
    },
  },
  jackson_pollock_3: {
    male: {
      id: "jackson_pollock_3_1978_male",
      protocol: "jackson_pollock_3",
      reference: "male",
      sites: ["chest", "abdominal", "thigh"],
      output: "density",
      requiresAge: true,
      validation: { ageMin: 18, ageMax: 61, text: "Homens de 18 a 61 anos." },
      source: "Jackson e Pollock (1978); Topend Sports, Jackson-Pollock Body Density.",
    },
    female: {
      id: "jackson_pollock_3_1980_female",
      protocol: "jackson_pollock_3",
      reference: "female",
      sites: ["triceps", "suprailiac", "thigh"],
      output: "density",
      requiresAge: true,
      validation: { ageMin: 18, ageMax: 55, text: "Mulheres de 18 a 55 anos." },
      source: "Jackson, Pollock e Ward (1980); Topend Sports, Jackson-Pollock Body Density.",
    },
  },
};

export function variantFor(protocol: ProtocolId, reference: EquationReference): ProtocolVariant {
  return PROTOCOL_VARIANTS[protocol][reference];
}

export function protocolLabel(protocol: ProtocolId): string {
  return PROTOCOLS.find((entry) => entry.id === protocol)?.label ?? protocol;
}
