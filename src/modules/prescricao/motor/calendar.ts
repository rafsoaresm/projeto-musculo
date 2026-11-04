/** Datas sem fuso: AAAA-MM-DD, aritmética em UTC ao meio-dia. */
export function dateAdd(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function validDate(date: unknown): date is string {
  return (
    typeof date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(Date.parse(`${date}T00:00:00.000Z`)) &&
    dateAdd(date, 0) === date
  );
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00.000Z`) - Date.parse(`${from}T12:00:00.000Z`)) / 86_400_000);
}

export interface PhaseCalendarSpec {
  weeks: number;
  sessionsPerWeek: number;
  /** Ordem dos treinos (rótulos) que se repete ao longo da fase. */
  rotation: string[];
  /** Dias da semana (0 = primeiro dia da semana da fase) de cada sessão; ausente = datas não previstas. */
  trainingDays?: number[] | null;
}

export interface CalendarOccurrence {
  week: number;
  slot: number;
  label: string;
  plannedDate: string | null;
  weekStart: string;
}

/**
 * Calendário de uma periodização: uma ocorrência por sessão de cada semana, girando os rótulos.
 * Sem `trainingDays`, a data prevista fica vazia (nunca inventada). É o formato que a
 * estrutura v2 grava e que o adaptador entrega ao motor.
 */
export function scheduleOccurrences(startDate: string, phases: PhaseCalendarSpec[]): CalendarOccurrence[][] {
  let cursor = startDate;
  return phases.map((phase) => {
    const out: CalendarOccurrence[] = [];
    for (let week = 1; week <= phase.weeks; week++) {
      const weekStart = dateAdd(cursor, (week - 1) * 7);
      for (let slot = 1; slot <= phase.sessionsPerWeek; slot++) {
        const label = phase.rotation.length ? phase.rotation[((week - 1) * phase.sessionsPerWeek + slot - 1) % phase.rotation.length] : "";
        const day = phase.trainingDays?.[slot - 1];
        out.push({ week, slot, label, plannedDate: day === undefined ? null : dateAdd(weekStart, day), weekStart });
      }
    }
    cursor = dateAdd(cursor, phase.weeks * 7);
    return out;
  });
}
