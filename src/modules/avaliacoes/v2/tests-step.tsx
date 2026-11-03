"use client";
import { cooper } from "../formulas";
import { DateField, ReadOnlyField, TextAreaField, TextField, UnitField } from "./fields";
import {
  COOPER_MINUTES,
  EXERCISE_LABEL,
  REPETITION_TESTS,
  TESTS_CLASSIFICATION_NOTE,
  TEST_SOURCE,
  TEST_TITLE,
  parseDistance,
  type RepetitionTestForm,
  type RepetitionTestKey,
  type TestsForm,
} from "./physical-tests";
import type { TemplatePart } from "./template";
import { COOPER_VO2_METHOD, EXACT_METHODS, formatResult, methodLabel } from "./review";

const CARD_ID: Record<RepetitionTestKey, string> = { abdominal: "av2-teste-abdominal", upperLimb: "av2-teste-membros-superiores" };

function RepetitionCard({ test, form, onChange }: { test: RepetitionTestKey; form: RepetitionTestForm; onChange: (form: RepetitionTestForm) => void }) {
  const set = (patch: Partial<RepetitionTestForm>) => onChange({ ...form, ...patch });
  return (
    <section className="panel av2-card" aria-labelledby={CARD_ID[test]}>
      <h3 id={CARD_ID[test]}>{TEST_TITLE[test]}</h3>
      <p className="muted small">{TEST_SOURCE[test]}</p>
      <div className="av2-grid">
        <TextField label={EXERCISE_LABEL[test]} value={form.exercise} onChange={(exercise) => set({ exercise })} />
        <UnitField
          label="Repetições completas"
          unit="rep"
          integer
          value={form.repetitions}
          placeholder="Sem registro"
          onChange={(repetitions) => set({ repetitions })}
          note="0 é um resultado; vazio é não realizado."
        />
        <UnitField label="Duração" unit="s" integer value={form.durationSeconds} placeholder="Se houver" onChange={(durationSeconds) => set({ durationSeconds })} />
        {/* Handoff 3.5 lists conditions for the upper-limb test ("duração/condições"), not for the abdominal one. */}
        {test === "upperLimb" && <TextField label="Condições" value={form.conditions} onChange={(conditions) => set({ conditions })} />}
        <TextField wide label="Classificação (manual)" value={form.classificationManual} onChange={(classificationManual) => set({ classificationManual })} note={TESTS_CLASSIFICATION_NOTE} />
        <TextAreaField label="Observações" context={`de ${TEST_TITLE[test].toLowerCase()}`} value={form.notes} onChange={(notes) => set({ notes })} />
      </div>
    </section>
  );
}

/**
 * The "Testes físicos" step (handoff 3.5, Figma AV-06): abdominal and upper-limb endurance as complete repetitions, and the Cooper 12-minute test
 * with the distance, its date, place, conditions and contraindications. The speed and the estimated VO₂max are a preview with the same versioned
 * formulas the finalize records; nothing is classified by the system (the classification is the professional's text).
 */
export function TestsStep({
  form,
  onChange,
  on = () => true,
}: {
  form: TestsForm;
  onChange: (form: TestsForm) => void;
  /** Whether the draft's model has a test on (slice 0.85): a test that is off is not shown. */
  on?: (part: TemplatePart) => boolean;
}) {
  const set = (patch: Partial<TestsForm>) => onChange({ ...form, ...patch });
  const setCooper = (patch: Partial<TestsForm["cooper"]>) => set({ cooper: { ...form.cooper, ...patch } });
  const typed = form.cooper.distanceM.trim();
  const distance = typed === "" ? null : parseDistance(typed);
  const outcome = cooper(distance);
  const speed = typed === "" ? "Sem distância" : outcome ? formatResult("cooper_speed_kmh", outcome.speedKmh, "km/h") : "Confira a distância";
  const vo2 =
    typed === ""
      ? "Sem distância"
      : !outcome
        ? "Confira a distância"
        : outcome.vo2Estimate > 0
          ? formatResult("cooper_vo2_estimate", outcome.vo2Estimate, "ml/kg/min")
          : "Sem valor positivo para esta distância";
  return (
    <div className="av2-cards">
      {REPETITION_TESTS.filter((test) => on(test === "upperLimb" ? "upper_limb" : test)).map((test) => (
        <RepetitionCard key={test} test={test} form={form[test]} onChange={(next) => set({ [test]: next })} />
      ))}

      {on("cooper") && (
        <section className="panel av2-card" aria-labelledby="av2-teste-cooper">
          <h3 id="av2-teste-cooper">{TEST_TITLE.cooper}</h3>
          <p className="muted small">Distância percorrida em {COOPER_MINUTES} minutos.</p>
          <div className="av2-grid">
            <UnitField label="Distância percorrida" unit="m" value={form.cooper.distanceM} placeholder="Sem registro" onChange={(distanceM) => setCooper({ distanceM })} />
            <ReadOnlyField label="Velocidade média" value={speed} note={methodLabel(EXACT_METHODS.cooperSpeed)} />
            <ReadOnlyField label="VO₂máx estimado" value={vo2} note="Prévia; registrada ao finalizar." />
            <DateField label="Data do teste" value={form.cooper.testedOn} onChange={(testedOn) => setCooper({ testedOn })} />
            <TextField label="Local" value={form.cooper.location} onChange={(location) => setCooper({ location })} />
            <TextField label="Condições" value={form.cooper.conditions} onChange={(conditions) => setCooper({ conditions })} />
            <TextField label="Contraindicações" value={form.cooper.contraindications} onChange={(contraindications) => setCooper({ contraindications })} />
            <TextField wide label="Classificação (manual)" value={form.cooper.classificationManual} onChange={(classificationManual) => setCooper({ classificationManual })} note={TESTS_CLASSIFICATION_NOTE} />
            <TextAreaField label="Observações" context="do teste de Cooper" value={form.cooper.notes} onChange={(notes) => setCooper({ notes })} />
          </div>
          <p className="av2-method-note small">
            Estimativa pela equação {methodLabel(COOPER_VO2_METHOD)}, com a versão da fórmula registrada. Um valor de documento antigo pode divergir; o
            cálculo não é forçado a reproduzi-lo.
          </p>
        </section>
      )}
    </div>
  );
}
