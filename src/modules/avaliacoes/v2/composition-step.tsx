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

/** A number field with its unit drawn inside, as in the Figma frames; the unit is also in the field's name for screen readers. */
function UnitField({
  label,
  unit,
  value,
  onChange,
  placeholder,
  hideLabel = false,
}: {
  label: string;
  unit: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hideLabel?: boolean;
}) {
  const id = useId();
  // The unit is drawn inside the field and stays out of the label, so the field's name is exactly "Peso (kg)".
  return (
    <div className="av2-field">
      <label htmlFor={id} className={hideLabel ? "sr-only" : undefined}>
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

/** One skinfold site: up to three readings, none of them a 0 when not measured. */
function SiteReadings({ site, readings, onChange }: { site: SkinfoldSite; readings: string[]; onChange: (readings: string[]) => void }) {
  const shown = readings.length === 0 ? [""] : readings;
  const name = SITE_LABEL[site];
  return (
    <fieldset className="av2-site">
      <legend>{name}</legend>
      {shown.map((value, position) => (
        <div key={position} className="av2-reading">
          <UnitField
            label={position === 0 ? name : `${name}, leitura ${position + 1}`}
            hideLabel
            unit="mm"
            value={value}
            placeholder="Sem aferição"
            onChange={(text) => onChange(shown.map((item, at) => (at === position ? text : item)))}
          />
          {position > 0 && (
            <button
              type="button"
              className="av2-icon-button"
              aria-label={`Remover leitura ${position + 1} de ${name}`}
              onClick={() => onChange(shown.filter((_, at) => at !== position))}
            >
              <X size={16} />
            </button>
          )}
        </div>
      ))}
      {shown.length < MAX_READINGS && (
        <button type="button" className="av2-add" aria-label={`Adicionar leitura de ${name}`} onClick={() => onChange([...shown, ""])}>
          <Plus size={14} /> leitura
        </button>
      )}
    </fieldset>
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
          <fieldset className="av2-pair">
            <legend>PAS / PAD</legend>
            <span className="av2-pair-fields">
              <UnitField label="PAS" unit="mmHg" hideLabel value={form.systolic} onChange={(systolic) => set({ systolic })} />
              <span aria-hidden="true" className="av2-slash">/</span>
              <UnitField label="PAD" unit="mmHg" hideLabel value={form.diastolic} onChange={(diastolic) => set({ diastolic })} />
            </span>
          </fieldset>
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
            <label htmlFor="av2-equacao">Equação de referência para o cálculo</label>
            <select id="av2-equacao" value={form.equation} onChange={(event) => set({ equation: event.target.value as EquationSelection })} aria-describedby="av2-equacao-nota">
              {EQUATIONS.map((equation) => (
                <option key={equation} value={equation}>
                  {EQUATION_LABEL[equation]}
                </option>
              ))}
            </select>
            <span id="av2-equacao-nota" className="av2-note">É a referência da equação, não o gênero da pessoa.</span>
          </div>
          <label className="av2-field">
            Idade na avaliação
            <input readOnly value={age === null ? "Sem data de nascimento no cadastro" : `${age} ${age === 1 ? "ano" : "anos"}`} />
          </label>
          <label className="av2-field">
            Fórmula de conversão
            <input readOnly value={CONVERSION_LABEL.siri_1961} />
          </label>
          <label className="av2-field">
            Leituras por dobra
            <select value={form.aggregation} onChange={(event) => set({ aggregation: event.target.value as AggregationRule })}>
              {AGGREGATIONS.map((rule) => (
                <option key={rule} value={rule}>
                  {AGGREGATION_LABEL[rule]}
                </option>
              ))}
            </select>
          </label>
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
