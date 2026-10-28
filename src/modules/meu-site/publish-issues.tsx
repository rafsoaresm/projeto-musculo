"use client";
import type { ReactNode } from "react";
import type { PublishIssue } from "./contracts";

/**
 * What the publication found, in two lists: what **stops** it (no title, no block, a testimony without its authorization) and the **warnings**
 * (a button with no contact, a question with no answer, an image with no description...), which do not: when there is nothing that stops it, the
 * person may publish anyway. `action` puts something next to an issue (in the editor, the button that goes to the block).
 */
export function PublishIssues({
  issues,
  pending,
  onPublishAnyway,
  action,
}: {
  issues: PublishIssue[];
  pending: boolean;
  /** Publishes with the warnings. Only offered when nothing stops the publication. */
  onPublishAnyway: () => void;
  action?: (issue: PublishIssue) => ReactNode;
}) {
  const blocking = issues.filter((issue) => issue.severity === "blocking");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  if (issues.length === 0) return null;
  const list = (items: PublishIssue[], label: string) => (
    <ul aria-label={label}>
      {items.map((issue, index) => (
        <li key={index}>
          {issue.message} {action?.(issue)}
        </li>
      ))}
    </ul>
  );
  return (
    <div className={`notice ${blocking.length > 0 ? "warning" : "info"} ve-issues-box`} role="alert">
      <div>
        {blocking.length > 0 && (
          <>
            <p>
              <strong>Antes de publicar:</strong> isto impede a publicação.
            </p>
            {list(blocking, "O que falta para publicar")}
          </>
        )}
        {warnings.length > 0 && (
          <>
            <p>
              <strong>Avisos:</strong> {blocking.length > 0 ? "estes não impedem a publicação." : "o site pode ser publicado assim; o que não está pronto fica de fora da página."}
            </p>
            {list(warnings, "Avisos antes de publicar")}
          </>
        )}
        {blocking.length === 0 && (
          <p className="persist-actions">
            <button type="button" className="button small primary" disabled={pending} onClick={onPublishAnyway}>
              {pending ? "Aguarde…" : "Publicar mesmo assim"}
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
