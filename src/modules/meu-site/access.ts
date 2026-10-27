/** Who sees what, for the screens. The repository decides again, in each statement, from the membership. */
export const canSeeSite = (role: string) => ["OWNER", "MANAGER", "COMMERCIAL"].includes(role);
export const canEditSite = (role: string) => ["OWNER", "MANAGER"].includes(role);
