/**
 * The posture and somatotype of the "Movimento" step (handoff V2 section 3.3, Figma AV-05), stored as the module "posture" of the draft (page 3 of
 * the PDF: "Somatotipo e avaliação postural"), saved with the assessment's revision like the other modules.
 *
 * - Posture: for each region of each view (lateral, posterior, anterior), the findings observed, the side of a paired region, and a note per
 *   view. A region with no finding was not observed: it is absent, never "alinhado" by default. These are postural observations, not a clinical
 *   diagnosis (handoff 3.3).
 * - Somatotype: the professional's own record (manual), with a note; never inferred from a photo. The Heath-Carter measures that page 2 lacks are
 *   kept as typed; the somatotype is not computed (the handoff gives no equation nor constant for it, and puts the full method in P2).
 *
 * Pure: no screen and no database here, so the server checks a save with the same rules the screen uses. Nothing here classifies anything.
 */
import { z } from "zod";
import {
  HEATH_CARTER_CODES,
  HEATH_CARTER_MEASURES,
  LATERALITIES,
  LATERALITY_CODES,
  POSTURE_REGIONS,
  POSTURE_REGION_BY_KEY,
  POSTURE_REGION_KEYS,
  POSTURE_VIEWS,
  POSTURE_VIEW_CODES,
  POSTURE_VIEW_SHORT,
  SOMATOTYPES,
  SOMATOTYPE_ALONE,
  SOMATOTYPE_CODES,
  postureRegionKey,
  type HeathCarterMeasure,
  type LateralityCode,
  type PostureRegion,
  type PostureRegionKey,
  type PostureView,
  type SomatotypeCode,
} from "../catalog";
import { parseDecimal } from "../formulas";
import { MAX_MEASURE } from "./composition";
import { MAX_TEXT } from "./screening";

export const POSTURE_MODULE = "posture" as const;

const text = z.string().max(MAX_TEXT).default("");
const measure = z.number().finite().positive().max(MAX_MEASURE).nullable().default(null);

/**
 * Why a region's findings are not accepted, or null: every finding is one of the region's, none repeated, at least one (a region not observed is
 * absent), only one for a single choice, and the neutral finding ("alinhado"...) never together with another.
 */
export function findingsProblem(region: PostureRegion, findings: readonly string[]): string | null {
  if (findings.length === 0) return "empty";
  if (new Set(findings).size !== findings.length) return "repeated";
  // Own keys only: `in` would also take what every object inherits ("constructor", "toString"...).
  if (findings.some((finding) => !Object.hasOwn(region.findings, finding))) return "unknown";
  if (!region.multiple && findings.length > 1) return "single";
  if (region.neutral !== null && findings.length > 1 && findings.includes(region.neutral)) return "neutral";
  return null;
}

const findingsSchema = z
  .partialRecord(z.enum(POSTURE_REGION_KEYS), z.array(z.string().max(40)).max(8))
  .superRefine((record, context) => {
    for (const [key, findings] of Object.entries(record) as [PostureRegionKey, string[] | undefined][]) {
      if (findings === undefined) continue;
      const problem = findingsProblem(POSTURE_REGION_BY_KEY[key], findings);
      if (problem) context.addIssue({ code: "custom", path: [key], message: problem });
    }
  })
  .default({});

/** A finding that says something deviates (not the neutral one): only then a side may be recorded. */
const deviates = (region: PostureRegion, findings: readonly string[] | undefined) => (findings ?? []).some((finding) => finding !== region.neutral);

const somatotypeLabels = z
  .array(z.enum(SOMATOTYPE_CODES))
  .max(SOMATOTYPE_CODES.length)
  .refine((labels) => new Set(labels).size === labels.length, "repeated")
  .refine((labels) => labels.length <= 1 || !labels.some((label) => SOMATOTYPE_ALONE.includes(label)), "alone")
  .default([]);

export const postureSchema = z
  .object({
    /** The findings of each region observed (handoff 3.3: `findings[]` per `view` and `region`); a region not observed is absent. */
    findings: findingsSchema,
    /** The side of a sided region's findings (handoff 3.3: `laterality?`); only with a finding that is not the neutral one. */
    laterality: z.partialRecord(z.enum(POSTURE_REGION_KEYS), z.enum(LATERALITY_CODES)).default({}),
    /** A note per view (handoff 3.3: `notes?`), for what the findings and the side do not say (a degree, one side unlike the other). */
    notes: z.object({ lateral: text, posterior: text, anterior: text }).strict().default({ lateral: "", posterior: "", anterior: "" }),
    /** Handoff 6: `somatotype: { method: "manual" | "heath_carter"; labels; notes }`. Only "manual" in this version. */
    somatotype: z
      .object({
        method: z.literal("manual").default("manual"),
        labels: somatotypeLabels,
        notes: text,
        /** The measures of Heath-Carter that page 2 lacks, kept as measured (none is computed). Not measured is null, never 0. */
        heathCarter: z
          .object({ supraspinaleSkinfoldMm: measure, flexedArmGirthCm: measure })
          .strict()
          .default({ supraspinaleSkinfoldMm: null, flexedArmGirthCm: null }),
      })
      .strict()
      .default({ method: "manual", labels: [], notes: "", heathCarter: { supraspinaleSkinfoldMm: null, flexedArmGirthCm: null } }),
  })
  .strict()
  .superRefine((payload, context) => {
    for (const [key, side] of Object.entries(payload.laterality) as [PostureRegionKey, LateralityCode | undefined][]) {
      if (side !== undefined && !takesSide(POSTURE_REGION_BY_KEY[key], payload.findings[key]))
        context.addIssue({ code: "custom", path: ["laterality", key], message: "laterality" });
    }
  });
export type PosturePayload = z.infer<typeof postureSchema>;
export const EMPTY_POSTURE: PosturePayload = postureSchema.parse({});

/** What was stored, read back; anything unknown or invalid reads as the empty module (never as a guess). */
export function readPosture(raw: unknown): PosturePayload {
  const parsed = postureSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : EMPTY_POSTURE;
}

/* ---------- The regions ---------- */

export const regionsOf = (view: PostureView): PostureRegion[] => POSTURE_REGIONS.filter((region) => region.view === view);
export const findingCodes = (region: PostureRegion) => Object.keys(region.findings);

/**
 * A finding checked or unchecked on the screen, as the region allows: a single choice takes only the one; the neutral finding clears the others,
 * and another finding clears the neutral one. The result keeps the order of the handoff's list.
 */
export function toggleFinding(region: PostureRegion, current: readonly string[], finding: string, checked: boolean): string[] {
  let next: string[];
  if (!checked) next = current.filter((item) => item !== finding);
  else if (!region.multiple || finding === region.neutral) next = [finding];
  else next = [...current.filter((item) => item !== region.neutral && item !== finding), finding];
  return findingCodes(region).filter((code) => next.includes(code));
}

/** The somatotype labels after one is checked or unchecked: "Misto" and "Não classificado" stand alone. Kept in the catalog's order. */
export function toggleSomatotype(current: readonly SomatotypeCode[], label: SomatotypeCode, checked: boolean): SomatotypeCode[] {
  let next: SomatotypeCode[];
  if (!checked) next = current.filter((item) => item !== label);
  else if (SOMATOTYPE_ALONE.includes(label)) next = [label];
  else next = [...current.filter((item) => !SOMATOTYPE_ALONE.includes(item) && item !== label), label];
  return SOMATOTYPE_CODES.filter((code) => next.includes(code));
}

/** A side may be recorded for this region with these findings: a sided region, with a finding that is not the neutral one. */
export function takesSide(region: PostureRegion, findings: readonly string[] | undefined): boolean {
  return region.sided && deviates(region, findings);
}

const lowerFirst = (label: string) => label.charAt(0).toLowerCase() + label.slice(1);

/** The findings of a region as a sentence ("Protusos e rotação interna (lado esquerdo)"), or null when not observed. */
export function findingsText(region: PostureRegion, findings: readonly string[] | undefined, side?: LateralityCode): string | null {
  if (!findings || findings.length === 0) return null;
  const labels = findings.map((finding) => (Object.hasOwn(region.findings, finding) ? (region.findings as Record<string, string>)[finding]! : finding));
  const text = list(labels.map((label, index) => (index === 0 ? label : lowerFirst(label))));
  return side && takesSide(region, findings) ? `${text} (${lowerFirst(LATERALITIES[side])})` : text;
}

const list = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`);

/** How many regions of a view have a finding. */
export const observedIn = (payload: Pick<PosturePayload, "findings">, view: PostureView) =>
  regionsOf(view).filter((region) => (payload.findings[postureRegionKey(region)] ?? []).length > 0).length;

/** "Lateral · 3 de 8": the name of a view's tab, with how many of its regions were observed. */
export const viewTabLabel = (payload: Pick<PosturePayload, "findings">, view: PostureView) => `${POSTURE_VIEW_SHORT[view]} · ${viewTabCount(payload, view)}`;
/** The count of a view's tab ("3 de 8"), kept on one line on the screen. */
export const viewTabCount = (payload: Pick<PosturePayload, "findings">, view: PostureView) => `${observedIn(payload, view)} de ${regionsOf(view).length}`;
/** The tab's name for a screen reader, starting with the words it shows: "Lateral, 3 de 8 regiões observadas". */
export const viewTabName = (payload: Pick<PosturePayload, "findings">, view: PostureView) => `${POSTURE_VIEW_SHORT[view]}, ${viewTabCount(payload, view)} regiões observadas`;

/* ---------- The screen's form ---------- */

export interface PostureForm {
  findings: Partial<Record<PostureRegionKey, string[]>>;
  /** The side chosen for a sided region; dropped on save when the region has no finding that takes a side. */
  laterality: Partial<Record<PostureRegionKey, LateralityCode>>;
  notes: Record<PostureView, string>;
  somatotype: SomatotypeCode[];
  somatotypeNotes: string;
  /** The Heath-Carter measures, as typed. */
  heathCarter: Record<HeathCarterMeasure, string>;
}

const decimalText = (value: number | null) => (value === null ? "" : String(value).replace(".", ","));

export function postureFormFrom(payload: PosturePayload): PostureForm {
  return {
    findings: { ...payload.findings },
    laterality: { ...payload.laterality },
    notes: { ...payload.notes },
    somatotype: [...payload.somatotype.labels],
    somatotypeNotes: payload.somatotype.notes,
    heathCarter: {
      supraspinaleSkinfoldMm: decimalText(payload.somatotype.heathCarter.supraspinaleSkinfoldMm),
      flexedArmGirthCm: decimalText(payload.somatotype.heathCarter.flexedArmGirthCm),
    },
  };
}

export type PostureReading = { payload: PosturePayload; problems: [] } | { payload: null; problems: string[] };

/** The note of a view, named for a refused save. */
export const notesLabel = (view: PostureView) => `Observações da ${POSTURE_VIEWS[view].toLowerCase()}`;
export const SOMATOTYPE_NOTES_LABEL = "Observações do somatotipo";

/**
 * The screen as the payload to store. A measure that is not a positive number, or a text above the technical ceiling, is a problem named by its
 * field, never a 0 or a cut text. A region with no finding is left out (not observed).
 */
export function postureFromForm(form: PostureForm): PostureReading {
  const problems: string[] = [];
  const checkText = (value: string, name: string) => {
    if (value.length > MAX_TEXT) problems.push(name);
    return value;
  };
  const readMeasure = (code: HeathCarterMeasure) => {
    const typed = form.heathCarter[code] ?? "";
    if (typed.trim() === "") return null;
    const value = parseDecimal(typed);
    if (value === null || !Number.isFinite(value) || value <= 0 || value > MAX_MEASURE) {
      problems.push(HEATH_CARTER_MEASURES[code].label);
      return null;
    }
    return value;
  };
  const findings: Partial<Record<PostureRegionKey, string[]>> = {};
  for (const key of POSTURE_REGION_KEYS) {
    const typed = form.findings[key] ?? [];
    if (typed.length > 0) findings[key] = findingCodes(POSTURE_REGION_BY_KEY[key]).filter((code) => typed.includes(code));
  }
  const laterality: Partial<Record<PostureRegionKey, LateralityCode>> = {};
  for (const key of POSTURE_REGION_KEYS) {
    const side = form.laterality[key];
    if (side && takesSide(POSTURE_REGION_BY_KEY[key], findings[key])) laterality[key] = side;
  }
  const candidate = {
    findings,
    laterality,
    notes: Object.fromEntries(POSTURE_VIEW_CODES.map((view) => [view, checkText(form.notes[view] ?? "", notesLabel(view))])),
    somatotype: {
      method: "manual" as const,
      labels: SOMATOTYPE_CODES.filter((code) => form.somatotype.includes(code)),
      notes: checkText(form.somatotypeNotes, SOMATOTYPE_NOTES_LABEL),
      heathCarter: Object.fromEntries(HEATH_CARTER_CODES.map((code) => [code, readMeasure(code)])),
    },
  };
  if (problems.length > 0) return { payload: null, problems };
  const parsed = postureSchema.safeParse(candidate);
  // The screen only builds what the schema takes (toggleFinding, toggleSomatotype); a refusal here is named as the whole step.
  if (!parsed.success) return { payload: null, problems: issueNames(parsed.error.issues) };
  return { payload: parsed.data, problems: [] };
}

/** The names of the fields a refused payload has wrong (a check on the server, where the payload did not come from this screen). */
export function issueNames(issues: readonly { path: readonly PropertyKey[] }[]): string[] {
  const names = new Set<string>();
  for (const issue of issues) {
    const [first, second, third] = issue.path.map(String);
    if ((first === "findings" || first === "laterality") && second && Object.hasOwn(POSTURE_REGION_BY_KEY, second)) {
      const region = POSTURE_REGION_BY_KEY[second as PostureRegionKey];
      names.add(`${region.label} (${POSTURE_VIEWS[region.view].toLowerCase()})`);
    } else if (first === "notes" && second && (POSTURE_VIEW_CODES as readonly string[]).includes(second)) names.add(notesLabel(second as PostureView));
    else if (first === "somatotype" && second === "heathCarter" && third && Object.hasOwn(HEATH_CARTER_MEASURES, third))
      names.add(HEATH_CARTER_MEASURES[third as HeathCarterMeasure].label);
    else if (first === "somatotype" && second === "notes") names.add(SOMATOTYPE_NOTES_LABEL);
    else if (first === "somatotype") names.add("Somatotipo");
  }
  return [...names];
}

/** The message of a refused save, naming the fields. */
export const postureProblemsMessage = (problems: string[]) =>
  problems.length === 0
    ? "Confira a postura e o somatotipo: algum valor não é aceito."
    : `Confira ${problems.length === 1 ? "o campo" : "os campos"} ${problems.join(", ")}: as medidas são números positivos (por exemplo, 12,5), cada achado vale para a sua região e cada texto tem até ${MAX_TEXT} caracteres.`;

/* ---------- What the step holds, in words (Revisão and the record) ---------- */

/** The somatotype in words ("Endomorfo e Mesomorfo"), or null when not recorded. */
export const somatotypeText = (labels: readonly SomatotypeCode[]) => (labels.length === 0 ? null : list(labels.map((code) => SOMATOTYPES[code])));

/** Any Heath-Carter measure typed. */
export const heathCarterTyped = (payload: PosturePayload) => HEATH_CARTER_CODES.filter((code) => payload.somatotype.heathCarter[code] !== null);

/** The line said wherever the somatotype shows: it is not computed (the handoff gives no equation nor constant; the full method is P2). */
export const HEATH_CARTER_NOTE =
  "O somatotipo Heath-Carter não é calculado nesta versão: o método ainda não foi validado para uso aqui. As medidas ficam guardadas como foram aferidas.";

/** Nothing in the module (no finding, note, somatotype nor measure): the step reads as "Não realizado". */
export function postureEmpty(payload: PosturePayload): boolean {
  return (
    Object.values(payload.findings).every((findings) => !findings || findings.length === 0) &&
    POSTURE_VIEW_CODES.every((view) => payload.notes[view].trim() === "") &&
    payload.somatotype.labels.length === 0 &&
    payload.somatotype.notes.trim() === "" &&
    heathCarterTyped(payload).length === 0
  );
}
