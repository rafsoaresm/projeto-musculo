import Link from "next/link";
import { Kpi, Notice, Pill } from "@/components/ui";
import type { TargetSuggestion } from "@/modules/prescricao/motor/targets";
import { TargetSuggestionCard } from "./target-suggestions";
import {
  BASIS_LABELS,
  BASIS_TONES,
  auditPhaseRows,
  auditView,
  type AuditFindingView,
  type AuditGroupView,
  type AuditSource,
  type CoverageAnswer,
  type WorkoutCoverageAnswer,
} from "./view";

/** What the panel needs to draw the suggested-targets card of a finding "sem alvos" (design V3 §7.4). */
export interface AuditTargets {
  suggestions: ReadonlyArray<{ phaseIndex: number; suggestion: TargetSuggestion | null; reason: string | null }>;
  labelsOf: (phaseIndex: number) => string[];
  pending: boolean;
  onAccept: (entry: CoverageAnswer) => void;
  onApply: (phaseIndex: number, coverage: CoverageAnswer | null, byWorkout: WorkoutCoverageAnswer[]) => void;
}

/**
 * "Auditoria técnica do plano" (design V3 §7.1): the plan-wide reading of the proposal, drawn only from what `view.ts` returns.
 * It never blocks and never changes doses; the findings are observations for the professional's review. For a proposal recorded
 * before the audit, the audit was computed now and says so. The tables cover the phase on screen.
 */
export function AuditPanel({
  audit,
  engineVersion,
  acceptSuggestions,
  phaseIndex,
  href,
  targets,
}: {
  audit: AuditSource;
  engineVersion: string;
  acceptSuggestions: boolean;
  phaseIndex: number;
  /** Address of a phase (and week) of the proposal, relative to the mount, as the page builds it. */
  href: (phaseIndex: number, week?: number) => string;
  /** The suggested-targets cards; absent = descriptions only. */
  targets?: AuditTargets;
}) {
  const view = auditView(audit, { engineVersion, acceptSuggestions });
  const rows = auditPhaseRows(audit.report, phaseIndex);
  const descriptive = view.descriptive.reduce((a, g) => a + g.findings.length, 0);
  return (
    <section className="panel audit-panel" aria-labelledby="auditoria-titulo">
      <h2 id="auditoria-titulo">Auditoria técnica do plano</h2>
      <p className="small muted">
        Leitura do plano inteiro a partir das sessões reais de cada semana. Não bloqueia nada e não muda doses: são observações para a
        sua revisão. Faixas sem alvo seu são heurística operacional (editável).
      </p>
      {view.viewNotice && (
        <Notice>
          <p>{view.viewNotice}</p>
        </Notice>
      )}
      <div className="kpi-grid compact">
        <Kpi label="Sessões por semana (reais)" value={view.kpis.sessionsPerWeek} />
        <Kpi label="Pontos de atenção" value={String(view.kpis.attention)} />
        <Kpi label="Observações" value={String(view.kpis.observations)} />
        <Kpi label="Fases auditadas" value={view.kpis.phases} />
      </div>
      <FindingGroups title="Atenção" groups={view.attention} count={view.kpis.attention} open href={href} targets={targets} />
      <FindingGroups title="Observações" groups={view.observations} count={view.kpis.observations} href={href} targets={targets} open={offersCard(view.observations, targets)} />
      <FindingGroups title="Descrição do plano" groups={view.descriptive} count={descriptive} href={href} targets={targets} />
      {view.kpis.attention + view.kpis.observations + descriptive === 0 && <p className="small muted">Nenhum ponto a observar nas fases auditadas.</p>}
      {rows ? (
        <>
          <p className="small">
            <strong>Fase {phaseIndex}</strong> · Formato observado: {rows.shape ?? "sem treinos de volume"}{" "}
            <span className="muted">(descrição; os nomes dos treinos são os seus)</span>
          </p>
          {!rows.volume ? (
            <p className="small muted">Fase sem treinos de volume (resistido): a distribuição por músculo não se aplica.</p>
          ) : (
          <details className="progression-details">
            <summary>Distribuição por músculo · Fase {phaseIndex}</summary>
            <p className="small muted">
              Por semana da fase (mínimo–máximo entre as semanas). Diretas: músculo principal; indiretas: secundário; a ponderada soma as
              indiretas pelo fator da regra.{rows.unknownNote && ` ${rows.unknownNote}`}
              <span className="scroll-hint"> Deslize a tabela para o lado para ver todas as colunas.</span>
            </p>
            <div className="execution-scroll" tabIndex={0} role="region" aria-label={`Distribuição por músculo da fase ${phaseIndex}, rolável para o lado`}>
              <table className="execution-table">
                <thead>
                  <tr>
                    <th scope="col">Músculo</th>
                    <th scope="col">Diretas/semana</th>
                    <th scope="col">Indiretas</th>
                    <th scope="col">Ponderadas</th>
                    <th scope="col">Sessões com estímulo direto</th>
                    <th scope="col">Alvo</th>
                    <th scope="col">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.muscles.map((m) => (
                    <tr key={m.muscle}>
                      <th scope="row">{m.muscle}</th>
                      <td>{m.direct}</td>
                      <td>{m.indirect}</td>
                      <td>{m.weighted}</td>
                      <td>{m.directSessions}</td>
                      <td>{m.target}</td>
                      <td>{m.situation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          )}
          {rows.patterns.length > 0 && (
            <details className="progression-details">
              <summary>Padrões de movimento · Fase {phaseIndex}</summary>
              <p className="small muted">
                Séries e sessões por semana (mínimo–máximo). Só os padrões trabalhados ou marcados como alvo.{rows.unknownNote && ` ${rows.unknownNote}`}
                <span className="scroll-hint"> Deslize a tabela para o lado para ver todas as colunas.</span>
              </p>
              <div className="execution-scroll" tabIndex={0} role="region" aria-label={`Padrões de movimento da fase ${phaseIndex}, rolável para o lado`}>
                <table className="execution-table">
                  <thead>
                    <tr>
                      <th scope="col">Padrão</th>
                      <th scope="col">Séries/semana</th>
                      <th scope="col">Sessões/semana</th>
                      <th scope="col">Alvo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.patterns.map((p) => (
                      <tr key={p.pattern}>
                        <th scope="row">{p.pattern}</th>
                        <td>{p.sets}</td>
                        <td>{p.sessions}</td>
                        <td>{p.target}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </>
      ) : (
        <p className="small muted">A fase {phaseIndex} não foi auditada.</p>
      )}
      <p className="small muted">
        Auditoria {view.auditVersion} · regras {view.rules.id} {view.rules.version}
        {view.source === "VIEW" ? " · calculada agora, não gravada" : ""}.
      </p>
    </section>
  );
}

/** Whether a group holds a finding whose card is offered (it then opens, so "Ver alvos sugeridos" lands on the card). */
function offersCard(groups: AuditGroupView[], targets: AuditTargets | undefined): boolean {
  return Boolean(targets && groups.some((g) => g.findings.some((f) => f.offerSuggestion && targets.suggestions.some((t) => t.phaseIndex === f.phaseIndex))));
}

function FindingGroups({
  title,
  groups,
  count,
  open = false,
  href,
  targets,
}: {
  title: string;
  groups: AuditGroupView[];
  count: number;
  open?: boolean;
  href: (phaseIndex: number, week?: number) => string;
  targets?: AuditTargets;
}) {
  if (!count) return null;
  return (
    <details className="auto-details audit-group" open={open}>
      <summary>
        {title} ({count})
      </summary>
      {groups.map((g) => (
        <div key={g.phaseIndex ?? "plan"} className="audit-phase">
          <h3 className="small-heading">{g.title}</h3>
          <ul className="auto-list">
            {g.findings.map((f) => (
              <Finding key={f.key} f={f} href={href} targets={targets} />
            ))}
          </ul>
        </div>
      ))}
    </details>
  );
}

function Finding({ f, href, targets }: { f: AuditFindingView; href: (phaseIndex: number, week?: number) => string; targets?: AuditTargets }) {
  const card = f.offerSuggestion && f.phaseIndex !== null ? targets?.suggestions.find((t) => t.phaseIndex === f.phaseIndex) : undefined;
  return (
    <li className="audit-finding">
      <span className="pill-row">
        <Pill tone={f.severity === "WARNING" ? "warning" : "neutral"}>{f.label}</Pill>
        {f.statusText && <Pill tone="brand">{f.statusText}</Pill>}
      </span>
      {f.location && <span className="small muted">{f.location}</span>}
      <span className="small audit-measure">
        {f.measured && <span>{f.measured}</span>}
        <span>
          {f.target.text}
          {f.target.basis && (
            <>
              {" "}
              <Pill tone={BASIS_TONES[f.target.basis]}>{BASIS_LABELS[f.target.basis]}</Pill>
            </>
          )}
        </span>
        {f.threshold && (
          <span>
            {f.threshold.text} <Pill tone={BASIS_TONES[f.threshold.basis]}>{BASIS_LABELS[f.threshold.basis]}</Pill>
          </span>
        )}
      </span>
      <span className="small">
        {f.rationale}
        {f.aggregated && <span className="muted"> {f.aggregated}</span>}
      </span>
      {f.suggestedAction && <span className="small muted">{f.suggestedAction}</span>}
      {f.links.length > 0 && (
        <span className="exercise-actions">
          {f.links.map((l) => (
            <Link key={l.text} href={href(l.phaseIndex, l.week)} scroll={false} className="button secondary small">
              {l.text}
            </Link>
          ))}
        </span>
      )}
      {card && targets && (
        <TargetSuggestionCard
          phaseIndex={card.phaseIndex}
          suggestion={card.suggestion}
          reason={card.reason}
          labels={targets.labelsOf(card.phaseIndex)}
          pending={targets.pending}
          acceptText="Aceitar e regenerar a fase"
          commitText="Nada é aplicado sem o seu aceite. Ao aceitar, a fase é regenerada; itens mantidos, travados e trocados por você continuam."
          requireTargets
          onAccept={targets.onAccept}
          onApply={(coverage, byWorkout) => targets.onApply(card.phaseIndex, coverage, byWorkout)}
        />
      )}
    </li>
  );
}
