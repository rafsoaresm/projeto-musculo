"use client";
import { useId } from "react";
import { Plus, X } from "lucide-react";
import { PROTOCOL_IDS, type AggregationRule, type EquationSelection, type SkinfoldSite } from "../formulas";
import {
  AGGREGATIONS,
  AGGREGATION_LABEL,
  CONVERSION_LABEL,
  EQUATIONS,
  EQUATION_LABEL,
  MAX_READINGS,
  PROTOCOL_CHIP,
  SITE_LABEL,
  ageAtAssessment,
  compositionPreview,
  otherSites,
  protocolTitle,
  requiredSites,
  type CompositionForm,
} from "./composition";

/**
 * The fields of a step sit in `.av2-grid`, a grid whose rows are shared by every field of a line (CSS subgrid): the labels of a line take the
 * same height, the controls start on the same line, and a note under a control never moves its neighbours. Each field is three rows: label,
 * control, note (empty when there is none).
 */

/** A number field with its unit drawn inside, as in the Figma frames; the unit is also in the field's name for screen readers. */
function UnitInput({ label, unit, value, onChange, placeholder }: { label: string; unit: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  const id = useId();
  // The unit is drawn inside the field and stays out of the visible label, so the field's name is exactly "Peso (kg)".
  return (
    <span className="av2-unit">
      <label htmlFor={id} className="sr-only">
        {label} ({unit})
      </label>
      <input id={id} inputMode="decimal" autoComplete="off" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      <span aria-hidden="true">{unit}</span>
    </span>
  );
}

function UnitField({ label, unit, value, onChange, placeholder }: { label: string; unit: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  const id = useId();
  return (
    <div className="av2-field">
      <label htmlFor={id} className="av2-label">
        {label}
        <span className="sr-only"> ({unit})</span>
      </label>
      <span className="av2-unit">
        <input id={id} inputMode="decimal" autoComplete="off" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
        <span aria-hidden="true">{unit}</span>
      </span>
    </div>
  );
}

/** A value the step shows but does not take (age, conversion): it wraps instead of being cut, and is read with its label. */
function ReadOnlyField({ label, value }: { label: string; value: string }) {
  const id = useId();
  return (
    <div className="av2-field">
      <span id={id} className="av2-label">
        {label}
      </span>
      <output className="av2-readonly" aria-labelledby={id} aria-live="off">
        {value}
      </output>
    </div>
  );
}

/**
 * One skinfold site: up to three readings, none of them a 0 when not measured. "+ leitura" sits right under the site's own readings (in the
 * control row, not in the row the line shares, so extra readings of a neighbour never push it away). Every reading keeps the place of the
 * remove button, also the first one, which has none: the inputs of a site, and of the sites side by side, have the same width.
 */
function SiteReadings({ site, readings, onChange }: { site: SkinfoldSite; readings: string[]; onChange: (readings: string[]) => void }) {
  const id = useId();
  const shown = readings.length === 0 ? [""] : readings;
  const name = SITE_LABEL[site];
  return (
    <div className="av2-field av2-site" role="group" aria-labelledby={id}>
      <span id={id} className="av2-label">
        {name}
      </span>
      <div className="av2-readings">
        {shown.map((value, position) => (
          <div key={position} className="av2-reading">
            <UnitInput
              label={position === 0 ? name : `${name}, leitura ${position + 1}`}
              unit="mm"
              value={value}
              placeholder="Sem aferição"
              onChange={(text) => onChange(shown.map((item, at) => (at === position ? text : item)))}
            />
            {position > 0 ? (
              <button
                type="button"
                className="av2-icon-button"
                aria-label={`Remover leitura ${position + 1} de ${name}`}
                onClick={() => onChange(shown.filter((_, at) => at !== position))}
              >
                <X size={16} />
              </button>
            ) : (
              <span className="av2-icon-slot" aria-hidden="true" />
            )}
          </div>
        ))}
        {shown.length < MAX_READINGS ? (
          <button type="button" className="av2-add" aria-label={`Adicionar leitura de ${name}`} onClick={() => onChange([...shown, ""])}>
            <Plus size={14} /> leitura
          </button>
        ) : (
          <span className="av2-note">Até {MAX_READINGS} leituras por dobra.</span>
        )}
      </div>
    </div>
  );
}

/**
 * The "Medidas" step: basic measures and vital signs, the skinfold protocol, the readings of its sites, the other sites kept aside, and the
 * preview computed live with the formulas of the record. Switching the protocol only changes which sites are asked for: nothing typed is lost.
 */
export function CompositionStep({
  form,
  onChange,
  assessedOn,
  birthDate,
}: {
  form: CompositionForm;
  onChange: (form: CompositionForm) => void;
  assessedOn: string;
  birthDate: string | null;
}) {
  const age = ageAtAssessment(birthDate, assessedOn);
  const preview = compositionPreview(form, age);
  const required = requiredSites(form.protocol, form.equation);
  const others = otherSites(form.protocol, form.equation);
  const set = (patch: Partial<CompositionForm>) => onChange({ ...form, ...patch });
  const setSite = (site: SkinfoldSite, readings: string[]) => set({ skinfolds: { ...form.skinfolds, [site]: readings } });
  const othersTyped = others.filter((site) => (form.skinfolds[site] ?? []).some((text) => text.trim() !== "")).length;

  return (
    <div className="av2-cards">
      <section className="panel av2-card" aria-labelledby="av2-basicas">
        <h3 id="av2-basicas">Medidas básicas e sinais vitais</h3>
        <p className="muted small">Data e aferidor vinculados à avaliação. Campo vazio é “sem aferição”, nunca zero.</p>
        <div className="av2-grid">
          <UnitField label="Peso" unit="kg" value={form.weight} onChange={(weight) => set({ weight })} placeholder="Sem aferição" />
          <UnitField label="Altura" unit="m" value={form.height} onChange={(height) => set({ height })} placeholder="Sem aferição" />
          <div className="av2-field" role="group" aria-labelledby="av2-pressao">
            <span id="av2-pressao" className="av2-label">
              PAS / PAD
            </span>
            <span className="av2-pair-fields">
              <UnitInput label="PAS" unit="mmHg" value={form.systolic} onChange={(systolic) => set({ systolic })} />
              <span aria-hidden="true" className="av2-slash">/</span>
              <UnitInput label="PAD" unit="mmHg" value={form.diastolic} onChange={(diastolic) => set({ diastolic })} />
            </span>
          </div>
          <UnitField label="FC repouso" unit="bpm" value={form.heartRate} onChange={(heartRate) => set({ heartRate })} placeholder="Sem aferição" />
        </div>
      </section>

      <section className="panel av2-card" aria-labelledby="av2-protocolo">
        <h3 id="av2-protocolo">Protocolo de dobras cutâneas</h3>
        <p className="muted small">A troca do método nunca apaga medidas já registradas.</p>
        <div className="av2-chips" role="radiogroup" aria-label="Protocolo de dobras">
          {PROTOCOL_IDS.map((protocol) => (
            <label key={protocol} className="av2-chip">
              <input type="radio" name="av2-protocol" checked={form.protocol === protocol} onChange={() => set({ protocol })} />
              <span>{PROTOCOL_CHIP[protocol]}</span>
            </label>
          ))}
        </div>
        <div className="av2-grid">
          <div className="av2-field">
            <label htmlFor="av2-equacao" className="av2-label">
              Referência da equação
            </label>
            <select id="av2-equacao" value={form.equation} onChange={(event) => set({ equation: event.target.value as EquationSelection })} aria-describedby="av2-equacao-nota">
              {EQUATIONS.map((equation) => (
                <option key={equation} value={equation}>
                  {EQUATION_LABEL[equation]}
                </option>
              ))}
            </select>
            <span id="av2-equacao-nota" className="av2-note">
              É a referência da equação, não o gênero da pessoa.
            </span>
          </div>
          <ReadOnlyField label="Idade na avaliação" value={age === null ? "Sem data de nascimento no cadastro" : `${age} ${age === 1 ? "ano" : "anos"}`} />
          <ReadOnlyField label="Fórmula de conversão" value={CONVERSION_LABEL.siri_1961} />
          <div className="av2-field">
            <label htmlFor="av2-leituras" className="av2-label">
              Leituras por dobra
            </label>
            <select id="av2-leituras" value={form.aggregation} onChange={(event) => set({ aggregation: event.target.value as AggregationRule })}>
              {AGGREGATIONS.map((rule) => (
                <option key={rule} value={rule}>
                  {AGGREGATION_LABEL[rule]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="panel av2-card" aria-labelledby="av2-dobras">
        <h3 id="av2-dobras">Dobras requeridas{form.protocol ? ` • ${protocolTitle(form.protocol)}` : ""}</h3>
        <p className="muted small">
          {form.protocol === null
            ? "Escolha um protocolo para ver as dobras que ele pede. As medidas abaixo ficam guardadas de qualquer forma."
            : form.equation === "not_selected"
              ? "Medidas em milímetros. Sem a equação escolhida, aparecem as dobras das duas referências."
              : "Medidas em milímetros; itens fora deste método permanecem salvos."}
        </p>
        {required.length > 0 && (
          <div className="av2-grid">
            {required.map((site) => (
              <SiteReadings key={site} site={site} readings={form.skinfolds[site] ?? []} onChange={(readings) => setSite(site, readings)} />
            ))}
          </div>
        )}
        <details className="av2-others" open={form.protocol === null || undefined}>
          <summary>
            Outras dobras (guardadas, fora deste método){othersTyped > 0 ? ` · ${othersTyped} com medida` : ""}
          </summary>
          <div className="av2-grid">
            {others.map((site) => (
              <SiteReadings key={site} site={site} readings={form.skinfolds[site] ?? []} onChange={(readings) => setSite(site, readings)} />
            ))}
          </div>
        </details>
      </section>

      <section className="panel av2-card" aria-labelledby="av2-previa">
        <h3 id="av2-previa">Prévia calculada</h3>
        <p className="muted small">{preview.method ?? "Resultado estimado; o método aparece quando o protocolo e a equação estão escolhidos."}</p>
        <dl className="av2-results">
          {(
            [
              [preview.sumLabel, preview.sum],
              ["Gordura estimada", preview.fatPercent],
              ["Massa gorda", preview.fatMass],
              ["Massa livre", preview.fatFree],
              ["IMC", preview.bmi],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="av2-result">
              <dt>{label}</dt>
              <dd>{value ?? "—"}</dd>
            </div>
          ))}
        </dl>
        <div aria-live="polite">
          {preview.status && <p className="av2-preview-status">{preview.status}</p>}
          {preview.flag && <p className="av2-flag">{preview.flag}</p>}
        </div>
      </section>
    </div>
  );
}
