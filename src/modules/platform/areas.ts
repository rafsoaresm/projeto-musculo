import {
  SURFACES,
  SURFACE_ORDER,
  type SurfaceId,
} from "./surfaces";

const SHORT_LABEL: Record<SurfaceId, string> = {
  gestor: "Gestor",
  profissional: "Profissional",
  aluno: "Aluno",
};

/** Links to the other areas a person may enter. Empty with a single area. */
export function areaLinks(allowed: SurfaceId[], current: SurfaceId) {
  if (allowed.length < 2) return [];
  return SURFACE_ORDER.filter((id) => allowed.includes(id)).map((id) => ({
    label: SHORT_LABEL[id],
    href: SURFACES[id].home,
    current: id === current,
  }));
}

export const MEMBERSHIP_ROLE_LABEL: Record<string, string> = {
  OWNER: "Proprietário",
  MANAGER: "Gestão",
  TECHNICAL: "Técnico",
  COMMERCIAL: "Comercial",
  FINANCE: "Financeiro",
};
