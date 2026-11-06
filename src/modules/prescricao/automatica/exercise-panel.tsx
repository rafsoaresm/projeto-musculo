"use client";
import { ChevronLeft } from "lucide-react";
import { Pill } from "@/components/ui";
import { STIMULUS_LABELS } from "@/modules/prescricao/motor/vocabulary";
import type { HistorySuggestion, ItemOut, OccurrenceOut, RuleUse } from "@/modules/prescricao/motor/types";
import {
  BASIS_LABELS,
  BASIS_TONES,
  METADATA_LABELS,
  PROPOSAL_ORIGIN_LABELS,
  changeIfText,
  contributionView,
  historySuggestionText,
  itemBasisGroups,
  type ItemWhy,
  ruleLabel,
  traceParamLabel,
  traceValue,
  whyView,
} from "./view";

/** Dose value of the stored display fields: "—" only says the engine left it blank, never a number made up for the screen. */
const orBlank = (value: string | number | null | undefined) => (value === null || value === undefined || value === "" ? "—" : String(value));

/**
 * The contextual panel of the selected exercise (Figma RX-01 right column, RX-05 on a phone): the stored dose as read-only tiles,
 * the origin and the bases of the values, "Por quê?" (collapsed, the trace) and the three decisions: Manter (lock the item),
 * Substituir (choose another exercise, with scope) and Trocar (the engine picks another one). No dose is edited here: manual
 * editing happens after the apply, in the draft's editor.
 */
export function ExercisePanel({
  item,
  position,
  total,
  occurrence,
  week,
  experienceUnknown,
  contribution,
  doseWhy,
  suggestions,
  rulesUsed,
  locked,
  pending,
  phaseIndex,
  onBack,
  onSubstitute,
  onLock,
  onAnother,
}: {
  item: ItemOut;
  position: number;
  total: number;
  occurrence: OccurrenceOut;
  week: number;
  experienceUnknown: boolean;
  contribution: ReturnType<typeof contributionView>;
  /** Dose "Por quê?" and origin pills (empty dose lines on proposals made before the dose policy). */
  doseWhy: ItemWhy;
  suggestions: readonly HistorySuggestion[];
  rulesUsed: readonly RuleUse[];
  locked: boolean;
  pending: boolean;
  phaseIndex: number;
  /** Phone: back to the list of the session. */
  onBack: () => void;
  onSubstitute: () => void;
  onLock: (locked: boolean) => void;
  onAnother: () => void;
}) {
  const bases = itemBasisGroups(item);
  const meta = METADATA_LABELS[item.metadata];
  const history = historySuggestionText(suggestions, phaseIndex, item.slotKey);
  const preserved = item.origin === "PRESERVED";
  const why = whyView(item, { rulesUsed, contribution, week, experienceUnknown });
  const stimulus = occurrence.stimulus ? (STIMULUS_LABELS[occurrence.stimulus.value] ?? occurrence.stimulus.value) : null;
  const d = item.display;
  const rir = d.rirMin !== null && d.rirMax !== null ? (d.rirMin === d.rirMax ? String(d.rirMin) : `${d.rirMin}–${d.rirMax}`) : d.rirMin !== null ? String(d.rirMin) : null;
  const rest = d.restSeconds !== null ? `${d.restSeconds} s` : d.restText;
  return (
    <aside className="rx-card rx-panel rx-exercise" aria-label={`Exercício selecionado: ${item.exerciseName}`}>
      <button type="button" className="rx-back" onClick={onBack}>
        <ChevronLeft size={16} aria-hidden="true" /> Sessões
      </button>
      <span className="rx-chip rx-chip-brand rx-desktop">Selecionado</span>
      <h3 className="rx-panel-title">{item.exerciseName}</h3>
      <p className="rx-sub">
        <span className="rx-mobile">Semana {week} · </span>
        Sessão {occurrence.slot} · Treino {occurrence.label} · <span className="rx-desktop">posição </span>
        <span className="rx-mobile">exercício </span>
        {position} de {total}
      </p>
      <div className="rx-origin-card">
        <span className="pill-row">
          <span className="rx-chip rx-chip-brand">{PROPOSAL_ORIGIN_LABELS[item.origin]}</span>
          {meta && <span className="rx-chip rx-chip-warning">{meta}</span>}
        </span>
        <p className="rx-sub">
          Origem: {PROPOSAL_ORIGIN_LABELS[item.origin].toLowerCase()}
          {stimulus ? ` · objetivo: ${stimulus.toLowerCase()}` : ""}
        </p>
      </div>
      <hr className="rx-rule" />
      <h4 className="rx-label">Dosagem sugerida</h4>
      <p className="rx-sub rx-mobile">Valores calculados pelo motor. Para editar a dose, aplique ao rascunho e use o editor da revisão.</p>
      <dl className="rx-tiles">
        <div>
          <dt>séries</dt>
          <dd>{orBlank(d.sets)}</dd>
        </div>
        <div>
          <dt>reps</dt>
          <dd>{orBlank(d.reps)}</dd>
        </div>
        <div>
          <dt>descanso</dt>
          <dd>{orBlank(rest)}</dd>
        </div>
      </dl>
      {!d.doseText && <p className="rx-sub">Dose em branco: você preenche depois de aplicar.</p>}
      <div className="rx-facts">
        {rir && (
          <span>
            <span className="rx-label">RIR</span> <span className="rx-chip rx-chip-line">{rir}</span>
          </span>
        )}
        {stimulus && (
          <span>
            <span className="rx-sub">Objetivo da fase</span> <span className="rx-chip rx-chip-line">{stimulus}</span>
          </span>
        )}
        {d.loadInstruction && (
          <span>
            <span className="rx-sub">Carga</span> <span className="rx-chip rx-chip-line">{d.loadInstruction}</span>
          </span>
        )}
      </div>
      {(bases.selection.length > 0 || bases.dose.length > 0) && (
        <div className="rx-bases">
          {bases.selection.length > 0 && (
            <span className="pill-row basis-row">
              <span className="rx-sub">Escolha:</span>
              {bases.selection.map((b) => (
                <Pill key={b} tone={BASIS_TONES[b]}>
                  {BASIS_LABELS[b]}
                </Pill>
              ))}
            </span>
          )}
          {bases.dose.length > 0 && (
            <span className="pill-row basis-row">
              <span className="rx-sub">Dose:</span>
              {bases.dose.map((b) => (
                <Pill key={b} tone={BASIS_TONES[b]}>
                  {BASIS_LABELS[b]}
                </Pill>
              ))}
            </span>
          )}
        </div>
      )}
      {history && (
        <p className="small history-suggestion">
          <Pill tone={history.tone}>{history.title}</Pill> {history.detail} <span className="muted">Não muda a dose: a decisão é sua.</span>
        </p>
      )}
      <details className="rx-why why-details">
        <summary>
          <span className="rx-why-title">Por que este exercício?</span>
          <span className="rx-sub">Proposta do motor • detalhes e regras disponíveis sob demanda. Verifique dose, escolha e adequação ao aluno.</span>
        </summary>
        {why.map((section) => (
          <div key={section.key} className="why-block why-section">
            <h4 className="small-heading">{section.title}</h4>
            <ul className="auto-list">
              {section.lines.map((line, n) => (
                <li key={n} className={line.muted ? "small muted" : "small"}>
                  {line.basis &&
                    (section.key === "rules" ? (
                      <>
                        <Pill tone={BASIS_TONES[line.basis]}>{BASIS_LABELS[line.basis]}</Pill>{" "}
                      </>
                    ) : (
                      <>
                        <span title={line.rule ? `Regra: ${line.rule}` : undefined}>
                          <Pill tone={BASIS_TONES[line.basis]}>{BASIS_LABELS[line.basis]}</Pill>
                        </span>{" "}
                      </>
                    ))}
                  {line.text}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {doseWhy.dose.length > 0 && (
          <div className="why-block why-section" role="group" aria-label="Por que esta dose">
            <h4 className="small-heading">Por que esta dose</h4>
            <ul className="auto-list">
              {doseWhy.dose.map((line) => (
                <li key={line.param} className="small" data-dose-why={line.param}>
                  <strong>{line.question}</strong> <Pill tone={BASIS_TONES[line.basis]}>{BASIS_LABELS[line.basis]}</Pill>{" "}
                  <span>
                    Regra: {line.rule}
                    {line.profile ? ` · perfil ${line.profile}` : ""}.
                  </span>
                  {line.reasons.length > 0 && <span> Motivos: {line.reasons.join(", ")}.</span>}
                  {line.changeIf && <span className="muted"> {changeIfText(line.changeIf)}</span>}
                </li>
              ))}
            </ul>
            {doseWhy.metadataNote && (
              <p className="small muted" data-dose-note="metadata">
                {doseWhy.metadataNote}
              </p>
            )}
          </div>
        )}
        {item.trace.params.length > 0 && (
          <details className="auto-details">
            <summary>Todos os valores propostos e suas bases</summary>
            <div className="execution-scroll" tabIndex={0} role="region" aria-label={`Valores propostos para ${item.exerciseName}`}>
              <table className="execution-table">
                <thead>
                  <tr>
                    <th scope="col">Valor</th>
                    <th scope="col">Proposto</th>
                    <th scope="col">Base</th>
                  </tr>
                </thead>
                <tbody>
                  {item.trace.params.map((p, n) => (
                    <tr key={`${p.param}-${n}`}>
                      <th scope="row">{traceParamLabel(p.param)}</th>
                      <td>{traceValue(p.value, p.param)}</td>
                      <td title={p.ruleId ? `Regra: ${ruleLabel(rulesUsed, p.ruleId)}` : undefined}>{BASIS_LABELS[p.basis]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </details>
      <hr className="rx-rule" />
      {preserved ? (
        <p className="rx-sub">Este exercício já estava no rascunho: a ferramenta não o troca. Mude no editor da revisão.</p>
      ) : (
        <>
          <h4 className="rx-label rx-mobile">Decisão sobre a sugestão</h4>
          <div className="rx-decisions">
            <button
              type="button"
              className={locked ? "rx-btn rx-btn-line" : "rx-btn rx-btn-primary"}
              disabled={pending}
              onClick={() => onLock(!locked)}
              aria-label={`${locked ? "Destravar" : "Manter"} ${item.exerciseName}`}
            >
              {locked ? "Destravar" : "Manter"}
            </button>
            <button type="button" className="rx-btn rx-btn-line" disabled={pending} onClick={onSubstitute} aria-label={`Substituir ${item.exerciseName}`}>
              Substituir
            </button>
            <button
              type="button"
              className="rx-btn rx-btn-line"
              disabled={pending || locked}
              onClick={onAnother}
              aria-label={`Trocar ${item.exerciseName} por outro`}
            >
              Trocar
            </button>
          </div>
          <p className="rx-sub">
            {locked
              ? "Mantido por você: a ferramenta não o troca nas regenerações até você destravar."
              : "Manter trava o exercício nas regenerações. Substituir: você escolhe outro. Trocar: a ferramenta escolhe outro."}{" "}
            <span className="rx-mobile">As mudanças permanecem na revisão até aplicar.</span>
          </p>
        </>
      )}
    </aside>
  );
}
