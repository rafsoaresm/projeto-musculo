import Link from "next/link";
import { Notice } from "@/components/ui";
import { KillSwitchCard } from "./ai-kill-switch";
import { TABS, panelBanners, type PanelFacts, type TabSlug } from "./ai-view";

/**
 * The frame of the gestor's AI panel: what is switched off and why (in order), the general switch, the honest notice about what is sent
 * and what it costs, and the tabs. Server component; the tabs are links, so the panel works on every mount path.
 */
export function AiPanelFrame({
  tab, facts, kill, children,
}: { tab: TabSlug; facts: PanelFacts; kill: { byEmail: string | null; at: string | null }; children: React.ReactNode }) {
  return (
    <>
      {panelBanners(facts).map((banner) => (
        <Notice key={banner.id} tone={banner.tone}>
          <p>{banner.text}</p>
        </Notice>
      ))}
      <Notice>
        <p>
          <strong>O que a IA recebe.</strong> Só um resumo codificado e anonimizado do aluno: sem nome, contato, documentos, endereço, data de nascimento (usa-se faixa etária), datas exatas, textos livres nem fotos; exercícios, planos e pessoas viram códigos. Codificar reduz o risco de reidentificação, mas não garante que ela seja impossível.{" "}
          <strong>O que custa.</strong> Os tokens são medidos e limitados por plano; o custo só aparece quando você digita o preço do modelo, e sem preço é “desconhecido”, nunca estimado.
        </p>
      </Notice>
      <KillSwitchCard on={facts.panelKill} byEmail={kill.byEmail} at={kill.at} canWrite={facts.canWrite} />
      <nav className="terms-tabs" aria-label="Seções da inteligência artificial">
        {TABS.map((t) => (
          <Link
            key={t.slug}
            href={`/gestor/inteligencia-artificial?aba=${t.slug}`}
            className={`button ${t.slug === tab ? "primary" : "secondary"}`}
            aria-current={t.slug === tab ? "page" : undefined}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {children}
    </>
  );
}
