/**
 * The final considerations of the "Revisão" step (handoff V2 section 3.5, "Considerações finais"; Figma AV-06), stored as the module "conclusion"
 * of the draft, saved with the assessment's revision like the other modules: the professional's text, recommendations, limitations observed and
 * guidance or referrals. Free text written by the professional; the system adds nothing to it and approves nothing. The institutional disclaimer of
 * the report ("não equivale a exame médico") is not here: the handoff asks for a text reviewed by whoever is responsible, which it does not give.
 *
 * Pure: no screen and no database here.
 */
import { z } from "zod";

export const CONCLUSION_MODULE = "conclusion" as const;
/** The technical ceiling of each text (a longer free text than the other steps' notes; the module stays far below the 64 000 of a section). */
export const MAX_CONCLUSION_TEXT = 4000;

export const CONCLUSION_FIELDS = ["considerations", "recommendations", "limitations", "referrals"] as const;
export type ConclusionField = (typeof CONCLUSION_FIELDS)[number];
export const CONCLUSION_LABEL: Record<ConclusionField, string> = {
  considerations: "Considerações finais",
  recommendations: "Recomendações",
  limitations: "Limitações observadas",
  referrals: "Orientações e encaminhamentos",
};

const text = z.string().max(MAX_CONCLUSION_TEXT).default("");
export const conclusionSchema = z.object({ considerations: text, recommendations: text, limitations: text, referrals: text }).strict();
export type ConclusionPayload = z.infer<typeof conclusionSchema>;
export const EMPTY_CONCLUSION: ConclusionPayload = conclusionSchema.parse({});

export function readConclusion(raw: unknown): ConclusionPayload {
  const parsed = conclusionSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : EMPTY_CONCLUSION;
}

export const conclusionEmpty = (payload: ConclusionPayload) => CONCLUSION_FIELDS.every((field) => payload[field].trim() === "");

export type ConclusionForm = ConclusionPayload;
export type ConclusionReading = { payload: ConclusionPayload; problems: [] } | { payload: null; problems: string[] };

/** The screen as the payload to store; a text above the ceiling is named, never cut. */
export function conclusionFromForm(form: ConclusionForm): ConclusionReading {
  const problems = CONCLUSION_FIELDS.filter((field) => form[field].length > MAX_CONCLUSION_TEXT).map((field) => CONCLUSION_LABEL[field]);
  if (problems.length > 0) return { payload: null, problems };
  return { payload: conclusionSchema.parse(form), problems: [] };
}

export function conclusionIssueNames(issues: readonly { path: readonly PropertyKey[] }[]): string[] {
  const names = new Set<string>();
  for (const issue of issues) {
    const [first] = issue.path.map(String);
    names.add((CONCLUSION_FIELDS as readonly string[]).includes(first ?? "") ? CONCLUSION_LABEL[first as ConclusionField] : "Considerações finais");
  }
  return [...names];
}

export const conclusionProblemsMessage = (problems: string[]) =>
  problems.length === 0
    ? "Confira as considerações finais: algum texto não é aceito."
    : `Confira ${problems.length === 1 ? "o campo" : "os campos"} ${problems.join(", ")}: cada texto tem até ${MAX_CONCLUSION_TEXT} caracteres.`;
