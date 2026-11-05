/**
 * Text guards shared by every contract whose strings come from a model (the disabled post-proposal review in
 * `automatica/ai/contracts.ts` and the V4 planner). Moved here from `automatica/ai/contracts.ts` unchanged: the regexes behave
 * identically, and that file imports them back.
 *
 * Model output is untrusted data: prose is plain text rendered as React text, never HTML, never a reference, never a dose.
 */
import { normalizeText } from "@/modules/prescricao/motor/vocabulary";

/** Referência bibliográfica escrita pelo modelo (endereço, DOI, PMID, "et al.", "(2019)"): não verificável, recusada. */
export const REFERENCE_TEXT = /https?:\/\/|www\.|\bdoi\b|\b10\.\d{4,9}\/|\bpmid\b|pubmed|\bet\s+al\b|\(\s*(?:19|20)\d{2}\s*\)/i;
/**
 * Número de dose no texto: a IA não prescreve dose. Cobre séries × repetições, carga, %, RIR/RPE (antes ou depois do número),
 * séries/repetições/sets no singular e no plural, por extenso (dois a vinte; "uma série" fica de fora por ser expressão comum)
 * e descanso em segundos. O número não pode vir colado a uma letra: `T1 X3` e `X1 X2` são os apelidos do próprio resumo.
 */
const DOSE_UNIT = String.raw`(?:s[ée]ries?|sets?|repeti[çc](?:[ãa]o|[õo]es)|reps?|rir|rpe)`;
const DOSE_WORD = String.raw`(?:dois|duas|tr[êe]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|quinze|vinte)`;
export const DOSE_TEXT = new RegExp(
  [
    String.raw`(?<![\p{L}\d])\d+\s*[x×]\s*\d+`,
    String.raw`(?<![\p{L}\d])\d+(?:[.,]\d+)?\s*(?:kg|quilos?)(?![\p{L}])`,
    String.raw`(?<![\p{L}\d])\d+(?:[.,]\d+)?\s*%`,
    String.raw`(?<![\p{L}])(?:rir|rpe)\s*[:=]?\s*\d`,
    String.raw`(?<![\p{L}\d])\d+(?:[.,]\d+)?\s*(?:(?:a|-|–|até)\s*\d+\s*)?${DOSE_UNIT}(?![\p{L}])`,
    String.raw`(?<![\p{L}])${DOSE_WORD}\s+${DOSE_UNIT}(?![\p{L}])`,
    String.raw`(?<![\p{L}\d])\d+\s*(?:s|seg|segundos?)(?![\p{L}])`,
  ].join("|"),
  "iu",
);

/** Links, e-mail-like handles, markdown links, HTML tags, template/backtick syntax. */
const MARKUP_TEXT = /https?:|www\.|@|\[[^\]]*\]\([^)]*\)|<[^>]*>|[<>`]|\$\{|\{\{/i;
/** Control, bidirectional and zero-width characters. */
const HIDDEN_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/;
/** Instruction-like strings (the model's text is rendered to the professional and may be re-read by a later prompt). */
const INSTRUCTION_TEXT = /\b(?:ignore|disregard|system prompt|you are|assistant:|developer:|system:)|<\||desconsidere|a partir de agora/i;
const ALIAS_TOKEN = /(?<![A-Za-z0-9])[XTF][1-9][0-9]{0,2}(?![A-Za-z0-9])/g;

export interface ProseContext {
  /** Normalised (see `normalizeText`) values and words that identify a person or an organization record. */
  denyTokens: readonly string[];
  /** Aliases (`X1`, `T2`, `F3`) that exist in the context; any other alias-looking token is refused. */
  aliases: ReadonlySet<string>;
}

/**
 * Problems of one prose string, as codes (never the text). Empty = acceptable. The text is not changed.
 * Codes: REFERENCE_TEXT, DOSE_NUMBER, MARKUP, HIDDEN_CHARS, INSTRUCTION_TEXT, DENY_LIST, UNKNOWN_ALIAS.
 */
export function proseProblems(text: string, context: ProseContext): string[] {
  const problems: string[] = [];
  if (REFERENCE_TEXT.test(text)) problems.push("REFERENCE_TEXT");
  if (DOSE_TEXT.test(text)) problems.push("DOSE_NUMBER");
  if (MARKUP_TEXT.test(text)) problems.push("MARKUP");
  if (HIDDEN_CHARS.test(text)) problems.push("HIDDEN_CHARS");
  if (INSTRUCTION_TEXT.test(text)) problems.push("INSTRUCTION_TEXT");
  const normal = ` ${normalizeText(text).replace(/[^a-z0-9]+/g, " ")} `;
  if (context.denyTokens.some((token) => token.length > 0 && normal.includes(` ${normalizeText(token).replace(/[^a-z0-9]+/g, " ").trim()} `))) problems.push("DENY_LIST");
  for (const alias of text.match(ALIAS_TOKEN) ?? []) if (!context.aliases.has(alias)) { problems.push("UNKNOWN_ALIAS"); break; }
  return problems;
}
