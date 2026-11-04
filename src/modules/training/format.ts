/** Plan dates are calendar days (YYYY-MM-DD), not instants, so they are shown in UTC. */
export const formatCalendarDate = (date: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );

/** "Treino A", or "Treino A · Superior" when a v2 workout has a name. */
export const workoutTitle = (label: string, name?: string | null) =>
  name ? `Treino ${label} · ${name}` : `Treino ${label}`;

/** "Fase 01", or "Fase 01 · Adaptação" when a v2 phase has a name. */
export const phaseTitle = (index: number, name?: string | null) =>
  `Fase ${String(index).padStart(2, "0")}${name ? ` · ${name}` : ""}`;

/** " · divisão ABC" for the phase line; nothing for a single Full Body (as plans showed before v2). */
export const divisionSuffix = (split: string) => (split === "Full Body" ? "" : ` · divisão ${split}`);
