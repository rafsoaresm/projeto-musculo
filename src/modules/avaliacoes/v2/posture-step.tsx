"use client";
import { useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import {
  HEATH_CARTER_CODES,
  HEATH_CARTER_MEASURES,
  LATERALITIES,
  LATERALITY_CODES,
  POSTURE_VIEWS,
  POSTURE_VIEW_CODES,
  POSTURE_VIEW_SHORT,
  SOMATOTYPES,
  SOMATOTYPE_CODES,
  postureRegionKey,
  type LateralityCode,
  type PostureRegion,
  type PostureView,
} from "../catalog";
import { TextAreaField, UnitField } from "./fields";
import { HEATH_CARTER_NOTE, findingCodes, regionsOf, takesSide, toggleFinding, toggleSomatotype, viewTabCount, viewTabName, type PostureForm } from "./posture";

/** The blank answer of a single choice: chosen, the region has no finding (not observed), drawn as an empty outline like the PAR-Q's. */
const NOT_OBSERVED = "Não observado";
/** The blank answer of the side: no side recorded. */
const NO_SIDE = "Não informado";

/**
 * One region of a view: a fieldset whose legend is the region (and its view, for screen readers), and its findings as chips in a grid whose columns
 * are the same on every line of the card, so the findings of all regions line up (the Figma AV-02 rule, kept for AV-05). Findings that may coexist
 * are checkboxes; the others are radios with "Não observado" to take the choice back. A paired region with a finding that deviates asks the side
 * (handoff 3.3: `laterality?`), on a line of its own under the findings, in the same columns.
 */
function Region({
  region,
  findings,
  side,
  onChange,
  onSide,
}: {
  region: PostureRegion;
  findings: string[];
  side: LateralityCode | undefined;
  onChange: (findings: string[]) => void;
  onSide: (side: LateralityCode | undefined) => void;
}) {
  const id = useId();
  const name = `av2-postura-${postureRegionKey(region)}`;
  const labels = region.findings as Record<string, string>;
  return (
    <li className="av2-question-item">
      <fieldset
        className="av2-question av2-finding"
        role={region.multiple ? "group" : "radiogroup"}
        aria-labelledby={id}
        aria-describedby={region.multiple ? `${id}-dica` : undefined}
        data-observed={findings.length > 0 || undefined}
      >
        <legend id={id} className="av2-question-text">
          {region.label}
          <span className="sr-only"> ({POSTURE_VIEWS[region.view].toLowerCase()})</span>
          {region.multiple && (
            <span id={`${id}-dica`} className="av2-finding-hint small muted" aria-hidden="true">
              Pode marcar mais de um
            </span>
          )}
        </legend>
        <div className="av2-answers av2-finding-options">
          {findingCodes(region).map((finding) => (
            <label key={finding} className="av2-chip">
              <input
                type={region.multiple ? "checkbox" : "radio"}
                name={name}
                checked={findings.includes(finding)}
                onChange={(event) => onChange(toggleFinding(region, findings, finding, region.multiple ? event.target.checked : true))}
              />
              <span>{labels[finding]}</span>
            </label>
          ))}
          {!region.multiple && (
            <label className="av2-chip" data-tone="blank">
              <input type="radio" name={name} checked={findings.length === 0} onChange={() => onChange([])} />
              <span>{NOT_OBSERVED}</span>
            </label>
          )}
        </div>
        {takesSide(region, findings) && (
          <div className="av2-answers av2-finding-options av2-finding-side" role="radiogroup" aria-label={`Lado (${region.label.toLowerCase()}, ${POSTURE_VIEWS[region.view].toLowerCase()})`}>
            {LATERALITY_CODES.map((code) => (
              <label key={code} className="av2-chip">
                <input type="radio" name={`${name}-lado`} checked={side === code} onChange={() => onSide(code)} />
                <span>{LATERALITIES[code]}</span>
              </label>
            ))}
            <label className="av2-chip" data-tone="blank">
              <input type="radio" name={`${name}-lado`} checked={side === undefined} onChange={() => onSide(undefined)} />
              <span>{NO_SIDE}</span>
            </label>
          </div>
        )}
      </fieldset>
    </li>
  );
}

/**
 * The columns of a view's findings: as many as its longest line (the findings, plus "Não observado" for a single choice; the side's line too), so
 * "Não observado" takes the last column on every line without a run of empty columns before it on a wide card.
 */
const findingColumns = (view: PostureView) =>
  Math.max(LATERALITY_CODES.length + 1, ...regionsOf(view).map((region) => findingCodes(region).length + (region.multiple ? 0 : 1)));

/**
 * The "Movimento" step, part one (handoff 3.3, Figma AV-05): the postural assessment in three views, as tabs (handoff 7: "abas lateral/posterior/
 * anterior"), and the somatotype recorded by the professional. Observations, never a diagnosis; a region with no finding is not observed, never
 * "alinhado". Nothing is computed here: the somatotype is the professional's record, and the Heath-Carter measures are kept as typed.
 */
export function PostureStep({ form, onChange }: { form: PostureForm; onChange: (form: PostureForm) => void }) {
  const [view, setView] = useState<PostureView>("lateral");
  const tabs = useRef<Record<string, HTMLButtonElement | null>>({});
  const baseId = useId();
  const set = (patch: Partial<PostureForm>) => onChange({ ...form, ...patch });

  const onKey = (event: KeyboardEvent) => {
    const index = POSTURE_VIEW_CODES.indexOf(view);
    const last = POSTURE_VIEW_CODES.length - 1;
    const next =
      event.key === "ArrowRight" ? (index === last ? 0 : index + 1) : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1) : event.key === "Home" ? 0 : event.key === "End" ? last : -1;
    if (next < 0) return;
    event.preventDefault();
    const target = POSTURE_VIEW_CODES[next];
    setView(target);
    tabs.current[target]?.focus();
  };

  return (
    <div className="av2-cards">
      <section className="panel av2-card" aria-labelledby="av2-postura">
        <h3 id="av2-postura">Avaliação postural</h3>
        <p className="muted small">
          Três vistas com seleção de achados e observações. São observações posturais, não diagnóstico clínico; uma região sem achado fica como não
          observada.
        </p>
        <div role="tablist" aria-label="Vistas da avaliação postural" className="av2-view-tabs" onKeyDown={onKey}>
          {POSTURE_VIEW_CODES.map((code) => (
            <button
              key={code}
              type="button"
              role="tab"
              className="av2-step av2-tab"
              id={`${baseId}-aba-${code}`}
              aria-selected={view === code}
              aria-label={viewTabName(form, code)}
              aria-controls={`${baseId}-painel-${code}`}
              tabIndex={view === code ? 0 : -1}
              ref={(node) => {
                tabs.current[code] = node;
              }}
              onClick={() => setView(code)}
            >
              {/* One flex item, so the space after "·" stays and a narrow tab breaks only there. */}
              <span>
                {POSTURE_VIEW_SHORT[code]} · <span className="av2-tab-count">{viewTabCount(form, code)}</span>
              </span>
            </button>
          ))}
        </div>
        {POSTURE_VIEW_CODES.map((code) => (
          <div
            key={code}
            role="tabpanel"
            id={`${baseId}-painel-${code}`}
            aria-labelledby={`${baseId}-aba-${code}`}
            hidden={view !== code}
            className="av2-view-panel"
            style={{ "--av2-finding-columns": findingColumns(code) } as CSSProperties}
          >
            <ul className="av2-questions" aria-label={POSTURE_VIEWS[code]}>
              {regionsOf(code).map((region) => {
                const key = postureRegionKey(region);
                return (
                  <Region
                    key={key}
                    region={region}
                    findings={form.findings[key] ?? []}
                    side={form.laterality[key]}
                    onChange={(findings) => set({ findings: { ...form.findings, [key]: findings } })}
                    onSide={(side) => {
                      const laterality = { ...form.laterality };
                      if (side) laterality[key] = side;
                      else delete laterality[key];
                      set({ laterality });
                    }}
                  />
                );
              })}
            </ul>
            <div className="av2-grid av2-view-notes">
              <TextAreaField
                label="Observações"
                context={`da ${POSTURE_VIEWS[code].toLowerCase()}`}
                value={form.notes[code]}
                onChange={(notes) => set({ notes: { ...form.notes, [code]: notes } })}
                note="Grau, um lado diferente do outro ou o que os achados não dizem."
              />
            </div>
          </div>
        ))}
      </section>

      <section className="panel av2-card" aria-labelledby="av2-somatotipo">
        <h3 id="av2-somatotipo">Somatotipo</h3>
        <p className="muted small">Registro do profissional, nunca inferido de foto. Endomorfo, mesomorfo e ectomorfo podem ir juntos; misto e não classificado vão sozinhos.</p>
        <div className="av2-chips av2-somatotypes" role="group" aria-labelledby="av2-somatotipo">
          {SOMATOTYPE_CODES.map((code) => (
            <label key={code} className="av2-chip">
              <input
                type="checkbox"
                checked={form.somatotype.includes(code)}
                onChange={(event) => set({ somatotype: toggleSomatotype(form.somatotype, code, event.target.checked) })}
              />
              <span>{SOMATOTYPES[code]}</span>
            </label>
          ))}
        </div>
        <div className="av2-grid">
          <TextAreaField label="Observações do somatotipo" value={form.somatotypeNotes} onChange={(somatotypeNotes) => set({ somatotypeNotes })} />
        </div>
        <h4 className="av2-subtitle" id="av2-heath-carter">
          Medidas para Heath-Carter
        </h4>
        <p className="muted small av2-card-note">{HEATH_CARTER_NOTE}</p>
        <div className="av2-grid" role="group" aria-labelledby="av2-heath-carter">
          {HEATH_CARTER_CODES.map((code) => (
            <UnitField
              key={code}
              label={HEATH_CARTER_MEASURES[code].label}
              unit={HEATH_CARTER_MEASURES[code].unit}
              value={form.heathCarter[code]}
              placeholder="Sem aferição"
              onChange={(text) => set({ heathCarter: { ...form.heathCarter, [code]: text } })}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
