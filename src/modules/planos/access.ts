/**
 * Who prescribes: the technical roles, the same ones `technicalAccessExists` (src/db/students.ts) accepts for a student's plans.
 * This only decides whether "Novo plano" is offered; every read and write is still checked in the repositories.
 */
export const canPrescribe = (role: string | null | undefined) =>
  role === "OWNER" || role === "MANAGER" || role === "TECHNICAL";
