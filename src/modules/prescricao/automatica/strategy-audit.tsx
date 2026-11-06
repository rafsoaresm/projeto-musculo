import type { StrategyAuditView } from "./review-view";

/**
 * "Estratégia" (top of the audit tab, proposals made from an accepted strategy): adherence of each workout to its focus, week by week, then the
 * overlap between workouts (a diagnosis, never a target) and the exposures per region on the real calendar. Text and a ✓/! mark, never colour alone.
 */
export function StrategyAudit({ view, phaseIndex }: { view: StrategyAuditView; phaseIndex: number }) {
  return (
    <section className="audit-strategy" aria-labelledby="auditoria-estrategia-titulo">
      <h3 id="auditoria-estrategia-titulo">Estratégia · Fase {phaseIndex}</h3>
      <p className="small muted">{view.summary}</p>
      {view.workouts.length === 0 ? (
        <p className="small muted">Esta fase não tem treinos de estratégia na auditoria.</p>
      ) : (
        view.workouts.map((w) => (
          <div key={w.label} className="execution-scroll" tabIndex={0} role="region" aria-label={`Aderência do treino ${w.label} ao foco, rolável para o lado`}>
            <table className="execution-table">
              <caption className="small">
                Treino {w.label} · {w.roleLabel} <span className="muted">({w.originLabel})</span>
              </caption>
              <thead>
                <tr>
                  <th scope="col">Semana</th>
                  <th scope="col">Exercícios</th>
                  <th scope="col">Fora do foco</th>
                  <th scope="col">Aderência</th>
                  <th scope="col">Situação</th>
                </tr>
              </thead>
              <tbody>
                {w.weeks.map((x) => (
                  <tr key={x.week}>
                    <th scope="row">{x.week}</th>
                    <td>{x.items}</td>
                    <td>{x.offFocus}</td>
                    <td>{x.share}</td>
                    <td>{x.respected === null ? "—" : x.respected ? "✓ Foco respeitado" : `! Fora do foco: ${x.offFocus}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {w.omitted > 0 && <p className="small muted">{w.omitted} {w.omitted === 1 ? "semana" : "semanas"} fora desta tabela (plano longo): só aparecem as de menor aderência.</p>}
          </div>
        ))
      )}
      {view.overlaps.length > 0 && (
        <>
          <h4 className="small-heading">Sobreposição entre treinos</h4>
          <ul className="auto-list">
            {view.overlaps.map((t) => (
              <li key={t} className="small">
                {t}
              </li>
            ))}
          </ul>
        </>
      )}
      {view.exposures.length > 0 && (
        <>
          <h4 className="small-heading">Exposições por região</h4>
          <ul className="auto-list">
            {view.exposures.map((t) => (
              <li key={t} className="small">
                {t}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="small muted">{view.note}</p>
    </section>
  );
}
