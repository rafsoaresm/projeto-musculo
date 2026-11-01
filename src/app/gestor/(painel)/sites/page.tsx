import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/modules/auth/server";
import { hasContentInBoth, platformFor } from "@/db/platform";
import { Notice, PageHeading, Pill } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sites e editores · Gestor" };

const ENGINE = { native: "Editor Guiado", frappe: "Editor Avançado" } as const;

/** The survey asked by decision D1 of the handoff V4: which editor each site uses and where it has content, before the editor becomes fixed. */
export default async function SiteEditors() {
  const { db, context } = await requirePlatformAdmin();
  const rows = await platformFor(db, context).listSiteEditors();
  const both = rows.filter(hasContentInBoth);
  return (
    <>
      <PageHeading
        eyebrow="PLATAFORMA"
        title="Sites e editores"
        description="Qual editor cada site usa e onde ele tem conteúdo. Só contagens: nada do conteúdo é aberto aqui."
      />
      <Notice>
        <p>
          {both.length === 0
            ? "Nenhum site tem conteúdo nos dois editores."
            : both.length === 1
              ? "1 site tem conteúdo nos dois editores. Ele precisa de uma decisão antes de o editor ficar fixo."
              : `${both.length} sites têm conteúdo nos dois editores. Eles precisam de uma decisão antes de o editor ficar fixo.`}
        </p>
      </Notice>
      <section className="panel">
        {rows.length === 0 ? (
          <div className="empty-inline">
            <h3>Nenhum site criado ainda.</h3>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Espaço</th>
                  <th scope="col">Endereço</th>
                  <th scope="col">Endereço principal mostra</th>
                  <th scope="col">Editor Guiado</th>
                  <th scope="col">Editor Avançado</th>
                  <th scope="col">Situação</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.slug}>
                    <td>{row.organizationName}</td>
                    <td>
                      <code>{row.slug}</code>
                    </td>
                    <td>{ENGINE[row.engine]}</td>
                    <td>
                      {row.guidedSaves > 1 || row.guidedReleases > 0
                        ? `${row.guidedSaves - 1} gravações, ${row.guidedReleases} versões publicadas${row.guidedLive ? ", no ar" : ""}`
                        : "Sem conteúdo além do início"}
                    </td>
                    <td>{row.advancedPages > 0 ? `${row.advancedPages} páginas, ${row.advancedPublished} publicadas` : "Sem páginas"}</td>
                    <td>{hasContentInBoth(row) ? <Pill tone="warning">Conteúdo nos dois</Pill> : <Pill tone="neutral">Um editor</Pill>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
