import type { PlanState } from "@/db/plans";
import type { Tone } from "@/components/ui";

/**
 * Plain wording for each state. Only DELIVERED means the student can see it:
 * READY is a validated structure and APPROVED is still held by the professional.
 */
export function stateLabel(state: PlanState): { text: string; tone: Tone } {
  switch (state) {
    case "DRAFT":
      return { text: "Rascunho", tone: "neutral" };
    case "READY":
      return { text: "Estrutura pronta", tone: "brand" };
    case "APPROVED":
      return { text: "Aprovada, não entregue", tone: "brand" };
    case "DELIVERED":
      return { text: "Entregue ao aluno", tone: "success" };
    default:
      // Later lifecycle states have no screen yet; show them as they are.
      return { text: state, tone: "neutral" };
  }
}
