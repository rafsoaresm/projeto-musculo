import { redirect } from "next/navigation";

// "Planos e treinos" (handoff V4, section 5) lives at the address it always had; this one, the name the V4 gives the module, leads there.
export default function PlansAlias() {
  redirect("/profissional/prescricao");
}
