import {
  SURFACE_ORDER,
  SURFACES,
  navigationFor,
  type NavGroup,
  type SurfaceId,
} from "@/modules/platform/surfaces";

/** Planned modules that have an illustrated preview in the demonstration. */
const PREVIEWS: Record<SurfaceId, string[]> = {
  gestor: ["conta"],
  profissional: ["prescricao", "conta", "configuracoes", "leads", "servicos"],
  aluno: ["treino", "evolucao", "conta"],
};

export const demoPrefix = (surface: SurfaceId) => `/demonstracao/${surface}`;

export function demoNavigation(surface: SurfaceId): NavGroup[] {
  return navigationFor(surface).map((group) => ({
    ...group,
    items: group.items.map((item) =>
      PREVIEWS[surface].includes(item.slug) ? { ...item, tag: "Prévia" } : item,
    ),
  }));
}

export const demoAreas = (current: SurfaceId) =>
  SURFACE_ORDER.map((id) => ({
    label: { gestor: "Gestor", profissional: "Profissional", aluno: "Aluno" }[id],
    href: demoPrefix(id),
    current: id === current,
  }));

export const demoSurfaces = SURFACE_ORDER.map((id) => ({
  id,
  label: SURFACES[id].label,
  description: SURFACES[id].description,
  href: demoPrefix(id),
}));
