/**
 * The words that say who delivered (or recorded) something, from the names stored at that moment (slice 0.90): " por Ana (Estúdio X)",
 * " por Ana", " (Estúdio X)" or "" when neither is known. Starts with a space when not empty, so it follows a date ("Entregue em 03/11/2026").
 * An unknown name is left out, never replaced by a made-up one.
 */
export function deliveredByText(professionalName: string | null | undefined, organizationName: string | null | undefined): string {
  const who = professionalName?.trim() ? ` por ${professionalName.trim()}` : "";
  const where = organizationName?.trim() ? ` (${organizationName.trim()})` : "";
  return `${who}${where}`;
}
