"use client";
import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Notice } from "@/components/ui";
import type { AssessmentDetail } from "@/db/assessments";
import { PhotosFieldset } from "./photos-fieldset";
import { recordAssessment, saveAssessment } from "./actions";
import {
  CLEAR_TEXT,
  MAX_METRICS,
  METRIC_TYPES,
  MOVEMENT_GRADES,
  MOVEMENT_TESTS,
  POSTURE_VIEWS,
  REVIEW_REQUIRED_TEXT,
  SCREENING_ITEMS,
  SIDES,
  SIDE_LABEL,
  type MetricType,
  type MovementGrade,
  type MovementKey,
  type PostureKey,
} from "./contracts";

interface MetricDraft {
  key: number;
  metricType: MetricType;
  name: string;
  value: string;
  unit: string;
  side: string;
  notes: string;
}

const today = () => new Date().toISOString().slice(0, 10);

/** What the professional typed for a metric, shown again as typed. */
function draftsFrom(detail: AssessmentDetail): MetricDraft[] {
  return detail.metrics.map((metric, index) => {
    const type = (metric.metricType in METRIC_TYPES ? metric.metricType : "CUSTOM") as MetricType;
    const defaultUnit: string | null = METRIC_TYPES[type].unit;
    return {
      key: index,
      metricType: type,
      name: type === "CUSTOM" ? metric.name : "",
      value: metric.valueText,
      unit: metric.unit && metric.unit !== defaultUnit ? metric.unit : "",
      side: metric.side ?? "",
      notes: metric.notes ?? "",
    };
  });
}

/**
 * The open assessment: the six screening items of the master document and the indicators the
 * professional chooses. Fields are controlled and sent from a handler, not from `action`: React
 * 19 resets a form after its action, which would erase the text when the server refuses it.
 *
 * Nothing is interpreted here. The status is computed from the marked items, in the browser only
 * for the preview and again on the server for the record.
 */
export function AssessmentForm({
  detail,
  minor,
  storageReady,
}: {
  detail: AssessmentDetail;
  /** The student is known to be under 18: photos are not accepted. */
  minor: boolean;
  /** The photo storage is provisioned in this environment. */
  storageReady: boolean;
}) {
  const [assessedOn, setAssessedOn] = useState(detail.assessedOn);
  const [flags, setFlags] = useState(detail.flags);
  const [screeningNotes, setScreeningNotes] = useState(detail.screeningNotes ?? "");
  const [notes, setNotes] = useState(detail.notes ?? "");
  const [metrics, setMetrics] = useState<MetricDraft[]>(() => draftsFrom(detail));
  const [nextKey, setNextKey] = useState(detail.metrics.length);
  const [posture, setPosture] = useState<PostureKey[]>(detail.posture.findings);
  const [postureNotes, setPostureNotes] = useState(detail.posture.notes ?? "");
  const [movement, setMovement] = useState<Record<MovementKey, { grade: MovementGrade; notes: string }>>(() =>
    Object.fromEntries(
      MOVEMENT_TESTS.map((test) => {
        const saved = detail.movement.find((row) => row.test === test.key);
        return [test.key, { grade: saved?.grade ?? "NOT_ASSESSED", notes: saved?.notes ?? "" }];
      }),
    ) as Record<MovementKey, { grade: MovementGrade; notes: string }>,
  );
  const [asked, setAsked] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const marked = SCREENING_ITEMS.some((item) => flags[item.key]);

  const touch = () => setMessage("");
  const updateMetric = (key: number, patch: Partial<MetricDraft>) => {
    setMetrics((list) => list.map((item) => (item.key === key ? { ...item, ...patch } : item)));
    touch();
  };
  const text = (value: string) => (value.trim() === "" ? null : value);
  const payload = () => ({
    assessedOn,
    ...flags,
    screeningNotes: text(screeningNotes),
    notes: text(notes),
    metrics: metrics.map((metric) => ({
      metricType: metric.metricType,
      name: text(metric.name),
      value: metric.value,
      unit: text(metric.unit),
      side: metric.side === "" ? null : metric.side,
      notes: text(metric.notes),
    })),
    posture: { findings: posture, notes: text(postureNotes) },
    movement: MOVEMENT_TESTS.map((test) => ({
      test: test.key,
      grade: movement[test.key].grade,
      notes: text(movement[test.key].notes),
    })),
  });

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await saveAssessment(detail.id, payload());
      setFailed(Boolean(result.error));
      setMessage(result.error ?? "Rascunho salvo.");
    });
  }
  function record() {
    startTransition(async () => {
      // On success the action redirects; a result only comes back when it was refused.
      const result = await recordAssessment(detail.id, payload(), marked || asked);
      if (result?.error) {
        setFailed(true);
        setMessage(result.error);
      }
    });
  }

  return (
    <form className="stack-form profile-form" onSubmit={save}>
      <Notice>
        <p>
          A avaliação registra o que o aluno relatou e o que você mediu. Ela
          descreve, não diagnostica. Depois de registrada, a avaliação não muda:
          uma nova avaliação é um novo registro, com a data dela.
        </p>
      </Notice>

      <fieldset>
        <legend>Data</legend>
        <label>
          Data da avaliação
          <input
            type="date"
            value={assessedOn}
            max={today()}
            required
            onChange={(event) => {
              setAssessedOn(event.target.value);
              touch();
            }}
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>Triagem</legend>
        <p className="small muted">
          Marque o que o aluno relatou ou o que você observou. Qualquer item
          marcado exige a sua revisão antes da entrega de um treino.
        </p>
        {SCREENING_ITEMS.map((item) => (
          <label key={item.key} className="check-row">
            <input
              type="checkbox"
              checked={flags[item.key]}
              onChange={(event) => {
                setFlags({ ...flags, [item.key]: event.target.checked });
                touch();
              }}
            />
            {item.label}
          </label>
        ))}
        <label>
          Detalhes da triagem
          <textarea
            rows={2}
            value={screeningNotes}
            maxLength={1000}
            onChange={(event) => {
              setScreeningNotes(event.target.value);
              touch();
            }}
          />
        </label>
        {marked ? (
          <Notice tone="warning">
            <p>
              <strong>{REVIEW_REQUIRED_TEXT}</strong> Ao registrar, a avaliação
              fica com esta marca até você anotar a sua revisão.
            </p>
          </Notice>
        ) : (
          <>
            <p className="small muted" role="status">
              {CLEAR_TEXT}
            </p>
            <label className="check-row">
              <input
                type="checkbox"
                checked={asked}
                onChange={(event) => {
                  setAsked(event.target.checked);
                  touch();
                }}
              />
              Perguntei ao aluno sobre os seis itens e nenhum foi relatado.
            </label>
          </>
        )}
      </fieldset>

      <fieldset>
        <legend>Análise postural</legend>
        <p className="small muted">
          Registro visual e hipótese de trabalho, não diagnóstico. Marque o que
          você observou; o que não for marcado fica como não observado, não
          como normal. Não altera a triagem.
        </p>
        {POSTURE_VIEWS.map((view) => (
          <div key={view.key} role="group" aria-label={view.label} className="check-group">
            <p className="small muted">
              <strong>{view.label}</strong>
            </p>
            {view.items.map((item) => (
              <label key={item.key} className="check-row">
                <input
                  type="checkbox"
                  checked={posture.includes(item.key)}
                  onChange={(event) => {
                    setPosture(
                      event.target.checked
                        ? [...posture, item.key]
                        : posture.filter((key) => key !== item.key),
                    );
                    touch();
                  }}
                />
                {item.label}
              </label>
            ))}
          </div>
        ))}
        <label>
          Notas posturais
          <textarea
            rows={2}
            value={postureNotes}
            maxLength={1000}
            onChange={(event) => {
              setPostureNotes(event.target.value);
              touch();
            }}
          />
        </label>
      </fieldset>

      <PhotosFieldset
        studentId={detail.studentId}
        assessmentId={detail.id}
        photos={detail.photos}
        minor={minor}
        storageReady={storageReady}
      />

      <fieldset>
        <legend>Movimento, mobilidade e controle</legend>
        <p className="small muted">
          Escolha o resultado observado em cada teste. Os que ficarem em &ldquo;Não
          avaliado&rdquo; não são gravados. Esta escala não altera a triagem.
        </p>
        {MOVEMENT_TESTS.map((test) => (
          <div key={test.key} className="movement-row" role="group" aria-label={test.label}>
            <label>
              {test.label}
              <select
                value={movement[test.key].grade}
                onChange={(event) => {
                  setMovement({
                    ...movement,
                    [test.key]: { ...movement[test.key], grade: event.target.value as MovementGrade },
                  });
                  touch();
                }}
              >
                {MOVEMENT_GRADES.map((grade) => (
                  <option key={grade.key} value={grade.key}>
                    {grade.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Observação ({test.label})
              <input
                value={movement[test.key].notes}
                maxLength={500}
                onChange={(event) => {
                  setMovement({
                    ...movement,
                    [test.key]: { ...movement[test.key], notes: event.target.value },
                  });
                  touch();
                }}
              />
            </label>
          </div>
        ))}
      </fieldset>

      <fieldset>
        <legend>Indicadores</legend>
        <p className="small muted">
          Registre só o que você mediu. Os valores ficam como digitados, com a
          unidade e o lado quando fizer sentido.
        </p>
        {metrics.length === 0 && <p className="muted">Nenhum indicador adicionado.</p>}
        {metrics.map((metric, index) => (
          <div key={metric.key} className="metric-row" role="group" aria-label={`Indicador ${index + 1}`}>
            <div className="field-grid">
              <label>
                Tipo
                <select
                  value={metric.metricType}
                  onChange={(event) => updateMetric(metric.key, { metricType: event.target.value as MetricType })}
                >
                  {(Object.keys(METRIC_TYPES) as MetricType[]).map((key) => (
                    <option key={key} value={key}>
                      {METRIC_TYPES[key].label}
                    </option>
                  ))}
                </select>
              </label>
              {metric.metricType === "CUSTOM" && (
                <label>
                  Nome da medida ou do teste
                  <input
                    value={metric.name}
                    maxLength={80}
                    onChange={(event) => updateMetric(metric.key, { name: event.target.value })}
                  />
                </label>
              )}
              <label>
                Valor
                <input
                  value={metric.value}
                  maxLength={40}
                  inputMode={metric.metricType === "CUSTOM" ? "text" : "decimal"}
                  placeholder={metric.metricType === "BLOOD_PRESSURE" ? "120/80" : undefined}
                  onChange={(event) => updateMetric(metric.key, { value: event.target.value })}
                />
              </label>
              <label>
                Unidade
                <input
                  value={metric.unit}
                  maxLength={20}
                  placeholder={METRIC_TYPES[metric.metricType].unit ?? ""}
                  onChange={(event) => updateMetric(metric.key, { unit: event.target.value })}
                />
              </label>
              <label>
                Lado
                <select value={metric.side} onChange={(event) => updateMetric(metric.key, { side: event.target.value })}>
                  <option value="">Não se aplica</option>
                  {SIDES.map((side) => (
                    <option key={side} value={side}>
                      {SIDE_LABEL[side]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Observação
                <input
                  value={metric.notes}
                  maxLength={500}
                  onChange={(event) => updateMetric(metric.key, { notes: event.target.value })}
                />
              </label>
            </div>
            <button
              type="button"
              className="button danger-outline small"
              onClick={() => {
                setMetrics((list) => list.filter((item) => item.key !== metric.key));
                touch();
              }}
            >
              <Trash2 size={16} /> Remover indicador {index + 1}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="button secondary small"
          disabled={metrics.length >= MAX_METRICS}
          onClick={() => {
            setMetrics((list) => [
              ...list,
              { key: nextKey, metricType: "RESTING_HEART_RATE", name: "", value: "", unit: "", side: "", notes: "" },
            ]);
            setNextKey(nextKey + 1);
            touch();
          }}
        >
          <Plus size={16} /> Adicionar indicador
        </button>
      </fieldset>

      <fieldset>
        <legend>Observações</legend>
        <label>
          Observações da avaliação
          <textarea
            rows={3}
            value={notes}
            maxLength={1000}
            onChange={(event) => {
              setNotes(event.target.value);
              touch();
            }}
          />
        </label>
      </fieldset>

      {message && (
        <p role={failed ? "alert" : "status"} className={failed ? "form-error" : "small muted"}>
          {message}
        </p>
      )}
      <div className="persist-actions">
        <button className="button secondary" disabled={pending}>
          {pending ? "Salvando…" : "Salvar rascunho"}
        </button>
        <button
          type="button"
          className="button primary"
          disabled={pending || (!marked && !asked)}
          onClick={record}
        >
          Registrar avaliação
        </button>
      </div>
      <p className="small muted">
        Registrar fecha a avaliação. Salvar o rascunho a mantém aberta para
        edição.
      </p>
    </form>
  );
}
