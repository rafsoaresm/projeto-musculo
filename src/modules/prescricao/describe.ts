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
 * The "Descanso (texto)" field when a dose written by the engine (it has stored text) is opened for editing: the engine also
 * wrote the rest seconds as text, so keeping both would print the rest twice once the professional saves. A text typed by a
 * person (no stored text) is kept as it is.
 */
export const restTextForEditing = (item: { restText: string | null; doseText?: string | null }): string =>
  item.doseText?.trim() ? "" : (item.restText ?? "");
