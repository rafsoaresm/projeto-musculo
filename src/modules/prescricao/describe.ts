export interface DoseFields {
  sets: string | null;
  reps: string | null;
  loadInstruction: string | null;
  cadence: string | null;
  restSeconds: number | null;
  restText: string | null;
  rirMin: number | null;
  rirMax: number | null;
}

/** What the professional typed, in one line. Empty fields are simply left out. */
export function describeDose(item: DoseFields): string {
  const parts: string[] = [];
  const dose = [item.sets && `${item.sets} séries`, item.reps && `${item.reps} repetições`]
    .filter(Boolean)
    .join(" × ");
  if (dose) parts.push(dose);
  if (item.loadInstruction) parts.push(`carga: ${item.loadInstruction}`);
  if (item.cadence) parts.push(`cadência ${item.cadence}`);
  const rest = [item.restSeconds !== null ? `${item.restSeconds} s` : null, item.restText]
    .filter(Boolean)
    .join(" · ");
  if (rest) parts.push(`descanso ${rest}`);
  if (item.rirMin !== null && item.rirMax !== null)
    parts.push(item.rirMin === item.rirMax ? `RIR ${item.rirMin}` : `RIR ${item.rirMin} a ${item.rirMax}`);
  else if (item.rirMin !== null) parts.push(`RIR a partir de ${item.rirMin}`);
  else if (item.rirMax !== null) parts.push(`RIR até ${item.rirMax}`);
  return parts.join(" · ");
}

/**
 * What a reader prints for one dose (motor S8, design §5.2): the text stored when the dose was written (an engine dose, a
 * structured one), or the typed fields in one line, as for every dose before 0041. Never re-rendered from a structured dose.
 */
export const storedDoseText = (item: DoseFields & { doseText?: string | null }): string => item.doseText?.trim() || describeDose(item);

/**
 * The "Descanso (texto)" field when a dose written by the engine (it has stored text) is opened for editing: for most metrics
 * the engine also wrote the rest seconds as text ("60 s"), so keeping both would print the rest twice once the professional
 * saves a typed dose. The interval recovery ("rec. 60–90 s") is not the rest seconds and is kept. A text typed by a person (no
 * stored text) is kept as it is.
 */
export const restTextForEditing = (item: { restText: string | null; doseText?: string | null }): string =>
  item.doseText?.trim() && !(item.restText ?? "").startsWith("rec.") ? "" : (item.restText ?? "");

/** The dose fields of an edit form, as typed (text). */
export interface DoseFormText {
  sets: string;
  reps: string;
  loadInstruction: string;
  cadence: string;
  restSeconds: string;
  restText: string;
  rirMin: string;
  rirMax: string;
}

const DOSE_FORM_KEYS = ["sets", "reps", "loadInstruction", "cadence", "restSeconds", "restText", "rirMin", "rirMax"] as const;

const numberOrNull = (text: string) => (text.trim() === "" ? null : Number(text));

/**
 * What a dose edit form sends: the dose fields only when one of them changed from what the form opened with (then all of them,
 * as typed, which replaces the stored dose and its text), and the notes only when they changed. A notes-only save therefore keeps
 * the stored dose (an engine dose keeps its text, its recovery, its load basis). Nothing changed = an empty object. `copyDose`
 * sends the dose fields even unchanged (this session's dose copied, as typed, to other sessions).
 */
export function changedDoseFields(
  initial: DoseFormText & { notes: string },
  edited: DoseFormText & { notes: string },
  copyDose = false,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (copyDose || DOSE_FORM_KEYS.some((key) => edited[key] !== initial[key]))
    Object.assign(out, {
      sets: edited.sets || null,
      reps: edited.reps || null,
      loadInstruction: edited.loadInstruction || null,
      cadence: edited.cadence || null,
      restSeconds: numberOrNull(edited.restSeconds),
      restText: edited.restText || null,
      rirMin: numberOrNull(edited.rirMin),
      rirMax: numberOrNull(edited.rirMax),
    });
  if (edited.notes !== initial.notes) out.notes = edited.notes || null;
  return out;
}
