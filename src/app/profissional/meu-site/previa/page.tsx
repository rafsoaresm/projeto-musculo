import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireWorkspace } from "@/modules/auth/server";
import { getSiteMediaBucket } from "@/db/binding";
import { siteAssetsFor } from "@/db/site-assets";
import { sitesFor } from "@/db/sites";
import { Notice, PageHeading, Pill, formatDateTime } from "@/components/ui";
import { canSeeSite } from "@/modules/meu-site/access";
import { HOME, pageById, pageContent, resolveServices, type SiteContent } from "@/modules/meu-site/contracts";
import { libraryCssImages, libraryImages, previewPageUrl } from "@/modules/meu-site/image-urls";
import { diffContent } from "@/modules/meu-site/release-diff";
import { ReleaseChanges, previewHref } from "@/modules/meu-site/release-changes";
import { SiteRenderer } from "@/modules/meu-site/renderer";
import { siteNav } from "@/modules/meu-site/site-nav";
import { buildSiteCss } from "@/modules/meu-site/site-css";
import { InlineSiteStyles } from "@/modules/meu-site/site-styles";

export const dynamic = "force-dynamic";
// The preview is for the person editing: nobody indexes it, and nothing here is cached.
export const metadata: Metadata = { title: "Prévia do site", robots: { index: false, follow: false } };

/** What a query asks for: the draft, or a version by its number. Anything else is not a version. */
type Ref = { kind: "draft" } | { kind: "release"; number: number };
const DRAFT = "rascunho";
function refOf(value: string | string[] | undefined): Ref | null | undefined {
  if (value === undefined) return undefined;
  if (value === DRAFT) return { kind: "draft" };
  return typeof value === "string" && /^[1-9]\d{0,5}$/.test(value) ? { kind: "release", number: Number(value) } : null;
}
const refText = (ref: Ref) => (ref.kind === "draft" ? DRAFT : String(ref.number));
/** "a versão 3" / "o rascunho", and where a comparison starts: "da versão 3" / "do rascunho". */
const refName = (ref: Ref) => (ref.kind === "draft" ? "o rascunho" : `a versão ${ref.number}`);
const refFrom = (ref: Ref) => (ref.kind === "draft" ? "do rascunho" : `da versão ${ref.number}`);

/**
 * The page as the person sees it before it goes public, and the versions that were published: `?versao=3` is the version 3 as it was
 * published, `?desde=2` (or `rascunho`) says what changed since another version, with the blocks marked on the page, and `?pagina=` is the page
 * of the site that is shown. Nothing here changes the site: it only reads, with the access of whoever may read the site.
 */
export default async function SitePreview({ searchParams }: { searchParams: Promise<{ versao?: string | string[]; desde?: string | string[]; pagina?: string | string[] }> }) {
  const { db, context, workspace } = await requireWorkspace();
  if (!canSeeSite(workspace.role)) redirect("/profissional/meu-site");
  const sites = sitesFor(db, context);
  const overview = await sites.overview();
  if (!overview) redirect("/profissional/meu-site");
  const params = await searchParams;
  const wanted = refOf(params.versao);
  const since = refOf(params.desde);
  // A version that is not valid, or that this site does not have, is not a page of its own: the preview goes back to the draft.
  if (wanted === null || since === null) redirect("/profissional/meu-site/previa");

  const live = new Map(overview.services.map((service) => [service.id, service]));
  const draft: SiteContent = resolveServices(overview.draft.content, live);
  const load = async (ref: Ref) => (ref.kind === "draft" ? { content: draft, release: null } : { content: null, release: await sites.release(ref.number) });
  const shownRef: Ref = wanted ?? { kind: "draft" };
  const shownLoaded = await load(shownRef);
  const shownContent = shownRef.kind === "draft" ? draft : shownLoaded.release?.content;
  if (!shownContent) redirect("/profissional/meu-site/previa");
  const release = shownLoaded.release;
  const sinceRef = since && refText(since) !== refText(shownRef) ? since : undefined;
  const sinceLoaded = sinceRef ? await load(sinceRef) : null;
  const sinceContent = sinceRef ? (sinceRef.kind === "draft" ? draft : sinceLoaded?.release?.content) : undefined;
  if (sinceRef && !sinceContent) redirect("/profissional/meu-site/previa");
  const diff = sinceContent ? diffContent(sinceContent, shownContent) : null;

  const library = await siteAssetsFor(db, await getSiteMediaBucket(), context).list();
  const asked = params.pagina;
  const current = typeof asked === "string" && pageById(shownContent, asked) ? asked : HOME;
  const keep = { versao: wanted ? refText(wanted) : undefined, desde: sinceRef ? refText(sinceRef) : undefined };
  const nav = siteNav(shownContent, current, (target) => previewPageUrl(target === HOME ? null : target, keep));
  const others = overview.releases.filter((entry) => shownRef.kind !== "release" || entry.number !== shownRef.number);

  return (
    <>
      <PageHeading
        eyebrow="Meu Site"
        title={release ? `Versão ${release.number}` : "Prévia do rascunho"}
        description={
          release
            ? `Como foi publicada em ${formatDateTime(release.createdAt)}${release.createdByName ? ` por ${release.createdByName}` : ""}. Ninguém vê esta tela.`
            : "É assim que a página aparece com o que está salvo no rascunho. Ninguém vê esta tela."
        }
        aside={
          <Link className="button secondary" href="/profissional/meu-site">
            <ArrowLeft size={20} />
            {release ? "Voltar às versões" : "Voltar ao editor"}
          </Link>
        }
      />
      {release ? (
        <Notice>
          <p>
            {release.live ? <Pill tone="success">No ar</Pill> : null} Esta é a versão {release.number} como foi publicada: o que foi mudado depois não aparece aqui. Para voltar a ela,
            use “Usar como rascunho” na lista de versões.
          </p>
        </Notice>
      ) : (
        <Notice>
          <p>Prévia: os botões de contato funcionam, mas o site só vai ao ar quando você publicar. O que ainda não foi salvo no editor não aparece aqui.</p>
        </Notice>
      )}
      <nav className="panel release-compare" aria-label="Comparar versões">
        <p className="small">
          <strong>O que mudou desde:</strong>{" "}
          {others.map((entry) => (
            <span key={entry.number}>
              <Link
                href={previewHref({ versao: keep.versao, desde: String(entry.number), pagina: current === HOME ? null : current })}
                aria-current={sinceRef?.kind === "release" && sinceRef.number === entry.number ? "true" : undefined}
              >
                versão {entry.number}
              </Link>{" "}
            </span>
          ))}
          {shownRef.kind === "release" && (
            <Link href={previewHref({ versao: keep.versao, desde: DRAFT, pagina: current === HOME ? null : current })} aria-current={sinceRef?.kind === "draft" ? "true" : undefined}>
              o rascunho
            </Link>
          )}
          {sinceRef && (
            <>
              {" "}
              <Link href={previewHref({ versao: keep.versao, pagina: current === HOME ? null : current })}>não comparar</Link>
            </>
          )}
          {!sinceRef && others.length === 0 && shownRef.kind === "draft" && <span className="muted">Nenhuma versão foi publicada ainda.</span>}
        </p>
      </nav>
      {diff && sinceRef && (
        <section className="panel" aria-labelledby="mudancas">
          <h2 id="mudancas">
            O que mudou {refFrom(sinceRef)} para {refName(shownRef)}
          </h2>
          <ReleaseChanges diff={diff} shown={shownContent} target={keep} />
        </section>
      )}
      <div className="site-preview" aria-label={release ? `Versão ${release.number} da página` : "Prévia da página"}>
        <InlineSiteStyles css={buildSiteCss(shownContent, libraryCssImages(null, library))} />
        <SiteRenderer content={pageContent(shownContent, current)} images={libraryImages(null, library)} nav={nav} marks={diff?.marks} />
      </div>
    </>
  );
}
