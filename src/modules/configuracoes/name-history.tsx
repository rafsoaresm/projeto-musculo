import { formatDateTime } from "@/components/ui";
import type { NameChange } from "@/db/workspace-settings";

/**
 * The earlier names of the workspace or of the acting professional (slice 0.90), newest first. Changes made before 0.90 were not
 * registered, so an empty list says so instead of suggesting the name never changed.
 */
export function NameHistory({ id, title, changes }: { id: string; title: string; changes: NameChange[] }) {
  return (
    <div className="name-history">
      <h3 id={id}>{title}</h3>
      {changes.length === 0 ? (
        <p className="small muted">
          Nenhuma mudança registrada. Mudanças feitas antes de a ferramenta guardar este histórico não aparecem aqui.
        </p>
      ) : (
        <div className="table-wrap">
          <table className="data-table stack" aria-labelledby={id}>
            <thead>
              <tr>
                <th scope="col">Quando</th>
                <th scope="col">Nome anterior</th>
                <th scope="col">Passou a ser</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((change, index) => (
                <tr key={`${change.changedAt}-${index}`}>
                  <th scope="row" data-label="Quando">
                    {formatDateTime(change.changedAt)}
                  </th>
                  <td data-label="Nome anterior">{change.previousName}</td>
                  <td data-label="Passou a ser">{change.newName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
