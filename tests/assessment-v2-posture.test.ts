import { describe, expect, it } from "vitest";
import { POSTURE_REGIONS, POSTURE_REGION_BY_KEY, SOMATOTYPES } from "@/modules/avaliacoes/catalog";
import {
  EMPTY_POSTURE,
  findingsProblem,
  findingsText,
  issueNames,
  postureEmpty,
  postureFormFrom,
  postureFromForm,
  postureSchema,
  readPosture,
  regionsOf,
  somatotypeText,
  toggleFinding,
  toggleSomatotype,
  viewTabLabel,
  type PostureForm,
} from "@/modules/avaliacoes/v2/posture";
import { compositionSchema } from "@/modules/avaliacoes/v2/composition";
import { reviewDraft } from "@/modules/avaliacoes/v2/review";
import { draftScreening, screeningSchema } from "@/modules/avaliacoes/v2/screening";

// Slice 0.79: the posture and the somatotype of the "Movimento" step (handoff 3.3, Figma AV-05). Observations, never a diagnosis; nothing computed.
const region = (key: keyof typeof POSTURE_REGION_BY_KEY) => POSTURE_REGION_BY_KEY[key];
const form = (patch: Partial<PostureForm> = {}): PostureForm => ({ ...postureFormFrom(EMPTY_POSTURE), ...patch });

describe("the regions of the three views (handoff 3.3, every list as written)", () => {
  it("has the 8 lateral, 7 posterior and 4 anterior regions, with the handoff's findings and the two added “sem desvio observado”", () => {
    expect(regionsOf("lateral").map((item) => item.label)).toEqual(["Lordose cervical", "Ombros", "Abdômen", "Cifose torácica", "Lordose lombar", "Quadril", "Joelhos", "Pés"]);
    expect(regionsOf("posterior").map((item) => item.label)).toEqual(["Ombros", "Coluna", "Escápulas", "Pés", "Tíbia", "Inclinação da cabeça", "Rotação do quadril"]);
    expect(regionsOf("anterior").map((item) => item.label)).toEqual(["Joelhos", "Patelas", "EIAS", "EIPS"]);
    expect(POSTURE_REGIONS).toHaveLength(19);
    expect(Object.values(region("lateral_feet").findings)).toEqual(["Plano", "Cavo", "Calcâneo", "Equino"]);
    expect(Object.values(region("posterior_scapulae").findings)).toEqual(["Abduzida", "Esquerda alada", "Direita alada", "Rodada inferior", "Rodada superior"]);
    expect(Object.values(region("posterior_spine").findings)).toEqual(["Alinhada", "Escoliose lombar", "Escoliose torácica", "Em “S”"]);
    expect(Object.values(region("posterior_head_tilt").findings)).toEqual(["Sem desvio observado", "Direita", "Esquerda"]);
    expect(Object.values(region("posterior_hip_rotation").findings)).toEqual(["Sem desvio observado", "Interna", "Externa"]);
    expect(Object.values(region("anterior_psis").findings)).toEqual(["Alinhada", "Esquerda deprimida", "Direita deprimida"]);
    // The same region in two views never mixes: its key carries the view.
    expect(region("lateral_shoulders").findings).not.toEqual(region("posterior_shoulders").findings);
  });
  it("takes several findings only where they may coexist; the neutral one stands alone", () => {
    expect(POSTURE_REGIONS.filter((item) => item.multiple).map((item) => `${item.view}_${item.region}`)).toEqual([
      "lateral_shoulders",
      "lateral_feet",
      "posterior_spine",
      "posterior_scapulae",
    ]);
    const shoulders = region("lateral_shoulders");
    expect(toggleFinding(shoulders, [], "internal_rotation", true)).toEqual(["internal_rotation"]);
    // Kept in the handoff's order, whatever the order of the clicks.
    expect(toggleFinding(shoulders, ["internal_rotation"], "protracted", true)).toEqual(["protracted", "internal_rotation"]);
    expect(toggleFinding(shoulders, ["protracted", "internal_rotation"], "aligned", true)).toEqual(["aligned"]);
    expect(toggleFinding(shoulders, ["aligned"], "protracted", true)).toEqual(["protracted"]);
    expect(toggleFinding(shoulders, ["protracted"], "protracted", false)).toEqual([]);
    const knees = region("anterior_knees");
    expect(toggleFinding(knees, ["valgus"], "varus", true)).toEqual(["varus"]);
    expect(findingsProblem(knees, ["valgus", "varus"])).toBe("single");
    expect(findingsProblem(shoulders, ["aligned", "protracted"])).toBe("neutral");
    expect(findingsProblem(shoulders, ["hunched"])).toBe("unknown");
    expect(findingsProblem(shoulders, [])).toBe("empty");
    expect(findingsProblem(region("lateral_feet"), ["flat", "equinus"])).toBeNull();
  });
});

describe("the schema of the module “posture”", () => {
  it("starts empty: no region observed (never “alinhado” by default), no somatotype, no measure", () => {
    expect(EMPTY_POSTURE).toEqual({
      findings: {},
      notes: { lateral: "", posterior: "", anterior: "" },
      somatotype: { method: "manual", labels: [], notes: "", heathCarter: { supraspinaleSkinfoldMm: null, flexedArmGirthCm: null } },
    });
    expect(postureEmpty(EMPTY_POSTURE)).toBe(true);
    expect(readPosture(undefined)).toEqual(EMPTY_POSTURE);
    // Anything it does not take reads as the empty module, never as a guess.
    expect(readPosture({ findings: { lateral_knees: ["valgus"] } })).toEqual(EMPTY_POSTURE);
  });
  it("refuses a finding of another region, a second one in a single choice, the neutral with another, an unknown region, an empty list and a 0", () => {
    expect(postureSchema.safeParse({ findings: { lateral_knees: ["recurvatum"], posterior_scapulae: ["abducted", "left_winged"] } }).success).toBe(true);
    expect(postureSchema.safeParse({ findings: { lateral_knees: ["valgus"] } }).success).toBe(false);
    expect(postureSchema.safeParse({ findings: { lateral_knees: ["recurvatum", "flexed"] } }).success).toBe(false);
    expect(postureSchema.safeParse({ findings: { posterior_spine: ["aligned", "s_curve"] } }).success).toBe(false);
    expect(postureSchema.safeParse({ findings: { lateral_neck: ["aligned"] } }).success).toBe(false);
    expect(postureSchema.safeParse({ findings: { lateral_knees: [] } }).success).toBe(false);
    expect(postureSchema.safeParse({ somatotype: { heathCarter: { supraspinaleSkinfoldMm: 0 } } }).success).toBe(false);
    expect(postureSchema.safeParse({ somatotype: { heathCarter: { supraspinaleSkinfoldMm: -3 } } }).success).toBe(false);
    // Only the manual record in this version: a computed Heath-Carter is not accepted from a payload.
    expect(postureSchema.safeParse({ somatotype: { method: "heath_carter" } }).success).toBe(false);
    expect(postureSchema.safeParse({ somatotype: { labels: ["endomorph", "mixed"] } }).success).toBe(false);
    expect(postureSchema.safeParse({ somatotype: { labels: ["endomorph", "endomorph"] } }).success).toBe(false);
    expect(postureSchema.safeParse({ notes: { lateral: "x".repeat(1001) } }).success).toBe(false);
    expect(postureSchema.safeParse({ extra: true }).success).toBe(false);
  });
  it("names the fields of a payload refused on the server, as the screen does", () => {
    const refused = postureSchema.safeParse({
      findings: { lateral_knees: ["recurvatum", "flexed"], anterior_asis: ["up"] },
      notes: { posterior: "x".repeat(1001) },
      somatotype: { labels: ["mixed", "ectomorph"], heathCarter: { flexedArmGirthCm: 0 } },
    });
    expect(refused.success).toBe(false);
    expect(issueNames(refused.error!.issues)).toEqual([
      "Joelhos (visão lateral)",
      "EIAS (visão anterior)",
      "Observações da visão posterior",
      "Somatotipo",
      "Perímetro do braço flexionado e contraído",
    ]);
  });
});

describe("the somatotype: the professional's record, never computed", () => {
  it("takes the three components together (the PDF's “endomorfo-mesomorfo”); “Misto” and “Não classificado” stand alone", () => {
    expect(toggleSomatotype([], "mesomorph", true)).toEqual(["mesomorph"]);
    expect(toggleSomatotype(["mesomorph"], "endomorph", true)).toEqual(["endomorph", "mesomorph"]);
    expect(toggleSomatotype(["endomorph", "mesomorph"], "mixed", true)).toEqual(["mixed"]);
    expect(toggleSomatotype(["mixed"], "ectomorph", true)).toEqual(["ectomorph"]);
    expect(toggleSomatotype(["ectomorph"], "unclassified", true)).toEqual(["unclassified"]);
    expect(toggleSomatotype(["endomorph", "mesomorph"], "endomorph", false)).toEqual(["mesomorph"]);
    expect(somatotypeText(["endomorph", "mesomorph"])).toBe("Endomorfo e Mesomorfo");
    expect(somatotypeText([])).toBeNull();
    expect(Object.values(SOMATOTYPES)).toEqual(["Endomorfo", "Mesomorfo", "Ectomorfo", "Misto", "Não classificado"]);
  });
});

describe("the screen's form", () => {
  it("reads the screen: a region without a finding is left out, an empty measure is null (never 0), and it comes back unchanged", () => {
    const read = postureFromForm(
      form({
        findings: { lateral_shoulders: ["internal_rotation", "protracted"], lateral_knees: [], posterior_scapulae: ["left_winged"] },
        notes: { lateral: "Ombro direito mais protuso", posterior: "", anterior: "" },
        somatotype: ["mesomorph", "endomorph"],
        somatotypeNotes: "Predomínio mesomorfo",
        heathCarter: { supraspinaleSkinfoldMm: "8,5", flexedArmGirthCm: "" },
      }),
    );
    expect(read.problems).toEqual([]);
    expect(read.payload).toEqual({
      findings: { lateral_shoulders: ["protracted", "internal_rotation"], posterior_scapulae: ["left_winged"] },
      notes: { lateral: "Ombro direito mais protuso", posterior: "", anterior: "" },
      somatotype: { method: "manual", labels: ["endomorph", "mesomorph"], notes: "Predomínio mesomorfo", heathCarter: { supraspinaleSkinfoldMm: 8.5, flexedArmGirthCm: null } },
    });
    expect(postureFromForm(postureFormFrom(read.payload!)).payload).toEqual(read.payload);
    expect(postureFormFrom(read.payload!).heathCarter).toEqual({ supraspinaleSkinfoldMm: "8,5", flexedArmGirthCm: "" });
  });
  it("names a measure that is not a positive number and a text too long, and stores nothing then", () => {
    const read = postureFromForm(form({ heathCarter: { supraspinaleSkinfoldMm: "0", flexedArmGirthCm: "abc" }, somatotypeNotes: "x".repeat(1001) }));
    expect(read).toEqual({ payload: null, problems: ["Observações do somatotipo", "Dobra supraespinhal", "Perímetro do braço flexionado e contraído"] });
  });
  it("says how many regions of each view were observed, in the tab", () => {
    const shown = form({ findings: { lateral_hip: ["anteversion"], lateral_feet: ["cavus"] } });
    expect(viewTabLabel(shown, "lateral")).toBe("Lateral · 2 de 8");
    expect(viewTabLabel(shown, "anterior")).toBe("Anterior · 0 de 4");
    expect(findingsText(region("lateral_shoulders"), ["protracted", "internal_rotation"])).toBe("Protusos e Rotação interna");
    expect(findingsText(region("lateral_shoulders"), undefined)).toBeNull();
  });
});

describe("the Revisão of the Movimento step", () => {
  const base = {
    profile: null,
    screening: draftScreening(screeningSchema.parse({})),
    composition: compositionSchema.parse({}),
    assessedOn: "2026-11-10",
    birthDate: "1999-01-01",
  };
  const movimento = (posture: unknown) => reviewDraft({ ...base, posture: postureSchema.parse(posture) }).modules.find((module) => module.key === "movimento")!;
  it("is “Não realizado” when nothing was recorded (never “alinhado”), and with no posture at all", () => {
    expect(movimento({})).toEqual({ key: "movimento", title: "Movimento", state: "not_done", lines: ["Não realizado"] });
    expect(reviewDraft(base).modules.find((module) => module.key === "movimento")?.state).toBe("not_done");
  });
  it("says what was observed per view, the somatotype as recorded, the Heath-Carter measures kept without computation, and records no result", () => {
    const review = reviewDraft({
      ...base,
      posture: postureSchema.parse({
        findings: { lateral_hip: ["anteversion"], lateral_feet: ["cavus"], posterior_spine: ["aligned"], anterior_asis: ["right_depressed"] },
        notes: { posterior: "Sem queixa" },
        somatotype: { labels: ["endomorph", "mesomorph"], heathCarter: { supraspinaleSkinfoldMm: 8.5 } },
      }),
    });
    expect(review.modules.find((module) => module.key === "movimento")).toEqual({
      key: "movimento",
      title: "Movimento",
      state: "observed",
      lines: [
        "Postura: 4 de 19 regiões observadas (lateral 2 de 8, posterior 1 de 7, anterior 1 de 4)",
        "Observações escritas: posterior",
        "Somatotipo (registro do profissional): Endomorfo e Mesomorfo",
        "Medidas para Heath-Carter guardadas, sem cálculo: dobra supraespinhal",
        "Flexiteste: chega numa próxima versão",
      ],
    });
    // No somatotype nor posture result: nothing here is computed, and nothing blocks the finalize.
    expect(review.results.map((result) => result.code)).toEqual([]);
    expect(review.notComputed).toEqual([]);
  });
  it("counts a somatotype alone as recorded, with no region observed", () => {
    expect(movimento({ somatotype: { labels: ["unclassified"] } }).lines.slice(0, 2)).toEqual([
      "Postura: nenhuma região observada",
      "Somatotipo (registro do profissional): Não classificado",
    ]);
  });
});
