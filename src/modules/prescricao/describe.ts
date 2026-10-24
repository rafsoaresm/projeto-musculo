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
