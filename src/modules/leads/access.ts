/** Who sees what, for the screens. The repositories decide again, in each statement, from the membership. */
export const canWorkLeads = (role: string) => ["OWNER", "MANAGER", "COMMERCIAL"].includes(role);
export const canManageLeads = (role: string) => ["OWNER", "MANAGER"].includes(role);
