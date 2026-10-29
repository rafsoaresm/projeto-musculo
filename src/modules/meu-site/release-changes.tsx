import Link from "next/link";
import { HOME, pageById, pagesOf, type SiteContent } from "./contracts";
import { MAX_CHANGES, NO_CHANGES, capped, type Diff } from "./release-diff";
import { previewUrl, type PreviewTarget } from "./image-urls";

/** Where a version, a comparison and a page of the preview are, as the address of the app (a link of the app, so the mount comes along). */
export const previewHref = (target: PreviewTarget = {}) => previewUrl(target).replace("./previa", "/profissional/meu-site/previa");

/**
 * What changed between two versions, as a list grouped by where it is: the site as a whole, then the home page and each page. A page with
 * something that is still in the newer version has a link to see it with the blocks marked; the marks are explained once, above the list.
 */
export function ReleaseChanges({ diff, shown, target }: { diff: Diff; shown: SiteContent; target: Pick<PreviewTarget, "versao" | "desde"> }) {
  const { shown: changes, left } = capped(diff);
  if (changes.length === 0) return <p className="small muted">{NO_CHANGES}</p>;
  // The site first, then the home page and the pages in the order of the menu, then the pages that are not in the newer version any more.
  const known: Array<string | null> = [null, HOME, ...pagesOf(shown).map((entry) => entry.id)];
  const order = [...known, ...changes.map((change) => change.page).filter((page, at, all) => !known.includes(page) && all.indexOf(page) === at)];
  const label = (page: string | null) => {
    if (page === null) return "O site";
    if (page === HOME) return "Página inicial";
    const found = pageById(shown, page);
    // A page that is not in the newer version was removed: its name is in what the list says.
    return found ? `Página “${found.title || found.slug}”` : "Página removida";
  };
  return (
    <>
      <p className="small muted ve-diff-legend">
        Na página, <span className="diff-chip" data-diff="added">verde</span> é o que foi acrescentado e <span className="diff-chip" data-diff="changed">laranja</span> é o que mudou.
        O que foi removido só aparece nesta lista.
      </p>
      {order.map((page) => {
        const group = changes.filter((change) => change.page === page);
        if (group.length === 0) return null;
        const visible = page !== null && (page === HOME || pageById(shown, page) !== undefined);
        return (
          <section key={page ?? "site"} aria-label={label(page)} className="release-changes-group">
            <h3>
              {label(page)}
              {visible && (
                <>
                  {" "}
                  <Link className="small" href={previewHref({ ...target, pagina: page === HOME ? null : page })}>
                    Ver esta página
                  </Link>
                </>
              )}
            </h3>
            <ul>
              {group.map((change, index) => (
                <li key={index} data-kind={change.kind}>
                  {change.text}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {left > 0 && <p className="small muted">Há mais {left} mudanças que não estão nesta lista (ela mostra as primeiras {MAX_CHANGES}).</p>}
    </>
  );
}
