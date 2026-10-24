import type { PlanState } from "@/db/plans";
import type { Tone } from "@/components/ui";

/**
 * Plain wording for each state. READY is a validated structure, never approval,
 * so no label here may suggest the student can already see it.
 */
export function stateLabel(state: PlanState): { text: string; tone: Tone } {
  switch (state) {
    case "DRAFT":
      return { text: "Rascunho", tone: "neutral" };
    case "READY":
      return { text: "Estrutura pronta", tone: "brand" };
    default:
      // Later lifecycle states have no screen yet; show them as they are.
      return { text: state, tone: "neutral" };
  }
}
