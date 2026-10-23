import type { Metadata } from "next";
import { requireStudent } from "@/modules/auth/server";
import { PortalHome } from "@/modules/portal/portal-home";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Início · Área do aluno" };

export default async function StudentHome() {
  const { links } = await requireStudent();
  return (
    <PortalHome
      links={links}
      trainingHref="/aluno/treino"
      trainingLinkLabel="Saiba o que falta para o treino aparecer aqui"
    />
  );
}
