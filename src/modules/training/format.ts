/** Plan dates are calendar days (YYYY-MM-DD), not instants, so they are shown in UTC. */
export const formatCalendarDate = (date: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );
