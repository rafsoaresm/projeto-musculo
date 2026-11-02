import Link from "next/link";
import { Pill } from "@/components/ui";
import type { SiteOverview } from "@/db/sites";
import { PublicAddress } from "./public-address";
import { publicStatus } from "./public-status";
import { EditSiteButton } from "./edit-site-button";

const EDITOR = { native: "Editor Guiado", frappe: "Editor Avançado" } as const;

/**
 * The top of the management of the site (handoff V4, Figma `10:76` and `10:119`): which editor the site is tied to, whether anyone can see
 * it, one way into the editor, and the card that says the editor is fixed. The state comes from `publicStatus`, the one rule every screen uses.
 */
export function SiteHeader({ overview, canEdit }: { overview: SiteOverview; canEdit: boolean }) {
  const { engine, engineFixed, slug } = overview.site;
  const status = publicStatus({ engine, guidedLive: overview.live !== null, advancedPublished: overview.newEditor.published.length });
  return (
    <>
      <div className="site-head">
        <ul className="count-chips" aria-label="Editor e situação do site">
          <li>{EDITOR[engine].toUpperCase()}</li>
          <li>{status.label}</li>
        </ul>
        {canEdit &&
          (engine === "frappe" ? (
            <Link className="button primary" href="/profissional/meu-site/editor">
              Abrir Frappe Builder
            </Link>
          ) : (
            <EditSiteButton />
          ))}
      </div>
      <section className="panel" aria-labelledby="site-profissional">
        <div className="panel-title">
          <h2 id="site-profissional">Site profissional</h2>
          <Pill tone="neutral">{engineFixed ? "Editor fixo" : "Criado antes da escolha fixa"}</Pill>
        </div>
        <p className="muted">
          {engine === "frappe"
            ? "Este projeto está vinculado ao Editor Avançado (Frappe Builder)."
            : "Seu projeto foi criado no Editor Guiado e permanece vinculado a ele."}
          {!engineFixed && " Ele é anterior à escolha fixa do editor: a gestão da plataforma confere o conteúdo de cada editor antes de qualquer mudança."}
        </p>
        <p>{status.detail}</p>
        <p className="small">
          {status.live ? (
            <>
              Endereço público: <PublicAddress slug={slug} />
            </>
          ) : (
            "Endereço: ainda não publicado"
          )}
        </p>
      </section>
    </>
  );
}
