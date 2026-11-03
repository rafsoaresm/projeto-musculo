/** Who manages the models of the Avaliação Física: the technical roles of the organization (slice 0.85). The repository checks it again. */
export const canManageTemplates = (role: string | null | undefined) => role === "OWNER" || role === "MANAGER" || role === "TECHNICAL";
